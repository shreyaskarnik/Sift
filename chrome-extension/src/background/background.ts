/**
 * Service worker — handles model inference directly using Transformers.js v4.
 *
 * Loads one model on init:
 * 1. EmbeddingGemma-300M (q4) — cosine similarity scoring
 *
 * Inspector explanations are deterministic and generated from score band +
 * lightweight title/lens signals (no text-generation model in runtime path).
 */
import {
  AutoTokenizer,
  AutoModel,
  env,
  type PreTrainedTokenizer,
  type PreTrainedModel,
  type ProgressInfo,
} from "@huggingface/transformers";
import {
  MSG,
  STORAGE_KEYS,
  DEFAULT_QUERY_ANCHOR,
  MODEL_ID,
  BUILTIN_CATEGORIES,
  DEFAULT_ACTIVE_IDS,

  VIBE_THRESHOLDS,
  LABEL_SCHEMA_VERSION,
  ANCHOR_TIE_GAP,
  SCORE_BATCH_SIZE,
  TASTE_MIN_LABELS,
  TASTE_TOP_K,
  TASTE_MAX_PER_CATEGORY,
  TASTE_NEG_ALPHA,
  TASTE_MIN_NEGATIVES,
} from "../shared/constants";
import type {
  CategoryDef,
  CategoryMap,
  ExtensionMessage,
  ModelStatus,
  VibeResult,
  TrainingLabel,
  SaveLabelPayload,
  ImportXLabelsPayload,
  SetLabelsPayload,
  ScoreTextsPayload,
  ExplainScorePayload,
  GetPageScorePayload,
  PageScoreResponse,
  PageScoreUpdatedPayload,
  PresetRanking,
  PresetRank,
  TasteProbeResult,
  TasteProfileResponse,
} from "../shared/types";
import { scoreToHue, normalizeTitle } from "../shared/scoring-utils";
import { TASTE_PROBES } from "../shared/taste-probes";
import { computeTasteCacheKeyFromParts } from "../shared/taste-cache-key";
import { migrateLabels } from "./migrations";

// ---------------------------------------------------------------------------
// Env config
// ---------------------------------------------------------------------------

env.allowLocalModels = false;

// ---------------------------------------------------------------------------
// Theme-aware icon (set from popup/content scripts via storage)
// ---------------------------------------------------------------------------

function applyThemeIcon(dark: boolean): void {
  const suffix = dark ? "dark" : "light";
  chrome.action.setIcon({
    path: {
      16: `icons/icon16-${suffix}.png`,
      48: `icons/icon48-${suffix}.png`,
      128: `icons/icon128-${suffix}.png`,
    },
  });
}

// Listen for theme changes from contexts that have matchMedia
chrome.storage.onChanged.addListener((changes) => {
  if (changes["theme_dark"]) {
    applyThemeIcon(changes["theme_dark"].newValue !== false);
  }
});

// ---------------------------------------------------------------------------
// State — Embedding model
// ---------------------------------------------------------------------------

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let anchorEmbedding: Float32Array | null = null;
let modelReady = false;
let anchorReady = false;
let loadingPromise: Promise<void> | null = null;
const presetEmbeddings = new Map<string, Float32Array>();
let categoriesVersion = 0;
let currentCategoryMap: CategoryMap = {};

// Restore persisted categoriesVersion so content scripts don't ignore broadcasts
// after a service-worker restart.
chrome.storage.local.get(STORAGE_KEYS.CATEGORIES_VERSION).then((stored) => {
  const v = stored[STORAGE_KEYS.CATEGORIES_VERSION];
  if (typeof v === "number" && v > categoriesVersion) {
    categoriesVersion = v;
  }
});

