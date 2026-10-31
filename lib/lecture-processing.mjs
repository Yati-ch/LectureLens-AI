/** Lecture processing pipeline: external tools, transcript alignment, notes, and quiz generation. */
export function createLectureProcessor(dependencies) {
  const {
    db, fs, path, run, uid, fmt, sortSegs, align, alignSemantically, makeNotes, makeQuiz,
    dir, setStage, addErr, log,
    AI_KEY: AKEY, AI_BASE: ABASE, AI_MODEL: AMODEL, AI_TIMEOUT,
    TRANSCRIPTION_KEY: TKEY, TRANSCRIPTION_BASE: TBASE,
    TRANSCRIPTION_MODEL: TMODEL, TRANSCRIPTION_TIMEOUT: T_TIMEOUT,
    ROOT, LOCAL_TRANSCRIPTION_ENABLED = true, LOCAL_TRANSCRIPTION_PYTHON = "python", LOCAL_TRANSCRIPTION_MODEL = "base",
  } = dependencies;
  const running = new Set();

async function aiJSON(system,payload){
  if(!AKEY)return null;
  const r=await fetch(ABASE+"/chat/completions",{method:"POST",headers:{authorization:"Bearer "+AKEY,"content-type":"application/json"},body:JSON.stringify({model:AMODEL,temperature:0.2,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(payload)}]}),signal:AbortSignal.timeout(AI_TIMEOUT)});
  if(!r.ok)throw new Error("AI provider HTTP "+r.status);
  const j=await r.json(),content=j.choices?.[0]?.message?.content;
  if(typeof content!=="string")throw new Error("AI provider returned no JSON content");
  const parsed=JSON.parse(content);
