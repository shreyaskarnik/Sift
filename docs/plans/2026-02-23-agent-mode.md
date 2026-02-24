# Agent Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a manual "Fetch my feed" button that scores HN's top 500 stories against the user's taste vector and displays the top 50 on a dedicated page.

**Architecture:** A new `AGENT_FETCH_HN` message handler in the background service worker fetches story IDs and item details from the HN Firebase API, embeds titles in batches, scores each against the cached taste vector, and returns ranked results. A new `agent.html` IIFE page displays the results. The popup links to the agent page.

**Tech Stack:** Chrome MV3 service worker, HN Firebase API (`hacker-news.firebaseio.com`), Transformers.js embeddings (reuses existing `embed()` + `l2Normalize()`), Vite IIFE build.

---

### Task 1: Types + Message Constant

**Files:**
- Modify: `src/shared/types.ts` (add `AgentStory` + `AgentFetchHNResponse` at end)
- Modify: `src/shared/constants.ts` (add `AGENT_FETCH_HN` to `MSG`)

**Step 1: Add types to `src/shared/types.ts`**

Append after the last interface:

```ts
/** A single HN story scored by the agent */
export interface AgentStory {
  id: number;
  title: string;
  url: string;
  domain: string;
  hnScore: number;
  by: string;
  time: number;
  descendants: number;
  tasteScore: number;
}

/** Response from AGENT_FETCH_HN */
export interface AgentFetchHNResponse {
  stories: AgentStory[];
  elapsed: number;
  error?: string;
}
```

**Step 2: Add message type to `src/shared/constants.ts`**

Add to the `MSG` object, after the `RESTORE_LABEL` line:

```ts
  // Agent
  AGENT_FETCH_HN: "AGENT_FETCH_HN",
```

**Step 3: Verify**

Run: `npm run typecheck`
Expected: Clean (no errors)

**Step 4: Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts
git commit -m "feat(agent): add AgentStory types and AGENT_FETCH_HN message constant"
```

---

### Task 2: Background Handler — `AGENT_FETCH_HN`

**Files:**
- Modify: `src/background/background.ts` (add helper + handler in the message switch)

**Context:** The background already has:
- `embed(texts)` at line 306 — returns `Float32Array[]` of embeddings
- `l2Normalize(vec)` — in-place L2 normalization
- `computeTasteProfile()` at line 353 — computes taste probes (we need just the vector part)
- `cosineSimilarity(a, b)` — dot product of two Float32Arrays
- `SCORE_BATCH_SIZE = 16` — batch size for embedding calls
- The taste vector is computed fresh inside `computeTasteProfile()` but NOT exposed as a standalone vector.

**Approach:** Extract a `computeTasteVec()` helper that returns just the `Float32Array` taste vector (or null if insufficient labels). This avoids re-embedding probes which we don't need for agent scoring.

**Step 1: Add `computeTasteVec()` helper**

Add this above `computeTasteProfile()` (around line 352), extracting the taste vector logic (lines 365-435 of the current `computeTasteProfile`):

```ts
/**
 * Compute the contrastive taste vector from stored labels.
 * Returns null if model not loaded or insufficient positive labels.
 */
