import { MSG, STORAGE_KEYS, DEFAULT_QUERY_ANCHOR, ANCHOR_MIN_SCORE, BUILTIN_CATEGORIES, DEFAULT_ACTIVE_IDS, DEFAULT_TOP_K_PILLS, TASTE_MIN_LABELS } from "../shared/constants";
import { scoreToHue, getScoreBand } from "../shared/scoring-utils";
import { exportToCSV, countExportableTriplets } from "../storage/csv-export";
import { parseXArchiveFiles } from "../storage/x-archive-parser";
import type { TrainingLabel, ModelStatus, PageScoreResponse, PageScoreUpdatedPayload, PresetRanking, CategoryMap, TasteProfileResponse } from "../shared/types";
import { computeTasteCacheKey } from "../shared/taste-cache-key";

// ---------------------------------------------------------------------------
// CategoryMap — loaded from storage, refreshed on change
// ---------------------------------------------------------------------------
let categoryMap: CategoryMap = {};

chrome.storage.local.get(STORAGE_KEYS.CATEGORY_MAP).then((stored) => {
  categoryMap = (stored[STORAGE_KEYS.CATEGORY_MAP] as CategoryMap) ?? {};
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEYS.CATEGORY_MAP]) {
    categoryMap = (changes[STORAGE_KEYS.CATEGORY_MAP].newValue as CategoryMap) ?? {};
  }
  if (changes[STORAGE_KEYS.ACTIVE_CATEGORY_IDS]) {
    const ids = changes[STORAGE_KEYS.ACTIVE_CATEGORY_IDS].newValue as string[] | undefined;
    if (Array.isArray(ids)) {
      activeIds = ids;
      buildCategoryGrid();
    }
  }
});

// --- DOM Elements ---
const statusDot = document.getElementById("status-dot")!;
const statusLabel = document.getElementById("status-label")!;
const modelStatus = document.getElementById("model-status")!;
const progressBarContainer = document.getElementById("progress-bar-container")!;
const progressBar = document.getElementById("progress-bar")!;
const labelCounts = document.getElementById("label-counts")!;
const dataReadiness = document.getElementById("data-readiness")!;
const anchorGapHints = document.getElementById("anchor-gap-hints")!;
const collectLink = document.getElementById("collect-link") as HTMLAnchorElement;
const exportCsvBtn = document.getElementById("export-csv") as HTMLButtonElement;
const importXInput = document.getElementById("import-x") as HTMLInputElement;
const clearDataBtn = document.getElementById("clear-data") as HTMLButtonElement;
const toggleHN = document.getElementById("toggle-hn") as HTMLInputElement;
const toggleReddit = document.getElementById("toggle-reddit") as HTMLInputElement;
const toggleX = document.getElementById("toggle-x") as HTMLInputElement;
const sensitivitySlider = document.getElementById("sensitivity-slider") as HTMLInputElement;
const sensitivityValue = document.getElementById("sensitivity-value")!;
const modelSourceInput = document.getElementById("model-source-input") as HTMLInputElement;
const saveModelSourceBtn = document.getElementById("save-model-source") as HTMLButtonElement;
const modelIdDisplay = document.getElementById("model-id-display")!;
const toastContainer = document.getElementById("toast-container")!;
const togglePageScore = document.getElementById("toggle-page-score") as HTMLInputElement;
const heroCard = document.querySelector(".hero-card") as HTMLElement;
const pageScoreCard = document.getElementById("page-score-card")!;
const pageScoreTitle = document.getElementById("page-score-title")!;
const pageScoreRow = document.getElementById("page-score-row")!;
const pageScoreBand = document.getElementById("page-score-band")!;
const pageScoreValue = document.getElementById("page-score-value")!;
const pageScoreActions = document.getElementById("page-score-actions")!;
const pageScoreAnchors = document.getElementById("page-score-anchors")!;
const pageScoreExplain = document.getElementById("page-score-explain")!;
const labelCountBadge = document.getElementById("label-count-badge")!;
const categoryGrid = document.getElementById("category-grid")!;
const categoryCountBadge = document.getElementById("category-count-badge")!;
const tasteEmpty = document.getElementById("taste-empty") as HTMLDivElement;
const tasteResults = document.getElementById("taste-results") as HTMLDivElement;
const tasteBars = document.getElementById("taste-bars") as HTMLDivElement;
const tasteMeta = document.getElementById("taste-meta") as HTMLSpanElement;
const tasteRefresh = document.getElementById("taste-refresh") as HTMLButtonElement;
const tasteBadge = document.getElementById("taste-badge") as HTMLSpanElement;
const tasteComputing = document.getElementById("taste-computing") as HTMLDivElement;
const tasteFullLink = document.getElementById("taste-full-link") as HTMLAnchorElement;

