# Multi-Feed Dynamic Homepage — Implementation Plan

## Overview
Expand the current HN-only agent view into a multi-source RSS feed aggregator that creates a personalized, scored front page. Users select their feeds, we fetch and parse RSS, score everything through the existing taste profile, and render a unified ranked feed.

---

## Architecture

### New Files
```
chrome-extension/src/
├── feeds/
│   ├── feed-registry.ts      # Feed source definitions (name, url, icon, parser)
│   ├── feed-fetcher.ts        # RSS fetch + parse (via background service worker)
│   ├── feed-types.ts          # FeedItem, FeedSource interfaces
│   └── feed-opml.ts           # OPML import/export support
├── agent/
│   ├── agent.ts               # (MODIFY) Expand to multi-feed rendering
│   └── agent.css              # (NEW) Extracted/expanded styles
├── side-panel/
│   └── side-panel.ts          # (MODIFY) Add feed source picker to settings
├── shared/
│   ├── constants.ts           # (MODIFY) Add new message types, storage keys
│   └── types.ts               # (MODIFY) Add feed-related message types
└── background/
    └── background.ts          # (MODIFY) Add RSS fetch handler
```

### Data Flow
```
User selects feeds (side panel settings)
  → Stored in chrome.storage.local
  → Agent view reads selected feeds
  → Sends FETCH_FEEDS message to background service worker
  → Background fetches RSS XML via fetch() (no CORS issues in MV3 service worker)
  → Parses XML → FeedItem[]
  → Returns items to agent view
  → Agent view sends items for scoring (existing SCORE_TEXTS flow)
  → Items sorted by taste score
  → Rendered as unified feed with source badges
```

---

## Step-by-Step Implementation

### Step 1: Define Feed Types & Registry

**File: `src/feeds/feed-types.ts`**
```ts
interface FeedSource {
  id: string;            // "hn" | "techcrunch" | "verge" | "arstechnica" | ...
  name: string;          // "Hacker News"
  url: string;           // RSS feed URL
  iconUrl?: string;      // Favicon or custom icon
  color: string;         // Brand color for source badge
  category: string;      // "tech" | "news" | "science" | ...
}

interface FeedItem {
  id: string;            // Unique ID (guid from RSS or generated)
  sourceId: string;      // Which feed it came from
  title: string;         // Item title (what we score)
  url: string;           // Link to article
  description?: string;  // RSS description/summary (stripped HTML for subtitle)
  imageUrl?: string;     // Extracted from <media:content>, <enclosure>, or <description> <img>
  publishedAt: number;   // Unix timestamp
  author?: string;       // Author name if available
}
```

**File: `src/feeds/feed-registry.ts`**

Built-in feed sources (user can also add custom RSS URLs):

| Source | RSS URL | Category |
|--------|---------|----------|
| Hacker News | `https://hnrss.org/frontpage` | tech |
| TechCrunch | `https://techcrunch.com/feed/` | tech |
| The Verge | `https://www.theverge.com/rss/index.xml` | tech |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` | tech |
| Wired | `https://www.wired.com/feed/rss` | tech |
| Lobsters | `https://lobste.rs/rss` | tech |
| MIT Tech Review | `https://www.technologyreview.com/feed/` | science |
| BBC News | `https://feeds.bbci.co.uk/news/rss.xml` | news |

Default enabled: Hacker News (preserves current behavior).

### Step 2: RSS Fetcher in Background Service Worker

**File: `src/feeds/feed-fetcher.ts`** (imported by background.ts)

- Parse RSS/Atom XML using `DOMParser` (available in service worker)
- Handle both RSS 2.0 (`<item>`) and Atom (`<entry>`) formats
- Extract: title, link, guid, pubDate, description, dc:creator
- **Image extraction** (priority order):
  1. `<media:content url="...">` or `<media:thumbnail url="...">`
  2. `<enclosure url="..." type="image/*">`
  3. First `<img src="...">` found in `<description>` or `<content:encoded>` HTML
  4. Open Graph fallback: if none found, can optionally fetch `<meta property="og:image">` from article URL (deferred — expensive)
