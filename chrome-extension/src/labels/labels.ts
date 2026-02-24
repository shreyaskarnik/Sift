/**
 * Label manager page — full table with inline editing, filters, and delete/undo.
 * Built as IIFE, loaded by public/labels.html.
 */
import { MSG, STORAGE_KEYS, DEFAULT_QUERY_ANCHOR } from "../shared/constants";
import { exportToCSV, countExportableTriplets } from "../storage/csv-export";
import type {
  TrainingLabel,
  CategoryMap,
  UpdateLabelPayload,
  DeleteLabelPayload,
  PresetRanking,
  SaveLabelPayload,
} from "../shared/types";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const subtitleEl = document.getElementById("subtitle") as HTMLDivElement;
const tableEl = document.getElementById("table") as HTMLDivElement;
const emptyEl = document.getElementById("empty") as HTMLDivElement;
const toastContainer = document.getElementById("toast-container") as HTMLDivElement;
const filterCategory = document.getElementById("filter-category") as HTMLSelectElement;
const filterPolarity = document.getElementById("filter-polarity") as HTMLSelectElement;
const filterSource = document.getElementById("filter-source") as HTMLSelectElement;
const filterSearch = document.getElementById("filter-search") as HTMLInputElement;
const filterCount = document.getElementById("filter-count") as HTMLSpanElement;

const exportCsvBtn = document.getElementById("export-csv") as HTMLButtonElement;

// --- Add Label panel ---
const addToggle = document.getElementById("add-label-toggle") as HTMLButtonElement;
const addPanel = document.getElementById("add-panel") as HTMLDivElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const addFetch = document.getElementById("add-fetch") as HTMLButtonElement;
const addPreviewRow = document.getElementById("add-preview-row") as HTMLDivElement;
const addPreview = document.getElementById("add-preview") as HTMLInputElement;
const addCategoryRow = document.getElementById("add-category-row") as HTMLDivElement;
const addCategorySelect = document.getElementById("add-category") as HTMLSelectElement;
const addPolarityRow = document.getElementById("add-polarity-row") as HTMLDivElement;
const addPos = document.getElementById("add-pos") as HTMLButtonElement;
const addNeg = document.getElementById("add-neg") as HTMLButtonElement;
const addSave = document.getElementById("add-save") as HTMLButtonElement;
const addStatus = document.getElementById("add-status") as HTMLSpanElement;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let allLabels: TrainingLabel[] = [];
let categoryMap: CategoryMap = {};
let activeIds: string[] = [];
let addPolarity: "positive" | "negative" | null = null;
let addRanking: PresetRanking | undefined;

/** Sends a message and throws if the response contains an error field. */
async function sendMsg(msg: { type: string; payload?: unknown }): Promise<Record<string, unknown>> {
  const resp = (await chrome.runtime.sendMessage(msg)) as Record<string, unknown>;
  if (resp?.error) throw new Error(String(resp.error));
  return resp;
}

const SOURCE_DISPLAY: Record<string, string> = {
  hn: "HN",
  reddit: "red",
  x: "X",
  "x-import": "imp",
  web: "web",
};

// ---------------------------------------------------------------------------
// loadLabels
// ---------------------------------------------------------------------------
async function loadLabels(): Promise<void> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.GET_LABELS });
    const labels = (resp as { labels: TrainingLabel[] }).labels ?? [];
    labels.sort((a, b) => b.timestamp - a.timestamp);
    allLabels = labels;
  } catch {
    allLabels = [];
  }

  renderTable();
  updateSubtitle();
  populateFilterOptions();
}

// ---------------------------------------------------------------------------
// updateSubtitle
// ---------------------------------------------------------------------------
function updateSubtitle(): void {
  const total = allLabels.length;
  const pos = allLabels.filter((l) => l.label === "positive").length;
  const neg = allLabels.filter((l) => l.label === "negative").length;
  subtitleEl.textContent = `${total} labels \u00B7 ${pos} pos \u00B7 ${neg} neg`;
}

