# Label Manager Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full-page label browser (`labels.html`) with filterable table, inline editing (flip polarity, reassign category, edit text, delete), and manual label entry via URL/text with auto-category scoring.

**Architecture:** New IIFE build target (`src/labels/labels.ts` → `dist/labels.js`), loaded by `public/labels.html`. Same pattern as `taste.html`/`taste.ts`. All mutations go through background message handlers using `enqueueLabelWrite` for atomic read-modify-write (no full-array SET_LABELS). New messages: `UPDATE_LABEL` (surgical edit by composite key), `DELETE_LABEL` (surgical remove), `FETCH_PAGE_TITLE` (URL → title extraction).

**Tech Stack:** TypeScript, Chrome Extension APIs (`chrome.runtime.sendMessage`, `chrome.storage.local`), vanilla DOM.

---

### Task 1: Add new message types and payload types

**Files:**
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/types.ts`

**Step 1: Add message types to MSG**

In `src/shared/constants.ts`, add to the `MSG` object after `COMPUTE_TASTE_PROFILE`:

```ts
  // Label manager
  FETCH_PAGE_TITLE: "FETCH_PAGE_TITLE",
  UPDATE_LABEL: "UPDATE_LABEL",
  DELETE_LABEL: "DELETE_LABEL",
```

**Step 2: Add payload types**

In `src/shared/types.ts`, after `SetLabelsPayload`:

```ts
/** Payload for UPDATE_LABEL — identifies label by text+timestamp composite key */
export interface UpdateLabelPayload {
  /** Original text for matching */
  matchText: string;
  /** Original timestamp for matching */
  matchTimestamp: number;
  /** Fields to update (partial) */
  updates: {
    text?: string;
    label?: "positive" | "negative";
    anchor?: string;
  };
}

/** Payload for DELETE_LABEL — identifies label by text+timestamp composite key */
export interface DeleteLabelPayload {
  matchText: string;
  matchTimestamp: number;
}

/** Payload for FETCH_PAGE_TITLE */
export interface FetchPageTitlePayload {
  url: string;
}
```

**Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```
feat(labels): add UPDATE_LABEL, DELETE_LABEL, FETCH_PAGE_TITLE message types and payloads
```

---

### Task 2: Add background handlers for UPDATE_LABEL, DELETE_LABEL, FETCH_PAGE_TITLE

**Files:**
- Modify: `src/background/background.ts`

**Step 1: Add FETCH_PAGE_TITLE handler**

Add a new case in the message handler switch, after `MSG.IMPORT_X_LABELS`:

```ts
      case MSG.FETCH_PAGE_TITLE: {
        const { url } = (payload ?? {}) as FetchPageTitlePayload;
        if (!url || typeof url !== "string") {
          sendResponse({ error: "Invalid URL" });
          return;
        }
        (async () => {
          const resp = await fetch(url, {
            headers: { "Accept": "text/html" },
            redirect: "follow",
          });
          const html = await resp.text();
          const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = match ? match[1].trim() : "";
          sendResponse({ title });
        })().catch((err) => sendResponse({ error: String(err) }));
        return true;
      }
