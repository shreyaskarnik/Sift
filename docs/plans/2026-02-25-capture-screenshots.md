# Capture Screenshots Script — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `scripts/capture-screenshots.mjs` that loads the Sift extension in Playwright, mocks state, and captures composite screenshots (HN + side panel) for `generate-video.mjs`.

**Architecture:** Load unpacked extension via `--load-extension`, pre-populate `chrome.storage.local` with mock data, render side panel at `chrome-extension://ID/side-panel.html`, screenshot the composite of HN + side panel via an HTML stitching template. No model inference needed.

**Tech Stack:** Node.js (ESM), Playwright (`chromium.launchPersistentContext`), Chrome extension APIs.

---

## Context

### How the side panel initializes

`side-panel.ts:init()` (line 1094) does:
1. Reads settings from `chrome.storage.local` — categories, sensitivity, site toggles, top-K pills
2. Calls `buildCategoryGrid()` — reads `CATEGORY_MAP` and `ACTIVE_CATEGORY_IDS` from storage
3. Sends `GET_STATUS` to background → **will fail without model** (caught, shows "Extension starting...")
4. Sends `GET_LABELS` to background → **will fail** (caught, shows "Unable to load label data.")
5. Reads muted keywords from storage → `MUTED_KEYWORDS` is `string[]`
6. Reads taste profile from storage → renders radar chart if present

**Strategy:** Mock storage for items 1-2, 5-6. Patch DOM after load for items 3-4 (model status + label counts).

### Extension loading in Playwright

```javascript
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
// Get extension ID from service worker URL
const sw = await context.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];
```

### Storage keys (from `src/shared/constants.ts`)

| Key | Type | Value for mock |
|-----|------|----------------|
| `category_map` | `CategoryMap` | Built from `BUILTIN_CATEGORIES` |
| `active_category_ids` | `string[]` | All 25 IDs |
| `muted_keywords` | `string[]` | `[]` for side-panel.png, `["crypto", "bitcoin"]` for muted-keywords.png |
| `taste_profile` | `TasteProfileResponse` | Realistic radar data |
| `onboarding_dismissed` | `boolean` | `true` |
| `score_sensitivity` | `number` | `50` |
| `site_enabled` | `object` | `{ hn: true, reddit: true, x: true }` |
| `page_scoring_enabled` | `boolean` | `true` |
| `top_k_pills` | `number` | `2` |

---

## Task 1: Script skeleton with CLI args and extension build

**Files:**
- Create: `scripts/capture-screenshots.mjs`

**Changes:**

Create the script with CLI arg parsing (same pattern as `generate-video.mjs`), and a `buildExtension()` function that runs `npm run build` in `chrome-extension/`.

```javascript
#!/usr/bin/env node
/**
 * capture-screenshots.mjs — Capture side panel screenshots for generate-video.mjs.
 *
 * Loads the Sift extension in Chromium, mocks state via chrome.storage.local,
 * and captures composite screenshots (site + side panel).
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs [options]
 *
 * Options:
 *   --out-dir <path>     Output directory (default: docs/assets/video-screenshots/)
 *   --width <n>          Total width (default: 1280)
 *   --height <n>         Total height (default: 800)
 *   --panel-width <n>    Side panel width (default: 380)
 *   --scale <n>          Device scale factor (default: 2)
 *   --skip-build         Skip extension build step
 *
 * Requires: playwright (Chromium).
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const EXT_DIR = join(ROOT, "chrome-extension");
const DIST_DIR = join(EXT_DIR, "dist");
const SCREENSHOTS_DIR = join(ROOT, "docs", "assets", "video-screenshots");

// ─── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const OUT_DIR = getArg("out-dir", SCREENSHOTS_DIR);
const WIDTH = Number(getArg("width", "1280"));
const HEIGHT = Number(getArg("height", "800"));
const PANEL_WIDTH = Number(getArg("panel-width", "380"));
const SCALE = Number(getArg("scale", "2"));
const SKIP_BUILD = hasFlag("skip-build");

// ─── Build extension ────────────────────────────────────────────────────────
function buildExtension() {
  console.log("🔨 Building extension...");
  execFileSync("npm", ["run", "build"], { cwd: EXT_DIR, stdio: "inherit" });
  console.log("   ✅ Build complete\n");
}

async function main() {
  console.log("📸 Sift Screenshot Capture");
  console.log(`   Output:  ${OUT_DIR}`);
  console.log(`   Size:    ${WIDTH}x${HEIGHT} @${SCALE}x (panel: ${PANEL_WIDTH}px)`);
  console.log();

  if (!SKIP_BUILD) buildExtension();

  if (!existsSync(DIST_DIR)) {
    console.error("❌ Extension not built. Run: cd chrome-extension && npm run build");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // TODO: Tasks 2-6 go here

  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

**Verify:** `node scripts/capture-screenshots.mjs --skip-build` should print the header and "Done!".

**Commit:** `feat: scaffold capture-screenshots.mjs with CLI args`

---

## Task 2: Launch Chromium with extension and detect extension ID

**Files:**
- Modify: `scripts/capture-screenshots.mjs`

**Changes:**

Add `launchBrowser()` function inside `main()`. Uses `chromium.launchPersistentContext` with `--load-extension`. Detects extension ID from the service worker URL.

Replace the `// TODO: Tasks 2-6 go here` with:

