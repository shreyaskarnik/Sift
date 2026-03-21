import { test } from '@argo-video/cli';
import { showOverlay, withOverlay } from '@argo-video/cli';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SCREENSHOTS_DIR = join(ROOT, 'docs', 'assets', 'video-screenshots');
const LOGO_PATH = join(ROOT, 'docs', 'assets', 'logo.png');
const LOGO_DATA_URI = `data:image/png;base64,${readFileSync(LOGO_PATH).toString('base64')}`;

// ─── Category labels for word cloud background ─────────────────────────────
const CATEGORY_LABELS = [
  'News', 'AI Research', 'Startups', 'Deep Tech', 'Science',
  'Programming', 'Open Source', 'Security & Privacy', 'Design & UX',
  'Product & SaaS', 'Finance & Markets', 'Crypto & Web3', 'Politics',
  'Legal & Policy', 'Climate & Energy', 'Space & Aerospace',
  'Health & Biotech', 'Education', 'Gaming', 'Sports', 'Music',
  'Culture & Arts', 'Food & Cooking', 'Travel', 'Parenting',
];

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wordCloudHTML(): string {
  const rng = mulberry32(42);
  const spans = CATEGORY_LABELS.map((label) => {
    const x = 5 + rng() * 85;
    const y = 5 + rng() * 85;
    const size = 13 + rng() * 9;
    const opacity = 0.04 + rng() * 0.06;
    const rotate = (rng() - 0.5) * 12;
    return `<span style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;font-size:${size.toFixed(0)}px;opacity:${opacity.toFixed(2)};transform:rotate(${rotate.toFixed(1)}deg)">${label}</span>`;
  });
  return `<div class="word-cloud">${spans.join('\n    ')}</div>`;
}

// ─── HTML builders (ported from generate-video.mjs) ────────────────────────
const WIDTH = 1280;
const HEIGHT = 800;

