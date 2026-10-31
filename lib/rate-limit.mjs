import crypto from "node:crypto";

export const RATE_LIMIT_SCHEMA = `CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,started INT NOT NULL,count INT NOT NULL,window_ms INT NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_started ON rate_limits(started);`;

/**
 * Fixed-window rate limiter. Counters live in memory by default. Pass a node:sqlite `db` to persist them,
 * so limits survive restarts and are shared by processes using the same database file. Keys are hashed
 * before storage, so client IP addresses are never written to disk.
 */
export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000, db = null }) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  if (!Number.isFinite(windowMs) || windowMs < 1_000) throw new TypeError("windowMs must be at least 1000ms");

  const buckets = new Map();
  let upsert = null, countRows = null, clearRows = null;
  if (db) {
    db.exec(RATE_LIMIT_SCHEMA);
    upsert = db.prepare(`INSERT INTO rate_limits(key,started,count,window_ms) VALUES($key,$now,1,$win)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN $now - started >= window_ms THEN 1 ELSE count + 1 END,
        started = CASE WHEN $now - started >= window_ms THEN $now ELSE started END,
        window_ms = $win
      RETURNING started, count`);
    countRows = db.prepare("SELECT COUNT(*) AS n FROM rate_limits");
    clearRows = db.prepare("DELETE FROM rate_limits");
  }

  function consumePersistent(key, currentTime) {
    const row = upsert.get({ key: crypto.createHash("sha256").update(key).digest("hex"), now: currentTime, win: windowMs });
    if (row.count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((row.started + windowMs - currentTime) / 1000)) };
    }
    return { allowed: true, remaining: Math.max(0, limit - row.count), retryAfterSeconds: 0 };
  }

  function prune(currentTime) {
    if (buckets.size < maxKeys) return;
    for (const [key, bucket] of buckets) {
      if (currentTime - bucket.startedAt >= windowMs) buckets.delete(key);
    }
    // Keep memory bounded even when an attacker rotates identifiers.
    while (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
  }

  function consume(key) {
    const currentTime = now();
    const normalizedKey = String(key || "unknown").slice(0, 256);
    if (db) return consumePersistent(normalizedKey, currentTime);
    let bucket = buckets.get(normalizedKey);

    if (!bucket || currentTime - bucket.startedAt >= windowMs) {
      prune(currentTime);
      bucket = { startedAt: currentTime, count: 0 };
      buckets.set(normalizedKey, bucket);
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - currentTime) / 1000)),
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterSeconds: 0 };
  }

  return {
    consume,
    clear: () => { buckets.clear(); if (db) clearRows.run(); },
    get size() { return db ? countRows.get().n : buckets.size; },
  };
}

/** Only trust forwarded client addresses when the app sits behind a configured trusted proxy. */
export function clientAddress(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (forwarded.length) return forwarded.at(-1).slice(0, 128);
  }
  return String(req.socket?.remoteAddress || "unknown").slice(0, 128);
}

/** Delete expired persisted counters and cap the table size. Safe to call often. */
export function pruneRateLimits(db, { now = Date.now(), maxRows = 50_000 } = {}) {
  db.exec(RATE_LIMIT_SCHEMA);
  let removed = db.prepare("DELETE FROM rate_limits WHERE started + window_ms <= ?").run(now).changes;
  removed += db.prepare("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits ORDER BY started ASC LIMIT -1 OFFSET ?)").run(maxRows).changes;
  return Number(removed);
}