interface LabelStats {
  total: number;
  pos: number;
  neg: number;
  hn: number;
  reddit: number;
  x: number;
  xImport: number;
  web: number;
}

interface AnchorGap {
  anchor: string;
  positives: number;
  negatives: number;
  missing: "positive" | "negative";
}

const EMPTY_STATS: LabelStats = {
  total: 0,
  pos: 0,
  neg: 0,
  hn: 0,
  reddit: 0,
  x: 0,
  xImport: 0,
  web: 0,
};

let activeIds: string[] = [...DEFAULT_ACTIVE_IDS];

let lastLabels: TrainingLabel[] = [];
let lastLabelStats: LabelStats = EMPTY_STATS;
let topKPills: number = DEFAULT_TOP_K_PILLS;
let lastPageScoreResp: PageScoreResponse | null = null;

type ToastType = "info" | "success" | "error";

interface ToastOptions {
  type?: ToastType;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

function showToast(message: string, options: ToastOptions = {}): void {
  const { type = "info", durationMs = 4000, actionLabel, onAction } = options;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);

  if (actionLabel && onAction) {
    const action = document.createElement("button");
    action.className = "toast-action";
    action.type = "button";
    action.textContent = actionLabel;
    action.addEventListener("click", async () => {
      try {
        await onAction();
      } catch (err) {
        showToast(`Action failed: ${String(err)}`, { type: "error" });
      } finally {
        toast.remove();
      }
    });
    toast.appendChild(action);
  }

  toastContainer.appendChild(toast);
  window.setTimeout(() => toast.remove(), durationMs);
}

function summarizeLabels(labels: TrainingLabel[]): LabelStats {
  return {
    total: labels.length,
    pos: labels.filter((l) => l.label === "positive").length,
    neg: labels.filter((l) => l.label === "negative").length,
    hn: labels.filter((l) => l.source === "hn").length,
    reddit: labels.filter((l) => l.source === "reddit").length,
    x: labels.filter((l) => l.source === "x").length,
    xImport: labels.filter((l) => l.source === "x-import").length,
    web: labels.filter((l) => l.source === "web").length,
  };
}

function getCollectionUrl(): string | null {
  if (toggleHN.checked) return "https://news.ycombinator.com/";
  if (toggleReddit.checked) return "https://www.reddit.com/";
  if (toggleX.checked) return "https://x.com/home";
  return null;
}

function updateDataReadiness(stats: LabelStats): void {
  const triplets = countExportableTriplets(lastLabels, DEFAULT_QUERY_ANCHOR);
  const ready = triplets > 0;
  exportCsvBtn.disabled = !ready;
  renderAnchorGapHints(lastLabels);

  if (ready) {
    dataReadiness.className = "data-readiness ready";
    dataReadiness.textContent = `Ready to export (${triplets} triplets).`;
    collectLink.classList.remove("visible");
    return;
  }

  dataReadiness.className = "data-readiness";
  if (stats.total === 0) {
    dataReadiness.textContent = "Collect at least 1 positive and 1 negative label to export.";
  } else if (stats.pos === 0 && stats.neg > 0) {
    dataReadiness.textContent = "Missing positive labels. Mark a few items with \uD83D\uDC4D.";
  } else if (stats.neg === 0 && stats.pos > 0) {
    dataReadiness.textContent = "Missing negative labels. Mark a few items with \uD83D\uDC4E.";
  } else if (stats.pos > 0 && stats.neg > 0) {
    dataReadiness.textContent = "Labels exist but no anchor group has both positive and negative.";
  } else {
    dataReadiness.textContent = "Need at least 1 positive and 1 negative label to export.";
  }

  const url = getCollectionUrl();
  if (url) {
    collectLink.href = url;
    collectLink.classList.add("visible");
  } else {
    collectLink.classList.remove("visible");
  }
}