return parsed;
}
async function improveNotesWithAI(notes,segs,slides){
  if(!AKEY||!notes.length)return notes;
  const byId=new Map(segs.map(s=>[s.id,s])),bySlide=new Map(slides.map(s=>[s.id,s]));
  const out=[];
  let aiUnavailable=false;
  for(const note of notes){
    if(note.type!=="section"||aiUnavailable){out.push(note);
continue;
}
    const sourceSegments=note.segmentIds.map(id=>byId.get(id)).filter(Boolean);
    const slide=bySlide.get(note.slideId)||null;
if(!sourceSegments.length){out.push(note);
continue;
}
    try{
      const result=await aiJSON("You are an expert university-level subject tutor creating study notes from a lecture. The source may contain speech-recognition errors. First identify the academic subject and the actual concepts being taught; do not mistake sentence wording, grammar, filler words, or transcription artifacts for subject matter. Teach the concepts, not the transcript wording. Use ONLY facts supported by the supplied lecture text and slide text. If a concept is unclear or corrupted, explicitly mark it as unclear rather than guessing. For an Operating Systems lecture, prioritize actual OS concepts when present: process/thread, process states, CPU scheduling, context switching, synchronization, deadlocks, memory management, paging, segmentation, virtual memory, file systems, and I/O. Do not force these topics if absent. Return JSON with exactly these fields: {\"title\":string,\"explanation\":string,\"key_points\":string[],\"worked_example\":string,\"important_distinction\":string}. The title must name the academic concept, not copy a random opening sentence. The explanation should teach what it is, how/why it works, and why it matters in 3–6 clear sentences. Give 3–5 exam-useful key points. Include a worked example only if supported by the source or a simple illustration of a source-supported principle; label illustrative examples clearly. Include an important distinction when relevant. Never create grammar exercises, vocabulary lists, sentence-completion material, or generic motivational text. Do not add unsupported facts. Do not output markdown fences.",{slide:slide?{number:slide.slideNumber,title:slide.title,text:String(slide.text||"").slice(0,5000)}:null,transcript:sourceSegments.map(s=>({id:s.id,startTime:s.startTime,endTime:s.endTime,text:s.text})).slice(0,18)});
      if(result&&typeof result.explanation==="string"&&result.explanation.trim()){
        const title=String(result.title||slide.title).trim().slice(0,180);
        const explanation=result.explanation.trim().slice(0,5000);
        const points=Array.isArray(result.key_points)?result.key_points.filter(x=>typeof x==="string"&&x.trim()).slice(0,5).map(x=>x.trim().slice(0,400)):[];
        const example=typeof result.worked_example==="string"?result.worked_example.trim().slice(0,900):"";
        const distinction=typeof result.important_distinction==="string"?result.important_distinction.trim().slice(0,700):"";
        // Preserve the source IDs already attached to this note; AI output cannot invent citations.
        note.text=[title,explanation,...(points.length?["Key points",...points.map(x=>"• "+x)]:[]),...(example?["Worked example",example]:[]),...(distinction?["Important distinction",distinction]:[])].join("\n\n");
        note.source="AI-generated from lecture transcript"+(slide?" and available visual material":"")+"; source segment IDs retained";
      }
    }catch(e){aiUnavailable=true;log("AI notes fallback; skipping further AI note calls",e.message)}
    out.push(note);
  }
  return out;
}
async function improveQuizWithAI(fallback,good,slides,transitions,count){
  if(!AKEY||!good.length||!slides.length)return fallback;
  const source=good.map(s=>({id:s.id,startTime:s.startTime,text:s.text}));
  const slideData=slides.map(s=>({id:s.id,slideNumber:s.slideNumber,title:s.title,text:s.text.slice(0,2500)}));
  try{
    const result=await aiJSON("You are an expert university examiner. Create university-level CONCEPTUAL multiple-choice questions from the lecture. Determine the academic subject first and test subject knowledge, not language. ABSOLUTELY FORBIDDEN: grammar questions, vocabulary questions, spelling, punctuation, sentence completion, fill-in-the-blank, asking which word completes a sentence, questions about how the lecturer phrased something, or questions about transcript quality. Every question must assess a concept, mechanism, comparison, cause/effect, application, trace, or problem-solving skill from the taught subject. For Operating Systems, when supported by the source, ask about process scheduling, Gantt charts, waiting/turnaround/response time, process states, context switches, synchronization, semaphores, deadlocks, paging, page faults, virtual memory, and file allocation. Use short practical scenarios and numerical problems when the lecture provides enough information. Do not force unrelated topics. Create questions across distinct concepts; do not repeat one concept. Every item must have exactly 4 plausible same-subject options, exactly one correct answer, and an explanation that teaches why it is correct and why the key misconception is wrong. Cite source segment IDs and/or slide ID. If the transcript is too noisy or contains insufficient subject concepts, return fewer questions or an empty array. Never invent lecture-specific claims. Return JSON {questions:[{question:string,options:string[4],answer:string,explanation:string,sourceSegmentIds:string[],slideId:string|null,difficulty:'easy'|'medium'|'hard',startTime:number|null}]}. Correct answer must exactly equal one option. Do not use markdown fences.",{transcript:source.slice(0,100),slides:slideData.slice(0,40),count});
    if(!Array.isArray(result?.questions))return fallback;
    const valid=[];
const segIds=new Set(source.map(s=>s.id)),slideIds=new Set(slides.map(s=>s.id));
    for(const q of result.questions){
      if(typeof q.question!=="string"||q.question.trim().length<35||/\b(grammar|punctuation|spelling|vocabulary|which word|complete this statement|fill in the blank|sentence completion|correct sentence)\b/i.test(q.question)||!Array.isArray(q.options)||q.options.length!==4||q.options.some(x=>typeof x!=="string"||!x.trim())||new Set(q.options.map(x=>x.trim().toLowerCase())).size!==4||typeof q.answer!=="string"||!q.options.some(x=>x.trim()===q.answer.trim())||typeof q.explanation!=="string"||!q.explanation.trim())continue;
      const ids=Array.isArray(q.sourceSegmentIds)?q.sourceSegmentIds.filter(x=>segIds.has(x)):[];
const slideId=slideIds.has(q.slideId)?q.slideId:null;
      if(!ids.length&&!slideId)continue;
      const citedSegments=source.filter(s=>ids.includes(s.id));
      const citedSlides=slides.filter(s=>s.id===slideId);
      // Conservative grounding guard: require the proposed answer phrase to occur in at least one cited source.
      // This rejects many hallucinated answers; it does not replace human fact-checking.
      const norm=x=>String(x||"").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
      const answerNorm=norm(q.answer);
      const evidence=[...citedSegments.map(s=>s.text),...citedSlides.map(s=>`${s.title} ${s.text}`)].map(norm);
      if(!answerNorm||!evidence.some(t=>t.includes(answerNorm)))continue;
      // Use the source timestamp rather than trusting an ungrounded time proposed by the model.
      const groundedTime=citedSegments.length?Math.min(...citedSegments.map(s=>s.startTime)):null;
      valid.push({type:"mc",question:q.question.trim().slice(0,800),options:q.options.map(x=>x.trim().slice(0,300)),answer:q.answer.trim(),explanation:q.explanation.trim().slice(0,1500),difficulty:["easy","medium","hard"].includes(q.difficulty)?q.difficulty:"medium",startTime:groundedTime,slideId,segmentIds:ids});
      if(valid.length>=count)break;
    }
    return valid.length?valid:[];
  }catch(e){log("AI quiz unavailable; no unverified fallback questions will be shown",e.message);
return []}
}
async function transcribeChunk(file,offset,id){ // OpenAI-compatible /audio/transcriptions, segment-level timestamps only
  for(let a=1;a<=3;a++){try{const fd=new FormData();
fd.append("file",new Blob([fs.readFileSync(file)]),"chunk.mp3");
fd.append("model",TMODEL);
fd.append("response_format","verbose_json");
    const r=await fetch(TBASE+"/audio/transcriptions",{method:"POST",headers:{authorization:"Bearer "+TKEY},body:fd,signal:AbortSignal.timeout(T_TIMEOUT)});
if(!r.ok)throw new Error("provider HTTP "+r.status);
    const j=await r.json();
return(j.segments||[]).map(s=>({startTime:offset+s.start,endTime:offset+s.end,text:String(s.text).trim()}))}catch(e){if(a===3)throw e;
await new Promise(r=>setTimeout(r,500*a))}}}
async function transcribeLocally(mediaFile, outputFile){
  const script=path.join(ROOT,"scripts","transcribe_local.py");
  const prefix=String(LOCAL_TRANSCRIPTION_PYTHON).toLowerCase()==="py"?["-3"]:[];
  try{
    await run(LOCAL_TRANSCRIPTION_PYTHON,[...prefix,script,mediaFile,outputFile,"--model",LOCAL_TRANSCRIPTION_MODEL]);
  }catch(error){
    // On Windows some installations expose only the Python launcher (`py`).
    if(process.platform!=="win32"||String(LOCAL_TRANSCRIPTION_PYTHON).toLowerCase()!=="python"||!String(error.message).includes("ENOENT"))throw error;
    await run("py",["-3",script,mediaFile,outputFile,"--model",LOCAL_TRANSCRIPTION_MODEL]);
  }
  const payload=JSON.parse(fs.readFileSync(outputFile,"utf8"));
  if(!Array.isArray(payload.segments)||!payload.segments.length)throw new Error("Local transcription returned no speech segments. Check that the recording contains audible speech.");
  return payload;
}
function createTranscriptSections(id,segments){
  const completed=segments.filter(s=>s.processingStatus==="completed"&&String(s.text||"").trim());
  if(!completed.length)return [];
  // Three-minute windows create navigable lecture chapters without pretending that
  // the student supplied presentation slides. Their timestamps come from Whisper.
  const bins=new Map();
  for(const segment of completed){
    const bucket=Math.floor(Math.max(0,segment.startTime)/180);
    if(!bins.has(bucket))bins.set(bucket,[]);
    bins.get(bucket).push(segment);
  }
  const groups=[...bins.entries()].sort((a,b)=>a[0]-b[0]).map(([,rows])=>rows);
  const made=[];
  const insertSlide=db.prepare("INSERT INTO slides(id,lecture_id,n,title,text,has_image,status) VALUES(?,?,?,?,?,?,?)");
  const insertTransition=db.prepare("INSERT INTO transitions(slide_id,lecture_id,ts,source,confidence,evidence) VALUES(?,?,?,?,?,?)");
  groups.forEach((rows,index)=>{
    const first=String(rows[0].text||"").replace(/\s+/g," ").trim();
    const firstSentence=(first.split(/(?<=[.!?])\s+/)[0]||first).replace(/[.!?]+$/g,"").trim();
    const title=(firstSentence.length>=10?firstSentence:rows.map(x=>x.text).join(" ").slice(0,90)).slice(0,110)||`Lecture section ${index+1}`;
    const idForSection=uid(),text=rows.map(x=>x.text).join(" ").slice(0,12000),at=rows[0].startTime;
    insertSlide.run(idForSection,id,index+1,title,text,0,"transcript_section");
    insertTransition.run(idForSection,id,at,"transcript_section_marker",1,JSON.stringify(rows.slice(0,12).map(x=>({segmentId:x.id,time:x.startTime}))));
    made.push({id:idForSection,slideNumber:index+1,title,text,hasImage:false,processingStatus:"transcript_section",startTime:at});
  });
  return made;
}
async function processLecture(id){
  if(running.has(id))return;
running.add(id);
const d=dir(id),L=()=>db.prepare("SELECT * FROM lectures WHERE id=?").get(id);
let warnings=0;
  try{db.prepare("UPDATE lectures SET status='processing' WHERE id=?").run(id);
    let l=L();
const media=path.join(d,"media."+l.media_ext),sf=l.slides_ext?path.join(d,"slides."+l.slides_ext):null;
    setStage(id,"verify","running");
if(!fs.existsSync(media))throw new Error("Missing lecture recording");
if(sf&&!fs.existsSync(sf))throw new Error("The uploaded slide deck could not be found. Re-upload it or remove it and process the recording without slides.");
setStage(id,"verify","done",sf?"Recording and slide deck found":"Recording found; no slides supplied");
    setStage(id,"inspect","running");
const pr=JSON.parse(await run("ffprobe",["-v","error","-print_format","json","-show_format","-show_streams",media]));
    const dur=+pr.format.duration;
if(!(dur>0))throw new Error("Could not read media duration");
const vid=pr.streams.some(s=>s.codec_type==="video"&&s.disposition?.attached_pic!==1)?1:0;
    if(!pr.streams.some(s=>s.codec_type==="audio"))throw new Error("Recording has no audio stream");
    db.prepare("UPDATE lectures SET duration=?,has_video=? WHERE id=?").run(dur,vid,id);
setStage(id,"inspect","done",`${fmt(dur)} ${vid?"video":"audio-only"}`);
    // Slide decks are optional. If supplied, extract their pages; otherwise the
    // analysis stage will create transcript-derived lecture sections after speech is available.
    if(sf){
      setStage(id,"slides","running");
      let pdf=sf;
      if(l.slides_ext==="pptx"){
        await run("soffice",["--headless","--convert-to","pdf","--outdir",d,sf],{env:{...globalThis.process.env,HOME:d}});
        pdf=path.join(d,"slides.pdf");
      }
      const info=await run("pdfinfo",[pdf]);
      const pages=+/Pages:\s+(\d+)/.exec(info)[1];
      await run("pdftoppm",["-png","-r","60",pdf,path.join(d,"slide")]);
      db.prepare("DELETE FROM slides WHERE lecture_id=?").run(id);
      for(let n=1;n<=pages;n++){
        const t=(await run("pdftotext",["-f",n,"-l",n,"-layout",pdf,"-"])).replace(/\s+\n/g,"\n").trim();
        const lines=t.split("\n").map(x=>x.trim()).filter(Boolean);
        const img=fs.readdirSync(d).find(f=>new RegExp(`^slide-0*${n}\\.png$`).test(f));
        db.prepare("INSERT INTO slides VALUES(?,?,?,?,?,?,?)").run(uid(),id,n,lines[0]||`Slide ${n}`,t,img?1:0,t?"completed":"no_text");
        if(!t)warnings++;
      }
      setStage(id,"slides","done",`${pages} slides extracted`);
    }else{
      db.prepare("DELETE FROM slides WHERE lecture_id=?").run(id);
      db.prepare("DELETE FROM transitions WHERE lecture_id=?").run(id);
      setStage(id,"slides","done","No presentation supplied; lecture sections will be generated from the transcript.");
    }
    // For video + slide deck uploads, detect real scene changes and conservatively
    // match extracted video frames to the supplied slide images. Text alignment remains
    // the fallback when the visual match is uncertain or optional Python imaging is absent.
    if(vid && sf && l.slides_ext){
      try{
        const visualPath=path.join(d,"video-slide-matches.json");
        const py=String(LOCAL_TRANSCRIPTION_PYTHON).toLowerCase()==="py"?"py":LOCAL_TRANSCRIPTION_PYTHON;
        const pyArgs=py==="py"?["-3"]:[];
        await run(py,[...pyArgs,path.join(ROOT,"scripts","detect_video_slides.py"),media,d,visualPath]);
        const visual=JSON.parse(fs.readFileSync(visualPath,"utf8"));
        db.prepare("DELETE FROM transitions WHERE lecture_id=? AND source LIKE 'video_frame_visual%'").run(id);
        let matched=0;
        for(const item of visual.transitions||[]){
          const slide=db.prepare("SELECT id FROM slides WHERE lecture_id=? AND n=?").get(id,item.slideNumber);
          if(!slide || !Number.isFinite(item.timestamp)) continue;
          db.prepare("INSERT OR REPLACE INTO transitions(slide_id,lecture_id,ts,source,confidence,evidence) VALUES(?,?,?,?,?,?)")
            .run(slide.id,id,item.timestamp,"video_frame_visual_perceptual_match",item.confidence,JSON.stringify({method:visual.method||"FFmpeg scene detection",slideNumber:item.slideNumber}));
          matched++;
        }
        setStage(id,"slides","done",`${db.prepare("SELECT COUNT(*) c FROM slides WHERE lecture_id=?").get(id).c} slides extracted; ${matched} visual slide transition(s) matched from video frames${matched?"":"; transcript alignment will be used as fallback"}`);
      }catch(e){
        log("visual slide detection unavailable; using transcript alignment",e.message);
        setStage(id,"slides","done",sf?"Slides extracted; visual frame matching unavailable, transcript alignment will be used":"No slides supplied");
      }
    }
    // Prefer a user-supplied timestamped transcript, then a configured provider,
    // then free local Whisper transcription. No slide deck is required for any path.
    let segCount=db.prepare("SELECT COUNT(*) c FROM segments WHERE lecture_id=? AND status='completed'").get(id).c;
    if(!segCount){
      setStage(id,"transcribe","running");
      if(TKEY){
        setStage(id,"audio","running");
        const cd=path.join(d,"chunks");
        fs.rmSync(cd,{recursive:true,force:true});fs.mkdirSync(cd);
        await run("ffmpeg",["-v","error","-i",media,"-vn","-ac","1","-ar","16000","-b:a","32k","-f","segment","-segment_time","600","-reset_timestamps","1",path.join(cd,"c%04d.mp3")]);
        setStage(id,"audio","done","Audio prepared for transcription");
        const files=fs.readdirSync(cd).sort();let i=0;
        for(const f of files){
          const off=i*600,end=Math.min(dur,off+600);i++;
          try{
            const ss=await transcribeChunk(path.join(cd,f),off,id);
            for(const seg of ss)db.prepare("INSERT INTO segments VALUES(?,?,?,?,?,?,NULL,0)").run(uid(),id,seg.startTime,seg.endTime,seg.text,"completed");
          }catch(e){warnings++;addErr(id,"transcribe",`chunk ${i} (${fmt(off)}-${fmt(end)}): ${e.message}`);db.prepare("INSERT INTO segments VALUES(?,?,?,?,?,?,?,0)").run(uid(),id,off,end,"","failed",e.message.slice(0,200));}
        }
        // One automatic recovery pass for failed chunks. Each retry is isolated so
        // already-transcribed chunks are never repeated or duplicated.
        const failedChunks=db.prepare("SELECT * FROM segments WHERE lecture_id=? AND status='failed' ORDER BY start").all(id);
        for(const failed of failedChunks){
          const chunkIndex=Math.round(failed.start/600),chunkFile=files[chunkIndex];
          if(!chunkFile)continue;
          try{
            const recovered=await transcribeChunk(path.join(cd,chunkFile),failed.start,id);
            if(!recovered.length)throw new Error("Retry returned no speech segments");
            db.prepare("DELETE FROM segments WHERE id=?").run(failed.id);
            for(const seg of recovered)db.prepare("INSERT INTO segments VALUES(?,?,?,?,?,?,NULL,0)").run(uid(),id,seg.startTime,seg.endTime,seg.text,"completed");
            warnings=Math.max(0,warnings-1);
            log("recovered transcription chunk",id,chunkIndex+1);
          }catch(e){addErr(id,"transcribe_retry",`chunk ${chunkIndex+1} retry failed: ${e.message}`);}
        }
        db.prepare("UPDATE lectures SET transcript_source=? WHERE id=?").run("provider:"+TMODEL,id);
        setStage(id,"transcribe","done","Transcript generated by the configured speech provider");
      }else if(LOCAL_TRANSCRIPTION_ENABLED){
        setStage(id,"audio","running","Using local Whisper on this computer; the first run downloads the model.");
        const transcriptPath=path.join(d,"local-transcript.json");
        try{
          const result=await transcribeLocally(media,transcriptPath);
          const insert=db.prepare("INSERT INTO segments VALUES(?,?,?,?,?,?,NULL,0)");
          for(const seg of result.segments){
            const start=Number(seg.start),end=Number(seg.end),text=String(seg.text||"").trim();
            if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&text)insert.run(uid(),id,start,end,text,"completed");
          }
          segCount=db.prepare("SELECT COUNT(*) c FROM segments WHERE lecture_id=? AND status='completed'").get(id).c;
          if(!segCount)throw new Error("Local Whisper did not detect usable speech in this recording.");
          db.prepare("UPDATE lectures SET transcript_source=? WHERE id=?").run(`local:faster-whisper:${LOCAL_TRANSCRIPTION_MODEL}:${result.language||"auto"}`,id);
          setStage(id,"audio","done",`Local Whisper detected ${result.language||"the lecture language"}`);
          setStage(id,"transcribe","done",`${segCount} timestamped transcript segments generated on this computer`);
        }catch(e){
          const detail=String(e.message||e);
          const hint=/No module named|ModuleNotFoundError/i.test(detail)
            ? " faster-whisper is not installed. From the project folder, run .\\scripts\\setup-local-transcription.ps1 in PowerShell, then restart LectureLens."
            : /ENOENT|not recognized|spawn/i.test(detail)
              ? " Python was not found. Install Python 3.9+ from python.org, enable Add Python to PATH, restart VS Code, then run .\\scripts\\setup-local-transcription.ps1."
              : " Check the recording audio, internet access for the first model download, available RAM, and local Whisper setup.";
          const message=`Automatic local transcription could not run: ${detail.slice(0,260)}.${hint}`;
          setStage(id,"audio","blocked",message);
          setStage(id,"transcribe","blocked",message);
          db.prepare("UPDATE lectures SET status='needs_transcript' WHERE id=?").run(id);
          return;
        }
      }else{
        const message="No transcript was supplied and local transcription is disabled. Enable LOCAL_TRANSCRIPTION_ENABLED or upload a timestamped .vtt/.srt transcript.";
        setStage(id,"transcribe","blocked",message);
        db.prepare("UPDATE lectures SET status='needs_transcript' WHERE id=?").run(id);
        return;
      }
    }else{
      setStage(id,"transcribe","done","Using the supplied timestamped transcript");
      db.prepare("UPDATE lectures SET transcript_source=COALESCE(transcript_source,'user-supplied transcript file') WHERE id=?").run(id);
    }
    await analyse(id,warnings);
  }catch(e){addErr(id,L()?.stage||"?",e.message);
db.prepare("UPDATE lectures SET status='failed' WHERE id=?").run(id);
const st=L()?.stage;
if(st)setStage(id,st,"failed",e.message.slice(0,200))}
  finally{running.delete(id)}}
