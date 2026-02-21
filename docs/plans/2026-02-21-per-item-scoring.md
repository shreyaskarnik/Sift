# Per-Item Best-Category Scoring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Score each feed item against all preset anchors, use the best match as that item's score, and decouple pill clicks from global lens changes.

**Architecture:** Replace single-anchor `cosineSimilarity(anchorEmbedding, textEmb)` scoring with a `rankPresets(textEmb)` primitive that returns all presets sorted by score. All consumers (dimming, pills, labels, explanations) derive from this single ranking. Pill clicks become item-level label overrides, not global lens switches.

**Tech Stack:** TypeScript, Chrome MV3, Transformers.js v4

**Design doc:** `docs/plans/2026-02-21-per-item-scoring-design.md`

---

## Resolved Design Decisions

1. **Focus Lens**: Dropdown stays functional but no longer affects scoring. Scoring always uses `rankPresets()` (multi-preset). Dropdown sets `currentAnchor` as fallback for label stamping/CSV export only. `onAnchorChange()` no longer triggers feed re-score. Rename label to "Focus Lens".
2. **EXPLAIN_SCORE**: Caller passes `anchorId` in the payload (content scripts/popup already have `ranking.top.anchor`). Background uses it if present, falls back to `currentAnchor`.
3. **Pill visibility**: Always show top-1. Show top-2 only if `score >= ANCHOR_MIN_SCORE (0.15)` AND `gap < ANCHOR_TIE_GAP (0.05)`. Uses existing constants.
4. **Label migration**: `LABEL_SCHEMA_VERSION = 2` in constants. Background wipes labels on startup if stored schema < 2. `TrainingLabel.anchor` becomes required. Remove `detectedAnchors` backward-compat path in CSV export.

---

### Task 1: Add new types and constants

**Files:**
- Modify: `chrome-extension/src/shared/types.ts`
- Modify: `chrome-extension/src/shared/constants.ts`

**Step 1: Add PresetRank, PresetRanking types to types.ts**

After the existing `DetectedAnchor` interface (line 52), add:

```typescript
/** A single preset's similarity score. */
export interface PresetRank {
  anchor: string;
  score: number;
}

/** All presets ranked by similarity for a single text. */
export interface PresetRanking {
  ranks: PresetRank[];     // all presets, sorted by score desc
  top: PresetRank;         // ranks[0] — scoring winner
  confidence: number;      // top1.score - top2.score
  ambiguous: boolean;      // confidence < 0.05
}
```

**Step 2: Make TrainingLabel.anchor required and add new fields**

Replace `TrainingLabel` (lines 11-20) with:

```typescript
export interface TrainingLabel {
  text: string;
  label: "positive" | "negative";
  source: "hn" | "reddit" | "x" | "x-import" | "web";
  timestamp: number;
  /** Resolved anchor (override > auto > fallback). Required in schema v2+. */
  anchor: string;
  /** What the model predicted as best-match anchor. */
  autoAnchor?: string;
  /** Confidence: top1.score - top2.score gap. */
  autoConfidence?: number;
  /** How anchor was resolved. */
  anchorSource?: "auto" | "override" | "fallback";
}
```

**Step 3: Update SaveLabelPayload**

Replace `SaveLabelPayload` (lines 61-63) with:

```typescript
export interface SaveLabelPayload {
  label: TrainingLabel;
  anchorOverride?: string;
  presetRanking?: PresetRanking;
}
```

**Step 4: Update ExplainScorePayload**

Replace `ExplainScorePayload` (lines 81-84) with:

```typescript
export interface ExplainScorePayload {
  text: string;
  score: number;
  anchorId?: string;  // winning anchor from ranking
}
```

**Step 5: Update ScoredItem to carry PresetRanking**

Replace `ScoredItem` (lines 55-58) with:

```typescript
export interface ScoredItem {
  result: VibeResult;
  ranking?: PresetRanking;
}
```

**Step 6: Update ScoreResultsPayload**

Replace `ScoreResultsPayload` (lines 43-46) with:

```typescript
export interface ScoreResultsPayload {
  results: VibeResult[];
  rankings?: (PresetRanking | undefined)[];
}
```

**Step 7: Update PageScoreResponse**

Replace `PageScoreResponse` (lines 92-98) with:

```typescript
export interface PageScoreResponse {
  title: string;
  normalizedTitle: string;
  result: VibeResult | null;
  ranking?: PresetRanking;
  state: "ready" | "loading" | "unavailable" | "disabled";
}
```

**Step 8: Remove DetectedAnchor type**