function getAnchorGaps(labels: TrainingLabel[]): AnchorGap[] {
  const groups = new Map<string, { positives: number; negatives: number }>();

  for (const label of labels) {
    const anchor = (label.anchor || DEFAULT_QUERY_ANCHOR).trim() || DEFAULT_QUERY_ANCHOR;
    const group = groups.get(anchor) ?? { positives: 0, negatives: 0 };
    if (label.label === "positive") group.positives += 1;
    else group.negatives += 1;
    groups.set(anchor, group);
  }

  return [...groups.entries()]
    .map(([anchor, counts]) => {
      if (counts.positives > 0 && counts.negatives === 0) {
        return { anchor, positives: counts.positives, negatives: counts.negatives, missing: "negative" as const };
      }
      if (counts.negatives > 0 && counts.positives === 0) {
        return { anchor, positives: counts.positives, negatives: counts.negatives, missing: "positive" as const };
      }
      return null;
    })
    .filter((gap): gap is AnchorGap => Boolean(gap))
    .sort((a, b) => (b.positives + b.negatives) - (a.positives + a.negatives));
}

function renderAnchorGapHints(labels: TrainingLabel[]): void {
  const gaps = getAnchorGaps(labels);

  if (gaps.length === 0) {
    anchorGapHints.textContent = "";
    anchorGapHints.classList.remove("visible");
    anchorGapHints.style.display = "none";
    return;
  }

  anchorGapHints.textContent = "";

  const title = document.createElement("div");
  title.className = "anchor-gap-title";
  title.textContent = "To unlock more anchors in CSV:";
  anchorGapHints.appendChild(title);

  const list = document.createElement("div");
  list.className = "anchor-gap-list";

  for (const gap of gaps) {
    const item = document.createElement("div");
    item.className = "anchor-gap-item";
    const name = categoryMap[gap.anchor]?.label ?? gap.anchor;
    const needed = gap.missing === "negative" ? "👎 negative" : "👍 positive";
    item.textContent = `${needed} for ${name} (${gap.positives}↑ / ${gap.negatives}↓).`;
    list.appendChild(item);
  }

  anchorGapHints.appendChild(list);
  anchorGapHints.style.display = "block";
  anchorGapHints.classList.add("visible");
}

// ---------------------------------------------------------------------------
// Category picker
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<string, string> = {
  tech: "Tech",
  world: "World",
  lifestyle: "Lifestyle",
};

function buildCategoryGrid(): void {
  categoryGrid.textContent = "";

  // Group categories
  const groups = new Map<string, typeof BUILTIN_CATEGORIES[number][]>();
  for (const cat of BUILTIN_CATEGORIES) {
    const g = cat.group || "general";
    const list = groups.get(g) ?? [];
    list.push(cat);
    groups.set(g, list);
  }

  // Render ungrouped first, then tech, world, lifestyle
  const order = ["general", "tech", "world", "lifestyle"];
  for (const groupKey of order) {
    const cats = groups.get(groupKey);
    if (!cats || cats.length === 0) continue;

    const section = document.createElement("div");
    section.className = "category-group";

    if (groupKey !== "general") {
      const label = document.createElement("div");
      label.className = "category-group-label";
      label.textContent = GROUP_LABELS[groupKey] || groupKey;
      section.appendChild(label);
    }

    const chipsContainer = document.createElement("div");
    chipsContainer.className = "category-chips";

    for (const cat of cats) {
      const chip = document.createElement("button");
      chip.className = "category-chip";
      chip.type = "button";
      chip.dataset.id = cat.id;
      chip.textContent = cat.label;

      if (activeIds.includes(cat.id)) chip.classList.add("active");

      chip.addEventListener("click", () => void toggleCategory(cat.id));
      chipsContainer.appendChild(chip);
    }

    section.appendChild(chipsContainer);
    categoryGrid.appendChild(section);
  }

  const totalVisible = BUILTIN_CATEGORIES.length;
  const activeVisible = BUILTIN_CATEGORIES.filter((c) => activeIds.includes(c.id)).length;
  categoryCountBadge.textContent = `${activeVisible}/${totalVisible}`;
}

async function toggleCategory(id: string): Promise<void> {
  const idx = activeIds.indexOf(id);

  if (idx >= 0) {
    // Deactivating — enforce min 1
    if (activeIds.length <= 1) {
      showToast("At least one category must be active.", { type: "error" });
      return;
    }
    activeIds.splice(idx, 1);
  } else {
    activeIds.push(id);
  }

  // Persist — background picks up the change via storage.onChanged
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACTIVE_CATEGORY_IDS]: activeIds,
  });

  buildCategoryGrid();
}

