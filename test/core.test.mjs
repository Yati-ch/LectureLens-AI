import test from "node:test";
import assert from "node:assert/strict";
import {fmt,sortSegs,dedupe,validateSegment,activeSeg,activeSlide,scoreQ,parseCues,align,makeNotes,makeQuiz,buildLearningCoachPlan} from "../lib/core.mjs";
const seg=(id,s,e,text)=>({id,startTime:s,endTime:e,text,processingStatus:"completed"});
test("fmt",()=>{assert.equal(fmt(0),"00:00");assert.equal(fmt(134.9),"02:14");assert.equal(fmt(3725),"1:02:05");assert.equal(fmt(-3),"00:00");assert.equal(fmt(NaN),"00:00")});
test("chronological order is stable",()=>{const r=sortSegs([seg("b",5,6,""),seg("a",5,6,""),seg("c",1,2,"")]);assert.deepEqual(r.map(x=>x.id),["c","a","b"])});
test("dedupe by id and by event key",()=>{assert.equal(dedupe([{id:"x"},{id:"x"}]).length,1);assert.equal(dedupe([{eventType:"slide_change",timestamp:1,slideId:"s"},{eventType:"slide_change",timestamp:1,slideId:"s"}]).length,1)});
test("segment validation",()=>{assert.deepEqual(validateSegment(seg("a",1,2,"x")),[]);assert.deepEqual(validateSegment({startTime:-1,endTime:0,text:3}),["startTime","text"]);assert.ok(validateSegment({startTime:5,endTime:2,text:""}).includes("endTime"))});
test("active segment incl. gaps, overlap, before start",()=>{const s=sortSegs([seg("a",0,10,"a"),seg("b",8,20,"b"),seg("c",30,40,"c")]);
 assert.equal(activeSeg(s,5).id,"a");assert.equal(activeSeg(s,9).id,"b");assert.equal(activeSeg(s,25),null);assert.equal(activeSeg(s,35).id,"c");assert.equal(activeSeg([],3),null)});
test("active slide ignores missing timestamps",()=>{const t=[{slideId:"1",timestamp:0},{slideId:"2",timestamp:null},{slideId:"3",timestamp:50}];assert.equal(activeSlide(t,10).slideId,"1");assert.equal(activeSlide(t,60).slideId,"3");assert.equal(activeSlide([{slideId:"1",timestamp:5}],1),null)});
test("quiz scoring",()=>{assert.equal(scoreQ({answer:"A"},"a "),1);assert.equal(scoreQ({answer:"A"},"b"),0);assert.equal(scoreQ({answer:"A"},null),0)});
test("srt/vtt parsing",()=>{const r=parseCues("WEBVTT\n\n00:00:01.500 --> 00:00:04.000\nHello <i>there</i>\n\n1\n00:01:00,000 --> 01:00:00,250\nSecond\nline\n");assert.equal(r.length,2);assert.equal(r[0].startTime,1.5);assert.equal(r[0].text,"Hello there");assert.equal(r[1].startTime,60);assert.equal(r[1].endTime,3600.25);assert.equal(r[1].text,"Second line")});
const slides=[{id:"s1",slideNumber:1,title:"Photosynthesis overview",text:"chloroplast light energy"},{id:"s2",slideNumber:2,title:"Calvin cycle",text:"carbon fixation enzyme rubisco"},{id:"s3",slideNumber:3,title:"Respiration",text:"mitochondria glucose oxidation"}];
const segs=[seg("g1",0,10,"Photosynthesis happens in the chloroplast using light energy"),seg("g2",10,20,"The chloroplast is where light becomes chemical energy"),seg("g3",20,30,"Now the Calvin cycle performs carbon fixation with the enzyme rubisco"),seg("g4",30,40,"Unrelated chatter about the weekend and homework")];
test("alignment is monotonic, evidence-based, leaves unmatched slides untimed",()=>{const t=align(segs,slides);assert.equal(t[0].timestamp,0);assert.equal(t[1].timestamp,20);assert.equal(t[2].timestamp,null);assert.equal(t[2].source,"no_evidence");assert.ok(t[1].confidence>0&&t[1].evidence.length>0);
 const ts=t.filter(x=>x.timestamp!=null).map(x=>x.timestamp);assert.deepEqual(ts,[...ts].sort((a,b)=>a-b))});
