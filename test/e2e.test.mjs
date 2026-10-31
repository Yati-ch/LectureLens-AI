import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"ls-"));
process.env.DATA_DIR=path.join(tmp,"data");
delete process.env.TRANSCRIPTION_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.EMBEDDINGS_API_KEY;
const {server,closeDatabase}=await import("../server.mjs");
await new Promise(r=>server.listen(0,r));
const B="http://localhost:"+server.address().port;
let cookie="";
const api=async(p,o={})=>{const headers={...(o.headers||{})};
if(cookie)headers.cookie=cookie;
const r=await fetch(B+p,{...o,headers});
const sc=r.headers.get("set-cookie");
if(sc)cookie=sc.split(";")[0];
const t=await r.text();
let j;
try{j=JSON.parse(t)}catch{j=t}return{s:r.status,j,h:r.headers}};
const jpost=(p,b,m="POST")=>api(p,{method:m,headers:{"content-type":"application/json"},body:JSON.stringify(b)});
// fixtures: FIXTURE audio is a sine tone (not speech); transcript is a hand-written test VTT standing in for a user-supplied file
execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=440:duration=60","-y",path.join(tmp,"a.mp3")]);
// Use a committed, tiny PPTX fixture so the test suite does not require Python
// or python-pptx on the developer's machine (including Windows).
fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),"fixtures","slides.pptx"),path.join(tmp,"s.pptx"));
fs.writeFileSync(path.join(tmp,"t.vtt"),`WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nPhotosynthesis happens in the chloroplast using light energy\n\n00:00:10.000 --> 00:00:20.000\nThe chloroplast is where light becomes chemical energy\n\n00:00:20.000 --> 00:00:35.000\nNow the Calvin cycle performs carbon fixation with the enzyme rubisco\n`);
const put=(id,k,ext,f)=>api(`/api/lectures/${id}/${k}?ext=${ext}`,{method:"PUT",body:fs.readFileSync(f)});
const wait=async id=>{for(let i=0;i<120;i++){const r=await api("/api/lectures/"+id);
if(r.j.status!=="processing")return r.j;
await new Promise(r=>setTimeout(r,500))}throw new Error("timeout")};
test.after(async()=>{await new Promise(resolve=>server.close(resolve));closeDatabase();fs.rmSync(tmp,{recursive:true,force:true})});
const signup=await api("/api/auth/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Test Student",email:"student@example.com",password:"StrongPass123"})});
if(signup.s!==201)throw new Error("Test student signup failed: "+JSON.stringify(signup.j));
let id;
test("validation and safety",async()=>{assert.equal((await jpost("/api/lectures",{})).s,422);assert.equal((await jpost("/api/lectures",{title:"x",quizCount:99})).s,422);
 id=(await jpost("/api/lectures",{title:"Bio 101",subject:"Biology",quizCount:5})).j.id;
 assert.equal((await api(`/api/lectures/${id}/media?ext=exe`,{method:"PUT",body:"x"})).s,415);
 assert.equal((await api(`/api/lectures/${id}/media?ext=mp3`,{method:"PUT",body:"not media"})).s,422);
 assert.equal((await api(`/api/lectures/${id}/slides?ext=pdf`,{method:"PUT",body:"not pdf"})).s,422);
 assert.equal((await api("/api/lectures/..%2f..%2fetc")).s,404);assert.equal((await api("/api/lectures/"+"0".repeat(36))).s,404);
 assert.equal((await api(`/api/lectures/${id}/process`,{method:"POST"})).s,422)});
