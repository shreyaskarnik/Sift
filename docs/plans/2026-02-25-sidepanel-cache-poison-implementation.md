# Side Panel + Embedding Cache + Poison Keywords — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the popup with a persistent Chrome side panel, add an embedding cache to avoid re-computing embeddings, and add poison keyword filtering to hide unwanted content.

**Architecture:** Three independent backend changes (cache in `embed()`, poison in `SCORE_TEXTS` handler, side panel as new UI surface). Built in sequence: Cache → Poison → Side Panel. The side panel replaces `popup.html` entirely using `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.

**Tech Stack:** TypeScript, Chrome MV3 APIs (`chrome.sidePanel`, `chrome.storage.local`), Vite dual-build (ES module + IIFE), Transformers.js v4.

**Design doc:** `docs/plans/2026-02-25-sidepanel-cache-poison-design.md`

---

## Task 1: Embedding Cache — Types and Constants

**Files:**
- Modify: `chrome-extension/src/shared/types.ts` (add after line 213)
- Modify: `chrome-extension/src/shared/constants.ts` (add to STORAGE_KEYS at line 138, add constant after line 151)

**Step 1: Add EmbeddingCacheEntry type**

In `src/shared/types.ts`, add after the last interface:

```typescript
/** A cached embedding entry in chrome.storage.local */
export interface EmbeddingCacheEntry {
  /** Float32Array serialized as number[] for JSON storage */
  embedding: number[];
  /** Model ID that generated this embedding (cache invalidation key) */
  modelId: string;
  /** Unix timestamp for LRU eviction */
  timestamp: number;
}
```

**Step 2: Add storage key and cache size constant**

In `src/shared/constants.ts`, add `EMBEDDING_CACHE` to `STORAGE_KEYS` (after `TASTE_PROFILE` on line 138):

```typescript
  EMBEDDING_CACHE: "embedding_cache",
```

Add after `SCORE_BATCH_SIZE` (line 151):

```typescript
/** Maximum number of cached embeddings in chrome.storage.local */
export const EMBEDDING_CACHE_MAX = 2000;
```

**Step 3: Run typecheck**

Run: `cd chrome-extension && npm run typecheck`
Expected: PASS (no consumers yet)

**Step 4: Commit**

```bash
git add chrome-extension/src/shared/types.ts chrome-extension/src/shared/constants.ts
git commit -m "feat: add embedding cache types and constants"
```

---

## Task 2: Embedding Cache — Background Implementation

**Files:**
- Modify: `chrome-extension/src/background/background.ts`

**Step 1: Add cache state and helpers**

After the existing state variables (line 106), add:

```typescript
// ---------------------------------------------------------------------------
// Embedding cache (chrome.storage.local)
// ---------------------------------------------------------------------------

import type { EmbeddingCacheEntry } from "../shared/types";
import { EMBEDDING_CACHE_MAX } from "../shared/constants";

/** In-memory mirror of the embedding cache. Loaded lazily on first use. */
let embeddingCache: Record<string, EmbeddingCacheEntry> | null = null;
/** Resolved model ID for cache key validation */
let currentModelIdForCache = "";

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function loadEmbeddingCache(): Promise<Record<string, EmbeddingCacheEntry>> {
  if (embeddingCache !== null) return embeddingCache;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.EMBEDDING_CACHE);
  embeddingCache = (stored[STORAGE_KEYS.EMBEDDING_CACHE] as Record<string, EmbeddingCacheEntry>) ?? {};
  return embeddingCache;
}

async function flushEmbeddingCache(): Promise<void> {
  if (!embeddingCache) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.EMBEDDING_CACHE]: embeddingCache });
}

function evictOldestEntries(cache: Record<string, EmbeddingCacheEntry>, max: number): void {
  const keys = Object.keys(cache);
  if (keys.length <= max) return;
  const sorted = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
  const toRemove = sorted.slice(0, keys.length - max);
  for (const k of toRemove) delete cache[k];
}