// ---------------------------------------------------------------------------
// Taste profile helpers
// ---------------------------------------------------------------------------


function renderTasteProfile(data: TasteProfileResponse): void {
  // Show refresh button in all terminal states (not during loading)
  tasteRefresh.style.display = "";

  if (data.state === "insufficient_labels" || data.state === "error") {
    tasteEmpty.textContent = data.message || "Unable to compute taste profile.";
    tasteEmpty.style.display = "";
    tasteResults.style.display = "none";
    tasteComputing.style.display = "none";
    tasteMeta.textContent = "";
    tasteBadge.textContent = "";
    return;
  }

  if (!data.probes || data.probes.length === 0) {
    tasteEmpty.textContent = "No taste profile available.";
    tasteEmpty.style.display = "";
    tasteResults.style.display = "none";
    tasteComputing.style.display = "none";
    tasteMeta.textContent = "";
    tasteBadge.textContent = "";
    return;
  }

  tasteEmpty.style.display = "none";
  tasteComputing.style.display = "none";
  tasteResults.style.display = "";

  // Show top 5 in popup; full list available on taste.html
  const POPUP_TOP_K = 5;
  const preview = data.probes.slice(0, POPUP_TOP_K);

  tasteBars.replaceChildren();

  for (const p of preview) {
    const row = document.createElement("div");
    row.className = "taste-bar-row";

    const label = document.createElement("span");
    label.className = "taste-bar-label";
    const probeText = p.probe.charAt(0).toUpperCase() + p.probe.slice(1);
    label.textContent = probeText;
    label.title = `${categoryMap[p.category]?.label ?? p.category}: ${probeText}`;

    const track = document.createElement("div");
    track.className = "taste-bar-track";

    const fill = document.createElement("div");
    fill.className = "taste-bar-fill";
    // Absolute width: score is 0–1 cosine similarity
    fill.style.width = `${Math.max(2, p.score * 100)}%`;
    const hue = Math.round(scoreToHue(Math.max(0, Math.min(1, p.score))));
    fill.style.background = `hsl(${hue}, 65%, 55%)`;

    track.appendChild(fill);

    const score = document.createElement("span");
    score.className = "taste-bar-score";
    score.textContent = p.score.toFixed(2);

    row.append(label, track, score);
    tasteBars.appendChild(row);
  }

  // Show "See full profile" link only when there are more probes than shown
  tasteFullLink.style.display = data.probes.length > POPUP_TOP_K ? "" : "none";

  tasteMeta.textContent = `Based on ${data.labelCount} labels`;
  tasteBadge.textContent = `${data.probes.length}`;
}

let tasteIsStale = false;

async function loadCachedTasteProfile(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.TASTE_PROFILE,
      STORAGE_KEYS.LABELS,
    ]);
    const cached = stored[STORAGE_KEYS.TASTE_PROFILE] as TasteProfileResponse | undefined;
    if (!cached || cached.state !== "ready" || !cached.probes.length) return;

    // Check staleness before rendering
    const labels = (stored[STORAGE_KEYS.LABELS] as TrainingLabel[]) ?? [];
    const currentKey = await computeTasteCacheKey(labels);
    tasteIsStale = currentKey !== cached.cacheKey;

    renderTasteProfile(cached);

    if (tasteIsStale) {
      tasteBadge.textContent = "stale";
    }
  } catch { /* no cached profile */ }
}

async function refreshTasteProfile(): Promise<void> {
  tasteEmpty.style.display = "none";
  tasteResults.style.display = "none";
  tasteComputing.style.display = "";
  tasteRefresh.style.display = "none";
  tasteRefresh.disabled = true;

  try {
    tasteIsStale = false;
    const response: TasteProfileResponse = await chrome.runtime.sendMessage({
      type: MSG.COMPUTE_TASTE_PROFILE,
    });
    renderTasteProfile(response);
  } catch {
    tasteComputing.style.display = "none";
    tasteEmpty.style.display = "";
    tasteEmpty.textContent = "Failed to compute taste profile.";
    tasteRefresh.style.display = "";
  } finally {
    tasteRefresh.disabled = false;
  }
}