test("upload, process without transcript → needs_transcript, slides kept, nothing fabricated",async()=>{
 const m=await put(id,"media","mp3",path.join(tmp,"a.mp3"));assert.equal(m.s,200);assert.ok(Math.abs(m.j.duration-60)<1);assert.equal(m.j.video,false);
 assert.equal((await put(id,"slides","pptx",path.join(tmp,"s.pptx"))).s,200);
 assert.equal((await api(`/api/lectures/${id}/process`,{method:"POST"})).s,202);const l=await wait(id);
 assert.equal(l.status,"needs_transcript");assert.equal(l.slides.length,3);assert.ok(l.slides.every(s=>s.hasImage&&s.text));assert.equal(l.segments.length,0);assert.equal(l.notes.length,0);assert.equal(l.stages.transcribe.state,"blocked");
 assert.equal((await api(`/api/lectures/${id}/slide-image/1`)).s,200)});
test("with supplied transcript: align, notes, quiz, report, persistence of manual edits",async()=>{
 assert.equal((await put(id,"transcript","vtt",path.join(tmp,"t.vtt"))).j.segments,3);
 await api(`/api/lectures/${id}/process`,{method:"POST"});const l=await wait(id);assert.equal(l.status,"completed_with_warnings");assert.equal(l.transcriptSource,"user-supplied transcript file");
 const t=Object.fromEntries(l.transitions.map(x=>[l.slides.find(s=>s.id===x.slideId).slideNumber,x]));
 assert.equal(t[1].timestamp,0);assert.equal(t[2].timestamp,20);assert.equal(t[3].timestamp,null);assert.match(t[1].source,/audio-only/);
 assert.ok(l.notes.length>=2&&l.notes.every(n=>n.segmentIds.length));assert.equal(l.questions.length,0,"without a working AI provider, do not fabricate cloze questions");assert.equal(l.report.uncertainTransitions,1);assert.equal(l.report.segmentsCompleted,3);assert.match(l.stages.align.msg,/Text-overlap fallback/);assert.match(l.report.alignmentMode,/text-overlap fallback/);
 // manual correction survives re-analysis
 assert.equal((await jpost(`/api/lectures/${id}/transitions/${l.slides[2].id}`,{timestamp:45},"PATCH")).s,200);assert.equal((await jpost(`/api/lectures/${id}/transitions/${l.slides[2].id}`,{timestamp:9999},"PATCH")).s,422);
 await api(`/api/lectures/${id}/analyse`,{method:"POST"});const l2=(await api("/api/lectures/"+id)).j;const s3=l2.transitions.find(x=>x.slideId===l.slides[2].id);assert.equal(s3.timestamp,45);assert.equal(s3.source,"manual correction");
 // transcript correction
 assert.equal((await jpost(`/api/lectures/${id}/segments/${l.segments[0].id}`,{text:"Corrected text"},"PATCH")).s,200);assert.equal((await api("/api/lectures/"+id)).j.segments[0].edited,true)});
