# Side Panel + Embedding Cache + Poison Keywords

**Date:** 2026-02-25
**Status:** Design approved
**Inspired by:** [LinkStreak](https://github.com/KenjiBaheux/LinkStreak) — Kenji Baheux's semantic link search extension

## Overview

Three features shipping together as a single release. The side panel is the largest change (replaces the popup entirely); embedding cache and poison keywords are backend additions with UI in the new side panel.

**Sequence:** Cache → Poison Keywords → Side Panel

## 1. Embedding Cache

**Problem:** Every call to `embed()` hits the model, even for text seen seconds ago. Reddit/X infinite scroll and tab switching re-embed the same titles repeatedly.

**Solution:** A `chrome.storage.local`-backed cache that wraps `embed()`.

### Storage

- Key: `STORAGE_KEYS.EMBEDDING_CACHE`
- Value: `Record<string, EmbeddingCacheEntry>`

```typescript
interface EmbeddingCacheEntry {
  embedding: number[];  // Float32Array serialized as JSON array
  modelId: string;      // model that generated this embedding
  timestamp: number;    // for LRU eviction
}
```

- Cache key per entry: `djb2Hash(EMBED_TASK_PREFIX + normalizedText)`
- Same `djb2Hash` function already used in Sift for taste profile cache keys

### Logic

```
getOrEmbed(texts: string[]) → Float32Array[]
  1. Compute hash for each text (with prefix)
  2. Read EMBEDDING_CACHE from storage, collect hits
  3. Call embed() only for cache misses
  4. Write fresh entries back to cache
  5. If cache size > MAX_CACHE_SIZE (2000), evict oldest by timestamp
  6. Return all embeddings in original order
```

### Invalidation

- Clear entire cache when model changes: `RELOAD_MODEL`, `CUSTOM_MODEL_ID` change, `CUSTOM_MODEL_URL` change
- No TTL — embeddings are deterministic for a given model + text

### Size Budget

- 2000 entries × ~3.1KB each (768 floats as JSON array + metadata) ≈ 6MB
- Well within `unlimitedStorage` permission (already granted)

### Integration Points

- `SCORE_TEXTS` handler → `getOrEmbed()` instead of `embed()`
- `SCORE_PAGE` handler → same
- Agent mode batch embedding → same
- Taste profile computation → skip cache (batch centroid math, different access pattern)

## 2. Poison Keywords

**Problem:** Users want a quick way to block noise ("crypto spam", "hiring", etc.) without collecting negative training labels.

**Solution:** Case-insensitive substring matching applied before embedding, with near-invisible rendering for matched items.

### Storage

- Key: `STORAGE_KEYS.POISON_KEYWORDS`
- Value: `string[]` (lowercase, trimmed, deduped on save)
- Cap: 200 keywords max

### Filtering Logic

Applied in `SCORE_TEXTS` handler, before `getOrEmbed()`:

```
1. Load poison keywords (cached in-memory, refreshed on chrome.storage.onChanged)
2. For each text: if any keyword is a case-insensitive substring → mark filtered
3. Filtered items get score = -1, skip embedding (saves compute)
4. Non-filtered items proceed to getOrEmbed() → rankPresets() as normal
5. Return results with filtered items marked: { filtered: true }
```

### Rendering

- Filtered items: 90%+ opacity reduction + subtle 🚫 indicator
- No vote buttons, no category pills, no explain tooltip
- Item stays in DOM (user can see the filter is working)

### Design Decisions

- **Single tier only** (no soft/hard/mute). Simpler to build and explain. Add tiers later if users ask.
- **Substring match, not regex.** Faster, no escape bugs, good enough for keywords.
- **Before embedding, not after.** Saves compute — don't waste model inference on content the user doesn't want.

## 3. Side Panel

**Problem:** The popup disappears every click. Not enough room for taste profile, categories, and settings. Agent mode lives in a disconnected tab.

**Solution:** Replace the popup with a persistent Chrome side panel. Same features, better canvas.

### Manifest Changes

```json
{
  "side_panel": { "default_path": "side-panel.html" },
  "permissions": [...existing, "sidePanel"]
}
```

- Remove `default_popup` from `action`
- Add `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` in `onInstalled`
- Same pattern as [DistiLlama](https://github.com/shreyaskarnik/DistiLlama)

### Build System

- New IIFE build target in `build.mjs` for `side-panel.ts` + `side-panel.html`
- Same dual-build pattern as existing content scripts
- `popup.html` + `popup.ts` deleted entirely

### Layout (top to bottom)

1. **Model status bar** — model name, WebGPU/WASM badge, loading progress
2. **Page score card** — current tab's score, category pills, thumbs up/down, explain
3. **Categories** — grid of toggles (2-col at 320px, 3-col at 400px+)
4. **Poison keywords** — comma-separated input, save button, active count
5. **Taste profile** — radar chart (scales to container width) + ranked probes
6. **Settings** — model source, sensitivity slider, site toggles, top-K pills
7. **Data** — label count, export CSV, manage labels link

### Agent Mode

- Becomes a view toggle within the side panel (not a separate tab)
- Top-level toggle: "Scoring" view (default) / "Agent" view (HN feed)
- Agent view replaces sections 2-5 with the taste-ranked HN feed

### Chrome Design Guidelines Compliance

Per [Chrome's side panel guidelines](https://developer.chrome.com/blog/extension-side-panel-launch):

- **Companion experience:** Complements browsing (scores feeds while you browse)
- **Single purpose:** Everything serves Sift's core scoring mission
- **Visual consistency:** Matches Sift's existing branding
- **Responsive:** Fluid layout at 320px+ (Chrome's default width, user-resizable)
- **Onboarding:** First-run empty state: "Pick your interests below, then browse HN, Reddit, or X to see scoring in action"

### CSS Constraints

- Fluid layout, no fixed-width elements > 300px
- System font stack: `system-ui, -apple-system, sans-serif`
- `prefers-color-scheme` for light/dark (already in Sift)
- Category grid: CSS Grid with `auto-fill, minmax(140px, 1fr)`
- Radar chart: `max-width: 100%`, scales to container
- Text truncation: `text-overflow: ellipsis` on titles/labels

### Communication

No new message types. Reuses existing patterns:
- `chrome.runtime.sendMessage()` for scoring, labels, categories
- `chrome.runtime.onMessage` for `MODEL_STATUS` broadcasts
- `chrome.storage.onChanged` for reactive state updates

### What Gets Removed

- `popup.html` + `popup.ts` — deleted
- `public/popup.html` — removed from build
- Agent tab link — replaced by in-panel view toggle
- `<details>` fold sections — unnecessary with persistent vertical space

## Cross-Cutting

### Storage Keys Added

| Key | Type | Default |
|-----|------|---------|
| `EMBEDDING_CACHE` | `Record<string, EmbeddingCacheEntry>` | `{}` |
| `POISON_KEYWORDS` | `string[]` | `[]` |

### Types Added

```typescript
interface EmbeddingCacheEntry {
  embedding: number[];
  modelId: string;
  timestamp: number;
}
```

### No Migration Needed

- New storage keys with sensible defaults (empty cache, no keywords)
- Side panel is a new UI surface — no state migration from popup
- Existing storage keys unchanged