// ---------------------------------------------------------------------------
// populateFilterOptions
// ---------------------------------------------------------------------------
function populateFilterOptions(): void {
  const prevCat = filterCategory.value;
  const prevSrc = filterSource.value;
  const polVal = filterPolarity.value;
  const searchVal = filterSearch.value.trim().toLowerCase();

  // Faceted counts: each dropdown counts labels matching the OTHER filters
  // Category counts: filtered by polarity + source + search (not category)
  const catCounts: Record<string, number> = {};
  for (const l of allLabels) {
    if (polVal && l.label !== polVal) continue;
    if (prevSrc && l.source !== prevSrc) continue;
    if (searchVal && !l.text.toLowerCase().includes(searchVal)) continue;
    catCounts[l.anchor] = (catCounts[l.anchor] ?? 0) + 1;
  }

  while (filterCategory.options.length > 1) {
    filterCategory.remove(1);
  }

  const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  for (const [anchor, count] of catEntries) {
    const opt = document.createElement("option");
    opt.value = anchor;
    const displayName = categoryMap[anchor]?.label ?? anchor;
    opt.textContent = `${displayName} (${count})`;
    filterCategory.appendChild(opt);
  }

  if (prevCat && Array.from(filterCategory.options).some((o) => o.value === prevCat)) {
    filterCategory.value = prevCat;
  }

  // Source counts: filtered by polarity + category + search (not source)
  const srcCounts: Record<string, number> = {};
  for (const l of allLabels) {
    if (polVal && l.label !== polVal) continue;
    if (prevCat && l.anchor !== prevCat) continue;
    if (searchVal && !l.text.toLowerCase().includes(searchVal)) continue;
    srcCounts[l.source] = (srcCounts[l.source] ?? 0) + 1;
  }

  while (filterSource.options.length > 1) {
    filterSource.remove(1);
  }

  const srcEntries = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]);
  for (const [source, count] of srcEntries) {
    const opt = document.createElement("option");
    opt.value = source;
    opt.textContent = `${SOURCE_DISPLAY[source] ?? source} (${count})`;
    filterSource.appendChild(opt);
  }

  if (prevSrc && Array.from(filterSource.options).some((o) => o.value === prevSrc)) {
    filterSource.value = prevSrc;
  }
}