- Strip HTML from description to get clean subtitle text (keep first ~160 chars)
- Deduplicate by URL across feeds
- Cache fetched results in memory (5-minute TTL) to avoid hammering feeds
- Limit: fetch at most 50 items per feed, 200 total across all feeds

**Modify: `src/background/background.ts`**
- Add `MSG.FETCH_FEEDS` handler
- Receives list of feed URLs → fetches in parallel → returns merged `FeedItem[]`
- Uses `fetch()` in service worker (no CORS restrictions for extensions with `host_permissions`)

**Modify: `manifest.json`**
- Add `host_permissions`: `["https://*/"]` or specific feed domains
  - Note: the extension likely already has broad host permissions for content script injection. Verify and add only what's needed.

### Step 3: Feed Source Picker in Settings

**Modify: `src/side-panel/side-panel.ts`**

Add a new collapsible section "Feed Sources" in settings area:
- Grid of toggle chips (same pattern as category chips)
- Each chip shows feed name + colored dot
- Toggle on/off to include in personalized feed
- "Add Custom Feed" button → text input for arbitrary RSS URL
- Store selections in `chrome.storage.local` under `STORAGE_KEYS.ACTIVE_FEEDS`

**Modify: `src/shared/constants.ts`**
- Add `STORAGE_KEYS.ACTIVE_FEEDS` — `string[]` of feed source IDs
- Add `STORAGE_KEYS.CUSTOM_FEEDS` — `FeedSource[]` for user-added feeds
- Add `MSG.FETCH_FEEDS` message type

### Step 4: Expand Agent View to Multi-Feed Rendering

**Modify: `src/agent/agent.ts`**

Replace HN-only fetch with multi-feed flow:

1. On load, read `ACTIVE_FEEDS` from storage
2. Send `FETCH_FEEDS` message to background with selected feed URLs
3. Receive `FeedItem[]`, send titles for scoring (existing `SCORE_TEXTS` flow)
4. Sort by taste score (default) with alternative sorts: by date, by source
5. Render unified feed list

**UI Design: Magazine-Style Visual Front Page**

The feed should feel like a modern news front page — not a plain text list. Think Google News / Flipboard / Apple News, but scored by your taste profile.

**Three layout zones:**

1. **Hero section** — Top-scored item of the day, full-width card with large image
2. **Featured row** — Next 2-4 high-scored items as medium cards in a horizontal grid
3. **River** — Remaining items as compact cards (thumbnail + text)

**Source badge** on each card — small colored pill showing "HN", "TC", "Verge" etc.
**Filter bar** at top — quick-toggle chips to show/hide individual sources inline
**Sort controls** — "By relevance" (taste score) | "By date" | grouped by source
**Refresh button** with last-fetched timestamp
Keep existing: score indicator, spectral coloring, vote buttons, category pills