// --- Initialize ---
async function init() {
  // Load saved settings
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.CUSTOM_MODEL_ID,
    STORAGE_KEYS.CUSTOM_MODEL_URL,
    STORAGE_KEYS.SENSITIVITY,
    STORAGE_KEYS.SITE_ENABLED,
    STORAGE_KEYS.PAGE_SCORING_ENABLED,
    STORAGE_KEYS.ACTIVE_CATEGORY_IDS,
    STORAGE_KEYS.TOP_K_PILLS,
  ]);

  // Top-K pills
  topKPills = (stored[STORAGE_KEYS.TOP_K_PILLS] as number) ?? DEFAULT_TOP_K_PILLS;
  const topkSelect = document.getElementById("topk-select") as HTMLSelectElement;
  topkSelect.value = String(topKPills);
  topkSelect.addEventListener("change", () => {
    topKPills = Number(topkSelect.value);
    chrome.storage.local.set({ [STORAGE_KEYS.TOP_K_PILLS]: topKPills });
    if (lastPageScoreResp) renderPageScore(lastPageScoreResp);
  });

  // Active categories
  const savedIds = stored[STORAGE_KEYS.ACTIVE_CATEGORY_IDS] as string[] | undefined;
  if (savedIds && savedIds.length > 0) activeIds = savedIds;
  buildCategoryGrid();

  // Populate model source: URL takes priority, then model ID
  const savedUrl = (stored[STORAGE_KEYS.CUSTOM_MODEL_URL] as string) || "";
  const savedId = (stored[STORAGE_KEYS.CUSTOM_MODEL_ID] as string) || "";
  modelSourceInput.value = savedUrl || savedId;

  const sens = stored[STORAGE_KEYS.SENSITIVITY] ?? 50;
  sensitivitySlider.value = String(sens);
  sensitivityValue.textContent = `${sens}%`;

  const sites = stored[STORAGE_KEYS.SITE_ENABLED] ?? { hn: true, reddit: true, x: true };
  toggleHN.checked = sites.hn !== false;
  toggleReddit.checked = sites.reddit !== false;
  toggleX.checked = sites.x !== false;

  togglePageScore.checked = stored[STORAGE_KEYS.PAGE_SCORING_ENABLED] === true;

  // Get model status
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS });
    if (response) updateModelStatus(response);
  } catch {
    modelStatus.textContent = "Extension starting...";
  }

  // Load label counts
  await refreshLabelCounts();

  // Load page score for current tab
  await loadPageScore();

  // Taste profile — load cached on open, refresh on click
  void loadCachedTasteProfile();

  tasteRefresh.addEventListener("click", () => {
    void refreshTasteProfile();
  });

  tasteFullLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("taste.html") });
  });

  // Auto-compute on first fold open if no cached data or stale
  const tasteFold = document.querySelector(".fold-taste") as HTMLDetailsElement;
  tasteFold.addEventListener("toggle", () => {
    if (tasteFold.open && tasteComputing.style.display === "none") {
      if (tasteBars.children.length === 0 || tasteIsStale) {
        tasteIsStale = false;
        void refreshTasteProfile();
      }
    }
  });
}

function updateModelStatus(status: ModelStatus) {
  statusDot.className = "status-dot " + status.state;

  // Show which model is loaded
  modelIdDisplay.textContent = status.modelId || "";

  // Embedding model status
  if (status.state === "loading") {
    statusLabel.textContent = "Loading";
    modelStatus.textContent = status.message || "Loading model...";
    if (status.progress !== undefined) {
      progressBarContainer.style.display = "block";
      progressBar.style.width = `${Math.round(status.progress)}%`;
    }
  } else if (status.state === "ready") {
    const backend = status.backend?.toUpperCase() || "WASM";
    statusLabel.textContent = backend;
    modelStatus.textContent = `Ready — ${backend}`;
    progressBarContainer.style.display = "none";
  } else if (status.state === "error") {
    statusLabel.textContent = "Error";
    modelStatus.textContent = `Error: ${status.message}`;
    progressBarContainer.style.display = "none";
    // Auto-open Settings so the error message is visible
    (document.querySelector(".fold-settings") as HTMLDetailsElement).open = true;
  } else {
    statusLabel.textContent = "—";
    modelStatus.textContent = "Initializing...";
  }
}