Delete the `DetectedAnchor` interface (lines 49-52). It's replaced by `PresetRank`.

**Step 9: Add LABEL_SCHEMA_VERSION to constants.ts**

In `chrome-extension/src/shared/constants.ts`, add after existing constants:

```typescript
/** Bump when TrainingLabel schema changes. Background wipes labels on mismatch. */
export const LABEL_SCHEMA_VERSION = 2;
```

Add to `STORAGE_KEYS`:

```typescript
LABEL_SCHEMA: "label_schema_version",
```

**Step 10: Typecheck (expect errors — consumers not updated yet)**

Run: `cd chrome-extension && npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in files that reference removed `DetectedAnchor` or old field shapes. This is expected; we fix consumers in subsequent tasks.

**Step 11: Commit**

```bash
git add chrome-extension/src/shared/types.ts chrome-extension/src/shared/constants.ts
git commit -m "feat: add PresetRanking types, schema version, require TrainingLabel.anchor"
```

---

### Task 2: Add rankPresets() and label migration to background

**Files:**
- Modify: `chrome-extension/src/background/background.ts`

**Step 1: Import new types**

Update the import block (line 26-40) to import `PresetRanking` and `PresetRank`:

```typescript
import type {
  // ...existing imports...
  PresetRanking,
  PresetRank,
} from "../shared/types";
```

Import `LABEL_SCHEMA_VERSION` from constants:

```typescript
import {
  // ...existing imports...
  LABEL_SCHEMA_VERSION,
} from "../shared/constants";
```

**Step 2: Add label migration on startup**

After the existing `chrome.storage.local.get(STORAGE_KEYS.ANCHOR).then(...)` block (around line 90), add:

```typescript
// Migrate labels: wipe if schema version is outdated
chrome.storage.local.get([STORAGE_KEYS.LABEL_SCHEMA]).then((stored) => {
  const storedVersion = stored[STORAGE_KEYS.LABEL_SCHEMA] ?? 0;
  if (storedVersion < LABEL_SCHEMA_VERSION) {
    console.log(`[bg] Label schema ${storedVersion} → ${LABEL_SCHEMA_VERSION}: wiping old labels`);
    chrome.storage.local.set({
      [STORAGE_KEYS.LABELS]: [],
      [STORAGE_KEYS.LABEL_SCHEMA]: LABEL_SCHEMA_VERSION,
    });
  }
});
```

**Step 3: Add rankPresets() function**

Replace `detectAnchorsDetailedFromEmbedding` (lines 409-426), `detectAnchorsFromEmbedding` (lines 429-431), and `detectAnchors` (lines 434-440) with a single function:

```typescript
/**
 * Rank all preset anchors by similarity to a text embedding.
 * Single primitive: scoring, pills, labels, explanation all derive from this.
 */
function rankPresets(textEmb: Float32Array): PresetRanking | undefined {
  if (presetEmbeddings.size === 0) return undefined;

  const ranks: PresetRank[] = [...presetEmbeddings.entries()]
    .map(([anchor, emb]) => ({ anchor, score: cosineSimilarity(textEmb, emb) }))
    .sort((a, b) => b.score - a.score);

  const top = ranks[0];
  const second = ranks[1];
  const confidence = second ? top.score - second.score : 1.0;

  return {
    ranks,
    top,
    confidence,
    ambiguous: confidence < ANCHOR_TIE_GAP,
  };
}

/**
 * Derive visible pills from ranking.
 * Always top-1; top-2 only if score >= threshold and gap is small.
 */
function rankingToPills(ranking: PresetRanking): PresetRank[] {
  const pills = [ranking.top];
  const second = ranking.ranks[1];
  if (second && second.score >= ANCHOR_MIN_SCORE && ranking.ambiguous) {
    pills.push(second);
  }
  return pills;
}
```

**Step 4: Update PageScoreCacheEntry**

Replace the interface (lines 506-512) with:

```typescript
interface PageScoreCacheEntry {
  title: string;
  normalizedTitle: string;
  result: VibeResult;
  ranking?: PresetRanking;
  stale: boolean;
}
```

**Step 5: Rewrite scorePageTitle() to use rankPresets()**

In `scorePageTitle()` (lines 631-654), replace the scoring block:

```typescript
// OLD:
// const score = cosineSimilarity(anchorEmbedding!, textEmb);
// const result = mapScoreToVibe(norm, score);
// const detectedAnchors = detectAnchorsFromEmbedding(textEmb);

// NEW:
const ranking = rankPresets(textEmb);
const score = ranking ? ranking.top.score : cosineSimilarity(anchorEmbedding!, textEmb);
const result = mapScoreToVibe(norm, score);