test("alignment with no transcript never invents times",()=>{assert.ok(align([],slides).every(x=>x.timestamp===null))});
test("notes carry source segment ids and skip untimed slides",()=>{const n=makeNotes(segs,slides,align(segs,slides));assert.ok(n.length>=2);assert.ok(n.every(x=>x.segmentIds.length>0));assert.ok(!n.some(x=>x.slideId==="s3"))});
test("failed segments excluded from notes",()=>{const bad=[...segs,{id:"x",startTime:21,endTime:22,text:"rubisco failure",processingStatus:"failed"}];const n=makeNotes(bad,slides,align(segs,slides));assert.ok(!n.some(x=>x.segmentIds.includes("x")))});
test("quiz fallback never turns transcript wording into grammar or cloze questions",()=>{assert.deepEqual(makeQuiz(segs,slides,align(segs,slides),10),[]);assert.deepEqual(makeQuiz([],slides,[],5),[])});
test("source-based quiz uses only explicit lecture definitions and refuses unrelated statement matching",()=>{
 const ss=[{id:"a",slideNumber:1,title:"Operating system",text:"system software"},{id:"b",slideNumber:2,title:"Process",text:"program in execution"},{id:"c",slideNumber:3,title:"CPU scheduling",text:"method of selecting processes"},{id:"d",slideNumber:4,title:"Context switching",text:"saving and restoring process state"}];
 const gs=[seg("a1",0,10,"An operating system is system software that manages computer hardware and provides services to applications."),seg("b1",10,20,"A process is a program in execution with its own address space and allocated resources."),seg("c1",20,30,"CPU scheduling is the method of selecting a ready process for execution by the processor."),seg("d1",30,40,"A context switch is the process of saving one process state and restoring another process state.")];
 const tt=ss.map((x,i)=>({slideId:x.id,timestamp:i*10}));const q=makeQuiz(gs,ss,tt,4);
 assert.equal(q.length,4);assert.ok(q.every(x=>x.options.length===4&&x.options.includes(x.answer)&&x.segmentIds.length===1));
 assert.ok(q.every(x=>x.question.startsWith("According to this lecture, what is")));
 assert.ok(q.every(x=>x.explanation.includes("lecture defines")));
 assert.deepEqual(makeQuiz([seg("x",0,5,"The operating system manages resources and executes applications efficiently.")],ss,tt,4),[]);
});


test("learning coach creates baseline tasks without inventing quiz accuracy",()=>{
 const plan=buildLearningCoachPlan({lectures:[{id:"l1",title:"Intro",attempts:0}],topics:[
  {lectureId:"l1",lectureTitle:"Intro",topic:"Processes",slideId:"s1",answerCount:0,correct:0,incorrect:0,attemptCount:0,questionCount:2,noteCount:1},
  {lectureId:"l1",lectureTitle:"Intro",topic:"Threads",slideId:"s2",answerCount:0,correct:0,incorrect:0,attemptCount:0,questionCount:1,noteCount:1}
 ],now:1000000000});
 assert.equal(plan.metrics.overallAccuracy,null);assert.equal(plan.metrics.answersRecorded,0);assert.equal(plan.focusAreas[0].accuracy,null);assert.equal(plan.focusAreas[0].priority,"Not assessed");
 assert.ok(plan.tasks.length>0);assert.ok(plan.tasks.every(t=>t.action==="practice"||t.action==="notes"));assert.equal(plan.tasks[0].kind,"baseline");
});
test("learning coach prioritizes weak evidence and keeps small samples cautious",()=>{
 const plan=buildLearningCoachPlan({lectures:[{id:"l1",title:"DBMS",attempts:3}],topics:[
  {lectureId:"l1",lectureTitle:"DBMS",topic:"Joins",slideId:"s1",answerCount:5,correct:1,incorrect:4,attemptCount:2,questionCount:3,noteCount:1,lastPractice:900000},
  {lectureId:"l1",lectureTitle:"DBMS",topic:"Keys",slideId:"s2",answerCount:1,correct:0,incorrect:1,attemptCount:1,questionCount:1,noteCount:1,lastPractice:950000},
  {lectureId:"l1",lectureTitle:"DBMS",topic:"Normalisation",slideId:"s3",answerCount:4,correct:4,incorrect:0,attemptCount:1,questionCount:1,noteCount:1,lastPractice:990000}
 ],now:1000000});
 assert.equal(plan.focusAreas[0].topic,"Joins");assert.equal(plan.focusAreas[0].priority,"High priority");
 assert.equal(plan.focusAreas[1].priority,"Early signal");assert.equal(plan.metrics.overallAccuracy,50);
 assert.ok(plan.tasks.some(t=>t.kind==="review"&&t.topic==="Joins"));assert.ok(plan.tasks.some(t=>t.kind==="practice"&&t.topic==="Joins"));
 assert.ok(plan.tasks.length<=3);
});
test("learning coach handles an empty workspace",()=>{
 const p=buildLearningCoachPlan();assert.equal(p.metrics.topicCount,0);assert.equal(p.tasks.length,0);assert.equal(p.plannedMinutes,0);assert.equal(p.metrics.overallAccuracy,null);
});