// Migrate labels on schema version change
chrome.storage.local.get([STORAGE_KEYS.LABEL_SCHEMA, STORAGE_KEYS.LABELS]).then(async (stored) => {
  const storedVersion = stored[STORAGE_KEYS.LABEL_SCHEMA] ?? 0;
  if (storedVersion < LABEL_SCHEMA_VERSION) {
    await migrateLabels(storedVersion);
  }
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

let cachedStatus: ModelStatus = { state: "idle" };

function broadcastStatus(status: Partial<ModelStatus>): void {
  cachedStatus = { ...cachedStatus, ...status };
  chrome.runtime
    .sendMessage({ type: MSG.MODEL_STATUS, payload: cachedStatus })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Embedding model loading
// ---------------------------------------------------------------------------

async function loadEmbeddingModel(): Promise<void> {
  if (modelReady || loadingPromise) return;

  loadingPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.CUSTOM_MODEL_URL,
        STORAGE_KEYS.CUSTOM_MODEL_ID,
      ]);
      const customUrl = (stored[STORAGE_KEYS.CUSTOM_MODEL_URL] as string | undefined)?.trim();
      const customModelId = (stored[STORAGE_KEYS.CUSTOM_MODEL_ID] as string | undefined)?.trim();
      const isLocal = !!customUrl;

      const modelId = isLocal ? "local" : (customModelId || MODEL_ID);
      if (isLocal) {
        env.remoteHost = customUrl!;
        env.allowLocalModels = false;
      } else {
        env.remoteHost = "https://huggingface.co";
        env.allowLocalModels = false;
      }

      const hasWebGPU = !!(navigator as any).gpu;
      const device = hasWebGPU ? "webgpu" : "wasm";
      const dtype = "q4";
      const modelSuffix = hasWebGPU && !isLocal ? "model_no_gather" : "model";

      // Resolved display name: show URL for local, otherwise the model ID
      const displayModelId = isLocal ? customUrl! : modelId;

      console.log(`[bg] Loading embedding model ${modelId} on ${device} (dtype=${dtype})...`);
      broadcastStatus({
        state: "loading",
        message: `Loading embedding model on ${device}...`,
        backend: device,
        modelId: displayModelId,
      });

      const progressCallback = (progress: ProgressInfo) => {
        if (progress.status === "progress") {
          broadcastStatus({
            state: "loading",
            progress: progress.progress,
            message: progress.file
              ? `Downloading ${progress.file}...`
              : "Loading...",
            backend: device,
          });
        }
      };

      const [loadedTokenizer, loadedModel] = await Promise.all([
        AutoTokenizer.from_pretrained(modelId, {
          progress_callback: progressCallback,
        }),
        AutoModel.from_pretrained(modelId, {
          device,
          dtype,
          model_file_name: modelSuffix,
          progress_callback: progressCallback,
        } as any),
      ]);

      tokenizer = loadedTokenizer;
      model = loadedModel;
      modelReady = true;

      console.log(`[bg] Embedding model ready (${device})`);
      broadcastStatus({ state: "ready", backend: device });

      // Embed active categories first (populates currentCategoryMap for setAnchor lookup)
      await embedActiveCategories();
      // Embed fallback anchor phrase used only for scoring fallback paths.
      await setAnchor(DEFAULT_QUERY_ANCHOR);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[bg] Embedding model load error:", message);
      broadcastStatus({ state: "error", message });
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

// ---------------------------------------------------------------------------
// Model loading + deterministic inspector reasoning
// ---------------------------------------------------------------------------

async function loadModels(): Promise<void> {
  await loadEmbeddingModel();
}

function getScoreLevel(score: number): string {
  if (score >= 0.8) return "Strong";
  if (score >= 0.5) return "Partial";
  if (score >= 0.2) return "Weak";
  return "Very weak";
}

function resolveLabel(anchor: string): string {
  const entry = currentCategoryMap[anchor];
  if (entry) return entry.label;
  const normalized = anchor.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!normalized) return "Category";
  return normalized.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function buildDeterministicExplanation(
  score: number,
  anchor: string,
  ranking?: PresetRanking,
): string {
  const label = resolveLabel(anchor);
  const clamped = Math.max(0, Math.min(1, score));
  const level = getScoreLevel(clamped);

  if (!ranking || ranking.ranks.length < 2) {
    return `${level} fit for ${label}.`;
  }

  const top = ranking.top;
  const topLabel = resolveLabel(top.anchor);
  const second = ranking.ranks[1];
  const secondLabel = resolveLabel(second.anchor);
  const isTopMatch = anchor === top.anchor;
  const gap = top.score - second.score;

  if (isTopMatch) {
    if (clamped >= 0.8) {
      return gap >= 0.1
        ? `Strong fit for ${topLabel}. Clearly ahead of ${secondLabel} (${second.score.toFixed(2)}).`
        : `Strong fit for ${topLabel}. Close with ${secondLabel} (${second.score.toFixed(2)}).`;
    }
    if (clamped >= 0.5) {
      return `Partial fit for ${topLabel}. Runner-up: ${secondLabel} (${second.score.toFixed(2)}).`;
    }
    if (clamped >= 0.2) {
      return `Weak fit for ${topLabel} (${top.score.toFixed(2)}). No strong category match.`;
    }
    return `Very weak fit. Best match is ${topLabel} at ${top.score.toFixed(2)}.`;
  }

  // User inspecting a non-top anchor via pill override
  const anchorRank = ranking.ranks.find((r) => r.anchor === anchor);
  const anchorScore = anchorRank?.score ?? score;
  const anchorLevel = getScoreLevel(anchorScore);
  return `${anchorLevel} fit for ${label} (${anchorScore.toFixed(2)}). Best match: ${topLabel} (${top.score.toFixed(2)}).`;
}

async function explainScore(
  text: string,
  score: number,
  anchorId?: string,
  ranking?: PresetRanking,
): Promise<string> {
  const title = text.replace(/\s+/g, " ").trim();
  if (!title) return "No title text available to inspect.";
  const anchor = anchorId || DEFAULT_QUERY_ANCHOR;
  return buildDeterministicExplanation(score, anchor, ranking);
}

// ---------------------------------------------------------------------------
// Embedding + scoring
// ---------------------------------------------------------------------------

async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!tokenizer || !model) throw new Error("Model not loaded");

  const inputs = tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: 256,
  });

  const output = await (model as any)(inputs);
  const sentenceEmbedding = output.sentence_embedding;
  const embDim = sentenceEmbedding.dims[1];
  const rawData = sentenceEmbedding.data as Float32Array;

  const embeddings: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * embDim;
    embeddings.push(new Float32Array(rawData.slice(start, start + embDim)));
  }
  return embeddings;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/** L2-normalize a vector in place and return it. */
