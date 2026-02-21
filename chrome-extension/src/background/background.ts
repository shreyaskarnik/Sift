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
  VIBE_THRESHOLDS,
} from "../shared/constants";
import type {
  ExtensionMessage,
  ModelStatus,
  VibeResult,
  TrainingLabel,
  SaveLabelPayload,
  UpdateAnchorPayload,
  ImportXLabelsPayload,
  SetLabelsPayload,
  ScoreTextsPayload,
  ExplainScorePayload,
  GetPageScorePayload,
  PageScoreResponse,
} from "../shared/types";
import { scoreToHue, normalizeTitle } from "../shared/scoring-utils";

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

      // Embed the anchor phrase
      const anchor = await loadAnchor();
      await setAnchor(anchor);
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

interface LensProfile {
  label: string;
  include: string[];
  exclude: string[];
}

const LENS_PROFILES: Record<string, LensProfile> = {
  MY_FAVORITE_NEWS: {
    label: "News / Social Feed",
    include: ["launch", "release", "open source", "security", "research", "startup", "science"],
    exclude: ["celebrity", "gossip", "betting", "odds"],
  },
  AI_RESEARCH: {
    label: "AI Research",
    include: [
      "model", "llm", "transformer", "benchmark", "paper", "arxiv", "inference",
      "training", "agent", "embedding", "openai", "anthropic", "gemma",
    ],
    exclude: ["earnings", "celebrity", "sports", "gossip"],
  },
  STARTUP_NEWS: {
    label: "Startups",
    include: ["startup", "funding", "seed", "series a", "series b", "founder", "acquisition", "ipo"],
    exclude: ["paper", "arxiv", "celebrity"],
  },
  DEEP_TECH: {
    label: "Deep Tech",
    include: ["infrastructure", "compiler", "kernel", "database", "distributed", "chip", "hardware", "gpu"],
    exclude: ["gossip", "celebrity", "opinion"],
  },
  SCIENCE_DISCOVERIES: {
    label: "Science",
    include: ["study", "discovery", "researchers", "experiment", "physics", "biology", "chemistry", "astronomy"],
    exclude: ["funding round", "ipo", "acquisition"],
  },
};

const BROAD_NEWS_TERMS = [
  "joins", "announces", "launches", "new", "today", "update", "report", "latest", "improves",
];

function getScoreLevel(score: number): "strong" | "moderate" | "weak" | "very weak" {
  if (score >= 0.8) return "strong";
  if (score >= 0.5) return "moderate";
  if (score >= 0.2) return "weak";
  return "very weak";
}

function humanizeAnchorLabel(anchor: string): string {
  const normalized = anchor.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!normalized) return "Selected Lens";
  return normalized.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function resolveLensProfile(anchor: string): LensProfile {
  const key = anchor.trim().toUpperCase();
  if (LENS_PROFILES[key]) return LENS_PROFILES[key];
  const fallbackLabel = humanizeAnchorLabel(anchor);
  return { label: fallbackLabel, include: [], exclude: [] };
}

function matchTerms(titleLower: string, terms: string[]): string[] {
  const hits: string[] = [];
  for (const term of terms) {
    const normalized = term.toLowerCase();
    if (titleLower.includes(normalized) && !hits.includes(term)) {
      hits.push(term);
    }
  }
  return hits;
}

