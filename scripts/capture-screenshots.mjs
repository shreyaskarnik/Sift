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
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
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

// ─── Mock state ─────────────────────────────────────────────────────────────
// Keep in sync with chrome-extension/src/shared/constants.ts BUILTIN_CATEGORIES
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
    taste_profile: {
      state: "ready",
      probes: [
        { probe: "Machine learning research", score: 0.84, category: "AI Research" },
        { probe: "Rust and systems programming", score: 0.78, category: "Programming" },
        { probe: "YC startup launches", score: 0.72, category: "Startups" },
        { probe: "Open source projects", score: 0.69, category: "Open Source" },
        { probe: "Browser APIs and web platform", score: 0.65, category: "Deep Tech" },
        { probe: "Indie game development", score: 0.61, category: "Gaming" },
        { probe: "Climate and renewables", score: 0.58, category: "Climate & Energy" },
        { probe: "Space launches and missions", score: 0.54, category: "Space & Aerospace" },
        { probe: "Privacy tools and encryption", score: 0.51, category: "Security & Privacy" },
        { probe: "Health and longevity research", score: 0.47, category: "Health & Biotech" },
      ],
      labelCount: 76,
      timestamp: Date.now(),
      cacheKey: "mock-screenshot",
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function injectMockState(page, extId, mockState) {
  await page.goto(`chrome-extension://${extId}/side-panel.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10000,
  });
  await page.evaluate(async (state) => {
    await chrome.storage.local.set(state);
  }, mockState);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
}

async function patchSidePanelDOM(page) {
  await page.evaluate(() => {
    const statusDot = document.getElementById("status-dot");
    if (statusDot) statusDot.className = "status-dot ready";
    const statusLabel = document.getElementById("status-label");
    if (statusLabel) statusLabel.textContent = "WEBGPU";
    const modelStatus = document.getElementById("model-status");
    if (modelStatus) modelStatus.textContent = "Ready \u2014 WEBGPU";
    const progressBar = document.getElementById("progress-bar-container");
    if (progressBar) progressBar.style.display = "none";
    const modelIdEl = document.getElementById("model-id-display");
    if (modelIdEl) modelIdEl.textContent = "onnx-community/embeddinggemma-300m-ONNX";
    const labelCounts = document.getElementById("label-counts");
    if (labelCounts) {
      labelCounts.textContent =
        "Total: 76 (52 positive, 24 negative)\nHN: 41 | Reddit: 22 | X: 13 | Import: 0";
    }
    const labelBadge = document.getElementById("label-count-badge");
    if (labelBadge) labelBadge.textContent = "76";
    const clearBtn = document.getElementById("clear-data");
    if (clearBtn) clearBtn.textContent = "Clear 76 Labels";
  });
}

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

// ─── Main ───────────────────────────────────────────────────────────────────
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
  const sw = context.serviceWorkers()[0]
    || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extId = sw.url().split("/")[2];
  console.log(`   Extension ID: ${extId}`);

  const page = await context.newPage();

  // ─── Inject mock state ──────────────────────────────────────────────────
  console.log("💉 Injecting mock state...");
  const baseMock = buildMockState();
  await injectMockState(page, extId, baseMock);
  console.log("   ✅ Mock state injected\n");

  // ─── Capture side panel ─────────────────────────────────────────────────
  console.log("📷 Capturing side panel...");
  await patchSidePanelDOM(page);

  await page.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
  await page.waitForTimeout(500);
  const panelScreenshot = join(OUT_DIR, "_side-panel-raw.png");
  await page.screenshot({ path: panelScreenshot, type: "png" });
  console.log(`   ✅ Side panel captured`);

  await page.setViewportSize({ width: WIDTH, height: HEIGHT });

  // ─── Capture HN background ─────────────────────────────────────────────
  console.log("📷 Capturing HN background...");
  const hnScreenshot = join(OUT_DIR, "_hn-background.png");
  try {
    await page.goto("https://news.ycombinator.com", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: hnScreenshot, type: "png" });
    console.log(`   ✅ HN background captured`);
  } catch (err) {
    console.log(`   ⚠ HN unreachable (${err.message}), using dark placeholder`);
    const placeholderHtml = `<html><body style="width:${WIDTH}px;height:${HEIGHT}px;background:#1a1b1d;margin:0;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:#666;font-size:14px;">news.ycombinator.com</body></html>`;
    await page.setContent(placeholderHtml, { waitUntil: "load" });
    await page.screenshot({ path: hnScreenshot, type: "png" });
  }

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

  // ─── Muted keywords variant ─────────────────────────────────────────────
  console.log("📷 Capturing muted keywords variant...");
  const mutedMock = buildMockState({ mutedKeywords: ["crypto", "bitcoin"] });
  await injectMockState(page, extId, mutedMock);
  await patchSidePanelDOM(page);

  await page.setViewportSize({ width: PANEL_WIDTH, height: HEIGHT });
  await page.waitForTimeout(500);
  const mutedPanelScreenshot = join(OUT_DIR, "_side-panel-muted-raw.png");
  await page.screenshot({ path: mutedPanelScreenshot, type: "png" });

  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const mutedCompositeHtml = compositeHTML(
    hnScreenshot, mutedPanelScreenshot, WIDTH, HEIGHT, PANEL_WIDTH,
  );
  await page.setContent(mutedCompositeHtml, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const mutedOut = join(OUT_DIR, "muted-keywords.png");
  await page.screenshot({ path: mutedOut, type: "png" });
  console.log(`   ✅ ${mutedOut}\n`);

  // ─── Cleanup intermediate files ─────────────────────────────────────────
  for (const tmp of [panelScreenshot, hnScreenshot, mutedPanelScreenshot]) {
    if (existsSync(tmp)) rmSync(tmp);
  }

  // ─── Cleanup browser ───────────────────────────────────────────────────
  await page.close();
  await context.close();
  if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });

  console.log("✅ Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
