"""Local, no-API lecture transcription for LectureLens AI.

Uses faster-whisper on CPU with int8 quantization by default. The first run
may download the selected Whisper model from Hugging Face; inference then runs
locally on the student's machine.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="Path to an audio/video recording")
    parser.add_argument("output", help="Path for the JSON transcript output")
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--task", choices=("translate", "transcribe"), default="translate",
                        help="translate speech into English, or preserve the spoken language")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(
            "faster-whisper is not installed. Run: py -3 -m pip install -r requirements-local.txt",
            file=sys.stderr,
        )
        return 12

    try:
        cpu_count = os.cpu_count() or 2
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
            cpu_threads=max(1, min(4, cpu_count)),
            num_workers=1,
        )
        segments, info = model.transcribe(
            args.input,
            task=args.task,
            beam_size=1,
            best_of=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        rows = []
        for segment in segments:
            text = (segment.text or "").strip()
            start = float(segment.start)
            end = float(segment.end)
            if text and end > start:
                rows.append({"start": start, "end": end, "text": text})

        if not rows:
            print("No speech segments were detected in this recording.", file=sys.stderr)
            return 13

        payload = {
            "language": "en" if args.task == "translate" else getattr(info, "language", None),
            "detected_language": getattr(info, "language", None),
            "task": args.task,
            "language_probability": getattr(info, "language_probability", None),
            "model": args.model,
            "segments": rows,
        }
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=str(output.parent), delete=False, suffix=".tmp"
        ) as tmp:
            json.dump(payload, tmp, ensure_ascii=False)
            temp_name = tmp.name
        os.replace(temp_name, output)
        print(json.dumps({"segments": len(rows), "language": payload["language"], "model": args.model}))
        return 0
    except Exception as exc:  # return a concise diagnostic to the Node server
        print(f"Local transcription failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
