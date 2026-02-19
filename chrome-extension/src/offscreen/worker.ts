/**
 * Web Worker for ML inference using Transformers.js
 *
 * Runs EmbeddingGemma-300M (ONNX-quantized) to produce sentence embeddings.
 * Attempts WebGPU first, falls back to WASM.
 */
import { AutoTokenizer, AutoModel, env, type PreTrainedTokenizer, type PreTrainedModel, type ProgressInfo } from "@huggingface/transformers";
import { MODEL_ID } from "../shared/constants";

// Disable local model check -- always fetch from HF Hub
env.allowLocalModels = false;

// Prevent ONNX Runtime from spawning internal blob-URL workers,
// which Chrome extension CSP blocks ("script-src 'self'" forbids blob:).
// proxy=false: we're already in a Worker, no need for a proxy worker.
// numThreads=1: single-threaded WASM, avoids SharedArrayBuffer thread workers.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
}

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, ...data } = e.data;

  if (type === "init") {
    try {
      // Detect WebGPU availability
      const hasWebGPU = !!(navigator as any).gpu;
      const device = hasWebGPU ? "webgpu" : "wasm";
      const dtype = "q4";
      // WebGPU needs the no_gather variant for EmbeddingGemma ONNX
      const modelSuffix = hasWebGPU ? "model_no_gather" : "model";

      self.postMessage({
        type: "status",
        state: "loading",
        message: `Loading model on ${device}...`,
        backend: device,
      });

      const progressCallback = (progress: ProgressInfo) => {
        if (progress.status === "progress") {
          self.postMessage({
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

      // Load tokenizer and model in parallel
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

      self.postMessage({
        type: "status",
        state: "ready",
        backend: device,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({
        type: "status",
        state: "error",
        message,
      });
    }
  }

  if (type === "embed") {
    try {
      if (!tokenizer || !model) {
        throw new Error("Model not loaded. Send 'init' first.");
      }

      const texts: string[] = data.texts;
      if (!texts || texts.length === 0) {
        self.postMessage({ type: "embeddings", embeddings: [] });
        return;
      }

      // Tokenize
      const inputs = tokenizer(texts, {
        padding: true,
        truncation: true,
        max_length: 256,
      });

      // Forward pass
      const output = await (model as any)(inputs);

      // EmbeddingGemma outputs `sentence_embedding` (already normalized)
      const sentenceEmbedding = output.sentence_embedding;

      // Convert to Float32Array[] -- one per input text
      const embeddings: Float32Array[] = [];
      const embDim = sentenceEmbedding.dims[1];
      const rawData = sentenceEmbedding.data as Float32Array;

      for (let i = 0; i < texts.length; i++) {
        const start = i * embDim;
        embeddings.push(new Float32Array(rawData.slice(start, start + embDim)));
      }

      self.postMessage({ type: "embeddings", embeddings });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({
        type: "error",
        message: `Embedding failed: ${message}`,
      });
    }
  }
};
