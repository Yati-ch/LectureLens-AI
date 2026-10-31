import crypto from "node:crypto";

/** Session persistence and cookie helpers. Session tokens are only stored as SHA-256 hashes. */
export function createSessionService({ db, production = false }) {
  const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

  function cookieToken(req) {
    const cookie = String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("ll_session="));
    return cookie ? decodeURIComponent(cookie.slice("ll_session=".length)) : "";
  }

  function currentUser(req) {
    const token = cookieToken(req);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = db.prepare(`
      SELECT u.id, u.email, u.name, u.is_demo, s.expires
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash);
    if (!row || row.expires < Date.now()) {
      if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    return row;
  }

  function setSession(res, token) {
    const secure = production ? "; Secure" : "";
    res.setHeader("Set-Cookie", `ll_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`);
  }

  function clearSession(res) {
    const secure = production ? "; Secure" : "";
    res.setHeader("Set-Cookie", `ll_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
  }

  /** Remove expired session rows so the table does not grow forever. */
  function pruneExpiredSessions(now = Date.now()) {
    return Number(db.prepare("DELETE FROM sessions WHERE expires < ?").run(now).changes);
  }

  return { hashToken, cookieToken, currentUser, setSession, clearSession, pruneExpiredSessions };
}