const entry: PageScoreCacheEntry = {
  title,
  normalizedTitle: norm,
  result,
  ranking,
  stale: false,
};
pageScoreCache.set(tabId, entry);
updateBadge(tabId, result);

// Broadcast to popup
const updated: PageScoreUpdatedPayload = {
  tabId, title, normalizedTitle: norm, result, ranking, state: "ready",
};
```

**Step 6: Rewrite SCORE_TEXTS handler to use rankPresets()**

Replace the SCORE_TEXTS handler (lines 776-787):

```typescript
embed(p.texts)
  .then((embeddings) => {
    const results = embeddings.map((emb, i) => {
      const ranking = rankPresets(emb);
      const score = ranking ? ranking.top.score : cosineSimilarity(anchorEmbedding!, emb);
      return mapScoreToVibe(p.texts[i], score);
    });
    const rankings = embeddings.map((emb) => rankPresets(emb));
    sendResponse({ results, rankings });
  })
  .catch((err) => sendResponse({ error: String(err) }));
```

Note: `rankPresets()` is called twice per embedding here. Optimize by computing once:

```typescript
embed(p.texts)
  .then((embeddings) => {
    const rankings = embeddings.map((emb) => rankPresets(emb));
    const results = p.texts.map((text, i) => {
      const ranking = rankings[i];
      const score = ranking ? ranking.top.score : cosineSimilarity(anchorEmbedding!, embeddings[i]);
      return mapScoreToVibe(text, score);
    });
    sendResponse({ results, rankings });
  })
  .catch((err) => sendResponse({ error: String(err) }));
```

**Step 7: Update EXPLAIN_SCORE handler**

Replace `explainScore` function (lines 336-343):

```typescript
async function explainScore(text: string, score: number, anchorId?: string): Promise<string> {
  const title = text.replace(/\s+/g, " ").trim();
  if (!title) {
    return "No title text available to inspect.";
  }
  const anchor = anchorId || await loadAnchor();
  return buildDeterministicExplanation(title, score, anchor);
}
```

Update the EXPLAIN_SCORE message handler (lines 790-801):

```typescript
case MSG.EXPLAIN_SCORE: {
  const p = payload as ExplainScorePayload;
  if (typeof p?.text !== "string") {
    sendResponse({ error: "Invalid explain payload" });
    return;
  }
  const safeScore = Number.isFinite(p.score) ? p.score : 0;
  explainScore(p.text, safeScore, p.anchorId)
    .then((explanation) => sendResponse({ explanation }))
    .catch((err) => sendResponse({ error: String(err) }));
  return true;
}
```

**Step 8: Update SAVE_LABEL handler**

Replace the SAVE_LABEL handler (lines 825-851):

```typescript
case MSG.SAVE_LABEL: {
  const { label, anchorOverride, presetRanking } = payload as SaveLabelPayload;
  if (!label || typeof label.text !== "string") {
    sendResponse({ error: "Invalid label payload" });
    return;
  }

  (async () => {
    // Anchor resolution: override > auto > fresh detect > fallback
    let resolvedAnchor: string;
    let anchorSource: "override" | "auto" | "fallback";

    if (anchorOverride) {
      resolvedAnchor = anchorOverride;
      anchorSource = "override";
    } else if (presetRanking?.top) {
      resolvedAnchor = presetRanking.top.anchor;
      anchorSource = "auto";
    } else {
      // Fallback: embed + rank (for cases like X archive import)
      try {
        const [textEmb] = await embed([label.text.replace(/\s+/g, " ").trim()]);
        const ranking = rankPresets(textEmb);
        if (ranking) {
          resolvedAnchor = ranking.top.anchor;
          anchorSource = "auto";
        } else {
          resolvedAnchor = currentAnchor || DEFAULT_QUERY_ANCHOR;
          anchorSource = "fallback";
        }
      } catch {
        resolvedAnchor = currentAnchor || DEFAULT_QUERY_ANCHOR;
        anchorSource = "fallback";
      }
    }

    const stamped: TrainingLabel = {
      ...label,
      anchor: resolvedAnchor,
      autoAnchor: presetRanking?.top.anchor,
      autoConfidence: presetRanking?.confidence,
      anchorSource,
    };

    await enqueueLabelWrite((labels) => { labels.push(stamped); return labels; });
    sendResponse({ success: true });
  })().catch((err) => sendResponse({ error: String(err) }));
  return true;
}
```

**Step 9: Commit**

```bash
git add chrome-extension/src/background/background.ts
git commit -m "feat: add rankPresets(), label migration, rewrite scoring/explain/save handlers"
```

---

### Task 3: Update content script data flow

**Files:**
- Modify: `chrome-extension/src/content/common/batch-scorer.ts`
- Modify: `chrome-extension/src/content/common/label-buttons.ts`
- Modify: `chrome-extension/src/content/common/widget.ts`

**Step 1: Update batch-scorer.ts**

Replace entire file. Key changes: import `PresetRanking` instead of `DetectedAnchor`, unpack `rankings` from response:

```typescript
import { MSG, SCORE_BATCH_SIZE } from "../../shared/constants";
import type { ScoredItem, PresetRanking } from "../../shared/types";