async function refreshLabelCounts(): Promise<TrainingLabel[]> {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.GET_LABELS });
    const labels: TrainingLabel[] = response?.labels || [];
    lastLabels = labels;
    const stats = summarizeLabels(labels);
    lastLabelStats = stats;

    // Taste profile staleness — compare composite cache keys
    try {
      const tasteStored = await chrome.storage.local.get(STORAGE_KEYS.TASTE_PROFILE);
      const cachedTaste = tasteStored[STORAGE_KEYS.TASTE_PROFILE] as TasteProfileResponse | undefined;
      if (cachedTaste?.cacheKey) {
        const currentKey = await computeTasteCacheKey(labels);
        const stale = currentKey !== cachedTaste.cacheKey;
        tasteIsStale = stale;
        if (stale) tasteBadge.textContent = "stale";
      }
    } catch { /* non-critical */ }

    // Update fold badge
    labelCountBadge.textContent = stats.total > 0 ? `${stats.total}` : "";

    if (stats.total === 0) {
      labelCounts.textContent = "No labels collected yet.";
      clearDataBtn.textContent = "Clear All Data";
      updateDataReadiness(stats);
      return labels;
    }

    const sources = [`HN: ${stats.hn}`, `Reddit: ${stats.reddit}`, `X: ${stats.x}`, `Import: ${stats.xImport}`];
    if (stats.web > 0) sources.push(`Web: ${stats.web}`);
    labelCounts.textContent =
      `Total: ${stats.total} (${stats.pos} positive, ${stats.neg} negative)\n` +
      sources.join(" | ");

    clearDataBtn.textContent = stats.total > 0 ? `Clear ${stats.total} Labels` : "Clear All Data";
    updateDataReadiness(stats);
    return labels;
  } catch {
    labelCounts.textContent = "Unable to load label data.";
    lastLabels = [];
    lastLabelStats = EMPTY_STATS;
    labelCountBadge.textContent = "";
    updateDataReadiness(lastLabelStats);
    return [];
  }
}

// --- Event Handlers ---

function saveSiteToggles() {
  chrome.storage.local.set({
    [STORAGE_KEYS.SITE_ENABLED]: {
      hn: toggleHN.checked,
      reddit: toggleReddit.checked,
      x: toggleX.checked,
    },
  });
  updateDataReadiness(lastLabelStats);
}

toggleHN.addEventListener("change", saveSiteToggles);
toggleReddit.addEventListener("change", saveSiteToggles);
toggleX.addEventListener("change", saveSiteToggles);

sensitivitySlider.addEventListener("input", () => {
  const val = Number(sensitivitySlider.value);
  sensitivityValue.textContent = `${val}%`;
  chrome.storage.local.set({ [STORAGE_KEYS.SENSITIVITY]: val });
});

saveModelSourceBtn.addEventListener("click", async () => {
  const value = modelSourceInput.value.trim();
  const isUrl = /^https?:\/\//i.test(value);

  // Set the matching key, clear the other — they're mutually exclusive
  await chrome.storage.local.set({
    [STORAGE_KEYS.CUSTOM_MODEL_URL]: isUrl ? value : "",
    [STORAGE_KEYS.CUSTOM_MODEL_ID]: isUrl ? "" : value,
  });

  await chrome.runtime.sendMessage({ type: MSG.RELOAD_MODEL });
  saveModelSourceBtn.textContent = "Reloading...";
  setTimeout(() => {
    saveModelSourceBtn.textContent = "Apply";
  }, 2000);
});

exportCsvBtn.addEventListener("click", async () => {
  try {
    const labels = await refreshLabelCounts();

    if (countExportableTriplets(labels, DEFAULT_QUERY_ANCHOR) === 0) {
      showToast("No anchor group has both positive and negative labels.", { type: "error" });
      return;
    }

    const csv = exportToCSV(labels, DEFAULT_QUERY_ANCHOR, categoryMap);

    // Download
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sift_training_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    const tripletCount = csv.trimEnd().split("\n").length - 1; // minus header
    showToast(`Exported ${tripletCount} triplets.`, { type: "success" });
  } catch (err) {
    showToast(`Export failed: ${String(err)}`, { type: "error" });
  }
});