function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/** Normalize text for deduplication: lowercase + collapse whitespace. */
function normalizeTasteText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Simple djb2 hash for cache key construction. */
async function computeTasteProfile(): Promise<TasteProfileResponse> {
  if (!model || !tokenizer) {
    return {
      state: "error",
      message: "Model not loaded",
      probes: [],
      labelCount: 0,
      timestamp: Date.now(),
      cacheKey: "",
    };
  }

  // 1. Read and dedupe labels (newest first so latest label wins contradictions)
  const labels = await readLabels();
  labels.sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Set<string>();
  const positives: string[] = [];
  const negatives: string[] = [];

  for (const l of labels) {
    const norm = normalizeTasteText(l.text);
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (l.label === "positive") positives.push(l.text);
    else negatives.push(l.text);
  }

  if (positives.length < TASTE_MIN_LABELS) {
    const need = TASTE_MIN_LABELS - positives.length;
    return {
      state: "insufficient_labels",
      message: `Label ${need} more item${need === 1 ? "" : "s"} to see your taste profile.`,
      probes: [],
      labelCount: positives.length,
      timestamp: Date.now(),
      cacheKey: "",
    };
  }

  // 2. Embed positive labels in batches, L2-normalize each
  const posEmbeddings: Float32Array[] = [];
  for (let i = 0; i < positives.length; i += SCORE_BATCH_SIZE) {
    const batch = positives.slice(i, i + SCORE_BATCH_SIZE);
    const embs = await embed(batch);
    for (const e of embs) posEmbeddings.push(l2Normalize(e));
  }

  // 3. Compute positive centroid
  const dim = posEmbeddings[0].length;
  const posCentroid = new Float32Array(dim);
  for (const emb of posEmbeddings) {
    for (let j = 0; j < dim; j++) posCentroid[j] += emb[j];
  }
  for (let j = 0; j < dim; j++) posCentroid[j] /= posEmbeddings.length;

  // 4. Contrastive: subtract scaled negative centroid if enough negatives
  const tasteVec = new Float32Array(posCentroid);
  if (negatives.length >= TASTE_MIN_NEGATIVES) {
    const negEmbeddings: Float32Array[] = [];
    for (let i = 0; i < negatives.length; i += SCORE_BATCH_SIZE) {
      const batch = negatives.slice(i, i + SCORE_BATCH_SIZE);
      const embs = await embed(batch);
      for (const e of embs) negEmbeddings.push(l2Normalize(e));
    }
    const negCentroid = new Float32Array(dim);
    for (const emb of negEmbeddings) {
      for (let j = 0; j < dim; j++) negCentroid[j] += emb[j];
    }
    for (let j = 0; j < dim; j++) negCentroid[j] /= negEmbeddings.length;

    // tasteVec = posCentroid - alpha * negCentroid
    for (let j = 0; j < dim; j++) {
      tasteVec[j] -= TASTE_NEG_ALPHA * negCentroid[j];
    }
  }

  // 5. L2-normalize the taste vector; fallback to posCentroid if contrastive subtraction collapsed it
  let norm = 0;
  for (let j = 0; j < dim; j++) norm += tasteVec[j] * tasteVec[j];
  if (Math.sqrt(norm) < 1e-6) {
    tasteVec.set(posCentroid);
  }
  l2Normalize(tasteVec);

  // 6. Gather probes for active categories only (read from storage, not currentCategoryMap which includes archived)
  const catStore = await chrome.storage.local.get([STORAGE_KEYS.ACTIVE_CATEGORY_IDS]);
  const activeIds = new Set<string>(
    (catStore[STORAGE_KEYS.ACTIVE_CATEGORY_IDS] as string[] | undefined) ?? [...DEFAULT_ACTIVE_IDS],
  );
  const probeEntries: { probe: string; category: string }[] = [];
  for (const [catId, phrases] of Object.entries(TASTE_PROBES)) {
    if (!activeIds.has(catId)) continue;
    for (const phrase of phrases) {
      probeEntries.push({ probe: phrase, category: catId });
    }
  }

  // 7. Embed probes in batches, L2-normalize each
  const probeTexts = probeEntries.map((p) => p.probe);
  const probeEmbeddings: Float32Array[] = [];
  for (let i = 0; i < probeTexts.length; i += SCORE_BATCH_SIZE) {
    const batch = probeTexts.slice(i, i + SCORE_BATCH_SIZE);
    const embs = await embed(batch);
    for (const e of embs) probeEmbeddings.push(l2Normalize(e));
  }

  // 8. Score each probe against taste vector
  const scored: TasteProbeResult[] = probeEntries.map((entry, i) => ({
    probe: entry.probe,
    score: cosineSimilarity(probeEmbeddings[i], tasteVec),
    category: entry.category,
  }));

  // 9. Sort and apply diversity cap (max N per category)
  scored.sort((a, b) => b.score - a.score);
  const catCount: Record<string, number> = {};
  const diverseTop: TasteProbeResult[] = [];
  for (const s of scored) {
    const count = catCount[s.category] ?? 0;
    if (count >= TASTE_MAX_PER_CATEGORY) continue;
    catCount[s.category] = count + 1;
    diverseTop.push(s);
    if (diverseTop.length >= TASTE_TOP_K) break;
  }

  // 10. Build composite cache key
  const modelIdStore = await chrome.storage.local.get([
    STORAGE_KEYS.CUSTOM_MODEL_ID,
    STORAGE_KEYS.CUSTOM_MODEL_URL,
  ]);
  const modelKey = modelIdStore[STORAGE_KEYS.CUSTOM_MODEL_URL]
    || modelIdStore[STORAGE_KEYS.CUSTOM_MODEL_ID]
    || "default";
  const cacheKey = computeTasteCacheKeyFromParts(positives, negatives, activeIds, modelKey);

  // 11. Cache and return
  const response: TasteProfileResponse = {
    state: "ready",
    probes: diverseTop,
    labelCount: positives.length,
    timestamp: Date.now(),
    cacheKey,
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.TASTE_PROFILE]: response });
  return response;
}