async function waitForModel(maxWaitMs = 120_000): Promise<void> {
  let delay = 1000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS });
      if (resp?.modelReady && resp?.hasAnchor) return;
    } catch {
      // Extension context might not be ready yet
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 10_000);
  }
  throw new Error("Model did not become ready in time");
}

export async function scoreTexts(texts: string[]): Promise<ScoredItem[]> {
  await waitForModel();

  const items: ScoredItem[] = [];

  for (let i = 0; i < texts.length; i += SCORE_BATCH_SIZE) {
    const batch = texts.slice(i, i + SCORE_BATCH_SIZE);
    const response = await chrome.runtime.sendMessage({
      type: MSG.SCORE_TEXTS,
      payload: { texts: batch },
    });
    if (response?.error) {
      throw new Error(response.error);
    }
    if (response?.results) {
      const rankings: (PresetRanking | undefined)[] = response.rankings ?? [];
      response.results.forEach((result: ScoredItem["result"], j: number) => {
        items.push({ result, ranking: rankings[j] });
      });
    }
  }

  return items;
}
```

**Step 2: Update label-buttons.ts**

Add `PresetRanking` parameter. The label-buttons need to know the ranking and any override so they can pass it through SAVE_LABEL:

```typescript
import { MSG } from "../../shared/constants";
import type { TrainingLabel, PresetRanking } from "../../shared/types";

