# Taste Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "My Taste Profile" popup section that scores curated probe phrases against a contrastive centroid of the user's label embeddings to reveal content preferences.

**Architecture:** New message type `COMPUTE_TASTE_PROFILE` triggers background to embed labels (deduplicated), compute a contrastive taste vector (`posCentroid - 0.3 * negCentroid`), L2-normalize everything explicitly, embed category-derived probes, rank by cosine, apply diversity cap (max 3 per category), return top 15. Cached with a composite key (label texts hash + active categories + model ID + probes version). Rendered as a ranked bar chart in a new popup fold.

**Tech Stack:** TypeScript, Chrome MV3 messaging, existing `embed()` in background.ts, `scoreToHue()` for bar coloring.

**Design doc:** `docs/plans/2026-02-22-taste-profile.md`

---

### Task 1: Add types, constants, and probe phrases

**Files:**
- Modify: `src/shared/constants.ts:70-131` (MSG, STORAGE_KEYS, new constants)
- Modify: `src/shared/types.ts` (append new interfaces)
- Create: `src/shared/taste-probes.ts`

**Step 1: Add message type and storage key to constants.ts**

In `src/shared/constants.ts`, add to the `MSG` object (after `CATEGORIES_CHANGED` at line 101):

```typescript
  // Taste profile
  COMPUTE_TASTE_PROFILE: "COMPUTE_TASTE_PROFILE",
```

Add to the `STORAGE_KEYS` object (after `TOP_K_PILLS` at line 118):

```typescript
  TASTE_PROFILE: "taste_profile",
```

Add after `SCORE_BATCH_SIZE` at line 131:

```typescript
/** Minimum positive labels required to compute a taste profile */
export const TASTE_MIN_LABELS = 10;

/** Number of top probes to return in taste profile results */
export const TASTE_TOP_K = 15;

/** Max probes from any single category in the final top-K (diversity cap) */
export const TASTE_MAX_PER_CATEGORY = 3;

/** Negative centroid scaling factor for contrastive taste vector */
export const TASTE_NEG_ALPHA = 0.3;

/** Minimum negative labels to include contrastive signal */
export const TASTE_MIN_NEGATIVES = 3;
```

**Step 2: Add types to types.ts**

Append to `src/shared/types.ts`:

```typescript
/** A single probe result in the taste profile */
export interface TasteProbeResult {
  probe: string;
  score: number;
  category: string;
}

/** Response from COMPUTE_TASTE_PROFILE */
export interface TasteProfileResponse {
  state: "ready" | "insufficient_labels" | "error";
  message?: string;
  probes: TasteProbeResult[];
  labelCount: number;
  timestamp: number;
  cacheKey: string;
}
```

**Step 3: Create taste-probes.ts**

Create `src/shared/taste-probes.ts` with 3–5 probe phrases per category ID and a `PROBES_VERSION` constant for cache invalidation:

```typescript
/** Bump when probe phrases change to invalidate cached taste profiles. */
export const PROBES_VERSION = 1;

/**
 * Sub-topic probe phrases per category.
 * Used by the taste profile to map user preferences at sub-topic granularity.
 * Only probes for active (non-archived) categories are used at runtime.
 */
export const TASTE_PROBES: Record<string, string[]> = {
  "news": [
    "breaking news and current events",
    "investigative journalism and long-form reporting",
    "media industry trends and press freedom",
  ],
  "ai-research": [
    "transformer architectures and attention mechanisms",
    "LLM benchmarks and evaluation methods",
    "AI safety and alignment research",
    "open source machine learning models and frameworks",
    "neural network training techniques and optimization",
  ],
  "startups": [
    "startup fundraising and venture capital rounds",
    "Y Combinator companies and accelerator programs",
    "founder stories and startup lessons",
    "product-market fit and growth strategies",
  ],
  "deep-tech": [
    "semiconductor fabrication and chip design",
    "quantum computing research and applications",
    "robotics and autonomous systems",
    "advanced materials and nanotechnology",
  ],
  "science": [
    "physics discoveries and particle research",
    "biology and genetics breakthroughs",
    "astronomy and space science observations",
    "chemistry and materials science advances",
  ],
  "programming": [
    "programming languages and compiler design",
    "developer tools and IDE productivity",
    "software architecture and design patterns",
    "web frameworks and frontend development",
    "systems programming and performance optimization",
  ],
  "open-source": [
    "open source project launches and releases",
    "open source licensing and governance",
    "community-driven software development",
    "open source alternatives to commercial software",
  ],
  "security": [
    "cybersecurity vulnerabilities and exploits",
    "privacy regulations and data protection",
    "encryption and cryptographic protocols",
    "security tooling and penetration testing",
  ],
  "design": [
    "user interface design and visual aesthetics",
    "user experience research and usability testing",
    "design systems and component libraries",
    "accessibility and inclusive design practices",
  ],
  "product": [
    "SaaS business models and pricing strategies",
    "product management and roadmap planning",
    "user analytics and conversion optimization",
    "B2B enterprise software and sales",
  ],
  "finance": [
    "stock market analysis and trading strategies",
    "macroeconomics and central bank policy",
    "personal finance and investing advice",
    "fintech innovation and digital banking",
  ],
  "crypto": [
    "cryptocurrency market movements and trading",
    "blockchain protocol development and upgrades",
    "DeFi protocols and decentralized exchanges",
    "crypto regulation and legal frameworks",
  ],
  "politics": [
    "elections and political campaigns",
    "government policy and legislation debates",
    "international diplomacy and geopolitics",
    "political commentary and opinion analysis",
  ],
  "legal": [
    "tech regulation and antitrust enforcement",
    "intellectual property and patent disputes",
    "civil rights and constitutional law",
    "corporate governance and compliance",
  ],
  "climate": [
    "climate change research and data",
    "renewable energy technology and deployment",
    "carbon capture and emissions reduction",
    "environmental policy and sustainability",
  ],
  "space": [
    "space launches and rocket engineering",
    "satellite technology and orbital systems",
    "planetary exploration and Mars missions",
    "commercial space industry and space tourism",
  ],
  "health": [
    "drug development and clinical trials",
    "biotech startups and gene therapy",
    "public health and epidemiology",
    "mental health research and wellness",
  ],
  "education": [
    "online learning platforms and EdTech",
    "university research and academic publishing",
    "STEM education and coding bootcamps",
    "education policy and school reform",
  ],
  "gaming": [
    "video game releases and reviews",
    "game development and engine technology",
    "esports competitions and streaming",
    "indie games and game design craft",
  ],
  "sports": [
    "professional sports scores and highlights",
    "sports analytics and performance data",
    "athlete stories and career milestones",
    "sports business and team management",
  ],
  "music": [
    "album releases and music reviews",
    "music production and audio engineering",
    "live concerts and festival culture",
    "music industry business and streaming",
  ],
  "culture": [
    "film and television criticism",
    "literature and book recommendations",
    "visual arts exhibitions and galleries",
    "cultural commentary and social trends",
  ],
  "food": [
    "recipes and cooking techniques",
    "restaurant reviews and food culture",
    "food science and nutrition research",
    "food industry and agricultural technology",
  ],
  "travel": [
    "travel destinations and trip planning",
    "budget travel and backpacking tips",
    "travel technology and booking platforms",
    "cultural immersion and local experiences",
  ],
  "parenting": [
    "child development and parenting strategies",
    "family technology and screen time management",
    "education choices and homeschooling",
    "work-life balance for parents",
  ],
};
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no consumers yet, just new exports)

**Step 5: Commit**

```bash
git add src/shared/constants.ts src/shared/types.ts src/shared/taste-probes.ts
git commit -m "feat(taste): add types, constants, and probe phrases for taste profile"
```

---

### Task 2: Add background handler for COMPUTE_TASTE_PROFILE

**Files:**
- Modify: `src/background/background.ts` (imports, utility functions, computation function, message handler)

**Step 1: Add imports**

Add to the existing imports at the top of `src/background/background.ts`:

```typescript
import { TASTE_PROBES, PROBES_VERSION } from "../shared/taste-probes";
```

Add to existing `constants` import: `TASTE_MIN_LABELS`, `TASTE_TOP_K`, `TASTE_MAX_PER_CATEGORY`, `TASTE_NEG_ALPHA`, `TASTE_MIN_NEGATIVES`.

Add to existing `types` import: `TasteProbeResult`, `TasteProfileResponse`.

**Step 2: Add utility functions**

Add after `cosineSimilarity` (after line 321):

```typescript
/** L2-normalize a vector in place and return it. */
function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/** Normalize text for deduplication: lowercase + collapse whitespace. */
function normalizeTasteText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Simple djb2 hash for cache key construction. */
function djb2Hash(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
```

**Step 3: Add computeTasteProfile function**

Add after the utility functions:

```typescript
async function computeTasteProfile(): Promise<TasteProfileResponse> {
  if (!model || !tokenizer) {
    return {
      state: "error",
      message: "Model not loaded",
      probes: [],
      labelCount: 0,
      timestamp: Date.now(),
      cacheKey: "",
    };
  }

  // 1. Read and dedupe labels
  const labels = await readLabels();
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

  if (positives.length < TASTE_MIN_LABELS) {
    const need = TASTE_MIN_LABELS - positives.length;
    return {
      state: "insufficient_labels",
      message: `Label ${need} more item${need === 1 ? "" : "s"} to see your taste profile.`,
      probes: [],
      labelCount: positives.length,
      timestamp: Date.now(),
      cacheKey: "",
    };
  }

  // 2. Embed positive labels in batches, L2-normalize each
  const posEmbeddings: Float32Array[] = [];
  for (let i = 0; i < positives.length; i += SCORE_BATCH_SIZE) {
    const batch = positives.slice(i, i + SCORE_BATCH_SIZE);
    const embs = await embed(batch);
    for (const e of embs) posEmbeddings.push(l2Normalize(e));
  }

  // 3. Compute positive centroid
  const dim = posEmbeddings[0].length;
  const posCentroid = new Float32Array(dim);
  for (const emb of posEmbeddings) {
    for (let j = 0; j < dim; j++) posCentroid[j] += emb[j];
  }
  for (let j = 0; j < dim; j++) posCentroid[j] /= posEmbeddings.length;

  // 4. Contrastive: subtract scaled negative centroid if enough negatives
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

    // tasteVec = posCentroid - alpha * negCentroid
    for (let j = 0; j < dim; j++) {
      tasteVec[j] -= TASTE_NEG_ALPHA * negCentroid[j];
    }
  }

  // 5. L2-normalize the taste vector
  l2Normalize(tasteVec);

  // 6. Gather probes for active categories only
  const activeIds = new Set(Object.keys(currentCategoryMap ?? {}));
  const probeEntries: { probe: string; category: string }[] = [];
  for (const [catId, phrases] of Object.entries(TASTE_PROBES)) {
    if (!activeIds.has(catId)) continue;
    for (const phrase of phrases) {
      probeEntries.push({ probe: phrase, category: catId });
    }
  }

  // 7. Embed probes in batches, L2-normalize each
  const probeTexts = probeEntries.map((p) => p.probe);
  const probeEmbeddings: Float32Array[] = [];
  for (let i = 0; i < probeTexts.length; i += SCORE_BATCH_SIZE) {
    const batch = probeTexts.slice(i, i + SCORE_BATCH_SIZE);
    const embs = await embed(batch);
    for (const e of embs) probeEmbeddings.push(l2Normalize(e));
  }

  // 8. Score each probe against taste vector
  const scored: TasteProbeResult[] = probeEntries.map((entry, i) => ({
    probe: entry.probe,
    score: cosineSimilarity(probeEmbeddings[i], tasteVec),
    category: entry.category,
  }));

  // 9. Sort and apply diversity cap (max N per category)
  scored.sort((a, b) => b.score - a.score);
  const catCount: Record<string, number> = {};
  const diverseTop: TasteProbeResult[] = [];
  for (const s of scored) {
    const count = catCount[s.category] ?? 0;
    if (count >= TASTE_MAX_PER_CATEGORY) continue;
    catCount[s.category] = count + 1;
    diverseTop.push(s);
    if (diverseTop.length >= TASTE_TOP_K) break;
  }

  // 10. Build composite cache key
  const modelId = (await chrome.storage.local.get([
    STORAGE_KEYS.CUSTOM_MODEL_ID,
    STORAGE_KEYS.CUSTOM_MODEL_URL,
  ]));
  const modelKey = modelId[STORAGE_KEYS.CUSTOM_MODEL_URL]
    || modelId[STORAGE_KEYS.CUSTOM_MODEL_ID]
    || "default";
  const sortedPos = [...positives].sort().join("|");
  const sortedNeg = [...negatives].sort().join("|");
  const sortedCats = [...activeIds].sort().join(",");
  const cacheKey = djb2Hash(
    `${sortedPos}\0${sortedNeg}\0${sortedCats}\0${modelKey}\0${PROBES_VERSION}`,
  );

  // 11. Cache and return
  const response: TasteProfileResponse = {
    state: "ready",
    probes: diverseTop,
    labelCount: positives.length,
    timestamp: Date.now(),
    cacheKey,
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.TASTE_PROFILE]: response });
  return response;
}
```

**Step 4: Add message handler case**

In the `chrome.runtime.onMessage.addListener` switch block, add before `case MSG.MODEL_STATUS` (before line 956):

```typescript
      case MSG.COMPUTE_TASTE_PROFILE: {
        computeTasteProfile()
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({
            state: "error",
            message: String(err),
            probes: [],
            labelCount: 0,
            timestamp: Date.now(),
            cacheKey: "",
          } as TasteProfileResponse));
        return true;
      }
