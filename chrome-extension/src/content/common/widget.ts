import { MSG, STORAGE_KEYS, VIBE_THRESHOLDS } from "../../shared/constants";
import type { VibeResult } from "../../shared/types";
import { injectStyles } from "./styles";
import { createLabelButtons } from "./label-buttons";

/** Per-site enabled flags. Cached, updated via storage listener. */
let siteEnabled: Record<string, boolean> = { hn: true, reddit: true, x: true };

/** Sensitivity 0-100. Cached, updated via storage listener. */
let sensitivity = 50;

/** Load settings from storage. Call once before scoring. */
export async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.SENSITIVITY,
      STORAGE_KEYS.SITE_ENABLED,
    ]);
    sensitivity = stored[STORAGE_KEYS.SENSITIVITY] ?? 50;
    siteEnabled = stored[STORAGE_KEYS.SITE_ENABLED] ?? { hn: true, reddit: true, x: true };
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

// Live-update when user changes settings in the popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEYS.SENSITIVITY]) {
    sensitivity = changes[STORAGE_KEYS.SENSITIVITY].newValue ?? 50;
    applySensitivityToExistingScores();
  }
  if (changes[STORAGE_KEYS.SITE_ENABLED]) {
    siteEnabled = changes[STORAGE_KEYS.SITE_ENABLED].newValue ?? { hn: true, reddit: true, x: true };
  }
});

/**
 * Compute opacity from raw score and sensitivity.
 *
 * sensitivity 0:   everything at full opacity (no dimming)
 * sensitivity 50:  moderate — low scores ~0.5, high scores ~1.0
 * sensitivity 100: extreme — low scores ~0.15, only top stays bright
 */
function computeOpacity(score: number): number {
  const s = sensitivity / 100; // normalize to 0-1
  // Linear dim: opacity = 1 - s * (1 - score)
  // At s=0: always 1. At s=1: opacity equals score.
  const raw = 1.0 - s * (1.0 - score);
  return Math.max(0.15, Math.min(1.0, raw));
}

function applySensitivityToExistingScores(): void {
  document.querySelectorAll<HTMLElement>(".ss-scored").forEach((el) => {
    const score = Number(el.dataset.siftScore);
    if (!Number.isFinite(score)) return;
    const opacity = computeOpacity(Math.max(0, Math.min(1, score)));
    el.style.setProperty("--ss-opacity", String(opacity));
  });
}

/** Track the active tooltip so only one shows at a time */
let activeTip: HTMLElement | null = null;

function getScoreBand(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  for (const threshold of VIBE_THRESHOLDS) {
    if (clamped >= threshold.score) {
      return threshold.status.replace("VIBE:", "");
    }
  }
  return "LOW";
}

/**
 * Create the score inspector ("?") button. Sends EXPLAIN_SCORE to background
 * and shows a deterministic rationale in a tooltip near the button.
 */
function createExplainButton(text: string, score: number): HTMLSpanElement {
  const btn = document.createElement("span");
  btn.className = "ss-vote ss-explain-btn";
  btn.textContent = "?";
  btn.title = "Inspect score";

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

    const scorePill = document.createElement("span");
    scorePill.className = "ss-inspector-pill";
    scorePill.textContent = `${Math.round(score * 100)}%`;

    const bandPill = document.createElement("span");
    bandPill.className = "ss-inspector-pill ss-inspector-band";
    bandPill.textContent = getScoreBand(score);

    const body = document.createElement("div");
    body.className = "ss-inspector-body";
    body.textContent = "Analyzing score\u2026";

    header.append(scorePill, bandPill);
    tip.append(header, body);
    tip.style.top = `${rect.bottom + window.scrollY + 4}px`;
    tip.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(tip);
    activeTip = tip;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: MSG.EXPLAIN_SCORE,
        payload: { text, score },
      });
      if (!document.body.contains(tip)) return; // dismissed while loading
      tip.classList.remove("ss-thinking");
      if (resp?.error) {
        body.textContent = resp.error;
      } else {
        body.textContent = resp?.explanation || "No explanation available.";
      }
    } catch {
      if (document.body.contains(tip)) {
        tip.classList.remove("ss-thinking");
        body.textContent = "Inspector unavailable.";
      }
    }

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
 * - Colored left bar (red → green proportional to score)
 * - Dims low-scoring items based on sensitivity setting
 * - Vote buttons + inspector button appear on hover (if source provided)
 */
export function applyScore(
  result: VibeResult,
  el: HTMLElement,
  voteAnchor?: HTMLElement | null,
  source?: "hn" | "reddit" | "x",
): void {
  injectStyles();

  const score = Math.max(0, Math.min(1, result.rawScore));
  const hue = Math.floor(score * 120); // 0 red → 60 amber → 120 green
  const opacity = computeOpacity(score);

  el.style.setProperty("--ss-h", String(hue));
  el.style.setProperty("--ss-opacity", String(opacity));
  el.dataset.siftScore = String(score);

  // Guard: only create controls once per element
  if (el.classList.contains("ss-scored")) return;

  el.classList.add("ss-scored");

  if (source) {
    const anchor = voteAnchor || el;
    const buttons = createLabelButtons(result.text, source);
    buttons.appendChild(createExplainButton(result.text, score));
    anchor.appendChild(buttons);
  }
}

export function clearAppliedScores(): void {
  document.querySelectorAll<HTMLElement>(".ss-scored").forEach((el) => {
    el.classList.remove("ss-scored");
    el.style.removeProperty("--ss-h");
    el.style.removeProperty("--ss-opacity");
    delete el.dataset.siftScore;
  });

  document.querySelectorAll(".ss-votes").forEach((el) => el.remove());

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
