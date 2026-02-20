import { MSG, STORAGE_KEYS, DEFAULT_QUERY_ANCHOR } from "../shared/constants";
import { exportToCSV } from "../storage/csv-export";
import { parseXArchiveFiles } from "../storage/x-archive-parser";
import type { TrainingLabel, ModelStatus } from "../shared/types";

// --- DOM Elements ---
const statusDot = document.getElementById("status-dot")!;
const statusLabel = document.getElementById("status-label")!;
const modelStatus = document.getElementById("model-status")!;
const progressBarContainer = document.getElementById("progress-bar-container")!;
const progressBar = document.getElementById("progress-bar")!;
const llmStatus = document.getElementById("llm-status")!;
const lensActive = document.getElementById("lens-active")!;
const lensText = document.getElementById("lens-text")!;
const lensEditBtn = document.getElementById("lens-edit-btn")!;
const lensEditor = document.getElementById("lens-editor")!;
const lensPresets = document.getElementById("lens-presets")!;
const anchorInput = document.getElementById("anchor-input") as HTMLInputElement;
const saveAnchorBtn = document.getElementById("save-anchor")!;
const labelCounts = document.getElementById("label-counts")!;
const dataReadiness = document.getElementById("data-readiness")!;
const collectLink = document.getElementById("collect-link") as HTMLAnchorElement;
const exportCsvBtn = document.getElementById("export-csv") as HTMLButtonElement;
const importXInput = document.getElementById("import-x") as HTMLInputElement;
const clearDataBtn = document.getElementById("clear-data") as HTMLButtonElement;
const toggleHN = document.getElementById("toggle-hn") as HTMLInputElement;
const toggleReddit = document.getElementById("toggle-reddit") as HTMLInputElement;
const toggleX = document.getElementById("toggle-x") as HTMLInputElement;
const sensitivitySlider = document.getElementById("sensitivity-slider") as HTMLInputElement;
const sensitivityValue = document.getElementById("sensitivity-value")!;
const toggleExplain = document.getElementById("toggle-explain") as HTMLInputElement;
const modelSourceInput = document.getElementById("model-source-input") as HTMLInputElement;
const saveModelSourceBtn = document.getElementById("save-model-source") as HTMLButtonElement;
const modelIdDisplay = document.getElementById("model-id-display")!;
const toastContainer = document.getElementById("toast-container")!;

interface LabelStats {
  total: number;
  pos: number;
  neg: number;
  hn: number;
  reddit: number;
  x: number;
  xImport: number;
}

const EMPTY_STATS: LabelStats = {
  total: 0,
  pos: 0,
  neg: 0,
  hn: 0,
  reddit: 0,
  x: 0,
  xImport: 0,
};

let lastLabelStats: LabelStats = EMPTY_STATS;

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
  };
}

function getCollectionUrl(): string | null {
  if (toggleHN.checked) return "https://news.ycombinator.com/";
  if (toggleReddit.checked) return "https://www.reddit.com/";
  if (toggleX.checked) return "https://x.com/home";
  return null;
}

function updateDataReadiness(stats: LabelStats): void {
  const ready = stats.pos > 0 && stats.neg > 0;
  exportCsvBtn.disabled = !ready;

  if (ready) {
    const rows = Math.max(stats.pos, stats.neg);
    dataReadiness.className = "data-readiness ready";
    dataReadiness.textContent = `Ready to export (${rows} triplets).`;
    collectLink.classList.remove("visible");
    return;
  }

  dataReadiness.className = "data-readiness";
  if (stats.total === 0) {
    dataReadiness.textContent = "Collect at least 1 positive and 1 negative label to export.";
  } else if (stats.pos === 0 && stats.neg > 0) {
    dataReadiness.textContent = "Missing positive labels. Mark a few items with 👍.";
  } else if (stats.neg === 0 && stats.pos > 0) {
    dataReadiness.textContent = "Missing negative labels. Mark a few items with 👎.";
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

// --- Initialize ---
async function init() {
  // Load saved settings
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ANCHOR,
    STORAGE_KEYS.CUSTOM_MODEL_ID,
    STORAGE_KEYS.CUSTOM_MODEL_URL,
    STORAGE_KEYS.SENSITIVITY,
    STORAGE_KEYS.SITE_ENABLED,
    STORAGE_KEYS.EXPLAIN_ENABLED,
  ]);
  const anchor = stored[STORAGE_KEYS.ANCHOR] || DEFAULT_QUERY_ANCHOR;
  anchorInput.value = anchor;
  updateLensDisplay(anchor);

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

  toggleExplain.checked = stored[STORAGE_KEYS.EXPLAIN_ENABLED] !== false;

  // Get model status
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS });
    if (response) updateModelStatus(response);
  } catch {
    modelStatus.textContent = "Extension starting...";
  }

  // Load label counts
  await refreshLabelCounts();
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
  } else {
    statusLabel.textContent = "—";
    modelStatus.textContent = "Initializing...";
  }

  // LLM status
  if (!toggleExplain.checked) {
    llmStatus.textContent = "Off";
  } else if (status.llmState === "loading") {
    llmStatus.textContent = status.llmMessage || "Loading Gemma 3...";
  } else if (status.llmState === "ready") {
    llmStatus.textContent = "Ready";
  } else if (status.llmState === "error") {
    llmStatus.textContent = `Error: ${status.llmMessage}`;
  } else {
    llmStatus.textContent = "Waiting...";
  }
}

