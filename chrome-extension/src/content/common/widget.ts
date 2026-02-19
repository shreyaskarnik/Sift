import { STORAGE_KEYS } from "../../shared/constants";
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

// Live-update when user changes settings in the popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEYS.SENSITIVITY]) {
    sensitivity = changes[STORAGE_KEYS.SENSITIVITY].newValue ?? 50;
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

/**
 * Apply SimScore ambient styling to an existing page element.
 * - Colored left bar (red → green proportional to score)
 * - Dims low-scoring items based on sensitivity setting
 * - Vote buttons appear on hover (if source provided)
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

  // Guard: only apply once per element
  if (el.classList.contains("ss-scored")) return;

  el.classList.add("ss-scored");
  el.style.setProperty("--ss-h", String(hue));
  el.style.setProperty("--ss-opacity", String(opacity));

  if (source) {
    const anchor = voteAnchor || el;
    anchor.appendChild(createLabelButtons(result.text, source));
  }
}
