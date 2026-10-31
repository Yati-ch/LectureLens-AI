/** Optional semantic slide/transcript alignment using an OpenAI-compatible embeddings endpoint.
 * If embeddings are unavailable, callers can safely retain the deterministic text-overlap fallback.
 */

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return -1;
  return dot / Math.sqrt(normA * normB);
}

/**
 * Align transcript segments to slides using cosine similarity and an order-preserving
 * maximum-weight sequence match. A segment is never assigned below the threshold.
 * Each slide gets at most one anchor; nearby segments are added only when that slide
 * is their best semantic match and they also clear the threshold.
 */
export function semanticAlign(segs, slides, segmentVectors, slideVectors, options = {}) {
  const threshold = Math.max(0.05, Math.min(0.95, Number(options.minSimilarity) || 0.35));
  const empty = () => slides.map((slide) => ({
    slideId: slide.id,
    timestamp: null,
    source: "no_semantic_evidence",
    confidence: 0,
    evidence: [],
  }));
  if (!segs.length || !slides.length) return empty();
  if (segmentVectors.length !== segs.length || slideVectors.length !== slides.length) return empty();

  const similarities = segmentVectors.map((segmentVector) =>
    slideVectors.map((slideVector) => cosineSimilarity(segmentVector, slideVector))
  );
  const n = segs.length;
  const k = slides.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(k + 1));
  const back = Array.from({ length: n + 1 }, () => new Uint8Array(k + 1));
  // 1 = skip segment, 2 = skip slide, 3 = match.

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= k; j += 1) {
      let best = dp[i - 1][j];
      let move = 1;
      if (dp[i][j - 1] > best + 1e-10) {
        best = dp[i][j - 1];
        move = 2;
      }
      const similarity = similarities[i - 1][j - 1];
      if (similarity >= threshold) {
        const matchScore = dp[i - 1][j - 1] + Math.max(0.001, similarity - threshold);
        if (matchScore > best + 1e-10) {
          best = matchScore;
          move = 3;
        }
      }
      dp[i][j] = best;
      back[i][j] = move;
    }
  }

  const anchors = [];
  let i = n;
  let j = k;
  while (i > 0 || j > 0) {
    const move = back[i][j];
    if (i > 0 && j > 0 && move === 3) {
      anchors.push({ segmentIndex: i - 1, slideIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || move === 1)) {
      i -= 1;
    } else if (j > 0) {
      j -= 1;
    } else {
      break;
    }
  }
  anchors.reverse();
  if (!anchors.length) return empty();

  const bySlide = new Map();
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const previous = anchors[anchorIndex - 1];
    const next = anchors[anchorIndex + 1];
    const left = previous
      ? Math.floor((previous.segmentIndex + anchor.segmentIndex) / 2) + 1
      : 0;
    const right = next
      ? Math.floor((anchor.segmentIndex + next.segmentIndex) / 2)
      : n - 1;
    const evidence = [];

    for (let segmentIndex = left; segmentIndex <= right; segmentIndex += 1) {
      const scores = similarities[segmentIndex];
      const bestSlideIndex = scores.reduce((best, score, index) =>
        score > scores[best] ? index : best, 0);
      const similarity = scores[anchor.slideIndex];
      const isAnchor = segmentIndex === anchor.segmentIndex;
      if (similarity < threshold || (!isAnchor && bestSlideIndex !== anchor.slideIndex)) continue;
      evidence.push({
        segmentId: segs[segmentIndex].id,
        time: segs[segmentIndex].startTime,
        similarity: Number(similarity.toFixed(4)),
      });
    }

    // Keep the selected anchor even in the event of a tie between slide vectors.
    if (!evidence.some((item) => item.segmentId === segs[anchor.segmentIndex].id)) {
      const similarity = similarities[anchor.segmentIndex][anchor.slideIndex];
      evidence.push({
        segmentId: segs[anchor.segmentIndex].id,
        time: segs[anchor.segmentIndex].startTime,
        similarity: Number(similarity.toFixed(4)),
      });
      evidence.sort((a, b) => a.time - b.time);
    }
    if (evidence.length) bySlide.set(anchor.slideIndex, evidence);
  }

  return slides.map((slide, slideIndex) => {
    const evidence = bySlide.get(slideIndex) || [];
    if (!evidence.length) {
      return { slideId: slide.id, timestamp: null, source: "no_semantic_evidence", confidence: 0, evidence: [] };
    }
    const average = evidence.reduce((sum, item) => sum + item.similarity, 0) / evidence.length;
    return {
      slideId: slide.id,
      timestamp: evidence[0].time,
      source: `semantic_embedding_match (inferred; min_similarity=${threshold.toFixed(2)})`,
      confidence: Number(average.toFixed(2)),
      evidence: evidence.slice(0, 8),
    };
  });
}

