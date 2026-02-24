# Label Manager Page (`labels.html`)

**Date:** 2026-02-23
**Status:** Approved (revised after review)

## Goal

Full-page label browser and triage tool. Users can view all training labels in a filterable table, make inline edits (flip polarity, reassign category, edit text, delete), and manually add new labels by pasting a URL or text.

## Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  My Labels                           [+ Add Label] btn  │
│  142 labels · 89 pos · 53 neg                           │
├─────────────────────────────────────────────────────────┤
│  ┌─ Add Label (collapsible, hidden by default) ───────┐ │
│  │  [URL or text...........................] [Fetch]   │ │
│  │  Preview: "The Rise of Rust in Production Systems"  │ │
│  │  Category: [AI Research ▾] (auto-suggested)         │ │
│  │  Polarity: [👍 Positive] [👎 Negative]              │ │
│  │  [Save Label]                                       │ │
│  └────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  Filters: [All categories ▾] [All ▾] [All sources ▾]   │
│           [Search text............]        142 shown     │
├─────────────────────────────────────────────────────────┤
│  # │ Text (click to edit)    │ ± │ Category  │ Src │ ✕  │
│  1 │ The Rise of Rust in ... │ 👍│ Deep Tech │ HN  │ ✕  │
│  2 │ Why I quit my job at... │ 👎│ Startups  │ web │ ✕  │
│  3 │ New CRISPR variant d... │ 👍│ Science   │ red │ ✕  │
│  …                                                      │
└─────────────────────────────────────────────────────────┘
```

## Table Columns

| Column | Width | Behavior |
|--------|-------|----------|
| `#` | 30px | Row number within current filter view |
| **Text** | flex | Truncated to 1 line. Click → contenteditable. Blur saves via `UPDATE_LABEL`. |
| **Polarity** | 32px | 👍/👎 pill. Click toggles + saves via `UPDATE_LABEL`. |
| **Category** | 110px | Chip. Click → inline `<select>` of active categories. Change saves via `UPDATE_LABEL`. |
| **Source** | 40px | Read-only badge (HN, red, X, web, imp) |
| **Delete** | 24px | ✕ button. Click → `DELETE_LABEL` + toast with undo. |

Labels sorted newest-first. No timestamp column (compact); filters cover slicing needs.

## Filter Bar

Three dropdowns + text search, all AND'd:

- **Category**: "All categories" + each active category with count
- **Polarity**: "All" / "Positive" / "Negative"
- **Source**: "All sources" / "HN" / "Reddit" / "X" / "Import" / "Web"
- **Search**: substring match against label text
- Counter: "N shown" (of total)

## Add Label Form

- `[+ Add Label]` button toggles a panel above the table (hidden by default)
- Text input accepts URL (`http(s)://` prefix detected) or raw text
- **URL flow**: `[Fetch]` button → background fetches page `<title>` → editable preview field. If fetch fails (CORS/network), falls back to using the pasted text with a message "Couldn't fetch title — using input as text".
- **Text flow**: preview shows text directly, editable
- Once text resolved, auto-score against active categories via `MSG.SCORE_TEXTS` → pre-select top match. If model not ready, fall back to manual category dropdown with no pre-selection.
- Polarity: two toggle buttons (positive/negative), one required
- `[Save Label]` → `MSG.SAVE_LABEL` → re-fetch labels and re-render table

## Data Flow

All mutations go through background message handlers that use `enqueueLabelWrite` for atomic read-modify-write, preventing lost updates from concurrent feed labeling or imports.

| Operation | Mechanism |
|-----------|-----------|
| **Read** | `init()` loads labels via `MSG.GET_LABELS`, renders table |
| **Edit** | `MSG.UPDATE_LABEL` — background finds label by `text+timestamp` composite key, mutates in place via `enqueueLabelWrite`. Text edits re-run anchor resolution (embed + rank). |
| **Delete** | `MSG.DELETE_LABEL` — background finds and splices via `enqueueLabelWrite`, returns deleted label in response. Client stashes it and shows toast with undo (restores via `MSG.RESTORE_LABEL` for exact-object reinsertion at chronological position). |
| **Add** | `MSG.SAVE_LABEL` (existing) → re-fetch labels and render |

### Label Identity

Labels have no unique ID field. Mutations use `text + timestamp` as a composite key for matching. This is practically unique (ms-precision timestamp + full text). The background handlers match on both fields and operate on the first match.

### Stale Metadata on Text Edit

When `UPDATE_LABEL` receives a text change, the handler re-embeds the new text and re-runs `rankPresets()` to update `autoAnchor`, `autoConfidence`, and `anchorSource`. This mirrors the `SAVE_LABEL` anchor resolution flow.

## File Changes

| File | Change |
|------|--------|
| `public/labels.html` | New page: HTML structure + CSS (follows taste.html pattern) |
| `src/labels/labels.ts` | New: table rendering, inline editing, filters, add-label form |
| `build.mjs` | Add `labels.ts` IIFE build target |
| `public/popup.html` | Add "Manage labels" link in training data fold |
| `src/popup/popup.ts` | Wire link to open `labels.html` in new tab |
| `src/shared/constants.ts` | Add `FETCH_PAGE_TITLE`, `UPDATE_LABEL`, `DELETE_LABEL`, `RESTORE_LABEL` to `MSG` |
| `src/shared/types.ts` | Add `UpdateLabelPayload`, `DeleteLabelPayload`, `FetchPageTitlePayload` |
| `src/background/background.ts` | Add `FETCH_PAGE_TITLE`, `UPDATE_LABEL`, `DELETE_LABEL`, `RESTORE_LABEL` handlers |

## Out of Scope

- Bulk select / bulk delete
- Column sorting (fixed newest-first)