function mapScoreToVibe(text: string, score: number) {
  const clamped = Math.max(0, Math.min(1, score));
  const hue = Math.floor(clamped * 120);
  const colorHSL = `hsl(${hue}, 80%, 50%)`;

  let status = VIBE_THRESHOLDS[VIBE_THRESHOLDS.length - 1].status;
  let emoji = VIBE_THRESHOLDS[VIBE_THRESHOLDS.length - 1].emoji;
  for (const t of VIBE_THRESHOLDS) {
    if (clamped >= t.score) {
      status = t.status;
      emoji = t.emoji;
      break;
    }
  }
  return { text, rawScore: score, status, emoji, colorHSL };
}

async function embedActiveCategories(): Promise<void> {
  if (!modelReady) return;

  // Read active category IDs from storage (default to DEFAULT_ACTIVE_IDS)
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACTIVE_CATEGORY_IDS,
    STORAGE_KEYS.CATEGORY_DEFS,
  ]);
  const activeIds: string[] = stored[STORAGE_KEYS.ACTIVE_CATEGORY_IDS] ?? [...DEFAULT_ACTIVE_IDS];
  const customDefs: CategoryDef[] = stored[STORAGE_KEYS.CATEGORY_DEFS] ?? [];

  // Build lookup: check builtins first, then custom defs
  const builtinMap = new Map(BUILTIN_CATEGORIES.map((c) => [c.id, c]));
  const customMap = new Map(customDefs.map((c) => [c.id, c]));

  const activeDefs: CategoryDef[] = [];
  for (const id of activeIds) {
    const def = builtinMap.get(id) ?? customMap.get(id);
    if (def && !def.archived) activeDefs.push(def);
  }

  if (activeDefs.length === 0) {
    // Clear stale embeddings and map when no active categories remain
    presetEmbeddings.clear();
    currentCategoryMap = {};
    await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORY_MAP]: {} });
    categoriesVersion++;
    await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORIES_VERSION]: categoriesVersion });
    chrome.runtime.sendMessage({
      type: MSG.CATEGORIES_CHANGED,
      payload: { categoriesVersion },
    }).catch(() => {});
    return;
  }

  // Embed all anchor texts (active only)
  const anchorTexts = activeDefs.map((d) => d.anchorText);
  const vectors = await embed(anchorTexts);

  presetEmbeddings.clear();
  activeDefs.forEach((def, i) => {
    presetEmbeddings.set(def.id, vectors[i]);
  });

  // Build CategoryMap covering ALL known categories (builtins + custom defs),
  // not just active ones, so archived/inactive IDs resolve in CSV export.
  const catMap: CategoryMap = {};
  for (const def of BUILTIN_CATEGORIES) {
    catMap[def.id] = { label: def.label, anchorText: def.anchorText };
  }
  for (const def of customDefs) {
    catMap[def.id] = { label: def.label, anchorText: def.anchorText };
  }
  currentCategoryMap = catMap;
  await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORY_MAP]: catMap });

  // Notify all contexts — persist version before broadcasting
  categoriesVersion++;
  await chrome.storage.local.set({ [STORAGE_KEYS.CATEGORIES_VERSION]: categoriesVersion });
  chrome.runtime.sendMessage({
    type: MSG.CATEGORIES_CHANGED,
    payload: { categoriesVersion },
  }).catch(() => {});
}