```

**Step 5: Run typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: Both PASS

**Step 6: Commit**

```bash
git add src/background/background.ts
git commit -m "feat(taste): add contrastive COMPUTE_TASTE_PROFILE handler with L2-norm, diversity cap, composite cache key"
```

---

### Task 3: Add popup HTML and CSS for taste profile fold

**Files:**
- Modify: `public/popup.html:98-100` (between categories fold and training data fold)
- Modify: `public/popup.css` (append taste profile styles)

**Step 1: Add fold HTML**

In `public/popup.html`, insert between the closing `</details>` of `fold-categories` (line 98) and the opening `<details class="fold fold-data">` (line 100):

```html
    <details class="fold fold-taste">
      <summary>My Taste Profile <span id="taste-badge" class="fold-badge"></span></summary>
      <div class="fold-content">
        <div id="taste-empty" class="taste-empty">Label at least 10 items to see your taste profile.</div>
        <div id="taste-results" style="display:none">
          <div id="taste-bars" class="taste-bars"></div>
          <div class="taste-footer">
            <span id="taste-meta" class="taste-meta"></span>
            <button id="taste-refresh" class="btn-sm">Refresh</button>
          </div>
        </div>
        <div id="taste-computing" class="taste-computing" style="display:none">Computing taste profile...</div>
      </div>
    </details>