async function refreshLabelCounts(): Promise<TrainingLabel[]> {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.GET_LABELS });
    const labels: TrainingLabel[] = response?.labels || [];
    const stats = summarizeLabels(labels);
    lastLabelStats = stats;

    if (stats.total === 0) {
      labelCounts.textContent = "No labels collected yet.";
      updateDataReadiness(stats);
      return labels;
    }

    labelCounts.textContent =
      `Total: ${stats.total} (${stats.pos} positive, ${stats.neg} negative)\n` +
      `HN: ${stats.hn} | Reddit: ${stats.reddit} | X: ${stats.x} | Import: ${stats.xImport}`;

    updateDataReadiness(stats);
    return labels;
  } catch {
    labelCounts.textContent = "Unable to load label data.";
    lastLabelStats = EMPTY_STATS;
    updateDataReadiness(lastLabelStats);
    return [];
  }
}

// --- Event Handlers ---

// Lens: resolve display label from anchor value
function getLabelForAnchor(anchor: string): string {
  const chip = lensPresets.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`);
  return chip?.dataset.label || anchor;
}

function updateLensDisplay(anchor: string) {
  lensText.textContent = getLabelForAnchor(anchor);
  // Highlight the active preset chip
  lensPresets.querySelectorAll(".lens-chip").forEach((chip) => {
    chip.classList.toggle("active", (chip as HTMLElement).dataset.anchor === anchor);
  });
}

// Lens: toggle editor
lensEditBtn.addEventListener("click", () => {
  const open = lensEditor.style.display !== "none";
  lensEditor.style.display = open ? "none" : "block";
  if (!open) anchorInput.focus();
});

// Lens: apply anchor (preset or custom)
async function applyAnchor(anchor: string) {
  if (!anchor) return;
  anchorInput.value = anchor;
  updateLensDisplay(anchor);
  lensEditor.style.display = "none";

  const response = await chrome.runtime.sendMessage({
    type: MSG.UPDATE_ANCHOR,
    payload: { anchor },
  });

  if (response?.error) {
    showToast(`Failed to update lens: ${response.error}`, { type: "error" });
  } else {
    showToast("Scoring lens updated.", { type: "success" });
  }
}

saveAnchorBtn.addEventListener("click", () => {
  void applyAnchor(anchorInput.value.trim());
});

anchorInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void applyAnchor(anchorInput.value.trim());
});

// Lens: preset chips
lensPresets.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".lens-chip");
  if (!chip) return;
  const anchor = chip.dataset.anchor;
  if (anchor) void applyAnchor(anchor);
});

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

toggleExplain.addEventListener("change", async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.EXPLAIN_ENABLED]: toggleExplain.checked,
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG.SET_EXPLAIN_ENABLED,
      payload: { enabled: toggleExplain.checked },
    });
    if (response?.error) {
      throw new Error(response.error);
    }
    if (toggleExplain.checked) {
      llmStatus.textContent = "Starting...";
    } else {
      llmStatus.textContent = "Off";
    }
  } catch (err) {
    showToast(`Explain toggle failed: ${String(err)}`, { type: "error" });
  }
});

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
    const stats = summarizeLabels(labels);

    if (stats.pos === 0 || stats.neg === 0) {
      showToast("Export needs both positive and negative labels.", { type: "error" });
      return;
    }

    const csv = exportToCSV(labels, anchorInput.value.trim() || DEFAULT_QUERY_ANCHOR);

    // Download
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sift_training_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Exported ${Math.max(stats.pos, stats.neg)} triplets.`, { type: "success" });
  } catch (err) {
    showToast(`Export failed: ${String(err)}`, { type: "error" });
  }
});

importXInput.addEventListener("change", async () => {
  const files = importXInput.files;
  if (!files || files.length === 0) return;

  try {
    const labels = await parseXArchiveFiles(files);

    if (labels.length === 0) {
      showToast("No tweets found in the uploaded files.", { type: "error" });
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: MSG.IMPORT_X_LABELS,
      payload: { labels },
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    showToast(`Imported ${labels.length} tweets as positive labels.`, { type: "success" });
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

// --- Listen for status updates ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.MODEL_STATUS) {
    updateModelStatus(message.payload);
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
