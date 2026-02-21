/**
 * Inject Sift styles into the host page.
 * All classes prefixed `ss-` to avoid conflicts.
 * Called once per page — subsequent calls are no-ops.
 */
const STYLE_ID = "sift-styles";

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

const CSS = /* css */ `
/* ═══════════════════════════════════════════
   Sift — Spectral Fade Score Styling
   Prefix: ss-  ·  Minimal host layout impact
   Blue→Amber axis · Two-channel suppression
   ═══════════════════════════════════════════ */

/* ── Pending state: low-contrast shimmer ── */
.ss-pending {
  position: relative;
}

.ss-pending::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 2px;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    transparent 25%,
    rgba(160, 160, 170, 0.06) 50%,
    transparent 75%
  );
  background-size: 200% 100%;
  animation: ss-shimmer 2s ease-in-out infinite;
  will-change: background-position;
}

@keyframes ss-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Score indicator — applied to title container ── */
.ss-scored {
  position: relative;
  border-left: 3px solid hsl(var(--ss-h, 45), 70%, 48%);
  padding-left: 6px;
  opacity: var(--ss-opacity, 1);
  filter: saturate(var(--ss-sat, 1));
  transition: opacity 0.3s ease, filter 0.3s ease;
}

/* Hover OR keyboard focus-within restores full visibility */
.ss-scored:hover,
.ss-scored:focus-within {
  opacity: 1 !important;
  filter: saturate(1) !important;
}

/* ── Score chip — inline, works inside any container ── */
.ss-score-chip {
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  font: 500 9px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0.03em;
  white-space: nowrap;
  pointer-events: none;
  color: hsl(var(--ss-h, 45), 30%, 40%);
  background: hsla(var(--ss-h, 45), 40%, 50%, 0.08);
  border: 1px solid hsla(var(--ss-h, 45), 30%, 50%, 0.15);
  transition: opacity 0.2s ease;
}

/* HIGH (>=0.80): always visible */
.ss-score-chip[data-band="HIGH"] {
  opacity: 0.8;
}

/* GOOD (0.50-0.79): visible on hover/focus only */
.ss-score-chip[data-band="GOOD"] {
  opacity: 0;
}

.ss-scored:hover .ss-score-chip[data-band="GOOD"],
.ss-scored:focus-within .ss-score-chip[data-band="GOOD"] {
  opacity: 0.7;
}

/* ── Vote buttons — hidden until hover ── */
.ss-votes {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  vertical-align: baseline;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.ss-scored:hover .ss-votes,
.ss-votes:has(.ss-on) {
  opacity: 1;
  pointer-events: auto;
}

/* ── Individual vote buttons ── */
.ss-vote {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  cursor: pointer;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: 11px;
  line-height: 1;
  filter: grayscale(100%);
  opacity: 0.4;
  transition: all 0.15s ease;
  -webkit-user-select: none;
  user-select: none;
}

.ss-vote:hover {
  filter: grayscale(30%);
  opacity: 0.8;
  transform: scale(1.15);
}

.ss-vote:active {
  transform: scale(0.85);
  transition-duration: 0.06s;
}

/* Selected state — full color */
.ss-vote.ss-on {
  filter: grayscale(0%);
  opacity: 1;
}

/* Dimmed state — the other button when one is chosen */
.ss-vote.ss-off {
  filter: grayscale(100%);
  opacity: 0.15;
}

.ss-vote.ss-off:hover {
  filter: grayscale(50%);
  opacity: 0.5;
}

/* Pop on selection */
@keyframes ss-pop {
  0%   { transform: scale(1);    }
  35%  { transform: scale(1.4);  }
  65%  { transform: scale(0.9);  }
  100% { transform: scale(1);    }
}

.ss-vote.ss-pop {
  animation: ss-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ── Explain button ("?") ── */
.ss-explain-btn {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-weight: 600;
  font-size: 10px !important;
  filter: none;
  opacity: 0.45;
  border-radius: 50%;
  width: 16px !important;
  height: 16px !important;
  margin-left: 2px;
  /* Adaptive: inherit score hue for tonal harmony */
  color: hsl(var(--ss-h, 0), 12%, 52%);
  border: 1px solid hsl(var(--ss-h, 0), 12%, 72%);
}

.ss-explain-btn:hover {
  filter: none;
  opacity: 1;
  color: hsl(var(--ss-h, 0), 18%, 38%);
  border-color: hsl(var(--ss-h, 0), 18%, 55%);
  background: hsla(var(--ss-h, 0), 15%, 50%, 0.08);
  transform: scale(1.1);
}

/* ── Explain tooltip (appended to body) ── */
.ss-explain-tip {
  position: absolute;
  z-index: 2147483647;
  max-width: 360px;
  padding: 10px 12px;
  background: #1c1c1f;
  color: #d8d8dc;
  font: 12px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3), 0 1px 4px rgba(0, 0, 0, 0.15);
  animation: ss-tip-in 0.18s ease-out;
  pointer-events: auto;
}

/* Tooltip caret */
.ss-explain-tip::before {
  content: "";
  position: absolute;
  top: -6px;
  left: 14px;
  width: 10px;
  height: 10px;
  background: #1c1c1f;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  transform: rotate(45deg);
}

.ss-inspector-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
}

.ss-inspector-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.3;
  letter-spacing: 0.02em;
  font-weight: 700;
  color: #f2f2f4;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
}

.ss-inspector-pill.ss-inspector-band {
  color: #cfe6ff;
  background: rgba(66, 153, 225, 0.18);
  border-color: rgba(66, 153, 225, 0.34);
}

.ss-inspector-body {
  white-space: normal;
}

/* Thinking pulse */
.ss-explain-tip.ss-thinking {
  animation: ss-tip-in 0.18s ease-out;
}

.ss-explain-tip.ss-thinking .ss-inspector-body {
  animation: ss-think-pulse 1.8s ease-in-out 0.2s infinite;
}

@keyframes ss-tip-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes ss-think-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* ── Accessibility: reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .ss-pending::after {
    animation: none;
  }
  .ss-vote.ss-pop {
    animation: none;
  }
  .ss-explain-tip {
    animation: none;
  }
  .ss-scored {
    transition: none;
  }
}

/* ── Accessibility: high contrast ── */
@media (prefers-contrast: more) {
  .ss-scored {
    border-left-width: 4px;
    filter: saturate(1) !important;
  }
  .ss-score-chip {
    border-width: 2px;
    font-weight: 700;
  }
  .ss-score-chip[data-band="GOOD"] {
    opacity: 0.8;
  }
}

/* ── Dark page adaptation ── */
@media (prefers-color-scheme: dark) {
  .ss-scored {
    border-left-color: hsl(var(--ss-h, 45), 60%, 58%);
  }
  .ss-score-chip {
    color: hsl(var(--ss-h, 45), 25%, 70%);
    background: hsla(var(--ss-h, 45), 30%, 50%, 0.12);
    border-color: hsla(var(--ss-h, 45), 25%, 50%, 0.2);
  }
  .ss-explain-btn {
    color: hsl(var(--ss-h, 0), 12%, 62%);
    border-color: hsl(var(--ss-h, 0), 12%, 38%);
  }
  .ss-explain-btn:hover {
    color: hsl(var(--ss-h, 0), 18%, 72%);
    border-color: hsl(var(--ss-h, 0), 18%, 50%);
    background: hsla(var(--ss-h, 0), 15%, 50%, 0.12);
  }
  .ss-explain-tip {
    background: #2a2a2e;
    border-color: rgba(255, 255, 255, 0.12);
  }
  .ss-explain-tip::before {
    background: #2a2a2e;
    border-top-color: rgba(255, 255, 255, 0.12);
    border-left-color: rgba(255, 255, 255, 0.12);
  }
  .ss-inspector-pill {
    border-color: rgba(255, 255, 255, 0.24);
  }
}
`;
