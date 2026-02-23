# Taste Profile — Probe-Based Taste Map

## Summary

A popup section that reveals the user's content preferences by scoring curated probe phrases against a centroid computed from their positive training labels. Runs entirely in-browser using the loaded embedding model.

## Naming

**"My Taste Profile"** — familiar, honest, users get it instantly.

## Probe Generation

Each active (non-archived) category contributes 3–5 sub-topic probe phrases, defined in a `TASTE_PROBES` constant in `constants.ts`. Only probes for active categories are used, so the set scales with the user's category selection (~75–125 probes total for 25 categories).

Example:

```typescript
TASTE_PROBES["ai-research"] = [
  "transformer architectures and attention mechanisms",
  "LLM benchmarks and evaluations",
  "AI safety and alignment research",
  "open source machine learning models",
  "neural network training techniques",
];
```

## Computation: Single Centroid

Algorithm (Approach A — centroid-based):

1. Read all positive labels from storage.
2. Embed them in batches of 16 → `Float32Array[]`.
3. Average into a single centroid vector (element-wise mean over pre-normalized embeddings).
4. Gather probes for all active categories.
5. Embed probes in batches of 16.
6. Score each probe: `cosineSimilarity(probeEmb, centroid)`.
7. Sort descending, return top 15.
8. Cache result + timestamp in `chrome.storage.local`.

**Minimum label gate:** 10 positive labels required. Below that, show: "Label at least 10 items to see your taste profile."

**Why single centroid over per-category centroids:** Simpler, reveals cross-category preferences (e.g., "AI applied to climate"), and the probes are specific enough to cut through averaging effects.

## Message Protocol

```typescript
// New message type
MSG.COMPUTE_TASTE_PROFILE = "COMPUTE_TASTE_PROFILE"

// Response payload
interface TasteProbeResult {
  probe: string;       // the probe phrase
  score: number;       // cosine similarity to centroid
  category: string;    // parent category ID
}

interface TasteProfileResponse {
  probes: TasteProbeResult[];  // top 15, sorted desc
  labelCount: number;          // positive labels used
  timestamp: number;           // when computed
}

// Storage key for cached result
STORAGE_KEYS.TASTE_PROFILE = "taste_profile"
```

## Popup UI

New fold section between Categories and Training Data:

```
My Taste Profile
─────────────────────────────────────
LLM benchmarks         ██████████  0.82
AI safety policy       █████████░  0.78
Startup fundraising    ████████░░  0.71
Climate tech           ███████░░░  0.65
Open source tools      ██████░░░░  0.58
Crypto regulation      ███░░░░░░░  0.31
Celebrity gossip       ██░░░░░░░░  0.18

Based on 142 labels            [Refresh]
```

- Bars use `scoreToHue()` for color consistency with feed scoring.
- On popup open: load cached result instantly if available.
- "Refresh" button re-computes from scratch.
- Badge shows stale indicator if label count has changed since last compute.

## Trigger & Caching

- **On-demand only** — user clicks Refresh or opens fold for first time.
- Cached in `chrome.storage.local` under `taste_profile`.
- No auto-recompute on label changes (avoids ~100 embed calls per thumbs-up).
- Stale detection: compare cached `labelCount` to current positive label count.

## Performance Budget

- ~100 probes + ~N positive labels to embed.
- Batched in groups of 16: ~7 batches for probes, ~N/16 for labels.
- At ~50ms per batch: **~1–2 seconds** for 100 probes + 200 labels.
- Centroid computation + scoring: negligible (vector math on pre-normalized embeddings).
- Show "Computing..." spinner during operation.

## Files Touched

- `src/shared/constants.ts` — `TASTE_PROBES`, `MSG.COMPUTE_TASTE_PROFILE`, `STORAGE_KEYS.TASTE_PROFILE`
- `src/shared/types.ts` — `TasteProbeResult`, `TasteProfileResponse`
- `src/background/background.ts` — handler for `COMPUTE_TASTE_PROFILE`
- `public/popup.html` — new fold section
- `public/popup.css` — bar styles
- `src/popup/popup.ts` — fold logic, refresh handler, render bars
