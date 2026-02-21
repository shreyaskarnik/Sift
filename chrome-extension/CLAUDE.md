# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Sift is a Chrome MV3 extension that runs an embedding model directly in the browser via Transformers.js v4:

1. **EmbeddingGemma-300M** (q4) — Scores feed items on HN, Reddit, and X against a user-defined anchor phrase using cosine similarity, dimming low-relevance items
2. **Deterministic inspector** — "Why this score?" rationale from score bands + title/lens signals (no generation model)

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

```bash
Content Scripts ──chrome.runtime.sendMessage──► Background Service Worker
    (IIFE)       (SCORE_TEXTS, EXPLAIN_SCORE)       (ES module)
                                                        │
Popup ──────────chrome.runtime.sendMessage──────────────┘
    (IIFE)         (GET_STATUS, UPDATE_ANCHOR, etc.)
```

All inter-context communication uses `chrome.runtime.sendMessage` with typed message envelopes (`ExtensionMessage`). Message types are defined in `MSG` constants. The background responds via `sendResponse`; async handlers return `true` to keep the channel open.

### Scoring + Inspector Architecture

The service worker loads EmbeddingGemma on init via `AutoModel.from_pretrained()` for scoring.
Inspector explanations are deterministic and generated from score band + lens/title term signals.

### Key Modules

- **`src/background/background.ts`** — Service worker: loads embedding model, manages scoring + deterministic inspector rationale, message routing, label storage.
- **`src/content/common/batch-scorer.ts`** — Shared by all content scripts: polls until model is ready (exponential backoff), sends texts in batches of `SCORE_BATCH_SIZE` (16).
- **`src/content/common/widget.ts`** — `applyScore()` applies ambient dimming + vote buttons + explain ("?") button.
- **`src/content/common/styles.ts`** — Injected CSS for score indicators, vote buttons, explain tooltips.
- **`src/content/common/label-buttons.ts`** — Thumbs up/down buttons for collecting training labels.
- **`src/content/{hn,reddit,x}/`** — Site-specific DOM selectors and injection logic. Reddit and X use `MutationObserver` for infinite scroll.
- **`src/shared/constants.ts`** — Model IDs (`MODEL_ID`), anchor default, vibe thresholds, message types, storage keys.
- **`src/shared/types.ts`** — TypeScript interfaces for all messages and data structures.
- **`src/storage/csv-export.ts`** — Exports labels as Anchor/Positive/Negative triplet CSV for training.
- **`src/storage/x-archive-parser.ts`** — Parses X data archive files (like.js, bookmark.js) into positive labels.

## Key Technical Details

- **Transformers.js v4** (`@huggingface/transformers@next`) — loads ONNX models directly in service workers. Only needs `wasm-unsafe-eval` in CSP.
- **WebGPU vs WASM** — auto-detected at runtime. WebGPU uses `model_no_gather` variant for embedding model; WASM uses `model`.
- **dtype `q4`** — Embedding model uses 4-bit quantization. Transformers.js auto-appends `_q4` to `model_file_name`.
- **Custom model source** — A single "Model Source" input accepts either a HuggingFace model ID (e.g. `org/model-ONNX`) or a local server URL (e.g. `http://localhost:8000`). Auto-detected by `http(s)://` prefix; the two are mutually exclusive. Stored in `chrome.storage.local` as `CUSTOM_MODEL_ID` or `CUSTOM_MODEL_URL`. URLs set `env.remoteHost` for Transformers.js.
- **Model status includes `modelId`** — `ModelStatus.modelId` broadcasts the resolved display name (URL for local, HF model ID for remote) so the popup shows which model is active.
- The embedding model output key is `sentence_embedding` (normalized vectors), so cosine similarity reduces to a dot product.
- **HF auth not supported browser-side** — Transformers.js v4 intentionally disables browser auth. Finetuned models must be public on HuggingFace Hub. ONNX files contain only numerical weights and tokenizer data — safe to publish.

## Service Worker Gotchas

- **No `window` APIs** — `self.matchMedia()`, `document`, `localStorage` etc. are NOT available in MV3 service workers. Theme detection is done in popup (`popup.ts`) and content scripts (`widget.ts`) which have `window.matchMedia`, then persisted to `chrome.storage.local`. The background listens for storage changes to apply theme-aware icons via `chrome.action.setIcon()`.
- **`chrome.runtime.sendMessage()` broadcasts** — Messages go to ALL extension contexts. The background ignores its own `MODEL_STATUS` messages to avoid loops.

## Data Quality

- **X archive parser** (`x-archive-parser.ts`) — Strips `t.co` and other URLs, trailing truncation markers (`…`), collapses whitespace, and rejects entries under 15 characters.
- **CSV export** (`csv-export.ts`) — `csvEscape()` normalizes all whitespace (newlines, tabs) to single spaces before quoting, preventing multiline CSV fields.

## Parent Project

This extension is part of the Sift project (`embeddinggemma-tuning-lab`), which includes a Python training pipeline for fine-tuning EmbeddingGemma. The extension collects in-browser training labels that can be exported as CSV and fed back into the training pipeline.