// ---------------------------------------------------------------------------
// getFilteredLabels
// ---------------------------------------------------------------------------
function getFilteredLabels(): TrainingLabel[] {
  const catVal = filterCategory.value;
  const polVal = filterPolarity.value;
  const srcVal = filterSource.value;
  const searchVal = filterSearch.value.trim().toLowerCase();

  return allLabels.filter((l) => {
    if (catVal && l.anchor !== catVal) return false;
    if (polVal && l.label !== polVal) return false;
    if (srcVal && l.source !== srcVal) return false;
    if (searchVal && !l.text.toLowerCase().includes(searchVal)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// renderTable
// ---------------------------------------------------------------------------
function renderTable(): void {
  populateFilterOptions(); // refresh faceted counts
  tableEl.replaceChildren();

  const filtered = getFilteredLabels();

  filterCount.textContent = `${filtered.length} shown`;

  if (filtered.length === 0) {
    if (allLabels.length === 0) {
      emptyEl.textContent = "No labels yet.";
    } else {
      emptyEl.textContent = "No labels match the current filters.";
    }
    emptyEl.style.display = "";
    return;
  }

  emptyEl.style.display = "none";

  for (let i = 0; i < filtered.length; i++) {
    tableEl.appendChild(createRow(filtered[i], i + 1));
  }
}

// ---------------------------------------------------------------------------
// createRow
// ---------------------------------------------------------------------------
function createRow(label: TrainingLabel, displayIndex: number): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "label-row";

  // --- Rank ---
  const rankSpan = document.createElement("span");
  rankSpan.className = "label-rank";
  rankSpan.textContent = String(displayIndex);

  // --- Text (inline editable) ---
  const textSpan = document.createElement("span");
  textSpan.className = "label-text";
  textSpan.textContent = label.text;
  const originalText = label.text;

  textSpan.addEventListener("click", () => {
    if (textSpan.contentEditable === "true") return;
    textSpan.contentEditable = "true";
    textSpan.classList.add("editing");
    textSpan.focus();

    // Move cursor to end
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(textSpan);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  textSpan.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      textSpan.textContent = originalText;
      textSpan.blur();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      textSpan.blur();
    }
  });

  textSpan.addEventListener("blur", async () => {
    textSpan.classList.remove("editing");
    textSpan.contentEditable = "false";

    const newText = (textSpan.textContent ?? "").trim();
    if (!newText) {
      textSpan.textContent = originalText;
      return;
    }
    if (newText === originalText) return;

    const payload: UpdateLabelPayload = {
      matchText: originalText,
      matchTimestamp: label.timestamp,
      updates: { text: newText },
    };

    try {
      await sendMsg({ type: MSG.UPDATE_LABEL, payload });
      await loadLabels();
    } catch {
      textSpan.textContent = originalText;
      showToast("Failed to update label", { variant: "error" });
    }
  });

  // --- Polarity ---
  const polaritySpan = document.createElement("span");
  polaritySpan.className = "label-polarity";
  polaritySpan.textContent = label.label === "positive" ? "\uD83D\uDC4D" : "\uD83D\uDC4E";

  polaritySpan.addEventListener("click", async () => {
    const flipped: "positive" | "negative" =
      label.label === "positive" ? "negative" : "positive";

    const payload: UpdateLabelPayload = {
      matchText: label.text,
      matchTimestamp: label.timestamp,
      updates: { label: flipped },
    };

    try {
      await sendMsg({ type: MSG.UPDATE_LABEL, payload });
      await loadLabels();
    } catch {
      showToast("Failed to update polarity", { variant: "error" });
    }
  });

  // --- Category ---
  const catSpan = document.createElement("span");
  catSpan.className = "label-category";
  catSpan.textContent = categoryMap[label.anchor]?.label ?? label.anchor;

  catSpan.addEventListener("click", () => {
    // Avoid opening multiple selects
    if (catSpan.querySelector("select")) return;

    const select = document.createElement("select");
    select.style.cssText =
      "font-size:9px;font-family:inherit;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:1px 2px;width:100%;";

    for (const id of activeIds) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = categoryMap[id]?.label ?? id;
      if (id === label.anchor) opt.selected = true;
      select.appendChild(opt);
    }

    // If current anchor is not in activeIds, add it too
    if (!activeIds.includes(label.anchor)) {
      const opt = document.createElement("option");
      opt.value = label.anchor;
      opt.textContent = categoryMap[label.anchor]?.label ?? label.anchor;
      opt.selected = true;
      select.insertBefore(opt, select.firstChild);
    }

    const originalAnchor = label.anchor;
    const chipText = catSpan.textContent;

    catSpan.textContent = "";
    catSpan.appendChild(select);
    select.focus();

    const revert = (): void => {
      catSpan.textContent = chipText;
    };

    select.addEventListener("change", async () => {
      const newAnchor = select.value;
      if (newAnchor === originalAnchor) {
        revert();
        return;
      }

      const payload: UpdateLabelPayload = {
        matchText: label.text,
        matchTimestamp: label.timestamp,
        updates: { anchor: newAnchor },
      };

      try {
        await sendMsg({ type: MSG.UPDATE_LABEL, payload });
        await loadLabels();
      } catch {
        revert();
        showToast("Failed to update category", { variant: "error" });
      }
    });

    select.addEventListener("blur", () => {
      // Only revert if select is still in the DOM (change handler may have replaced it)
      if (catSpan.contains(select)) {
        revert();
      }
    });
  });

  // --- Source ---
  const sourceSpan = document.createElement("span");
  sourceSpan.className = "label-source";
  sourceSpan.textContent = SOURCE_DISPLAY[label.source] ?? label.source;

  // --- Delete ---
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "label-delete";
  deleteBtn.textContent = "\u00D7";

  deleteBtn.addEventListener("click", async () => {
    const stashedLabel = { ...label };

    const deletePayload: DeleteLabelPayload = {
      matchText: label.text,
      matchTimestamp: label.timestamp,
    };

    try {
      const resp = await sendMsg({
        type: MSG.DELETE_LABEL,
        payload: deletePayload,
      });
      if (resp.success) {
        await loadLabels();
        showToast("Deleted", {
          actionLabel: "Undo",
          onAction: async () => {
            try {
              await sendMsg({
                type: MSG.RESTORE_LABEL,
                payload: stashedLabel,
              });
              await loadLabels();
            } catch {
              showToast("Failed to restore label", { variant: "error" });
            }
          },
        });
      }
    } catch {
      showToast("Failed to delete label", { variant: "error" });
    }
  });

  row.append(rankSpan, textSpan, polaritySpan, catSpan, sourceSpan, deleteBtn);
  return row;
}

// ---------------------------------------------------------------------------
// showToast
// ---------------------------------------------------------------------------
interface ToastOptions {
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "success" | "error";
}

function showToast(msg: string, opts?: ToastOptions): void {
  const duration = opts?.duration ?? 5000;
  const variant = opts?.variant ?? "success";

  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = msg;
  toast.appendChild(msgSpan);

  if (opts?.actionLabel && opts.onAction) {
    const actionBtn = document.createElement("button");
    actionBtn.className = "toast-action";
    actionBtn.textContent = opts.actionLabel;
    actionBtn.addEventListener("click", () => {
      opts.onAction!();
      toast.remove();
    });
    toast.appendChild(actionBtn);
  }

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

// ---------------------------------------------------------------------------
// Add Label — panel toggle + form
// ---------------------------------------------------------------------------
function resetAddForm(): void {
  addInput.value = "";
  addPreview.value = "";
  addPreviewRow.style.display = "none";
  addCategoryRow.style.display = "none";
  addPolarityRow.style.display = "none";
  addSave.style.display = "none";
  addStatus.textContent = "";
  addPolarity = null;
  addRanking = undefined;
  addPos.classList.remove("active");
  addNeg.classList.remove("active");
  addCategorySelect.replaceChildren();
}

function toggleAddPanel(): void {
  const visible = addPanel.classList.toggle("visible");
  if (visible) {
    resetAddForm();
    addInput.focus();
  }
}

function populateAddCategories(ranking?: PresetRanking): void {
  addCategorySelect.replaceChildren();

  if (ranking) {
    // Sort by score desc — ranking.ranks is already sorted
    for (const r of ranking.ranks) {
      const opt = document.createElement("option");
      opt.value = r.anchor;
      const name = categoryMap[r.anchor]?.label ?? r.anchor;
      opt.textContent = `${name} (${(r.score * 100).toFixed(0)}%)`;
      addCategorySelect.appendChild(opt);
    }
  } else {
    // No scoring — alphabetical list of active categories, no pre-selection
    const sorted = [...activeIds].sort((a, b) => {
      const aName = categoryMap[a]?.label ?? a;
      const bName = categoryMap[b]?.label ?? b;
      return aName.localeCompare(bName);
    });
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Pick a category...";
    placeholder.disabled = true;
    placeholder.selected = true;
    addCategorySelect.appendChild(placeholder);
    for (const id of sorted) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = categoryMap[id]?.label ?? id;
      addCategorySelect.appendChild(opt);
    }
  }
}

async function handleFetchOrResolve(): Promise<void> {
  const raw = addInput.value.trim();
  if (!raw) return;

  addStatus.textContent = "";
  let resolvedText = raw;

  // URL detection
  if (/^https?:\/\//i.test(raw)) {
    addStatus.textContent = "Fetching title...";
    addFetch.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: MSG.FETCH_PAGE_TITLE,
        payload: { url: raw },
      });
      const typed = resp as { title?: string; error?: string };
      if (typed.title) {
        resolvedText = typed.title;
        addStatus.textContent = "";
      } else {
        addStatus.textContent = "Couldn\u2019t fetch title \u2014 using input as text";
      }
    } catch {
      addStatus.textContent = "Couldn\u2019t fetch title \u2014 using input as text";
    }
    addFetch.disabled = false;
  }

  // Show preview
  addPreview.value = resolvedText;
  addPreviewRow.style.display = "";

  // Auto-score for category suggestion
  addRanking = undefined;
  try {
    const scoreResp = await chrome.runtime.sendMessage({
      type: MSG.SCORE_TEXTS,
      payload: { texts: [resolvedText] },
    });
    const typed = scoreResp as { rankings?: (PresetRanking | undefined)[]; error?: string };
    if (typed.rankings?.[0]) {
      addRanking = typed.rankings[0];
      populateAddCategories(addRanking);
      if (!addStatus.textContent) addStatus.textContent = "";
    } else {
      populateAddCategories();
      if (typed.error) {
        addStatus.textContent = "Model not ready \u2014 pick category manually";
      }
    }
  } catch {
    populateAddCategories();
    addStatus.textContent = "Model not ready \u2014 pick category manually";
  }

  // Show remaining fields
  addCategoryRow.style.display = "";
  addPolarityRow.style.display = "";
  addSave.style.display = "";
}