/**
 * Rank all preset anchors by similarity to a text embedding.
 * Single primitive: scoring, pills, labels, explanation all derive from this.
 */
function rankPresets(textEmb: Float32Array): PresetRanking | undefined {
  if (presetEmbeddings.size === 0) return undefined;

  const ranks: PresetRank[] = [...presetEmbeddings.entries()]
    .map(([anchor, emb]) => ({ anchor, score: cosineSimilarity(textEmb, emb) }))
    .sort((a, b) => b.score - a.score);

  const top = ranks[0];
  const second = ranks[1];
  const confidence = second ? top.score - second.score : 1.0;

  return {
    ranks,
    top,
    confidence,
    ambiguous: confidence < ANCHOR_TIE_GAP,
  };
}

async function setAnchor(anchor: string): Promise<void> {
  console.log(`[bg] Setting fallback anchor embedding: "${anchor}"`);

  // Look up anchorText from active categories (anchor is a category ID)
  const catEntry = currentCategoryMap[anchor];
  const textToEmbed = catEntry?.anchorText ?? anchor;

  const [emb] = await embed([textToEmbed]);
  anchorEmbedding = emb;
  anchorReady = true;
  console.log("[bg] Anchor embedded");
}

// ---------------------------------------------------------------------------
// Anchor text stamping
// ---------------------------------------------------------------------------

function stampAnchorText(label: TrainingLabel, catMap: CategoryMap): TrainingLabel {
  if (!label.anchorText) {
    label.anchorText = catMap[label.anchor]?.anchorText ?? label.anchor;
  }
  return label;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function readLabels(): Promise<TrainingLabel[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LABELS);
  return (result[STORAGE_KEYS.LABELS] as TrainingLabel[]) ?? [];
}

async function writeLabels(labels: TrainingLabel[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.LABELS]: labels });
}

// Serialized label writes to prevent read-modify-write races
let labelWriteQueue: Promise<void> = Promise.resolve();

function enqueueLabelWrite(
  fn: (labels: TrainingLabel[]) => TrainingLabel[],
): Promise<void> {
  labelWriteQueue = labelWriteQueue
    .catch((err) => {
      // Recover queue after failures so subsequent writes can proceed.
      console.error("[bg] Label queue recovered from previous error:", err);
    })
    .then(async () => {
      const labels = await readLabels();
      await writeLabels(fn(labels));
    });
  return labelWriteQueue;
}

// ---------------------------------------------------------------------------
// Page scoring — badge + per-tab cache
// ---------------------------------------------------------------------------

interface PageScoreCacheEntry {
  title: string;
  normalizedTitle: string;
  result: VibeResult;
  ranking?: PresetRanking;
}

const pageScoreCache = new Map<number, PageScoreCacheEntry>();
const scoringInFlight = new Set<number>(); // dedupe concurrent scorePageTitle calls
let pageScoringEnabled = false;
let activeTabId = -1;

