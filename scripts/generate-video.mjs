#!/usr/bin/env node
/**
 * generate-video.mjs — Create a Sift demo video using Playwright + ffmpeg.
 *
 * Launches Chromium with the Sift extension loaded, walks through a scripted
 * demo, captures screenshots at each step, renders title-card frames as HTML,
 * and compiles everything into a WebM video via Playwright-bundled ffmpeg.
 *
 * Usage:
 *   node scripts/generate-video.mjs [options]
 *
 * Options:
 *   --mock         Use local mock pages instead of live sites (for offline testing)
 *   --out <path>   Output video path (default: video-output/sift-demo.webm)
 *   --fps <n>      Frames per second (default: 1 — each frame = 1 second)
 *   --width <n>    Viewport width (default: 1280)
 *   --height <n>   Viewport height (default: 800)
 *   --hold <sec>   Seconds to hold each screenshot frame (default: 3)
 *   --title-hold <sec>  Seconds to hold title cards (default: 4)
 *
 * Requires: playwright (globally or locally installed), Sift extension built.
 * On headless servers, xvfb-run is auto-detected and used to provide a virtual display.
 */

import { chromium } from "playwright";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, writeFileSync, rmSync, readFileSync, createReadStream } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

// ─── Auto-detect missing DISPLAY and re-exec under xvfb-run ────────────────
if (!process.env.DISPLAY && !process.env.__XVFB_WRAPPED) {
  try {
    execSync("which xvfb-run", { stdio: "ignore" });
    console.log("No DISPLAY detected — re-launching under xvfb-run...\n");
    const result = execSync(
      `xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" env __XVFB_WRAPPED=1 node ${process.argv.slice(1).map(a => JSON.stringify(a)).join(" ")}`,
      { stdio: "inherit", timeout: 600000 }
    );
    process.exit(0);
  } catch (err) {
    if (err.status) process.exit(err.status);
    console.warn("⚠ xvfb-run not found and no DISPLAY set. Headed browser may fail.");
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const EXT_DIR = join(ROOT, "chrome-extension", "dist");
const FRAMES_DIR = join(ROOT, "video-frames");
const FFMPEG = join(
  process.env.HOME || "/root",
  ".cache/ms-playwright/ffmpeg-1011/ffmpeg-linux"
);

// Auto-detect Chromium binary from Playwright cache
function findChromium() {
  const cacheDir = join(process.env.HOME || "/root", ".cache/ms-playwright");
  if (!existsSync(cacheDir)) return undefined;
  const dirs = readdirSync(cacheDir)
    .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
    .sort()
    .reverse(); // newest first
  for (const d of dirs) {
    // Try both naming conventions
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = join(cacheDir, d, sub);
      if (existsSync(p)) return p;
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
const MOCK = args.includes("--mock");
const OUT = getArg("out", join(ROOT, "video-output", "sift-demo.webm"));
const FPS = Number(getArg("fps", "1"));
const WIDTH = Number(getArg("width", "1280"));
const HEIGHT = Number(getArg("height", "800"));
const HOLD_SEC = Number(getArg("hold", "3"));
const TITLE_HOLD_SEC = Number(getArg("title-hold", "4"));

// ─── Frame tracking ─────────────────────────────────────────────────────────
let frameIndex = 0;

function framePath() {
  const name = `frame-${String(frameIndex).padStart(5, "0")}.png`;
  return join(FRAMES_DIR, name);
}

/** Duplicate a frame N times to simulate hold duration at the given FPS. */
function holdFrame(sourcePath, seconds) {
  const copies = Math.max(1, Math.round(seconds * FPS));
  // First frame is already the source
  for (let i = 1; i < copies; i++) {
    frameIndex++;
    const dest = framePath();
    execFileSync("cp", [sourcePath, dest]);
  }
}

// ─── Title card HTML (uses extension fonts) ─────────────────────────────────
function titleCardHTML(title, subtitle, extra = "") {
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
    }
    .title {
      font-size: 48px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 16px;
      text-align: center;
      line-height: 1.2;
    }
    .subtitle {
      font-size: 22px;
      font-weight: 400;
      color: #7a7d85;
      text-align: center;
      max-width: 700px;
      line-height: 1.5;
    }
    .accent { color: #34d399; }
    .mono {
      font-family: "JetBrains Mono", monospace;
      font-size: 18px;
      color: #4e5058;
      margin-top: 20px;
    }
    .badge {
      display: inline-block;
      padding: 4px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #34d399;
      border: 1px solid rgba(52, 211, 153, 0.3);
      background: rgba(52, 211, 153, 0.08);
      margin-bottom: 18px;
    }
    ${extra}
  </style>
</head>
<body>
  <div class="title">${title}</div>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ""}
</body>
</html>`;
}

function stepCardHTML(stepNum, total, heading, description) {
  return titleCardHTML(
    heading,
    description,
    `.step-badge {
      display: inline-block;
      padding: 4px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #34d399;
      border: 1px solid rgba(52, 211, 153, 0.3);
      background: rgba(52, 211, 153, 0.08);
      margin-bottom: 18px;
    }
    body::before {
      content: "Step ${stepNum} of ${total}";
      display: inline-block;
      padding: 4px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #34d399;
      border: 1px solid rgba(52, 211, 153, 0.3);
      background: rgba(52, 211, 153, 0.08);
      margin-bottom: 18px;
    }`
  );
}

// ─── Text overlay (bottom bar annotation) ───────────────────────────────────
function overlayHTML(text) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${WIDTH}px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(14, 15, 17, 0.92);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-family: "DM Sans", sans-serif;
      color: #e4e5e7;
      font-size: 16px;
      font-weight: 500;
    }
  </style>
</head>
<body>${text}</body>
</html>`;
}

// ─── Mock HN page ───────────────────────────────────────────────────────────
const MOCK_HN_STORIES = [
  "Show HN: I built an open-source alternative to Notion with local-first sync",
  "GPT-5 benchmarks leaked — matches human performance on ARC-AGI",
  "Why Rust is replacing C++ in embedded systems (2026)",
  "The mass extinction of SaaS startups has begun",
  "A visual guide to transformer attention mechanisms",
  "Bitcoin drops 15% as SEC announces new crypto regulations",
  "Scientists discover high-temperature superconductor at 23°C",
  "Launch HN: Rye — Python packaging that just works",
  "How we reduced our Kubernetes costs by 80%",
  "The return of static HTML — why SPAs are declining",
  "CERN announces unexpected results from antimatter experiments",
  "Firefox 140 ships with built-in local AI translation",
  "Ask HN: What is your mass-market cooking secret?",
  "Google announces TensorFlow 3.0 with on-device training",
  "The complete guide to fine-tuning LLMs on consumer GPUs",
  "PostgreSQL 18 — what's new and why it matters",
  "Apple Vision Pro 2 announced with 4K per eye micro-OLED",
  "Why I left my FAANG job to build a climate tech startup",
  "Open source EmbeddingGemma beats proprietary embedding models",
  "The art of debugging: lessons from 30 years of programming",
  "How Cloudflare handles 60M requests per second",
  "Your kid's school is probably using AI to grade homework now",
  "Show HN: Real-time collaborative text editor in 500 lines of Go",
  "NASA confirms Artemis IV crew for 2027 lunar mission",
  "The hidden cost of microservices nobody talks about",
  "What we learned building a RAG system for medical documents",
  "Music labels sue AI training companies for copyright infringement",
  "Taylor Swift announces AI-generated concert for fans who missed the tour",
  "Ask HN: Best resources for learning WebGPU?",
  "EU passes landmark AI Safety Act — what it means for developers",
];

function mockHNPage() {
  const rows = MOCK_HN_STORIES.map((title, i) => {
    const rank = i + 1;
    const domain = ["github.com", "arxiv.org", "blog.example.com", "medium.com", "reuters.com"][i % 5];
    const points = Math.floor(Math.random() * 500) + 20;
    const comments = Math.floor(Math.random() * 200) + 5;
    const hours = Math.floor(Math.random() * 12) + 1;
    return `
      <tr class="athing" id="${1000 + i}">
        <td align="right" valign="top" class="title"><span class="rank">${rank}.</span></td>
        <td valign="top" class="votelinks"><center><a id="up_${1000 + i}" href="#"><div class="votearrow" title="upvote"></div></a></center></td>
        <td class="title"><span class="titleline"><a href="https://${domain}/item-${i}">${title}</a><span class="sitebit comhead"> (<a href="from?site=${domain}"><span class="sitestr">${domain}</span></a>)</span></span></td>
      </tr>
      <tr><td colspan="2"></td><td class="subtext">
        <span class="score" id="score_${1000 + i}">${points} points</span> by user${i} <span class="age"><a href="#">${hours} hours ago</a></span> | <a href="#">${comments}&nbsp;comments</a>
      </td></tr>
      <tr class="spacer" style="height:5px"></tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Hacker News</title>
  <style>
    body { background: #f6f6ef; font-family: Verdana, Geneva, sans-serif; font-size: 10pt; }
    td { font-size: 10pt; }
    .rank { color: #828282; }
    .titleline > a { color: #000; text-decoration: none; font-size: 10pt; }
    .titleline > a:visited { color: #828282; }
    .comhead { color: #828282; font-size: 8pt; }
    .sitestr { color: #828282; }
    .subtext { color: #828282; font-size: 7pt; }
    .subtext a { color: #828282; text-decoration: none; }
    .score { color: #ff6600; }
    .votearrow { width: 10px; height: 10px; border: 0px; margin: 3px 2px 6px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Cpolygon points='0,8 5,0 10,8' fill='%23828282'/%3E%3C/svg%3E"); }
    #hnmain { background: #f6f6ef; width: 85%; }
    .pagetop { color: #222; font-weight: bold; font-size: 10pt; }
    .pagetop a { color: #000; text-decoration: none; }
    .hnname { margin-right: 4px; }
  </style>
</head>
<body>
  <center>
    <table id="hnmain" border="0" cellpadding="0" cellspacing="0" width="85%" bgcolor="#f6f6ef">
      <tr>
        <td bgcolor="#ff6600">
          <table border="0" cellpadding="0" cellspacing="0" style="padding: 2px;">
            <tr>
              <td style="width:18px;padding-right:4px">
                <a href="https://news.ycombinator.com"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Crect width='18' height='18' fill='%23fff' rx='2'/%3E%3Ctext x='4' y='14' font-family='Verdana' font-weight='bold' font-size='12' fill='%23ff6600'%3EY%3C/text%3E%3C/svg%3E" width="18" height="18" style="border:1px white solid; display:block"></a>
              </td>
              <td style="line-height:12pt; height:10px;">
                <span class="pagetop">
                  <b class="hnname"><a href="https://news.ycombinator.com">Hacker News</a></b>
                  <a href="#">new</a> | <a href="#">past</a> | <a href="#">comments</a> | <a href="#">ask</a> | <a href="#">show</a> | <a href="#">jobs</a> | <a href="#">submit</a>
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr style="height:10px"></tr>
      <tr>
        <td>
          <table border="0" cellpadding="0" cellspacing="0">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;
}

// ─── Scene definitions ──────────────────────────────────────────────────────

/**
 * Scene types:
 * - "title"    → Render an HTML title card
 * - "navigate" → Go to a URL, wait, screenshot
 * - "action"   → Run a custom async function on the page
 * - "popup"    → Open extension popup and screenshot
 */
function buildScenes(mockBaseURL) {
  const hnURL = MOCK ? `${mockBaseURL}/hn` : "https://news.ycombinator.com";
  const totalSteps = 8;

  return [
    // ── Intro ──
    {
      type: "title",
      html: titleCardHTML(
        '<span class="accent">Sift</span>',
        "Score your feed with EmbeddingGemma, right in the browser."
      ),
      hold: TITLE_HOLD_SEC + 1,
    },
    {
      type: "title",
      html: titleCardHTML(
        "Every morning I'd dig for the 3 things I care about.",
        'So I built <span class="accent">Sift</span>.'
      ),
      hold: TITLE_HOLD_SEC,
    },

    // ── Step 1: Show HN scoring ──
    {
      type: "title",
      html: stepCardHTML(1, totalSteps, "In-Browser Scoring", "EmbeddingGemma-300M (q4) runs entirely in your browser via WebGPU."),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "navigate",
      url: hnURL,
      waitFor: ".titleline",
      annotation: "Sift scores every Hacker News title against your active categories",
      hold: HOLD_SEC,
    },
    {
      type: "action",
      description: "Wait for Sift scoring to appear",
      fn: async (page) => {
        // Wait for Sift to process items (ss-scored class appears)
        try {
          await page.waitForSelector(".ss-scored", { timeout: 30000 });
          // Give it a moment more for opacity transitions
          await page.waitForTimeout(2000);
        } catch {
          console.log("  ⚠ Sift scoring did not appear (model may not have loaded)");
        }
      },
      annotation: "Low-relevance posts fade, high-relevance posts stay bright",
      hold: HOLD_SEC + 2,
    },

    // ── Step 2: Score inspector ──
    {
      type: "title",
      html: stepCardHTML(2, totalSteps, 'The "?" Inspector', "Deterministic score explanation — no LLM call required."),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "action",
      description: "Click explain button on first scored item",
      fn: async (page) => {
        try {
          const btn = await page.waitForSelector(".ss-explain-btn", { timeout: 10000 });
          if (btn) {
            await btn.click();
            await page.waitForSelector(".ss-explain-tip", { timeout: 5000 });
            await page.waitForTimeout(1500);
          }
        } catch {
          console.log("  ⚠ Could not click explain button");
        }
      },
      annotation: "Click \"?\" to see score band, category lenses, and rationale",
      hold: HOLD_SEC + 1,
    },

    // ── Step 3: Label items ──
    {
      type: "title",
      html: stepCardHTML(3, totalSteps, "Label As You Browse", "Thumbs up/down to collect training data."),
      hold: TITLE_HOLD_SEC,
    },
    {
      type: "action",
      description: "Hover and show label buttons, click thumbs up",
      fn: async (page) => {
        try {
          // Dismiss any open tooltip
          await page.click("body", { position: { x: 10, y: 10 } });
          await page.waitForTimeout(500);

          // Hover over first scored item to reveal vote buttons
          const scored = await page.$$(".ss-scored");
          if (scored.length > 0) {
            await scored[0].hover();
            await page.waitForTimeout(800);
            // Click thumbs up
            const thumbUp = await scored[0].$(".ss-vote-up");
            if (thumbUp) {
              await thumbUp.click();
              await page.waitForTimeout(600);
            }
          }
          // Also thumbs down on another item for variety
          if (scored.length > 2) {
            await scored[2].hover();
            await page.waitForTimeout(600);
            const thumbDown = await scored[2].$(".ss-vote-down");
            if (thumbDown) {
              await thumbDown.click();
              await page.waitForTimeout(600);
            }
          }
        } catch {
          console.log("  ⚠ Could not interact with label buttons");
        }
      },
      annotation: "Label items with 👍👎 — data stays local in the extension",
      hold: HOLD_SEC,
    },

    // ── Step 4: Category pills ──
    {
      type: "title",
      html: stepCardHTML(4, totalSteps, "25 Built-in Categories", "AI Research, Startups, Deep Tech, Open Source, and more."),
      hold: TITLE_HOLD_SEC,
    },

    // ── Step 5: Popup ──
    {
      type: "title",
      html: stepCardHTML(5, totalSteps, "Extension Popup", "Settings, categories, taste profile, and training data — all in one place."),
      hold: TITLE_HOLD_SEC,
    },

    // ── Step 6: Three sites ──
    {
      type: "title",
      html: stepCardHTML(6, totalSteps, "Three Sites, One Model", "Hacker News · Reddit · X<br>Same categories, same model, consistent scoring."),
      hold: TITLE_HOLD_SEC,
    },

    // ── Step 7: Training loop ──
    {
      type: "title",
      html: stepCardHTML(7, totalSteps, "The Training Loop",
        `<div style="text-align:left; max-width:600px; margin:0 auto;">
          <div style="margin:6px 0;">1. 👍👎 Label items as you browse</div>
          <div style="margin:6px 0;">2. 📤 Export labels as training CSV</div>
          <div style="margin:6px 0;">3. 🧪 Fine-tune in Colab or locally</div>
          <div style="margin:6px 0;">4. 🚀 Load fine-tuned model back into the extension</div>
        </div>
        <div style="margin-top:24px; font-family: JetBrains Mono, monospace; font-size: 14px; color: #4e5058;">
          e.g. shreyask/sift-finetuned on HuggingFace
        </div>`
      ),
      hold: TITLE_HOLD_SEC + 2,
    },

    // ── Step 8: Privacy ──
    {
      type: "title",
      html: stepCardHTML(8, totalSteps, "Privacy-First",
        "No backend. No data leaves your browser.<br>Inference + labels stay local."
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
        </span>`
      ),
      hold: TITLE_HOLD_SEC + 2,
    },
  ];
}

// ─── Mock server ────────────────────────────────────────────────────────────
function startMockServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === "/hn") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(mockHNPage());
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      console.log(`Mock server at http://127.0.0.1:${port}`);
      resolve({ server, baseURL: `http://127.0.0.1:${port}` });
    });
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("🎬 Sift Video Generator");
  console.log(`   Extension: ${EXT_DIR}`);
  console.log(`   Output: ${OUT}`);
  console.log(`   Viewport: ${WIDTH}x${HEIGHT}`);
  console.log(`   FPS: ${FPS}, Hold: ${HOLD_SEC}s, Title hold: ${TITLE_HOLD_SEC}s`);
  console.log(`   Mock mode: ${MOCK}`);
  console.log();

  // Validate extension is built
  if (!existsSync(join(EXT_DIR, "manifest.json"))) {
    console.error("❌ Extension not built. Run: cd chrome-extension && npm run build");
    process.exit(1);
  }

  // Validate ffmpeg
  if (!existsSync(FFMPEG)) {
    console.error("❌ ffmpeg not found at", FFMPEG);
    console.error("   Run: npx playwright install");
    process.exit(1);
  }

  // Prepare directories
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });

  // Start mock server if needed
  let mockServer = null;
  let mockBaseURL = "";
  if (MOCK) {
    const ms = await startMockServer();
    mockServer = ms.server;
    mockBaseURL = ms.baseURL;
  }

  const scenes = buildScenes(mockBaseURL);

  // Launch browser with extension
  // Using persistent context to load the extension properly
  const userDataDir = join(ROOT, ".video-chrome-profile");
  if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true });

  const chromiumPath = findChromium();
  if (chromiumPath) console.log(`   Chromium: ${chromiumPath}`);

  console.log("🚀 Launching browser with Sift extension...");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--no-first-run",
      "--disable-default-apps",
      "--disable-infobars",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
    ],
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2, // Retina screenshots
    colorScheme: "dark",
    ignoreDefaultArgs: ["--disable-extensions"],
  });

  // Helper page for rendering title cards (separate tab)
  const titlePage = await context.newPage();
  const mainPage = context.pages()[0] || await context.newPage();

  console.log("📹 Capturing scenes...\n");

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const label = scene.description || scene.annotation || scene.type;
    console.log(`  [${i + 1}/${scenes.length}] ${scene.type}: ${label}`);

    switch (scene.type) {
      case "title": {
        await titlePage.setContent(scene.html, { waitUntil: "networkidle" });
        // Allow fonts to load
        await titlePage.waitForTimeout(1500);
        const path = framePath();
        await titlePage.screenshot({ path, type: "png" });
        holdFrame(path, scene.hold || TITLE_HOLD_SEC);
        frameIndex++;
        break;
      }

      case "navigate": {
        await mainPage.goto(scene.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (scene.waitFor) {
          try {
            await mainPage.waitForSelector(scene.waitFor, { timeout: 15000 });
          } catch {
            console.log(`    ⚠ Selector ${scene.waitFor} not found`);
          }
        }
        await mainPage.waitForTimeout(1500);
        const path = framePath();
        await mainPage.screenshot({ path, type: "png" });
        holdFrame(path, scene.hold || HOLD_SEC);
        frameIndex++;
        break;
      }

      case "action": {
        if (scene.fn) await scene.fn(mainPage);
        const path = framePath();
        await mainPage.screenshot({ path, type: "png" });
        holdFrame(path, scene.hold || HOLD_SEC);
        frameIndex++;
        break;
      }
    }
  }

  console.log(`\n📸 Captured ${frameIndex} frames total`);

  // Close browser
  await titlePage.close();
  await context.close();
  if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });

  // ─── Compile video with ffmpeg ──────────────────────────────────────────
  console.log("\n🎞️  Compiling video with ffmpeg...");

  // Prefer system ffmpeg (full codec support) over Playwright-bundled (limited).
  let systemFfmpeg = null;
  try { systemFfmpeg = execSync("which ffmpeg", { encoding: "utf8" }).trim(); } catch {}

  const useSystemFfmpeg = systemFfmpeg && existsSync(systemFfmpeg);
  const ffmpegBin = useSystemFfmpeg ? systemFfmpeg : FFMPEG;
  console.log(`   Using: ${ffmpegBin}${useSystemFfmpeg ? " (system)" : " (playwright-bundled)"}`);

  const inputArgs = ["-y", "-framerate", String(FPS), "-i", join(FRAMES_DIR, "frame-%05d.png")];

  // Generate both MP4 (LinkedIn/social) and WebM
  const outputs = [
    {
      path: OUT.replace(/\.\w+$/, ".mp4"),
      args: [...inputArgs, "-c:v", "libx264", "-preset", "slow", "-crf", "18",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
      label: "MP4 (H.264)",
    },
    {
      path: OUT,
      args: [...inputArgs, "-c:v", "libvpx-vp9", "-b:v", "5M", "-pix_fmt", "yuv420p"],
      label: "WebM (VP9)",
    },
  ];

  for (const output of outputs) {
    try {
      const fullArgs = [...output.args, output.path];
      console.log(`\n   Encoding ${output.label}...`);
      execFileSync(ffmpegBin, fullArgs, { stdio: ["ignore", "ignore", "inherit"] });
      console.log(`   ✅ ${output.path}`);
    } catch (err) {
      console.error(`   ❌ ${output.label} failed:`, err.message);
    }
  }

  // Cleanup
  if (mockServer) mockServer.close();

  const durationSec = frameIndex / FPS;
  console.log(`\n📊 Video stats:`);
  console.log(`   Frames: ${frameIndex}`);
  console.log(`   Duration: ${durationSec.toFixed(1)}s`);
  console.log(`   Format: WebM (VP8)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