async function computeTasteVec(): Promise<Float32Array | null> {
  if (!model || !tokenizer) return null;

  const labels = await readLabels();
  labels.sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Set<string>();
  const positives: string[] = [];
  const negatives: string[] = [];

  for (const l of labels) {
    const norm = normalizeTasteText(l.text);
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (l.label === "positive") positives.push(l.text);
    else negatives.push(l.text);
  }

  if (positives.length < TASTE_MIN_LABELS) return null;

  // Embed positives
  const posEmbeddings: Float32Array[] = [];
  for (let i = 0; i < positives.length; i += SCORE_BATCH_SIZE) {
    const batch = positives.slice(i, i + SCORE_BATCH_SIZE);
    const embs = await embed(batch);
    for (const e of embs) posEmbeddings.push(l2Normalize(e));
  }

  // Positive centroid
  const dim = posEmbeddings[0].length;
  const posCentroid = new Float32Array(dim);
  for (const emb of posEmbeddings) {
    for (let j = 0; j < dim; j++) posCentroid[j] += emb[j];
  }
  for (let j = 0; j < dim; j++) posCentroid[j] /= posEmbeddings.length;

  // Contrastive subtraction
  const tasteVec = new Float32Array(posCentroid);
  if (negatives.length >= TASTE_MIN_NEGATIVES) {
    const negEmbeddings: Float32Array[] = [];
    for (let i = 0; i < negatives.length; i += SCORE_BATCH_SIZE) {
      const batch = negatives.slice(i, i + SCORE_BATCH_SIZE);
      const embs = await embed(batch);
      for (const e of embs) negEmbeddings.push(l2Normalize(e));
    }
    const negCentroid = new Float32Array(dim);
    for (const emb of negEmbeddings) {
      for (let j = 0; j < dim; j++) negCentroid[j] += emb[j];
    }
    for (let j = 0; j < dim; j++) negCentroid[j] /= negEmbeddings.length;
    for (let j = 0; j < dim; j++) {
      tasteVec[j] -= TASTE_NEG_ALPHA * negCentroid[j];
    }
  }

  // L2-normalize; fallback to posCentroid if collapsed
  let norm = 0;
  for (let j = 0; j < dim; j++) norm += tasteVec[j] * tasteVec[j];
  if (Math.sqrt(norm) < 1e-6) tasteVec.set(posCentroid);
  l2Normalize(tasteVec);

  return tasteVec;
}
```

**Step 2: Add the `AGENT_FETCH_HN` message handler**

Add inside the message switch, after the `RESTORE_LABEL` case:

```ts
      case MSG.AGENT_FETCH_HN: {
        (async () => {
          const start = performance.now();

          // 1. Compute taste vector
          const tasteVec = await computeTasteVec();
          if (!tasteVec) {
            sendResponse({ stories: [], elapsed: 0, error: "Taste profile not ready — label more items first." });
            return;
          }

          // 2. Fetch top story IDs
          const idsResp = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
          const ids: number[] = await idsResp.json();

          // 3. Batch-fetch item details (concurrency cap ~20)
          const CONCURRENCY = 20;
          type HNItem = { id: number; title?: string; url?: string; score?: number; by?: string; time?: number; descendants?: number; type?: string; deleted?: boolean; dead?: boolean };
          const items: HNItem[] = [];
          for (let i = 0; i < ids.length; i += CONCURRENCY) {
            const batch = ids.slice(i, i + CONCURRENCY);
            const fetched = await Promise.all(
              batch.map((id) =>
                fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
                  .then((r) => r.json() as Promise<HNItem | null>)
                  .catch(() => null),
              ),
            );
            for (const item of fetched) {
              if (item && !item.deleted && !item.dead && item.type === "story" && item.title) {
                items.push(item);
              }
            }
          }

          // 4. Embed titles in batches, score against taste vector
          const titles = items.map((it) => it.title!);
          const embeddings: Float32Array[] = [];
          for (let i = 0; i < titles.length; i += SCORE_BATCH_SIZE) {
            const batch = titles.slice(i, i + SCORE_BATCH_SIZE);
            const embs = await embed(batch);
            for (const e of embs) embeddings.push(l2Normalize(e));
          }

          // 5. Score + rank
          const scored: AgentStory[] = items.map((item, i) => {
            let domain = "";
            if (item.url) {
              try { domain = new URL(item.url).hostname.replace(/^www\./, ""); } catch { /* no-op */ }
            }
            return {
              id: item.id,
              title: item.title!,
              url: item.url ?? "",
              domain,
              hnScore: item.score ?? 0,
              by: item.by ?? "",
              time: item.time ?? 0,
              descendants: item.descendants ?? 0,
              tasteScore: cosineSimilarity(embeddings[i], tasteVec),
            };
          });

          scored.sort((a, b) => b.tasteScore - a.tasteScore);
          const top = scored.slice(0, 50);

          sendResponse({ stories: top, elapsed: performance.now() - start });
        })().catch((err) => sendResponse({ stories: [], elapsed: 0, error: String(err) }));
        return true;
      }
