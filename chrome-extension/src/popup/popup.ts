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
const exportCsvBtn = document.getElementById("export-csv")!;
const importXInput = document.getElementById("import-x") as HTMLInputElement;
const clearDataBtn = document.getElementById("clear-data")!;
const toggleHN = document.getElementById("toggle-hn") as HTMLInputElement;
const toggleReddit = document.getElementById("toggle-reddit") as HTMLInputElement;
const toggleX = document.getElementById("toggle-x") as HTMLInputElement;
const sensitivitySlider = document.getElementById("sensitivity-slider") as HTMLInputElement;
const sensitivityValue = document.getElementById("sensitivity-value")!;
const toggleExplain = document.getElementById("toggle-explain") as HTMLInputElement;
const modelUrlInput = document.getElementById("model-url-input") as HTMLInputElement;
const saveModelUrlBtn = document.getElementById("save-model-url")!;

// --- Initialize ---
async function init() {
  // Load saved settings
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ANCHOR,
    STORAGE_KEYS.CUSTOM_MODEL_URL,
    STORAGE_KEYS.SENSITIVITY,
    STORAGE_KEYS.SITE_ENABLED,
    STORAGE_KEYS.EXPLAIN_ENABLED,
  ]);
  const anchor = stored[STORAGE_KEYS.ANCHOR] || DEFAULT_QUERY_ANCHOR;
  anchorInput.value = anchor;
  updateLensDisplay(anchor);
  modelUrlInput.value = stored[STORAGE_KEYS.CUSTOM_MODEL_URL] || "";
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

async function refreshLabelCounts() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.GET_LABELS });
    const labels: TrainingLabel[] = response?.labels || [];

    if (labels.length === 0) {
      labelCounts.textContent = "No labels collected yet.";
      return;
    }

    const hn = labels.filter((l) => l.source === "hn").length;
    const reddit = labels.filter((l) => l.source === "reddit").length;
    const x = labels.filter((l) => l.source === "x").length;
    const xImport = labels.filter((l) => l.source === "x-import").length;
    const pos = labels.filter((l) => l.label === "positive").length;
    const neg = labels.filter((l) => l.label === "negative").length;

    labelCounts.textContent =
      `Total: ${labels.length} (${pos} positive, ${neg} negative)\n` +
      `HN: ${hn} | Reddit: ${reddit} | X: ${x} | Import: ${xImport}`;
  } catch {
    labelCounts.textContent = "Unable to load label data.";
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
  await chrome.runtime.sendMessage({
    type: MSG.UPDATE_ANCHOR,
    payload: { anchor },
  });
}

saveAnchorBtn.addEventListener("click", () => {
  applyAnchor(anchorInput.value.trim());
});

anchorInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyAnchor(anchorInput.value.trim());
});

// Lens: preset chips
lensPresets.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".lens-chip");
  if (!chip) return;
  const anchor = chip.dataset.anchor;
  if (anchor) applyAnchor(anchor);
});

function saveSiteToggles() {
  chrome.storage.local.set({
    [STORAGE_KEYS.SITE_ENABLED]: {
      hn: toggleHN.checked,
      reddit: toggleReddit.checked,
      x: toggleX.checked,
    },
  });
}

toggleHN.addEventListener("change", saveSiteToggles);
toggleReddit.addEventListener("change", saveSiteToggles);
toggleX.addEventListener("change", saveSiteToggles);

toggleExplain.addEventListener("change", async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.EXPLAIN_ENABLED]: toggleExplain.checked,
  });
  if (toggleExplain.checked) {
    // Trigger LLM load
    await chrome.runtime.sendMessage({ type: MSG.RELOAD_MODEL });
  }
});

sensitivitySlider.addEventListener("input", () => {
  const val = Number(sensitivitySlider.value);
  sensitivityValue.textContent = `${val}%`;
  chrome.storage.local.set({ [STORAGE_KEYS.SENSITIVITY]: val });
});

saveModelUrlBtn.addEventListener("click", async () => {
  const url = modelUrlInput.value.trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.CUSTOM_MODEL_URL]: url });
  await chrome.runtime.sendMessage({ type: MSG.RELOAD_MODEL });
  saveModelUrlBtn.textContent = "Reloading...";
  setTimeout(() => {
    saveModelUrlBtn.textContent = "Apply";
  }, 2000);
});

exportCsvBtn.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.GET_LABELS });
    const labels: TrainingLabel[] = response?.labels || [];

    if (labels.length === 0) {
      alert("No training data to export.");
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
  } catch (err) {
    alert(`Export failed: ${err}`);
  }
});

importXInput.addEventListener("change", async () => {
  const files = importXInput.files;
  if (!files || files.length === 0) return;

  try {
    const labels = await parseXArchiveFiles(files);

    if (labels.length === 0) {
      alert("No tweets found in the uploaded files.");
      return;
    }

    await chrome.runtime.sendMessage({
      type: MSG.IMPORT_X_LABELS,
      payload: { labels },
    });

    alert(`Imported ${labels.length} tweets as positive labels.`);
    await refreshLabelCounts();
  } catch (err) {
    alert(`Import failed: ${err}`);
  }

  // Reset file input
  importXInput.value = "";
});

clearDataBtn.addEventListener("click", async () => {
  if (!confirm("Clear all training data? This cannot be undone.")) return;

  await chrome.runtime.sendMessage({ type: MSG.CLEAR_LABELS });
  await refreshLabelCounts();
});

// --- Listen for status updates ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.MODEL_STATUS) {
    updateModelStatus(message.payload);
  }
});

// --- Start ---
init();
