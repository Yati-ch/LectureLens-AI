import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRecoveryCode, normalizeRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from "../lib/recovery.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-rec-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.RECOVER_RATE_LIMIT_MAX = "20";
delete process.env.TRANSCRIPTION_API_KEY; delete process.env.AI_API_KEY; delete process.env.EMBEDDINGS_API_KEY;
const { server, closeDatabase } = await import("../server.mjs");
await new Promise((r) => server.listen(0, r));
const B = "http://localhost:" + server.address().port;
const call = async (p, cookie, o = {}) => {
  const r = await fetch(B + p, { ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) } });
  const sc = r.headers.get("set-cookie"); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, cookie: sc ? sc.split(";")[0] : cookie };
};
const post = (p, cookie, b = {}) => call(p, cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

test("recovery codes are well-formed, unique, and verify regardless of typing style", () => {
  const a = generateRecoveryCode(), b = generateRecoveryCode();
  assert.match(a, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.ok(!/[01OIL]/.test(a));
  assert.notEqual(a, b);
  const h = hashRecoveryCode(a);
  assert.ok(!h.includes(a.replaceAll("-", "")));
  assert.equal(verifyRecoveryCode(a.toLowerCase().replaceAll("-", " "), h), true);
  assert.equal(verifyRecoveryCode(b, h), false);
  assert.equal(normalizeRecoveryCode(" ab-cd 12 "), "ABCD12");
});

test("signup returns a one-time recovery code; the password can be reset with it and the code rotates", async () => {
  const email = "ria@example.com";
  const su = await post("/api/auth/signup", "", { name: "Ria Sharma", email, password: "originalpass1" });
  assert.equal(su.s, 201);
  const code1 = su.j.recoveryCode;
  assert.match(code1, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal((await call("/api/auth/me", su.cookie)).j.user.email, email);

  const bad = await post("/api/auth/recover", "", { email, recoveryCode: "AAAA-BBBB-CCCC-DDDD", newPassword: "newpassword9" });
  assert.equal(bad.s, 401);
  const unknown = await post("/api/auth/recover", "", { email: "nobody@example.com", recoveryCode: code1, newPassword: "newpassword9" });
  assert.equal(unknown.s, 401);
  assert.equal(unknown.j.error, bad.j.error, "unknown email and wrong code must be indistinguishable");
  assert.equal((await post("/api/auth/recover", "", { email, recoveryCode: code1, newPassword: "short" })).s, 422);

  const ok = await post("/api/auth/recover", "", { email, recoveryCode: code1.toLowerCase(), newPassword: "newpassword9" });
  assert.equal(ok.s, 200);
  const code2 = ok.j.recoveryCode;
  assert.notEqual(code2, code1);

  assert.equal((await call("/api/auth/me", su.cookie)).j.user, null, "old sessions are revoked");
  assert.equal((await post("/api/auth/login", "", { email, password: "originalpass1" })).s, 401);
  assert.equal((await post("/api/auth/login", "", { email, password: "newpassword9" })).s, 200);
  assert.equal((await post("/api/auth/recover", "", { email, recoveryCode: code1, newPassword: "another-pass1" })).s, 401, "used code no longer works");
  assert.equal((await post("/api/auth/recover", "", { email, recoveryCode: code2, newPassword: "another-pass1" })).s, 200);
});

test("signed-in students can regenerate their code, but only with their password", async () => {
  const email = "dev@example.com";
  const su = await post("/api/auth/signup", "", { name: "Dev Patel", email, password: "devpassword1" });
  const old = su.j.recoveryCode;
  assert.equal((await post("/api/auth/recovery-code", su.cookie, { password: "wrong-password" })).s, 401);
  assert.equal((await post("/api/auth/recovery-code", "", { password: "devpassword1" })).s, 401, "must be signed in");
  const fresh = await post("/api/auth/recovery-code", su.cookie, { password: "devpassword1" });
  assert.equal(fresh.s, 200);
  assert.notEqual(fresh.j.recoveryCode, old);
  assert.equal((await post("/api/auth/recover", "", { email, recoveryCode: old, newPassword: "xxxxxxxx1" })).s, 401);
});

test("judge sandboxes cannot use recovery", async () => {
  const demo = await post("/api/auth/demo", "");
  assert.equal(demo.s, 200);
  assert.equal((await post("/api/auth/recovery-code", demo.cookie, { password: "anything123" })).s, 403);
  assert.equal((await post("/api/auth/recover", "", { email: demo.j.user.email, recoveryCode: "AAAA-AAAA-AAAA-AAAA", newPassword: "newpassword9" })).s, 401);
});

test("recovery attempts are rate limited", async () => {
  let last;
  for (let i = 0; i < 30; i++) last = await post("/api/auth/recover", "", { email: "x@example.com", recoveryCode: "AAAA-AAAA-AAAA-AAAA", newPassword: "newpassword9" });
  assert.equal(last.s, 429);
});

test("login page exposes the forgot-password flow", async () => {
  const html = await (await fetch(B + "/")).text();
  assert.match(html, /Forgot password\?/);
  assert.match(html, /Save your recovery code/);
});

test.after(async () => { await new Promise(resolve => server.close(resolve)); closeDatabase(); fs.rmSync(tmp, { recursive: true, force: true }); });