export function createLabelButtons(
  text: string,
  source: "hn" | "reddit" | "x",
  ranking?: PresetRanking,
  anchorOverride?: string,
): HTMLSpanElement {
  const container = document.createElement("span");
  container.className = "ss-votes";

  const btnUp = document.createElement("span");
  btnUp.className = "ss-vote ss-vote-up";
  btnUp.textContent = "\u{1F44D}";
  btnUp.title = "Matches your vibe";

  const btnDown = document.createElement("span");
  btnDown.className = "ss-vote ss-vote-down";
  btnDown.textContent = "\u{1F44E}";
  btnDown.title = "Doesn't match your vibe";

  let selected: "positive" | "negative" | null = null;

  /** Current override — may be updated by pill click after button creation. */
  let currentOverride = anchorOverride;

  /** Allow external code (pill click) to update the override. */
  (container as any)._setAnchorOverride = (id: string) => { currentOverride = id; };

  function handleClick(label: "positive" | "negative", btn: HTMLSpanElement) {
    if (selected === label) return;
    selected = label;

    const isUp = label === "positive";
    btnUp.classList.toggle("ss-on", isUp);
    btnUp.classList.toggle("ss-off", !isUp);
    btnDown.classList.toggle("ss-on", !isUp);
    btnDown.classList.toggle("ss-off", isUp);

    btn.classList.remove("ss-pop");
    void btn.offsetWidth;
    btn.classList.add("ss-pop");

    // Anchor is resolved by background from override > ranking > fallback.
    // We pass a minimal label; background stamps the full anchor.
    const trainingLabel: TrainingLabel = {
      text,
      label,
      source,
      timestamp: Date.now(),
      anchor: currentOverride || ranking?.top.anchor || "",
    };

    chrome.runtime.sendMessage({
      type: MSG.SAVE_LABEL,
      payload: {
        label: trainingLabel,
        anchorOverride: currentOverride,
        presetRanking: ranking,
      },
    });
  }

  btnUp.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleClick("positive", btnUp);
  });

  btnDown.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleClick("negative", btnDown);
  });

  container.append(btnUp, btnDown);
  return container;
}
```

**Step 3: Update widget.ts**

Key changes:
- `applyScore()` receives `PresetRanking` instead of `DetectedAnchor[]`
- `createExplainButton()` passes `anchorId` in EXPLAIN_SCORE payload
- Inspector pills set item-level override via `_setAnchorOverride`, not `UPDATE_ANCHOR`
- Import `PresetRanking`, `PresetRank` instead of `DetectedAnchor`

Replace the import line (line 2):

```typescript
import type { VibeResult, PresetRanking, PresetRank } from "../../shared/types";
```

Replace `createExplainButton` function signature and pill behavior (lines 122-234):

```typescript
function createExplainButton(
  text: string,
  score: number,
  ranking?: PresetRanking,
  votesContainer?: HTMLSpanElement,
): HTMLSpanElement {
  const btn = document.createElement("span");
  btn.className = "ss-vote ss-explain-btn";
  btn.textContent = "?";
  btn.title = "Inspect score";

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (activeTip) {
      activeTip.remove();
      activeTip = null;
    }

    const rect = btn.getBoundingClientRect();
    const tip = document.createElement("div");
    tip.className = "ss-explain-tip ss-thinking";

    const header = document.createElement("div");
    header.className = "ss-inspector-head";

    const bandPill = document.createElement("span");
    bandPill.className = "ss-inspector-pill ss-inspector-band";
    bandPill.textContent = getScoreBand(score);

    const scorePill = document.createElement("span");
    scorePill.className = "ss-inspector-pill";
    scorePill.textContent = score.toFixed(2);

    header.append(bandPill, scorePill);
    tip.append(header);

    // Detected lens pills — item-level override, NOT global UPDATE_ANCHOR
    const pills = ranking ? rankingToPills(ranking) : [];
    if (pills.length > 0) {
      const lensRow = document.createElement("div");
      lensRow.className = "ss-inspector-lenses";
      for (const pr of pills) {
        const pill = document.createElement("span");
        pill.className = "ss-inspector-lens";
        if (pr.anchor === ranking?.top.anchor) pill.classList.add("ss-lens-active");
        pill.textContent = `${ANCHOR_LABELS[pr.anchor] || pr.anchor} ${pr.score.toFixed(2)}`;
        pill.title = `Label under ${ANCHOR_LABELS[pr.anchor] || pr.anchor}`;
        pill.addEventListener("click", (ev) => {
          ev.stopPropagation();
          // Set item-level override — no global UPDATE_ANCHOR
          if (votesContainer) {
            (votesContainer as any)._setAnchorOverride?.(pr.anchor);
          }
          lensRow.querySelectorAll(".ss-inspector-lens").forEach((p) =>
            p.classList.remove("ss-lens-active"),
          );
          pill.classList.add("ss-lens-active");
        });
        lensRow.appendChild(pill);
      }
      tip.appendChild(lensRow);
    }

    const body = document.createElement("div");
    body.className = "ss-inspector-body";
    body.textContent = "Analyzing score\u2026";
    tip.appendChild(body);

    tip.style.top = `${rect.bottom + window.scrollY + 4}px`;
    tip.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(tip);
    activeTip = tip;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: MSG.EXPLAIN_SCORE,
        payload: { text, score, anchorId: ranking?.top.anchor },
      });
      if (!document.body.contains(tip)) return;
      tip.classList.remove("ss-thinking");
      if (resp?.error) {
        body.textContent = resp.error;
      } else {
        body.textContent = resp?.explanation || "No explanation available.";
      }
    } catch {
      if (document.body.contains(tip)) {
        tip.classList.remove("ss-thinking");
        body.textContent = "Inspector unavailable.";
      }
    }

    const dismiss = (ev: MouseEvent) => {
      if (!tip.contains(ev.target as Node) && ev.target !== btn) {
        tip.remove();
        if (activeTip === tip) activeTip = null;
        document.removeEventListener("click", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("click", dismiss, true), 0);
  });

  return btn;
}
```

Add `rankingToPills` helper (mirror of background logic, for client-side pill rendering):

```typescript
/** Derive visible pills from ranking. Mirrors background rankingToPills(). */
function rankingToPills(ranking: PresetRanking): PresetRank[] {
  const ANCHOR_TIE_GAP = 0.05;
  const ANCHOR_MIN_SCORE = 0.15;
  const pills: PresetRank[] = [ranking.top];
  const second = ranking.ranks[1];
  if (second && second.score >= ANCHOR_MIN_SCORE && ranking.confidence < ANCHOR_TIE_GAP) {
    pills.push(second);
  }
  return pills;
}
```

Update `applyScore()` signature and body (lines 243-282):

```typescript
export function applyScore(
  result: VibeResult,
  el: HTMLElement,
  voteAnchor?: HTMLElement | null,
  source?: "hn" | "reddit" | "x",
  ranking?: PresetRanking,
): void {
  injectStyles();

  const score = Math.max(0, Math.min(1, result.rawScore));
  const hue = Math.round(scoreToHue(score));
  const { opacity, saturate } = computeSuppression(score);

  el.style.setProperty("--ss-h", String(hue));
  el.style.setProperty("--ss-opacity", String(opacity));
  el.style.setProperty("--ss-sat", String(saturate));
  el.dataset.siftScore = String(score);

  if (el.classList.contains("ss-scored")) return;
  el.classList.add("ss-scored");

  const band = getScoreBand(score);
  if (band === "HIGH" || band === "GOOD") {
    const chip = document.createElement("span");
    chip.className = "ss-score-chip";
    chip.dataset.band = band;
    chip.textContent = `${band} ${score.toFixed(2)}`;
    (voteAnchor || el).appendChild(chip);
  }

  if (source) {
    const anchor = voteAnchor || el;
    const buttons = createLabelButtons(result.text, source, ranking);
    buttons.appendChild(createExplainButton(result.text, score, ranking, buttons));
    anchor.appendChild(buttons);
  }
}
```

**Step 4: Remove onAnchorChange re-score behavior**

In the `chrome.storage.onChanged` listener (lines 63-77), replace the anchor-change block:

```typescript
// OLD:
if (changes[STORAGE_KEYS.ANCHOR]) {
  clearAppliedScores();
  resetSiftMarkers();
  onAnchorChanged?.();
}

