# Upload one lecture recording

LectureLens AI is intended to start from **one lecture recording**. A student does not have to provide a presentation deck or transcript.

## What the student uploads

- **Required:** one audio/video recording (`.mp3`, `.wav`, `.m4a`, `.mp4`, or `.webm`).
- **Optional:** slides (`.pdf` or `.pptx`). If slides are supplied, LectureLens AI extracts their text/images and attempts to align them with the transcript.
- **Optional:** a timestamped transcript (`.vtt` or `.srt`). Supplying one skips automatic speech-to-text.

When slides are not supplied, LectureLens AI creates timestamped **lecture sections** from the transcript. These are transcript-derived sections, not fabricated slides or images.

## Enable free automatic transcription on Windows

Automatic transcription uses the open-source `faster-whisper` package on the computer running the LectureLens AI Node.js server. It translates supported spoken languages into English by default, including Hindi lectures. No paid transcription API key is required.

1. Install Python 3.9 or newer from [python.org](https://www.python.org/downloads/windows/). During installation, enable **Add python.exe to PATH**.
2. Open PowerShell in the project folder (the folder containing `package.json`).
3. Run:

   ```powershell
   .\scripts\setup-local-transcription.ps1
   ```

4. The setup script installs `faster-whisper` from `requirements-local.txt`.
5. Start or restart LectureLens AI:

   ```powershell
   npm start
   ```

6. On the first transcription, the `base` Whisper model is downloaded once. Internet is needed for that initial download. Later transcription inference runs locally.

The included configuration uses CPU/int8 and the `base` model to be more practical on an 8 GB RAM laptop. Processing time depends on the CPU, recording length, and audio quality; longer lectures can take a while. Close other heavy applications while transcribing.

## Upload and study flow

1. Sign in with a normal student account (the shared Judge Demo workspace is read-only for lecture uploads).
2. Open **Upload Lecture**.
3. Choose the recording, enter a title, and optionally choose slides or a VTT/SRT transcript.
4. Select **Generate my study workspace**.
5. Wait for the processing stages to complete. Local transcription creates timestamped transcript segments; LectureLens AI then groups them into navigable sections and generates source-based notes and quiz questions.
6. Open the lecture workspace, review AI Notes, and take the quiz.
7. **Revision Radar** and the **Learning Coach** use saved quiz answers. Before the first quiz, topics correctly show **Not assessed**; they should not display made-up scores.

## What works without paid API keys

- Local speech-to-text, once `faster-whisper` and its model have been installed.
- Transcript-derived lecture sections when there are no slides.
- Source-based notes and fallback quiz generation.
- Quiz attempt recording, Revision Radar, Learning Coach rules, and source-linked wrong-answer review.

An `AI_API_KEY` is optional. Without one, notes/questions use the app's source-based fallback, not an external generative AI model. An embeddings API key is also optional; without it, slide matching uses the lexical text-overlap fallback.

## Local versus hosted deployment

Local transcription runs wherever the backend runs. When a student runs LectureLens AI on their own computer, that is their computer. When LectureLens AI is hosted on Render or another cloud server, transcription would run on that server instead. The current Dockerfile does not bundle Python or `faster-whisper`, so automatic local transcription is **not enabled automatically in the current Docker deployment**. A hosted deployment needs a compatible image/server with Python, `faster-whisper`, sufficient memory and model storage, or a supplied VTT/SRT transcript / configured hosted transcription provider.

For data protection, use recordings and slides only when you have permission to process them. Do not use the shared Judge Demo for private lecture material.
