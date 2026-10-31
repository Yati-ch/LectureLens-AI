#!/usr/bin/env node
/* Post-deploy smoke test: node scripts/smoke-test.mjs https://your-app.onrender.com
   Walks the judge flow against a live URL: health -> demo sandbox -> quiz -> wrong answer -> explanation with evidence. */
const base = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
let cookie = "", failures = 0;
const ok = (name, pass, detail = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!pass) failures++; };
async function call(path, { method = "GET", body } = {}) {
  const started = Date.now();
  const res = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { res, json, text, ms: Date.now() - started, set };
}

try {
  console.log(`Smoke-testing ${base}\n`);
  const page = await call("/");
  ok("home page loads", page.res.status === 200 && /LectureLens/.test(page.text), `${page.ms} ms`);
  ok("security headers present", page.res.headers.get("x-frame-options") === "SAMEORIGIN" && !!page.res.headers.get("content-security-policy"));
  if (base.startsWith("https://")) ok("HSTS enabled over HTTPS", !!page.res.headers.get("strict-transport-security"), "set NODE_ENV=production");

  const health = await call("/api/health");
  ok("health endpoint", health.res.status === 200 && health.json?.ok === true);
  ok("judge demo enabled", health.json?.demoEnabled === true, "DEMO_ENABLED must not be false");
  console.log(`      AI explanations: ${health.json?.aiGenerationConfigured ? "on" : "off (source-based fallback)"}, semantic alignment: ${health.json?.semanticAlignmentConfigured ? "on" : "off"}`);

  const demo = await call("/api/auth/demo", { method: "POST", body: {} });
  ok("judge sandbox created", demo.res.status === 200 && demo.json?.user?.isDemo === true, `${demo.ms} ms`);
  if (base.startsWith("https://")) ok("session cookie is Secure", /;\s*Secure/i.test(demo.set || ""), "set NODE_ENV=production");
  if (!demo.json?.user) throw new Error("cannot continue without a demo session (rate limited? check TRUST_PROXY=true)");

  const lectures = await call("/api/lectures");
  const os = Array.isArray(lectures.json) ? lectures.json.find((l) => /operating systems/i.test(l.title)) : null;
  ok("starter lessons seeded", Array.isArray(lectures.json) && lectures.json.length >= 3 && !!os, `${lectures.json?.length ?? 0} lessons`);
  if (!os) throw new Error("Operating Systems lesson missing");

  const lecture = await call(`/api/lectures/${os.id}`);
  const q = lecture.json?.questions?.[0];
  ok("quiz questions available", !!q, `${lecture.json?.questions?.length ?? 0} questions`);
  if (!q) throw new Error("no questions");

  const wrong = q.options.find((o) => o !== q.answer);
  const attempt = await call(`/api/lectures/${os.id}/attempts`, { method: "POST", body: { questionIds: [q.id], answers: { [q.id]: wrong } } });
  ok("wrong answer recorded", attempt.res.status === 201);

  const why = await call(`/api/lectures/${os.id}/questions/${q.id}/explain`, { method: "POST", body: { answer: wrong } });
  ok("wrong-answer explainer responds", why.res.status === 200 && why.json?.isCorrect === false && why.json?.correctAnswer === q.answer, `${why.ms} ms`);
  ok("explanation includes transcript evidence", why.json?.evidenceAvailable === true && why.json?.evidence?.length > 0);

  const radar = await call("/api/learning-coach");
  ok("revision coach responds", radar.res.status === 200 && radar.json?.metrics?.answersRecorded >= 1);

  const other = await fetch(base + `/api/lectures/${os.id}`);
  ok("lessons require a session", other.status === 401);
} catch (e) {
  ok("smoke test completed", false, e.message);
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed. Ready to demo.");
process.exit(failures ? 1 : 0);
