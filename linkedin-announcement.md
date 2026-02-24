# LinkedIn Announcement Post (Option B — Storytelling)

**Every morning I'd open Hacker News, Reddit, and X — and spend 20 minutes scrolling past things I don't care about to find the 3 things I do.**

So I built Sift.

It's a Chrome extension that runs an embedding model (EmbeddingGemma-300M, quantized to 4-bit) directly in your browser. No server, no account, no data collection.

When you load a feed, Sift scores every item against 25 interest categories — AI Research, Startups, Climate, Politics, whatever you've turned on. Items that don't match your interests fade to near-transparent. Items that do stay vivid.

The "aha" moment for me was the training loop. You can:
- Label items with thumbs up/down as you browse
- Curate your labels in a full Label Manager — inline edit text, flip polarity, reassign categories, add labels manually by pasting a URL (it auto-fetches the title and suggests the best category)
- Export those labels as training triplets
- Fine-tune the model on your personal preferences (one click in a free Colab notebook, or locally)
- Load the fine-tuned model back into the extension — with full WebGPU acceleration

After ~50 labels and one training run, the difference is striking. The model stops being generic and starts reflecting *you*.

There's also an inspector (press "?" on any item) that explains scores deterministically — no LLM call, no cost, instant.

And a Taste Profile with an interactive radar chart — a visual map of your interests across all categories. Click any axis to drill into that category's sub-topics. It reveals preferences you didn't even know you had: "You prefer open-source ML frameworks over enterprise SaaS" or "You engage more with climate policy than climate science."

I'm also prototyping an agent mode — press a button, and Sift fetches the top 30 Hacker News stories ranked by your personal taste vector. No scrolling required. Your own relevance-ranked front page, powered by a model that knows what you care about.

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

Label items → fine-tune on free Colab → reload with WebGPU. It learns YOUR taste.

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
2. Curate in the Label Manager — edit, filter, add labels by URL
3. Export → fine-tune on free Colab T4 → reload with WebGPU

~50 labels and one training run — the model starts reflecting YOU.

**Tweet 4 (taste profile + agent mode):**
There's a Taste Profile with an interactive radar chart — a visual map of your interests. Click any axis to drill in.

Plus an experimental agent mode — press a button, get the top 30 HN stories ranked by YOUR taste vector. Your own relevance-ranked front page.

**Tweet 5 (CTA):**
Stack: TypeScript, Chrome MV3, @huggingface Transformers.js, @Google EmbeddingGemma, ONNX quantization, WebGPU

Training pipeline: Python + Colab notebook included

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
5. **Label Manager** — open it, show filters, inline edit a label, add one by URL
6. **Export CSV** — show the triplet format
7. **Run training** — Colab notebook or terminal, show the Taste Check metrics (before→after)
8. **Reload model** — paste custom model URL, show scores improve with WebGPU
9. **Taste Profile** — show the radar chart, click a category to filter, scroll through ranked probes

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
- Open the Taste Profile page cold — the radar chart animates in
- Hover over axes to see per-category stats (score, label counts, last labeled time)
- Click a category axis to filter — the probe bars below update instantly
- Scroll through ranked sub-topic probes with color-coded score bars
- "I didn't know I cared more about distributed systems than frontend frameworks until Sift showed me."

## 6. "Label Manager: Curate Your Training Data" (45–60 seconds)
- Open Label Manager from the popup
- Show the filterable table — filter by category, polarity, source
- Click a label's text to inline edit it
- Click the category pill to reassign to a different category
- Paste a URL into "Add label", watch it auto-fetch the title and suggest a category
- "You're not just labeling — you're curating the dataset that teaches your model what matters to you."

## 7. "Agent Mode: Your Personal HN" (30–45 seconds, good for a teaser clip)
- Open the agent page
- Press "Fetch my stories"
- Watch the top 30 HN stories populate, ranked by taste score
- Each story has a category pill showing why it matched
- "Instead of scrolling through 500 HN posts, I get my top 30 in one click."

## 8. Screen Recording Tips
- Use a clean browser profile with just Sift installed
- Pre-load some labeled data so the Taste Profile is populated
- Record at 1080p or higher, crop to the browser window
- For the training step, speed up the terminal output (2-4x) with a progress bar visible
- Add simple text overlays for each step rather than heavy narration