```javascript
  // ─── Launch browser with extension ──────────────────────────────────────
  const userDataDir = join(ROOT, ".screenshot-chrome-profile");
  if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true });

  console.log("🚀 Launching Chromium with extension...");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--no-first-run",
      "--disable-default-apps",
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
    ],
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
  });

  // Detect extension ID from background service worker
  let extId;
  const sw = context.serviceWorkers()[0]
    || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const swUrl = sw.url();
  extId = swUrl.split("/")[2];
  console.log(`   Extension ID: ${extId}`);

  const page = await context.newPage();

  // TODO: Tasks 3-6 go here

  // ─── Cleanup ────────────────────────────────────────────────────────────
  await page.close();
  await context.close();
  if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
```

**Verify:** `node scripts/capture-screenshots.mjs --skip-build` should print the extension ID and exit cleanly. The extension must be pre-built (`cd chrome-extension && npm run build`).

**Commit:** `feat: launch chromium with extension, detect ID`

---

## Task 3: Define mock state and inject into extension storage

**Files:**
- Modify: `scripts/capture-screenshots.mjs`

**Changes:**

Add `MOCK_STATE` constant and `injectMockState(page, extId)` function. The function navigates to `chrome-extension://ID/side-panel.html`, sets storage via `page.evaluate()`, then returns.

Add this **above** `main()`:

