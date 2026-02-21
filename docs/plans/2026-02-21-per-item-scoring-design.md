# Per-Item Best-Category Scoring

## Problem

Clicking a detected lens pill (e.g., "Startups") in the popup or feed inspector
switches the **global** scoring lens, re-scoring the entire feed. The user's
intent is often to label that specific item under Startups, not to change their
whole feed view. The global lens and per-item labeling are coupled through
`UPDATE_ANCHOR`, causing unintended side effects.

## Solution

Score each item against **all preset anchors** and use the best match as that
item's score. Pills become item-level label overrides, not global lens switches.
Labels auto-assign to the detected category. Fine-tuning teaches the model
what "good" means within each category.

## Core Primitive: `rankPresets(textEmb)`

One function returns all preset similarities sorted descending:

```typescript
interface PresetRank {
  anchor: string;
  score: number;
}

interface PresetRanking {
  ranks: PresetRank[];     // all presets, sorted by score desc
  top: PresetRank;         // ranks[0] — scoring winner
  confidence: number;      // top1.score - top2.score
  ambiguous: boolean;      // confidence < 0.05
}

function rankPresets(textEmb: Float32Array): PresetRanking
```

All downstream consumers derive from this single source:

| Consumer | Derivation |
|----------|-----------|
| Dimming score | `ranking.top.score` |
| Display pills | `ranking.ranks.slice(0, 2)` filtered by min threshold |
| Label auto-anchor | `ranking.top.anchor` |
| Confidence gating | `ranking.confidence`, `ranking.ambiguous` |
| Explanation text | Uses `ranking.top.anchor` as framing anchor |

This avoids drift between the scoring path and the display path.

## Scoring Path Changes

### `scorePageTitle()` (popup page score)

```
Current:  score = cos_sim(item, globalAnchorEmbedding)
New:      embed(text) -> ranking = rankPresets(emb) -> score = ranking.top.score
```

Cache entry gains `ranking: PresetRanking` (replaces `detectedAnchors?: string[]`).

### `SCORE_TEXTS` handler (feed batch scoring)

```
Current:  per-item cos_sim against global anchor + separate detectAnchors call
New:      per-item rankPresets(emb) -> score from ranking.top + pills from ranking.ranks
```

Single computation path for both scoring and detection.

### `EXPLAIN_SCORE` handler

Uses `ranking.top.anchor` as the framing anchor for explanation text.
Currently uses `currentAnchor` which would mismatch if the user hasn't
explicitly pinned a lens.

## Pill Click -> Label Override

### Current flow (broken)

```
Pill click -> UPDATE_ANCHOR -> global re-score of entire feed
```

### New flow

```
Pill click -> set item-level anchorOverride in widget state
           -> visual: clicked pill gets .active highlight
           -> on thumbs up/down: anchorOverride passed in SAVE_LABEL payload
```

No `UPDATE_ANCHOR` sent. No global re-score. No `onAnchorChange` fires.

**Popup pills:** Store `anchorOverride` in popup component state. Pass to
`SAVE_LABEL` when the user votes on the page score card.

**Feed inspector pills:** Store override on the widget instance. Pass through
label-buttons when the user votes on that specific feed item.

## SAVE_LABEL Changes

### New label payload from content/popup

```typescript
interface SaveLabelPayload {
  label: TrainingLabel;
  anchorOverride?: string;           // user clicked a pill
  presetRanking?: PresetRanking;     // from scoring pass (avoids re-embed)
}
```

### Background stamping logic

```typescript
// Anchor resolution priority:
// 1. User's explicit override (pill click)
// 2. Pre-computed top1 from scoring pass
// 3. Fresh detection (fallback if no ranking available)
// 4. Default constant

const stamped: TrainingLabel = {
  ...label,
  anchor: anchorOverride ?? presetRanking?.top.anchor ?? (await detectTop1(text)) ?? DEFAULT,
  autoAnchor: presetRanking?.top.anchor ?? null,
  autoConfidence: presetRanking?.confidence ?? null,
  anchorSource: anchorOverride ? "override" : presetRanking ? "auto" : "fallback",
};
```

### Extended label metadata

```typescript
interface TrainingLabel {
  text: string;
  label: "positive" | "negative";
  source: "hn" | "reddit" | "x" | "x-import" | "web";
  timestamp: number;
  anchor: string;                    // resolved anchor (override > auto > fallback)
  autoAnchor?: string;               // what the model predicted (even if overridden)
  autoConfidence?: number;           // top1 - top2 gap
  anchorSource?: "auto" | "override" | "fallback";
  detectedAnchors?: string[];        // kept for backward compat with existing labels
}
```

This metadata enables downstream filtering: training pipeline can downweight
low-confidence labels, compare override rate vs auto, etc.