// NEW: Scoring uses rankPresets() — anchor change doesn't affect scores.
// Just update pill highlights if inspector is open. No re-score needed.
// (onAnchorChanged callback removed — kept for potential future Focus mode)
```

Remove the `onAnchorChanged` variable (line 55), the `onAnchorChange` export (lines 58-60), and the anchor-change block in the storage listener.

**Step 5: Commit**

```bash
git add chrome-extension/src/content/common/batch-scorer.ts \
       chrome-extension/src/content/common/label-buttons.ts \
       chrome-extension/src/content/common/widget.ts
git commit -m "feat: content scripts use PresetRanking, pills set item-level override"
```

---

### Task 4: Update per-site content scripts

**Files:**
- Modify: `chrome-extension/src/content/hn/hn-content.ts`
- Modify: `chrome-extension/src/content/reddit/reddit-content.ts`
- Modify: `chrome-extension/src/content/x/x-content.ts`

**Step 1: Update hn-content.ts**

Remove `onAnchorChange` from imports (line 9). Remove `onAnchorChange(() => void processHN())` call (line 59).

Update the scoring callback (line 37):

```typescript
// OLD:
items.forEach(({ result, detectedAnchors }, i) => {
  ...
  applyScore(result, titleLine, titleLine, "hn", detectedAnchors);
});

// NEW:
items.forEach(({ result, ranking }, i) => {
  const { el } = unprocessed[i];
  el.dataset.sift = "done";
  el.classList.remove("ss-pending");
  const titleLine = el.parentElement as HTMLElement;
  applyScore(result, titleLine, titleLine, "hn", ranking);
});
```

**Step 2: Update reddit-content.ts**

Same pattern: remove `onAnchorChange` import and call (line 105). Update scoring callback (line 65):

```typescript
scored.forEach(({ result, ranking }, i) => {
  // ...existing DOM logic...
  if (el.tagName === "SHREDDIT-POST") {
    const titleSlot = el.querySelector('[slot="title"]') || el.querySelector("a[slot='full-post-link']");
    applyScore(result, htmlEl, (titleSlot || htmlEl) as HTMLElement, "reddit", ranking);
  } else {
    applyScore(result, htmlEl, htmlEl, "reddit", ranking);
  }
});
```

**Step 3: Update x-content.ts**

Same pattern: remove `onAnchorChange` import and call (line 66). Update scoring callback (line 38):

```typescript
items.forEach(({ result, ranking }, i) => {
  const { el } = unprocessed[i];
  el.dataset.sift = "done";
  el.classList.remove("ss-pending");
  applyScore(result, el, el, "x", ranking);
});
```

**Step 4: Commit**

```bash
git add chrome-extension/src/content/hn/hn-content.ts \
       chrome-extension/src/content/reddit/reddit-content.ts \
       chrome-extension/src/content/x/x-content.ts
