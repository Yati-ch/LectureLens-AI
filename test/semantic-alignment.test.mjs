import test from "node:test";
import assert from "node:assert/strict";
import {
  cosineSimilarity,
  semanticAlign,
  requestEmbeddings,
  createSemanticAlignmentService,
} from "../lib/semantic-alignment.mjs";

const slide = (id, title, text = title) => ({ id, title, text });
const segment = (id, startTime, text) => ({ id, startTime, endTime: startTime + 10, text });

test("cosine similarity validates vectors and measures direction", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([1], [1, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), -1);
});

test("semantic alignment follows lecture order and leaves unsupported slides untimed", () => {
  const slides = [
    slide("s1", "CPU scheduling and time quantum"),
    slide("s2", "Database joins and relational keys"),
    slide("s3", "JavaScript promises and async await"),
  ];
  const segments = [
    segment("g1", 0, "The scheduler gives each process a fixed time slice"),
    segment("g2", 10, "After its quantum expires, a process returns to the ready queue"),
    segment("g3", 20, "A join combines rows from tables using related key values"),
    segment("g4", 30, "A completely unrelated announcement about next week's timetable"),
  ];
  // These vectors model semantic proximity: g1/g2 -> s1, g3 -> s2, no segment -> s3.
  const slideVectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const segmentVectors = [[0.99, 0.01, 0], [0.97, 0.03, 0], [0.01, 0.99, 0], [0, 0, 0]];
  const result = semanticAlign(segments, slides, segmentVectors, slideVectors, { minSimilarity: 0.8 });

  assert.equal(result[0].timestamp, 0);
  assert.equal(result[1].timestamp, 20);
  assert.equal(result[2].timestamp, null);
  assert.equal(result[2].source, "no_semantic_evidence");
  assert.deepEqual(result[0].evidence.map((item) => item.segmentId), ["g1", "g2"]);
  assert.ok(result[0].evidence.every((item) => item.similarity >= 0.8));
  const times = result.filter((item) => item.timestamp !== null).map((item) => item.timestamp);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(result.every((item) => String(item.source).startsWith("semantic_embedding_match (inferred") || item.timestamp === null));
});

test("semantic alignment does not invent timestamps below the threshold", () => {
  const slides = [slide("s1", "Photosynthesis"), slide("s2", "Cell respiration")];
  const segments = [segment("g1", 12, "A scheduling notice")];
  const result = semanticAlign(segments, slides, [[1, 0]], [[0, 1], [0, 0.9]], { minSimilarity: 0.8 });
  assert.ok(result.every((item) => item.timestamp === null && item.evidence.length === 0));
});

test("embedding requests preserve original order across batches and blank inputs", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    const data = request.input.map((text, index) => ({ index, embedding: [text.length, 1] })).reverse();
    return { ok: true, json: async () => ({ data }) };
  };
  const texts = ["CPU scheduling", "   ", "Relational database joins", "JavaScript promises"];
  const vectors = await requestEmbeddings(texts, {
    apiKey: "test-key", baseUrl: "https://embeddings.example/v1", model: "test-embedding-model",
    batchSize: 2, fetchImpl,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].input, ["CPU scheduling", "Relational database joins"]);
  assert.deepEqual(calls[1].input, ["JavaScript promises"]);
  assert.deepEqual(vectors[0], ["CPU scheduling".length, 1]);
  assert.equal(vectors[1], null);
  assert.deepEqual(vectors[2], ["Relational database joins".length, 1]);
  assert.deepEqual(vectors[3], ["JavaScript promises".length, 1]);
});

test("semantic service falls back to text-overlap alignment when embeddings are not configured", async () => {
  const fallback = [{ slideId: "s1", timestamp: 7, source: "transcript_match (inferred)", confidence: 0.7, evidence: [] }];
  const service = createSemanticAlignmentService({ fallbackAlign: () => fallback });
  const result = await service([segment("g1", 7, "some content")], [slide("s1", "a slide")]);
  assert.equal(result.method, "text_overlap_fallback");
  assert.match(result.reason, /not configured/i);
  assert.equal(result.transitions, fallback);
});

test("semantic service uses embeddings when the provider succeeds", async () => {
  const vectorsByText = new Map([
    ["CPU Scheduling process time quantum", [1, 0]],
    ["The scheduler rotates processes after each quantum", [0.99, 0.01]],
  ]);
  const fetchImpl = async (_url, options) => {
    const { input } = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ data: input.map((text, index) => ({ index, embedding: vectorsByText.get(text) })) }),
    };
  };
  const service = createSemanticAlignmentService({
    apiKey: "test-key", fallbackAlign: () => { throw new Error("fallback should not run"); },
    fetchImpl, minSimilarity: 0.8,
  });
  const result = await service(
    [segment("g1", 4, "The scheduler rotates processes after each quantum")],
    [slide("s1", "CPU Scheduling", "process time quantum")],
  );
  assert.equal(result.method, "semantic_embeddings");
  assert.equal(result.model, "text-embedding-3-small");
  assert.equal(result.transitions[0].timestamp, 4);
  assert.match(result.transitions[0].source, /^semantic_embedding_match \(inferred; min_similarity=0\.80\)$/);
});

test("provider failure degrades to lexical alignment and reports the reason", async () => {
  const fallback = [{ slideId: "s1", timestamp: null, source: "no_evidence", confidence: 0, evidence: [] }];
  const service = createSemanticAlignmentService({
    apiKey: "test-key", fallbackAlign: () => fallback,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  const result = await service([segment("g1", 0, "content")], [slide("s1", "title")]);
  assert.equal(result.method, "text_overlap_fallback");
  assert.match(result.reason, /HTTP 503/);
  assert.equal(result.transitions, fallback);
});
