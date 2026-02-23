/**
 * Full-page taste profile viewer.
 * Reads cached TasteProfileResponse from storage and renders full-width bars.
 * Can trigger a recompute via background message.
 */
import { MSG, STORAGE_KEYS } from "../shared/constants";
import { scoreToHue } from "../shared/scoring-utils";
import { computeTasteCacheKey } from "../shared/taste-cache-key";
import type { TasteProfileResponse, TrainingLabel, CategoryMap } from "../shared/types";

const empty = document.getElementById("empty") as HTMLDivElement;
const results = document.getElementById("results") as HTMLDivElement;
const bars = document.getElementById("bars") as HTMLDivElement;
const meta = document.getElementById("meta") as HTMLSpanElement;
const subtitle = document.getElementById("subtitle") as HTMLDivElement;
const refreshBtn = document.getElementById("refresh") as HTMLButtonElement;
const computing = document.getElementById("computing") as HTMLDivElement;

let categoryMap: CategoryMap = {};

function render(data: TasteProfileResponse): void {
  refreshBtn.style.display = "";

  if (data.state === "insufficient_labels" || data.state === "error") {
    empty.textContent = data.message || "Unable to compute taste profile.";
    empty.style.display = "";
    results.style.display = "none";
    computing.style.display = "none";
    meta.textContent = "";
    subtitle.textContent = "";
    return;
  }

  if (!data.probes || data.probes.length === 0) {
    empty.textContent = "No taste profile available.";
    empty.style.display = "";
    results.style.display = "none";
    computing.style.display = "none";
    meta.textContent = "";
    subtitle.textContent = "";
    return;
  }

  empty.style.display = "none";
  computing.style.display = "none";
  results.style.display = "";

  bars.replaceChildren();

  data.probes.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "taste-bar-row";

    const rank = document.createElement("span");
    rank.className = "taste-bar-rank";
    rank.textContent = `${i + 1}.`;

    const label = document.createElement("span");
    label.className = "taste-bar-label";
    label.textContent = p.probe.charAt(0).toUpperCase() + p.probe.slice(1);

    const chip = document.createElement("span");
    chip.className = "taste-bar-chip";
    chip.textContent = categoryMap[p.category]?.label ?? p.category;

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
    score.textContent = p.score.toFixed(3);

    row.append(rank, label, chip, track, score);
    bars.appendChild(row);
  });

  subtitle.textContent = `Top ${data.probes.length} topics ranked by affinity`;
  meta.textContent = `Based on ${data.labelCount} labels`;
}

async function refresh(): Promise<void> {
  empty.style.display = "none";
  results.style.display = "none";
  computing.style.display = "";
  refreshBtn.style.display = "none";
  refreshBtn.disabled = true;

  try {
    const response: TasteProfileResponse = await chrome.runtime.sendMessage({
      type: MSG.COMPUTE_TASTE_PROFILE,
    });
    render(response);
  } catch {
    computing.style.display = "none";
    empty.style.display = "";
    empty.textContent = "Failed to compute taste profile.";
    refreshBtn.style.display = "";
  } finally {
    refreshBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  // Load category map for display names
  const catStore = await chrome.storage.local.get(STORAGE_KEYS.CATEGORY_MAP);
  categoryMap = (catStore[STORAGE_KEYS.CATEGORY_MAP] as CategoryMap) ?? {};

  // Load cached profile + labels for staleness check
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.TASTE_PROFILE,
    STORAGE_KEYS.LABELS,
  ]);
  const cached = stored[STORAGE_KEYS.TASTE_PROFILE] as TasteProfileResponse | undefined;
  const labels = (stored[STORAGE_KEYS.LABELS] as TrainingLabel[]) ?? [];

  if (cached && cached.probes && cached.probes.length > 0) {
    const currentKey = await computeTasteCacheKey(labels);
    const isStale = currentKey !== cached.cacheKey;

    render(cached);

    if (isStale) {
      subtitle.textContent = "Profile is outdated — click Refresh to update";
      void refresh();
    }
  } else {
    empty.textContent = "No cached taste profile. Click Refresh to compute.";
    refreshBtn.style.display = "";
  }

  refreshBtn.addEventListener("click", refresh);
}

init();
