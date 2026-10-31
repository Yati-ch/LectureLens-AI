import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { align } from "../lib/core.mjs";
import { requestEmbeddings, semanticAlign } from "../lib/semantic-alignment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "test", "fixtures", "alignment-eval.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const apiKey = process.env.EMBEDDINGS_API_KEY || "";
const baseUrl = (process.env.EMBEDDINGS_BASE_URL || process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const model = process.env.EMBEDDINGS_MODEL || "text-embedding-3-small";
const timeoutMs = Math.max(5000, Math.min(120000, Number(process.env.EMBEDDINGS_REQUEST_TIMEOUT_MS) || 30000));
const batchSize = Math.max(1, Math.min(128, Number(process.env.EMBEDDINGS_BATCH_SIZE) || 64));
const minSimilarity = Math.max(0.05, Math.min(0.95, Number(process.env.EMBEDDINGS_MIN_SIMILARITY) || 0.35));

if (!apiKey) {
  console.error("Set EMBEDDINGS_API_KEY explicitly in .env. The evaluation sends only the small, bundled benchmark fixture to the embeddings provider.");
  process.exit(1);
}

function assignments(transitions) {
  const result = new Map();
  for (const transition of transitions) {
    for (const item of transition.evidence || []) result.set(item.segmentId, transition.slideId);
  }
  return result;
}

function score(label, transitions) {
  const predicted = assignments(transitions);
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let exact = 0;
  for (const segment of fixture.segments) {
    const actual = segment.expectedSlideId;
    const guess = predicted.get(segment.id) || null;
    if (guess === actual) exact += 1;
    if (guess && guess === actual) truePositive += 1;
    else if (guess && guess !== actual) falsePositive += 1;
    else if (!guess && actual) falseNegative += 1;
  }
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
  return {
    method: label,
    exactSegmentAccuracy: Number((exact / fixture.segments.length).toFixed(3)),
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    f1: Number(precision + recall ? (2 * precision * recall / (precision + recall)).toFixed(3) : 0),
    matchedSegments: predicted.size,
    totalSegments: fixture.segments.length,
  };
}

const lexical = align(fixture.segments, fixture.slides);
const texts = [
  ...fixture.slides.map((slide) => `${slide.title}\n${slide.text}`),
  ...fixture.segments.map((segment) => segment.text),
];
const vectors = await requestEmbeddings(texts, {
  apiKey, baseUrl, model, timeoutMs, batchSize,
});
const slideVectors = vectors.slice(0, fixture.slides.length);
const segmentVectors = vectors.slice(fixture.slides.length);
if (slideVectors.some((vector) => !vector) || segmentVectors.some((vector) => !vector)) {
  throw new Error("The embeddings provider returned one or more missing vectors.");
}
const semantic = semanticAlign(fixture.segments, fixture.slides, segmentVectors, slideVectors, { minSimilarity });

console.log(JSON.stringify({
  benchmark: "LectureLens AI small paraphrase alignment fixture",
  note: "This is a small, hand-labelled development benchmark, not a representative real-world accuracy claim.",
  model,
  minimumCosineSimilarity: minSimilarity,
  results: [score("text_overlap_baseline", lexical), score("semantic_embeddings", semantic)],
  expectedMatches: fixture.segments.filter((segment) => segment.expectedSlideId).length,
  expectedUnmatched: fixture.segments.filter((segment) => !segment.expectedSlideId).length,
}, null, 2));