async function clearEmbeddingCache(): Promise<void> {
  embeddingCache = {};
  await chrome.storage.local.remove(STORAGE_KEYS.EMBEDDING_CACHE);
}
```

**Note:** `djb2` already exists elsewhere in the codebase (taste profile). If it's already importable, use the existing one. If it's inline in background.ts, reuse that. Check before duplicating.

**Step 2: Add `getOrEmbed()` wrapper**

Add after the existing `embed()` function (after line 358):

```typescript
/**
 * Cache-aware embedding: returns cached embeddings for known texts,
 * calls embed() only for cache misses, then persists new entries.
 */
async function getOrEmbed(texts: string[]): Promise<Float32Array[]> {
  const cache = await loadEmbeddingCache();
  const results: (Float32Array | null)[] = new Array(texts.length).fill(null);
  const missIndices: number[] = [];
  const missTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const key = djb2(EMBED_TASK_PREFIX + texts[i]);
    const entry = cache[key];
    if (entry && entry.modelId === currentModelIdForCache) {
      results[i] = new Float32Array(entry.embedding);
      entry.timestamp = Date.now(); // touch for LRU
    } else {
      missIndices.push(i);
      missTexts.push(texts[i]);
    }
  }

  if (missTexts.length > 0) {
    const fresh = await embed(missTexts);
    const now = Date.now();
    for (let j = 0; j < missIndices.length; j++) {
      const idx = missIndices[j];
      results[idx] = fresh[j];
      const key = djb2(EMBED_TASK_PREFIX + missTexts[j]);
      cache[key] = {
        embedding: Array.from(fresh[j]),
        modelId: currentModelIdForCache,
        timestamp: now,
      };
    }
    evictOldestEntries(cache, EMBEDDING_CACHE_MAX);
    flushEmbeddingCache(); // fire-and-forget write
  }

  return results as Float32Array[];
}
```

**Step 3: Set `currentModelIdForCache` during model load**

In `loadEmbeddingModel()`, after the model is loaded successfully (around line 242 where it calls `embedActiveCategories()`), add:

```typescript
currentModelIdForCache = resolvedModelId; // the display model ID already computed
```

Use whatever variable holds the resolved model ID string that gets broadcast in `ModelStatus.modelId`.

**Step 4: Clear cache on model reload**

In the `MSG.RELOAD_MODEL` handler (line 998-1017), add `clearEmbeddingCache();` after `presetEmbeddings.clear();` (line 1004):

```typescript
presetEmbeddings.clear();
clearEmbeddingCache();
```

Also listen for model source changes in storage. Add a `chrome.storage.onChanged` listener (or extend the existing one) that clears the cache when `CUSTOM_MODEL_ID` or `CUSTOM_MODEL_URL` changes.

**Step 5: Replace `embed()` calls with `getOrEmbed()` in scoring handlers**

In `MSG.SCORE_TEXTS` handler (line 1029), change:

```typescript
// Before:
embed(p.texts)
// After:
getOrEmbed(p.texts)
```

Do the same for:
- `MSG.GET_PAGE_SCORE` handler (find where it calls `embed()` for page title scoring)
- Agent mode handler `MSG.AGENT_FETCH_HN` (find where it batch-embeds HN titles)

**Do NOT** replace `embed()` calls in `embedActiveCategories()` — those are category anchor embeddings, not content embeddings.

**Step 6: Run typecheck and build**

Run: `cd chrome-extension && npm run typecheck && npm run build`
Expected: PASS

**Step 7: Manual test**

1. Load extension in Chrome
2. Open HN — items score normally
3. Navigate away and back — second load should be faster (cache hits)
4. Change model source in settings → cache should clear

**Step 8: Commit**

```bash
git add chrome-extension/src/background/background.ts
git commit -m "feat: add embedding cache to avoid re-embedding scored items"
```

---

## Task 3: Poison Keywords — Types and Constants

**Files:**
- Modify: `chrome-extension/src/shared/constants.ts` (add to STORAGE_KEYS)
- Modify: `chrome-extension/src/shared/types.ts` (add filtered flag)

**Step 1: Add storage key and limit constant**

In `src/shared/constants.ts`, add to `STORAGE_KEYS`:

```typescript
  POISON_KEYWORDS: "poison_keywords",
