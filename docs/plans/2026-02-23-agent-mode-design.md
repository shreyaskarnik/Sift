# Agent Mode — Design Doc

**Goal:** A manual "fetch my feed" button that uses the HN Firebase API + the user's taste vector to surface the top 50 most personally relevant stories from HN's top 500.

**Architecture:** Single message (`AGENT_FETCH_HN`) to the background service worker. Background fetches story IDs + item details from the HN Firebase API, embeds all titles, scores against the cached taste vector, and returns a ranked list. Results displayed on a dedicated `agent.html` full-page view.

## Data Pipeline

1. **Fetch story IDs** — `GET https://hacker-news.firebaseio.com/v0/topstories.json` → array of up to 500 item IDs
2. **Batch-fetch items** — `GET https://hacker-news.firebaseio.com/v0/item/{id}.json` per ID, concurrency-capped at ~20 parallel fetches. Each returns `{ id, title, url, score, by, time, descendants, type }`.
3. **Filter** — Drop deleted items, job posts (`type !== "story"`), empty titles
4. **Embed titles** — Reuse `embed()` in background.ts, batches of `SCORE_BATCH_SIZE` (16)
5. **Score** — Dot product of each L2-normalized title embedding against the cached taste vector
6. **Rank** — Sort descending by taste similarity, return top 50

**Prerequisite:** Taste vector must exist (user has labeled enough items). If missing, UI prompts to collect more labels.

## UI — `agent.html`

Dedicated full-page view (same pattern as `taste.html`, `labels.html`).

- **Header** — "Agent" title + subtitle + "Fetch" button
- **Status area** — Progress during fetch ("Fetching stories... Scoring... Done — 500 stories scored in 3.2s")
- **Results list** — Top 50 stories, each row:
  - Rank number (dimmed)
  - Story title (links to `https://news.ycombinator.com/item?id={id}`)
  - Domain hostname (dimmed)
  - Taste score (0–100)
  - HN metadata: points, comment count, relative age
- **Empty state** — "Label at least 10 items to build your taste profile, then the agent can find stories for you."

Styling: Same CSS variable system (light/dark via `prefers-color-scheme`), same tokens as taste.html/labels.html.

v1 is read-only — no labeling, no filtering from this page.

## Integration

- **New message type:** `AGENT_FETCH_HN` in `constants.ts` MSG
- **Response shape:** `{ stories: AgentStory[], elapsed: number }`
- **`AgentStory`:** `{ id, title, url, domain, hnScore, by, time, descendants, tasteScore }`
- **Background handler:** Checks/recomputes taste vector if stale, then runs full pipeline in one async handler
- **Build:** New IIFE target in `build.mjs` for `src/agent/agent.ts` → `dist/agent.js`
- **Popup link:** New fold in popup with "Find my stories →" link opening `agent.html`
- **No new permissions needed** — `host_permissions` already covers Firebase API

## Decisions

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Trigger | Manual button press | No background overhead, user-initiated |
| Data source | HN Firebase API | Structured JSON, 500 stories, no HTML parsing |
| Scoring | Taste vector similarity | Most personalized, aligned with label training signal |
| Display | Dedicated agent.html | Full-width, room for rich display |
| Link target | HN discussion page | Not external article URL |
| Scope | Title-only scoring | Titles are what users label; comments/content can be layered later |
