// Pure logic shared by server, browser and tests. Time unit: seconds.
export const fmt=s=>{s=Math.max(0,Math.floor(Number(s)||0));
const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60,p=n=>String(n).padStart(2,"0");
return (h?h+":":"")+p(m)+":"+p(x)};
export const sortSegs=a=>[...a].sort((x,y)=>x.startTime-y.startTime||x.endTime-y.endTime||String(x.id).localeCompare(String(y.id)));
export const dedupe=a=>{const k=new Set();
return a.filter(e=>{const i=e.id||[e.eventType,e.timestamp,e.slideId].join("|");if(k.has(i))return false;k.add(i);return true})};
export function validateSegment(s){const e=[];
if(!Number.isFinite(s.startTime)||s.startTime<0)e.push("startTime");
if(!Number.isFinite(s.endTime)||s.endTime<s.startTime)e.push("endTime");
if(typeof s.text!=="string")e.push("text");
return e}
export function activeSeg(segs,t){let lo=0,hi=segs.length-1,r=-1;
while(lo<=hi){const m=(lo+hi)>>1;
if(segs[m].startTime<=t){r=m;
lo=m+1}else hi=m-1}
  for(let i=r;i>=0&&i>r-5;i--)if(t<segs[i].endTime+0.5)return segs[i];
return null}
export function activeSlide(trans,t){let b=null;
for(const x of trans)if(x.timestamp!=null&&x.timestamp<=t&&(!b||x.timestamp>=b.timestamp))b=x;
return b}
export function scoreQ(q,a){if(a==null||a==="")return 0;
return String(a).trim().toLowerCase()===String(q.answer).trim().toLowerCase()?1:0}
export function parseCues(txt){ // SRT/VTT -> segments (user-supplied transcript)
  const out=[],re=/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
let m;
  const t=(h,mi,s,ms)=>(+h||0)*3600+ +mi*60+ +s+ +ms/1000;
  const src=txt.replace(/\r/g,"");
  while((m=re.exec(src))){const text=m[9].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
if(text)out.push({startTime:t(m[1],m[2],m[3],m[4]),endTime:t(m[5],m[6],m[7],m[8]),text})}
  return out}
const STOP=new Set("this that with from have they their there what when which about into your will would could should these those then than also been were does only other some such each very more most just like over under while where because".split(" "));
export const terms=s=>[...new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g)||[]).filter(w=>!STOP.has(w)))];
// Monotonic transcript->slide alignment using shared-term evidence. Slides with no evidence get timestamp:null (never invented).
export function align(segs,slides){
  const st=slides.map(s=>new Set(terms(s.title+" "+s.text)));
const n=segs.length,k=slides.length;
  if(!n||!k)return slides.map(s=>({slideId:s.id,timestamp:null,source:"no_evidence",confidence:0,evidence:[]}));
  const sc=segs.map(g=>{const t=terms(g.text);return st.map(set=>{const hit=t.filter(w=>set.has(w));return {v:hit.length,hit}})});
  const dp=Array.from({length:n},()=>new Array(k).fill(-1e9)),bk=Array.from({length:n},()=>new Array(k).fill(0));
  for(let i=0;i<n;i++)for(let j=0;j<k;j++){let best=0,bj=j;
if(i>0){best=-1e9;
for(let p=0;p<=j;p++)if(dp[i-1][p]>best||(dp[i-1][p]===best&&p===j)){best=dp[i-1][p];
bj=p}}
    dp[i][j]=sc[i][j].v+best-(i>0&&bj!==j?0.01:0);
bk[i][j]=bj}
  let j=0,bv=-1e9;
for(let q=0;q<k;q++)if(dp[n-1][q]>=bv){bv=dp[n-1][q];
j=q}
  const asg=new Array(n);
for(let i=n-1;i>=0;i--){asg[i]=j;
j=bk[i][j]}
  return slides.map((s,idx)=>{const ev=[];for(let i=0;i<n;i++)if(asg[i]===idx&&sc[i][idx].v>0)ev.push({segmentId:segs[i].id,time:segs[i].startTime,terms:sc[i][idx].hit});
    if(!ev.length)return{slideId:s.id,timestamp:null,source:"no_evidence",confidence:0,evidence:[]};
    const uniq=new Set(ev.flatMap(e=>e.terms)).size;const conf=Math.min(0.95,+(uniq/Math.max(3,st[idx].size*0.6)).toFixed(2));
    return{slideId:s.id,timestamp:ev[0].time,source:"transcript_match (inferred)",confidence:conf,evidence:ev.slice(0,5)}})}
