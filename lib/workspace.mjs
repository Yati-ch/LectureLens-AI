import crypto from "node:crypto";
import fs from "node:fs";
import { STARTER_LESSONS } from "./starter-lessons.mjs";

/** Starter content and judge-demo account lifecycle. All seeded data is labelled as curated/illustrative. */
export function createWorkspaceService({ db, path, uid, setStage, dir, full, demoEmail, demoEnabled }) {
function seedStarterWorkspace(ownerId){
  let offset=0;
  for(const lesson of STARTER_LESSONS){
    if(db.prepare("SELECT 1 FROM lectures WHERE title=? AND owner_id=?").get(lesson.title,ownerId))continue;
    const id=uid(),created=Date.now()-offset;
offset+=1000;
    const duration=lesson.segments.at(-1)?.[1]||0;
    db.prepare("INSERT INTO lectures(id,title,subject,quiz_count,status,duration,has_video,media_ext,transcript_source,created,owner_id) VALUES(?,?,?,?,?, ?,0,NULL,?,?,?)")
      .run(id,lesson.title,lesson.subject,lesson.questions.length,"completed",duration,"curated lesson text",created,ownerId);
    const stages={
      verify:"Lesson content ready",inspect:"Text-based lesson; no recording attached",slides:`${lesson.slides.length} lesson sections`,
      transcribe:"Curated lesson passages",align:"Section markers linked to lesson sections",notes:"Structured notes prepared from lesson content",
      quiz:`${lesson.questions.length} source-linked practice questions`,validate:"Lesson content checked"
    };
    for(const [stage,msg] of Object.entries(stages))setStage(id,stage,"done",msg);
    const slideIds=lesson.slides.map((sl,n)=>{
      const sid=uid();db.prepare("INSERT INTO slides VALUES(?,?,?,?,?,0,'completed')").run(sid,id,n+1,sl.title,sl.text);return sid;
    });
    const segmentIds=lesson.segments.map(([start,end,text])=>{const sid=uid();db.prepare("INSERT INTO segments VALUES(?,?,?,?,?,?,NULL,0)").run(sid,id,start,end,text,"completed");return sid;});
    lesson.slides.forEach((sl,n)=>{
      const first=sl.segments[0],sid=slideIds[n],segId=segmentIds[first],time=lesson.segments[first][0];
      db.prepare("INSERT INTO transitions VALUES(?,?,?,?,?,?)").run(sid,id,time,"curated section marker",0.95,JSON.stringify([{segmentId:segId,time,terms:[]} ]));
      const ids=sl.segments.map(i=>segmentIds[i]);
      const sourceText=sl.segments.map(i=>lesson.segments[i][2]).join(" ");
      const noteText=`${sl.title}\n\n${sl.text}\n\n${sourceText}`;
      db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?)").run(uid(),id,"section",time,sid,"curated lesson text",JSON.stringify(ids),noteText);
    });
    lesson.questions.forEach(q=>{
      const slideId=slideIds[q.slide],segmentId=segmentIds[q.segment],time=lesson.segments[q.segment][0];
      const body={type:"mc",question:q.question,options:q.options,answer:q.answer,explanation:q.explanation,startTime:time,slideId,segmentIds:[segmentId],topic:lesson.slides[q.slide].title};
      db.prepare("INSERT INTO questions VALUES(?,?,?)").run(uid(),id,JSON.stringify(body));
    });
  }
}
async function ensureStarterWorkspace(ownerId){
  const user=db.prepare("SELECT workspace_seeded FROM users WHERE id=?").get(ownerId);
  if(!user)return;
  // Remove only legacy placeholder-audio lessons created by the previous starter-data button.
  const legacy=db.prepare("SELECT id FROM lectures WHERE owner_id=? AND COALESCE(transcript_source,'') LIKE 'SAMPLE DATA%'").all(ownerId);
  for(const row of legacy){db.prepare("DELETE FROM lectures WHERE id=?").run(row.id);
fs.rmSync(dir(row.id),{recursive:true,force:true});
}
  if(user.workspace_seeded)return;
  const hasOwnContent=!!db.prepare("SELECT 1 FROM lectures WHERE owner_id=? LIMIT 1").get(ownerId);
  if(!hasOwnContent)seedStarterWorkspace(ownerId);
  db.prepare("UPDATE users SET workspace_seeded=1 WHERE id=?").run(ownerId);
}
function seedDemoQuizHistory(ownerId){
  const lesson=db.prepare("SELECT id FROM lectures WHERE owner_id=? AND title=?").get(ownerId,"Operating Systems: CPU Scheduling");
  if(!lesson)return;
  const exists=db.prepare("SELECT 1 FROM demo_preview_attempts d JOIN attempts a ON a.id=d.attempt_id WHERE a.lecture_id=? LIMIT 1").get(lesson.id);
  if(exists)return;
  const questions=full(lesson.id).questions;
  if(questions.length<5)return;
  const insertAnswer=db.prepare("INSERT INTO attempt_answers(id,attempt_id,lecture_id,question_id,topic,slide_id,answer,correct,created) VALUES(?,?,?,?,?,?,?,?,?)");
  const record=(questionIndexes,correctIndexes,created)=>{
    const selected=questionIndexes.map(i=>questions[i]).filter(Boolean);
    if(!selected.length)return;
    const attemptId=uid(),correctSet=new Set(correctIndexes),score=questionIndexes.filter(i=>correctSet.has(i)).length;
    db.prepare("INSERT INTO attempts VALUES(?,?,?,?,?)").run(attemptId,lesson.id,score,selected.length,created);
    db.prepare("INSERT INTO demo_preview_attempts(attempt_id) VALUES(?)").run(attemptId);
    selected.forEach((q,position)=>{
      const index=questionIndexes[position],isCorrect=correctSet.has(index);
      const slide=q.slideId?db.prepare("SELECT title FROM slides WHERE id=? AND lecture_id=?").get(q.slideId,lesson.id):null;
      const options=Array.isArray(q.options)?q.options:[];
      const response=isCorrect?String(q.answer):String(options.find(x=>String(x)!==String(q.answer))||"Not sure yet");
      insertAnswer.run(uid(),attemptId,lesson.id,q.id,String(slide?.title||q.topic||"General"),q.slideId||null,response,isCorrect?1:0,created);
    });
  };
  // Clearly labelled illustrative walkthrough activity: every answer is tied to a real
  // question and answer option in the bundled curated lesson, not a real student record.
  const now=Date.now();
  db.exec("BEGIN IMMEDIATE");
  try{
    record([0,1,2,3,4],[0,2],now-86400000);
    record([1,3],[1],now-3600000);
    db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");
throw e;
}
}
const SANDBOX_DOMAIN="demo.lecturelens.local";
const SANDBOX_TTL_MS=(Number(process.env.DEMO_SANDBOX_TTL_HOURS)||24)*3600*1000;
const SANDBOX_MAX=Number(process.env.DEMO_SANDBOX_MAX)||300;
function deleteDemoUser(userId){
  for(const row of db.prepare("SELECT id FROM lectures WHERE owner_id=?").all(userId))fs.rmSync(dir(row.id),{recursive:true,force:true});
  db.prepare("DELETE FROM lectures WHERE owner_id=?").run(userId);
  db.prepare("DELETE FROM users WHERE id=? AND is_demo=1").run(userId);
}
/** Remove expired sandboxes and cap the total so a busy demo cannot fill the disk. */
function pruneDemoSandboxes({maxAgeMs=SANDBOX_TTL_MS,maxSandboxes=SANDBOX_MAX}={}){
  const like=`%@${SANDBOX_DOMAIN}`;
  const stale=db.prepare("SELECT id FROM users WHERE is_demo=1 AND email LIKE ? AND created<?").all(like,Date.now()-maxAgeMs);
  const overflow=db.prepare("SELECT id FROM users WHERE is_demo=1 AND email LIKE ? ORDER BY created DESC LIMIT -1 OFFSET ?").all(like,maxSandboxes);
  const ids=new Set([...stale,...overflow].map(r=>r.id));
  for(const id of ids)deleteDemoUser(id);
  return ids.size;
}
/** Every judge gets a private, freshly seeded account that expires automatically. */
function createDemoSandbox(){
  if(!demoEnabled)return null;
  pruneDemoSandboxes();
  const id=uid(),salt=crypto.randomBytes(16).toString("hex"),secret=crypto.randomBytes(32).toString("hex"),digest=crypto.scryptSync(secret,salt,64).toString("hex");
  const email=`judge-${crypto.randomBytes(6).toString("hex")}@${SANDBOX_DOMAIN}`;
  db.prepare("INSERT INTO users(id,email,name,password_hash,created,is_demo,workspace_seeded) VALUES(?,?,?,?,?,1,1)").run(id,email,"Judge Demo",`${salt}:${digest}`,Date.now());
  try{seedStarterWorkspace(id);seedDemoQuizHistory(id);}
  catch(e){deleteDemoUser(id);throw e;}
  return {id,email,name:"Judge Demo"};
}
function isDemoSandboxEmail(email){return String(email||"").toLowerCase().endsWith("@"+SANDBOX_DOMAIN);}
  return { seedStarterWorkspace, ensureStarterWorkspace, seedDemoQuizHistory, createDemoSandbox, pruneDemoSandboxes, isDemoSandboxEmail, SANDBOX_TTL_MS };
}