test("range requests, exports, quiz attempts",async()=>{
 const r=await api(`/api/lectures/${id}/media`,{headers:{range:"bytes=0-99"}});assert.equal(r.s,206);assert.match(r.h.get("content-range"),/^bytes 0-99\//);
 const md=(await api(`/api/lectures/${id}/export?format=md`)).j;assert.match(md,/extractive/);assert.match(md,/Corrected text|chloroplast/);
 assert.match((await api(`/api/lectures/${id}/export?format=txt`)).j,/\[00:00\]/);assert.equal((await api(`/api/lectures/${id}/export?format=pdf`)).s,422);
 const q=(await api("/api/lectures/"+id)).j.questions;const a=await jpost(`/api/lectures/${id}/attempts`,{answers:Object.fromEntries(q.map(x=>[x.id,x.answer]))});assert.equal(a.j.score,q.length);
 assert.equal((await jpost(`/api/lectures/${id}/attempts`,{answers:{}})).j.score,0);assert.equal((await api(`/api/lectures/${id}/attempts`)).j.length,2);
 const radar=await api("/api/revision-radar");assert.equal(radar.s,200);assert.equal(radar.j.realAttemptData,true);assert.equal(radar.j.answersRecorded,q.length*2);assert.ok(radar.j.topics.length>0);const assessed=radar.j.topics.filter(t=>t.answerCount>0);assert.ok(assessed.every(t=>t.accuracy>=0&&t.accuracy<=100));assert.ok(radar.j.topics.some(t=>t.priority==="Not assessed"));});
test("no-AI fallback does not create unsupported grammar-style quiz questions",async()=>{
 const lesson=(await api(`/api/lectures/${id}`)).j;
 assert.equal(lesson.questions.length,0,"without a working AI provider, no misleading cloze quiz should be created");
});

test("recording-only upload needs no slides and creates transcript-derived sections, notes and quiz",async()=>{
 const newId=(await jpost("/api/lectures",{title:"Photosynthesis lecture without slides",subject:"Biology",quizCount:5})).j.id;
 assert.equal((await put(newId,"media","mp3",path.join(tmp,"a.mp3"))).s,200);
 assert.equal((await put(newId,"transcript","vtt",path.join(tmp,"t.vtt"))).s,200);
 assert.equal((await api(`/api/lectures/${newId}/process`,{method:"POST"})).s,202);
 const lesson=await wait(newId);
 assert.equal(lesson.status,"completed");
 assert.equal(lesson.slides.length,1,"a transcript-only recording should get one generated section for this short fixture");
 assert.equal(lesson.slides[0].processingStatus,"transcript_section");
 assert.match(lesson.transitions[0].source,/^transcript_section_marker/);
 assert.match(lesson.report.alignmentMode,/transcript-derived lecture sections/);
 assert.ok(lesson.notes.length>0,"notes should be generated without a presentation deck");
 assert.equal(lesson.questions.length,0,"without a working AI provider, no misleading cloze quiz should be created");
 const radar=(await api("/api/revision-radar")).j;
 assert.ok(radar.topics.some(t=>t.lectureId===newId&&t.answerCount===0),"Revision Radar should list transcript-derived topics as not yet assessed");
 assert.equal((await api(`/api/lectures/${newId}`,{method:"DELETE"})).s,200,"remove this isolated fixture before the remaining workspace tests");
});

test("delete removes rows and managed files",async()=>{const d=path.join(process.env.DATA_DIR,"files",id);assert.ok(fs.existsSync(d));assert.equal((await api("/api/lectures/"+id,{method:"DELETE"})).s,200);assert.ok(!fs.existsSync(d));assert.equal((await api("/api/lectures/"+id)).s,404)});
test("starter learning workspace is preloaded on signup without placeholder media or fake progress",async()=>{
 const list=(await api("/api/lectures")).j;assert.equal(list.length,3);
 assert.deepEqual(list.map(x=>x.title).sort(),["Database Systems: Relational Model and SQL","JavaScript: Asynchronous Programming","Operating Systems: CPU Scheduling"].sort());
 for(const item of list){
   const l=(await api("/api/lectures/"+item.id)).j;assert.equal(l.status,"completed");assert.equal(l.isTextLesson,true);assert.equal(l.hasMedia,false);assert.equal(l.transcriptSource,"curated lesson text");
   assert.equal(l.report.segmentsFailed,0);assert.equal(l.slides.length,5);assert.equal(l.segments.length,10);assert.equal(l.notes.length,5);assert.equal(l.questions.length,5);
   assert.ok(l.transitions.every(t=>t.timestamp!==null&&t.source==="curated section marker"));
   assert.equal((await api(`/api/lectures/${item.id}/media`,{headers:{range:"bytes=0-9"}})).s,404);
 }
 assert.equal((await api("/api/sample",{method:"POST"})).s,404,"old sample-data endpoint must be removed");
 const radar=(await api("/api/revision-radar")).j;assert.equal(radar.answersRecorded,0);assert.ok(radar.topics.length>=15);assert.ok(radar.topics.every(t=>t.priority==="Not assessed"&&t.accuracy===null));
 const os=list.find(x=>x.title.startsWith("Operating Systems"));const focus=await api(`/api/lectures/${os.id}/revision?topic=${encodeURIComponent("Processes and threads")}`);assert.equal(focus.s,200);assert.equal(focus.j.questions.length,1);assert.equal(focus.j.performance.accuracy,null);assert.equal(focus.j.lecture.title,os.title);assert.ok(Array.isArray(focus.j.references.slides));
});

test("learning coach uses saved quiz answers and keeps unassessed topics honest",async()=>{
 const before=await api("/api/learning-coach");assert.equal(before.s,200);assert.equal(before.j.metrics.answersRecorded,0);
 assert.equal(before.j.metrics.overallAccuracy,null);assert.ok(before.j.metrics.topicCount>=15);
 assert.ok(before.j.focusAreas.every(t=>t.accuracy===null&&t.priority==="Not assessed"));
 assert.ok(before.j.tasks.length>0&&before.j.tasks.every(t=>t.kind==="baseline"));
 const list=(await api("/api/lectures")).j,os=list.find(x=>x.title.startsWith("Operating Systems"));
 const focus=await api(`/api/lectures/${os.id}/revision?topic=${encodeURIComponent("Processes and threads")}`);assert.equal(focus.s,200);assert.ok(focus.j.questions.length);assert.equal(focus.j.lecture.title,os.title);
 const q=focus.j.questions[0];const attempt=await jpost(`/api/lectures/${os.id}/attempts`,{questionIds:focus.j.questions.map(x=>x.id),answers:{[q.id]:"an intentionally incorrect answer"}});assert.equal(attempt.s,201);assert.equal(attempt.j.total,focus.j.questions.length);
 const after=await api("/api/learning-coach");assert.equal(after.s,200);assert.equal(after.j.metrics.answersRecorded,focus.j.questions.length);
 const assessed=after.j.focusAreas.find(t=>t.topic==="Processes and threads");
 assert.equal(assessed.answerCount,focus.j.questions.length);assert.equal(assessed.accuracy,0);assert.equal(assessed.priority,focus.j.questions.length===1?"Early signal":"High priority");
 assert.ok(after.j.tasks.some(t=>t.topic==="Processes and threads"));
 assert.equal(after.j.focusAreas.filter(t=>t.answerCount>0).length,1,"a focused quiz must not mark unrelated topics incorrect");
});

test("student accounts are isolated",async()=>{
 const originalCookie=cookie;
 const second=await api("/api/auth/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Other Student",email:"other@example.com",password:"AnotherPass123"})});
 assert.equal(second.s,201);assert.equal((await api("/api/lectures")).j.length,3);const privateLecture=(await jpost("/api/lectures",{title:"Private lecture",subject:"Private",quizCount:5})).j.id;
 cookie=originalCookie;
 assert.equal((await api("/api/lectures/"+privateLecture)).s,404);
 assert.equal((await api("/api/lectures/"+privateLecture,{method:"DELETE"})).s,404);
 const list=(await api("/api/lectures")).j;assert.ok(!list.some(x=>x.id===privateLecture));
 cookie=second.h.get("set-cookie")?.split(";")[0]||cookie;
 assert.equal((await api("/api/lectures/"+privateLecture)).s,200);
 cookie=originalCookie;
});