async function analyse(id,warnings=0){ // align -> grounded notes -> quiz -> validate
  const l=db.prepare("SELECT * FROM lectures WHERE id=?").get(id);
  const segs=sortSegs(db.prepare("SELECT * FROM segments WHERE lecture_id=?").all(id).map(r=>({id:r.id,startTime:r.start,endTime:r.end,text:r.text,processingStatus:r.status})));
  let slides=db.prepare("SELECT * FROM slides WHERE lecture_id=? ORDER BY n").all(id).map(r=>({id:r.id,slideNumber:r.n,title:r.title,text:r.text,processingStatus:r.status}));
  setStage(id,"align","running");
const good=segs.filter(s=>s.processingStatus==="completed");
let alignment;
if(!slides.length&&good.length){
  slides=createTranscriptSections(id,good);
  alignment={transitions:slides.map(s=>({slideId:s.id,timestamp:s.startTime,source:"transcript_section_marker",confidence:1,evidence:[]})),method:"transcript_sections",reason:"No presentation was supplied; sections were created from timestamped transcript text."};
}else if(slides.length&&slides.every(s=>s.processingStatus==="transcript_section")){
  alignment={transitions:slides.map(s=>({slideId:s.id,timestamp:s.startTime,source:"transcript_section_marker",confidence:1,evidence:[]})),method:"transcript_sections",reason:"Lecture sections were derived from the transcript."};
}else{
  alignment=alignSemantically
    ? await alignSemantically(good,slides)
    : {transitions:align(good,slides),method:"text_overlap_fallback",reason:"Semantic alignment service unavailable."};
}
const tr = alignment.transitions;
  db.prepare("DELETE FROM transitions WHERE lecture_id=? AND source NOT LIKE 'manual%' AND source NOT LIKE 'video_frame_visual%'").run(id);
  const manual=new Map(db.prepare("SELECT * FROM transitions WHERE lecture_id=?").all(id).map(r=>[r.slide_id,r]));
  for(const t of tr)if(!manual.has(t.slideId))db.prepare("INSERT INTO transitions VALUES(?,?,?,?,?,?)").run(t.slideId,id,t.timestamp,l.has_video?t.source+"; visual frame matching not implemented":t.source+"; audio-only",t.confidence,JSON.stringify(t.evidence));
  const alignmentMessage = alignment.method === "semantic_embeddings"
    ? `Semantic embeddings (${alignment.model || "configured model"}); cosine similarity threshold applied`
    : alignment.method === "transcript_sections"
      ? `Transcript-derived lecture sections; ${alignment.reason || "no presentation supplied"}`
      : `Text-overlap fallback; ${alignment.reason || "semantic embeddings unavailable"}`;
  setStage(id,"align","done",alignmentMessage);
  const finalTr=db.prepare("SELECT * FROM transitions WHERE lecture_id=?").all(id).map(r=>({slideId:r.slide_id,timestamp:r.ts}));
  setStage(id,"notes","running");
db.prepare("DELETE FROM notes WHERE lecture_id=?").run(id);
  const baseNotes=makeNotes(good,slides,finalTr);
const notes=await improveNotesWithAI(baseNotes,good,slides);
  for(const n of notes)db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?)").run(uid(),id,n.type,n.startTime,n.slideId,n.source,JSON.stringify(n.segmentIds),n.text);
  const aiNoteCount=notes.filter(n=>String(n.source||"").startsWith("AI-generated")).length;
  setStage(id,"notes","done",aiNoteCount?`${aiNoteCount} AI-generated explanation(s); remaining notes are source-based`:(AKEY?"AI provider unavailable or no eligible sections; source-based notes used":"source-based notes (AI_API_KEY not configured)"));
  setStage(id,"quiz","running");
db.prepare("DELETE FROM questions WHERE lecture_id=?").run(id);
  const baseQuiz=makeQuiz(good,slides,finalTr,l.quiz_count);
const quiz=await improveQuizWithAI(baseQuiz,good,slides,finalTr,l.quiz_count);
  for(const q of quiz)db.prepare("INSERT INTO questions VALUES(?,?,?)").run(uid(),id,JSON.stringify(q));
  setStage(id,"quiz","done",quiz.length?(AKEY&&quiz!==baseQuiz?`${quiz.length} AI-generated conceptual question(s) with source references`:`${quiz.length} validated question(s)`):(AKEY?"No quiz generated: AI provider unavailable or lecture content was insufficient for reliable questions":"No quiz generated: the transcript did not contain enough clear definitions to build a reliable source-based quiz"));
  setStage(id,"validate","running");
const bad=segs.filter(s=>s.processingStatus!=="completed").length,unc=finalTr.filter(t=>t.timestamp==null).length;
  db.prepare("UPDATE lectures SET status=? WHERE id=?").run(warnings||bad||unc||!good.length?"completed_with_warnings":"completed",id);
setStage(id,"validate","done");
}
  return { processLecture, analyse, isRunning: (lectureId) => running.has(lectureId) };
}
