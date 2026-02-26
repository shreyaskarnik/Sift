import { MSG, STORAGE_KEYS, ANCHOR_MIN_SCORE, DEFAULT_TOP_K_PILLS } from "../../shared/constants";
import type { VibeResult, PresetRanking, PresetRank, CategoryMap } from "../../shared/types";
import { scoreToHue, getScoreBand } from "../../shared/scoring-utils";
import { injectStyles } from "./styles";
import { createLabelButtons } from "./label-buttons";

/** Per-site enabled flags. Cached, updated via storage listener. */
let siteEnabled: Record<string, boolean> = { hn: true, reddit: true, x: true };

/** Sensitivity 0-100. Cached, updated via storage listener. */
let sensitivity = 50;

/** Active category map. Cached, updated via storage listener. */
let categoryMap: CategoryMap = {};

/** Number of category pills to show per item. */
let topKPills: number = DEFAULT_TOP_K_PILLS;

// Load category map from storage
chrome.storage.local.get(STORAGE_KEYS.CATEGORY_MAP).then((stored) => {
  categoryMap = (stored[STORAGE_KEYS.CATEGORY_MAP] as CategoryMap) ?? {};
});

/** Load settings from storage. Call once before scoring. */
export async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.SENSITIVITY,
      STORAGE_KEYS.SITE_ENABLED,
      STORAGE_KEYS.TOP_K_PILLS,
    ]);
    sensitivity = stored[STORAGE_KEYS.SENSITIVITY] ?? 50;
    siteEnabled = stored[STORAGE_KEYS.SITE_ENABLED] ?? { hn: true, reddit: true, x: true };
    topKPills = (stored[STORAGE_KEYS.TOP_K_PILLS] as number) ?? DEFAULT_TOP_K_PILLS;
  } catch { /* use default */ }
}

/** Check if a site is currently enabled. */
export function isSiteEnabled(site: "hn" | "reddit" | "x"): boolean {
  return siteEnabled[site] !== false;
}

/**
 * Register a callback that fires when the background model becomes ready.
 * Useful for re-processing items that failed initial scoring.
 */
export function onModelReady(callback: () => void): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (
      message.type === "MODEL_STATUS" &&
      message.payload?.state === "ready"
    ) {
      callback();
    }
  });
}

// Sync theme for icon (content scripts have matchMedia, service worker doesn't)
try {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  chrome.storage.local.set({ theme_dark: dark });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    chrome.storage.local.set({ theme_dark: e.matches });
  });
} catch { /* non-critical */ }

// Live-update when user changes settings in the side panel
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEYS.SENSITIVITY]) {
    sensitivity = changes[STORAGE_KEYS.SENSITIVITY].newValue ?? 50;
    applySensitivityToExistingScores();
  }
  if (changes[STORAGE_KEYS.SITE_ENABLED]) {
    siteEnabled = changes[STORAGE_KEYS.SITE_ENABLED].newValue ?? { hn: true, reddit: true, x: true };
  }
  if (changes[STORAGE_KEYS.CATEGORY_MAP]) {
    categoryMap = (changes[STORAGE_KEYS.CATEGORY_MAP].newValue as CategoryMap) ?? {};
  }
  if (changes[STORAGE_KEYS.TOP_K_PILLS]) {
    topKPills = (changes[STORAGE_KEYS.TOP_K_PILLS].newValue as number) ?? DEFAULT_TOP_K_PILLS;
  }
});

/**
 * Two-channel suppression: opacity + desaturation.
 *
 * sensitivity 0:   no suppression at all
 * sensitivity 1-49: opacity only (floor 0.45)
 * sensitivity 50-100: opacity (floor 0.40) + desaturation
 */
function computeSuppression(score: number): { opacity: number; saturate: number } {
  const s = sensitivity / 100; // normalize to 0-1

  // Opacity: linear dim with safe floor for text readability
  const opacityFloor = s >= 0.5 ? 0.40 : 0.45;
  const opacity = Math.max(opacityFloor, Math.min(1.0, 1.0 - s * (1.0 - score)));

  // Desaturation: only above sensitivity 50
  let saturate = 1.0;
  if (s >= 0.5) {
    const desatStrength = (s - 0.5) / 0.5; // 0→1 as sensitivity goes 50→100
    saturate = 1.0 - desatStrength * (1.0 - score); // low scores get more desaturated
    saturate = Math.max(0.3, Math.min(1.0, saturate));
  }

  return { opacity, saturate };
}