git commit -m "feat: per-site scripts use PresetRanking, remove onAnchorChange re-score"
```

---

### Task 5: Update popup

**Files:**
- Modify: `chrome-extension/src/popup/popup.ts`
- Modify: `chrome-extension/public/popup.html`

**Step 1: Update popup.ts imports**

Replace the type import (line 5):

```typescript
import type { TrainingLabel, ModelStatus, PageScoreResponse, PageScoreUpdatedPayload, PresetRanking } from "../shared/types";
```

**Step 2: Add popup-level state for page score ranking + override**

After `let lastPageState` (line 473):

```typescript
let currentPageRanking: PresetRanking | undefined;
let currentPageAnchorOverride: string | undefined;
```

**Step 3: Update renderPageScore() for PresetRanking**

In `renderPageScore()`, replace the pill-rendering block (lines 577-590):

```typescript
// Reset override on new page score render
currentPageAnchorOverride = undefined;
currentPageRanking = resp.ranking;

// Render detected anchor pills from ranking
if (resp.ranking) {
  const ANCHOR_TIE_GAP = 0.05;
  const ANCHOR_MIN_SCORE = 0.15;
  const pills = [resp.ranking.top];
  const second = resp.ranking.ranks[1];
  if (second && second.score >= ANCHOR_MIN_SCORE && resp.ranking.confidence < ANCHOR_TIE_GAP) {
    pills.push(second);
  }

  if (pills.length > 0) {
    for (const pr of pills) {
      const pill = document.createElement("button");
      pill.className = "page-score-anchor-pill";
      if (pr.anchor === resp.ranking.top.anchor) pill.classList.add("active");
      const label = ANCHOR_LABELS[pr.anchor] || pr.anchor;
      pill.textContent = label;
      pill.title = `Label under ${label}`;
      pill.addEventListener("click", () => {
        // Item-level override only — no applyAnchor / UPDATE_ANCHOR
        currentPageAnchorOverride = pr.anchor;
        pageScoreAnchors.querySelectorAll(".page-score-anchor-pill").forEach((p) =>
          p.classList.remove("active"),
        );
        pill.classList.add("active");
      });
      pageScoreAnchors.appendChild(pill);
    }
    pageScoreAnchors.style.display = "flex";
  }
}
```

**Step 4: Update EXPLAIN_SCORE call in popup**

In the explainBtn click handler (lines 557-572), pass the winning anchor:

```typescript
explainBtn.addEventListener("click", () => {
  if (pageScoreExplain.style.display !== "none") {
    pageScoreExplain.style.display = "none";
    return;
  }
  pageScoreExplain.textContent = "Analyzing...";
  pageScoreExplain.style.display = "block";
  chrome.runtime.sendMessage({
    type: MSG.EXPLAIN_SCORE,
    payload: { text: normalizedTitle, score, anchorId: currentPageRanking?.top.anchor },
  }).then((r) => {
    pageScoreExplain.textContent = r?.explanation || r?.error || "No explanation available.";
  }).catch(() => {
    pageScoreExplain.textContent = "Inspector unavailable.";
  });
});
```

**Step 5: Update savePageLabel() to carry override + ranking**

Replace `savePageLabel()` (lines 593-611):

```typescript
async function savePageLabel(label: "positive" | "negative"): Promise<void> {
  try {
    const anchor = currentPageAnchorOverride || currentPageRanking?.top.anchor || "";
    await chrome.runtime.sendMessage({
      type: MSG.SAVE_LABEL,
      payload: {
        label: {
          text: currentPageTitle,
          label,
          source: "web" as const,
          timestamp: Date.now(),
          anchor,
        },
        anchorOverride: currentPageAnchorOverride,
        presetRanking: currentPageRanking,
      },
    });
    await refreshLabelCounts();
    showToast(`Page labeled as ${label}.`, { type: "success" });
  } catch {
    showToast("Failed to save label.", { type: "error" });
  }
}
```

**Step 6: Rename "Scoring Lens" to "Focus Lens" in popup.html**

In `chrome-extension/public/popup.html` line 64:

```html
<!-- OLD: -->
<label>🔎 Scoring Lens</label>