function handlePolarityClick(value: "positive" | "negative"): void {
  addPolarity = value;
  addPos.classList.toggle("active", value === "positive");
  addNeg.classList.toggle("active", value === "negative");
}

async function handleAddSave(): Promise<void> {
  const text = addPreview.value.trim();
  const anchor = addCategorySelect.value;
  if (!text || !anchor || !addPolarity) {
    showToast("Fill all fields before saving", { variant: "error" });
    return;
  }

  addSave.disabled = true;

  const label: TrainingLabel = {
    text,
    label: addPolarity,
    source: "web",
    timestamp: Date.now(),
    anchor,
  };

  const savePayload: SaveLabelPayload = {
    label,
    anchorOverride: anchor,
    presetRanking: addRanking,
  };

  try {
    await sendMsg({
      type: MSG.SAVE_LABEL,
      payload: savePayload,
    });
    addPanel.classList.remove("visible");
    resetAddForm();
    await loadLabels();
    showToast("Label saved");
  } catch {
    showToast("Failed to save label", { variant: "error" });
  }
  addSave.disabled = false;
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------
function handleExportCsv(): void {
  if (countExportableTriplets(allLabels, DEFAULT_QUERY_ANCHOR) === 0) {
    showToast("No anchor group has both positive and negative labels.", { variant: "error" });
    return;
  }
  const csv = exportToCSV(allLabels, DEFAULT_QUERY_ANCHOR, categoryMap);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sift_training_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  const tripletCount = csv.trimEnd().split("\n").length - 1;
  showToast(`Exported ${tripletCount} triplets.`);
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
async function init(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.CATEGORY_MAP,
    STORAGE_KEYS.ACTIVE_CATEGORY_IDS,
  ]);
  categoryMap = (stored[STORAGE_KEYS.CATEGORY_MAP] as CategoryMap) ?? {};
  activeIds = (stored[STORAGE_KEYS.ACTIVE_CATEGORY_IDS] as string[]) ?? [];

  await loadLabels();

  // Wire filter listeners
  filterCategory.addEventListener("change", renderTable);
  filterPolarity.addEventListener("change", renderTable);
  filterSource.addEventListener("change", renderTable);
  filterSearch.addEventListener("input", renderTable);

  // Wire export + add-label form
  exportCsvBtn.addEventListener("click", handleExportCsv);
  addToggle.addEventListener("click", toggleAddPanel);
  addFetch.addEventListener("click", () => void handleFetchOrResolve());
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void handleFetchOrResolve();
  });
  addPos.addEventListener("click", () => handlePolarityClick("positive"));
  addNeg.addEventListener("click", () => handlePolarityClick("negative"));
  addSave.addEventListener("click", () => void handleAddSave());
}

init();