**Layout (Full Page — `agent.html`):**
```
┌──────────────────────────────────────────────────────────────┐
│  ✦ Sift · Your Feed                              ↻ 2m ago  │
├──────────────────────────────────────────────────────────────┤
│  [All] [HN] [TC] [Verge] [Ars] [BBC] [+]                   │
│  Sort: [Relevance ▼] [Date] [Source]                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │            ████████████████████████████               │   │
│  │            ██   HERO IMAGE (16:9)   ██               │   │
│  │            ████████████████████████████               │   │
│  │                                                      │   │
│  │  0.92 ✨  Top Story Title Goes Here                  │   │
│  │  First 2 lines of description text that give you     │   │
│  │  a summary of what the article is about...           │   │
│  │  [TechCrunch]  ·  3h ago  ·  Author Name            │   │
│  │  [AI] [Startups]                          [👍] [👎] │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────┐ ┌─────────────────┐ ┌────────────────┐ │
│  │ ███████████████ │ │ ███████████████ │ │ ██████████████ │ │
│  │ ██  IMAGE    ██ │ │ ██  IMAGE    ██ │ │ ██  IMAGE   ██ │ │
│  │ ███████████████ │ │ ███████████████ │ │ ██████████████ │ │
│  │                 │ │                 │ │                │ │
│  │ 0.85 ✨ Title   │ │ 0.78 👍 Title   │ │ 0.74 👍 Title  │ │
│  │ Short desc...   │ │ Short desc...   │ │ Short desc...  │ │
│  │ [HN] · 2h ago  │ │ [Verge] · 5h   │ │ [Ars] · 1h    │ │
│  └─────────────────┘ └─────────────────┘ └────────────────┘ │
│                                                              │
│  ── Today ──────────────────────────────────────────────     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ┌────────┐                                           │   │
│  │ │ THUMB  │  0.71 👍 Article Title Here        [HN]  │   │
│  │ │ 80x80  │  First line of description text...       │   │
│  │ │        │  4h ago · author   [AI] [Web]   [👍][👎] │   │
│  │ └────────┘                                           │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ ┌────────┐                                           │   │
│  │ │ THUMB  │  0.65 😐 Another Article Title     [TC]  │   │
│  │ │ 80x80  │  Description preview text here...        │   │
│  │ │        │  6h ago · author   [Startups]    [👍][👎] │   │
│  │ └────────┘                                           │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ ┌────────┐                                           │   │
│  │ │  NO    │  0.58 😐 Text-Only Story Title     [HN]  │   │
│  │ │ IMAGE  │  HN/Lobsters items often have no image.  │   │
│  │ │ (icon) │  Show source icon as fallback.    [👍][👎] │   │
│  │ └────────┘                                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ── Yesterday ──────────────────────────────────────────     │
│  ...                                                         │
│                                                              │
│  [Load more stories]                                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Side Panel View (`side-panel.html` agent tab):**
Narrower viewport — skip hero, use compact river layout only:
```
┌───────────────────────────┐
│ ✦ Your Feed     ↻ 2m ago │
├───────────────────────────┤
│ [All] [HN] [TC] [+]      │
├───────────────────────────┤
│ ┌───────────────────────┐ │
│ │ ███████████████████   │ │
│ │ ██  IMAGE (16:9)  ██  │ │
│ │ ███████████████████   │ │
│ │ 0.92 ✨ Top Story     │ │
│ │ Short desc...         │ │
│ │ [TC] · 3h ago        │ │
│ ├───────────────────────┤ │
│ │ ┌──────┐              │ │
│ │ │THUMB │ 0.85 Title   │ │
│ │ │      │ [HN] · 2h    │ │
│ │ └──────┘              │ │
│ ├───────────────────────┤ │
│ │ ┌──────┐              │ │
│ │ │THUMB │ 0.78 Title   │ │
│ │ │      │ [Verge] · 5h │ │
│ │ └──────┘              │ │
│ └───────────────────────┘ │
└───────────────────────────┘
```

**Image Handling Details:**

| Scenario | Behavior |
|----------|----------|
| Image URL found in RSS | Show image, lazy-load with `loading="lazy"` |
| No image in RSS | Show source icon/logo as placeholder on colored background |
| Image fails to load | `onerror` handler swaps to source icon fallback |
| HN / Lobsters items | Typically no images — use source brand icon + gradient bg |
| Side panel (narrow) | Smaller thumbnails (60x60), hero card uses 16:9 but smaller |

**Image extraction in RSS parser** (already in Step 2, expanded):
```ts
function extractImage(item: Element, ns: Record<string, string>): string | undefined {
  // 1. <media:content url="..."> or <media:thumbnail>
  const media = item.getElementsByTagNameNS(ns.media, "content")[0]
                ?? item.getElementsByTagNameNS(ns.media, "thumbnail")[0];
  if (media?.getAttribute("url")) return media.getAttribute("url")!;

  // 2. <enclosure url="..." type="image/*">
  const enc = item.querySelector("enclosure[type^='image']");
  if (enc?.getAttribute("url")) return enc.getAttribute("url")!;

  // 3. First <img> in description HTML
  const desc = item.querySelector("description, content")?.textContent ?? "";
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/);
  if (imgMatch) return imgMatch[1];

  return undefined;
}
```

**CSS Architecture for Cards:**

```css
/* Card system */
.sf-card          { border-radius: 12px; overflow: hidden; background: var(--card-bg); }
.sf-card-hero     { grid-column: 1 / -1; }  /* full width */
.sf-card-featured { min-height: 280px; }     /* medium cards */
.sf-card-compact  { display: grid; grid-template-columns: 80px 1fr; gap: 12px; }

