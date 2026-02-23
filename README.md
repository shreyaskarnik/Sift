<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="chrome-extension/public/icons/logo-dark.svg">
    <img src="chrome-extension/public/icons/logo-light.svg" alt="Sift logo" width="220">
  </picture>
</p>

# Sift

Sift through the noise. Score your feed with EmbeddingGemma, right in the browser.

Sift is a Chrome extension that runs EmbeddingGemma directly in the browser via Transformers.js + WebGPU:

- [EmbeddingGemma-300M](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX) (q4) — scores content against your interests using cosine similarity

Current site support (for now): **Hacker News, Reddit, and X**. More site integrations are planned.
On supported sites, Sift dims low-relevance items so the good stuff stands out.

Users can label items (thumbs up/down) to collect training data, export it as CSV, and fine-tune the model with the included Python pipeline.

## At a Glance

<p align="center">
  <img src="docs/assets/sift-infographic.svg" alt="Sift infographic: local scoring, supported sites, and training loop" width="100%">
</p>

## How It Works

1. **Category selection** — Pick scoring categories like "AI Research" or "Open Source" (25 built-in, custom coming soon)
2. **Embedding** — Every title/tweet gets embedded by EmbeddingGemma running in your browser (WebGPU/WASM)
3. **Scoring** — Cosine similarity against category anchor embeddings produces a 0–1 score
4. **Category detection** — Each item is compared against all active categories; top matches appear as pills in the feed inspector
5. **Dimming** — Low scores fade out, high scores stay bright. Sensitivity is adjustable
6. **Taste profile** — After labeling 10+ items, Sift builds a contrastive taste profile showing your top interests ranked by affinity
7. **Training** — Thumbs up/down on items exports as per-category CSV triplets for fine-tuning

## Extension

Chrome MV3 extension in `chrome-extension/`. Runs entirely client-side — no server, no data leaves your browser.

Supported sites today: **Hacker News, Reddit, X** (more coming).

### Features

- EmbeddingGemma-300M (q4) inference via WebGPU with WASM fallback
- Deterministic score inspector (`?`) with score band + concise rationale
- Scores HN, Reddit, and X feeds with ambient opacity dimming
- Per-site toggles and sensitivity slider
- 25 built-in categories across tech, world, and lifestyle groups (user-defined categories coming soon)
- **Auto-detected category pills** — popup hero card and feed inspector show which categories match the current page/item
- **Taste profile** — contrastive centroid of your positive/negative labels scored against ~100 curated probe phrases; top-5 preview in popup, full-page view with category chips and ranked bars
- Thumbs up/down training labels with per-anchor CSV export
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

## Publishing Fine-tuned Models

Fine-tuned ONNX model files contain only numerical weights, tokenizer vocabulary, and architecture config — **no training data, user labels, or personal information**. They are safe to publish publicly on HuggingFace Hub, which is the recommended approach for use with the extension.

```bash
# Push to HuggingFace Hub after training
python train.py data.csv --push-to-hub your-username/sift-finetuned
# Also valid: --push-to-hub sift-finetuned (auto-uses your username)
```

Then set the model ID in the extension popup. No authentication is needed for public models.

For private/development models, use the local server instead (`python train.py --serve`).

## Training Pipeline

Fine-tune EmbeddingGemma on your collected labels, export to ONNX, and quantize for browser inference.

### Colab (recommended if you don't have a GPU)

Open `train_colab.ipynb` in Google Colab with a T4 GPU runtime. Upload your CSV, run all cells, download the ONNX zip.

### Install

```bash
uv pip install ".[quantize]"
```

### Usage

```bash
# Fine-tune on exported CSV
python train.py path/to/sift_training.csv

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
    (IIFE)       (SCORE_TEXTS, EXPLAIN_SCORE)       (ES module)
                                                       │
Popup ──────────chrome.runtime.sendMessage─────────────┘
    (IIFE)         (GET_STATUS, CATEGORIES_CHANGED)
```

- **Background** — Loads EmbeddingGemma via Transformers.js, manages scoring + deterministic inspector rationale, routes messages, stores labels
- **Content scripts** — Site-specific DOM selectors, MutationObserver for infinite scroll, debounced scoring
- **Popup** — Settings, category toggles, sensitivity slider, taste profile preview, data export
- **Taste page** — Full-width taste profile viewer (`taste.html`), reads cached profile from storage

## Project Structure

```
├── train.py                    # CLI: fine-tune + ONNX export + quantize + serve
├── train_colab.ipynb           # Self-contained Colab notebook (GPU training)
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
        ├── taste/              # Full-page taste profile viewer
        ├── shared/             # Constants, types, taste probes, cache-key utils
        └── storage/            # CSV export, X archive parser
```

## License

Apache-2.0