```

**Step 3: Add `AgentStory` to the import**

Add `AgentStory` to the existing `@shared/types` import at the top of background.ts.

**Step 4: Verify**

Run: `npm run typecheck`
Expected: Clean

**Step 5: Commit**

```bash
git add src/background/background.ts
git commit -m "feat(agent): add AGENT_FETCH_HN handler with taste vector scoring"
```

---

### Task 3: Refactor `computeTasteProfile()` to use `computeTasteVec()`

**Files:**
- Modify: `src/background/background.ts`

**Context:** Task 2 added `computeTasteVec()` which duplicates the taste vector logic from `computeTasteProfile()`. Now refactor `computeTasteProfile()` to call `computeTasteVec()` instead of inlining the same code.

**Step 1: Refactor**

Replace the body of `computeTasteProfile()` from the start through line 435 (the taste vector computation) with a call to `computeTasteVec()`. The probe embedding + scoring sections (lines 437-498) remain unchanged:

```ts
async function computeTasteProfile(): Promise<TasteProfileResponse> {
  if (!model || !tokenizer) {
    return {
      state: "error", message: "Model not loaded",
      probes: [], labelCount: 0, timestamp: Date.now(), cacheKey: "",
    };
  }

  const tasteVec = await computeTasteVec();
  if (!tasteVec) {
    // Count positive labels for the "label N more" message
    const labels = await readLabels();
    const seen = new Set<string>();
    let posCount = 0;
    for (const l of labels) {
      const norm = normalizeTasteText(l.text);
      if (seen.has(norm)) continue;
      seen.add(norm);
      if (l.label === "positive") posCount++;
    }
    const need = TASTE_MIN_LABELS - posCount;
    return {
      state: "insufficient_labels",
      message: `Label ${need} more item${need === 1 ? "" : "s"} to see your taste profile.`,
      probes: [], labelCount: posCount, timestamp: Date.now(), cacheKey: "",
    };
  }

  // Probe scoring continues from here (unchanged) ...
  // 6. Gather probes for active categories only
  // ... through to the return statement
```

**Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: Clean. Load extension, open taste.html, verify taste profile still renders correctly.

**Step 3: Commit**

```bash
git add src/background/background.ts
git commit -m "refactor(taste): extract computeTasteVec, reuse in computeTasteProfile"
```

---

### Task 4: Agent Page — `agent.html` + `agent.ts`

**Files:**
- Create: `public/agent.html`
- Create: `src/agent/agent.ts`
- Modify: `build.mjs` (add IIFE entry)

**Step 1: Create `public/agent.html`**

Follow the same pattern as `taste.html` / `labels.html` — CSS variables for light/dark, same font stack, same tokens. Key elements:

- Page header with "Agent" title, subtitle "Your personalized HN feed", "Fetch my feed" button
- Status area (`#status`) for progress text
- Empty state (`#empty`) for error/empty messages
- Story list container (`#story-list`)
- Same CSS variable tokens as taste.html/labels.html (copy the `:root` and `@media (prefers-color-scheme: dark)` blocks)
- Story row styles: rank (monospace, dimmed), title (13px, link), domain (dimmed, 10px), meta line (10px, dimmed: points/author/comments/age), taste score (monospace, accent color, right-aligned)
- Max-width 720px (slightly wider than labels.html's 640px to accommodate story rows)

**Step 2: Create `src/agent/agent.ts`**

The page script sends `AGENT_FETCH_HN` to background and renders the results using safe DOM methods (createElement + textContent, NO innerHTML with untrusted data):

```ts
import { MSG } from "@shared/constants";
import type { AgentFetchHNResponse, AgentStory } from "@shared/types";

const fetchBtn = document.getElementById("fetch-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const emptyEl = document.getElementById("empty")!;
const listEl = document.getElementById("story-list")!;

function formatRelativeTime(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderStories(stories: AgentStory[]): void {
  listEl.replaceChildren();       // safe clear
  emptyEl.textContent = "";

  if (stories.length === 0) {
    emptyEl.textContent = "No stories found.";
    return;
  }

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    const row = document.createElement("div");
    row.className = "story-row";

    const rank = document.createElement("span");
    rank.className = "story-rank";
    rank.textContent = String(i + 1);

    const body = document.createElement("div");
    body.className = "story-body";

    const title = document.createElement("div");
    title.className = "story-title";
    const link = document.createElement("a");
    link.href = `https://news.ycombinator.com/item?id=${s.id}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = s.title;
    title.appendChild(link);
    if (s.domain) {
      const domainSpan = document.createElement("span");
      domainSpan.style.cssText = "color:var(--text-dim);font-size:10px;margin-left:6px";
      domainSpan.textContent = `(${s.domain})`;
      title.appendChild(domainSpan);
    }

    const meta = document.createElement("div");
    meta.className = "story-meta";
    meta.textContent = [
      `${s.hnScore} pts`,
      s.by,
      `${s.descendants} comments`,
      formatRelativeTime(s.time),
    ].join(" · ");

    body.appendChild(title);
    body.appendChild(meta);

    const score = document.createElement("span");
    score.className = "story-score";
    score.textContent = Math.round(s.tasteScore * 100).toString();

    row.appendChild(rank);
    row.appendChild(body);
    row.appendChild(score);
    listEl.appendChild(row);
  }
}