// Source-grounded study notes. Key points are selected from complete lecture sentences;
// the fallback never adds facts that are not present in the transcript.
function splitStudySentences(text){
  return String(text||"").replace(/\s+/g," ").split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(x=>x.trim()).filter(x=>x.length>=38&&x.length<=420);
}
function studySentenceScore(sentence,topicTerms){
  const lower=sentence.toLowerCase();let score=0;
  if(/\b(is|are|means|refers to|defined as|known as|consists of|works by|allows|enables|requires|causes|results in|therefore|because|when|if)\b/i.test(sentence))score+=3;
  if(/\b(is defined as|refers to|means|is a|is an|are|consists of)\b/i.test(sentence))score+=3;
  if(/\b(formula|equation|algorithm|syntax|steps?|characteristics|properties|types?|difference between|advantages?|disadvantages?)\b/i.test(sentence))score+=2;
  if(/\b(important|purpose|function|process|method|steps?|types?|advantages?|disadvantages?|difference|compared|example|formula|equation|increases|decreases|reduces|improves|prevents|stores|manages|converts|produces)\b/i.test(sentence))score+=2;
  const words=terms(sentence);score+=words.filter(w=>topicTerms.includes(w)).length*2;
  if(/\b(um|uh|okay|hello|thank you|subscribe|like and share)\b/i.test(sentence))score-=5;
  if(sentence.length<55)score-=1;
  return score;
}
export function makeNotes(segs,slides,trans){
  const timed=trans.filter(t=>t.timestamp!=null).sort((a,b)=>a.timestamp-b.timestamp);
  const notes=[];
  timed.forEach((t,i)=>{
    const end=i+1<timed.length?timed[i+1].timestamp:Infinity;
    const sl=slides.find(s=>s.id===t.slideId);if(!sl)return;
    const inR=segs.filter(g=>g.processingStatus==="completed"&&g.startTime>=t.timestamp&&g.startTime<end);
    if(!inR.length)return;
    const topic=terms(`${sl.title||""} ${sl.text||""}`);
    const sentences=inR.flatMap(g=>splitStudySentences(g.text).map(text=>({text,segmentId:g.id,startTime:g.startTime})));
    const ranked=sentences.map((x,index)=>({...x,index,score:studySentenceScore(x.text,topic)})).sort((a,b)=>b.score-a.score||a.index-b.index);
    const picked=[];const seen=new Set();
    for(const item of ranked){
      const key=item.text.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
      if(!key||seen.has(key))continue;
      if(picked.some(x=>terms(x.text).filter(w=>terms(item.text).includes(w)).length>=Math.min(7,terms(item.text).length)*0.82))continue;
      seen.add(key);picked.push(item);if(picked.length>=5)break;
    }
    const ordered=[...picked].sort((a,b)=>a.index-b.index);
    const summary=ordered.slice(0,2).map(x=>x.text).join(" ")||inR.map(g=>g.text).join(" ").slice(0,900);
    const keyPoints=ordered.slice(0,5).map(x=>x.text).filter(x=>x!==summary);
    const sourceIds=[...new Set(inR.map(g=>g.id))];
    const noteText=[sl.title||`Lecture section ${i+1}`,summary,...(keyPoints.length?["Key points",...keyPoints.map(x=>"• "+x)]:[])].join("\n\n");
    notes.push({type:"section",startTime:t.timestamp,slideId:t.slideId,source:"source-based study guide: selected from lecture transcript",segmentIds:sourceIds,text:noteText});
    // Explicit definitions are retained as separate quick-revision cards.
    for(const item of sentences){
      if(/\b(is defined as|means|refers to|is a|are|consists of)\b/i.test(item.text)&&terms(item.text).some(w=>topic.includes(w))){
        notes.push({type:"definition",startTime:item.startTime,slideId:t.slideId,source:"definition extracted from lecture transcript",segmentIds:[item.segmentId],text:item.text});
      }
    }
  });
  return notes;
}
// Deterministic quiz fallback: create questions only from explicit definitions
// spoken in the lecture. Distractors are other definitions from that same lecture.
// If the source does not contain enough clear definitions, return no quiz rather than guess.
function extractLectureDefinitions(segs,slides,trans){
  const timed=trans.filter(t=>t.timestamp!=null).sort((a,b)=>a.timestamp-b.timestamp);
  const found=[];
  for(let i=0;i<timed.length;i++){
    const t=timed[i],end=i+1<timed.length?timed[i+1].timestamp:Infinity;
    const slide=slides.find(x=>x.id===t.slideId);
    const linked=segs.filter(g=>g.processingStatus==="completed"&&g.startTime>=t.timestamp&&g.startTime<end);
    for(const g of linked)for(const sentence of splitStudySentences(g.text)){
      const clean=sentence.replace(/\s+/g," ").trim();
      let m=clean.match(/^(.{2,70}?)\s+(?:is defined as|refers to|means|is known as|is called)\s+(.{12,260})$/i);
      if(!m)m=clean.match(/^(?:a|an|the)\s+([a-z][a-z -]{1,55}?)\s+is\s+(.{12,260})$/i);
      if(!m)m=clean.match(/^([A-Z][A-Za-z -]{2,48})\s+is\s+(?:a|an|the)\s+(.{12,260})$/);
      if(!m)continue;
      const term=m[1].trim().replace(/^(a|an|the)\s+/i,"");
      const definition=m[2].trim().replace(/[.!?]+$/g,"");
      if(term.length<3||definition.length<12||terms(term).length===0)continue;
      found.push({term,definition,answer:definition,segmentId:g.id,startTime:g.startTime,slideId:slide?.id||null,sourceSentence:clean});
    }
  }
  const unique=new Map();
  for(const x of found){const k=x.term.toLowerCase();if(!unique.has(k))unique.set(k,x)}
  return [...unique.values()];
}
export function makeQuiz(segs,slides,trans,count=5){
  const definitions=extractLectureDefinitions(segs,slides,trans);
  if(definitions.length<4)return [];
  const result=[];
  for(const current of definitions){
    if(result.length>=Math.max(1,Number(count)||5))break;
    const distractors=definitions.filter(x=>x.term.toLowerCase()!==current.term.toLowerCase())
      .sort((a,b)=>terms(b.term+" "+b.definition).filter(w=>terms(current.term+" "+current.definition).includes(w)).length-
                    terms(a.term+" "+a.definition).filter(w=>terms(current.term+" "+current.definition).includes(w)).length)
      .slice(0,3);
    if(distractors.length!==3)continue;
    const options=[current,...distractors].map(x=>x.definition);
    if(new Set(options.map(x=>x.toLowerCase())).size!==4)continue;
    result.push({type:"mc",question:`According to this lecture, what is “${current.term}”?`,options,answer:current.definition,
      explanation:`The lecture defines ${current.term} as: ${current.definition}. This question is based on the linked transcript passage.`,
      difficulty:"easy",startTime:current.startTime,slideId:current.slideId,segmentIds:[current.segmentId],topic:current.term});
  }
  return result;
}