function formatList(values: string[]): string {
  const clean = values.slice(0, 2);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean[0]} and ${clean[1]}`;
}

function hasBroadSignal(titleLower: string, titleWordCount: number): boolean {
  if (titleWordCount <= 5) return true;
  const broadHits = matchTerms(titleLower, BROAD_NEWS_TERMS);
  return broadHits.length >= 2;
}

function buildDeterministicExplanation(title: string, score: number, anchor: string): string {
  const profile = resolveLensProfile(anchor);
  const normalizedScore = Math.max(0, Math.min(1, score));
  const level = getScoreLevel(normalizedScore);
  const titleLower = title.toLowerCase();
  const titleWordCount = titleLower.split(/\s+/).filter(Boolean).length;
  const includeHits = matchTerms(titleLower, profile.include);
  const excludeHits = matchTerms(titleLower, profile.exclude);
  const broad = hasBroadSignal(titleLower, titleWordCount);

  if (level === "strong") {
    if (includeHits.length > 0) {
      return `Strong fit for ${profile.label}. It directly mentions ${formatList(includeHits)}.`;
    }
    return `Strong fit for ${profile.label}. The topic is closely aligned.`;
  }

  if (level === "moderate") {
    if (includeHits.length > 0 && broad) {
      return `Partial fit for ${profile.label}. It mentions ${formatList(includeHits)}, but the title is broad.`;
    }
    if (includeHits.length > 0) {
      return `Partial fit for ${profile.label}. There is overlap with ${formatList(includeHits)}.`;
    }
    if (excludeHits.length > 0) {
      return `Partial fit. It has some overlap, but leans toward ${formatList(excludeHits)}.`;
    }
    return `Partial fit for ${profile.label}. Related, but not very specific.`;
  }

  if (level === "weak") {
    if (excludeHits.length > 0) {
      return `Weak fit for ${profile.label}. This looks more about ${formatList(excludeHits)}.`;
    }
    if (includeHits.length > 0) {
      return `Weak fit for ${profile.label}. Only light overlap via ${formatList(includeHits)}.`;
    }
    return `Weak fit for ${profile.label}. Few clear lens signals.`;
  }

  if (excludeHits.length > 0) {
    return `Very weak fit for ${profile.label}. Mostly about ${formatList(excludeHits)}.`;
  }
  if (broad) {
    return `Very weak fit for ${profile.label}. The title is broad and generic.`;
  }
  return `Very weak fit for ${profile.label}. It appears off-topic.`;
}

async function explainScore(text: string, score: number): Promise<string> {
  const title = text.replace(/\s+/g, " ").trim();
  if (!title) {
    return "No title text available to inspect.";
  }
  const anchor = await loadAnchor();
  return buildDeterministicExplanation(title, score, anchor);
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

function scoreTexts(texts: string[]) {
  if (!anchorEmbedding) throw new Error("Anchor not set");
  return embed(texts).then((embeddings) =>
    texts.map((text, i) => {
      const score = cosineSimilarity(anchorEmbedding!, embeddings[i]);
      return mapScoreToVibe(text, score);
    })
  );
}

// ---------------------------------------------------------------------------
// Anchor management
// ---------------------------------------------------------------------------

async function loadAnchor(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.ANCHOR);
  const stored = result[STORAGE_KEYS.ANCHOR];
  return typeof stored === "string" && stored.length > 0
    ? stored
    : DEFAULT_QUERY_ANCHOR;
}

async function setAnchor(anchor: string): Promise<void> {
  console.log(`[bg] Setting anchor: "${anchor}"`);
  const [emb] = await embed([anchor]);
  anchorEmbedding = emb;
  anchorReady = true;
  console.log("[bg] Anchor embedded");

  // Mark all page score cache entries stale; rescore active tab immediately
  if (pageScoringEnabled) {
    for (const entry of pageScoreCache.values()) {
      entry.stale = true;
    }
    if (activeTabId > 0) void scorePageTitle(activeTabId);
  }
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
  stale: boolean;
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

/** Sites with content scripts already doing feed-level scoring. */
const FEED_SCORED_HOSTS = [
  "news.ycombinator.com",
  "www.reddit.com", "old.reddit.com", "new.reddit.com",
  "x.com", "twitter.com",
];

function isScorableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  try {
    const host = new URL(url).hostname;
    return !FEED_SCORED_HOSTS.includes(host);
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

    // Dedup: skip if same normalized title is already cached and not stale
    const existing = pageScoreCache.get(tabId);
    if (existing && existing.normalizedTitle === norm && !existing.stale) {
      return existing;
    }

    const [result] = await scoreTexts([norm]);
    const entry: PageScoreCacheEntry = {
      title,
      normalizedTitle: norm,
      result,
      stale: false,
    };
    pageScoreCache.set(tabId, entry);
    updateBadge(tabId, result);

    // Broadcast to popup
    chrome.runtime.sendMessage({
      type: MSG.PAGE_SCORE_UPDATED,
      payload: { tabId, title, normalizedTitle: norm, result, state: "ready" },
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
  if (cached && !cached.stale) {
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
        scoreTexts(p.texts)
          .then((results) => sendResponse({ results }))
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
        explainScore(p.text, safeScore)
          .then((explanation) => sendResponse({ explanation }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case MSG.GET_STATUS: {
        sendResponse({ ...cachedStatus, modelReady, hasAnchor: anchorReady });
        return;
      }

      case MSG.UPDATE_ANCHOR: {
        const { anchor } = payload as UpdateAnchorPayload;
        if (anchor && modelReady) {
          anchorReady = false;
          chrome.storage.local.set({ [STORAGE_KEYS.ANCHOR]: anchor });
          setAnchor(anchor)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: String(err) }));
          return true;
        }
        sendResponse({ ok: true });
        return;
      }

      case MSG.SAVE_LABEL: {
        const { label } = payload as SaveLabelPayload;
        enqueueLabelWrite((labels) => { labels.push(label); return labels; })
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ error: String(err) }));
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
        enqueueLabelWrite(() => (Array.isArray(labels) ? labels : []))
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
        enqueueLabelWrite((labels) => { labels.push(...incoming); return labels; })
          .then(() => sendResponse({ success: true, count: incoming.length }))
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
          if (cached && !cached.stale && cached.title === tab.title) {
            sendResponse({
              title: cached.title,
              normalizedTitle: cached.normalizedTitle,
              result: cached.result,
              state: "ready",
            } as PageScoreResponse);
            return;
          }

          // Fetch-or-score: try scoring on demand
          if (!modelReady || !anchorReady) {
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

      case MSG.MODEL_STATUS: {
        // Ignore — we are the source
        break;
      }

      default:
        break;
    }

    return undefined;
  },
);
