# LinkedIn Announcement Post (Option B — Storytelling)

**Every morning I'd open Hacker News, Reddit, and X — and spend 20 minutes scrolling past things I don't care about to find the 3 things I do.**

So I built Sift.

It's a Chrome extension that runs an embedding model (EmbeddingGemma-300M, quantized to 4-bit) directly in your browser. No server, no account, no data collection.

When you load a feed, Sift scores every item against 25 interest categories — AI Research, Startups, Climate, Politics, whatever you've turned on. Items that don't match your interests fade to near-transparent. Items that do stay vivid.

The "aha" moment for me was the training loop. You can:
- Label items with thumbs up/down as you browse
- Export those labels as training triplets
- Fine-tune the model on your personal preferences (locally or on Colab)
- Load the fine-tuned model back into the extension

After ~50 labels and one training run, the difference is striking. The model stops being generic and starts reflecting *you*.

There's also an inspector (press "?" on any item) that explains scores deterministically — no LLM call, no cost, instant.

And a Taste Profile that reveals your sub-topic preferences: "You prefer open-source ML frameworks over enterprise SaaS" or "You engage more with climate policy than climate science."

Everything runs client-side. Your labels, your model, your data — all yours.

Built with @Hugging Face Transformers.js, @Google EmbeddingGemma, and @Google Chrome Extensions MV3.

[link to repo]

#BuildInPublic #AI #Privacy #ChromeExtension #OpenSource

### Companies to tag on LinkedIn:
- **Hugging Face** — Transformers.js runtime + model hosting (HF Hub)
- **Google** — EmbeddingGemma model + Chrome platform + Colab notebooks
- **Google Chrome** — Chrome Extensions / MV3 platform
- **ONNX Runtime / Microsoft** — ONNX model format + quantization tooling
- **Y Combinator / Hacker News** — one of the three supported feeds
- **Reddit** — one of the three supported feeds
- **X (Twitter)** — one of the three supported feeds

---

# X (Twitter) Post

## Standard Post (280 characters)

I built a Chrome extension that runs a 300M-param AI model in your browser to filter HN, Reddit, and X feeds.

No server. No data leaves your device.

Label items → fine-tune → reload. It learns YOUR taste.

Open source: [link]

## Thread Version (for more reach)

**Tweet 1 (hook):**
I built a Chrome extension that runs a 300M-parameter embedding model entirely in your browser to filter your feeds.

No server. No login. Your data never leaves your device.

It's called Sift. Here's how it works:

**Tweet 2 (how it works):**
When you load Hacker News, Reddit, or X — Sift scores every item against your interest categories using EmbeddingGemma (quantized to ~50MB).

Low-relevance items fade out. High-relevance items stay bright.

25 built-in categories: AI Research, Startups, Climate, Politics, etc.

**Tweet 3 (the training loop):**
But the real magic is the training loop:

1. Thumbs up/down items as you browse
2. Export labels as CSV triplets
3. Fine-tune with one Python script (or free Colab notebook)
4. Load your personalized model back in

~50 labels and one training run — the model starts reflecting YOU.

**Tweet 4 (taste profile):**
There's also a Taste Profile that reveals your sub-topic preferences:

"You prefer open-source ML frameworks over enterprise SaaS"
"You engage more with climate policy than climate science"

Like a mirror for your information diet.

**Tweet 5 (CTA):**
Stack: TypeScript, Chrome MV3, @huaboringface Transformers.js, @Google EmbeddingGemma, ONNX quantization

Everything is open source: [link]

### Companies/accounts to tag on X:
- **@huggingface** — Transformers.js, model hub
- **@Google** — EmbeddingGemma model
- **@GoogleChrome** — Chrome Extensions platform
- **@onnxruntime** — ONNX model format
- **@GoogleColab** — training notebook environment

---

# Video Demo Ideas

## 1. "Before & After" Side-by-Side (60–90 seconds)
- **Left panel**: Raw Hacker News / Reddit feed — wall of undifferentiated links
- **Right panel**: Same feed with Sift active — low-relevance items faded, high-relevance items bright
- **Narration**: "This is what my feed looks like without Sift. And this is with it."
- **End with**: toggling categories on/off and watching scores shift in real-time

## 2. "The Full Loop" Walkthrough (2–3 minutes)
Show the end-to-end workflow:
1. **Install & configure** — select your interest categories
2. **Browse HN** — watch items get scored, show the opacity dimming
3. **Press "?"** — show the inspector explaining *why* an item scored the way it did
4. **Thumbs up/down** — label 5-10 items live
5. **Export CSV** — show the triplet format
6. **Run training** — terminal or Colab, show the loss curve and Taste Check metrics
7. **Reload model** — paste custom model URL, show scores improve
8. **Taste Profile** — open the full-page viewer, scroll through ranked probes

## 3. "Privacy Proof" Demo (60 seconds)
- Open Chrome DevTools Network tab
- Browse with Sift active
- Show that **zero network requests** go to any external server
- The model loads once from a CDN/local, then everything is local inference
- "Your reading habits never leave your machine."

## 4. "Three Sites, One Brain" (45 seconds)
Quick cuts between:
- **Hacker News** — tech items scored
- **Reddit** — subreddit posts scored
- **X/Twitter** — tweets scored
- Same categories, same model, consistent scoring across platforms
- "One model. Three feeds. Your interests, everywhere."

## 5. "Taste Profile Reveal" (30–45 seconds, good for a short-form clip)
- Open the Taste Profile page cold
- Zoom in on the ranked probes
- Highlight surprising or specific sub-topic preferences
- "I didn't know I cared more about distributed systems than frontend frameworks until Sift showed me."

## 6. Screen Recording Tips
- Use a clean browser profile with just Sift installed
- Pre-load some labeled data so the Taste Profile is populated
- Record at 1080p or higher, crop to the browser window
- For the training step, speed up the terminal output (2-4x) with a progress bar visible
- Add simple text overlays for each step rather than heavy narration