### Avoid re-embedding on vote

When an item was already scored (feed items, page score), the `PresetRanking`
is available. Pass it through `SAVE_LABEL` so background can stamp without
another `embed()` call. Only fall back to fresh detection when ranking is
unavailable (e.g., X archive imports).

## Explanation Framing

The `?` inspector explanation must use `ranking.top.anchor` (the winning preset
for that item), not `currentAnchor`. Otherwise users see "scored as Startups"
but explanation text framed as News.

## UI: Focus Lens

The popup lens dropdown stays but is renamed to **Focus Lens** to signal it's
secondary/optional. Default state: no focus lens (multi-preset scoring).
When a focus lens is pinned, scoring reverts to single-anchor mode for that
lens only.

Focus mode is **deferred** from this implementation. The dropdown remains
functional but the label is updated now to set expectations.

## Threshold Recalibration

`max()` across presets inflates scores vs single-anchor. Current dim bands will
feel too lenient. Strategy:

1. Ship with current thresholds + existing sensitivity slider
2. Monitor score distribution empirically
3. Re-tune in a follow-up

No threshold changes in v1.

## What Stays, What Goes, What's Deferred

| Component | Status |
|-----------|--------|
| `rankPresets()` | **New** -- single scoring+detection primitive |
| `detectAnchorsDetailedFromEmbedding()` | **Removed** -- subsumed by rankPresets |
| `detectAnchorsFromEmbedding()` | **Removed** -- subsumed by rankPresets |
| Global `currentAnchor` state | **Stays** -- future Focus mode |
| `UPDATE_ANCHOR` message | **Stays** -- popup dropdown uses it |
| Popup lens dropdown | **Renamed** to "Focus Lens", stays functional |
| Pill -> `applyAnchor()` / `UPDATE_ANCHOR` | **Removed** -- pills become label-only |
| `onAnchorChange()` callbacks | **Stays** -- needed when dropdown changes |
| `PageScoreCacheEntry` | **Modified** -- stores PresetRanking |
| `ScoredItem` type | **Modified** -- carries PresetRanking |
| CSV export `resolveAnchorsForLabel` | **Updated** -- uses new anchor/anchorSource fields |
| `EXPLAIN_SCORE` handler | **Updated** -- uses ranking.top.anchor |
| `TrainingLabel` type | **Extended** -- autoAnchor, autoConfidence, anchorSource |

## Files Affected

### Background (`src/background/background.ts`)
- Add `rankPresets()`, remove `detectAnchorsDetailedFromEmbedding` / `detectAnchorsFromEmbedding` / `detectAnchors`
- Rewrite `scorePageTitle()` to use `rankPresets()`
- Rewrite `SCORE_TEXTS` handler to use `rankPresets()`
- Update `EXPLAIN_SCORE` to use ranking anchor
- Update `SAVE_LABEL` to accept `anchorOverride` + `presetRanking`, stamp extended metadata
- Update `PageScoreCacheEntry` to store `PresetRanking`

### Types (`src/shared/types.ts`)
- Add `PresetRank`, `PresetRanking` types
- Extend `TrainingLabel` with `autoAnchor`, `autoConfidence`, `anchorSource`
- Update `PageScoreResponse` to carry `PresetRanking` instead of `detectedAnchors?: string[]`
- Update `SaveLabelPayload` with `anchorOverride?`, `presetRanking?`
- Update `ScoredItem` to carry `PresetRanking`
- Update `ScoreResultsPayload` to carry rankings

### Popup (`src/popup/popup.ts`, `public/popup.html`, `public/popup.css`)
- Pills read from `PresetRanking.ranks` instead of `detectedAnchors`
- Pill click sets `anchorOverride` state, not `applyAnchor()`
- Rename lens dropdown label to "Focus Lens"
- Pass `anchorOverride` + ranking through SAVE_LABEL on vote

### Content scripts (`src/content/common/widget.ts`, `label-buttons.ts`, `batch-scorer.ts`)
- `applyScore()` receives `PresetRanking` instead of `DetectedAnchor[]`
- Inspector pills set item-level override, not `UPDATE_ANCHOR`
- Label buttons receive and forward `anchorOverride` + `presetRanking`
- `batch-scorer.ts` unpacks `PresetRanking` from response

### Content scripts per-site (`hn-content.ts`, `reddit-content.ts`, `x-content.ts`)
- Destructure `PresetRanking` from `ScoredItem` (replaces `detectedAnchors`)

### Styles (`src/content/common/styles.ts`, `public/popup.css`)
- No structural changes; pill styles already exist

### CSV export (`src/storage/csv-export.ts`)
- `resolveAnchorsForLabel` updated for new `anchorSource` / `autoAnchor` fields
- Backward compat: existing labels with `detectedAnchors` still work