```javascript
// ─── Mock state ─────────────────────────────────────────────────────────────
// Mirrors BUILTIN_CATEGORIES from src/shared/constants.ts
const BUILTIN_CATEGORIES = [
  { id: "news",         anchorText: "MY_FAVORITE_NEWS",       label: "News",               builtin: true },
  { id: "ai-research",  anchorText: "AI_RESEARCH",            label: "AI Research",         builtin: true, group: "tech" },
  { id: "startups",     anchorText: "STARTUP_NEWS",           label: "Startups",            builtin: true, group: "tech" },
  { id: "deep-tech",    anchorText: "DEEP_TECH",              label: "Deep Tech",           builtin: true, group: "tech" },
  { id: "science",      anchorText: "SCIENCE_DISCOVERIES",    label: "Science",             builtin: true, group: "tech" },
  { id: "programming",  anchorText: "PROGRAMMING_DEV_TOOLS",  label: "Programming",         builtin: true, group: "tech" },
  { id: "open-source",  anchorText: "OPEN_SOURCE",            label: "Open Source",         builtin: true, group: "tech" },
  { id: "security",     anchorText: "SECURITY_PRIVACY",       label: "Security & Privacy",  builtin: true, group: "tech" },
  { id: "design",       anchorText: "DESIGN_UX",              label: "Design & UX",         builtin: true, group: "tech" },
  { id: "product",      anchorText: "PRODUCT_SAAS",           label: "Product & SaaS",      builtin: true, group: "tech" },
  { id: "finance",      anchorText: "FINANCE_MARKETS",        label: "Finance & Markets",   builtin: true, group: "world" },
  { id: "crypto",       anchorText: "CRYPTO_WEB3",            label: "Crypto & Web3",       builtin: true, group: "world" },
  { id: "politics",     anchorText: "POLITICS",               label: "Politics",            builtin: true, group: "world" },
  { id: "legal",        anchorText: "LEGAL_POLICY",           label: "Legal & Policy",      builtin: true, group: "world" },
  { id: "climate",      anchorText: "CLIMATE_ENERGY",         label: "Climate & Energy",    builtin: true, group: "world" },
  { id: "space",        anchorText: "SPACE_AEROSPACE",        label: "Space & Aerospace",   builtin: true, group: "world" },
  { id: "health",       anchorText: "HEALTH_BIOTECH",         label: "Health & Biotech",    builtin: true, group: "lifestyle" },
  { id: "education",    anchorText: "EDUCATION",              label: "Education",           builtin: true, group: "lifestyle" },
  { id: "gaming",       anchorText: "GAMING",                 label: "Gaming",              builtin: true, group: "lifestyle" },
  { id: "sports",       anchorText: "SPORTS",                 label: "Sports",              builtin: true, group: "lifestyle" },
  { id: "music",        anchorText: "MUSIC",                  label: "Music",               builtin: true, group: "lifestyle" },
  { id: "culture",      anchorText: "CULTURE_ARTS",           label: "Culture & Arts",      builtin: true, group: "lifestyle" },
  { id: "food",         anchorText: "FOOD_COOKING",           label: "Food & Cooking",      builtin: true, group: "lifestyle" },
  { id: "travel",       anchorText: "TRAVEL",                 label: "Travel",              builtin: true, group: "lifestyle" },
  { id: "parenting",    anchorText: "PARENTING",              label: "Parenting",           builtin: true, group: "lifestyle" },
];

function buildCategoryMap() {
  const map = {};
  for (const cat of BUILTIN_CATEGORIES) {
    map[cat.id] = { label: cat.label, anchorText: cat.anchorText };
  }
  return map;
}

function buildMockState({ mutedKeywords = [] } = {}) {
  return {
    category_map: buildCategoryMap(),
    active_category_ids: BUILTIN_CATEGORIES.map((c) => c.id),
    muted_keywords: mutedKeywords,
    onboarding_dismissed: true,
    score_sensitivity: 50,
    site_enabled: { hn: true, reddit: true, x: true },
    page_scoring_enabled: true,
    top_k_pills: 2,
  };
}
```

And add this helper function:

```javascript
async function injectMockState(page, extId, mockState) {
  // Navigate to extension page to get access to chrome.storage
  await page.goto(`chrome-extension://${extId}/side-panel.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10000,
  });
  // Inject mock state into storage
  await page.evaluate(async (state) => {
    await chrome.storage.local.set(state);
  }, mockState);
  // Reload to pick up the mock state
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
}
```

Replace `// TODO: Tasks 3-6 go here` with:

```javascript
  // ─── Inject mock state ──────────────────────────────────────────────────
  console.log("💉 Injecting mock state...");
  const baseMock = buildMockState();
  await injectMockState(page, extId, baseMock);
  console.log("   ✅ Mock state injected\n");

  // TODO: Tasks 4-6 go here
```

**Verify:** Run the script. Side panel should load at `chrome-extension://ID/side-panel.html` with all 25 categories visible. The model status will say "Extension starting..." (expected — no model loaded).

**Commit:** `feat: define mock state and inject into extension storage`

---

## Task 4: Patch DOM for model status and label counts, capture side panel

**Files:**
- Modify: `scripts/capture-screenshots.mjs`

**Changes:**

After mock state injection, patch the DOM to show realistic model status and label counts. Then screenshot the side panel at `PANEL_WIDTH x HEIGHT`.

Add this helper function:

```javascript
async function patchSidePanelDOM(page) {
  await page.evaluate(() => {
    // Model status → "Ready — WEBGPU"
    const statusDot = document.getElementById("status-dot");
    if (statusDot) statusDot.className = "status-dot ready";
    const statusLabel = document.getElementById("status-label");
    if (statusLabel) statusLabel.textContent = "WEBGPU";
    const modelStatus = document.getElementById("model-status");
    if (modelStatus) modelStatus.textContent = "Ready \u2014 WEBGPU";
    const progressBar = document.getElementById("progress-bar-container");
    if (progressBar) progressBar.style.display = "none";

    // Model ID
    const modelIdEl = document.getElementById("model-id");
    if (modelIdEl) modelIdEl.textContent = "onnx-community/embeddinggemma-300m-ONNX";

    // Label counts — show realistic numbers
    const labelCounts = document.getElementById("label-counts");
    if (labelCounts) {
      labelCounts.textContent =
        "Total: 76 (52 positive, 24 negative)\nHN: 41 | Reddit: 22 | X: 13 | Import: 0";
    }
    const labelBadge = document.getElementById("label-count-badge");
    if (labelBadge) labelBadge.textContent = "76";
    const clearBtn = document.getElementById("clear-data-btn");
    if (clearBtn) clearBtn.textContent = "Clear 76 Labels";
  });
}
```

Replace `// TODO: Tasks 4-6 go here` with:

```javascript
  // ─── Capture side panel ─────────────────────────────────────────────────
  console.log("📷 Capturing side panel...");
  await patchSidePanelDOM(page);

  // Resize viewport to panel width for a clean side-panel-only capture
  await page.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
  await page.waitForTimeout(500);
  const panelScreenshot = join(OUT_DIR, "_side-panel-raw.png");
  await page.screenshot({ path: panelScreenshot, type: "png" });
  console.log(`   ✅ Side panel captured: ${panelScreenshot}`);

  // Restore full viewport
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });

  // TODO: Tasks 5-6 go here
```

**Verify:** Run the script. `_side-panel-raw.png` should show the side panel with all categories, "Ready — WEBGPU", and "76 labels" — all on a dark background.

**Commit:** `feat: patch DOM and capture side panel screenshot`

---

## Task 5: Capture HN background and composite into side-panel.png

**Files:**
- Modify: `scripts/capture-screenshots.mjs`

**Changes:**

Navigate to HN, screenshot it, then use an HTML template to composite the two screenshots side-by-side. The template renders in a new Playwright page.

Add this helper:

```javascript
function compositeHTML(leftImagePath, rightImagePath, totalWidth, totalHeight, panelWidth) {
  const leftData = readFileSync(leftImagePath).toString("base64");
  const rightData = readFileSync(rightImagePath).toString("base64");
  const siteWidth = totalWidth - panelWidth;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${totalWidth}px;
      height: ${totalHeight}px;
      display: flex;
      background: #0e0f11;
      overflow: hidden;
    }
    .site {
      width: ${siteWidth}px;
      height: ${totalHeight}px;
      overflow: hidden;
    }
    .site img {
      width: ${siteWidth}px;
      height: ${totalHeight}px;
      object-fit: cover;
      object-position: top left;
    }
    .divider {
      width: 1px;
      height: ${totalHeight}px;
      background: rgba(255, 255, 255, 0.08);
    }
    .panel {
      width: ${panelWidth - 1}px;
      height: ${totalHeight}px;
      overflow: hidden;
    }
    .panel img {
      width: ${panelWidth}px;
      height: ${totalHeight}px;
      object-fit: cover;
      object-position: top left;
    }
  </style>
</head>
<body>
  <div class="site"><img src="data:image/png;base64,${leftData}" /></div>
  <div class="divider"></div>
  <div class="panel"><img src="data:image/png;base64,${rightData}" /></div>
</body>
</html>`;
}
```

Add `readFileSync` to the existing `fs` import at the top of the file.

Replace `// TODO: Tasks 5-6 go here` with:

```javascript
  // ─── Capture HN background ─────────────────────────────────────────────
  console.log("📷 Capturing HN background...");
  await page.goto("https://news.ycombinator.com", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await page.waitForTimeout(2000);
  const hnScreenshot = join(OUT_DIR, "_hn-background.png");
  await page.screenshot({ path: hnScreenshot, type: "png" });
  console.log(`   ✅ HN background captured`);

  // ─── Composite: side-panel.png ──────────────────────────────────────────
  console.log("🧩 Compositing side-panel.png...");
  const compositeHtml = compositeHTML(
    hnScreenshot, panelScreenshot, WIDTH, HEIGHT, PANEL_WIDTH,
  );
  await page.setContent(compositeHtml, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const sidePanelOut = join(OUT_DIR, "side-panel.png");
  await page.screenshot({ path: sidePanelOut, type: "png" });
  console.log(`   ✅ ${sidePanelOut}\n`);

  // TODO: Task 6 goes here
```