// Load initial state + bootstrap scoring if already enabled on wake
Promise.all([
  chrome.storage.local.get(STORAGE_KEYS.PAGE_SCORING_ENABLED),
  chrome.tabs.query({ active: true, currentWindow: true }),
]).then(([stored, tabs]) => {
  pageScoringEnabled = stored[STORAGE_KEYS.PAGE_SCORING_ENABLED] === true;
  if (tabs[0]?.id) activeTabId = tabs[0].id;
  // If enabled on wake and model is already loaded, score active tab.
  // If model isn't loaded yet, setAnchor() at end of loadModels() will trigger it.
  if (pageScoringEnabled && activeTabId > 0 && modelReady && anchorReady) {
    void scorePageTitle(activeTabId);
  }
});

/** Convert HSL (h: 0-360, s/l: 0-1) to [r, g, b, a] for badge API. */
function hslToRgb(h: number, s: number, l: number): [number, number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
    255,
  ];
}

/** Set badge text + color for a tab. Only updates if it's the active tab. */
function updateBadge(tabId: number, result: VibeResult | null): void {
  if (tabId !== activeTabId) return;

  if (!result || !pageScoringEnabled) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  const score = Math.max(0, Math.min(1, result.rawScore));
  const text = String(Math.round(score * 100));
  const hue = scoreToHue(score);
  const color = hslToRgb(hue, 0.7, 0.45);

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

/** Clear badge (e.g. when feature is disabled or on non-scorable page). */
function clearBadge(): void {
  chrome.action.setBadgeText({ text: "" });
}

/** Domains with content scripts already doing feed-level scoring. */
const FEED_SCORED_DOMAINS = [
  "news.ycombinator.com",
  "reddit.com",
  "x.com",
  "twitter.com",
];

function isFeedScoredHost(host: string): boolean {
  return FEED_SCORED_DOMAINS.some(
    (d) => host === d || host.endsWith("." + d),
  );
}

function isScorableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  try {
    return !isFeedScoredHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Score a tab's title and cache the result. Returns the cache entry. */
async function scorePageTitle(tabId: number): Promise<PageScoreCacheEntry | null> {
  // In-flight dedup: if already scoring this tab, skip
  if (scoringInFlight.has(tabId)) return pageScoreCache.get(tabId) ?? null;
  scoringInFlight.add(tabId);

  try {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return null; // tab closed
    }

    // Evict cache + clear badge for non-scorable pages
    if (!tab.title || !isScorableUrl(tab.url)) {
      pageScoreCache.delete(tabId);
      if (tabId === activeTabId) clearBadge();
      return null;
    }
    if (!modelReady || !anchorReady) return null;

    const title = tab.title;
    const norm = normalizeTitle(title);

    // Dedup: skip if same normalized title is already cached
    const existing = pageScoreCache.get(tabId);
    if (existing && existing.normalizedTitle === norm) {
      return existing;
    }

    // Single embed call — reuse vector for both main score and preset ranking
    const [textEmb] = await embed([norm]);
    const ranking = rankPresets(textEmb);
    const score = ranking ? ranking.top.score : cosineSimilarity(anchorEmbedding!, textEmb);
    const result = mapScoreToVibe(norm, score);

    const entry: PageScoreCacheEntry = {
      title,
      normalizedTitle: norm,
      result,
      ranking,
    };
    pageScoreCache.set(tabId, entry);
    updateBadge(tabId, result);

    // Broadcast to popup
    const updated: PageScoreUpdatedPayload = {
      tabId, title, normalizedTitle: norm, result, ranking, state: "ready",
    };
    chrome.runtime.sendMessage({
      type: MSG.PAGE_SCORE_UPDATED,
      payload: updated,
    }).catch(() => {});

    return entry;
  } catch (err) {
    console.error("[bg] Page score failed:", err);
    return null;
  } finally {
    scoringInFlight.delete(tabId);
  }
}

// --- Tab listeners (always registered, gated by pageScoringEnabled) ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!pageScoringEnabled) return;
  if (changeInfo.status !== "complete") return;
  if (!isScorableUrl(tab.url)) {
    // Evict stale cache from previous page on this tab
    pageScoreCache.delete(tabId);
    if (tabId === activeTabId) clearBadge();
    return;
  }
  // Fire-and-forget score
  void scorePageTitle(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activeTabId = tabId;
  if (!pageScoringEnabled) {
    clearBadge();
    return;
  }

  // Always validate via scorePageTitle — it checks the tab's current URL
  // and evicts cache if non-scorable. Cached + fresh entries short-circuit
  // inside scorePageTitle without hitting the model.
  const cached = pageScoreCache.get(tabId);
  if (cached) {
    updateBadge(tabId, cached.result);
  } else {
    clearBadge();
  }
  // Score (or validate + evict) regardless — scorePageTitle handles all cases
  void scorePageTitle(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pageScoreCache.delete(tabId);
});

// Listen for page scoring toggle changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEYS.PAGE_SCORING_ENABLED]) {
    pageScoringEnabled = changes[STORAGE_KEYS.PAGE_SCORING_ENABLED].newValue === true;
    if (!pageScoringEnabled) {
      // Disable: clear all badges and cache
      pageScoreCache.clear();
      clearBadge();
    } else if (modelReady && anchorReady) {
      // Enable: score active tab immediately
      void scorePageTitle(activeTabId);
    }
  }

  // Active categories changed — re-embed category embeddings and map
  if (changes[STORAGE_KEYS.ACTIVE_CATEGORY_IDS]) {
    if (!modelReady) return;
    void embedActiveCategories();
  }
});

