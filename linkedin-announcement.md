# LinkedIn Announcement Post

## Option A: Concise & Punchy

**I built a Chrome extension that runs a 300M-parameter AI model entirely in your browser to filter your feeds.**

No server. No login. No data leaves your device.

Sift uses EmbeddingGemma (quantized to ~50MB) via Transformers.js to score every item on Hacker News, Reddit, and X against your interests in real-time. Low-relevance items fade out. High-relevance items stay bright.

But the part I'm most excited about: a closed-loop training pipeline.

1. Browse normally and thumbs-up/down items you care about
2. Export your labels as CSV triplets
3. Fine-tune the model with a single Python script (or a free Colab notebook)
4. Load your personalized model back into the extension

The model literally learns *your* taste — not an average user's taste. And it does it with contrastive learning (MultipleNegativesRankingLoss), so it gets better at separating what you want from what you don't.

There's also a "Taste Profile" that shows your sub-topic preferences across ~100 probe phrases per category. It's like a mirror for your information diet.

Stack: TypeScript, Chrome MV3, Transformers.js (WebGPU/WASM), sentence-transformers, ONNX quantization.

Open source: [link]

#AI #ChromeExtension #MachineLearning #Privacy #OpenSource

---

## Option B: Storytelling Angle

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

[link to repo]

#BuildInPublic #AI #Privacy #ChromeExtension #OpenSource

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