**Verify:** `side-panel.png` should show HN on the left (~900px) and the side panel on the right (~380px) with a subtle divider.

**Commit:** `feat: capture HN background and composite side-panel.png`

---

## Task 6: Capture muted keywords variant

**Files:**
- Modify: `scripts/capture-screenshots.mjs`

**Changes:**

Re-inject mock state with muted keywords, re-capture the side panel, and composite again.

Replace `// TODO: Task 6 goes here` with:

```javascript
  // ─── Muted keywords variant ─────────────────────────────────────────────
  console.log("📷 Capturing muted keywords variant...");
  const mutedMock = buildMockState({ mutedKeywords: ["crypto", "bitcoin"] });
  await injectMockState(page, extId, mutedMock);
  await patchSidePanelDOM(page);

  // Capture side panel with muted keywords
  await page.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
  await page.waitForTimeout(500);
  const mutedPanelScreenshot = join(OUT_DIR, "_side-panel-muted-raw.png");
  await page.screenshot({ path: mutedPanelScreenshot, type: "png" });

  // Restore viewport and composite
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const mutedCompositeHtml = compositeHTML(
    hnScreenshot, mutedPanelScreenshot, WIDTH, HEIGHT, PANEL_WIDTH,
  );
  await page.setContent(mutedCompositeHtml, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const mutedOut = join(OUT_DIR, "muted-keywords.png");
  await page.screenshot({ path: mutedOut, type: "png" });
  console.log(`   ✅ ${mutedOut}\n`);
```

**Verify:** `muted-keywords.png` should show the same composite but with "crypto, bitcoin" visible in the muted keywords textarea, and the muted count badge showing "2".

**Commit:** `feat: add muted keywords screenshot variant`

---

## Task 7: Clean up temp files and add .gitignore entries

**Files:**
- Modify: `scripts/capture-screenshots.mjs`
- Modify: `.gitignore` (if it exists)

**Changes:**

After the composites are done (before browser cleanup), remove the intermediate `_*-raw.png` and `_*-background.png` files:

```javascript
  // ─── Cleanup intermediate files ─────────────────────────────────────────
  for (const tmp of [panelScreenshot, hnScreenshot, mutedPanelScreenshot]) {
    if (existsSync(tmp)) rmSync(tmp);
  }
```

Add to `.gitignore` (if not already present):
```
.screenshot-chrome-profile/
```

**Verify:** After running, only `side-panel.png` and `muted-keywords.png` remain in the output dir (no `_*` temp files). The Chrome profile directory is cleaned up.

**Commit:** `chore: clean up temp files, add gitignore for chrome profile`

---

## Task 8: End-to-end verification

**Steps:**

1. Build extension: `cd chrome-extension && npm run build`
2. Run: `node scripts/capture-screenshots.mjs`
3. Verify output files:
   - `docs/assets/video-screenshots/side-panel.png` — HN + side panel, 25 categories, "Ready — WEBGPU"
   - `docs/assets/video-screenshots/muted-keywords.png` — same but with "crypto, bitcoin" in muted keywords
4. Run video generator to make sure it picks up the new screenshots:
   `node scripts/generate-video.mjs` (may still skip some missing screenshots — that's fine)
5. No intermediate temp files left behind
6. Chrome profile directory cleaned up

**Commit:** No commit — verification only.

---

## Verification Checklist

- [ ] `node scripts/capture-screenshots.mjs --skip-build` runs without errors
- [ ] Extension ID detected and printed
- [ ] Side panel shows all 25 categories, "Ready — WEBGPU", 76 labels
- [ ] `side-panel.png` is a composite of HN + side panel
- [ ] `muted-keywords.png` shows "crypto, bitcoin" in muted keywords textarea
- [ ] No temp files (`_*.png`) left behind
- [ ] Chrome profile cleaned up
- [ ] `generate-video.mjs` can consume the output screenshots
