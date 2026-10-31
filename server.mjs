import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCues, sortSegs, validateSegment, align, makeNotes, makeQuiz, fmt, buildLearningCoachPlan } from "./lib/core.mjs";
import { initializeDatabase } from "./lib/database.mjs";
import { HttpError, securityHeaders, sendJson as send, readJsonBody as body, runCommand as run } from "./lib/http-utils.mjs";
import { createSessionService } from "./lib/sessions.mjs";
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCodeOrDummy, hashSecret, verifySecret } from "./lib/recovery.mjs";
import { createRateLimiter, clientAddress, pruneRateLimits } from "./lib/rate-limit.mjs";
import { createLectureReadModel } from "./lib/lecture-read-model.mjs";
import { createLectureProcessor } from "./lib/lecture-processing.mjs";
import { createSemanticAlignmentService } from "./lib/semantic-alignment.mjs";
import { createWorkspaceService } from "./lib/workspace.mjs";
const ROOT=path.dirname(fileURLToPath(import.meta.url)),DATA=process.env.DATA_DIR||path.join(ROOT,"data"),PORT=+process.env.PORT||3000;
const DEMO_ENABLED=String(process.env.DEMO_ENABLED??"true").toLowerCase()!=="false";
const DEMO_EMAIL="demo@lecturelens.local";
const LOCAL_TRANSCRIPTION_ENABLED=String(process.env.LOCAL_TRANSCRIPTION_ENABLED??"true").toLowerCase()!=="false", LOCAL_TRANSCRIPTION_PYTHON=process.env.LOCAL_TRANSCRIPTION_PYTHON||"python", LOCAL_TRANSCRIPTION_MODEL=process.env.LOCAL_TRANSCRIPTION_MODEL||"base";
const TKEY=process.env.TRANSCRIPTION_API_KEY||"",TBASE=(process.env.TRANSCRIPTION_BASE_URL||"https://api.openai.com/v1").replace(/\/$/,""),TMODEL=process.env.TRANSCRIPTION_MODEL||"whisper-1",T_TIMEOUT=Math.max(10000,Math.min(300000,Number(process.env.TRANSCRIPTION_REQUEST_TIMEOUT_MS)||120000));
const AKEY=process.env.AI_API_KEY||"",ABASE=(process.env.AI_BASE_URL||"https://api.openai.com/v1").replace(/\/$/,""),AMODEL=process.env.AI_MODEL||"gpt-4o-mini",AI_TIMEOUT=Math.max(5000,Math.min(120000,Number(process.env.AI_REQUEST_TIMEOUT_MS)||45000));
// Shared AI helper for API routes (Learning Coach and wrong-answer explanations).
// The lecture processor has its own scoped helper; routes must not reference that private function.
async function aiJSON(system,payload){
  if(!AKEY)return null;
  const response=await fetch(`${ABASE}/chat/completions`,{
    method:"POST",
    headers:{authorization:`Bearer ${AKEY}`,"content-type":"application/json"},
    body:JSON.stringify({model:AMODEL,temperature:0.2,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(payload)}]}),
    signal:AbortSignal.timeout(AI_TIMEOUT),
  });
  if(!response.ok){
    const detail=(await response.text().catch(()=>"")).slice(0,300);
    throw new Error(`AI provider HTTP ${response.status}${detail?`: ${detail}`:""}`);
  }
  const data=await response.json();
  const content=data.choices?.[0]?.message?.content;
  if(typeof content!=="string")throw new Error("AI provider returned no JSON content");
  try{return JSON.parse(content)}catch{throw new Error("AI provider returned invalid JSON content")}
}
const EKEY=process.env.EMBEDDINGS_API_KEY||"", EBASE=(process.env.EMBEDDINGS_BASE_URL||ABASE).replace(/\/$/,""), EMODEL=process.env.EMBEDDINGS_MODEL||"text-embedding-3-small", E_TIMEOUT=Math.max(5000,Math.min(120000,Number(process.env.EMBEDDINGS_REQUEST_TIMEOUT_MS)||30000)), E_BATCH=Math.max(1,Math.min(128,Number(process.env.EMBEDDINGS_BATCH_SIZE)||64)), E_MIN=Math.max(0.05,Math.min(0.95,Number(process.env.EMBEDDINGS_MIN_SIMILARITY)||0.35));
const LIM={media:+process.env.MAX_MEDIA_MB*1048576||500*1048576,slides:50*1048576,transcript:5*1048576};
const MEDIA_EXT=["mp3","wav","m4a","mp4","webm"],SLIDE_EXT=["pdf","pptx"],TR_EXT=["vtt","srt"];
const db = initializeDatabase(DATA);
const uid = () => crypto.randomUUID();
const ID = /^[0-9a-f-]{36}$/;
const {
  hashToken, cookieToken, currentUser, setSession, clearSession, pruneExpiredSessions,
} = createSessionService({ db, production: process.env.NODE_ENV === "production" });
const dir = (id) => path.join(DATA, "files", id);
const log = (...args) => console.log(new Date().toISOString(), ...args);
const assertOwner = (id, user) => {
  const row = db.prepare("SELECT owner_id FROM lectures WHERE id = ?").get(id);
  if (!row || row.owner_id !== user.id) throw new HttpError(404, "Lecture not found");
};
// Persist counters in SQLite by default so limits survive restarts. RATE_LIMIT_STORE=memory opts out.
const RATE_DB = String(process.env.RATE_LIMIT_STORE || "sqlite").toLowerCase() === "memory" ? null : db;
const loginLimiter = createRateLimiter({
  db: RATE_DB,
  limit: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
});
const signupLimiter = createRateLimiter({
  db: RATE_DB,
  limit: Number(process.env.SIGNUP_RATE_LIMIT_MAX) || 8,
  windowMs: Number(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
});
const demoLimiter = createRateLimiter({
  db: RATE_DB,
  limit: Number(process.env.DEMO_RATE_LIMIT_MAX) || 30,
  windowMs: Number(process.env.DEMO_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
});
const recoverLimiter = createRateLimiter({
  db: RATE_DB,
  limit: Number(process.env.RECOVER_RATE_LIMIT_MAX) || 5,
  windowMs: Number(process.env.RECOVER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
});
const TRUST_PROXY = String(process.env.TRUST_PROXY || "false").toLowerCase() === "true";
function enforceRateLimit(req, limiter, scope) {
  const result = limiter.consume(`${scope}:${clientAddress(req, TRUST_PROXY)}`);
  if (!result.allowed) {
    throw new HttpError(429, "Too many attempts. Please try again later.", {
      "retry-after": String(result.retryAfterSeconds),
    });
  }
}
// ---- stage tracking: each stage persisted before moving on; earlier outputs are never erased by later failures
const setStage=(id,stage,state,msg="")=>{const l=db.prepare("SELECT stages FROM lectures WHERE id=?").get(id),s=JSON.parse(l.stages);
s[stage]={state,msg,at:Date.now()};
db.prepare("UPDATE lectures SET stage=?,stages=? WHERE id=?").run(stage,JSON.stringify(s),id)};
const addErr=(id,stage,message)=>{db.prepare("INSERT INTO errors(lecture_id,stage,message,created) VALUES(?,?,?,?)").run(id,stage,String(message).slice(0,500),Date.now());
log("error",id,stage,message)};
const alignSemantically = createSemanticAlignmentService({ apiKey:EKEY, baseUrl:EBASE, model:EMODEL, timeoutMs:E_TIMEOUT, batchSize:E_BATCH, minSimilarity:E_MIN, fallbackAlign:align, log });
const processor = createLectureProcessor({
  db, fs, path, run, uid, fmt, sortSegs, align, alignSemantically, makeNotes, makeQuiz,
  dir, setStage, addErr, log,
  AI_KEY: AKEY, AI_BASE: ABASE, AI_MODEL: AMODEL, AI_TIMEOUT,
  TRANSCRIPTION_KEY: TKEY, TRANSCRIPTION_BASE: TBASE,
  TRANSCRIPTION_MODEL: TMODEL, TRANSCRIPTION_TIMEOUT: T_TIMEOUT,
  ROOT, LOCAL_TRANSCRIPTION_ENABLED, LOCAL_TRANSCRIPTION_PYTHON, LOCAL_TRANSCRIPTION_MODEL,
});
const { processLecture, analyse, isRunning } = processor;
// ---- serialization
const { full } = createLectureReadModel(db);
const { ensureStarterWorkspace, createDemoSandbox, pruneDemoSandboxes, isDemoSandboxEmail, SANDBOX_TTL_MS } = createWorkspaceService({
  db, path, uid, setStage, dir, full, demoEmail: DEMO_EMAIL, demoEnabled: DEMO_ENABLED,
});
// Housekeeping: expired sessions, stale rate-limit counters and old demo sandboxes (at startup, then hourly).
function housekeeping() {
  try {
    pruneExpiredSessions();
    if (RATE_DB) pruneRateLimits(db);
    if (DEMO_ENABLED) pruneDemoSandboxes();
  } catch (e) { log("housekeeping failed", e.message); }
}
housekeeping();
setInterval(housekeeping, 3600 * 1000).unref();
const lec=id=>{if(!ID.test(id)||!db.prepare("SELECT 1 FROM lectures WHERE id=?").get(id))throw new HttpError(404,"Lecture not found");
return id};
async function upload(req,id,kind,ext,max,name){ // raw body streamed to a server-chosen path; client filename never used for paths
  if(!ext||!kind.includes(ext))throw new HttpError(415,"Unsupported file type; allowed: "+kind.join(", "));
  if(+req.headers["content-length"]>max)throw new HttpError(413,"File too large");
  fs.mkdirSync(dir(id),{recursive:true});
const tmp=path.join(dir(id),"upload.tmp"),out=fs.createWriteStream(tmp);
let n=0;
  try{for await(const c of req){n+=c.length;
if(n>max)throw new HttpError(413,"File too large");
if(!out.write(c))await new Promise(r=>out.once("drain",r))}}catch(e){out.destroy();
fs.rmSync(tmp,{force:true});
throw e}
  await new Promise(r=>out.end(r));
if(!n){fs.rmSync(tmp,{force:true});
throw new HttpError(400,"Empty file")}return tmp}
const MIME = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  png: "image/png",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
};
const PUBLIC_FILES = new Set(["index.html", "styles.css", "app.mjs", "auth.mjs", "api-client.mjs", "tour.mjs"]);
const SECURITY_HEADERS=securityHeaders(process.env.NODE_ENV==="production");
const server=http.createServer(async(req,res)=>{
  for(const [name,value] of Object.entries(SECURITY_HEADERS))res.setHeader(name,value);
  try{const u=new URL(req.url,"http://x"),p=u.pathname.split("/").filter(Boolean),m=req.method;
    if (p[0] !== "api") {
      if (u.pathname === "/core.mjs") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "x-content-type-options": "nosniff" });
        return res.end(fs.readFileSync(path.join(ROOT, "lib", "core.mjs")));
      }
      const asset = u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname.slice(1));
      if (!PUBLIC_FILES.has(asset)) throw new HttpError(404, "Not found");
      const extension = path.extname(asset).slice(1);
      res.writeHead(200, {
        "content-type": MIME[extension],
        "x-content-type-options": "nosniff",
        "cache-control": asset === "index.html" ? "no-cache" : "public, max-age=300",
      });
      return res.end(fs.readFileSync(path.join(ROOT, "public", asset)));
    }
    if(p[1]==="health")return send(res,200,{ok:true,transcriptionConfigured:!!TKEY,localTranscriptionEnabled:LOCAL_TRANSCRIPTION_ENABLED,localTranscriptionModel:LOCAL_TRANSCRIPTION_MODEL,aiGenerationConfigured:!!AKEY,semanticAlignmentConfigured:!!EKEY,semanticAlignmentModel:EMODEL,demoEnabled:DEMO_ENABLED,tools:{ffmpeg:true}});
    if(p[1]==="auth"&&p[2]==="me"&&m==="GET"){const user=currentUser(req);return send(res,200,{user:user?{id:user.id,email:user.email,name:user.name,isDemo:!!user.is_demo}:null})}
    if(p[1]==="auth"&&p[2]==="demo"&&m==="POST"){
      enforceRateLimit(req, demoLimiter, "demo");
      if(!DEMO_ENABLED)throw new HttpError(404,"The demo workspace is disabled");
      const row=createDemoSandbox();
      if(!row)throw new HttpError(503,"The demo workspace is not available");
      const token=crypto.randomBytes(32).toString("base64url"),now=Date.now();
      db.prepare("INSERT INTO sessions(token_hash,user_id,expires,created) VALUES(?,?,?,?)").run(hashToken(token),row.id,now+SANDBOX_TTL_MS,now);
      setSession(res,token);return send(res,200,{user:{id:row.id,email:row.email,name:row.name,isDemo:true}});
    }
    if(p[1]==="auth"&&p[2]==="signup"&&m==="POST"){
      enforceRateLimit(req, signupLimiter, "signup");
      const b=await body(req),name=String(b.name||"").trim().slice(0,80),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
      if(name.length<2)throw new HttpError(422,"Enter your name (at least 2 characters)");
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new HttpError(422,"Enter a valid email address");
      if(email===DEMO_EMAIL||isDemoSandboxEmail(email))throw new HttpError(409,"This address is reserved for the judge demo. Use Try the demo instead.");
      if(password.length<8||password.length>200)throw new HttpError(422,"Password must be at least 8 characters");
      if(db.prepare("SELECT 1 FROM users WHERE email=?").get(email))throw new HttpError(409,"An account with this email already exists. Please log in.");
      const id=uid(),salt=crypto.randomBytes(16).toString("hex"),digest=crypto.scryptSync(password,salt,64).toString("hex");
      const recoveryCode=generateRecoveryCode();
      db.prepare("INSERT INTO users(id,email,name,password_hash,created,recovery_hash) VALUES(?,?,?,?,?,?)").run(id,email,name,`${salt}:${digest}`,Date.now(),hashRecoveryCode(recoveryCode));
      await ensureStarterWorkspace(id);
      const token=crypto.randomBytes(32).toString("base64url"),now=Date.now();db.prepare("INSERT INTO sessions(token_hash,user_id,expires,created) VALUES(?,?,?,?)").run(hashToken(token),id,now+7*86400000,now);setSession(res,token);return send(res,201,{user:{id,email,name},recoveryCode});
    }
    if(p[1]==="auth"&&p[2]==="login"&&m==="POST"){
      enforceRateLimit(req, loginLimiter, "login");
      const b=await body(req),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");const row=db.prepare("SELECT * FROM users WHERE email=?").get(email);
      let ok=false;if(row&&row.password_hash){const [salt,stored]=row.password_hash.split(":");const got=crypto.scryptSync(password,salt,64);const want=Buffer.from(stored,"hex");ok=got.length===want.length&&crypto.timingSafeEqual(got,want)}
      if(!ok)throw new HttpError(401,"Email or password is incorrect");await ensureStarterWorkspace(row.id);const token=crypto.randomBytes(32).toString("base64url"),now=Date.now();db.prepare("INSERT INTO sessions(token_hash,user_id,expires,created) VALUES(?,?,?,?)").run(hashToken(token),row.id,now+7*86400000,now);setSession(res,token);return send(res,200,{user:{id:row.id,email:row.email,name:row.name}});
    }
    if(p[1]==="auth"&&p[2]==="recover"&&m==="POST"){
      enforceRateLimit(req, recoverLimiter, "recover");
      const b=await body(req),email=String(b.email||"").trim().toLowerCase(),newPassword=String(b.newPassword||"");
      if(newPassword.length<8||newPassword.length>200)throw new HttpError(422,"Password must be at least 8 characters");
      const row=db.prepare("SELECT id,recovery_hash FROM users WHERE email=? AND is_demo=0").get(email);
      // One generic error for unknown email, missing code or wrong code, so this cannot be used to discover accounts.
      if(!verifyRecoveryCodeOrDummy(b.recoveryCode,row?.recovery_hash)||!row)throw new HttpError(401,"Email or recovery code is incorrect");
      const fresh=generateRecoveryCode();
      db.exec("BEGIN IMMEDIATE");
      try{
        db.prepare("UPDATE users SET password_hash=?,recovery_hash=? WHERE id=?").run(hashSecret(newPassword),hashRecoveryCode(fresh),row.id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.id);
        db.exec("COMMIT");
      }catch(e){db.exec("ROLLBACK");throw e}
      return send(res,200,{ok:true,recoveryCode:fresh});
    }
    if(p[1]==="auth"&&p[2]==="logout"&&m==="POST"){const token=cookieToken(req);if(token)db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));clearSession(res);return send(res,200,{ok:true})}
    const user=currentUser(req);if(!user)throw new HttpError(401,"Please log in to continue");await ensureStarterWorkspace(user.id);
    if(p[1]==="auth"&&p[2]==="recovery-code"&&m==="POST"){
      if(user.is_demo)throw new HttpError(403,"Judge sandboxes do not have recovery codes. Create an account to get one.");
      enforceRateLimit(req, recoverLimiter, "recovery-code");
      const b=await body(req),row=db.prepare("SELECT password_hash FROM users WHERE id=?").get(user.id);
      if(!row||!verifySecret(String(b.password||""),row.password_hash))throw new HttpError(401,"Password is incorrect");
      const fresh=generateRecoveryCode();
      db.prepare("UPDATE users SET recovery_hash=? WHERE id=?").run(hashRecoveryCode(fresh),user.id);
      return send(res,200,{recoveryCode:fresh});
    }
    if(user.is_demo&&p[1]==="lectures"){
      const rootCreate=p.length===2&&m==="POST",rootEdit=p.length===3&&(m==="PATCH"||m==="DELETE");
      const sub=p[3]||"",subWrite=["media","slides","transcript","transitions","segments","process","analyse"].includes(sub)&&["PUT","PATCH","POST"].includes(m);
      if(rootCreate||rootEdit||subWrite)throw new HttpError(403,"Your judge sandbox protects its preloaded lecture material. You can explore notes and submit quizzes, or create your own account to upload and edit lectures.");
    }
    if(p[1]==="learning-coach"&&m==="GET"){
      const owned=db.prepare("SELECT id,title,subject,created FROM lectures WHERE owner_id=? ORDER BY created DESC").all(user.id);
      const answerRows=db.prepare(`SELECT aa.lecture_id,aa.topic,aa.attempt_id,aa.correct,aa.created
        FROM attempt_answers aa JOIN lectures l ON l.id=aa.lecture_id WHERE l.owner_id=? ORDER BY aa.created ASC`).all(user.id);
      const answerGroups=new Map();
      for(const row of answerRows){const key=row.lecture_id+"\u0000"+row.topic;let g=answerGroups.get(key);if(!g){g={events:[],attempts:new Map()};answerGroups.set(key,g)}
        g.events.push(row);let a=g.attempts.get(row.attempt_id);if(!a){a={correct:0,total:0,created:row.created};g.attempts.set(row.attempt_id,a)}a.total++;a.correct+=row.correct?1:0;}
      const topics=[];
      for(const lecture of owned){
        const f=full(lecture.id,false);
        for(const slide of f.slides){
          const questions=f.questions.filter(q=>q.slideId===slide.id||(!q.slideId&&q.topic===slide.title)).length;
          const noteCount=f.notes.filter(n=>n.slideId===slide.id).length;
          const group=answerGroups.get(lecture.id+"\u0000"+slide.title),events=group?.events||[],attempts=[...(group?.attempts.values()||[])].sort((a,b)=>a.created-b.created);
          const answerCount=events.length,correct=events.reduce((n,x)=>n+(x.correct?1:0),0),lastPractice=events.length?Math.max(...events.map(x=>x.created)):null;
          topics.push({lectureId:lecture.id,lectureTitle:lecture.title,subject:lecture.subject||"",slideId:slide.id,slideNumber:slide.slideNumber,topic:slide.title,
            answerCount,correct,incorrect:answerCount-correct,accuracy:answerCount?Math.round(correct/answerCount*100):null,
            attemptCount:attempts.length,lastPractice,questionCount:questions,noteCount});
        }
      }
      // Preserve answer groups that no longer match a current slide title, but flag them as having no current source section.
      for(const [key,g] of answerGroups){
        const [lectureId,topic]=key.split("\u0000");if(topics.some(t=>t.lectureId===lectureId&&t.topic===topic))continue;
        const lecture=owned.find(x=>x.id===lectureId);if(!lecture)continue;const answerCount=g.events.length,correct=g.events.reduce((n,x)=>n+(x.correct?1:0),0),attempts=[...g.attempts.values()];
        topics.push({lectureId,lectureTitle:lecture.title,subject:lecture.subject||"",slideId:null,slideNumber:null,topic,
          answerCount,correct,incorrect:answerCount-correct,accuracy:answerCount?Math.round(correct/answerCount*100):null,
          attemptCount:attempts.length,lastPractice:Math.max(...g.events.map(x=>x.created)),questionCount:0,noteCount:0});
      }
      const lectures=owned.map(l=>({id:l.id,title:l.title,subject:l.subject,attempts:db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE lecture_id=?").get(l.id).n}));
      const plan=buildLearningCoachPlan({lectures,topics});
      // When an AI provider is configured, let it phrase a short coaching insight from the same evidence.
      // The deterministic, source-linked plan remains authoritative if the provider is unavailable.
      let aiInsight=null,aiUsed=false;
      if(AKEY&&plan.focusAreas.length){
        try{const insight=await aiJSON("You are LectureLens AI's study coach. Use only the supplied learning evidence. Do not invent scores, causes, deadlines, study habits, or facts. Do not diagnose ability. Return JSON with exactly: {\"headline\": string, \"message\": string, \"tip\": string}. Keep headline under 90 characters, message under 240 characters, tip under 180 characters. If evidence is sparse, explicitly describe it as an early signal. Do not claim the student has mastered a topic.",{metrics:plan.metrics,focusAreas:plan.focusAreas.slice(0,5)});
          if(insight&&typeof insight.message==="string"&&insight.message.trim()){
            aiInsight={headline:String(insight.headline||plan.headline).slice(0,100),message:String(insight.message).slice(0,260),tip:String(insight.tip||"").slice(0,200)};aiUsed=true;
          }
        }catch(e){log("coach-ai-fallback",e.message)}
      }
      return send(res,200,{...plan,aiInsight,aiUsed,aiConfigured:!!AKEY,demoWorkspace:!!user.is_demo,demoActivityNote:user.is_demo?"This private judge sandbox includes illustrative quiz activity based on the bundled lesson questions. It is not a real student's learning record.":null});
    }
    if(p[1]==="revision-radar"&&m==="GET"){
      const rows=db.prepare(`SELECT aa.lecture_id,l.title AS lecture_title,l.subject,aa.topic,aa.attempt_id,aa.question_id,aa.correct,aa.created
        FROM attempt_answers aa JOIN lectures l ON l.id=aa.lecture_id WHERE l.owner_id=? ORDER BY aa.created ASC`).all(user.id);
      const groups=new Map();
      for(const r of rows){const key=r.lecture_id+"\u0000"+r.topic;let g=groups.get(key);if(!g){g={lectureId:r.lecture_id,lectureTitle:r.lecture_title,subject:r.subject||"",topic:r.topic||"General",events:[],byAttempt:new Map()};groups.set(key,g)}
        g.events.push(r);let a=g.byAttempt.get(r.attempt_id);if(!a){a={correct:0,total:0,created:r.created};g.byAttempt.set(r.attempt_id,a)}a.total++;a.correct+=r.correct?1:0;
      }
      const topics=[...groups.values()].map(g=>{
        const totalAnswers=g.events.length,correctAnswers=g.events.reduce((n,x)=>n+(x.correct?1:0),0),accuracy=totalAnswers?Math.round(correctAnswers/totalAnswers*100):0;
        const attempts=[...g.byAttempt.values()].sort((a,b)=>a.created-b.created);let priority="Needs Practice";
        if(attempts.length>=2&&attempts.at(-1).correct/attempts.at(-1).total>attempts.at(-2).correct/attempts.at(-2).total)priority="Improving";
        else if(totalAnswers>=3&&accuracy>=80)priority="Strong";else if(totalAnswers>=2&&accuracy<50)priority="High Priority";
        const slideRows=db.prepare("SELECT n,title,status FROM slides WHERE lecture_id=? AND title=? ORDER BY n").all(g.lectureId,g.topic);
        return{lectureId:g.lectureId,lectureTitle:g.lectureTitle,subject:g.subject,topic:g.topic,answerCount:totalAnswers,correct:correctAnswers,incorrect:totalAnswers-correctAnswers,accuracy,attemptCount:attempts.length,lastPractice:Math.max(...g.events.map(x=>x.created)),priority,slides:slideRows.map(x=>({slideNumber:x.n,title:x.title,kind:x.status}))};
      });
      // Add a mapped topic card for each lesson section that has not been assessed yet.
      const unassessed=db.prepare(`SELECT l.id AS lecture_id,l.title AS lecture_title,l.subject,s.title AS topic,s.n AS slide_number,s.status AS section_status
        FROM slides s JOIN lectures l ON l.id=s.lecture_id WHERE l.owner_id=? ORDER BY l.created DESC,s.n`).all(user.id);
      for(const r of unassessed){const key=r.lecture_id+"\u0000"+r.topic;if(groups.has(key))continue;
        if(topics.some(t=>t.lectureId===r.lecture_id&&t.topic===r.topic))continue;
        topics.push({lectureId:r.lecture_id,lectureTitle:r.lecture_title,subject:r.subject||"",topic:r.topic,answerCount:0,correct:0,incorrect:0,accuracy:null,attemptCount:0,lastPractice:null,priority:"Not assessed",slides:[{slideNumber:r.slide_number,title:r.topic,kind:r.section_status}]});
      }
      topics.sort((a,b)=>(a.answerCount?0:1)-(b.answerCount?0:1)||(a.accuracy??101)-(b.accuracy??101)||a.lectureTitle.localeCompare(b.lectureTitle));
      const assessed=topics.filter(t=>t.answerCount>0),correct=assessed.reduce((n,t)=>n+t.correct,0),incorrect=assessed.reduce((n,t)=>n+t.incorrect,0);
      const summary={topicCount:topics.length,sufficientTopics:topics.filter(t=>t.answerCount>=3).length,needsRevision:assessed.filter(t=>t.priority==="Needs Practice"||t.priority==="High Priority").length,topicsPracticed:assessed.length};
      return send(res,200,{topics,summary,totalTopics:topics.length,answersRecorded:correct+incorrect,realAttemptData:true,demoWorkspace:!!user.is_demo,demoActivityNote:user.is_demo?"Illustrative walkthrough activity is included so the demo can show how topic insights work. It is not a real student's record.":null});
    }
    if(p[1]!=="lectures")throw new HttpError(404,"Not found");
    if(p.length===2){if(m==="GET")return send(res,200,db.prepare("SELECT id FROM lectures WHERE owner_id=? ORDER BY created DESC").all(user.id).map(r=>{const f=full(r.id);return{id:f.id,title:f.title,subject:f.subject,status:f.status,duration:f.isTextLesson?null:f.duration,hasMedia:f.hasMedia,isTextLesson:f.isTextLesson,sectionsFromTranscript:f.sectionsFromTranscript,created:f.created,segments:f.segments.length,slides:f.slides.length,notes:f.notes.length,questions:f.questions.length,attempts:db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE lecture_id=?").get(f.id).n}}));
      if(m==="POST"){const b=await body(req);const title=String(b.title||"").trim().slice(0,120),subject=String(b.subject||"").trim().slice(0,80),qc=Number(b.quizCount??5);
        if(!title)throw new HttpError(422,"title is required");if(!Number.isInteger(qc)||qc<1||qc>30)throw new HttpError(422,"quizCount must be an integer 1-30");
        const id=uid();db.prepare("INSERT INTO lectures(id,title,subject,quiz_count,created,owner_id) VALUES(?,?,?,?,?,?)").run(id,title,subject,qc,Date.now(),user.id);return send(res,201,{id})}
      throw new HttpError(405,"Method not allowed")}
    const id=lec(p[2]),sub=p[3];assertOwner(id,user);
    if(!sub){if(m==="GET")return send(res,200,full(id));
      if(m==="PATCH"){const b=await body(req);const t=String(b.title||"").trim().slice(0,120);if(!t)throw new HttpError(422,"title is required");db.prepare("UPDATE lectures SET title=? WHERE id=?").run(t,id);return send(res,200,{ok:true})}
      if(m==="DELETE"){if(isRunning(id))throw new HttpError(409,"Processing in progress");db.prepare("DELETE FROM lectures WHERE id=?").run(id);fs.rmSync(dir(id),{recursive:true,force:true});return send(res,200,{deleted:true})}}
    if(sub==="media"&&m==="PUT"||sub==="slides"&&m==="PUT"||sub==="transcript"&&m==="PUT"){const ext=(u.searchParams.get("ext")||"").toLowerCase();
      const [list,lim,base]=sub==="media"?[MEDIA_EXT,LIM.media,"media."]:sub==="slides"?[SLIDE_EXT,LIM.slides,"slides."]:[TR_EXT,LIM.transcript,"transcript."];
      if(isRunning(id))throw new HttpError(409,"Processing in progress");const tmp=await upload(req,id,list,ext,lim);
      if(sub==="transcript"){const cues=parseCues(fs.readFileSync(tmp,"utf8"));fs.rmSync(tmp,{force:true});if(!cues.length)throw new HttpError(422,"No valid cues found in transcript file");
        const bad=cues.filter(c=>validateSegment(c).length);if(bad.length)throw new HttpError(422,bad.length+" cues have invalid timestamps");
        db.prepare("DELETE FROM segments WHERE lecture_id=?").run(id);for(const c of cues)db.prepare("INSERT INTO segments VALUES(?,?,?,?,?,?,NULL,0)").run(uid(),id,c.startTime,c.endTime,c.text,"completed");
        db.prepare("UPDATE lectures SET transcript_source='user-supplied transcript file' WHERE id=?").run(id);return send(res,200,{segments:cues.length})}
      const final=path.join(dir(id),base+ext);for(const e of list)fs.rmSync(path.join(dir(id),base+e),{force:true});fs.renameSync(tmp,final);
      if(sub==="media"){let info;try{info=JSON.parse(await run("ffprobe",["-v","error","-print_format","json","-show_format","-show_streams",final]))}catch{fs.rmSync(final,{force:true});throw new HttpError(422,"File is not readable media")}
        if(!info.streams.some(s=>s.codec_type==="audio")){fs.rmSync(final,{force:true});throw new HttpError(422,"No audio stream found")}
        db.prepare("UPDATE lectures SET media_ext=?,duration=? WHERE id=?").run(ext,+info.format.duration||null,id);return send(res,200,{duration:+info.format.duration,video:info.streams.some(s=>s.codec_type==="video")})}
      try{const pdf=ext==="pdf"?final:null;if(pdf){const pg=/Pages:\s+(\d+)/.exec(await run("pdfinfo",[final]));db.prepare("UPDATE lectures SET slides_ext=? WHERE id=?").run(ext,id);return send(res,200,{pages:+pg[1]})}
        const z=fs.readFileSync(final).subarray(0,4).toString("hex");if(z!=="504b0304")throw new Error("not a pptx");db.prepare("UPDATE lectures SET slides_ext=? WHERE id=?").run(ext,id);return send(res,200,{pages:null,note:"slide count is determined during processing"})}
      catch{fs.rmSync(final,{force:true});throw new HttpError(422,"File is not a valid slide deck")}}
    if(sub==="process"&&m==="POST"){const l=db.prepare("SELECT * FROM lectures WHERE id=?").get(id);if(!l.media_ext)throw new HttpError(422,"Upload a lecture recording first");
      if(isRunning(id))throw new HttpError(409,"Already processing");process_(id);return send(res,202,{started:true})}
    if(sub==="analyse"&&m==="POST"){if(isRunning(id))throw new HttpError(409,"Already processing");await analyse(id);return send(res,200,{ok:true})}
    if(sub==="questions"&&m==="POST"&&p[5]==="explain"){
      const questionId=String(p[4]||"");
      if(!ID.test(questionId))throw new HttpError(404,"Question not found");
      const row=db.prepare("SELECT body FROM questions WHERE id=? AND lecture_id=?").get(questionId,id);
      if(!row)throw new HttpError(404,"Question not found");
      const q=JSON.parse(row.body),b=await body(req,12000);
      const studentAnswer=String(b.answer??"").trim().slice(0,1000);
      const correctAnswer=String(q.answer??"").trim();
      if(!correctAnswer)throw new HttpError(422,"This question has no verified answer to explain");
      const isCorrect=!!studentAnswer&&studentAnswer.toLowerCase()===correctAnswer.toLowerCase();
      if(isCorrect)throw new HttpError(422,"This answer is already correct; no mistake explanation is needed");
      const requestedIds=Array.isArray(q.segmentIds)?q.segmentIds.filter(x=>typeof x==="string").slice(0,8):[];
      const evidence=[];
      for(const segmentId of requestedIds){
        const seg=db.prepare("SELECT id,start,end,text,status FROM segments WHERE id=? AND lecture_id=? AND status='completed'").get(segmentId,id);
        if(seg)evidence.push({id:seg.id,startTime:seg.start,endTime:seg.end,text:seg.text});
      }
      const slide=q.slideId?db.prepare("SELECT id,n,title,text,has_image,status FROM slides WHERE id=? AND lecture_id=?").get(q.slideId,id):null;
      const lecture=db.prepare("SELECT title,transcript_source,media_ext FROM lectures WHERE id=? AND owner_id=?").get(id,user.id);
      const linkedTransition=slide?db.prepare("SELECT ts,source,confidence FROM transitions WHERE slide_id=? AND lecture_id=?").get(slide.id,id):null;
      const hasEvidence=evidence.length>0||!!String(slide?.text||"").trim();
      let explanation=String(q.explanation||"").trim();
      let keyPoint=hasEvidence?"Compare your answer with the cited passage and the explanation above.":"No transcript or slide text is linked to this question, so LectureLens cannot verify an explanation against the lecture.";
      let nextStep=hasEvidence?"Revisit the linked source, then try another question from this topic.":"Review the lecture material and check that this question has a source reference before relying on its explanation.";
      let aiUsed=false,aiConfigured=!!AKEY,aiNotice="";
      if(AKEY&&hasEvidence){
        try{
          const ai=await aiJSON(
            "You are LectureLens AI, a careful teaching assistant. Explain a student's incorrect or blank quiz answer using ONLY the supplied lecture evidence and verified answer. Do not guess why the student chose an answer or diagnose their ability. Do not add outside facts. If the cited lecture evidence does not adequately support the answer, say that clearly and set source_supports_answer to false. Return JSON with exactly these fields: {\"explanation\":string,\"key_point\":string,\"next_step\":string,\"source_supports_answer\":boolean}. Keep explanation to 2-4 beginner-friendly sentences, key_point to one concise sentence, next_step to one actionable sentence. Do not invent a timestamp, slide, quote, or citation.",
            {lectureTitle:lecture?.title||"Lecture",question:String(q.question||"").slice(0,1200),studentAnswer:studentAnswer||"Not answered",verifiedCorrectAnswer:correctAnswer.slice(0,500),existingQuestionExplanation:String(q.explanation||"").slice(0,1200),transcriptEvidence:evidence.map(x=>({text:x.text,startTime:x.startTime,endTime:x.endTime})),slideEvidence:slide?{slideNumber:slide.n,title:slide.title,text:String(slide.text||"").slice(0,3000)}:null}
          );
          if(ai&&typeof ai.explanation==="string"&&typeof ai.key_point==="string"&&typeof ai.next_step==="string"&&typeof ai.source_supports_answer==="boolean"){
            explanation=ai.explanation.slice(0,1600);keyPoint=ai.key_point.slice(0,500);nextStep=ai.next_step.slice(0,500);aiUsed=true;
            if(!ai.source_supports_answer)aiNotice="The AI could not fully verify the answer from the linked lecture text. Treat this explanation as incomplete and review the source.";
          }else aiNotice="The AI response did not match the required format; the source-based explanation is shown instead.";
        }catch(e){log("why-wrong-ai-fallback",e.message);aiNotice="AI explanation was unavailable; the verified question explanation and lecture evidence are shown instead."}
      }else if(!AKEY)aiNotice="AI provider is not configured. This explanation uses the question's saved explanation and linked lecture source.";
      const primary=evidence[0]||null;
      const canSeek=!!lecture?.media_ext&&!!primary;
      return send(res,200,{questionId,studentAnswer:studentAnswer||"Not answered",correctAnswer,isCorrect:false,explanation:explanation||"The saved question does not include a detailed explanation.",keyPoint,nextStep,aiUsed,aiConfigured,aiNotice,evidenceAvailable:hasEvidence,evidence:evidence.map(x=>({...x,displayTime:fmt(x.startTime)})),slide:slide?{id:slide.id,number:slide.n,title:slide.title,text:slide.text,hasImage:!!slide.has_image}:null,section:slide?.status==="transcript_section",reference:primary?{segmentId:primary.id,timestamp:primary.startTime,displayTime:fmt(primary.startTime),slideId:slide?.id||null,slideNumber:slide?.n??null,slideTitle:slide?.title||null,canSeek,timingSource:linkedTransition?.source||"transcript segment"}:null,slideTimestamp:linkedTransition?.ts??null,slideTimingSource:linkedTransition?.source||null,lectureTitle:lecture?.title||"Lecture",textLesson:!lecture?.media_ext});
    }
    if(sub==="revision"&&m==="GET"){
      const topic=String(u.searchParams.get("topic")||"").trim();if(!topic)throw new HttpError(422,"topic is required");
      const f=full(id),slide=f.slides.find(x=>x.title===topic)||f.slides.find(x=>f.questions.some(q=>q.topic===topic&&q.slideId===x.id))||null;
      // Topic labels can come from a quiz question rather than a slide title.
      // Resolve both forms so Revision Radar and Learning Coach can open the same source.
      const questions=f.questions.filter(q=>(slide&&q.slideId===slide.id)||q.topic===topic);
      if(!slide&&!questions.length)throw new HttpError(404,"No saved lecture section or quiz questions were found for this topic yet.");
      const answers=db.prepare("SELECT correct,created FROM attempt_answers WHERE lecture_id=? AND topic=? ORDER BY created").all(id,topic);
      const correct=answers.filter(a=>a.correct).length,total=answers.length;
      const segIds=new Set(questions.flatMap(q=>q.segmentIds||[]));
      const segs=f.segments.filter(s=>segIds.has(s.id));
      const notes=f.notes.filter(n=>(slide&&n.slideId===slide.id)||questions.some(q=>q.slideId&&q.slideId===n.slideId));
      const relatedSlides=slide?[slide]:[...new Map(questions.map(q=>f.slides.find(x=>x.id===q.slideId)).filter(Boolean).map(x=>[x.id,x])).values()];
      return send(res,200,{topic,lecture:{id:f.id,title:f.title,subject:f.subject},questions,performance:{answerCount:total,correct,incorrect:total-correct,accuracy:total?Math.round(correct/total*100):null,priority:total?(correct/total<0.5?"High priority":"Needs practice"):"Not assessed"},references:{slides:relatedSlides.map(x=>({id:x.id,slideNumber:x.slideNumber,title:x.title})),segments:segs.map(s=>({id:s.id,startTime:s.startTime,endTime:s.endTime,text:s.text})),notes:notes.map(n=>({id:n.id,startTime:n.startTime,text:n.text,type:n.type}))}});
    }
    if(sub==="media"&&m==="GET"){const l=db.prepare("SELECT media_ext FROM lectures WHERE id=?").get(id),f=path.join(dir(id),"media."+l.media_ext);if(!l.media_ext||!fs.existsSync(f))throw new HttpError(404,"No media");
      const size=fs.statSync(f).size,r=/bytes=(\d*)-(\d*)/.exec(req.headers.range||"");let s=0,e=size-1;if(r){s=r[1]?+r[1]:size-+r[2];e=r[1]&&r[2]?+r[2]:e}
      if(s>e||s>=size){res.writeHead(416,{"content-range":"bytes */"+size});return res.end()}
      res.writeHead(r?206:200,{"content-type":MIME[l.media_ext],"accept-ranges":"bytes","content-length":e-s+1,...(r?{"content-range":`bytes ${s}-${e}/${size}`}:{})});return fs.createReadStream(f,{start:s,end:e}).pipe(res)}
    if(sub==="slide-image"&&m==="GET"){const n=+p[4];const f=fs.existsSync(dir(id))&&fs.readdirSync(dir(id)).find(x=>new RegExp(`^slide-0*${n}\\.png$`).test(x));if(!Number.isInteger(n)||!f)throw new HttpError(404,"No image");
      res.writeHead(200,{"content-type":"image/png"});return res.end(fs.readFileSync(path.join(dir(id),f)))}
    if(sub==="transitions"&&m==="PATCH"){const b=await body(req),slideId=p[4];const s=db.prepare("SELECT 1 FROM slides WHERE id=? AND lecture_id=?").get(slideId,id);if(!s)throw new HttpError(404,"Slide not found");
      const l=db.prepare("SELECT duration FROM lectures WHERE id=?").get(id);const t=b.timestamp===null?null:Number(b.timestamp);if(t!==null&&(!Number.isFinite(t)||t<0||(l.duration&&t>l.duration)))throw new HttpError(422,"timestamp must be within the recording");
      db.prepare("UPDATE transitions SET ts=?,source='manual correction',confidence=1,evidence='[]' WHERE slide_id=?").run(t,slideId);return send(res,200,{ok:true})}
    if(sub==="segments"&&m==="PATCH"){const b=await body(req),text=typeof b.text==="string"?b.text.trim().slice(0,5000):"";if(!text)throw new HttpError(422,"text is required");
      const r=db.prepare("UPDATE segments SET text=?,edited=1,status='completed' WHERE id=? AND lecture_id=?").run(text,p[4],id);if(!r.changes)throw new HttpError(404,"Segment not found");return send(res,200,{ok:true})}
    if(sub==="attempts"&&m==="POST"){const b=await body(req);const allQuestions=full(id).questions;let qs=allQuestions;
      if(b.questionIds!==undefined){
        if(!Array.isArray(b.questionIds)||!b.questionIds.length||b.questionIds.length>allQuestions.length)throw new HttpError(422,"questionIds must be a non-empty list of questions from this lecture");
        const requested=b.questionIds.map(x=>String(x)),unique=new Set(requested),known=new Set(allQuestions.map(q=>q.id));
        if(unique.size!==requested.length||requested.some(x=>!known.has(x)))throw new HttpError(422,"questionIds contains a duplicate or unknown question");
        qs=allQuestions.filter(q=>unique.has(q.id));
      }
      const ans=b.answers&&typeof b.answers==="object"&&!Array.isArray(b.answers)?b.answers:null;if(!ans)throw new HttpError(422,"answers object required");
      const attemptId=uid(),created=Date.now();let score=0;
      const detail=qs.map(q=>{const raw=ans[q.id],a=raw==null?"":String(raw).trim().slice(0,1000),ok=a!==""&&a.toLowerCase()===String(q.answer).trim().toLowerCase();if(ok)score++;
        const slide= q.slideId ? db.prepare("SELECT title,n FROM slides WHERE id=? AND lecture_id=?").get(q.slideId,id) : null;
        const topic=String(slide?.title||q.topic||full(id).subject||"General").trim().slice(0,160)||"General";
        return{id:q.id,correct:ok,answer:q.answer,explanation:q.explanation,topic,slideId:q.slideId||null,studentAnswer:a};});
      db.prepare("INSERT INTO attempts VALUES(?,?,?,?,?)").run(attemptId,id,score,qs.length,created);
      const ins=db.prepare("INSERT INTO attempt_answers(id,attempt_id,lecture_id,question_id,topic,slide_id,answer,correct,created) VALUES(?,?,?,?,?,?,?,?,?)");
      for(const d of detail)ins.run(uid(),attemptId,id,d.id,d.topic,d.slideId,d.studentAnswer,d.correct?1:0,created);
      return send(res,201,{attemptId,score,total:qs.length,created,detail})}
    if(sub==="attempts"&&m==="GET")return send(res,200,db.prepare("SELECT a.score,a.total,a.created,EXISTS(SELECT 1 FROM demo_preview_attempts d WHERE d.attempt_id=a.id) AS demoPreview FROM attempts a WHERE a.lecture_id=? ORDER BY a.created DESC").all(id).map(a=>({...a,demoPreview:!!a.demoPreview})));
    if(sub==="export"&&m==="GET"){const f=full(id),fmtq=u.searchParams.get("format");const sl=n=>f.slides.find(s=>s.id===n)?.slideNumber??"?";
      if(fmtq==="json"){res.writeHead(200,{"content-type":"application/json","content-disposition":'attachment; filename="transcript.json"'});return res.end(JSON.stringify({lectureId:f.id,title:f.title,transcriptSource:f.transcriptSource,segments:f.segments},null,2))}
      if(fmtq==="txt"){res.writeHead(200,{"content-type":"text/plain; charset=utf-8","content-disposition":'attachment; filename="transcript.txt"'});return res.end(f.segments.map(s=>s.processingStatus==="completed"?`[${fmt(s.startTime)}] ${s.text}`:`[${fmt(s.startTime)}-${fmt(s.endTime)}] [TRANSCRIPTION FAILED]`).join("\n"))}
      if(fmtq==="quiz"){res.writeHead(200,{"content-type":"application/json","content-disposition":'attachment; filename="quiz.json"'});return res.end(JSON.stringify(f.questions,null,2))}
      if(fmtq==="md"){res.writeHead(200,{"content-type":"text/markdown; charset=utf-8","content-disposition":'attachment; filename="notes.md"'});
        const aiNotes=f.notes.some(n=>String(n.source||"").startsWith("AI-generated"));const noteMethod=aiNotes?"Some explanations were AI-generated from the cited lecture transcript and slide text. AI output can be imperfect; verify important details against the source passages.":"Notes are extractive (copied or grouped from transcript and slide text); AI-written explanations were not generated.";return res.end(`# ${f.title}\n\n${noteMethod} Transcript source: ${f.transcriptSource||"none"}.\n\n`+f.notes.map(n=>`## ${fmt(n.startTime)} · slide ${sl(n.slideId)} · ${n.type}\nSource: ${n.source||"lecture material"}\n${n.text}\n`).join("\n"))}
      throw new HttpError(422,"format must be md, txt, json or quiz")}
    throw new HttpError(404,"Not found")}
  catch(e){if(e instanceof HttpError)return send(res,e.code,{error:e.message},e.headers);log("unhandled",e);send(res,500,{error:"Internal error"})}});
const process_=id=>{processLecture(id)};
if(import.meta.url===pathToFileURL(globalThis.process.argv[1]).href)server.listen(PORT,()=>log("LectureLens on http://localhost:"+PORT));
/** Close the shared SQLite connection after the HTTP server has stopped.
 * Avoid DatabaseSync.isOpen here: it is not available in every supported
 * Node 22 minor release (the project supports Node >=22.13).
 */
let databaseClosed = false;
export function closeDatabase() {
  if (databaseClosed) return;
  db.close();
  databaseClosed = true;
}

export {server};
