/**
 * Full-page taste profile viewer.
 * Reads cached TasteProfileResponse from storage and renders full-width bars.
 * Can trigger a recompute via background message.
 *
 * Interactive features:
 * - Top-8 / all-categories toggle on the radar
 * - Click radar axis to filter probe bars by category
 * - Hover radar label for tooltip with stats
 */
import { MSG, STORAGE_KEYS } from "../shared/constants";
import { scoreToHue } from "../shared/scoring-utils";
import { computeTasteCacheKey } from "../shared/taste-cache-key";
import { renderRadarChart, aggregateByCategory } from "../shared/radar";
import type {
  TasteProfileResponse,
  TasteProbeResult,
  TrainingLabel,
  CategoryMap,
  AggregatedCategory,
  CategoryLabelStats,
} from "../shared/types";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const empty = document.getElementById("empty") as HTMLDivElement;
const results = document.getElementById("results") as HTMLDivElement;
const radar = document.getElementById("radar") as HTMLDivElement;
const bars = document.getElementById("bars") as HTMLDivElement;
const meta = document.getElementById("meta") as HTMLSpanElement;
const subtitle = document.getElementById("subtitle") as HTMLDivElement;
const probeHeader = document.getElementById("probe-header") as HTMLDivElement;
const refreshBtn = document.getElementById("refresh") as HTMLButtonElement;
const computing = document.getElementById("computing") as HTMLDivElement;
const radarToggle = document.getElementById("radar-toggle") as HTMLDivElement;
const radarToggleBtn = document.getElementById("radar-toggle-btn") as HTMLButtonElement;
const filterBar = document.getElementById("filter-bar") as HTMLDivElement;
const filterBarLabel = document.getElementById("filter-bar-label") as HTMLSpanElement;
const filterBarCta = document.getElementById("filter-bar-cta") as HTMLSpanElement;
const filterBarReset = document.getElementById("filter-bar-reset") as HTMLButtonElement;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let categoryMap: CategoryMap = {};
let categoryStats: Record<string, CategoryLabelStats> = {};
let allProbes: TasteProbeResult[] = [];
let allCategories: AggregatedCategory[] = [];
let selectedCategory: string | null = null;
let showAllCategories = false;

const DEFAULT_RADAR_LIMIT = 8;

