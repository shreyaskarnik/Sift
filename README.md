# SimScore

Score your feed with EmbeddingGemma, right in the browser.

SimScore is a Chrome extension that runs [EmbeddingGemma-300M](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX) (q4 quantized) directly in the browser via Transformers.js + WebGPU. It scores content on Hacker News, Reddit, and X against a configurable anchor phrase using cosine similarity, and dims low-relevance items so the good stuff stands out.

Users can label items (thumbs up/down) to collect training data, export it as CSV, and fine-tune the model with the included Python pipeline.

## How It Works

1. **Anchor phrase** — You pick a "scoring lens" like `MY_FAVORITE_NEWS` or `AI_RESEARCH`
2. **Embedding** — Every title/tweet gets embedded by EmbeddingGemma running in your browser (WebGPU/WASM)
3. **Scoring** — Cosine similarity against the anchor embedding produces a 0–1 score
4. **Dimming** — Low scores fade out, high scores stay bright. Sensitivity is adjustable
5. **Training** — Thumbs up/down on items exports as CSV triplets for fine-tuning

## Extension

Chrome MV3 extension in `chrome-extension/`. Runs entirely client-side — no server, no data leaves your browser.

### Features

- EmbeddingGemma-300M (q4) inference via WebGPU with WASM fallback
- Scores HN, Reddit, and X feeds with ambient opacity dimming
- Per-site toggles and sensitivity slider
- Scoring lens presets (News, AI Research, Startups, Deep Tech, Science)
- Thumbs up/down training labels with CSV export
- X archive import (like.js, bookmark.js)
- Light/dark mode (follows system)
- Custom model URL for testing local fine-tuned models

### Build

```bash
cd chrome-extension
npm install
npm run build
```

Load `chrome-extension/dist/` as an unpacked extension in `chrome://extensions`.

## Training Pipeline

Fine-tune EmbeddingGemma on your collected labels, export to ONNX, and quantize for browser inference.

### Install

```bash
uv pip install ".[quantize]"
```

### Usage

```bash
# Fine-tune on exported CSV
python train.py path/to/simscore_training.csv

# With custom hyperparams
python train.py data.csv --epochs 6 --lr 3e-5

# Convert existing model to ONNX (fp32 + int8 + q4)
python train.py --convert-only path/to/saved_model

# Serve locally for testing in extension
python train.py --serve path/to/onnx_output --port 8000
```

Set `Custom Model URL` to `http://localhost:8000` in the extension popup to test your fine-tuned model.

### Training Data Format

CSV with `Anchor,Positive,Negative` columns:

```csv
Anchor,Positive,Negative
MY_FAVORITE_NEWS,"Show HN: A new static site generator","Ask HN: What's your salary?"
MY_FAVORITE_NEWS,"Rust is eating the world","Bitcoin drops 10%"
```

## Architecture

```
Content Scripts ──chrome.runtime.sendMessage──▸ Background Service Worker
    (IIFE)            (SCORE_TEXTS)                (ES module)
                                                       │
Popup ──────────chrome.runtime.sendMessage─────────────┘
    (IIFE)         (GET_STATUS, UPDATE_ANCHOR)
```

- **Background** — Loads model via Transformers.js, manages anchor embedding, routes messages, stores labels
- **Content scripts** — Site-specific DOM selectors, MutationObserver for infinite scroll, debounced scoring
- **Popup** — Settings, lens picker, sensitivity slider, data export

## Project Structure

```
├── train.py                    # CLI: fine-tune + ONNX export + quantize + serve
├── pyproject.toml              # Python dependencies
├── src/                        # Python modules (config, trainer, vibe logic)
└── chrome-extension/
    ├── build.mjs               # Dual-build (Vite + IIFE content scripts)
    ├── public/                 # manifest.json, popup HTML/CSS, icons
    └── src/
        ├── background/         # Service worker (model + message routing)
        ├── content/            # HN, Reddit, X content scripts
        │   └── common/         # Shared: batch scorer, styles, widget, labels
        ├── popup/              # Popup UI
        ├── shared/             # Constants, types
        └── storage/            # CSV export, X archive parser
```

## License

Apache-2.0
