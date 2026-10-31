# LectureLens AI — Judge Demo Walkthrough

## Open the demo

1. Start the application locally with `npm start`, or use `docker compose up --build`.
2. Open `http://localhost:3000`.
3. Select **Try the judge demo**. No registration or password is required.
4. A short **guided tour** card appears (bottom-right). Follow it, or press **Skip tour**; **Take the tour** replays it anytime.

The offline build does not require an AI API key. Notes are structured from the saved lecture transcript and source material; optional provider credentials enable richer AI explanations. Offline quiz generation is deliberately conservative: it only creates multiple-choice questions when it can extract at least four clear definitions from the lecture, using other definitions from that same lecture as distractors. If the transcript does not contain enough definitions, the quiz stays empty rather than inventing unrelated questions.

The demo opens a separate `Judge Demo` account. Its three bundled learning lessons are curated text-based study material, not uploaded recordings. The Operating Systems lesson includes a small, preloaded quiz-history scenario built from the lesson's actual quiz questions and answer options.

**Transparency:** The preloaded quiz history is illustrative walkthrough data, not a real student's academic record or measured product result. The application discloses this in the demo banner, Revision Radar, and Learning Coach. New quiz attempts you submit are saved only to your own private sandbox and are deleted with it after 24 hours. Do not upload personal or private lecture material to this shared account.

## Suggested 2–3 minute walkthrough

1. **My Lectures:** Open *Operating Systems: CPU Scheduling* and point out that the lesson has sections, source passages, notes, and questions ready to explore.
2. **AI Notes:** Show the structured explanations, visual study aids, and source links back to lesson sections.
3. **Quiz:** Open the lecture quiz, deliberately choose an incorrect option for one question, and submit the attempt.
4. **Why did I get this wrong?:** In the answer review, select **Explain why I got this wrong**. Show the selected answer beside the verified answer, the explanation, and the linked source passage. Use **Open source section** to jump to the supporting transcript section. If an AI provider is configured, the explanation is AI-assisted; otherwise the app clearly uses the saved question explanation and source evidence.
5. **Revision Radar:** Show topic-level answer counts, accuracy, and source references.
6. **Learning Coach:** Refresh the plan and show how saved answers influence the recommended review/practice tasks.
7. **Try a focused practice:** Use a topic-level practice action, submit the short quiz, then refresh the Coach/Radar to show the saved data changing.

## Demo boundaries

- Each demo click creates a private sandbox that is deleted after 24 hours; it is not a persistent account.
- Preloaded quiz records are explicitly marked in the database table `demo_preview_attempts`.
- Preloaded activity is illustrative and should not be quoted as real user research, learning gains, adoption, or validation.
- The demo protects its bundled lecture material from deletion, renaming, uploads, and reprocessing. Visitors can still submit quiz attempts.
- Create a normal student account to explore personal uploads and editing for a persistent personal workspace.
- Set `DEMO_ENABLED=false` in `.env` to remove the one-click demo entry point and disable the demo endpoint.


### Semantic alignment note

The preloaded judge lessons use curated section markers and therefore do not call the embeddings service. To demonstrate semantic slide/transcript alignment, upload a real slide deck with a matching timestamped transcript and configure `EMBEDDINGS_API_KEY` separately for a provider that supports `/embeddings`. `AI_API_KEY` is not reused automatically. After processing, open the lecture's Slide timeline and choose **Re-analyse lecture** to apply the current embeddings settings to an existing uploaded lecture. This rebuilds slide timing, notes and quiz material from the stored source files. If embeddings are unavailable, the application falls back to text overlap and records that method in the lecture processing report. Only use a provider you trust with the lecture text you upload.


## Visual slide synchronization demo
- Upload an MP4 lecture recording together with its PDF/PPTX slide deck.
- The processing pipeline extracts the slide images, detects scene changes in the video with FFmpeg, and compares candidate frames with the extracted slides using perceptual image hashes.
- Clear matches appear as timestamped slide transitions. Uncertain matches are skipped and transcript-based alignment remains the fallback.
- For a recording without a slide deck, demonstrate the recording-only path: timestamped transcript-derived sections, notes and quiz generation.
