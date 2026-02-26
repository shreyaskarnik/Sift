#!/usr/bin/env node
/**
 * generate-video.mjs — Create a Sift demo video from title cards + screenshots.
 *
 * Title cards are rendered as HTML via Playwright. Site demos use pre-captured
 * screenshots from docs/assets/video-screenshots/. Compiles everything into MP4 + WebM.
 *
 * Usage:
 *   node scripts/generate-video.mjs [options]
 *
 * Options:
 *   --out <path>        Output video path (default: docs/assets/video-output/sift-demo.webm)
 *   --fps <n>           Frames per second (default: 1 — each frame = 1 second)
 *   --width <n>         Viewport width (default: 1280)
 *   --height <n>        Viewport height (default: 800)
 *   --hold <sec>        Seconds to hold screenshot frames (default: 3)
 *   --title-hold <sec>  Seconds to hold title cards (default: 4)
 *   --scale <n>         Device scale factor (default: 2 for retina)
 *
 * Screenshots directory: docs/assets/video-screenshots/
 *   Place your pre-captured PNGs there. The script resizes and centers them
 *   on a dark background to match video dimensions.
 *
 * Requires: playwright, ffmpeg.
 */

import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FRAMES_DIR = join(ROOT, "video-frames");
const SCREENSHOTS_DIR = join(ROOT, "docs", "assets", "video-screenshots");

// Find ffmpeg: prefer system install, fall back to Playwright-bundled
function findFfmpeg() {
  try {
    const result = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
    const sys = (result.stdout || "").trim();
    if (sys && existsSync(sys)) return sys;
  } catch {}
  const pw = join(
    process.env.HOME || "/root",
    ".cache/ms-playwright/ffmpeg-1011/ffmpeg-linux",
  );
  if (existsSync(pw)) return pw;
  return null;
}

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
      for (const sub of candidates) {
        const p = join(cacheDir, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

// ─── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const OUT = getArg("out", join(ROOT, "docs", "assets", "video-output", "sift-demo.webm"));
const FPS = Number(getArg("fps", "2"));
const WIDTH = Number(getArg("width", "1280"));
const HEIGHT = Number(getArg("height", "800"));
const SCALE = Number(getArg("scale", "2"));
const HOLD_SEC = Number(getArg("hold", "2.5"));
const TITLE_HOLD_SEC = Number(getArg("title-hold", "3"));

// Pixel dimensions for frames (retina)
const PX_W = WIDTH * SCALE;
const PX_H = HEIGHT * SCALE;

// ─── Frame tracking ─────────────────────────────────────────────────────────
let frameIndex = 0;

function framePath() {
  return join(FRAMES_DIR, `frame-${String(frameIndex).padStart(5, "0")}.png`);
}

function holdFrame(sourcePath, seconds) {
  const copies = Math.max(1, Math.round(seconds * FPS));
  for (let i = 1; i < copies; i++) {
    frameIndex++;
    execFileSync("cp", [sourcePath, framePath()]);
  }
}

// ─── Title card HTML ────────────────────────────────────────────────────────
const LOGO_PATH = join(ROOT, "docs", "assets", "logo.png");
const LOGO_DATA_URI = `data:image/png;base64,${readFileSync(LOGO_PATH).toString("base64")}`;

// All 25 built-in category labels for the word cloud
const CATEGORY_LABELS = [
  "News", "AI Research", "Startups", "Deep Tech", "Science",
  "Programming", "Open Source", "Security & Privacy", "Design & UX",
  "Product & SaaS", "Finance & Markets", "Crypto & Web3", "Politics",
  "Legal & Policy", "Climate & Energy", "Space & Aerospace",
  "Health & Biotech", "Education", "Gaming", "Sports", "Music",
  "Culture & Arts", "Food & Cooking", "Travel", "Parenting",
];

// Deterministic pseudo-random from seed (for reproducible layouts)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wordCloudHTML() {
  const rng = mulberry32(42);
  const spans = [];
  // Place each label with seeded random position, size, and opacity
  for (const label of CATEGORY_LABELS) {
    const x = 5 + rng() * 85;       // 5-90% from left
    const y = 5 + rng() * 85;       // 5-90% from top
    const size = 13 + rng() * 9;    // 13-22px
    const opacity = 0.04 + rng() * 0.06; // 0.04-0.10
    const rotate = (rng() - 0.5) * 12;   // -6 to +6 degrees
    spans.push(
      `<span style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;font-size:${size.toFixed(0)}px;opacity:${opacity.toFixed(2)};transform:rotate(${rotate.toFixed(1)}deg)">${label}</span>`
    );
  }
  return `<div class="word-cloud">${spans.join("\n    ")}</div>`;
}

function titleCardHTML(title, subtitle, { logo = false, poweredBy = false, wordCloud = false } = {}) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #0e0f11;
      color: #e4e5e7;
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
      position: relative;
    }
    .word-cloud {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 0;
    }
    .word-cloud span {
      position: absolute;
      color: #34d399;
      font-weight: 500;
      font-size: 13px;
      white-space: nowrap;
      padding: 2px 10px;
      border-radius: 10px;
      border: 1px solid rgba(52, 211, 153, 0.18);
      background: rgba(52, 211, 153, 0.06);
    }
    .logo {
      width: 80px;
      height: 80px;
      border-radius: 16px;
      margin-bottom: 24px;
      position: relative;
      z-index: 1;
    }
    .title {
      font-size: 48px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 16px;
      text-align: center;
      line-height: 1.2;
      position: relative;
      z-index: 1;
    }
    .subtitle {
      font-size: 22px;
      font-weight: 400;
      color: #7a7d85;
      text-align: center;
      max-width: 700px;
      line-height: 1.5;
      position: relative;
      z-index: 1;
    }
    .accent { color: #34d399; }
    .powered-by {
      margin-top: 32px;
      font-size: 14px;
      font-weight: 400;
      color: #4e5058;
      letter-spacing: 0.02em;
      position: relative;
      z-index: 1;
    }
    .powered-by a {
      color: #7a7d85;
      text-decoration: none;
    }
    .powered-by .sep {
      margin: 0 8px;
      color: #3a3c42;
    }
  </style>
</head>
<body>
  ${wordCloud ? wordCloudHTML() : ""}
  ${logo ? `<img class="logo" src="${LOGO_DATA_URI}" />` : ""}
  <div class="title">${title}</div>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ""}
  ${poweredBy ? `<div class="powered-by">Powered by <a>EmbeddingGemma</a><span class="sep">·</span><a>Transformers.js</a><span class="sep">·</span><a>WebGPU</a><span class="sep">·</span><a>Chrome Extensions</a></div>` : ""}
