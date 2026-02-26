# Automated Side Panel Screenshot Capture — Design

**Date:** 2025-02-25
**Branch:** `feat/sidepanel-cache-poison`
**Goal:** Automate capturing side panel screenshots for `generate-video.mjs`.

## Problem

Side panel screenshots must be manually captured. The popup could never be automated (transient overlay requiring user gesture). The side panel can — it's accessible at `chrome-extension://ID/side-panel.html`.

## Architecture

New script: `scripts/capture-screenshots.mjs`

```
capture-screenshots.mjs
├── Build extension (npm run build in chrome-extension/)
├── Launch Chromium with --load-extension=dist/
├── Get extension ID
├── Navigate to chrome-extension://ID/side-panel.html
├── Inject mock storage state via page.evaluate()
├── Reload → side panel renders with mock data
├── Screenshot: side panel (380px wide)
│
├── Navigate to https://news.ycombinator.com
├── Screenshot: HN page (full width)
│
├── Composite: side-panel.png = HN + side panel overlay
│
├── Update mock state: add muted keywords "crypto\nbitcoin"
├── Reload side panel → re-screenshot
├── Composite: muted-keywords.png = HN + side panel with muted keywords
│
└── Output to docs/assets/video-screenshots/
```

## Key Decisions

1. **Mock state, no model** — Pre-populate `chrome.storage.local` with realistic data. Side panel reads from storage on load. No EmbeddingGemma model needed. Fast (~5s), deterministic, CI-friendly.

2. **Composite screenshots** — Playwright can't screenshot browser chrome (sidebar). Capture site and side panel separately, composite them in an HTML template rendered by Playwright. Matches real user experience.

3. **Two scripts** — `capture-screenshots.mjs` produces PNGs, `generate-video.mjs` consumes them. Clean separation. Can re-capture without re-rendering title cards.

4. **Side panel only (v1)** — Content script scoring on HN/Reddit/X not mocked. HN background shows raw feed for context. Side panel is the focus.

## Composite Layout

```
┌──────────────────────────┬─────────┐
│                          │  Side   │
│   HN feed (900px)        │  Panel  │
│                          │ (380px) │
│                          │         │
└──────────────────────────┴─────────┘
         Total: 1280 x 800
```

Site screenshot cropped/scaled to fit left. Subtle divider line. Dark background (#0e0f11) matches video generator.

## Mock Data

```javascript
const MOCK_STATE = {
  CATEGORY_MAP: { /* real BUILTIN_CATEGORIES */ },
  ACTIVE_CATEGORY_IDS: [ /* ~20 of 25 */ ],
  model_status: "ready",
  model_backend: "webgpu",
  MUTED_KEYWORDS: "",          // empty for side-panel.png
  TASTE_PROFILE: { /* radar */ },
  ONBOARDING_DISMISSED: true,
};
```

For `muted-keywords.png`, set `MUTED_KEYWORDS: "crypto\nbitcoin"`.

## Output Files

| File | Description |
|------|-------------|
| `side-panel.png` | HN + side panel composite (categories, page score, model ready) |
| `muted-keywords.png` | HN + side panel with "crypto\nbitcoin" muted |

## CLI

```
node scripts/capture-screenshots.mjs [options]
  --out-dir <path>    Output directory (default: docs/assets/video-screenshots/)
  --width <n>         Total width (default: 1280)
  --height <n>        Total height (default: 800)
  --panel-width <n>   Side panel width (default: 380)
  --scale <n>         Device scale factor (default: 2)
```

## Future Extensions

- Mock content script scoring for HN/Reddit/X site screenshots
- Capture `hn-after.png` with scoring widgets + muted dimming
- Capture taste profile and label manager pages
- Full CI pipeline: build → capture → generate video