importXInput.addEventListener("change", async () => {
  const files = importXInput.files;
  if (!files || files.length === 0) return;

  try {
    const { labels, skipped } = await parseXArchiveFiles(files);

    if (labels.length === 0) {
      const msg = skipped > 0
        ? `No usable tweets found (${skipped} too short to use).`
        : "No tweets found in the uploaded files.";
      showToast(msg, { type: "error" });
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: MSG.IMPORT_X_LABELS,
      payload: { labels },
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    const msg = skipped > 0
      ? `Imported ${labels.length} tweets (${skipped} too short to use).`
      : `Imported ${labels.length} tweets as positive labels.`;
    showToast(msg, { type: "success" });
    await refreshLabelCounts();
  } catch (err) {
    showToast(`Import failed: ${String(err)}`, { type: "error" });
  }

  // Reset file input
  importXInput.value = "";
});

clearDataBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: MSG.GET_LABELS });
  const labels: TrainingLabel[] = response?.labels || [];

  if (labels.length === 0) {
    showToast("No training data to clear.");
    return;
  }

  const clearResponse = await chrome.runtime.sendMessage({ type: MSG.CLEAR_LABELS });
  if (clearResponse?.error) {
    showToast(`Clear failed: ${clearResponse.error}`, { type: "error" });
    return;
  }

  await refreshLabelCounts();

  showToast(`Cleared ${labels.length} labels.`, {
    type: "success",
    durationMs: 8000,
    actionLabel: "Undo",
    onAction: async () => {
      const restoreResponse = await chrome.runtime.sendMessage({
        type: MSG.SET_LABELS,
        payload: { labels },
      });
      if (restoreResponse?.error) {
        throw new Error(restoreResponse.error);
      }
      await refreshLabelCounts();
      showToast("Training labels restored.", { type: "success" });
    },
  });
});

// --- Page score ---

let currentPageTabId = -1;
let currentPageTitle = "";
let lastPageState: PageScoreResponse["state"] | "" = "";
let currentPageRanking: PresetRanking | undefined;
let currentPageAnchorOverride: string | undefined;

function renderPageScore(resp: PageScoreResponse): void {
  lastPageScoreResp = resp;
  const prevState = lastPageState;
  lastPageState = resp.state;

  pageScoreCard.classList.remove("disabled", "loading");
  heroCard.classList.remove("is-ready", "is-disabled", "is-loading", "is-unavailable");
  pageScoreExplain.style.display = "none";
  pageScoreAnchors.style.display = "none";
  pageScoreAnchors.textContent = "";

  if (resp.state === "disabled") {
    pageScoreCard.classList.add("disabled");
    heroCard.classList.add("is-disabled");
    pageScoreTitle.textContent = "Enable scoring to see page relevance";
    pageScoreRow.style.display = "none";
    return;
  }

  if (resp.state === "loading") {
    pageScoreCard.classList.add("loading");
    heroCard.classList.add("is-loading");
    pageScoreTitle.textContent = "Scoring page...";
    pageScoreRow.style.display = "none";
    return;
  }

  if (resp.state === "unavailable" || !resp.result) {
    pageScoreCard.classList.add("disabled");
    heroCard.classList.add("is-unavailable");
    heroCard.style.removeProperty("--ps-hue");
    pageScoreTitle.textContent = "Not available for this page";
    pageScoreRow.style.display = "none";
    return;
  }

  // Ready state — show score
  heroCard.classList.add("is-ready");
  const { result, normalizedTitle } = resp;
  const score = Math.max(0, Math.min(1, result.rawScore));
  const hue = Math.round(scoreToHue(score));
  const band = getScoreBand(score);

  currentPageTitle = normalizedTitle;
  heroCard.style.setProperty("--ps-hue", String(hue));
  pageScoreTitle.textContent = normalizedTitle;
  pageScoreBand.textContent = band;
  pageScoreValue.textContent = score.toFixed(2);

  // Only animate the reveal on meaningful transitions (not ready→ready re-renders)
  if (prevState !== "ready") {
    pageScoreRow.style.display = "none";
    // Force reflow so animation restarts
    void pageScoreRow.offsetHeight;
  }
  pageScoreRow.style.display = "flex";

  // Build action buttons — clear existing first
  while (pageScoreActions.firstChild) {
    pageScoreActions.removeChild(pageScoreActions.firstChild);
  }

  const upBtn = document.createElement("button");
  upBtn.textContent = "\uD83D\uDC4D";
  upBtn.title = "Positive label";
  upBtn.addEventListener("click", () => {
    void savePageLabel("positive");
    upBtn.classList.add("voted");
    downBtn.classList.remove("voted");
  });

  const downBtn = document.createElement("button");
  downBtn.textContent = "\uD83D\uDC4E";
  downBtn.title = "Negative label";
  downBtn.addEventListener("click", () => {
    void savePageLabel("negative");
    downBtn.classList.add("voted");
    upBtn.classList.remove("voted");
  });

  const explainBtn = document.createElement("button");
  explainBtn.textContent = "?";
  explainBtn.title = "Inspect score";
  explainBtn.addEventListener("click", () => {
    if (pageScoreExplain.style.display !== "none") {
      pageScoreExplain.style.display = "none";
      return;
    }
    pageScoreExplain.textContent = "Analyzing...";
    pageScoreExplain.style.display = "block";
    chrome.runtime.sendMessage({
      type: MSG.EXPLAIN_SCORE,
      payload: { text: normalizedTitle, score, anchorId: currentPageRanking?.top.anchor, ranking: currentPageRanking },
    }).then((r) => {
      pageScoreExplain.textContent = r?.explanation || r?.error || "No explanation available.";
    }).catch(() => {
      pageScoreExplain.textContent = "Inspector unavailable.";
    });
  });

  pageScoreActions.append(upBtn, downBtn, explainBtn);

  // Reset override on new page score render
  currentPageAnchorOverride = undefined;
  currentPageRanking = resp.ranking;

  // Render detected anchor pills from ranking (top-K)
  if (resp.ranking) {
    const pills = resp.ranking.ranks
      .slice(0, topKPills)
      .filter((r) => r === resp.ranking!.top || r.score >= ANCHOR_MIN_SCORE);

    if (pills.length > 0) {
      for (const pr of pills) {
        const pill = document.createElement("button");
        pill.className = "page-score-anchor-pill";
        if (pr.anchor === resp.ranking.top.anchor) pill.classList.add("active");
        const label = categoryMap[pr.anchor]?.label ?? pr.anchor;
        pill.textContent = label;
        pill.title = `Label under ${label}`;
        pill.addEventListener("click", () => {
          // Item-level override only — no global scoring mode change
          currentPageAnchorOverride = pr.anchor;
          pageScoreAnchors.querySelectorAll(".page-score-anchor-pill").forEach((p) =>
            p.classList.remove("active"),
          );
          pill.classList.add("active");
        });
        pageScoreAnchors.appendChild(pill);
      }
      pageScoreAnchors.style.display = "flex";
    }
  }
}