```

Add after `EMBEDDING_CACHE_MAX`:

```typescript
/** Maximum number of poison keywords */
export const POISON_KEYWORDS_MAX = 200;
```

**Step 2: Extend VibeResult with filtered flag**

In `src/shared/types.ts`, add to `VibeResult` (after line 7):

```typescript
  /** True if item matched a poison keyword and was filtered */
  filtered?: boolean;
```

**Step 3: Run typecheck**

Run: `cd chrome-extension && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add chrome-extension/src/shared/types.ts chrome-extension/src/shared/constants.ts
git commit -m "feat: add poison keyword types and constants"
```

---

## Task 4: Poison Keywords — Background Filtering

**Files:**
- Modify: `chrome-extension/src/background/background.ts`

**Step 1: Add poison keyword state**

After the embedding cache state variables, add:

```typescript
// ---------------------------------------------------------------------------
// Poison keywords
// ---------------------------------------------------------------------------

let poisonKeywords: string[] = [];

async function loadPoisonKeywords(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.POISON_KEYWORDS);
  poisonKeywords = (stored[STORAGE_KEYS.POISON_KEYWORDS] as string[]) ?? [];
}

function textMatchesPoisonKeyword(text: string): boolean {
  if (poisonKeywords.length === 0) return false;
  const lower = text.toLowerCase();
  return poisonKeywords.some((kw) => lower.includes(kw));
}
```

**Step 2: Load poison keywords on startup**

Call `loadPoisonKeywords()` at module scope (near line 977 where `loadModels()` is called):

```typescript
loadPoisonKeywords();
```

**Step 3: Refresh on storage change**

Add to the existing `chrome.storage.onChanged` listener (or create one):

```typescript
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEYS.POISON_KEYWORDS]) {
    loadPoisonKeywords();
  }
});
```

**Step 4: Filter in SCORE_TEXTS handler**

In the `MSG.SCORE_TEXTS` handler (line 1019-1041), add poison filtering before embedding. Replace the handler body:

```typescript
case MSG.SCORE_TEXTS: {
  const p = payload as ScoreTextsPayload;
  if (!p?.texts?.length) {
    sendResponse({ results: [] });
    return;
  }
  if (!modelReady || !anchorReady) {
    sendResponse({ error: "Model not ready" });
    return;
  }

  // Partition: filtered (poison) vs clean
  const cleanIndices: number[] = [];
  const cleanTexts: string[] = [];
  const allResults: VibeResult[] = new Array(p.texts.length);
  const allRankings: (PresetRanking | undefined)[] = new Array(p.texts.length);

  for (let i = 0; i < p.texts.length; i++) {
    if (textMatchesPoisonKeyword(p.texts[i])) {
      allResults[i] = {
        text: p.texts[i],
        rawScore: -1,
        status: "FILTERED",
        emoji: "🚫",
        colorHSL: "hsl(0, 0%, 40%)",
        filtered: true,
      };
      allRankings[i] = undefined;
    } else {
      cleanIndices.push(i);
      cleanTexts.push(p.texts[i]);
    }
  }

  if (cleanTexts.length === 0) {
    sendResponse({ results: allResults, rankings: allRankings });
    return;
  }

  getOrEmbed(cleanTexts)
    .then((embeddings) => {
      for (let j = 0; j < cleanIndices.length; j++) {
        const idx = cleanIndices[j];
        const ranking = rankPresets(embeddings[j]);
        const score = ranking ? ranking.top.score : cosineSimilarity(anchorEmbedding!, embeddings[j]);
        allResults[idx] = mapScoreToVibe(cleanTexts[j], score);
        allRankings[idx] = ranking;
      }
      sendResponse({ results: allResults, rankings: allRankings });
    })
    .catch((err) => sendResponse({ error: String(err) }));
  return true;
}
```

**Step 5: Run typecheck and build**

Run: `cd chrome-extension && npm run typecheck && npm run build`
Expected: PASS

**Step 6: Commit**

```bash
git add chrome-extension/src/background/background.ts
git commit -m "feat: add poison keyword filtering in SCORE_TEXTS handler"
```

---

## Task 5: Poison Keywords — Content Script Rendering

**Files:**
- Modify: `chrome-extension/src/content/common/widget.ts`

**Step 1: Handle filtered items in `applyScore()`**

In `applyScore()` (line 276), add a guard at the top of the function body (after `injectStyles();` on line 283):

```typescript
  // Poison-filtered items: near-invisible + no controls
  if (result.filtered) {
    el.style.setProperty("--ss-opacity", "0.08");
    el.style.setProperty("--ss-sat", "0");
    el.dataset.siftScore = "-1";
    el.dataset.siftFiltered = "true";
    if (!el.classList.contains("ss-scored")) {
      el.classList.add("ss-scored");
    }
    return; // no chip, no buttons, no explain
  }