// Evidence-based daily study plan. Scores and topic statuses are derived only from
// persisted quiz answers; unassessed topics never receive invented accuracy.
export function buildLearningCoachPlan({lectures=[],topics=[],now=Date.now()}={}){
  const cleanTopics=topics.map(t=>{
    const answerCount=Math.max(0,Number(t.answerCount)||0),correct=Math.max(0,Number(t.correct)||0),
      incorrect=Math.max(0,Number(t.incorrect)||0),accuracy=answerCount?Math.round(correct/answerCount*100):null,
      attemptCount=Math.max(0,Number(t.attemptCount)||0),questionCount=Math.max(0,Number(t.questionCount)||0),
      noteCount=Math.max(0,Number(t.noteCount)||0),lastPractice=Number(t.lastPractice)||null;
    const daysSincePractice=lastPractice?Math.max(0,Math.floor((now-lastPractice)/86400000)):null;
    let priority="Not assessed",rank=58;
    if(answerCount){
      if(answerCount===1){priority="Early signal";rank=incorrect?76:43}
      else if(accuracy<50){priority="High priority";rank=100+Math.min(answerCount,8)}
      else if(accuracy<65){priority="Needs practice";rank=88+Math.min(answerCount,6)}
      else if(accuracy<80){priority="Build confidence";rank=72+Math.min(answerCount,5)}
      else if(accuracy<90){priority="Keep it fresh";rank=48}
      else {priority="Strong";rank=34}
      if(daysSincePractice!==null&&daysSincePractice>=14)rank+=8;
    }
    return {...t,answerCount,correct,incorrect,accuracy,attemptCount,questionCount,noteCount,lastPractice,daysSincePractice,priority,rank,
      evidenceLabel:answerCount===0?"No quiz answers yet":answerCount===1?"Early signal · 1 answer":answerCount<5?`Based on ${answerCount} answers`:`Based on ${answerCount} answers across ${attemptCount} ${attemptCount===1?"attempt":"attempts"}`};
  }).sort((a,b)=>b.rank-a.rank||String(a.lectureTitle).localeCompare(String(b.lectureTitle))||String(a.topic).localeCompare(String(b.topic)));
  const answerCount=cleanTopics.reduce((n,t)=>n+t.answerCount,0),correct=cleanTopics.reduce((n,t)=>n+t.correct,0),
    assessed=cleanTopics.filter(t=>t.answerCount>0),unassessed=cleanTopics.filter(t=>!t.answerCount),
    totalAttempts=lectures.reduce((n,l)=>n+(Number(l.attempts)||0),0),overallAccuracy=answerCount?Math.round(correct/answerCount*100):null;
  const focus=cleanTopics[0]||null;
  let headline="Add a lecture to start your learning plan.",message="Your coach will turn lecture sections and quiz results into a focused study plan.";
  if(cleanTopics.length&&answerCount===0){headline="Start with a quick baseline.";
message=`You have ${cleanTopics.length} lecture topics ready to study. A short quiz will establish your first learning signals; no topic is ranked by accuracy until you answer.`}
  else if(focus&&focus.answerCount){
    headline=focus.accuracy<60?`Give ${focus.topic} some focused attention.`:focus.accuracy<80?`Build confidence in ${focus.topic}.`:`Keep your progress moving.`;
    message=focus.accuracy<60?`${focus.topic} currently has ${focus.accuracy}% accuracy from ${focus.answerCount} saved answer${focus.answerCount===1?"":"s"}. Revisit the lesson source, then try a focused practice quiz.`:
      focus.accuracy<80?`${focus.topic} is a useful next review area at ${focus.accuracy}% across ${focus.answerCount} saved answers. A short review followed by practice can help reinforce it.`:
      `${focus.topic} is currently one of your strongest assessed areas. Keep it fresh with a short recall session and check any topics you have not assessed yet.`;
  }
  const tasks=[];
const addTask=(topic,kind,title,reason,minutes,action)=>{
    if(!topic||tasks.length>=3)return;
    const id=`${topic.lectureId}:${topic.slideId||topic.topic}:${kind}`;
    if(tasks.some(x=>x.id===id))return;
    tasks.push({id,kind,title,reason,minutes,action,lectureId:topic.lectureId,lectureTitle:topic.lectureTitle,
      topic:topic.topic,accuracy:topic.accuracy,answerCount:topic.answerCount,questionCount:topic.questionCount});
  };
  if(focus){
    if(focus.answerCount&&focus.accuracy<80&&focus.noteCount>0)
      addTask(focus,"review","Review the lesson explanation",`${focus.topic} · ${focus.evidenceLabel}. Revisit its notes and source section before practising.`,10,"notes");
    if(focus.questionCount>0)
      addTask(focus,focus.answerCount?"practice":"baseline",focus.answerCount?"Practise this topic":"Take a baseline quiz",focus.answerCount?`${focus.topic} · ${focus.correct} correct and ${focus.incorrect} to review.`:`${focus.topic} has not been assessed yet. Take a short quiz to establish a baseline.`,10,"practice");
    else if(focus.noteCount>0)
      addTask(focus,"review","Read the source notes",`${focus.topic} has notes available but no linked quiz questions.`,10,"notes");
  }
  for(const topic of cleanTopics){
    if(tasks.length>=3)break;
    if(topic===focus)continue;
    if(topic.questionCount>0){
      const title=topic.answerCount?(topic.accuracy<80?"Strengthen another topic":"Quick recall practice"):"Assess a new topic";
      const reason=topic.answerCount?`${topic.topic} · ${topic.accuracy}% from ${topic.answerCount} saved answers.`:`${topic.topic} has no saved quiz answers yet.`;
      addTask(topic,topic.answerCount?"practice":"baseline",title,reason,10,"practice");
    }else if(topic.noteCount>0){addTask(topic,"review","Review another lesson section",`${topic.topic} has study notes available.`,8,"notes")}
  }
  const focusAreas=cleanTopics.slice(0,5).map(t=>({lectureId:t.lectureId,lectureTitle:t.lectureTitle,topic:t.topic,slideId:t.slideId,
    accuracy:t.accuracy,answerCount:t.answerCount,correct:t.correct,incorrect:t.incorrect,attemptCount:t.attemptCount,
    questionCount:t.questionCount,noteCount:t.noteCount,lastPractice:t.lastPractice,daysSincePractice:t.daysSincePractice,
    priority:t.priority,evidenceLabel:t.evidenceLabel}));
  return {generatedAt:now,metrics:{lectureCount:lectures.length,topicCount:cleanTopics.length,topicsAssessed:assessed.length,
      topicsUnassessed:unassessed.length,answersRecorded:answerCount,quizAttempts:totalAttempts,overallAccuracy,
      topicsNeedingWork:assessed.filter(t=>t.accuracy<80).length},
    headline,message,focusAreas,tasks,plannedMinutes:tasks.reduce((n,t)=>n+t.minutes,0),
    evidenceNote:"Recommendations use this account’s saved lecture sections and quiz answers. A small number of answers is an early signal, not a definitive measure of mastery. Task completion is a personal checklist and does not change quiz accuracy."};
}
