# Taste Profile — Probe-Based Taste Map

## Summary

A popup section that reveals the user's content preferences by scoring curated probe phrases against a contrastive centroid computed from the user's training labels. Runs entirely in-browser using the loaded embedding model.

## Naming

**"My Taste Profile"** — familiar, honest, users get it instantly.

## Probe Generation

Each active (non-archived) category contributes 3–5 sub-topic probe phrases, defined in a `TASTE_PROBES` constant in `taste-probes.ts`. Only probes for active categories are used, so the set scales with the user's category selection (~75–125 probes total for 25 categories).

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

## Computation: Contrastive Centroid

Algorithm:

1. Read all labels from storage. Dedupe by normalized text (lowercase + whitespace collapse) before embedding.
2. Embed deduplicated positive labels in batches of 16 → `Float32Array[]`.
3. L2-normalize each embedding explicitly (do not assume pre-normalization).
4. Compute `posCentroid` (element-wise mean of positive embeddings).
5. If negative labels exist (>= 3), compute `negCentroid` the same way, then: `tasteVec = posCentroid - α * negCentroid` (α = 0.3). This pushes the taste vector away from disliked content.
6. L2-normalize the final `tasteVec`.
7. Gather probes for all active categories. Embed and L2-normalize them.
8. Score each probe: `dot(probeEmb, tasteVec)`.
9. Apply diversity cap: max 3 probes per category in the final top-K.
10. Return top 15 (after diversity filtering).
11. Cache result with composite cache key in `chrome.storage.local`.

**Minimum label gate:** 10 positive labels required. Below that, return `state: "insufficient_labels"`.

**Why contrastive centroid:** Pure positive centroid drifts toward noise (thumbs-up on borderline items). Subtracting a scaled negative centroid sharpens the taste vector toward content the user genuinely prefers over what they reject.

**Why diversity cap:** Without it, top-15 can collapse into one dominant category (e.g., 12/15 probes from "ai-research"). Cap of 3 per category ensures the profile is a useful cross-category map.

## Message Protocol

```typescript
// New message type
MSG.COMPUTE_TASTE_PROFILE = "COMPUTE_TASTE_PROFILE"

// Response payload
interface TasteProbeResult {
  probe: string;       // the probe phrase
  score: number;       // cosine similarity to taste vector
  category: string;    // parent category ID
}

interface TasteProfileResponse {
  state: "ready" | "loading" | "insufficient_labels" | "error";
  message?: string;    // human-readable status (error text, "need N more labels", etc.)
  probes: TasteProbeResult[];  // top 15 (diversity-capped), sorted desc
  labelCount: number;          // positive labels used
  timestamp: number;           // when computed
  cacheKey?: string;           // composite key for staleness detection
}

// Storage key for cached result
STORAGE_KEYS.TASTE_PROFILE = "taste_profile"
```

## Cache Invalidation

Cached profile is stale when any input changes. Composite cache key:

```
cacheKey = hash(sortedPositiveTexts + sortedNegativeTexts + activeCategoryIds + modelId + PROBES_VERSION)
```

Components:
- **Sorted label texts** — detects added/removed/changed labels (not just count)
- **Active category IDs** — different active set → different probe set
- **Model ID** — custom model or default; different embeddings
- **PROBES_VERSION** — bumped when probe phrases change in code

Hash: simple FNV-1a or djb2 over the concatenated string. No crypto needed — just collision-resistant enough for cache busting.

Popup compares `cached.cacheKey` to a locally-computed key. Mismatch → badge shows "stale".

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
- Badge shows "stale" if `cacheKey` mismatch detected.
- Error/insufficient states show appropriate messages in the fold.

## Trigger & Caching

- **On-demand only** — user clicks Refresh or opens fold for first time.
- Cached in `chrome.storage.local` under `taste_profile`.
- No auto-recompute on label changes (avoids ~100 embed calls per thumbs-up).
- Stale detection: compare cached `cacheKey` to freshly-computed composite key.

## Performance Budget

- ~100 probes + ~N positive labels + ~M negative labels to embed.
- Batched in groups of 16: ~7 batches for probes, ~(N+M)/16 for labels.
- At ~50ms per batch: **~1–2 seconds** for 100 probes + 200 labels.
- L2-normalization and centroid computation: negligible (vector math).
- Show "Computing..." spinner during operation.

## Files Touched

- `src/shared/constants.ts` — `MSG.COMPUTE_TASTE_PROFILE`, `STORAGE_KEYS.TASTE_PROFILE`, `TASTE_MIN_LABELS`, `TASTE_TOP_K`
- `src/shared/taste-probes.ts` — `TASTE_PROBES` map + `PROBES_VERSION`
- `src/shared/types.ts` — `TasteProbeResult`, `TasteProfileResponse`
- `src/background/background.ts` — `computeTasteProfile()`, `COMPUTE_TASTE_PROFILE` handler
- `public/popup.html` — new fold section
- `public/popup.css` — bar styles
- `src/popup/popup.ts` — fold logic, cache key computation, refresh handler, render bars
