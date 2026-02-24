# LinkedIn Announcement Post (Shipped + Near-Term Prototype)

Every morning I'd open Hacker News, Reddit, and X and spend 20 minutes digging for the 3 things I actually cared about.

So I built Sift.

Sift is a Chrome extension that runs EmbeddingGemma-300M (q4) in your browser to score feed items against your active interests and fade low-relevance posts.

Shipped today:
- In-browser scoring on Hacker News, Reddit, and X
- Deterministic "?" inspector for score explanations (no LLM call)
- Thumbs up/down labeling while browsing
- Label export as triplet CSV for training
- Taste Profile with interactive radar chart
- Label Manager for filtering, edits, category reassignment, and URL-based label add

Training loop:
1. Label while browsing
2. Export CSV
3. Fine-tune in Colab or locally
4. Reload your model in the extension

WebGPU when available, WASM fallback.

Near-term prototype:
I'm testing an Agent mode that fetches and ranks top HN stories by your taste vector.

Privacy model:
No backend collecting your feed behavior; inference + labels stay local.

Built with Transformers.js, EmbeddingGemma, Chrome Extensions MV3, and ONNX tooling.

[link to repo]

#BuildInPublic #AI #Privacy #ChromeExtension #OpenSource

### Companies to tag on LinkedIn
- Hugging Face - Transformers.js runtime + model hosting
- Google - EmbeddingGemma model + Colab
- Google Chrome - Chrome Extensions / MV3 platform
- Microsoft / ONNX Runtime - ONNX format + runtime tooling
- Y Combinator / Hacker News - one supported feed source
- Reddit - one supported feed source
- X (Twitter) - one supported feed source

---

# X (Twitter) Post

## Standard Post (280 characters)

Built Sift: a Chrome extension that ranks HN, Reddit, and X using EmbeddingGemma in-browser.

No backend collecting your feed behavior; inference + labels stay local.

Train in Colab/local, reload your model. WebGPU when available, WASM fallback.

OSS: [link]

## Thread Version (for more reach)

**Tweet 1 (hook):**
I built Sift, a Chrome extension that runs EmbeddingGemma in-browser to rank Hacker News, Reddit, and X.

No backend collecting your feed behavior; inference + labels stay local.

**Tweet 2 (how it works):**
Open HN, Reddit, or X and Sift scores each item against your active categories.

Low-relevance posts fade, high-relevance posts stay vivid.

25 built-in categories right now.

**Tweet 3 (training loop):**
Training loop:
1) Thumb up/down while browsing
2) Curate in Label Manager
3) Export CSV -> fine-tune in Colab/local
4) Reload model in extension

WebGPU when available, WASM fallback.

**Tweet 4 (taste + prototype):**
Also shipped: Taste Profile with an interactive radar chart.

Near-term prototype: Agent mode for HN that fetches and ranks top stories by your taste vector.

**Tweet 5 (CTA):**
Stack: TypeScript, Chrome MV3, Transformers.js, EmbeddingGemma, ONNX, WebGPU.

Open source + training notebook: [link]

### Companies/accounts to tag on X
- @huggingface - Transformers.js and model hub
- @Google - EmbeddingGemma
- @GoogleChrome - Chrome Extensions platform
- @onnxruntime - ONNX runtime/tooling
- @GoogleColab - notebook training environment

---

# Video Demo Ideas

## 1. "Before & After" Side-by-Side (60-90 seconds)
- Left panel: Raw Hacker News or Reddit feed
- Right panel: Same feed with Sift active
- Narration: "Without Sift vs with Sift"
- End with category toggles and live score shifts

## 2. "The Full Loop" Walkthrough (2-3 minutes)
Show end-to-end workflow:
1. Install and configure categories
2. Browse HN and show scoring/dimming
3. Press "?" and show deterministic explanation
4. Label 5-10 items with thumbs
5. Open Label Manager and edit/reassign one label
6. Export CSV
7. Run training in Colab or terminal
8. Reload model and compare behavior
9. Open Taste Profile and click radar axes

## 3. "Privacy Model" Demo (60 seconds)
- Open Chrome DevTools Network tab
- Browse with Sift active
- Show no calls to a Sift-owned backend for feed behavior (there is none)
- Clarify what traffic still exists: target sites + model/download endpoints
- "Personalization happens locally in the extension."

## 4. "Three Sites, One Model" (45 seconds)
Quick cuts:
- Hacker News
- Reddit
- X/Twitter
- Same categories, same model, consistent scoring pattern

## 5. "Taste Profile Reveal" (30-45 seconds)
- Open Taste Profile page
- Show radar chart and axis click-to-filter
- Scroll ranked probes
- Close with one concrete insight example

## 6. "Label Manager: Curate Training Data" (45-60 seconds)
- Open Label Manager from popup
- Filter by category/polarity/source
- Inline edit label text
- Reassign category
- Paste URL and show title fetch + category suggestion

## 7. "Agent Mode Teaser" (30-45 seconds)
- Position it as near-term prototype
- Show fetch/rank flow on top HN stories
- Highlight "your personal relevance-ranked front page"

## 8. Screen Recording Tips
- Use a clean browser profile with only Sift installed
- Pre-load labeled data for the Taste Profile section
- Record at 1080p+
- Speed up long training output (2-4x)
- Use lightweight text overlays for each section