// ---------------------------------------------------------------------------
// Model initialization — runs every time the service worker starts.
// MV3 service workers get killed after ~30s idle; onInstalled/onStartup
// do NOT fire on wake-up, so we load at module scope instead.
// ---------------------------------------------------------------------------

loadModels();

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined => {
    const { type, payload } = message;

    switch (type) {
      case MSG.INIT_MODEL: {
        loadModels();
        sendResponse({ ok: true });
        return;
      }

      case MSG.RELOAD_MODEL: {
        // Wait for any in-flight load to settle, then reset and restart
        const prev = loadingPromise;
        tokenizer = null;
        model = null;
        anchorEmbedding = null;
        presetEmbeddings.clear();
        currentCategoryMap = {};
        modelReady = false;
        anchorReady = false;
        loadingPromise = null;
        cachedStatus = { state: "idle" };
        if (prev) {
          prev.catch(() => {}).then(() => loadModels());
        } else {
          loadModels();
        }
        sendResponse({ ok: true });
        return;
      }

      case MSG.SCORE_TEXTS: {
        const p = payload as ScoreTextsPayload;
        if (!p?.texts?.length) {
          sendResponse({ results: [] });
          return;
        }
        if (!modelReady || !anchorReady) {
          sendResponse({ error: "Model not ready" });
          return;
        }
        embed(p.texts)
          .then((embeddings) => {
            const rankings = embeddings.map((emb) => rankPresets(emb));
            const results = p.texts.map((text, i) => {
              const ranking = rankings[i];
              const score = ranking ? ranking.top.score : cosineSimilarity(anchorEmbedding!, embeddings[i]);
              return mapScoreToVibe(text, score);
            });
            sendResponse({ results, rankings });
          })
          .catch((err) => sendResponse({ error: String(err) }));
        return true; // keep channel open
      }

      case MSG.EXPLAIN_SCORE: {
        const p = payload as ExplainScorePayload;
        if (typeof p?.text !== "string") {
          sendResponse({ error: "Invalid explain payload" });
          return;
        }
        const safeScore = Number.isFinite(p.score) ? p.score : 0;
        explainScore(p.text, safeScore, p.anchorId, p.ranking)
          .then((explanation) => sendResponse({ explanation }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case MSG.GET_STATUS: {
        sendResponse({ ...cachedStatus, modelReady, hasAnchor: anchorReady });
        return;
      }

      case MSG.SAVE_LABEL: {
        const { label, anchorOverride, presetRanking } = payload as SaveLabelPayload;
        if (!label || typeof label.text !== "string") {
          sendResponse({ error: "Invalid label payload" });
          return;
        }

        (async () => {
          // Anchor resolution: override > auto > fresh detect > fallback
          let resolvedAnchor: string;
          let anchorSource: "override" | "auto" | "fallback";
          let effectiveRanking = presetRanking;

          if (anchorOverride) {
            resolvedAnchor = anchorOverride;
            anchorSource = "override";
          } else if (presetRanking?.top) {
            resolvedAnchor = presetRanking.top.anchor;
            anchorSource = "auto";
          } else {
            // Fallback: embed + rank (for cases like X archive import)
            try {
              const [textEmb] = await embed([label.text.replace(/\s+/g, " ").trim()]);
              const ranking = rankPresets(textEmb);
              if (ranking) {
                resolvedAnchor = ranking.top.anchor;
                anchorSource = "auto";
                effectiveRanking = ranking;
              } else {
                resolvedAnchor = DEFAULT_QUERY_ANCHOR;
                anchorSource = "fallback";
              }
            } catch {
              resolvedAnchor = DEFAULT_QUERY_ANCHOR;
              anchorSource = "fallback";
            }
          }

          const stamped: TrainingLabel = stampAnchorText({
            ...label,
            anchor: resolvedAnchor,
            autoAnchor: effectiveRanking?.top.anchor,
            autoConfidence: effectiveRanking?.confidence,
            anchorSource,
          }, currentCategoryMap);

          await enqueueLabelWrite((labels) => { labels.push(stamped); return labels; });
          sendResponse({ success: true });
        })().catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case MSG.GET_LABELS: {
        readLabels()
          .then((labels) => sendResponse({ labels }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case MSG.SET_LABELS: {
        const { labels } = payload as SetLabelsPayload;
        const stampedLabels = (Array.isArray(labels) ? labels : []).map(
          (l) => stampAnchorText({ ...l }, currentCategoryMap),
        );
        enqueueLabelWrite(() => stampedLabels)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case MSG.CLEAR_LABELS: {
        enqueueLabelWrite(() => [])
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case MSG.IMPORT_X_LABELS: {
        const { labels: incoming } = payload as ImportXLabelsPayload;
        const anchor = DEFAULT_QUERY_ANCHOR;
        const stamped = (Array.isArray(incoming) ? incoming : []).map((label) =>
          stampAnchorText({ ...label, anchor }, currentCategoryMap),
        );
        enqueueLabelWrite((labels) => { labels.push(...stamped); return labels; })
          .then(() => sendResponse({ success: true, count: stamped.length }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case MSG.GET_PAGE_SCORE: {
        const p = payload as GetPageScorePayload;
        if (!p?.tabId) {
          sendResponse({ title: "", normalizedTitle: "", result: null, state: "unavailable" } as PageScoreResponse);
          return;
        }

        if (!pageScoringEnabled) {
          sendResponse({ title: "", normalizedTitle: "", result: null, state: "disabled" } as PageScoreResponse);
          return;
        }

        // Validate tab URL before trusting cache — tab may have navigated to chrome:// etc.
        chrome.tabs.get(p.tabId).then((tab) => {
          if (!isScorableUrl(tab.url)) {
            pageScoreCache.delete(p.tabId);
            sendResponse({ title: "", normalizedTitle: "", result: null, state: "unavailable" } as PageScoreResponse);
            return;
          }

          // Return from cache if fresh and title matches current tab
          const cached = pageScoreCache.get(p.tabId);
          if (cached && cached.title === tab.title) {
            sendResponse({
              title: cached.title,
              normalizedTitle: cached.normalizedTitle,
              result: cached.result,
              ranking: cached.ranking,
              state: "ready",
            } as PageScoreResponse);
            return;
          }

          // Fetch-or-score: try scoring on demand
          if (!modelReady || !anchorReady) {
            sendResponse({ title: "", normalizedTitle: "", result: null, state: "loading" } as PageScoreResponse);
            return;
          }

          // Already scoring this tab — respond "loading" instead of false "unavailable"
          if (scoringInFlight.has(p.tabId)) {
            sendResponse({ title: "", normalizedTitle: "", result: null, state: "loading" } as PageScoreResponse);
            return;
          }

          scorePageTitle(p.tabId)
            .then((entry) => {
              if (entry) {
                sendResponse({
                  title: entry.title,
                  normalizedTitle: entry.normalizedTitle,
                  result: entry.result,
                  ranking: entry.ranking,
                  state: "ready",
                } as PageScoreResponse);
              } else {
                sendResponse({ title: "", normalizedTitle: "", result: null, state: "unavailable" } as PageScoreResponse);
              }
            })
            .catch(() => {
              sendResponse({ title: "", normalizedTitle: "", result: null, state: "unavailable" } as PageScoreResponse);
            });
        }).catch(() => {
          sendResponse({ title: "", normalizedTitle: "", result: null, state: "unavailable" } as PageScoreResponse);
        });
        return true; // keep channel open
      }

      case MSG.PAGE_SCORE_UPDATED: {
        // Ignore — we are the source
        break;
      }

      case MSG.COMPUTE_TASTE_PROFILE: {
        computeTasteProfile()
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({
            state: "error",
            message: String(err),
            probes: [],
            labelCount: 0,
            timestamp: Date.now(),
            cacheKey: "",
          } as TasteProfileResponse));
        return true;
      }

      case MSG.MODEL_STATUS: {
        // Ignore — we are the source
        break;
      }

      case MSG.CATEGORIES_CHANGED: {
        // Ignore — we are the source
        break;
      }

      default:
        break;
    }

    return undefined;
  },
);