```

**Step 2: Add DELETE_LABEL handler**

```ts
      case MSG.DELETE_LABEL: {
        const { matchText, matchTimestamp } = (payload ?? {}) as DeleteLabelPayload;
        if (!matchText || !matchTimestamp) {
          sendResponse({ error: "Invalid delete payload" });
          return;
        }
        enqueueLabelWrite((labels) =>
          labels.filter((l) => !(l.text === matchText && l.timestamp === matchTimestamp)),
        )
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }
```

**Step 3: Add UPDATE_LABEL handler**

This handler finds the label by composite key, applies partial updates, and re-runs anchor resolution if text changed.

```ts
      case MSG.UPDATE_LABEL: {
        const { matchText, matchTimestamp, updates } = (payload ?? {}) as UpdateLabelPayload;
        if (!matchText || !matchTimestamp || !updates) {
          sendResponse({ error: "Invalid update payload" });
          return;
        }
        (async () => {
          // If text changed, re-run anchor resolution
          let newAnchor: string | undefined;
          let newAutoAnchor: string | undefined;
          let newAutoConfidence: number | undefined;
          let newAnchorSource: "auto" | "override" | "fallback" | undefined;

          const textChanged = updates.text !== undefined && updates.text !== matchText;
          const anchorChanged = updates.anchor !== undefined;

          if (textChanged && modelReady) {
            try {
              const [textEmb] = await embed([updates.text!.replace(/\s+/g, " ").trim()]);
              const ranking = rankPresets(textEmb);
              if (ranking) {
                newAutoAnchor = ranking.top.anchor;
                newAutoConfidence = ranking.confidence;
                // If user also set anchor explicitly, keep it as override
                if (anchorChanged) {
                  newAnchor = updates.anchor;
                  newAnchorSource = "override";
                } else {
                  newAnchor = ranking.top.anchor;
                  newAnchorSource = "auto";
                }
              }
            } catch {
              // Scoring failed — keep existing anchor metadata
            }
          }

          await enqueueLabelWrite((labels) => {
            const idx = labels.findIndex(
              (l) => l.text === matchText && l.timestamp === matchTimestamp,
            );
            if (idx === -1) return labels;

            const label = labels[idx];
            if (updates.text !== undefined) label.text = updates.text;
            if (updates.label !== undefined) label.label = updates.label;
            if (anchorChanged && !textChanged) {
              label.anchor = updates.anchor!;
              label.anchorSource = "override";
            }
            if (newAnchor !== undefined) label.anchor = newAnchor;
            if (newAutoAnchor !== undefined) label.autoAnchor = newAutoAnchor;
            if (newAutoConfidence !== undefined) label.autoConfidence = newAutoConfidence;
            if (newAnchorSource !== undefined) label.anchorSource = newAnchorSource;

            // Re-stamp anchorText for training integrity
            labels[idx] = stampAnchorText(label, currentCategoryMap);
            return labels;
          });
          sendResponse({ success: true });
        })().catch((err) => sendResponse({ error: String(err) }));
        return true;
      }
```

**Step 4: Add imports**

Add `UpdateLabelPayload`, `DeleteLabelPayload`, `FetchPageTitlePayload` to the import from `../shared/types`.

**Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

**Step 6: Commit**

```
feat(labels): add UPDATE_LABEL, DELETE_LABEL, FETCH_PAGE_TITLE background handlers
```

---

### Task 3: Create labels.html page

**Files:**
- Create: `public/labels.html`

Create the full HTML page with embedded CSS. Follow the taste.html design system exactly (same CSS variables for light/dark, same font stack, same `--bg`, `--surface`, `--border`, `--accent`, etc.).

Key DOM structure:
- `.page-header` — h1 "My Labels" + `#subtitle` + `#add-label-toggle` button
- `#add-panel` — collapsible add-label form (hidden by default) with:
  - `.add-input-row` — text input + Fetch button
  - `#add-preview-row` — editable preview text input (hidden until fetch/resolve)
  - `#add-category-row` — category select dropdown (hidden until text resolved)
  - `#add-polarity-row` — polarity toggle buttons (hidden until text resolved)
  - `#add-save` — Save Label button (hidden until all fields filled)
  - `#add-status` — status messages (fetch errors, scoring status)
- `#filter-bar` — category select + polarity select + source select + search input + count
- `#empty` — loading/empty state
- `#table` — label rows container
- `#toast-container` — for delete undo toasts

Key CSS classes:
- `.page-header` — flex, space-between
- `.add-panel` — bordered surface box, flex column, gap 10px, padding 16px
- `.add-input-row` — flex, gap 6px
- `.add-field-label` — 10px, uppercase, color text-dim, flex 0 0 70px
- `.polarity-btn` — pill-style toggle; `.polarity-btn.active` uses accent
- `.filter-bar` — flex, gap 8px, margin-bottom 12px
- `.filter-bar select, .filter-bar input` — matching styled inputs
- `.label-row` — flex, align center, gap 8px, 12px mono font, border-bottom
- `.label-text` — flex:1, truncated; `.label-text.editing` editable state
- `.label-polarity` — clickable pill; `.positive` = accent, `.negative` = muted
- `.label-category` — chip style, clickable; inline select on click
- `.label-source` — read-only dim badge
- `.label-delete` — dim × button, hover danger
- `.toast-container` + `.toast` — fixed bottom, same as popup.css pattern

