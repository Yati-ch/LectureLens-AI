import { sortSegs, fmt } from "./core.mjs";

/** Convert SQLite rows into the stable lecture API representation used by the UI. */
export function createLectureReadModel(db) {
function safeJson(value,fallback){try{return JSON.parse(value??"")}catch{return fallback}}
function full(id,withAnswers=true){const l=db.prepare("SELECT * FROM lectures WHERE id=?").get(id);
if(!l)return null;
  const segs=sortSegs(db.prepare("SELECT * FROM segments WHERE lecture_id=?").all(id).map(r=>({id:r.id,startTime:r.start,endTime:r.end,text:r.text,confidence:null,processingStatus:r.status,error:r.error,edited:!!r.edited})));
  const slides=db.prepare("SELECT * FROM slides WHERE lecture_id=? ORDER BY n").all(id).map(r=>({id:r.id,slideNumber:r.n,title:r.title,text:r.text,hasImage:!!r.has_image,processingStatus:r.status}));
  const transitions=db.prepare("SELECT * FROM transitions WHERE lecture_id=?").all(id).map(r=>({slideId:r.slide_id,timestamp:r.ts,source:r.source,confidence:r.confidence,evidence:safeJson(r.evidence,[])}));
  const notes=db.prepare("SELECT * FROM notes WHERE lecture_id=? ORDER BY start").all(id).map(r=>({id:r.id,type:r.type,startTime:r.start,slideId:r.slide_id,source:r.source,segmentIds:safeJson(r.segment_ids,[]),text:r.text}));
  const questions=db.prepare("SELECT id,body FROM questions WHERE lecture_id=?").all(id).flatMap(r=>{
    const body=safeJson(r.body,null);
    if(!body||typeof body!=="object"||typeof body.question!=="string"||!Array.isArray(body.options)||typeof body.answer!=="string")return [];
    const options=body.options.filter(x=>typeof x==="string");
    if(!options.length||!options.includes(body.answer))return [];
    return [{id:r.id,...body,options}];
  });
  const errors=db.prepare("SELECT stage,message,created FROM errors WHERE lecture_id=? ORDER BY id").all(id);
  const ok=segs.filter(s=>s.processingStatus==="completed");
  const stages=safeJson(l.stages,{});
  const alignmentStageMessage=String(stages.align?.msg||"");
  const isSemanticTransition=t=>String(t.source||"").includes("semantic_embedding_match");
  const transitionThreshold=t=>{
    if(!isSemanticTransition(t))return 0.5;
    const match=/min_similarity=([0-9.]+)/.exec(String(t.source||""));
    return match?Math.max(0.05,Math.min(0.95,Number(match[1])||0.35)):0.35;
  };
  const transcriptSections=slides.length>0&&slides.every(s=>s.processingStatus==="transcript_section");
  const hasVisualMatches=transitions.some(t=>String(t.source||"").startsWith("video_frame_visual"));
  const alignmentMode=transcriptSections
    ? "transcript-derived lecture sections; no presentation supplied"
    : hasVisualMatches
      ? "video scene-change detection with perceptual slide-image matching; transcript alignment supplements visual matches"
    : l.transcript_source==="curated lesson text"
    ? "curated text sections; no recording attached"
    : alignmentStageMessage.startsWith("Semantic embeddings")
      ? `semantic embedding alignment; ${l.has_video?"video frame matching available when slide deck and visual matches are detected":"inferred from transcript"}`
      : alignmentStageMessage.startsWith("Text-overlap fallback")
        ? `text-overlap fallback; ${l.has_video?"video frame matching available when slide deck and visual matches are detected":"inferred from transcript"}`
        : transitions.some(t=>String(t.source||"").includes("semantic_embedding_match"))
          ? `semantic embedding alignment; ${l.has_video?"video frame matching available when slide deck and visual matches are detected":"inferred from transcript"}`
          : l.has_video ? "video-frame matching when available; otherwise transcript-inferred" : "audio-only, inferred from transcript";
  return{id:l.id,title:l.title,subject:l.subject,status:l.status,stage:l.stage,stages,duration:l.duration,hasVideo:!!l.has_video,hasMedia:!!l.media_ext,sectionsFromTranscript:transcriptSections,isTextLesson:l.transcript_source==="curated lesson text",transcriptSource:l.transcript_source,created:l.created,slides,segments:segs,transitions,notes,questions,errors,
    report:{duration:l.duration,segmentsCompleted:ok.length,segmentsFailed:segs.length-ok.length,firstSegment:ok[0]?.startTime??null,lastSegment:ok.at(-1)?.endTime??null,failedIntervals:segs.filter(s=>s.processingStatus!=="completed").map(s=>[s.startTime,s.endTime]),slides:slides.length,timedTransitions:transitions.filter(t=>t.timestamp!=null).length,uncertainTransitions:transitions.filter(t=>t.timestamp==null||t.confidence<transitionThreshold(t)).length,notes:notes.length,questions:questions.length,status:l.status,alignmentMode}}}
  return { full };
}