function applySensitivityToExistingScores(): void {
  document.querySelectorAll<HTMLElement>(".ss-scored").forEach((el) => {
    const score = Number(el.dataset.siftScore);
    if (!Number.isFinite(score)) return;
    const clamped = Math.max(0, Math.min(1, score));
    const { opacity, saturate } = computeSuppression(clamped);
    el.style.setProperty("--ss-opacity", String(opacity));
    el.style.setProperty("--ss-sat", String(saturate));
  });
}

/** Track the active tooltip so only one shows at a time */
let activeTip: HTMLElement | null = null;

/** Extract top-K visible pills from a PresetRanking, filtered by minimum score. */
function rankingToPills(ranking: PresetRanking): PresetRank[] {
  return ranking.ranks
    .slice(0, topKPills)
    .filter((r) => r === ranking.top || r.score >= ANCHOR_MIN_SCORE);
}

/**
 * Create the score inspector ("?") button. Sends EXPLAIN_SCORE to background
 * and shows a deterministic rationale in a tooltip near the button.
 */
function createExplainButton(
  text: string,
  score: number,
  ranking?: PresetRanking,
  votesContainer?: HTMLSpanElement,
): HTMLSpanElement {
  const btn = document.createElement("span");
  btn.className = "ss-vote ss-explain-btn";
  btn.textContent = "?";
  btn.title = "Inspect score";

  // Persists across tooltip reopens so the user's pill selection is remembered
  let overrideAnchor: string | undefined;

  /** Fetch and display explanation for the given anchor. */
  async function fetchExplanation(body: HTMLElement, tip: HTMLElement, anchorId?: string): Promise<void> {
    body.textContent = "Analyzing score\u2026";
    tip.classList.add("ss-thinking");
    try {
      const resp = await chrome.runtime.sendMessage({
        type: MSG.EXPLAIN_SCORE,
        payload: { text, score, anchorId, ranking },
      });
      if (!document.body.contains(tip)) return;
      tip.classList.remove("ss-thinking");
      body.textContent = resp?.error || resp?.explanation || "No explanation available.";
    } catch {
      if (document.body.contains(tip)) {
        tip.classList.remove("ss-thinking");
        body.textContent = "Inspector unavailable.";
      }
    }
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Dismiss existing tooltip
    if (activeTip) {
      activeTip.remove();
      activeTip = null;
    }

    // Position relative to the button
    const rect = btn.getBoundingClientRect();

    const tip = document.createElement("div");
    tip.className = "ss-explain-tip ss-thinking";

    const header = document.createElement("div");
    header.className = "ss-inspector-head";

    const bandPill = document.createElement("span");
    bandPill.className = "ss-inspector-pill ss-inspector-band";
    bandPill.textContent = getScoreBand(score);

    const scorePill = document.createElement("span");
    scorePill.className = "ss-inspector-pill";
    scorePill.textContent = score.toFixed(2);

    header.append(bandPill, scorePill);

    const body = document.createElement("div");
    body.className = "ss-inspector-body";
    body.textContent = "Analyzing score\u2026";

    tip.append(header);

    // Determine which anchor is currently active (override or model-detected top)
    const effectiveAnchor = overrideAnchor || ranking?.top.anchor;

    // Preset ranking pills — own row between header and body
    if (ranking) {
      const pills = rankingToPills(ranking);
      const lensRow = document.createElement("div");
      lensRow.className = "ss-inspector-lenses";
      for (const pr of pills) {
        const pill = document.createElement("span");
        pill.className = "ss-inspector-lens";
        if (pr.anchor === effectiveAnchor) pill.classList.add("ss-lens-active");
        const anchorLabel = categoryMap[pr.anchor]?.label ?? pr.anchor;
        pill.textContent = `${anchorLabel} ${pr.score.toFixed(2)}`;
        pill.title = `Score with ${anchorLabel} lens`;
        pill.addEventListener("click", (ev) => {
          ev.stopPropagation();
          // Persist the override for this item
          overrideAnchor = pr.anchor;
          // Set item-level override on the votes container
          if (votesContainer) {
            (votesContainer as any)._setAnchorOverride?.(pr.anchor);
          }
          // Update active state across all pills in this row
          lensRow.querySelectorAll(".ss-inspector-lens").forEach((p) =>
            p.classList.remove("ss-lens-active"),
          );
          pill.classList.add("ss-lens-active");
          // Re-fetch explanation for the newly selected anchor
          void fetchExplanation(body, tip, pr.anchor);
        });
        lensRow.appendChild(pill);
      }
      tip.appendChild(lensRow);
    }

    tip.appendChild(body);
    // Position with fixed coordinates; flip above if near viewport bottom
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 200) {
      tip.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      tip.style.top = `${rect.bottom + 4}px`;
    }
    tip.style.left = `${Math.min(rect.left, window.innerWidth - 380)}px`;
    document.body.appendChild(tip);
    activeTip = tip;

    // Fetch explanation for the effective anchor
    void fetchExplanation(body, tip, effectiveAnchor);

    // Dismiss on click outside
    const dismiss = (ev: MouseEvent) => {
      if (!tip.contains(ev.target as Node) && ev.target !== btn) {
        tip.remove();
        if (activeTip === tip) activeTip = null;
        document.removeEventListener("click", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("click", dismiss, true), 0);
  });

  return btn;
}

