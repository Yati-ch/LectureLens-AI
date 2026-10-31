import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"ls-demo-"));
process.env.DATA_DIR=path.join(tmp,"data");
process.env.DEMO_SANDBOX_MAX="2";
delete process.env.TRANSCRIPTION_API_KEY;delete process.env.AI_API_KEY;delete process.env.EMBEDDINGS_API_KEY;
const {server,closeDatabase}=await import("../server.mjs");
await new Promise(r=>server.listen(0,r));
const B="http://localhost:"+server.address().port;
const call=async(p,cookie,o={})=>{const r=await fetch(B+p,{...o,headers:{...(o.headers||{}),...(cookie?{cookie}:{})}});const sc=r.headers.get("set-cookie");const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{s:r.status,j,cookie:sc?sc.split(";")[0]:cookie}};
const post=(p,cookie,b={})=>call(p,cookie,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
const enter=async()=>{const r=await post("/api/auth/demo","");assert.equal(r.s,200);return r};
const osLesson=async c=>(await call("/api/lectures",c)).j.find(x=>x.title.startsWith("Operating Systems"));

test("each judge gets a private sandbox: one judge's quiz attempt is invisible to another",async()=>{
  const a=await enter(),b=await enter();
  assert.notEqual(a.j.user.id,b.j.user.id);
  const lessonA=await osLesson(a.cookie),lessonB=await osLesson(b.cookie);
  assert.notEqual(lessonA.id,lessonB.id);
  const full=(await call(`/api/lectures/${lessonA.id}`,a.cookie)).j,q=full.questions[0];
  assert.equal((await post(`/api/lectures/${lessonA.id}/attempts`,a.cookie,{questionIds:[q.id],answers:{[q.id]:q.answer}})).s,201);
  assert.equal((await call(`/api/lectures/${lessonA.id}/attempts`,a.cookie)).j.length,3);
  assert.equal((await call(`/api/lectures/${lessonB.id}/attempts`,b.cookie)).j.length,2);
  assert.equal((await call(`/api/lectures/${lessonA.id}`,b.cookie)).s,404);
});

test("sandbox emails cannot be registered as normal accounts",async()=>{
  const r=await post("/api/auth/signup","",{name:"Mallory",email:"judge-abc@demo.lecturelens.local",password:"password123"});
  assert.equal(r.s,409);
});

test("oldest sandboxes are pruned past the cap, with their data removed",async()=>{
  const first=await enter();await enter();await enter();await enter();
  const me=await call("/api/auth/me",first.cookie);
  assert.equal(me.j.user,null);
});
test("guided tour script is served and loaded by the app shell",async()=>{
  const js=await fetch(B+"/tour.mjs");assert.equal(js.status,200);assert.match(js.headers.get("content-type"),/javascript/);
  const body=await js.text();assert.match(body,/Explain why I got this wrong/);assert.match(body,/Revision Radar/);
  const html=await (await fetch(B+"/")).text();assert.match(html,/src="\/tour\.mjs"/);
});

test("every response carries defensive security headers",async()=>{
  for(const url of ["/","/tour.mjs","/api/health"]){
    const r=await fetch(B+url);
    assert.equal(r.headers.get("x-frame-options"),"SAMEORIGIN",url);
    assert.match(r.headers.get("content-security-policy"),/frame-ancestors 'self'/,url);
    assert.equal(r.headers.get("x-content-type-options"),"nosniff",url);
    assert.equal(r.headers.get("referrer-policy"),"same-origin",url);
  }
  const bad=await fetch(B+"/nope.txt");assert.equal(bad.status,404);assert.equal(bad.headers.get("x-frame-options"),"SAMEORIGIN");
});

test.after(async()=>{await new Promise(resolve=>server.close(resolve));closeDatabase();fs.rmSync(tmp,{recursive:true,force:true})});
