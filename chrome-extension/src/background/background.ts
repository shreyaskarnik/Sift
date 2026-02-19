/**
 * Service worker — handles model inference directly using Transformers.js v4.
 *
 * Following the HuggingFace browser-extension example pattern:
 * model loads directly in the service worker, no offscreen/sandbox needed.
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
  ScoreTextsPayload,
} from "../shared/types";

// ---------------------------------------------------------------------------
// Env config
// ---------------------------------------------------------------------------

env.allowLocalModels = false;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let anchorEmbedding: Float32Array | null = null;
let modelReady = false;
let anchorReady = false;
let loadingPromise: Promise<void> | null = null;
let cachedStatus: ModelStatus = { state: "idle" };

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

function broadcastStatus(status: ModelStatus): void {
  cachedStatus = status;
  chrome.runtime.sendMessage({ type: MSG.MODEL_STATUS, payload: status }).catch(() => {});
}

async function loadModel(): Promise<void> {
  if (modelReady || loadingPromise) return;

  loadingPromise = (async () => {
    try {
      // Check for custom model URL (local testing)
      const stored = await chrome.storage.local.get(STORAGE_KEYS.CUSTOM_MODEL_URL);
      const customUrl = (stored[STORAGE_KEYS.CUSTOM_MODEL_URL] as string | undefined)?.trim();
      const isLocal = !!customUrl;

      // For local: point Transformers.js at the local server, use "local" as model ID
      // The server handles the HF URL pattern: /{model}/resolve/{revision}/{file}
      const modelId = isLocal ? "local" : MODEL_ID;
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

      console.log(`[bg] Loading model ${modelId} from ${isLocal ? customUrl : "HF"} on ${device} (dtype=${dtype})...`);
      broadcastStatus({
        state: "loading",
        message: `Loading ${isLocal ? "local" : "HF"} model on ${device}...`,
        backend: device,
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

      console.log(`[bg] Model ready (${device})`);
      broadcastStatus({ state: "ready", backend: device });

      // Embed the anchor phrase
      const anchor = await loadAnchor();
      await setAnchor(anchor);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[bg] Model load error:", message);
      broadcastStatus({ state: "error", message });
      loadingPromise = null;
    }
  })();

  return loadingPromise;
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
  labelWriteQueue = labelWriteQueue.then(async () => {
    const labels = await readLabels();
    await writeLabels(fn(labels));
  });
  return labelWriteQueue;
}

// ---------------------------------------------------------------------------
// Model initialization on install / startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  console.log("[bg] onInstalled fired");
  loadModel();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[bg] onStartup fired");
  loadModel();
});

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
        loadModel();
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
          prev.catch(() => {}).then(() => loadModel());
        } else {
          loadModel();
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

      case MSG.CLEAR_LABELS: {
        writeLabels([])
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
