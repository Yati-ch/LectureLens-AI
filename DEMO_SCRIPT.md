# LectureLens AI: 2-Minute Demo Script and Pitch

Open the live URL a few minutes beforehand so the server is awake. Run `npm run smoke -- <your-url>` once; if it prints "All checks passed", you are ready.

## The one-sentence pitch
"Most study tools tell you that you got a question wrong. LectureLens AI shows you why, and takes you to the exact moment in your lecture that explains it."

## Demo flow (about 2 minutes)

| Time | Do | Say |
|---|---|---|
| 0:00 | Open the site and press **Try the judge demo**. | "Students lose hours rewatching lectures to find one explanation. No signup is needed here; every judge gets a private sandbox." |
| 0:15 | Follow the tour card, or open the **Operating Systems** lesson. | "LectureLens organizes a recording into timestamped sections, structured revision notes and source-linked practice questions when the lecture contains enough clear material." |
| 0:30 | Go to **Quizzes**, answer, and pick a wrong answer on purpose. | "Here's the moment every other tool stops. I got this wrong." |
| 0:55 | Press **Explain why I got this wrong**. | "It compares my answer with the lecture-supported one, and shows the transcript passage it is based on, so I can verify it instead of trusting an AI." |
| 1:15 | Press the source button to jump to the lecture moment. | "One click and I'm at the exact 18 seconds that explains it. That's the loop: wrong answer, explanation, evidence, lecture." |
| 1:35 | Open **Revision Radar**. | "My answers become a revision plan: which topics to review first." |
| 1:50 | Close. | "It works without any AI key, using the lecture's own text. With a key it writes richer explanations. And it's honest about what it knows: no fake scores." |

## Pitch outline (if you get 3 to 5 minutes)
1. **Problem.** Students rewatch hours of lectures to find one answer; quiz apps say "wrong" and stop there.
2. **Insight.** A wrong answer is the best moment to teach, if you can point to the exact source.
3. **Solution.** The wrong-answer-to-source loop, plus notes, quizzes and Revision Radar built on the same transcript.
4. **Why it can be trusted.** Every explanation is grounded in transcript evidence; "Not assessed" instead of invented scores; demo data is labelled as illustrative.
5. **Engineering.** 50+ automated tests, semantic alignment with an evaluation script, per-visitor sandboxes, persistent rate limiting, recovery codes, security headers, Docker deployment.
6. **Next.** Email verification, spaced repetition, a central rate-limit store for multi-machine hosting.

## Likely judge questions (honest answers)
- **"Is the AI doing the explaining?"** Optionally. Without an API key it uses the question's saved explanation plus the linked transcript passage, and the UI says which one you are seeing.
- **"Is the quiz history real?"** In the judge sandbox it is illustrative demo data, and it is labelled that way on screen.
- **"How do you avoid made-up explanations?"** Evidence comes from the lecture's own transcript; the explanation is shown beside it so the student can check it.
- **"Can it scale?"** One instance with SQLite today. Multi-machine hosting needs a central rate-limit store and a hosted database; both are on the roadmap.
- **"What if a student forgets their password?"** They use the recovery code shown at signup. Email-based reset is future work.

## If something goes wrong
- **Site slow on first load:** free/low plans sleep; refresh once and wait up to a minute.
- **"Too many attempts":** `TRUST_PROXY=true` is probably missing, so everyone shares one rate-limit bucket.
- **AI explanation unavailable:** the app falls back to the saved explanation and transcript evidence automatically; carry on.
- **Last resort:** record a 2-minute screen capture of the flow above and keep it ready.
