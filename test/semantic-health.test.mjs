import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ll-emb-health-"));
process.env.DATA_DIR = path.join(tempDirectory, "data");
process.env.DEMO_ENABLED = "false";
process.env.EMBEDDINGS_API_KEY = "test-embeddings-key";
delete process.env.AI_API_KEY;
const { server, closeDatabase } = await import("../server.mjs");
await new Promise((resolve) => server.listen(0, resolve));

test("health endpoint reports semantic embeddings as explicitly configured without exposing the key", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.semanticAlignmentConfigured, true);
  assert.equal(payload.semanticAlignmentModel, "text-embedding-3-small");
  assert.equal(JSON.stringify(payload).includes("test-embeddings-key"), false);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});