test("authentication lifecycle: protected routes, invalid login, logout, and session revocation",async()=>{
 const signedInCookie=cookie;
 cookie="";
 assert.equal((await api("/api/lectures")).s,401,"lecture list must require a session");
 assert.equal((await jpost("/api/auth/login",{email:"student@example.com",password:"wrong-password"})).s,401,"invalid credentials must be rejected");
 const login=await jpost("/api/auth/login",{email:"student@example.com",password:"StrongPass123"});
 assert.equal(login.s,200,"valid credentials should sign in");
 assert.ok(login.h.get("set-cookie")?.includes("HttpOnly"),"session cookie must be HttpOnly");
 const activeCookie=cookie;
 assert.equal((await api("/api/lectures")).s,200,"signed-in student should access their library");
 assert.equal((await api("/api/auth/logout",{method:"POST"})).s,200,"logout should succeed");
 cookie="";
 assert.equal((await api("/api/lectures")).s,401,"logged-out session must not access protected routes");
 cookie=signedInCookie;
});


test("one-click judge demo opens a preloaded, clearly disclosed workspace",async()=>{
 const originalCookie=cookie;cookie="";
 const entry=await jpost("/api/auth/demo",{});
 assert.equal(entry.s,200);assert.equal(entry.j.user.isDemo,true);
 assert.ok(entry.h.get("set-cookie")?.includes("HttpOnly"));
 const me=(await api("/api/auth/me")).j;assert.equal(me.user.isDemo,true);assert.equal(me.user.name,"Judge Demo");
 const list=(await api("/api/lectures")).j;assert.equal(list.length,3);
 const os=list.find(x=>x.title.startsWith("Operating Systems"));assert.ok(os);
 const lesson=(await api(`/api/lectures/${os.id}`)).j;assert.equal(lesson.questions.length,5);assert.equal(lesson.notes.length,5);assert.equal(lesson.isTextLesson,true);
 const history=(await api(`/api/lectures/${os.id}/attempts`)).j;assert.equal(history.length,2);assert.ok(history.every(a=>a.demoPreview===true));
 const coach=(await api("/api/learning-coach")).j;assert.equal(coach.demoWorkspace,true);assert.match(coach.demoActivityNote,/not a real student's learning record/i);assert.equal(coach.metrics.answersRecorded,7);assert.equal(coach.metrics.quizAttempts,2);assert.ok(coach.metrics.overallAccuracy!==null);
 const radar=(await api("/api/revision-radar")).j;assert.equal(radar.demoWorkspace,true);assert.equal(radar.answersRecorded,7);assert.ok(radar.topics.some(t=>t.priority==="High Priority"));
 assert.equal((await jpost("/api/lectures",{title:"Not allowed in demo",subject:"test"})).s,403);
 assert.equal((await api(`/api/lectures/${os.id}`,{method:"DELETE"})).s,403);
 const q=lesson.questions[0],wrong=(q.options||[]).find(x=>String(x)!==String(q.answer));const why=await jpost(`/api/lectures/${os.id}/questions/${q.id}/explain`,{answer:wrong});assert.equal(why.s,200);assert.equal(why.j.evidenceAvailable,true);assert.equal(why.j.textLesson,true);assert.ok(why.j.evidence.length>0);assert.equal(why.j.reference.canSeek,false);
 const attempt=await jpost(`/api/lectures/${os.id}/attempts`,{questionIds:[q.id],answers:{[q.id]:q.answer}});assert.equal(attempt.s,201);
 const after=(await api(`/api/lectures/${os.id}/attempts`)).j;assert.equal(after.length,3);assert.equal(after[0].demoPreview,false);
 cookie=originalCookie;
});


test("login screen exposes the judge demo entry point",async()=>{
 const page=await api("/");assert.equal(page.s,200);assert.match(page.j,/Try the judge demo/);assert.match(page.j,/no signup needed/i);
 const app=await api("/app.mjs");assert.equal(app.s,200);assert.match(app.j,/Explain why I got this wrong/);assert.match(app.j,/PERSONALISED ANSWER REVIEW/);assert.match(app.j,/Re-analyse lecture/);assert.match(app.j,/api\/lectures\/\$\{id\}\/analyse/);
 const auth=await api("/auth.mjs");assert.equal(auth.s,200);assert.match(auth.j,/Try the judge demo/);
 const apiClient=await api("/api-client.mjs");assert.equal(apiClient.s,200);assert.match(apiClient.j,/uploadFile/);
 const styles=await api("/styles.css");assert.equal(styles.s,200);assert.match(styles.h.get("content-type"),/text\/css/);
 const health=(await api("/api/health")).j;assert.equal(health.demoEnabled,true);assert.equal(health.semanticAlignmentConfigured,false);
});
