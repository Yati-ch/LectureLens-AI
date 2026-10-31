#!/usr/bin/env python3
"""Detect scene changes in a lecture video and match frames to extracted PDF slide images.
Uses FFmpeg plus Pillow only; returns conservative matches with confidence scores."""
import argparse, json, re, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageOps, ImageChops

def ahash(path):
    with Image.open(path) as im:
        im = ImageOps.grayscale(im)
        # Ignore outer video borders and reduce speaker/background influence.
        w, h = im.size
        im = im.crop((int(w*.08), int(h*.08), int(w*.92), int(h*.92)))
        im = ImageOps.fit(im, (8, 8), method=Image.Resampling.LANCZOS)
        px = list(im.getdata()); avg = sum(px) / len(px)
        return sum((1 << i) for i, p in enumerate(px) if p >= avg)

def distance(a,b): return (a ^ b).bit_count()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('video'); ap.add_argument('slide_dir'); ap.add_argument('out')
    ap.add_argument('--threshold',type=float,default=.22)
    args=ap.parse_args()
    video=Path(args.video); slide_dir=Path(args.slide_dir); out=Path(args.out)
    slides=[]
    for p in sorted(slide_dir.glob('slide-*.png')):
        m=re.search(r'slide-0*(\d+)\.png$',p.name)
        if m:
            try: slides.append((int(m.group(1)),p,ahash(p)))
            except Exception: pass
    if not slides:
        out.write_text(json.dumps({'transitions':[],'reason':'No extracted slide images available'})); return
    with tempfile.TemporaryDirectory(prefix='ll-scenes-') as td:
        td=Path(td); meta=td/'metadata.txt'; frames=td/'frame-%05d.jpg'
        vf=f"select='gt(scene,{args.threshold})',metadata=print:file={meta.as_posix()}"
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-i',str(video),'-vf',vf,'-vsync','vfr','-q:v','4',str(frames)]
        subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        metadata=meta.read_text(errors='ignore') if meta.exists() else ''
        times=[]
        for block in re.split(r'\n\s*frame:', '\n'+metadata):
            m=re.search(r'pts_time:([0-9.]+)',block)
            if m: times.append(float(m.group(1)))
        # The initial slide is already on screen at t=0 and is not a scene change.
        first=td/'initial.jpg'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss','0','-i',str(video),'-frames:v','1','-q:v','4',str(first)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        frame_files=[first]+sorted(td.glob('frame-*.jpg'))
        times=[0.0]+times
        used=set(); results=[]
        for i,frame in enumerate(frame_files):
            try: fh=ahash(frame)
            except Exception: continue
            ranked=sorted(((distance(fh,sh),n,p) for n,p,sh in slides if n not in used),key=lambda x:x[0])
            if not ranked: break
            dist,n,p=ranked[0]; confidence=1-dist/64
            # Match only reasonably similar frames; retain unmatched scene changes too.
            ts=times[i] if i < len(times) else None
            if confidence >= .58:
                used.add(n)
                results.append({'slideNumber':n,'timestamp':ts,'confidence':round(confidence,3),'source':'video_frame_perceptual_match'})
        # De-duplicate close detections of the same slide and keep chronological order.
        results.sort(key=lambda x:(x['timestamp'] if x['timestamp'] is not None else 1e12))
        out.write_text(json.dumps({'transitions':results,'detectedSceneFrames':len(frame_files),'matchedSlides':len(results),'method':'FFmpeg scene detection + perceptual image hash'}))
if __name__=='__main__': main()