</body>
</html>`;
}

// ─── Screenshot display HTML ────────────────────────────────────────────────
// Renders a pre-captured screenshot centered on a dark background with
// optional annotation bar at the bottom.
function screenshotPageHTML(imagePath, annotation) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #0e0f11;
      overflow: hidden;
    }
    .img-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 0;
    }
    .img-container img {
      max-width: 100%;
      max-height: ${annotation ? HEIGHT - 48 : HEIGHT}px;
      object-fit: contain;
    }
    .annotation {
      width: 100%;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(14, 15, 17, 0.95);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-family: "DM Sans", sans-serif;
      color: #e4e5e7;
      font-size: 15px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="img-container">
    <img src="data:image/png;base64,${readFileSync(imagePath).toString("base64")}" />
  </div>
  ${annotation ? `<div class="annotation">${annotation}</div>` : ""}
</body>
</html>`;
}

// ─── Scene definitions ──────────────────────────────────────────────────────
/**
 * Scene types:
 * - "title"      → Render an HTML title card
 * - "screenshot" → Display a pre-captured screenshot from docs/assets/video-screenshots/
 * - "html"       → Render an HTML file from docs/assets/video-screenshots/ (e.g. diagrams)
 */
function buildScenes() {
  const ss = (file) => join(SCREENSHOTS_DIR, file);

  return [
    // ── Intro ──
    {
      type: "title",
      html: titleCardHTML(
        '<span class="accent">Sift</span>',
        "Score your feed with EmbeddingGemma v0.2 — side panel, smart caching, muted keywords.",
        { logo: true, poweredBy: true },
      ),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "html",
      file: ss("embedding-diagram-dark.html"),
      animationSec: 2.5,
      hold: HOLD_SEC,
    },
    {
      type: "title",
      html: titleCardHTML(
        "Hundreds of posts. Only a few matter to you.",
        '<span class="accent">Sift</span> finds them.',
      ),
      hold: TITLE_HOLD_SEC,
    },

    // ── Before / After ──
    {
      type: "screenshot",
      file: ss("hn-before.png"),
      annotation: "Hacker News — before Sift",
      hold: HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("hn-after.png"),
      annotation: "After — low-relevance dimmed, muted items hidden, scores + inspector visible",
      hold: HOLD_SEC + 1,
    },

    // ── Side Panel ──
    {
      type: "title",
      html: titleCardHTML(
        "The Side Panel",
        "Persistent dashboard — page score, 25 categories, muted keywords, taste profile.",
        { wordCloud: true },
      ),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("side-panel.png"),
      annotation: "Side panel — always open while you browse",
      hold: HOLD_SEC + 1,
    },

    // ── Works everywhere ──
    {
      type: "title",
      html: titleCardHTML(
        "Works Wherever You Read",
        "Same model, same categories — consistent scoring on any page.",
      ),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("reddit.png"),
      annotation: "Reddit",
      hold: HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("x.png"),
      annotation: "X",
      hold: HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("techcrunch.png"),
      annotation: "TechCrunch — page scored in the side panel",
      hold: HOLD_SEC,
    },

    // ── Muted Keywords ──
    {
      type: "title",
      html: titleCardHTML(
        "Muted Keywords",
        "Block the noise. Items matching your keywords fade to near-invisible — no model inference wasted.",
      ),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("muted-keywords.png"),
      annotation: 'Muted "crypto" — matching items at 8% opacity, zero compute spent',
      hold: HOLD_SEC + 1,
    },

    // ── Embedding Cache ──
    {
      type: "title",
      html: titleCardHTML(
        "Smart Caching",
        "Seen it before? Skip the model.<br>LRU cache for 2,000 embeddings — instant re-scores on tab switches and infinite scroll.",
      ),
      hold: TITLE_HOLD_SEC,
    },

    // ── Taste Profile ──
    {
      type: "title",
      html: titleCardHTML(
        "Taste Profile",
        "After labeling 10+ items, Sift builds a contrastive profile of your interests.",
      ),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("taste.png"),
      annotation: "Radar chart + ranked probes — your top interests by affinity",
      hold: HOLD_SEC + 1,
    },

    // ── Label Manager + Training Loop ──
    {
      type: "title",
      html: titleCardHTML(
        "Curate &amp; Train",
        "Label Manager for filtering, editing, and category reassignment.<br>Then fine-tune.",
      ),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "screenshot",
      file: ss("label-manager.png"),
      annotation: "Filter by category/polarity/source · inline edit · reassign categories",
      hold: HOLD_SEC + 1,
    },
    {
      type: "title",
      html: titleCardHTML(
        "The Training Loop",
        `<div style="text-align:left; max-width:600px; margin:0 auto;">
          <div style="margin:6px 0;">1. 👍👎 Label items as you browse</div>
          <div style="margin:6px 0;">2. 🗂️ Curate in the Label Manager</div>
          <div style="margin:6px 0;">3. 📤 Export as training CSV</div>
          <div style="margin:6px 0;">4. 🧪 Fine-tune in Colab or locally</div>
          <div style="margin:6px 0;">5. 🚀 Load fine-tuned model back into Sift</div>
        </div>`,
      ),
      hold: TITLE_HOLD_SEC + 1,
    },

    // ── Privacy ──
    {
      type: "title",
      html: titleCardHTML(
        "Privacy-First",
        "No backend. No API costs. Inference stays local.",
      ),
      hold: TITLE_HOLD_SEC,
    },

    // ── Outro ──
    {
      type: "title",
      html: titleCardHTML(
        '<span class="accent">Sift</span>',
        `Open source · Apache-2.0<br><br>
        <span style="font-family: JetBrains Mono, monospace; font-size: 16px; color: #4e5058;">
          github.com/shreyaskarnik/Sift
        </span>`,
        { logo: true },
      ),
      hold: TITLE_HOLD_SEC + 1,
    },
  ];
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("🎬 Sift Video Generator (screenshot mode)");
  console.log(`   Output:     ${OUT}`);
  console.log(`   Viewport:   ${WIDTH}x${HEIGHT} @${SCALE}x → ${PX_W}x${PX_H}`);
  console.log(`   FPS: ${FPS}, Hold: ${HOLD_SEC}s, Title hold: ${TITLE_HOLD_SEC}s`);
  console.log();

  // Validate ffmpeg
  const ffmpegBin = findFfmpeg();
  if (!ffmpegBin) {
    console.error(
      "❌ ffmpeg not found. Install: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)",
    );
    process.exit(1);
  }
  console.log(`   ffmpeg: ${ffmpegBin}`);

  // Validate screenshots directory
  if (!existsSync(SCREENSHOTS_DIR)) {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    console.log(`\n📁 Created ${SCREENSHOTS_DIR}/`);
    console.log("   Place your screenshots there and re-run. Expected files:");
    console.log("     hn-before.png       — Raw HN feed (no Sift)");
    console.log("     hn-after.png        — HN with scoring + dimming + inspector");
    console.log("     side-panel.png      — Side panel open alongside a feed");
    console.log("     muted-keywords.png  — HN with muted keywords at low opacity");
    console.log("     reddit.png          — Reddit with scoring + inspector");
    console.log("     x.png              — X/Twitter with scoring + inspector");
    console.log("     techcrunch.png      — TechCrunch article with side panel");
    console.log("     taste.png           — Taste Profile page with radar chart");
    console.log("     label-manager.png   — Label Manager page");
    process.exit(0);
  }

  const scenes = buildScenes();

  // Check which files exist
  const missingScreenshots = [];
  for (const scene of scenes) {
    if ((scene.type === "screenshot" || scene.type === "html") && !existsSync(scene.file)) {
      missingScreenshots.push(scene.file.replace(SCREENSHOTS_DIR + "/", ""));
    }
  }
  if (missingScreenshots.length > 0) {
    console.log(`\n⚠ Missing ${missingScreenshots.length} screenshot(s):`);
    for (const f of missingScreenshots) {
      console.log(`   - docs/assets/video-screenshots/${f}`);
    }
    console.log("   Missing screenshots will be skipped.\n");
  }

  // Prepare directories
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });

  // Launch lightweight Chromium for rendering title cards + screenshot display
  const chromiumPath = findChromium();
  if (chromiumPath) console.log(`   Chromium: ${chromiumPath}`);

  const userDataDir = join(ROOT, ".video-chrome-profile");
  if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true });

  console.log("\n🚀 Launching renderer...");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ["--no-first-run", "--disable-default-apps"],
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
  });

  const renderPage = await context.newPage();

  console.log("📹 Capturing scenes...\n");

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const label =
      scene.annotation ||
      (scene.file || "").split("/").pop() ||
      scene.type;
    console.log(`  [${i + 1}/${scenes.length}] ${scene.type}: ${label}`);

    switch (scene.type) {
      case "title": {
        await renderPage.setContent(scene.html, { waitUntil: "networkidle" });
        await renderPage.waitForTimeout(1500);
        const path = framePath();
        await renderPage.screenshot({ path, type: "png" });
        holdFrame(path, scene.hold || TITLE_HOLD_SEC);
        frameIndex++;
        break;
      }

      case "screenshot": {
        if (!existsSync(scene.file)) {
          console.log(`    ⏭ Skipped (file not found)`);
          break;
        }
        const html = screenshotPageHTML(scene.file, scene.annotation);
        await renderPage.setContent(html, { waitUntil: "load" });
        // Wait for image to load
        await renderPage.waitForTimeout(1000);
        const path = framePath();
        await renderPage.screenshot({ path, type: "png" });
        holdFrame(path, scene.hold || HOLD_SEC);
        frameIndex++;
        break;
      }

      case "html": {
        if (!existsSync(scene.file)) {
          console.log(`    ⏭ Skipped (file not found)`);
          break;
        }
        await renderPage.goto(`file://${scene.file}`, {
          waitUntil: "networkidle",
          timeout: 15000,
        });
        await renderPage.waitForTimeout(1500); // settle fonts + rAF
        // Capture multiple frames to show continuous animation (flowing arrows, pulsing glow)
        const holdMs = (scene.hold || HOLD_SEC) * 1000;
        const captureInterval = 500 / FPS; // one capture per video frame
        const numCaptures = Math.max(1, Math.round(holdMs / (1000 / FPS)));
        for (let c = 0; c < numCaptures; c++) {
          await renderPage.waitForTimeout(1000 / FPS);
          const p = framePath();
          await renderPage.screenshot({ path: p, type: "png" });
          if (c < numCaptures - 1) frameIndex++;
        }
        frameIndex++;
        break;
      }
    }
  }

  console.log(`\n📸 Captured ${frameIndex} frames total`);

  // Cleanup browser
  await renderPage.close();
  await context.close();
  if (existsSync(userDataDir))
    rmSync(userDataDir, { recursive: true, force: true });

  if (frameIndex === 0) {
    console.error("❌ No frames captured. Add screenshots and re-run.");
    process.exit(1);
  }

  // ─── Compile video with ffmpeg ──────────────────────────────────────────
  console.log("\n🎞️  Compiling video with ffmpeg...");

  const inputArgs = [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(FRAMES_DIR, "frame-%05d.png"),
  ];

  const outputs = [
    {
      path: OUT.replace(/\.\w+$/, ".mp4"),
      args: [
        ...inputArgs,
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
      ],
      label: "MP4 (H.264)",
    },
    {
      path: OUT,
      args: [
        ...inputArgs,
        "-c:v", "libvpx-vp9",
        "-b:v", "5M",
        "-pix_fmt", "yuv420p",
      ],
      label: "WebM (VP9)",
    },
  ];

  for (const output of outputs) {
    try {
      console.log(`\n   Encoding ${output.label}...`);
      execFileSync(ffmpegBin, [...output.args, output.path], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      console.log(`   ✅ ${output.path}`);
    } catch (err) {
      console.error(`   ❌ ${output.label} failed:`, err.message);
    }
  }

  const durationSec = frameIndex / FPS;
  console.log(`\n📊 Video stats:`);
  console.log(`   Frames: ${frameIndex}`);
  console.log(`   Duration: ${durationSec.toFixed(1)}s`);
  console.log(`   Formats: MP4 + WebM`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
