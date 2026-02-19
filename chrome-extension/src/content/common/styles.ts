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
   Sift — Ambient Score Styling
   Prefix: ss-  ·  Zero global leaks
   ═══════════════════════════════════════════ */

/* ── Score indicator — applied to title container ── */
.ss-scored {
  border-left: 2px solid hsl(var(--ss-h, 60), 55%, 48%);
  padding-left: 6px;
  opacity: var(--ss-opacity, 1);
  transition: opacity 0.3s ease;
}

.ss-scored:hover {
  opacity: 1 !important;
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
  color: #888;
  filter: none;
  opacity: 0.5;
  border: 1px solid #ccc;
  border-radius: 50%;
  width: 16px !important;
  height: 16px !important;
  margin-left: 2px;
}

.ss-explain-btn:hover {
  filter: none;
  opacity: 1;
  color: #444;
  border-color: #999;
  background: rgba(0, 0, 0, 0.04);
  transform: scale(1.1);
}

/* ── Explain tooltip (appended to body) ── */
.ss-explain-tip {
  position: absolute;
  z-index: 2147483647;
  max-width: 360px;
  padding: 8px 12px;
  background: #1a1a1a;
  color: #e0e0e0;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  animation: ss-tip-in 0.15s ease-out;
  pointer-events: auto;
}

@keyframes ss-tip-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;
