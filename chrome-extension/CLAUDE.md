# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SimScore is a Chrome MV3 extension that runs EmbeddingGemma-300M (ONNX-quantized) directly in the browser via Transformers.js v4. It scores feed items on HN, Reddit, and X/Twitter against a user-defined anchor phrase using cosine similarity, displaying vibe badges inline. Users can label items (thumbs up/down) to collect training data for fine-tuning the model elsewhere.

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
    (IIFE)            (SCORE_TEXTS, etc.)           (ES module)
                                                        │
Popup ──────────chrome.runtime.sendMessage──────────────┘
    (IIFE)         (GET_STATUS, UPDATE_ANCHOR, etc.)
```

All inter-context communication uses `chrome.runtime.sendMessage` with typed message envelopes (`ExtensionMessage`). Message types are defined in `MSG` constants. The background responds via `sendResponse`; async handlers return `true` to keep the channel open.

### Key Modules

- **`src/background/background.ts`** — Service worker: loads model via Transformers.js, manages anchor embedding, handles all message routing, stores/retrieves training labels via `chrome.storage.local`.
- **`src/content/common/batch-scorer.ts`** — Shared by all content scripts: polls until model is ready (exponential backoff), sends texts in batches of `SCORE_BATCH_SIZE` (16).
- **`src/content/common/badge-injector.ts`** — Creates the inline vibe badge (HSL-colored score + emoji).
- **`src/content/common/label-buttons.ts`** — Thumbs up/down buttons for collecting training labels.
- **`src/content/{hn,reddit,x}/`** — Site-specific DOM selectors and injection logic. Reddit and X use `MutationObserver` for infinite scroll.
- **`src/shared/constants.ts`** — Model ID, anchor default, vibe thresholds, message types, storage keys.
- **`src/shared/types.ts`** — TypeScript interfaces for all messages and data structures.
- **`src/storage/csv-export.ts`** — Exports labels as Anchor/Positive/Negative triplet CSV for training.
- **`src/storage/x-archive-parser.ts`** — Parses X data archive files (like.js, bookmark.js) into positive labels.

### Dead Code

`src/offscreen/` (offscreen.ts, sandbox.ts, worker.ts) contains a previous offscreen→sandbox→iframe approach that is **no longer used**. The current architecture loads the model directly in the service worker. These files can be deleted.

## Key Technical Details

- **Transformers.js v4** (`@huggingface/transformers@next`) — loads ONNX models directly in service workers. Only needs `wasm-unsafe-eval` in CSP.
- **WebGPU vs WASM** — auto-detected at runtime. WebGPU uses `model_no_gather` variant; WASM uses `model`.
- **dtype `q4`** — Transformers.js auto-appends `_q4` to `model_file_name`, so pass `"model"` not `"model_q4"`.
- **Custom model URL** — stored in `chrome.storage.local`. Sets `env.remoteHost` for Transformers.js, which fetches `{remoteHost}/{modelId}/resolve/main/{filename}`.
- The model output key is `sentence_embedding` (normalized vectors), so cosine similarity reduces to a dot product.

## Parent Project

This extension is part of `embeddinggemma-tuning-lab`, which includes Python tools for fine-tuning EmbeddingGemma (Gradio app, CLI, Flask viewer). The extension collects in-browser training labels that can be exported as CSV and fed back into the Python training pipeline.
