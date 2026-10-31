import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ll-rate-http-"));
process.env.DATA_DIR = path.join(tempDirectory, "data");
process.env.DEMO_ENABLED = "false";
process.env.LOGIN_RATE_LIMIT_MAX = "2";
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";

const { server, closeDatabase } = await import("../server.mjs");
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function attemptLogin() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.com", password: "incorrect-password" }),
  });
  return response;
}

test("login endpoint returns 429 and Retry-After after the configured limit", async () => {
  const first = await attemptLogin();
  const second = await attemptLogin();
  const third = await attemptLogin();

  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) >= 1);
  const payload = await third.json();
  assert.match(payload.error, /too many attempts/i);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});
