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
  TrainingLabel,
  SaveLabelPayload,
  UpdateAnchorPayload,
  ImportXLabelsPayload,
  SetLabelsPayload,
  ScoreTextsPayload,
  ExplainScorePayload,
} from "../shared/types";

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