// ---------------------------------------------------------------------------
// Category stats from labels
// ---------------------------------------------------------------------------
function computeCategoryStats(labels: TrainingLabel[]): Record<string, CategoryLabelStats> {
  const stats: Record<string, CategoryLabelStats> = {};
  for (const l of labels) {
    const anchor = l.anchor || "news";
    if (!stats[anchor]) stats[anchor] = { pos: 0, neg: 0, lastTimestamp: 0 };
    if (l.label === "positive") stats[anchor].pos++;
    else stats[anchor].neg++;
    if (l.timestamp > stats[anchor].lastTimestamp) {
      stats[anchor].lastTimestamp = l.timestamp;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------
function formatRelativeTime(ts: number): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// CTA text based on label balance
// ---------------------------------------------------------------------------
function getLabelHealth(total: number): string {
  if (total === 0) return "no signal";
  if (total < 5) return "thin signal";
  if (total < 10) return "building";
  return "strong signal";
}

function getCategoryCtaText(catId: string): string {
  const s = categoryStats[catId];
  if (!s) return "No labels yet — start collecting";
  const total = s.pos + s.neg;
  if (total === 0) return "No labels yet — start collecting";
  const health = getLabelHealth(total);
  if (s.pos > 0 && s.neg === 0) return `Collect some negatives (${s.pos} pos, 0 neg) — ${health}`;
  if (s.neg > 0 && s.pos === 0) return `Collect some positives (0 pos, ${s.neg} neg) — ${health}`;
  if (s.neg < 3) return `Collect ${3 - s.neg} more negatives for contrastive signal — ${health}`;
  return `${total} labels (${s.pos}+ / ${s.neg}-) — ${health}`;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
let activeTooltip: HTMLElement | null = null;

function dismissTooltip(): void {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
}

function createTooltipRow(key: string, val: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "radar-tooltip-row";
  const keySpan = document.createElement("span");
  keySpan.className = "radar-tooltip-key";
  keySpan.textContent = key;
  const valSpan = document.createElement("span");
  valSpan.className = "radar-tooltip-val";
  valSpan.textContent = val;
  row.append(keySpan, valSpan);
  return row;
}

function showCategoryTooltip(catId: string, anchorEl: Element): void {
  dismissTooltip();

  const cat = allCategories.find(c => c.id === catId);
  if (!cat) return;

  const s = categoryStats[catId];
  const probeCount = allProbes.filter(p => p.category === catId).length;

  const tip = document.createElement("div");
  tip.className = "radar-tooltip";

  tip.appendChild(createTooltipRow("Score", cat.score.toFixed(3)));
  tip.appendChild(createTooltipRow("Probes", String(probeCount)));
  tip.appendChild(createTooltipRow("Labels", s ? `${s.pos}+ / ${s.neg}-` : "0+ / 0-"));
  tip.appendChild(createTooltipRow("Last label", s ? formatRelativeTime(s.lastTimestamp) : "never"));

  // Position above the element within the radar container
  radar.appendChild(tip);

  const containerRect = radar.getBoundingClientRect();
  const elRect = (anchorEl as SVGElement).getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  let left = elRect.left + elRect.width / 2 - containerRect.left - tipRect.width / 2;
  let top = elRect.top - containerRect.top - tipRect.height - 8;

  // Flip below if clipping top
  if (top < 0) {
    top = elRect.bottom - containerRect.top + 8;
  }

  // Clamp horizontal
  left = Math.max(0, Math.min(left, containerRect.width - tipRect.width));

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;

  activeTooltip = tip;
}

// ---------------------------------------------------------------------------
// Radar interaction wiring
// ---------------------------------------------------------------------------
function wireRadarClicks(): void {
  const clickables = radar.querySelectorAll<SVGElement>("[data-category-id]");
  for (const el of clickables) {
    el.addEventListener("click", () => {
      const catId = el.dataset.categoryId!;
      if (selectedCategory === catId) {
        filterByCategory(null);
      } else {
        filterByCategory(catId);
      }
    });
  }
}

function wireRadarHovers(): void {
  const hoverables = radar.querySelectorAll<SVGElement>(".radar-hit-area, .radar-label");
  for (const el of hoverables) {
    el.addEventListener("mouseenter", () => {
      const catId = el.dataset.categoryId;
      if (catId) showCategoryTooltip(catId, el);
    });
    el.addEventListener("mouseleave", dismissTooltip);
    // Keyboard: focus shows tooltip, blur dismisses
    el.addEventListener("focus", () => {
      const catId = el.dataset.categoryId;
      if (catId) showCategoryTooltip(catId, el);
    });
    el.addEventListener("blur", dismissTooltip);
    // Enter/Space triggers click (filter toggle)
    el.addEventListener("keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" || ke.key === " ") {
        ke.preventDefault();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Filter + highlight
// ---------------------------------------------------------------------------
function filterByCategory(catId: string | null): void {
  selectedCategory = catId;
  renderBars();
  updateFilterUI();
}

function updateFilterUI(): void {
  // Highlight/dim radar elements
  const labels = radar.querySelectorAll<SVGElement>(".radar-label");
  const axes = radar.querySelectorAll<SVGElement>(".radar-axis");
  const dots = radar.querySelectorAll<SVGElement>(".radar-dot");

  if (selectedCategory) {
    for (const el of labels) {
      const id = el.dataset.categoryId;
      el.classList.toggle("radar-label--active", id === selectedCategory);
      el.classList.toggle("radar-label--dimmed", id !== selectedCategory);
    }
    for (const el of axes) {
      el.classList.toggle("radar-axis--dimmed", el.dataset.categoryId !== selectedCategory);
    }
    for (const el of dots) {
      el.classList.toggle("radar-dot--dimmed", el.dataset.categoryId !== selectedCategory);
    }

    // Show filter bar
    const cat = allCategories.find(c => c.id === selectedCategory);
    filterBarLabel.textContent = cat?.label ?? selectedCategory;
    filterBarCta.textContent = getCategoryCtaText(selectedCategory);
    filterBar.classList.add("visible");

    // Update probe header
    probeHeader.textContent = `Probes — ${cat?.label ?? selectedCategory}`;
  } else {
    for (const el of labels) {
      el.classList.remove("radar-label--active", "radar-label--dimmed");
    }
    for (const el of axes) {
      el.classList.remove("radar-axis--dimmed");
    }
    for (const el of dots) {
      el.classList.remove("radar-dot--dimmed");
    }

    filterBar.classList.remove("visible");
    probeHeader.textContent = "Probe Detail";
  }
}

// ---------------------------------------------------------------------------
// Render bars (filtered or full)
// ---------------------------------------------------------------------------
function renderBars(): void {
  bars.replaceChildren();

  const probes = selectedCategory
    ? allProbes.filter(p => p.category === selectedCategory)
    : allProbes;

  probes.forEach((p, i) => {
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
}

// ---------------------------------------------------------------------------
// Rerender (radar + bars + wiring)
// ---------------------------------------------------------------------------
function rerender(): void {
  // Decide which probes to show on radar
  const visibleProbes = getVisibleProbes();

  const { rendered, categories } = renderRadarChart(radar, visibleProbes, categoryMap);
  allCategories = aggregateByCategory(allProbes, categoryMap); // always store all
  probeHeader.style.display = rendered ? "" : "none";

  // Show toggle only when >8 active categories
  const totalCats = aggregateByCategory(allProbes, categoryMap).length;
  if (totalCats > DEFAULT_RADAR_LIMIT) {
    radarToggle.style.display = "";
    radarToggleBtn.textContent = showAllCategories
      ? `Show top ${DEFAULT_RADAR_LIMIT}`
      : "Show all categories";
  } else {
    radarToggle.style.display = "none";
  }

  // If selected category isn't visible after toggle, clear filter
  if (selectedCategory && !categories.some(c => c.id === selectedCategory)) {
    selectedCategory = null;
  }

  renderBars();
  updateFilterUI();
  wireRadarClicks();
  wireRadarHovers();
}

function getVisibleProbes(): TasteProbeResult[] {
  if (showAllCategories) return allProbes;

  // Get top-8 categories by aggregated score, then return only their probes
  const agg = aggregateByCategory(allProbes, categoryMap);
  if (agg.length <= DEFAULT_RADAR_LIMIT) return allProbes;

  const topIds = new Set(
    agg.sort((a, b) => b.score - a.score)
      .slice(0, DEFAULT_RADAR_LIMIT)
      .map(c => c.id)
  );
  return allProbes.filter(p => topIds.has(p.category));
}

// ---------------------------------------------------------------------------
// Main render (called with fresh data)
// ---------------------------------------------------------------------------
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

  // Store data and reset filter
  allProbes = data.probes;
  selectedCategory = null;

  rerender();

  subtitle.textContent = `Top ${data.probes.length} topics ranked by affinity`;
  meta.textContent = `Based on ${data.labelCount} labels`;
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------
async function refresh(): Promise<void> {
  empty.style.display = "none";
  results.style.display = "none";
  computing.style.display = "";
  refreshBtn.style.display = "none";
  refreshBtn.disabled = true;

  try {
    // Reload labels so tooltip/CTA stats reflect latest state
    const labelStore = await chrome.storage.local.get(STORAGE_KEYS.LABELS);
    const freshLabels = (labelStore[STORAGE_KEYS.LABELS] as TrainingLabel[]) ?? [];
    categoryStats = computeCategoryStats(freshLabels);

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

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init(): Promise<void> {
  // Load category map for display names
  const catStore = await chrome.storage.local.get(STORAGE_KEYS.CATEGORY_MAP);
  categoryMap = (catStore[STORAGE_KEYS.CATEGORY_MAP] as CategoryMap) ?? {};

  // Load cached profile + labels for staleness check and stats
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.TASTE_PROFILE,
    STORAGE_KEYS.LABELS,
  ]);
  const cached = stored[STORAGE_KEYS.TASTE_PROFILE] as TasteProfileResponse | undefined;
  const labels = (stored[STORAGE_KEYS.LABELS] as TrainingLabel[]) ?? [];

  // Compute per-category label stats for tooltips and CTAs
  categoryStats = computeCategoryStats(labels);

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

  // Wire up controls
  refreshBtn.addEventListener("click", refresh);

  radarToggleBtn.addEventListener("click", () => {
    showAllCategories = !showAllCategories;
    rerender();
  });

  filterBarReset.addEventListener("click", () => {
    filterByCategory(null);
  });
}

init();