/**
 * Apply Sift ambient styling to an existing page element.
 * - Blue→amber accent mark (::before, zero layout shift)
 * - Two-channel suppression: opacity + desaturation
 * - Score chip for HIGH (always) / GOOD (hover) bands
 * - Vote buttons + inspector button appear on hover (if source provided)
 */
export function applyScore(
  result: VibeResult,
  el: HTMLElement,
  voteAnchor?: HTMLElement | null,
  source?: "hn" | "reddit" | "x",
  ranking?: PresetRanking,
): void {
  injectStyles();

  // Muted-keyword filtered items: near-invisible, no controls
  if (result.filtered) {
    el.style.setProperty("--ss-opacity", "0.08");
    el.style.setProperty("--ss-sat", "0");
    el.dataset.siftScore = "-1";
    el.dataset.siftFiltered = "true";
    if (!el.classList.contains("ss-scored")) {
      el.classList.add("ss-scored");
    }
    return; // no chip, no buttons, no explain
  }

  const score = Math.max(0, Math.min(1, result.rawScore));
  const hue = Math.round(scoreToHue(score));
  const { opacity, saturate } = computeSuppression(score);

  el.style.setProperty("--ss-h", String(hue));
  el.style.setProperty("--ss-opacity", String(opacity));
  el.style.setProperty("--ss-sat", String(saturate));
  el.dataset.siftScore = String(score);

  // Guard: only create controls once per element
  if (el.classList.contains("ss-scored")) return;

  el.classList.add("ss-scored");

  // Score chip for HIGH / GOOD bands — inline, attached to visual anchor
  const anchor = voteAnchor || el;
  if (anchor !== el) {
    // When controls/chips are mounted outside the scored node (e.g. X),
    // mark host so hover rules can still reveal actions.
    anchor.classList.add("ss-vote-host");
    anchor.style.setProperty("--ss-h", String(hue));
  }

  const band = getScoreBand(score);
  if (band === "HIGH" || band === "GOOD") {
    const chip = document.createElement("span");
    chip.className = "ss-score-chip";
    chip.dataset.band = band;
    chip.textContent = `${band} ${score.toFixed(2)}`;
    anchor.appendChild(chip);
  }

  if (source) {
    const buttons = createLabelButtons(result.text, source, ranking);
    buttons.appendChild(createExplainButton(result.text, score, ranking, buttons));
    anchor.appendChild(buttons);
  }
}

export function clearAppliedScores(): void {
  document.querySelectorAll<HTMLElement>(".ss-scored").forEach((el) => {
    el.classList.remove("ss-scored");
    el.style.removeProperty("--ss-h");
    el.style.removeProperty("--ss-opacity");
    el.style.removeProperty("--ss-sat");
    delete el.dataset.siftScore;
  });

  document.querySelectorAll(".ss-votes, .ss-score-chip").forEach((el) => el.remove());

  if (activeTip) {
    activeTip.remove();
    activeTip = null;
  }
}

export function resetSiftMarkers(): void {
  document.querySelectorAll<HTMLElement>("[data-sift]").forEach((el) => {
    delete el.dataset.sift;
    el.classList.remove("ss-pending");
  });
}

/**
 * Register a callback that fires when active categories change.
 * Clears existing scores and markers so items get re-processed.
 */
export function onCategoriesChanged(callback: () => void): void {
  let lastVersion = 0;
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MSG.CATEGORIES_CHANGED) {
      const v = message.payload?.categoriesVersion ?? 0;
      if (v <= lastVersion) return; // stale
      lastVersion = v;
      // Clear existing scores so items get re-processed
      clearAppliedScores();
      resetSiftMarkers();
      callback();
    }
  });
}
