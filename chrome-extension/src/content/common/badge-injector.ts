import type { VibeResult } from "../../shared/types";

export function createBadge(result: VibeResult): HTMLSpanElement {
  const score = Math.max(0, Math.min(1, result.rawScore));
  const hue = Math.floor(score * 120); // 0 red → 60 yellow → 120 green
  const tier = result.status.replace("VIBE:", "");

  const badge = document.createElement("span");
  badge.className = "ss-badge";
  badge.title = `SimScore: ${result.rawScore.toFixed(4)}`;
  badge.style.setProperty("--ss-h", String(hue));
  badge.style.setProperty("--ss-fill", `${Math.round(score * 100)}%`);

  // Glowing dot
  const dot = document.createElement("span");
  dot.className = "ss-dot";

  // Tier label
  const label = document.createElement("span");
  label.className = "ss-tier";
  label.textContent = tier;

  badge.append(dot, label);
  return badge;
}