function normalizedText(value, maxCharacters = 6000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxCharacters) : null;
}

/** Request embeddings in bounded batches and preserve original input order. */
export async function requestEmbeddings(texts, options = {}) {
  const {
    apiKey,
    baseUrl = "https://api.openai.com/v1",
    model = "text-embedding-3-small",
    timeoutMs = 30000,
    batchSize = 64,
    fetchImpl = fetch,
  } = options;
  if (!apiKey) throw new Error("No embeddings API key is configured");
  const inputs = texts.map((text) => normalizedText(text));
  const vectors = new Array(inputs.length).fill(null);
  const valid = inputs.map((text, index) => ({ text, index })).filter((item) => item.text);
  const size = Math.max(1, Math.min(128, Number(batchSize) || 64));

  for (let offset = 0; offset < valid.length; offset += size) {
    const batch = valid.slice(offset, offset + size);
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, input: batch.map((item) => item.text) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Embeddings provider HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.data) || payload.data.length !== batch.length) {
      throw new Error("Embeddings provider returned an incomplete vector batch");
    }
    const seen = new Set();
    for (let position = 0; position < payload.data.length; position += 1) {
      const item = payload.data[position];
      const localIndex = Number.isInteger(item?.index) ? item.index : position;
      if (localIndex < 0 || localIndex >= batch.length || seen.has(localIndex)) {
        throw new Error("Embeddings provider returned invalid vector indexes");
      }
      const vector = item?.embedding;
      if (!Array.isArray(vector) || !vector.length || vector.some((number) => !Number.isFinite(Number(number)))) {
        throw new Error("Embeddings provider returned an invalid vector");
      }
      seen.add(localIndex);
      vectors[batch[localIndex].index] = vector.map(Number);
    }
  }

  const dimensions = vectors.find((vector) => vector?.length)?.length;
  if (dimensions && vectors.some((vector) => vector && vector.length !== dimensions)) {
    throw new Error("Embeddings provider returned inconsistent vector dimensions");
  }
  return vectors;
}

/** Build an alignment function that always degrades to the trusted lexical matcher. */
export function createSemanticAlignmentService(options = {}) {
  const {
    apiKey = "",
    baseUrl = "https://api.openai.com/v1",
    model = "text-embedding-3-small",
    timeoutMs = 30000,
    batchSize = 64,
    minSimilarity = 0.35,
    fallbackAlign,
    fetchImpl = fetch,
    log = () => {},
  } = options;

  return async function alignSemantically(segs, slides) {
    const fallback = (reason) => ({
      transitions: fallbackAlign(segs, slides),
      method: "text_overlap_fallback",
      reason,
    });
    if (!apiKey) return fallback("Embeddings are not configured; text-overlap alignment was used.");
    if (!segs.length || !slides.length) {
      return { transitions: semanticAlign(segs, slides, [], [], { minSimilarity }), method: "semantic_embeddings", reason: "No transcript segments or slides to align." };
    }

    try {
      const slideTexts = slides.map((slide) => `${slide.title || ""}\n${slide.text || ""}`);
      const allVectors = await requestEmbeddings(
        [...slideTexts, ...segs.map((segment) => segment.text)],
        { apiKey, baseUrl, model, timeoutMs, batchSize, fetchImpl },
      );
      const slideVectors = allVectors.slice(0, slides.length);
      const segmentVectors = allVectors.slice(slides.length);
      if (slideVectors.some((vector) => !vector) || segmentVectors.some((vector) => !vector)) {
        throw new Error("One or more slide or transcript passages had no embeddable text");
      }
      return {
        transitions: semanticAlign(segs, slides, segmentVectors, slideVectors, { minSimilarity }),
        method: "semantic_embeddings",
        model,
        reason: "Slide and transcript text matched by cosine similarity of embeddings.",
      };
    } catch (error) {
      log("Semantic alignment fallback", error.message);
      return fallback(`Semantic embeddings unavailable (${error.message}); text-overlap alignment was used.`);
    }
  };
}
