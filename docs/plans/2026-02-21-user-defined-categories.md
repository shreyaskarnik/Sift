# User-Defined Categories

**Status**: Design — not yet implemented
**Date**: 2026-02-21

## Problem

The extension has 5 hardcoded categories (News, AI Research, Startups, Deep Tech, Science). This limits the audience to users who share these interests. We want personalization without sacrificing ranking quality.

## Decision

Ship in three phases: curated library first, then guarded custom categories, then seed-example mode.

## Embedding Validation

Ran `scripts/validate_category_embeddings.py` against `google/embeddinggemma-300m` (base model, zero-shot).

**Result**: All 25 candidates pass. No pair exceeds the 0.85 danger threshold.

Closest pairs to watch:
| Pair | Cosine Sim |
|------|-----------|
| GAMING ↔ SPORTS | 0.80 |
| EDUCATION ↔ PARENTING | 0.79 |
| SPORTS ↔ POLITICS | 0.78 |
| AI_RESEARCH ↔ DEEP_TECH | 0.77 (existing presets, already coexist fine) |

Most distinct category: MY_FAVORITE_NEWS (avg 0.53 — meta-category, won't compete).
All candidates have avg distinctiveness well under 0.75.

**Conclusion**: Ship all 25. No merges needed.

## Current Architecture (context)

- `PRESET_ANCHORS` in `constants.ts` — 5 hardcoded anchor strings
- `ANCHOR_LABELS` — static `Record<string, string>` mapping anchor key → display name
- `LENS_PROFILES` in `background.ts` — static `Record<string, LensProfile>` with include/exclude keyword lists (hardcoded for 5 categories)
- `embedPresetAnchors()` in `background.ts` — embeds anchor strings at model load, caches in-memory `Map<string, Float32Array>`
- `rankPresets(textEmb)` — cosine similarity against cached anchor embeddings, returns `PresetRanking`
- `PresetRank.anchor` flows end-to-end as a string key — UI resolves display name via `ANCHOR_LABELS[pr.anchor]`
- Labels store `TrainingLabel.anchor: string` (the anchor key), used in CSV export and Python training
- Schema version 2: background **wipes all labels** on version mismatch (`background.ts:96-106`)
- Python training pipeline is already anchor-agnostic (reads anchor from CSV column 1)

## Required Decisions (from review)

### RD-1: Immutable built-in IDs (Finding #1 — High)

**Problem**: Original plan derived UUIDs from `anchorText`, but `anchorText` can change for quality tuning, which would remap IDs and orphan labels.

**Decision**: Use short, immutable, human-readable IDs checked into source. Never regenerate.

```typescript
// IDs are permanent. anchorText can be tuned independently.
{ id: "ai-research",    anchorText: "AI_RESEARCH",         label: "AI Research" }
{ id: "deep-tech",      anchorText: "DEEP_TECH",           label: "Deep Tech" }
{ id: "gaming",         anchorText: "GAMING",              label: "Gaming" }
```

For Phase 2 custom categories, generate a UUID at creation time, store it, never regenerate.

### RD-2: Runtime category map for UI (Finding #2 — High)

**Problem**: Today `ANCHOR_LABELS[pr.anchor]` resolves names. Once `PresetRank.anchor` becomes a category ID (e.g. `"ai-research"`), pills/popup will show raw IDs unless we provide a shared lookup.

**Decision**: Build a `CategoryMap` that lives in `chrome.storage.local` and is loaded by popup + content scripts at init.

```typescript
// Stored as flat JSON, loaded once per context init
type CategoryMap = Record<string, { label: string; anchorText: string }>;

// Example:
{ "ai-research": { label: "AI Research", anchorText: "AI_RESEARCH" } }
```

- Background writes `CategoryMap` to storage on startup and whenever categories change
- Popup and content scripts read it from storage at init (one async call)
- Replaces static `ANCHOR_LABELS` import for display name resolution
- `PresetRank.anchor` carries the category `id` end-to-end
- Widget/popup fallback: `categoryMap[pr.anchor]?.label ?? pr.anchor`

### RD-3: Migration replaces wipe (Finding #3 — High)

**Problem**: Current `background.ts:96-106` wipes all labels when schema version bumps. If we want v2→v3 migration (mapping old anchor strings to new IDs), the wipe logic must be replaced.

**Decision**: Replace wipe-on-mismatch with a migration function.

```typescript
// background.ts startup
const storedVersion = stored[STORAGE_KEYS.LABEL_SCHEMA] ?? 0;
if (storedVersion < LABEL_SCHEMA_VERSION) {
  await migrateLabels(storedVersion, LABEL_SCHEMA_VERSION);
}

// migrations.ts
function migrateLabels(from: number, to: number): Promise<void> {
  // v2 → v3: map old anchor strings to category IDs
  // e.g. "AI_RESEARCH" → "ai-research"
  // Uses LEGACY_ANCHOR_MAP checked into constants.ts
}
```

Keep wipe as a fallback only if migration encounters corruption.

### RD-4: Single source of truth for active state (Finding #4 — Medium)

**Problem**: `CategoryDef.active` plus `active_category_ids` is dual source of truth.

**Decision**: Drop `active` field from `CategoryDef`. Only `active_category_ids: string[]` in storage. Category definitions are pure data; activation state is separate.

### RD-5: Explanation system for dynamic categories (Finding #5 — Medium)

**Problem**: `LENS_PROFILES` is hardcoded for 5 categories. Custom categories get no keyword-based explanation.

**Decision**: Phase 1 ships with a **generic explanation profile** for non-builtin categories. Keyword matching falls back to score-band-only explanation. LENS_PROFILES stays for the original 5 as a quality bonus.

Phase 2 can optionally let users add keywords when creating custom categories.

### RD-6: Frozen anchor text in labels (Finding #6 — Medium)

**Problem**: If `anchorText` is edited after labels exist, CSV export would use the new text while old labels were trained under the old text.

**Decision**: Freeze `anchorText` at label time. Add `TrainingLabel.anchorText: string` — the anchor embedding text at the moment the label was created. CSV export uses `label.anchorText`, not the current category's `anchorText`.

This means if you rename "AI_RESEARCH" to "ARTIFICIAL_INTELLIGENCE_RESEARCH", old labels keep their original anchor text for training consistency.

### RD-7: Feed re-score on category toggle (Finding #7 — High)

**Problem**: Background re-embeds after active categories change, but content scripts have no signal to clear stale scores and re-request. Users toggle categories and existing HN/Reddit/X cards stay scored under the old category set until page reload.

**Decision**: Background broadcasts a `CATEGORIES_CHANGED` message after re-embedding completes. Content scripts listen for it and re-score all currently rendered items.

**Guardrail**: Include a monotonic `categoriesVersion` counter in the payload. Content scripts track the last-processed version and ignore stale/out-of-order broadcasts (e.g. a slow first re-embed arriving after a second toggle completes).

```typescript
// background.ts
let categoriesVersion = 0;

// After embedActiveCategories() completes:
categoriesVersion++;
chrome.runtime.sendMessage({
  type: MSG.CATEGORIES_CHANGED,
  payload: { categoriesVersion },
});

// Content scripts
let lastCategoriesVersion = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.CATEGORIES_CHANGED) {
    const v = msg.payload?.categoriesVersion ?? 0;
    if (v <= lastCategoriesVersion) return; // stale, ignore
    lastCategoriesVersion = v;
    rescoreVisibleItems();
  }
});
```

Each content script already tracks scored elements (for MutationObserver). `rescoreVisibleItems()` re-collects their text and sends a fresh `SCORE_TEXTS` batch. This is the same path as initial scoring — no new inference logic needed.

### RD-8: Focus lens reconciliation on deactivation (Finding #8 — High)

**Problem**: If the current `query_anchor` (Focus Lens) points to a category that gets deactivated or archived, the anchor becomes invalid. No reconciliation rule exists.

**Decision**: When active categories change, background checks if `currentAnchor` is still in the active set. If not:

1. Auto-switch to the first active category ID
2. Persist the new anchor to storage
3. Re-embed the main anchor embedding
4. Include this in the `CATEGORIES_CHANGED` broadcast (popup/content scripts will pick up the new anchor)

**Guardrail**: Only persist the fallback focus lens after validating `newActiveIds.length > 0`. If the toggle would leave zero active categories, block the toggle in the UI and show an inline error ("At least one category must be active"). This means the `currentAnchor = newActiveIds[0]` path is always safe.

```typescript
// In the category toggle handler, after computing newActiveIds:
if (newActiveIds.length === 0) {
  // Block: UI should prevent this, but guard defensively
  return { error: "At least one category must be active" };
}
await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_CATEGORY_IDS]: newActiveIds });

if (!newActiveIds.includes(currentAnchor)) {
  currentAnchor = newActiveIds[0]; // safe: length > 0 verified above
  await chrome.storage.local.set({ [STORAGE_KEYS.ANCHOR]: currentAnchor });
}
```

Popup should also show a brief toast: "Focus switched to [label] — previous lens was deactivated."

### RD-9: Unknown legacy anchors get archived custom defs (Finding #9 — Medium)

**Problem**: v2→v3 migration keeps unknown anchor strings "as-is" in labels, but they won't exist in any `CategoryDef`. UI will show raw IDs and user can't manage them.

**Decision**: During migration, any anchor string NOT in `LEGACY_ANCHOR_MAP` gets an auto-created archived `CategoryDef`:

**Guardrail**: Sanitize and cap legacy IDs. Slugify the anchor string (lowercase, replace non-alphanumeric with `-`, collapse runs, strip leading/trailing `-`, cap at 40 chars), then prefix with `legacy-`. Dedupe collisions deterministically by appending `-2`, `-3`, etc.

```typescript
function makeLegacyId(anchorString: string, existingIds: Set<string>): string {
  const slug = anchorString
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  let candidate = `legacy-${slug || "unknown"}`;
  let n = 1;
  while (existingIds.has(candidate)) {
    n++;
    candidate = `legacy-${slug || "unknown"}-${n}`;
  }
  existingIds.add(candidate);
  return candidate;
}

// In migrateLabels, for unknown anchors:
{
  id: makeLegacyId(anchorString, existingIds),
  anchorText: anchorString,
  label: anchorString,   // best-effort display name
  builtin: false,
  archived: true,
}
```

These appear in the category manager as "Legacy — [name]" with a restore option. Labels reference the new `legacy-*` ID. This ensures every label's anchor has a corresponding `CategoryDef`, so the `CategoryMap` is always complete.

### RD-10: anchorText freezing for import path (Finding #10 — Medium)

**Problem**: `SAVE_LABEL` stamps `anchorText`, but `IMPORT_X_LABELS` also creates labels. Without the same stamping, imported labels would lack `anchorText` and export behavior diverges.

**Decision**: All label creation paths must stamp `anchorText`. Three paths to cover:

1. **SAVE_LABEL** — already specified in RD-6
2. **IMPORT_X_LABELS** — stamp `anchorText` from the current category def for each label's resolved anchor at import time
3. **SET_LABELS** (bulk restore) — if `anchorText` is missing, backfill from `CategoryMap` at write time

**Guardrail**: `stampAnchorText()` is idempotent — only fills `anchorText` when missing, never overwrites an existing historical value. This preserves the frozen-at-save-time invariant even if the helper is called multiple times on the same label.

```typescript
// Shared helper used by all three paths — idempotent, never overwrites
function stampAnchorText(label: TrainingLabel, categoryMap: CategoryMap): TrainingLabel {
  if (!label.anchorText) {
    label.anchorText = categoryMap[label.anchor]?.anchorText ?? label.anchor;
  }
  return label;
}
```

### RD-11: CategoryMap live refresh via storage.onChanged (Finding #11 — Medium)

**Problem**: Content scripts load `CategoryMap` once at init. Long-lived tabs (HN, Reddit) keep stale labels after category edits/toggles.

**Decision**: All UI contexts subscribe to `chrome.storage.onChanged` for the `category_map` key and refresh their local copy.

```typescript
// In widget.ts / popup.ts / content script init
let categoryMap: CategoryMap = {};

// Initial load
chrome.storage.local.get(STORAGE_KEYS.CATEGORY_MAP).then((stored) => {
  categoryMap = stored[STORAGE_KEYS.CATEGORY_MAP] ?? {};
});

// Live refresh
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.CATEGORY_MAP]) {
    categoryMap = changes[STORAGE_KEYS.CATEGORY_MAP].newValue ?? {};
  }
});
```

This is lightweight (only fires when categories actually change) and ensures pills, popups, and label buttons always show current names.

## Phase 1: Category Library Picker

**Goal**: Larger curated library (25 options), user picks up to 8 active categories.

### Category definition schema

```typescript
interface CategoryDef {
  id: string;           // immutable, human-readable (e.g. "ai-research")
  anchorText: string;   // text that gets embedded (e.g. "AI_RESEARCH")
  label: string;        // display name (e.g. "AI Research")
  builtin: boolean;     // true = curated library, false = user-created (Phase 2)
  group?: string;       // UI grouping: "tech", "lifestyle", "world" (Phase 1 only)
}
```

No `active` field — activation managed separately via `active_category_ids`.

### Storage

```
chrome.storage.local:
  category_defs: CategoryDef[]       // full library (builtins + any custom from Phase 2)
  active_category_ids: string[]      // ordered list of active category IDs (max 8)
  category_map: CategoryMap          // id → {label, anchorText} for UI lookup
```

### Built-in category library (25)

Checked into `constants.ts` as `BUILTIN_CATEGORIES`.

| ID | anchorText | Label | Group |
|----|-----------|-------|-------|
| `news` | MY_FAVORITE_NEWS | News | — |
| `ai-research` | AI_RESEARCH | AI Research | tech |
| `startups` | STARTUP_NEWS | Startups | tech |
| `deep-tech` | DEEP_TECH | Deep Tech | tech |
| `science` | SCIENCE_DISCOVERIES | Science | tech |
| `programming` | PROGRAMMING_DEV_TOOLS | Programming | tech |
| `open-source` | OPEN_SOURCE | Open Source | tech |
| `security` | SECURITY_PRIVACY | Security & Privacy | tech |
| `design` | DESIGN_UX | Design & UX | tech |
| `product` | PRODUCT_SAAS | Product & SaaS | tech |
| `finance` | FINANCE_MARKETS | Finance & Markets | world |
| `crypto` | CRYPTO_WEB3 | Crypto & Web3 | world |
| `politics` | POLITICS | Politics | world |
| `legal` | LEGAL_POLICY | Legal & Policy | world |
| `climate` | CLIMATE_ENERGY | Climate & Energy | world |
| `space` | SPACE_AEROSPACE | Space & Aerospace | world |
| `health` | HEALTH_BIOTECH | Health & Biotech | lifestyle |
| `education` | EDUCATION | Education | lifestyle |
| `gaming` | GAMING | Gaming | lifestyle |
| `sports` | SPORTS | Sports | lifestyle |
| `music` | MUSIC | Music | lifestyle |
| `culture` | CULTURE_ARTS | Culture & Arts | lifestyle |
| `food` | FOOD_COOKING | Food & Cooking | lifestyle |
| `travel` | TRAVEL | Travel | lifestyle |
| `parenting` | PARENTING | Parenting | lifestyle |

### Default active set (first run)

```typescript
const DEFAULT_ACTIVE_IDS = ["news", "ai-research", "startups", "deep-tech", "science"];
```

### Legacy anchor mapping (for migration)

```typescript
const LEGACY_ANCHOR_MAP: Record<string, string> = {
  "MY_FAVORITE_NEWS":   "news",
  "AI_RESEARCH":        "ai-research",
  "STARTUP_NEWS":       "startups",
  "DEEP_TECH":          "deep-tech",
  "SCIENCE_DISCOVERIES": "science",
};
```

### What changes

| Component | Change |
|-----------|--------|
| `constants.ts` | Add `BUILTIN_CATEGORIES`, `DEFAULT_ACTIVE_IDS`, `LEGACY_ANCHOR_MAP`, `MSG.CATEGORIES_CHANGED`. Remove `PRESET_ANCHORS`, `ANCHOR_LABELS`. |
| `types.ts` | Add `CategoryDef`, `CategoryMap`. Add `anchorText` field to `TrainingLabel`. |
| `background.ts` | `embedPresetAnchors()` → `embedActiveCategories()`: reads `active_category_ids` + `category_defs` from storage, embeds `anchorText`. Writes `category_map` to storage. Broadcasts `CATEGORIES_CHANGED`. |
| `background.ts` | `rankPresets()` → returns `PresetRank` with `.anchor` = category ID (not anchorText). |
| `background.ts` | All label write paths (`SAVE_LABEL`, `IMPORT_X_LABELS`, `SET_LABELS`): stamp `anchorText` via shared `stampAnchorText()` helper. |
| `background.ts` | Replace wipe-on-mismatch with `migrateLabels()`. Unknown legacy anchors get archived custom defs. |
| `background.ts` | Focus lens reconciliation: if `currentAnchor` is deactivated, auto-switch to first active ID. |
| `background.ts` | `LENS_PROFILES` stays for original 5; generic fallback for others. |
| `csv-export.ts` | Use `label.anchorText` (frozen at label time) for CSV anchor column. Fallback to looking up category def if `anchorText` is missing (pre-migration labels). |
| `widget.ts` | Load `CategoryMap` from storage at init + subscribe `storage.onChanged`. Replace `ANCHOR_LABELS[x]` with `categoryMap[x]?.label ?? x`. |
| `popup.ts` | Load `CategoryMap` from storage at init + subscribe `storage.onChanged`. Replace `ANCHOR_LABELS[x]` with `categoryMap[x]?.label ?? x`. Add category picker UI. |
| Content scripts | Load `CategoryMap` + subscribe `storage.onChanged`. Listen for `CATEGORIES_CHANGED` → `rescoreVisibleItems()`. |
| `LABEL_SCHEMA_VERSION` | Bump to 3. |

## Phase 2: Custom Category Creation (beta)

**Goal**: Users can create their own categories with a name + anchor phrase.

### Additional constraints

- Max 10 total custom categories
- Show "untrained" badge until >= 3 positive AND >= 3 negative labels exist
- Warning: "New categories work best after you label some examples and retrain"
- Anchor phrase guidance: "Use 1–3 words that describe the topic"
- Custom category IDs: UUID generated at creation time, immutable

### Delete = archive

- Deleting sets `archived: true` on the `CategoryDef`
- Archived categories excluded from UI, scoring, and `category_map`
- Labels referencing archived categories preserved (training data integrity)
- User can restore archived categories

## Phase 3: Seed-Example Mode (deferred)

Deferred until usage data proves demand. Would replace single anchorText embedding with averaged centroid from 3–5 example URLs.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Bad anchor text → poor rankings | Phase 1 curated only; Phase 2 has guidance + untrained badge |
| Category lifecycle corrupts training data | Immutable IDs; archive not delete; frozen anchorText per label (RD-6, RD-10) |
| Too many active categories dilute confidence | Cap at 8 active; UI enforces |
| New categories are "cold" | Untrained badge; base model zero-shot verified (see validation above) |
| anchorText editing orphans labels | Frozen `label.anchorText` at all write paths: SAVE_LABEL, IMPORT, SET (RD-6, RD-10) |
| UI shows raw IDs | `CategoryMap` in storage + `storage.onChanged` subscription (RD-2, RD-11) |
| Schema migration vs wipe | Migration function replaces wipe (RD-3); unknown anchors get archived defs (RD-9) |
| Stale scores after category toggle | `CATEGORIES_CHANGED` broadcast triggers `rescoreVisibleItems()` in content scripts (RD-7) |
| Focus lens points to deactivated category | Auto-switch to first active ID + persist + toast (RD-8) |
| Long-lived tabs show stale labels | `storage.onChanged` listener refreshes `CategoryMap` in-place (RD-11) |
| Imported labels lack anchorText | Shared `stampAnchorText()` helper covers all write paths (RD-10) |

## Implementation Plan (Phase 1)

### Step 1: Schema & types

Files: `constants.ts`, `types.ts`

- Add `CategoryDef`, `CategoryMap` types to `types.ts`
- Add `BUILTIN_CATEGORIES` array (25 entries) to `constants.ts` with immutable IDs (RD-1)
- Add `DEFAULT_ACTIVE_IDS`, `LEGACY_ANCHOR_MAP` to `constants.ts`
- Add `MSG.CATEGORIES_CHANGED` message type (RD-7)
- Add `anchorText` field to `TrainingLabel` interface (RD-6)
- Add storage keys: `CATEGORY_DEFS`, `ACTIVE_CATEGORY_IDS`, `CATEGORY_MAP`
- Remove `PRESET_ANCHORS` and `ANCHOR_LABELS` from constants
- Bump `LABEL_SCHEMA_VERSION` to 3

### Step 2: Migration system

Files: `background.ts` (or new `migrations.ts`)

- Replace wipe-on-mismatch block with `migrateLabels(from, to)` (RD-3)
- v2→v3 migration: for each label, map `label.anchor` via `LEGACY_ANCHOR_MAP` to new category ID; add `label.anchorText` from the old anchor string
- Unknown anchors (not in `LEGACY_ANCHOR_MAP`): auto-create archived `CategoryDef` with `id: "legacy-{lowercase}"` and remap label's anchor to the new ID (RD-9)
- On first run (no existing labels): set version to 3, write `BUILTIN_CATEGORIES` + `DEFAULT_ACTIVE_IDS` to storage
- Keep wipe as fallback only if migration encounters corruption

### Step 3: Background — dynamic category embedding + label stamping

Files: `background.ts`

- Replace `embedPresetAnchors()` with `embedActiveCategories()`:
  1. Read `active_category_ids` from storage (default: `DEFAULT_ACTIVE_IDS`)
  2. Look up each ID in `BUILTIN_CATEGORIES` (later: also custom defs from storage)
  3. Embed each category's `anchorText`
  4. Store in `presetEmbeddings` Map keyed by category ID
  5. Write `CategoryMap` to storage for UI contexts (RD-2)
  6. Broadcast `MSG.CATEGORIES_CHANGED` to all contexts (RD-7)
- `rankPresets()` logic unchanged (iterates `presetEmbeddings.entries()`) — keys are now category IDs
- Shared `stampAnchorText(label, categoryMap)` helper for freezing anchorText (RD-6, RD-10):
  - Used by `SAVE_LABEL`, `IMPORT_X_LABELS`, and `SET_LABELS` handlers
  - Looks up `anchorText` from `CategoryMap` by `label.anchor`, writes to `label.anchorText`
- Focus lens reconciliation (RD-8): after `active_category_ids` changes, if `currentAnchor` is not in new active set → auto-switch to `newActiveIds[0]`, persist to storage
- `LENS_PROFILES` stays keyed by category ID for original 5; `buildExplanation()` falls back to generic score-band-only for unknown IDs (RD-5)

### Step 4: UI contexts — CategoryMap plumbing + live refresh

Files: `widget.ts`, `popup.ts`, `label-buttons.ts`, content scripts

- Each UI context loads `CategoryMap` from `chrome.storage.local` at init
- Subscribe to `chrome.storage.onChanged` for `CATEGORY_MAP` key → refresh local `categoryMap` variable (RD-11)
- Replace all `ANCHOR_LABELS[x]` lookups with `categoryMap[x]?.label ?? x` (RD-2)
- `popup.ts` Focus Lens dropdown: populate from `CategoryMap` instead of hardcoded `ANCHOR_LABELS`
- `widget.ts` pill rendering: same pattern

### Step 5: Feed re-score on category change

Files: content scripts (`hn-content.ts`, `reddit-content.ts`, `x-content.ts`), `batch-scorer.ts`

- Content scripts listen for `MSG.CATEGORIES_CHANGED` via `chrome.runtime.onMessage` (RD-7)
- On receipt: call `rescoreVisibleItems()` which re-collects text from all tracked DOM elements and sends a fresh `SCORE_TEXTS` batch
- This reuses existing scoring path — no new inference logic, just re-triggers the batch
- Popup listens for `CATEGORIES_CHANGED` to refresh page score + pills

### Step 6: Category picker UI

Files: `popup.ts`, `popup.html`, `popup.css`

- Add "Manage Categories" section in popup (or options page)
- Show all `BUILTIN_CATEGORIES` grouped by `group` field (Tech / Lifestyle / World)
- Toggle switches for active/inactive
- Enforce max 8 active, min 1
- On change: update `active_category_ids` in storage → background picks up via storage listener or direct message → re-embeds → broadcasts `CATEGORIES_CHANGED`
- If deactivating the current Focus Lens, show toast: "Focus switched to [label] — previous lens was deactivated" (RD-8)

### Step 7: CSV export update

Files: `csv-export.ts`

- Use `label.anchorText` for CSV anchor column (frozen at label time) (RD-6)
- Fallback for pre-migration labels missing `anchorText`: look up from `CategoryMap` by `label.anchor`
- If category archived/deleted, still export using the frozen anchorText (data integrity)

### Step 8: Verification

- Existing labels migrate correctly (v2→v3, spot check known + unknown anchors)
- Legacy unknown anchors appear as archived defs in category manager (RD-9)
- Default active set produces same scoring behavior as current hardcoded presets
- Category picker toggle propagates: re-embed + `CATEGORIES_CHANGED` → content scripts re-score visible items (RD-7)
- Deactivating the Focus Lens category auto-switches to first active + toast (RD-8)
- Pills display correct labels in both fresh and long-lived tabs (RD-2, RD-11)
- `CategoryMap` updates propagate to open tabs without reload (RD-11)
- CSV export uses frozen `anchorText` for both clicked and imported labels (RD-6, RD-10)
- Lens explanation works for original 5, falls back gracefully for new categories (RD-5)
- Imported labels (IMPORT_X_LABELS) have `anchorText` stamped (RD-10)