```

**Step 2: Add CSS styles**

Append to `public/popup.css`:

```css
/* ── Taste Profile ── */
.fold-taste .fold-content {
  padding-top: 10px;
}

.taste-empty,
.taste-computing {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 8px 0;
}

.taste-computing {
  animation: taste-pulse 1.5s ease-in-out infinite;
}

@keyframes taste-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.taste-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.taste-bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
}

.taste-bar-label {
  flex: 0 0 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 10px;
}

.taste-bar-track {
  flex: 1;
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  overflow: hidden;
}

.taste-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.taste-bar-score {
  flex: 0 0 30px;
  text-align: right;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.taste-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.taste-meta {
  font-size: 10px;
  color: var(--text-dim);
}

.btn-sm {
  font-size: 10px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn-sm:hover {
  background: var(--surface-2);
  border-color: var(--border-hover);
}
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add public/popup.html public/popup.css
git commit -m "feat(taste): add popup fold HTML and bar chart CSS"
```

---

### Task 4: Wire up popup.ts — load cached, render, refresh with cache key staleness

**Files:**
- Modify: `src/popup/popup.ts` (add taste profile logic)

**Step 1: Add imports and DOM references**

Add to the existing `constants` import: `TASTE_MIN_LABELS`.

Add to the existing `types` import: `TasteProfileResponse`.

Add to the existing `scoring-utils` import: `scoreToHue` (if not already imported).

Add imports for cache key computation:

```typescript
import { PROBES_VERSION } from "../../shared/taste-probes";
```

Add DOM element references alongside other element refs:

```typescript
const tasteEmpty = document.getElementById("taste-empty") as HTMLDivElement;
const tasteResults = document.getElementById("taste-results") as HTMLDivElement;
const tasteBars = document.getElementById("taste-bars") as HTMLDivElement;
const tasteMeta = document.getElementById("taste-meta") as HTMLSpanElement;
const tasteRefresh = document.getElementById("taste-refresh") as HTMLButtonElement;
const tasteBadge = document.getElementById("taste-badge") as HTMLSpanElement;
const tasteComputing = document.getElementById("taste-computing") as HTMLDivElement;
```

**Step 2: Add cache key computation for staleness detection**

```typescript
/** djb2 hash for lightweight cache key comparison. */
function djb2Hash(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Compute the expected cache key from current label + category + model state. */
async function computeTasteCacheKey(labels: TrainingLabel[]): Promise<string> {
  const seen = new Set<string>();
  const positives: string[] = [];
  const negatives: string[] = [];
  for (const l of labels) {
    const norm = l.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (l.label === "positive") positives.push(l.text);
    else negatives.push(l.text);
  }
  const sortedPos = [...positives].sort().join("|");
  const sortedNeg = [...negatives].sort().join("|");

  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACTIVE_CATEGORY_IDS,
    STORAGE_KEYS.CUSTOM_MODEL_ID,
    STORAGE_KEYS.CUSTOM_MODEL_URL,
  ]);
  const catIds = ((stored[STORAGE_KEYS.ACTIVE_CATEGORY_IDS] as string[]) ?? []).sort().join(",");
  const modelKey = stored[STORAGE_KEYS.CUSTOM_MODEL_URL]
    || stored[STORAGE_KEYS.CUSTOM_MODEL_ID]
    || "default";

  return djb2Hash(`${sortedPos}\0${sortedNeg}\0${catIds}\0${modelKey}\0${PROBES_VERSION}`);
}
```

**Step 3: Add render function**

Use safe DOM methods (no innerHTML):

```typescript
function renderTasteProfile(data: TasteProfileResponse): void {
  if (data.state === "insufficient_labels" || data.state === "error") {
    tasteEmpty.textContent = data.message || "Unable to compute taste profile.";
    tasteEmpty.style.display = "";
    tasteResults.style.display = "none";
    tasteComputing.style.display = "none";
    tasteBadge.textContent = "";
    return;
  }

  if (!data.probes || data.probes.length === 0) {
    tasteEmpty.textContent = "No taste profile available.";
    tasteEmpty.style.display = "";
    tasteResults.style.display = "none";
    tasteComputing.style.display = "none";
    tasteBadge.textContent = "";
    return;
  }

  tasteEmpty.style.display = "none";
  tasteComputing.style.display = "none";
  tasteResults.style.display = "";

  // Find score range for relative bar widths
  const maxScore = data.probes[0].score;
  const minScore = data.probes[data.probes.length - 1].score;
  const range = maxScore - minScore || 1;

  tasteBars.replaceChildren();

  for (const p of data.probes) {
    const row = document.createElement("div");
    row.className = "taste-bar-row";

    const label = document.createElement("span");
    label.className = "taste-bar-label";
    label.textContent = p.probe;
    label.title = `${categoryMap[p.category]?.label ?? p.category}: ${p.probe}`;

    const track = document.createElement("div");
    track.className = "taste-bar-track";

    const fill = document.createElement("div");
    fill.className = "taste-bar-fill";
    const pct = Math.max(8, ((p.score - minScore) / range) * 100);
    fill.style.width = `${pct}%`;
    const hue = Math.round(scoreToHue(Math.max(0, Math.min(1, p.score))));
    fill.style.background = `hsl(${hue}, 65%, 55%)`;

    track.appendChild(fill);

    const score = document.createElement("span");
    score.className = "taste-bar-score";
    score.textContent = p.score.toFixed(2);

    row.append(label, track, score);
    tasteBars.appendChild(row);
  }

  tasteMeta.textContent = `Based on ${data.labelCount} labels`;
  tasteBadge.textContent = `${data.probes.length}`;
}
```

**Step 4: Add load-from-cache and refresh logic**

```typescript
async function loadCachedTasteProfile(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.TASTE_PROFILE);
    const cached = stored[STORAGE_KEYS.TASTE_PROFILE] as TasteProfileResponse | undefined;
    if (cached && cached.state === "ready" && cached.probes.length > 0) {
      renderTasteProfile(cached);
    }
  } catch { /* no cached profile */ }
}