async function fetchFeed(): Promise<void> {
  fetchBtn.disabled = true;
  listEl.replaceChildren();       // safe clear
  emptyEl.textContent = "";
  statusEl.textContent = "Fetching stories and scoring...";

  try {
    const resp = (await chrome.runtime.sendMessage({
      type: MSG.AGENT_FETCH_HN,
    })) as AgentFetchHNResponse;

    if (resp.error) {
      statusEl.textContent = "";
      emptyEl.textContent = resp.error;
      return;
    }

    const sec = (resp.elapsed / 1000).toFixed(1);
    statusEl.textContent = `Done — ${resp.stories.length} stories scored in ${sec}s`;
    renderStories(resp.stories);
  } catch (err) {
    statusEl.textContent = "";
    emptyEl.textContent = `Error: ${err}`;
  } finally {
    fetchBtn.disabled = false;
  }
}

fetchBtn.addEventListener("click", fetchFeed);
```

**Step 3: Add IIFE build entry in `build.mjs`**

Add to the `iifeEntries` array (after the `labels` entry):

```js
  { name: "agent", entry: resolve(__dirname, "src/agent/agent.ts") },
```

**Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: Clean typecheck, build produces `dist/agent.js`

**Step 5: Commit**

```bash
git add public/agent.html src/agent/agent.ts build.mjs
git commit -m "feat(agent): add agent.html page and agent.ts IIFE build"
```

---

### Task 5: Popup Link

**Files:**
- Modify: `public/popup.html` (add agent fold)
- Modify: `src/popup/popup.ts` (wire click handler)

**Step 1: Add agent fold in `public/popup.html`**

Add a new fold after the taste profile fold. Reuse the existing `.labels-full-link` CSS class:

```html
<!-- Agent fold -->
<div class="fold">
  <div class="fold-header" data-fold="agent">
    <span class="fold-label">Agent</span>
  </div>
  <div class="fold-body" data-fold-body="agent">
    <a href="#" class="labels-full-link" id="agent-link">Find my stories →</a>
  </div>
</div>
```

**Step 2: Wire click handler in `src/popup/popup.ts`**

After the existing `labelsFullLink` event listener block, add:

```ts
const agentLink = document.getElementById("agent-link");
agentLink?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("agent.html") });
});
```

**Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: Clean

**Step 4: Commit**

```bash
git add public/popup.html src/popup/popup.ts
git commit -m "feat(agent): add 'Find my stories' link in popup"
```

---

### Task 6: Build + End-to-End Verify

**Files:** None (verification only)

**Step 1: Full build**

Run: `npm run typecheck && npm run build`
Expected: Clean, `dist/agent.js` exists alongside all other outputs.

**Step 2: Manual verification checklist**

1. Load `dist/` as unpacked extension in `chrome://extensions`
2. Open popup → verify "Agent" fold with "Find my stories →" link exists
3. Click the link → `agent.html` opens in new tab
4. Click "Fetch my feed" → status shows "Fetching stories and scoring..."
5. After ~5-15 seconds → status shows "Done — 50 stories scored in Xs"
6. Stories displayed with rank, title (links to HN), domain, meta, taste score
7. Click a story title → opens HN discussion page in new tab
8. If taste profile not ready → shows "Taste profile not ready — label more items first."
9. Open taste.html → verify taste profile still renders correctly (not broken by refactor)

**Step 3: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(agent): address verification issues"
```
