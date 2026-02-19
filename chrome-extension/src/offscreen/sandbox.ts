/**
 * Sandbox script — runs inside a sandboxed iframe within the offscreen document.
 * Sandboxed pages have no CSP restrictions, so ONNX Runtime's blob URLs work.
 *
 * Handles: model loading, tokenization, embedding, and scoring.
 * Communicates with the parent offscreen document via window.postMessage.
 */
import {
  AutoTokenizer,
  AutoModel,
  env,
  type PreTrainedTokenizer,
  type PreTrainedModel,
  type ProgressInfo,
} from "@huggingface/transformers";

// --- Constants (inlined to avoid cross-origin import issues in sandbox) ---
const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";
const VIBE_THRESHOLDS = [
  { score: 0.8, status: "VIBE:HIGH", emoji: "\u2728" },
  { score: 0.5, status: "VIBE:GOOD", emoji: "\uD83D\uDC4D" },
  { score: 0.2, status: "VIBE:FLAT", emoji: "\uD83D\uDE10" },
  { score: 0.0, status: "VIBE:LOW", emoji: "\uD83D\uDC4E" },
] as const;

// --- Env config ---
env.allowLocalModels = false;

// --- State ---
let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let anchorEmbedding: Float32Array | null = null;

// --- Utilities ---

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

// --- Message handler ---
window.addEventListener("message", async (event) => {
  // Only accept messages from the parent (offscreen document)
  if (event.source !== window.parent) return;

  const { type, id, ...data } = event.data;

  if (type === "init") {
    try {
      const hasWebGPU = !!(navigator as any).gpu;
      const device = hasWebGPU ? "webgpu" : "wasm";
      const dtype = "q4";
      const modelSuffix = hasWebGPU ? "model_no_gather" : "model";

      const post = (msg: any) =>
        window.parent.postMessage({ ...msg, id }, "*");

      post({
        type: "status",
        state: "loading",
        message: `Loading model on ${device}...`,
        backend: device,
      });

      const progressCallback = (progress: ProgressInfo) => {
        if (progress.status === "progress") {
          post({
            type: "status",
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
        AutoTokenizer.from_pretrained(MODEL_ID, {
          progress_callback: progressCallback,
        }),
        AutoModel.from_pretrained(MODEL_ID, {
          device,
          dtype,
          model_file_name: modelSuffix,
          progress_callback: progressCallback,
        } as any),
      ]);

      tokenizer = loadedTokenizer;
      model = loadedModel;

      post({ type: "status", state: "ready", backend: device });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      window.parent.postMessage(
        { type: "status", state: "error", message, id },
        "*"
      );
    }
    return;
  }

  if (type === "set_anchor") {
    try {
      const [emb] = await embed([data.anchor as string]);
      anchorEmbedding = emb;
      window.parent.postMessage({ type: "anchor_set", id }, "*");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      window.parent.postMessage({ type: "error", message, id }, "*");
    }
    return;
  }

  if (type === "score") {
    try {
      if (!anchorEmbedding) {
        window.parent.postMessage({ type: "error", message: "Anchor not set", id }, "*");
        return;
      }
      const texts: string[] = data.texts;
      const embeddings = await embed(texts);
      const results = texts.map((text, i) => {
        const score = cosineSimilarity(anchorEmbedding!, embeddings[i]);
        return mapScoreToVibe(text, score);
      });
      window.parent.postMessage({ type: "score_results", results, id }, "*");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      window.parent.postMessage({ type: "error", message, id }, "*");
    }
    return;
  }
});

// Signal that the sandbox is ready to receive messages
window.parent.postMessage({ type: "sandbox_ready" }, "*");