<!-- NEW: -->
<label>🔎 Focus Lens</label>
```

**Step 7: Commit**

```bash
git add chrome-extension/src/popup/popup.ts chrome-extension/public/popup.html
git commit -m "feat: popup uses PresetRanking pills, item-level override, rename Focus Lens"
```

---

### Task 6: Update CSV export

**Files:**
- Modify: `chrome-extension/src/storage/csv-export.ts`

**Step 1: Simplify resolveAnchorsForLabel()**

Replace the function (lines 87-100). With `TrainingLabel.anchor` now required and `detectedAnchors` removed, this simplifies to:

```typescript
function resolveAnchorsForLabel(label: TrainingLabel, fallbackAnchor: string): string[] {
  const stampedAnchor = label.anchor?.trim();
  if (stampedAnchor) return [stampedAnchor];
  return [fallbackAnchor];
}
```

**Step 2: Commit**

```bash
git add chrome-extension/src/storage/csv-export.ts
git commit -m "feat: simplify CSV anchor resolution, remove detectedAnchors compat"
```

---

### Task 7: Remove unused exports + clean up widget.ts

**Files:**
- Modify: `chrome-extension/src/content/common/widget.ts`

**Step 1: Verify onAnchorChange is fully removed**

Ensure `onAnchorChange` export, `onAnchorChanged` variable, and the `STORAGE_KEYS.ANCHOR` change listener block are all removed from widget.ts.

Also remove `resetSiftMarkers` and `clearAppliedScores` from the anchor-change listener block — they should only fire on site-enable toggle, not anchor change.

Update widget.ts storage listener to only handle sensitivity and site-enabled:

```typescript
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEYS.SENSITIVITY]) {
    sensitivity = changes[STORAGE_KEYS.SENSITIVITY].newValue ?? 50;
    applySensitivityToExistingScores();
  }
  if (changes[STORAGE_KEYS.SITE_ENABLED]) {
    siteEnabled = changes[STORAGE_KEYS.SITE_ENABLED].newValue ?? { hn: true, reddit: true, x: true };
  }
});
```

**Step 2: Remove onAnchorChange imports from per-site scripts**

Verify all three content scripts no longer import `onAnchorChange` and no longer have `resetSiftMarkers` import (unless used for site-enable toggle — check each file).

Note: `clearAppliedScores` and `resetSiftMarkers` are still needed in per-site scripts for the site-enable toggle handler. Keep those imports.

**Step 3: Build and typecheck**

Run: `cd chrome-extension && npm run typecheck`
Expected: PASS with no errors.

Run: `cd chrome-extension && npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add chrome-extension/src/content/common/widget.ts \
       chrome-extension/src/content/hn/hn-content.ts \
       chrome-extension/src/content/reddit/reddit-content.ts \
       chrome-extension/src/content/x/x-content.ts
git commit -m "chore: remove unused onAnchorChange, clean up widget exports"
```

---

### Task 8: Full build verification

**Step 1: Typecheck**

Run: `cd chrome-extension && npm run typecheck`
Expected: PASS.

**Step 2: Build**

Run: `cd chrome-extension && npm run build`
Expected: Clean build. `dist/` ready for unpacked extension load.

**Step 3: Manual smoke test**

1. Load `dist/` as unpacked extension
2. Open HN — items should score (best-of-all-presets score)
3. Open popup — hero card shows pills from PresetRanking, clicking a pill highlights it without re-scoring entire feed
4. Click `?` on a feed item — explanation references the winning anchor, not the dropdown anchor
5. Thumbs up/down on an item — label saved with correct anchor metadata
6. Export CSV — triplets grouped by auto-detected anchor
7. Verify labels are wiped on fresh install (schema migration)

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address build/test issues from per-item scoring"
```

---

## Summary of files changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `PresetRank`, `PresetRanking`; make `TrainingLabel.anchor` required; extend with `autoAnchor`, `autoConfidence`, `anchorSource`; update `ScoredItem`, `SaveLabelPayload`, `ExplainScorePayload`, `ScoreResultsPayload`, `PageScoreResponse`; remove `DetectedAnchor` |
| `src/shared/constants.ts` | Add `LABEL_SCHEMA_VERSION`, `STORAGE_KEYS.LABEL_SCHEMA` |
| `src/background/background.ts` | Add `rankPresets()` + `rankingToPills()`; remove 3 detect functions; rewrite `scorePageTitle()`, `SCORE_TEXTS`, `EXPLAIN_SCORE`, `SAVE_LABEL` handlers; add label migration; update `PageScoreCacheEntry` |
| `src/content/common/batch-scorer.ts` | Unpack `PresetRanking` from response |
| `src/content/common/label-buttons.ts` | Accept `ranking` + `anchorOverride`; expose `_setAnchorOverride` for pill click |
| `src/content/common/widget.ts` | `applyScore()` takes `PresetRanking`; pills set item override not `UPDATE_ANCHOR`; explain passes `anchorId`; remove `onAnchorChange` export + listener |
| `src/content/{hn,reddit,x}/*-content.ts` | Destructure `ranking` from `ScoredItem`; remove `onAnchorChange` |
| `src/popup/popup.ts` | Pills from `PresetRanking`; pill click sets `anchorOverride` state; `savePageLabel` carries override + ranking; explain passes `anchorId` |
| `public/popup.html` | Rename "Scoring Lens" → "Focus Lens" |
| `src/storage/csv-export.ts` | Remove `detectedAnchors` backward-compat path |