/* Image handling */
.sf-card-image    { aspect-ratio: 16/9; object-fit: cover; width: 100%; }
.sf-card-thumb    { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; }
.sf-card-fallback { display: flex; align-items: center; justify-content: center;
                    background: var(--source-color); }

/* Score integration — reuse existing spectral hue system */
.sf-card-score    { position: absolute; top: 8px; left: 8px;
                    backdrop-filter: blur(8px); background: rgba(0,0,0,0.6);
                    color: white; border-radius: 6px; padding: 2px 8px; }

/* Source badge */
.sf-source-badge  { font-size: 11px; font-weight: 600; padding: 2px 6px;
                    border-radius: 4px; background: var(--source-color);
                    color: white; }

/* Grid layout */
.sf-feed-grid     { display: grid; grid-template-columns: repeat(3, 1fr);
                    gap: 16px; max-width: 960px; margin: 0 auto; }

/* Responsive: side panel or narrow viewport */
@media (max-width: 480px) {
  .sf-feed-grid   { grid-template-columns: 1fr; }
  .sf-card-featured { min-height: auto; }
}
```

**Spectral score overlay on images:**
For hero and featured cards, the score badge floats over the image with a glassmorphism pill (backdrop-filter blur). The existing spectral hue coloring (blue→amber based on score) tints the badge. This maintains visual consistency with the content script scoring while looking polished on cards.

**Dark mode:**
Cards use `var(--card-bg)` which switches between `#fff` (light) and `#1a1a1a` (dark) via the existing `prefers-color-scheme` media query. Image placeholders use the source brand color at reduced opacity in dark mode.

### Step 5: OPML Import/Export (Nice-to-Have)

**File: `src/feeds/feed-opml.ts`**

- Import OPML files (standard RSS reader export format)
- Export current feed list as OPML
- Allows users to bring feeds from Feedly, Inoreader, etc.

---

## Storage Schema

```ts
// New storage keys
ACTIVE_FEEDS: "active_feeds"           // string[] — IDs of enabled built-in feeds
CUSTOM_FEEDS: "custom_feeds"           // FeedSource[] — user-added RSS URLs
FEED_CACHE: "feed_cache"              // In-memory only (not persisted), 5min TTL
```

---

## Permissions

Minimal additions to `manifest.json`:
- May need to add specific feed domains to `host_permissions` if not already covered
- No new Chrome API permissions needed (already using storage, service worker)

---

## What We're NOT Doing (Keeping It Simple)
- No server-side component — everything stays client-side
- No ColBERT re-ranker — single-vector scoring is sufficient for short-text ranking (see reasoning below)
- No full-text article fetching — we score titles + RSS description only
- No OG image scraping in v1 — only images already in the RSS feed (OG fetch is expensive and slow)
- No read/unread tracking (v1) — can add later
- No social features — this is a personal tool
- No infinite scroll — "load more" button at bottom

---

## On ColBERT / Re-Ranking (Why Not Now)

1. **Client-side weight budget** — already running EmbeddingGemma-300M q4. A second model doubles memory/compute.
2. **Short text** — ColBERT's token-level late interaction shines on passages, not 10-20 token titles.
3. **Small candidate set** — ~100-300 feed items don't need two-stage retrieval. Single-pass scoring handles this fine.
4. **Better alternatives** — fine-tuning the existing model on user labels or improving keyword muting will yield more signal per effort.
5. **Future option** — if we add full-article scoring, a lightweight cross-encoder re-ranker on top-50 candidates could make sense then.

---

## Implementation Order

1. **Feed types & registry** — new files, no existing code touched
2. **RSS fetcher + background handler** — new file + modify background.ts, includes image extraction
3. **Manifest permissions** — if needed
4. **Agent view: magazine-style front page** — replace text list with hero/featured/river card layout
   - Card component system (hero, featured, compact)
   - Image rendering with lazy loading + fallbacks
   - Source badges with brand colors
   - Score overlay (spectral hue on glassmorphism pill)
   - Filter bar + sort controls
   - Time grouping (Today, Yesterday, This Week)
   - Dark mode support
   - Responsive layout (full page vs side panel)
5. **Feed source picker in side panel settings** — modify side-panel.ts
6. **OPML import/export** — optional, standalone