**Commit:**

```
feat(labels): create labels.html page structure and styles
```

---

### Task 4: Add labels.ts IIFE build target

**Files:**
- Create: `src/labels/labels.ts` (minimal stub)
- Modify: `build.mjs`

**Step 1: Create stub**

```ts
/** Full-page label manager. */
console.log("labels.ts loaded");
```

**Step 2: Add to build.mjs iifeEntries**

After the taste entry:

```ts
  { name: "labels", entry: resolve(__dirname, "src/labels/labels.ts") },
```

**Step 3: Build**

Run: `npm run build`
Expected: PASS, `dist/labels.js` + `dist/labels.html` in output

**Step 4: Commit**

```
feat(labels): add labels.ts build target
```

---

### Task 5: Add "Manage labels" link in popup

**Files:**
- Modify: `public/popup.html`
- Modify: `public/popup.css`
- Modify: `src/popup/popup.ts`

**Step 1: Add DOM element**

In `popup.html`, inside `.fold-data .fold-content`, after `#anchor-gap-hints` and before `.button-group`:

```html
        <a id="labels-full-link" class="labels-full-link" href="#">Manage labels &rarr;</a>
```

**Step 2: Add CSS**

In `popup.css`, add (reuse taste-full-link pattern):

```css
.labels-full-link {
  display: block;
  margin-top: 6px;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--accent);
  text-decoration: none;
  cursor: pointer;
  transition: opacity 0.15s;
}

.labels-full-link:hover {
  opacity: 0.75;
}
```

**Step 3: Wire in popup.ts**

Add DOM ref near other element declarations:

```ts
const labelsFullLink = document.getElementById("labels-full-link") as HTMLAnchorElement;
```

In `init()`, after `tasteFullLink` handler:

```ts
  labelsFullLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("labels.html") });
  });
```

**Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

**Step 5: Commit**

```
feat(labels): add "Manage labels" link in popup training data fold
```

---

### Task 6: Implement labels.ts — data loading, table rendering, filters

**Files:**
- Modify: `src/labels/labels.ts`

Replace stub with full implementation.

**Imports:**

```ts
import { MSG, STORAGE_KEYS } from "../shared/constants";
import type { TrainingLabel, CategoryMap } from "../shared/types";
```

