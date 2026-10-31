import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, clientAddress } from "../lib/rate-limit.mjs";

test("rate limiter allows the configured number of requests and returns a retry delay", () => {
  let currentTime = 1_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => currentTime });

  assert.equal(limiter.consume("login:127.0.0.1").allowed, true);
  assert.equal(limiter.consume("login:127.0.0.1").remaining, 0);
  const blocked = limiter.consume("login:127.0.0.1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  currentTime += 60_000;
  assert.equal(limiter.consume("login:127.0.0.1").allowed, true);
});

test("rate-limit buckets are independent per key", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 5_000 });
  assert.equal(limiter.consume("login:192.0.2.1").allowed, true);
  assert.equal(limiter.consume("login:192.0.2.1").allowed, false);
  assert.equal(limiter.consume("login:192.0.2.2").allowed, true);
});

test("forwarded IP is ignored unless a trusted proxy is configured", () => {
  const req = {
    headers: { "x-forwarded-for": "198.51.100.12, 203.0.113.9" },
    socket: { remoteAddress: "10.0.0.4" },
  };
  assert.equal(clientAddress(req), "10.0.0.4");
  assert.equal(clientAddress(req, true), "203.0.113.9");
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pruneRateLimits } from "../lib/rate-limit.mjs";

test("persistent limiter keeps counting across a restart and never stores raw IPs", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ll-rl-")), "rl.db");
  let t = 10_000;
  const first = new DatabaseSync(file);
  const a = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t, db: first });
  assert.equal(a.consume("login:203.0.113.7").allowed, true);
  assert.equal(a.consume("login:203.0.113.7").allowed, true);
  first.close();

  const second = new DatabaseSync(file); // simulates a server restart
  const b = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t, db: second });
  const blocked = b.consume("login:203.0.113.7");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(b.consume("login:198.51.100.1").allowed, true, "other clients are unaffected");
  const stored = second.prepare("SELECT key FROM rate_limits").all().map((r) => r.key).join(" ");
  assert.ok(!stored.includes("203.0.113.7"), "raw IP must not be stored");

  t += 60_000; // window expires
  assert.equal(b.consume("login:203.0.113.7").allowed, true);
  second.close();
});

test("pruneRateLimits removes expired counters and enforces a row cap", () => {
  const db = new DatabaseSync(":memory:");
  let t = 1_000;
  const l = createRateLimiter({ limit: 5, windowMs: 1_000, now: () => t, db });
  for (let i = 0; i < 5; i++) l.consume("k" + i);
  assert.equal(l.size, 5);
  assert.equal(pruneRateLimits(db, { now: t, maxRows: 3 }), 2);
  assert.equal(l.size, 3);
  assert.equal(pruneRateLimits(db, { now: t + 5_000 }), 3);
  assert.equal(l.size, 0);
});

import { createSessionService } from "../lib/sessions.mjs";

test("expired sessions are pruned and live ones are kept", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires INT,created INT)");
  const insert = db.prepare("INSERT INTO sessions VALUES(?,?,?,?)");
  insert.run("old", "u", 1_000, 0);
  insert.run("live", "u", 9_000_000, 0);
  const { pruneExpiredSessions } = createSessionService({ db });
  assert.equal(pruneExpiredSessions(5_000), 1);
  assert.deepEqual(db.prepare("SELECT token_hash FROM sessions").all().map((r) => r.token_hash), ["live"]);
});
