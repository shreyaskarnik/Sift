# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Sift is a Chrome MV3 extension that runs two models directly in the browser via Transformers.js v4:

1. **EmbeddingGemma-300M** (q4) — Scores feed items on HN, Reddit, and X against a user-defined anchor phrase using cosine similarity, dimming low-relevance items
2. **Gemma 3 270M IT** (q4) — "Why this score?" explanations via text generation

Users can label items (thumbs up/down) to collect training data for fine-tuning the embedding model.

## Build Commands

```bash
npm run build        # Full production build (tsc + node build.mjs)
npm run dev          # Vite watch mode (background only, no IIFE rebuilds)
npm run typecheck    # Type-check without emitting
```

After building, load `dist/` as an unpacked extension in `chrome://extensions`.

## Build Architecture

The build is a **dual-build system** via `build.mjs`:

1. **Main Vite build** (`vite.config.ts`) — compiles `background.ts` as an ES module, bundling Transformers.js + ONNX WASM. Copies `public/` to `dist/`.
2. **Sequential IIFE builds** — compiles popup and each content script (`hn-content`, `reddit-content`, `x-content`) as self-contained IIFEs with `inlineDynamicImports: true`.

Content scripts **must** be IIFE format because Chrome loads them as classic scripts, not ES modules. Each IIFE build uses `publicDir: false` to avoid re-copying assets.

Path alias: `@shared` → `src/shared/`.

## Architecture

### Message Flow

```
Content Scripts ──chrome.runtime.sendMessage──► Background Service Worker
    (IIFE)       (SCORE_TEXTS, EXPLAIN_SCORE)       (ES module)
                                                        │
Popup ──────────chrome.runtime.sendMessage──────────────┘
    (IIFE)         (GET_STATUS, UPDATE_ANCHOR, etc.)
```

All inter-context communication uses `chrome.runtime.sendMessage` with typed message envelopes (`ExtensionMessage`). Message types are defined in `MSG` constants. The background responds via `sendResponse`; async handlers return `true` to keep the channel open.

### Dual Model Architecture

The service worker loads both models sequentially on init:
1. EmbeddingGemma-300M via `AutoModel.from_pretrained()` for embedding/scoring
2. Gemma 3 270M IT via `pipeline("text-generation")` for explanations

Status broadcasting includes both `state` (embedding model) and `llmState` (Gemma 3).

### Key Modules

- **`src/background/background.ts`** — Service worker: loads both models, manages scoring + text generation, message routing, label storage.
- **`src/content/common/batch-scorer.ts`** — Shared by all content scripts: polls until model is ready (exponential backoff), sends texts in batches of `SCORE_BATCH_SIZE` (16).
- **`src/content/common/widget.ts`** — `applyScore()` applies ambient dimming + vote buttons + explain ("?") button.
- **`src/content/common/styles.ts`** — Injected CSS for score indicators, vote buttons, explain tooltips.
- **`src/content/common/label-buttons.ts`** — Thumbs up/down buttons for collecting training labels.
- **`src/content/{hn,reddit,x}/`** — Site-specific DOM selectors and injection logic. Reddit and X use `MutationObserver` for infinite scroll.
- **`src/shared/constants.ts`** — Model IDs (`MODEL_ID`, `LLM_MODEL_ID`), anchor default, vibe thresholds, message types, storage keys.
- **`src/shared/types.ts`** — TypeScript interfaces for all messages and data structures.
- **`src/storage/csv-export.ts`** — Exports labels as Anchor/Positive/Negative triplet CSV for training.
- **`src/storage/x-archive-parser.ts`** — Parses X data archive files (like.js, bookmark.js) into positive labels.

### Dead Code

`src/offscreen/` (offscreen.ts, sandbox.ts, worker.ts) contains a previous offscreen→sandbox→iframe approach that is **no longer used**. The current architecture loads models directly in the service worker. These files can be deleted.

`src/content/common/badge-injector.ts` is from the original pill-badge UI, now replaced by ambient dimming in widget.ts.

## Key Technical Details

- **Transformers.js v4** (`@huggingface/transformers@next`) — loads ONNX models directly in service workers. Only needs `wasm-unsafe-eval` in CSP.
- **WebGPU vs WASM** — auto-detected at runtime. WebGPU uses `model_no_gather` variant for embedding model; WASM uses `model`.
- **dtype `q4`** — Both models use 4-bit quantization. Transformers.js auto-appends `_q4` to `model_file_name`.
- **Custom model URL** — stored in `chrome.storage.local`. Sets `env.remoteHost` for Transformers.js, which fetches `{remoteHost}/{modelId}/resolve/main/{filename}`. Applies to embedding model only; LLM always loads from HuggingFace.
- The embedding model output key is `sentence_embedding` (normalized vectors), so cosine similarity reduces to a dot product.
- LLM uses the `pipeline("text-generation")` API with `max_new_tokens: 80`.

## Parent Project

This extension is part of the Sift project (`embeddinggemma-tuning-lab`), which includes a Python training pipeline for fine-tuning EmbeddingGemma. The extension collects in-browser training labels that can be exported as CSV and fed back into the training pipeline.