function titleCardHTML(
  title: string,
  subtitle?: string,
  opts: { logo?: boolean; poweredBy?: boolean; wordCloud?: boolean } = {},
): string {
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
      width: ${WIDTH}px; height: ${HEIGHT}px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: #0e0f11; color: #e4e5e7;
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden; position: relative;
    }
    .word-cloud { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
    .word-cloud span {
      position: absolute; color: #34d399; font-weight: 500; font-size: 13px;
      white-space: nowrap; padding: 2px 10px; border-radius: 10px;
      border: 1px solid rgba(52,211,153,0.18); background: rgba(52,211,153,0.06);
    }
    .logo { width: 80px; height: 80px; border-radius: 16px; margin-bottom: 24px; position: relative; z-index: 1; }
    .title { font-size: 48px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 16px; text-align: center; line-height: 1.2; position: relative; z-index: 1; }
    .subtitle { font-size: 22px; font-weight: 400; color: #7a7d85; text-align: center; max-width: 700px; line-height: 1.5; position: relative; z-index: 1; }
    .accent { color: #34d399; }
    .powered-by { margin-top: 32px; font-size: 14px; font-weight: 400; color: #4e5058; letter-spacing: 0.02em; position: relative; z-index: 1; }
    .powered-by .sep { margin: 0 8px; color: #3a3c42; }
  </style>
</head>
<body>
  ${opts.wordCloud ? wordCloudHTML() : ''}
  ${opts.logo ? `<img class="logo" src="${LOGO_DATA_URI}" />` : ''}
  <div class="title">${title}</div>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
  ${opts.poweredBy ? `<div class="powered-by">Powered by EmbeddingGemma<span class="sep">&middot;</span>Transformers.js<span class="sep">&middot;</span>WebGPU<span class="sep">&middot;</span>Chrome Extensions</div>` : ''}
</body>
</html>`;
}

function screenshotPageHTML(imagePath: string): string {
  const imgData = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${WIDTH}px; height: ${HEIGHT}px;
      display: flex; align-items: center; justify-content: center;
      background: #0e0f11; overflow: hidden;
    }
    img { max-width: 100%; max-height: ${HEIGHT}px; object-fit: contain; }
  </style>
</head>
<body><img src="${imgData}" /></body>
</html>`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Title card — no overlay (the card IS the visual). */
async function showTitle(
  page: any, narration: any, scene: string,
  title: string, subtitle?: string,
  opts?: { logo?: boolean; poweredBy?: boolean; wordCloud?: boolean },
) {
  await page.setContent(titleCardHTML(title, subtitle, opts), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  narration.mark(scene);
  await page.waitForTimeout(narration.durationFor(scene));
}

/** Screenshot with overlay from scenes.json shown during recording. */
async function showScreenshotWithOverlay(
  page: any, narration: any, scene: string, filename: string,
) {
  await page.setContent(screenshotPageHTML(join(SCREENSHOTS_DIR, filename)), { waitUntil: 'load' });
  await page.waitForTimeout(400);
  narration.mark(scene);
  // showOverlay reads config from scenes.json for this scene name
  await showOverlay(page, scene, narration.durationFor(scene));
}

/** Screenshot without overlay — just mark and hold. */
async function showScreenshot(
  page: any, narration: any, scene: string, filename: string,
) {
  await page.setContent(screenshotPageHTML(join(SCREENSHOTS_DIR, filename)), { waitUntil: 'load' });
  await page.waitForTimeout(400);
  narration.mark(scene);
  await page.waitForTimeout(narration.durationFor(scene));
}

// ─── Demo ───────────────────────────────────────────────────────────────────

test('sift-showcase', async ({ page, narration }) => {
  test.setTimeout(300_000);

  // ── Intro (title card, no overlay needed) ──
  await showTitle(page, narration, 'intro',
    '<span class="accent">Sift</span>',
    'Score your feed with EmbeddingGemma<br>v0.2 — side panel, smart caching, muted keywords.',
    { logo: true, poweredBy: true },
  );

  // ── How it works (animated diagram + headline-card overlay) ──
  const diagramPath = join(SCREENSHOTS_DIR, 'embedding-diagram-dark.html');
  await page.goto(`file://${diagramPath}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  narration.mark('how-it-works');
  await showOverlay(page, 'how-it-works', narration.durationFor('how-it-works'));

  // ── Problem statement (title card) ──
  await showTitle(page, narration, 'problem',
    'Hundreds of posts. Only a few matter to you.',
    '<span class="accent">Sift</span> finds them.',
  );

  // ── Before / After (screenshots with overlays) ──
  await showScreenshotWithOverlay(page, narration, 'hn-before', 'hn-before.png');
  await showScreenshotWithOverlay(page, narration, 'hn-after', 'hn-after.png');

  // ── Side Panel intro (title card with word cloud) ──
  await showTitle(page, narration, 'side-panel-intro',
    'The Side Panel',
    'Persistent dashboard — page score, 25 categories, muted keywords, taste profile.',
    { wordCloud: true },
  );

  // ── Side Panel screenshot (lower-third overlay) ──
  await showScreenshotWithOverlay(page, narration, 'side-panel', 'side-panel.png');

  // ── Multi-site (title card) ──
  await showTitle(page, narration, 'multi-site',
    'Works Wherever You Read',
    'Same model, same categories — consistent scoring on any page.',
  );

  // ── Site screenshots (callout / headline overlays) ──
  await showScreenshotWithOverlay(page, narration, 'reddit', 'reddit.png');
  await showScreenshotWithOverlay(page, narration, 'x', 'x.png');
  await showScreenshotWithOverlay(page, narration, 'techcrunch', 'techcrunch.png');

  // ── Muted Keywords (title card) ──
  await showTitle(page, narration, 'muted',
    'Muted Keywords',
    'Block the noise. Items matching your keywords fade to near-invisible — no model inference wasted.',
  );

  // ── Caching (title card) ──
  await showTitle(page, narration, 'caching',
    'Smart Caching',
    'Seen it before? Skip the model.<br>LRU cache for 2,000 embeddings — instant re-scores on tab switches and infinite scroll.',
  );

  // ── Taste Profile intro (title card) ──
  await showTitle(page, narration, 'taste-intro',
    'Taste Profile',
    'After labeling 10+ items, Sift builds a contrastive profile of your interests.',
  );

  // ── Taste screenshot (lower-third overlay) ──
  await showScreenshotWithOverlay(page, narration, 'taste', 'taste.png');

  // ── Training (title card + headline-card overlay via withOverlay) ──
  await page.setContent(titleCardHTML(
    'Curate &amp; Train',
    'Label Manager for filtering, editing, and category reassignment. Then fine-tune.',
  ), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  narration.mark('training');
  await withOverlay(page, 'training', async () => {
    await page.waitForTimeout(narration.durationFor('training'));
  });

  // ── Label Manager screenshot (callout overlay) ──
  await showScreenshotWithOverlay(page, narration, 'labels', 'label-manager.png');

  // ── Training loop (title card) ──
  await showTitle(page, narration, 'loop',
    'The Training Loop',
    `<div style="text-align:left; max-width:600px; margin:0 auto;">
      <div style="margin:6px 0;">1. Label items as you browse</div>
      <div style="margin:6px 0;">2. Curate in the Label Manager</div>
      <div style="margin:6px 0;">3. Export as training CSV</div>
      <div style="margin:6px 0;">4. Fine-tune in Colab or locally</div>
      <div style="margin:6px 0;">5. Load fine-tuned model back into Sift</div>
    </div>`,
  );

  // ── Privacy (title card) ──
  await showTitle(page, narration, 'privacy',
    'Privacy-First',
    'No backend. No API costs. Inference stays local.',
  );

  // ── Outro (title card) ──
  await showTitle(page, narration, 'outro',
    '<span class="accent">Sift</span>',
    `Open source · Apache-2.0<br><br>
    <span style="font-family: JetBrains Mono, monospace; font-size: 16px; color: #4e5058;">
      github.com/shreyaskarnik/Sift
    </span>`,
    { logo: true },
  );
});