**DOM references:** All elements from labels.html (#subtitle, #empty, #table, #filter-category, #filter-polarity, #filter-source, #filter-search, #filter-count, #toast-container).

**Module state:**

```ts
let allLabels: TrainingLabel[] = [];
let categoryMap: CategoryMap = {};

const SOURCE_DISPLAY: Record<string, string> = {
  hn: "HN", reddit: "red", x: "X", "x-import": "imp", web: "web",
};
```

**Key functions:**

- `loadLabels()` — `MSG.GET_LABELS` → store `allLabels` (sorted newest-first by timestamp) → `renderTable()` + `updateSubtitle()` + `populateFilterOptions()`
- `updateSubtitle()` — "N labels · P pos · Q neg"
- `populateFilterOptions()` — fill category and source selects from `allLabels` (with counts)
- `getFilteredLabels()` — apply category/polarity/source/search filters, return subset
- `renderTable()` — clear `#table`, create rows via `createRow()` for each filtered label, update `#filter-count`
- `createRow(label, globalIndex, displayIndex)` — `.label-row` with:
  - **Rank**: display index
  - **Text**: span, truncated. Click → set `contentEditable = "true"`, add `.editing`. Blur → read `textContent`, if changed send `MSG.UPDATE_LABEL` with `{ matchText: original, matchTimestamp, updates: { text: newText } }`, then `loadLabels()`
  - **Polarity**: pill showing 👍/👎. Click → send `MSG.UPDATE_LABEL` with `{ updates: { label: flipped } }`, then `loadLabels()`
  - **Category**: chip with label. Click → replace chip with `<select>` of active categories (current selected). Change → send `MSG.UPDATE_LABEL` with `{ updates: { anchor: newId } }`, then `loadLabels()`. Blur (no change) → revert to chip.
  - **Source**: read-only badge text
  - **Delete**: × button. Click → stash label, send `MSG.DELETE_LABEL` → `loadLabels()` → show toast "Deleted — Undo". Undo click → `MSG.RESTORE_LABEL` with stashed label → `loadLabels()`.
- `showToast(message, options)` — same pattern as popup.ts (type, duration, actionLabel, onAction)

**Filter wiring in init():**

```ts
filterCategory.addEventListener("change", renderTable);
filterPolarity.addEventListener("change", renderTable);
filterSource.addEventListener("change", renderTable);
filterSearch.addEventListener("input", renderTable);
```

**init():**

```ts
async function init(): Promise<void> {
  const catStore = await chrome.storage.local.get(STORAGE_KEYS.CATEGORY_MAP);
  categoryMap = (catStore[STORAGE_KEYS.CATEGORY_MAP] as CategoryMap) ?? {};
  await loadLabels();
  // wire filters + toggle
}
```

**Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

**Step 3: Commit**

```
feat(labels): implement table rendering, inline editing, filters, and delete with undo
```

---

### Task 7: Implement labels.ts — Add Label form

**Files:**
- Modify: `src/labels/labels.ts`

**Additional DOM refs:** #add-label-toggle, #add-panel, #add-input, #add-fetch, #add-preview-row, #add-preview, #add-category-row, #add-category, #add-polarity-row, #add-pos, #add-neg, #add-save, #add-status.

**Module state:**

```ts
let addPolarity: "positive" | "negative" | null = null;
```

**Key functions:**

- `toggleAddPanel()` — show/hide `#add-panel`, reset form state
- `handleFetchOrResolve()` — triggered by Fetch click or Enter in input:
  - If input matches `^https?://`, send `MSG.FETCH_PAGE_TITLE`. On success: show title in editable `#add-preview`. On error: show input text as preview + status message "Couldn't fetch title — using input as text".
  - Else: use raw text as preview directly.
  - Then auto-score: send `MSG.SCORE_TEXTS` with `[previewText]`. On success: populate `#add-category` select sorted by ranking score desc, pre-select top. On error (model not ready): populate categories alphabetically, no pre-selection, show status "Model not ready — pick category manually".
  - Show preview, category, polarity, and save rows.
- `handlePolarityClick(value)` — toggle `.active` class, set `addPolarity`
- `handleAddSave()` — validate (text, category, polarity all set) → send `MSG.SAVE_LABEL` with constructed label (`source: "web"`, `timestamp: Date.now()`) → `loadLabels()` → collapse panel, clear form, show success toast

**Wiring in init():**

```ts
addToggle.addEventListener("click", toggleAddPanel);
addFetch.addEventListener("click", handleFetchOrResolve);
addInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleFetchOrResolve();
});
addPos.addEventListener("click", () => handlePolarityClick("positive"));
addNeg.addEventListener("click", () => handlePolarityClick("negative"));
addSave.addEventListener("click", handleAddSave);
```

**Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

**Step 3: Commit**

```
feat(labels): implement add-label form with URL fetch and auto-category scoring
```

---

### Task 8: Final build + verify

**Step 1: Full typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS, dist/ contains labels.js and labels.html

**Step 2: Manual verification checklist**

Load extension in Chrome:
1. Open popup → Training Data fold → "Manage labels →" opens labels.html in new tab
2. Table shows all labels, newest first
3. Subtitle shows count summary
4. Filter by category → table updates, count updates
5. Filter by polarity → works
6. Filter by source → works
7. Search → filters by substring
8. Click polarity pill → flips, saves immediately (reloads table)
9. Click category chip → dropdown appears → change saves with new category
10. Click text → becomes editable → blur saves (if changed, anchor re-resolved)
11. Click × → label removed → toast appears with Undo → undo restores label
12. Click "+ Add Label" → panel appears
13. Paste URL → Fetch → title in preview (or fallback message if fetch fails)
14. Type text → preview shows directly
15. Category auto-selected from model scoring (or manual if model not ready)
16. Pick polarity → Save → label in table, panel collapses
17. Popup radar/taste still works correctly

**Step 3: Commit**

```
feat(labels): label manager page complete
```
