import { MSG, STORAGE_KEYS, ANCHOR_LABELS, ANCHOR_MIN_SCORE } from "../../shared/constants";
import type { VibeResult, PresetRanking, PresetRank } from "../../shared/types";
import { scoreToHue, getScoreBand } from "../../shared/scoring-utils";
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

/** Extract visible pills from a PresetRanking (top + optional second if ambiguous). */
function rankingToPills(ranking: PresetRanking): PresetRank[] {
  const pills: PresetRank[] = [ranking.top];
  const second = ranking.ranks[1];
  if (second && second.score >= ANCHOR_MIN_SCORE && ranking.ambiguous) {
    pills.push(second);
  }
  return pills;
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

    // Preset ranking pills — own row between header and body
    if (ranking) {
      const pills = rankingToPills(ranking);
      const lensRow = document.createElement("div");
      lensRow.className = "ss-inspector-lenses";
      for (const pr of pills) {
        const pill = document.createElement("span");
        pill.className = "ss-inspector-lens";
        if (pr.anchor === ranking.top.anchor) pill.classList.add("ss-lens-active");
        pill.textContent = `${ANCHOR_LABELS[pr.anchor] || pr.anchor} ${pr.score.toFixed(2)}`;
        pill.title = `Score with ${ANCHOR_LABELS[pr.anchor] || pr.anchor} lens`;
        pill.addEventListener("click", (ev) => {
          ev.stopPropagation();
          // Set item-level override on the votes container
          if (votesContainer) {
            (votesContainer as any)._setAnchorOverride?.(pr.anchor);
          }
          // Update active state across all pills in this row
          lensRow.querySelectorAll(".ss-inspector-lens").forEach((p) =>
            p.classList.remove("ss-lens-active"),
          );
          pill.classList.add("ss-lens-active");
        });
        lensRow.appendChild(pill);
      }
      tip.appendChild(lensRow);
    }

    tip.appendChild(body);
    tip.style.top = `${rect.bottom + window.scrollY + 4}px`;
    tip.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(tip);
    activeTip = tip;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: MSG.EXPLAIN_SCORE,
        payload: { text, score, anchorId: ranking?.top.anchor },
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
  const band = getScoreBand(score);
  if (band === "HIGH" || band === "GOOD") {
    const chip = document.createElement("span");
    chip.className = "ss-score-chip";
    chip.dataset.band = band;
    chip.textContent = `${band} ${score.toFixed(2)}`;
    (voteAnchor || el).appendChild(chip);
  }

  if (source) {
    const anchor = voteAnchor || el;
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
