import { spawn } from "node:child_process";

export class HttpError extends Error {
  constructor(code, message, headers = {}) {
    super(message);
    this.code = code;
    this.headers = headers;
  }
}

/** Defensive headers added to every response. The CSP only restricts framing, plugins and form targets, so it cannot break the app's own scripts or styles. */
export function securityHeaders(production = false) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(self), geolocation=()",
    "content-security-policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
    ...(production ? { "strict-transport-security": "max-age=15552000" } : {}),
  };
}

export function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req, maxBytes = 1_000_000) {
  let totalBytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) throw new HttpError(413, "Body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}
