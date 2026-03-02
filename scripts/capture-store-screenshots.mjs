#!/usr/bin/env node
/**
 * capture-store-screenshots.mjs — Capture Chrome Web Store screenshots at 1280x800.
 *
 * Launches Chromium with the Sift extension loaded, navigates to supported sites,
 * and takes pixel-perfect 1280x800 screenshots suitable for the Chrome Web Store.
 *
 * Usage:
 *   node scripts/capture-store-screenshots.mjs
 *
 * Prerequisites:
 *   - Built extension in chrome-extension/dist/
 *   - Playwright installed (npx playwright install chromium)
 *
 * Output: docs/assets/store-screenshots/
 */

import { chromium } from "playwright";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = join(ROOT, "chrome-extension", "dist");
const OUT_DIR = join(ROOT, "docs", "assets", "store-screenshots");

const WIDTH = 1280;
const HEIGHT = 800;

// Auto-detect Chromium from Playwright cache
function findChromium() {
  const home = process.env.HOME || "/root";
  const cacheDirs = [
    join(home, "Library/Caches/ms-playwright"),
    join(home, ".cache/ms-playwright"),
  ];
  for (const cacheDir of cacheDirs) {
    if (!existsSync(cacheDir)) continue;
    const dirs = readdirSync(cacheDir)
      .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
      .sort()
      .reverse();
    for (const d of dirs) {
      const candidates = [
        join(d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(d, "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(d, "chrome-linux64/chrome"),
        join(d, "chrome-linux/chrome"),
      ];
      for (const c of candidates) {
        const full = join(cacheDir, c);
        if (existsSync(full)) return full;
      }
    }
  }
  return null;
}

// Sites to capture
const SITES = [
  { name: "hn", url: "https://news.ycombinator.com/", wait: 8000, description: "Hacker News with scoring" },
  { name: "reddit", url: "https://www.reddit.com/r/LocalLLaMA/", wait: 10000, description: "Reddit with scoring" },
  { name: "x", url: "https://x.com/home", wait: 10000, description: "X with scoring" },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (!existsSync(DIST)) {
    console.error("Extension not built. Run: cd chrome-extension && npm run build");
    process.exit(1);
  }

  const chromiumPath = findChromium();
  console.log(`Chromium: ${chromiumPath || "default"}`);
  console.log(`Extension: ${DIST}`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Viewport: ${WIDTH}x${HEIGHT}\n`);

  const userDataDir = join(ROOT, ".screenshot-chrome-profile");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: [
      "--no-first-run",
      "--disable-default-apps",
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
    ],
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2, // retina for crisp screenshots
    colorScheme: "dark",
  });

  const page = await context.newPage();

  console.log("Waiting 15s for extension model to initialize...\n");
  await page.goto("https://news.ycombinator.com/");
  await page.waitForTimeout(15000);

  for (const site of SITES) {
    console.log(`Capturing: ${site.description}...`);
    await page.goto(site.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(site.wait);

    const outPath = join(OUT_DIR, `${site.name}-1280x800.png`);
    await page.screenshot({ path: outPath, type: "png" });
    console.log(`  Saved: ${outPath}`);
  }

  console.log("\nDone! Review screenshots in docs/assets/store-screenshots/");
  console.log("Press Ctrl+C to close browser, or interact manually to capture more.");

  // Keep browser open for manual interaction
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