```

**Step 2: Run typecheck and build**

Run: `cd chrome-extension && npm run typecheck && npm run build`
Expected: PASS

**Step 3: Manual test**

1. Add "crypto" as a poison keyword (manually in storage for now — UI comes with side panel)
2. Open HN — items mentioning "crypto" should be nearly invisible
3. Other items score normally

**Step 4: Commit**

```bash
git add chrome-extension/src/content/common/widget.ts
git commit -m "feat: render poison-filtered items as near-invisible in feeds"
```

---

## Task 6: Side Panel — Manifest and Build System

**Files:**
- Modify: `chrome-extension/public/manifest.json`
- Modify: `chrome-extension/build.mjs`
- Create: `chrome-extension/public/side-panel.html`
- Create: `chrome-extension/src/side-panel/side-panel.ts` (stub)

**Step 1: Update manifest**

In `public/manifest.json`:

1. Add `"sidePanel"` to permissions (line 6):
```json
"permissions": ["activeTab", "tabs", "storage", "unlimitedStorage", "sidePanel"],
```

2. Remove `"default_popup": "popup.html"` from the `action` block (line 9). The `action` block should keep only icons:
```json
"action": {
  "default_icon": {
    "16": "icons/icon16-dark.png",
    "48": "icons/icon48-dark.png",
    "128": "icons/icon128-dark.png"
  }
},
```

3. Add side panel config (after `action`):
```json
"side_panel": {
  "default_path": "side-panel.html"
},
```

**Step 2: Create stub side panel HTML**

Create `public/side-panel.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sift</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      min-width: 320px;
      color: #1a1a1a;
      background: #fff;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e0e0e0; background: #1a1a1a; }
    }
    .sp-loading { padding: 24px; text-align: center; color: #888; }
  </style>
</head>
<body>
  <div class="sp-loading">Loading Sift...</div>
  <script src="side-panel.js"></script>
</body>
</html>
```

**Step 3: Create stub side panel TypeScript**

Create `src/side-panel/side-panel.ts`:

```typescript
import { MSG, STORAGE_KEYS } from "@shared/constants";
import type { ModelStatus } from "@shared/types";

console.log("Sift side panel loaded");

// Stub — will be fleshed out in Task 7
document.querySelector(".sp-loading")!.textContent = "Sift side panel ready.";
```

**Step 4: Add to build.mjs**

In `build.mjs`, add to `iifeEntries` array (line 17-25):

```javascript
  { name: "side-panel", entry: resolve(__dirname, "src/side-panel/side-panel.ts") },
```

**Step 5: Add `openPanelOnActionClick` to background**

In `src/background/background.ts`, add near the top-level initialization code (near line 977):

```typescript
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
```

**Step 6: Build and test**

Run: `cd chrome-extension && npm run build`
Expected: PASS. `dist/` should contain `side-panel.html` and `side-panel.js`.

Manual test:
1. Reload extension in Chrome
2. Click extension icon → side panel opens (not popup)
3. Shows "Sift side panel ready."

**Step 7: Commit**

```bash
git add chrome-extension/public/manifest.json chrome-extension/build.mjs \
  chrome-extension/public/side-panel.html chrome-extension/src/side-panel/side-panel.ts \
  chrome-extension/src/background/background.ts
git commit -m "feat: add side panel scaffold, replace popup with sidePanel API"
```

---

## Task 7: Side Panel — Full UI Implementation

This is the largest task. Port all popup functionality into the side panel with a responsive layout.

**Files:**
- Modify: `chrome-extension/public/side-panel.html` (full layout)
- Modify: `chrome-extension/src/side-panel/side-panel.ts` (full implementation)
- Reference: `chrome-extension/src/popup/popup.ts` (port logic from here)
- Reference: `chrome-extension/public/popup.html` (port structure from here)

**Step 1: Build the HTML layout**

Replace the stub `side-panel.html` with the full layout. Sections top-to-bottom:

1. **Header** — Sift logo + model status pill (dot + label)
2. **Model loading bar** — progress bar, hidden when ready
3. **Page score card** — current tab title, score, category pills, thumbs up/down, explain button
4. **View toggle** — "Scoring" / "Agent" tabs (default: Scoring)
5. **Categories section** — header + responsive grid of toggle buttons (2-col at 320px, 3-col at 400px+). Include top-K pill selector.
6. **Poison keywords section** — header + comma-separated textarea + save button + count badge
7. **Taste profile section** — header + radar chart canvas + ranked probes list
8. **Settings section** — sensitivity slider + site toggles (HN/Reddit/X) + model source input + page scoring toggle
9. **Data section** — label counts (pos/neg per category) + export CSV button + manage labels link + clear button

CSS approach:
- Use CSS custom properties for light/dark theming via `prefers-color-scheme`
- System font stack: `system-ui, -apple-system, sans-serif`
- Category grid: `display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px;`
- All sections have `padding: 12px 16px` with `border-bottom: 1px solid var(--border)`
- Scrollable body, fixed header (optional — test both)

**Step 2: Port popup.ts logic**

The side panel TypeScript should follow the same patterns as `popup.ts`:

1. Query DOM elements on load
2. Read initial state from `chrome.storage.local`
3. Listen on `chrome.storage.onChanged` for reactive updates
4. Listen on `chrome.runtime.onMessage` for `MODEL_STATUS` broadcasts
5. Send messages via `chrome.runtime.sendMessage()` for scoring, labels, etc.
6. Listen on `chrome.tabs.onActivated` and `chrome.tabs.onUpdated` to refresh page score when tab changes (popup didn't need this because it re-opens fresh each time)

Key logic to port from popup.ts:
- Model status display (dot color, label text, progress bar)
- Page score card (score, pills, vote buttons, explain)
- Category grid toggles (read/write `ACTIVE_CATEGORY_IDS`, send `CATEGORIES_CHANGED`)
- Sensitivity slider (read/write `SENSITIVITY`)
- Site toggles (read/write `SITE_ENABLED`)
- Model source input (read/write `CUSTOM_MODEL_ID` / `CUSTOM_MODEL_URL`)
- Taste profile (trigger `COMPUTE_TASTE_PROFILE`, render radar chart + probes)
- Label counts + export CSV + clear labels
- Toast notifications

New logic (not in popup):
- **Poison keywords UI**: Read `POISON_KEYWORDS` from storage, display in textarea, save on button click (lowercase, trim, split by comma, dedup, cap at 200)
- **Tab change listener**: `chrome.tabs.onActivated` → re-request page score
- **Agent view toggle**: When "Agent" tab selected, show agent feed; when "Scoring", show normal sections

**Step 3: Port taste profile rendering**

The radar chart and probe list code currently lives in `src/taste/taste.ts` (which renders in a full-page view). Extract the rendering functions or duplicate them in the side panel, sized for the narrower width.

**Step 4: Port agent mode**

Port the agent feed rendering from `src/agent/agent.ts` into the side panel's "Agent" view. Same layout: story list with rank + title + domain + category pill + taste score. Triggered by a "Fetch" button.

**Step 5: Run typecheck and build**

Run: `cd chrome-extension && npm run typecheck && npm run build`
Expected: PASS

**Step 6: Manual test**

1. Reload extension
2. Click icon → side panel opens
3. Verify: model loads, status shows, categories toggleable
4. Browse HN → page score updates in side panel
5. Switch tabs → page score refreshes
6. Add poison keywords → save → verify items filtered on next HN load
7. Check taste profile renders
8. Toggle to Agent view → fetch HN feed
9. Test at 320px width (resize side panel narrow)
10. Test light and dark mode

**Step 7: Commit**

```bash
git add chrome-extension/public/side-panel.html chrome-extension/src/side-panel/side-panel.ts
git commit -m "feat: implement full side panel UI replacing popup"
```

---

## Task 8: Remove Popup

**Files:**
- Delete: `chrome-extension/src/popup/popup.ts`
- Delete: `chrome-extension/public/popup.html`
- Modify: `chrome-extension/build.mjs` (remove popup entry)

**Step 1: Remove popup IIFE build entry**

In `build.mjs`, remove the line:
```javascript
  { name: "popup", entry: resolve(__dirname, "src/popup/popup.ts") },
```

**Step 2: Delete popup files**

```bash
rm chrome-extension/src/popup/popup.ts chrome-extension/public/popup.html
```

**Step 3: Check for any remaining references to popup**

Search for "popup" in the codebase — remove any dead references (e.g., in comments). Agent.html may link back to popup; remove that link.

**Step 4: Build and verify**

Run: `cd chrome-extension && npm run build`
Expected: PASS. `dist/` should NOT contain `popup.html` or `popup.js`.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove popup (replaced by side panel)"
```

---

## Task 9: First-Run Onboarding State

**Files:**
- Modify: `chrome-extension/src/side-panel/side-panel.ts`

**Step 1: Detect first run**

Check if `ACTIVE_CATEGORY_IDS` has been customized (or if no labels exist). If the user hasn't changed anything from defaults, show an onboarding hint at the top of the page score card:

```
"Pick your interests below, then browse HN, Reddit, or X to see scoring in action."
```

**Step 2: Dismiss on first category toggle**

When the user toggles any category, hide the onboarding hint permanently (set a `onboarding_dismissed` flag in storage).

**Step 3: Build and test**

Run: `cd chrome-extension && npm run build`
Manual test: Install fresh (clear extension data) → side panel shows onboarding message → toggle a category → message disappears.

**Step 4: Commit**

```bash
git add chrome-extension/src/side-panel/side-panel.ts
git commit -m "feat: add first-run onboarding hint in side panel"
```

---

## Task 10: Final Integration Test and Cleanup

**Files:**
- Modify: `chrome-extension/public/manifest.json` (bump version)

**Step 1: Bump version**

In `manifest.json`, bump `"version"` from `"0.1.0"` to `"0.2.0"`.

**Step 2: Full build**

Run: `cd chrome-extension && npm run typecheck && npm run build`
Expected: PASS

**Step 3: Full manual test checklist**

- [ ] Extension icon → side panel opens (not popup)
- [ ] Model loads, WebGPU/WASM badge shows
- [ ] HN: items scored, pills visible, dimming works
- [ ] Reddit: items scored with MutationObserver (infinite scroll)
- [ ] X: items scored with MutationObserver
- [ ] Page score card updates on tab switch
- [ ] Category toggles work, feed re-scores on change
- [ ] Poison keywords: add "crypto" → save → HN items with "crypto" nearly invisible
- [ ] Poison keywords: remove "crypto" → items reappear on next score
- [ ] Embedding cache: second HN visit loads faster (check console for cache hit logs)
- [ ] Taste profile: radar chart renders, probes list populates
- [ ] Agent view: toggle works, HN feed loads and scores
- [ ] Label buttons: thumbs up/down still work
- [ ] Export CSV still works
- [ ] Light/dark mode both render correctly
- [ ] Side panel at 320px width: no horizontal overflow
- [ ] Side panel at 500px width: category grid uses 3 columns

**Step 4: Commit version bump**

```bash
git add chrome-extension/public/manifest.json
git commit -m "chore: bump version to 0.2.0 for side panel release"
```