async function refreshTasteProfile(): Promise<void> {
  tasteEmpty.style.display = "none";
  tasteResults.style.display = "none";
  tasteComputing.style.display = "";
  tasteRefresh.disabled = true;

  try {
    const response: TasteProfileResponse = await chrome.runtime.sendMessage({
      type: MSG.COMPUTE_TASTE_PROFILE,
    });
    renderTasteProfile(response);
  } catch {
    tasteComputing.style.display = "none";
    tasteEmpty.style.display = "";
    tasteEmpty.textContent = "Failed to compute taste profile.";
  } finally {
    tasteRefresh.disabled = false;
  }
}
```

**Step 5: Wire up event handlers in init()**

Add to the `init()` function in popup.ts:

```typescript
// Taste profile — load cached on open, refresh on click
void loadCachedTasteProfile();

tasteRefresh.addEventListener("click", () => {
  void refreshTasteProfile();
});

// Auto-compute on first fold open if no cached data
const tasteFold = document.querySelector(".fold-taste") as HTMLDetailsElement;
tasteFold.addEventListener("toggle", () => {
  if (tasteFold.open && tasteBars.children.length === 0 && tasteComputing.style.display === "none") {
    void refreshTasteProfile();
  }
});
```

**Step 6: Add stale badge detection using composite cache key**

In the existing `refreshLabelCounts()` function, after the line `lastLabelStats = stats;`, add:

```typescript
// Taste profile staleness — compare composite cache keys
try {
  const tasteStored = await chrome.storage.local.get(STORAGE_KEYS.TASTE_PROFILE);
  const cachedTaste = tasteStored[STORAGE_KEYS.TASTE_PROFILE] as TasteProfileResponse | undefined;
  if (cachedTaste?.cacheKey) {
    const currentKey = await computeTasteCacheKey(labels);
    if (currentKey !== cachedTaste.cacheKey) {
      tasteBadge.textContent = "stale";
    }
  }
} catch { /* non-critical */ }
```

**Step 7: Run typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: Both PASS

**Step 8: Commit**

```bash
git add src/popup/popup.ts
git commit -m "feat(taste): wire up popup with cache key staleness, contrastive-aware rendering"
```

---

### Task 5: Manual verification and final commit

**Step 1: Load extension and verify**

1. Open `chrome://extensions`, reload the unpacked extension from `dist/`
2. Open popup — verify "My Taste Profile" fold appears between Categories and Training Data
3. With <10 positive labels: fold shows "Label N more items to see your taste profile."
4. With >=10 positive labels: open the fold — auto-computes, shows spinner, then renders bars
5. Click "Refresh" — recomputes and updates bars
6. Close and reopen popup — cached result loads instantly
7. Add a new label, reopen popup — badge shows "stale"
8. Change active categories, reopen popup — badge shows "stale"
9. Verify no single category dominates the top 15 (diversity cap working)

**Step 2: Verify contrastive behavior**

- With only positive labels: profile reflects positive preferences
- After adding some negative labels (>= 3): refresh should shift results away from disliked topics
- E.g., if user thumbs-down crypto posts, crypto-related probes should score lower after refresh

**Step 3: Verify bar rendering**

- Bars color-coded (blue to amber spectrum via `scoreToHue`)
- Highest-scoring probe gets widest bar
- Lowest-scoring probe gets ~8% minimum-width bar
- Score values right-aligned in monospace
- Probe text truncated with ellipsis if too long
- Hovering a probe label shows full text + parent category

**Step 4: Run final build**

Run: `npm run build`
Expected: PASS — all 5 builds clean

**Step 5: Commit all remaining changes (if any unstaged fixes)**

```bash
git add -A
git commit -m "feat(taste): taste profile feature complete"
```