async function savePageLabel(label: "positive" | "negative"): Promise<void> {
  try {
    const anchor = currentPageAnchorOverride || currentPageRanking?.top.anchor || "";
    await chrome.runtime.sendMessage({
      type: MSG.SAVE_LABEL,
      payload: {
        label: {
          text: currentPageTitle,
          label,
          source: "web" as const,
          timestamp: Date.now(),
          anchor,
        },
        anchorOverride: currentPageAnchorOverride,
        presetRanking: currentPageRanking,
      },
    });
    await refreshLabelCounts();
    showToast(`Page labeled as ${label}.`, { type: "success" });
  } catch {
    showToast("Failed to save label.", { type: "error" });
  }
}

async function loadPageScore(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    currentPageTabId = tab.id;

    const resp = await chrome.runtime.sendMessage({
      type: MSG.GET_PAGE_SCORE,
      payload: { tabId: tab.id },
    }) as PageScoreResponse;

    renderPageScore(resp);
  } catch {
    renderPageScore({ title: "", normalizedTitle: "", result: null, state: "unavailable" });
  }
}

// Toggle handler
togglePageScore.addEventListener("change", () => {
  chrome.storage.local.set({
    [STORAGE_KEYS.PAGE_SCORING_ENABLED]: togglePageScore.checked,
  });
  // Re-query page score after toggle change (slight delay for background to process)
  setTimeout(() => void loadPageScore(), 100);
});

// --- Listen for status updates ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.MODEL_STATUS) {
    updateModelStatus(message.payload);
  }
  if (message.type === MSG.PAGE_SCORE_UPDATED) {
    const payload = message.payload as PageScoreUpdatedPayload;
    if (payload?.tabId === currentPageTabId) {
      renderPageScore(payload);
    }
  }
});

// --- Theme-aware icon ---
// Popup has window.matchMedia; service worker does not.
// Detect theme here and persist to storage so the background can apply the icon.
function syncThemeIcon() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  chrome.storage.local.set({ theme_dark: dark });
}
syncThemeIcon();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeIcon);

// --- Start ---
void init();
