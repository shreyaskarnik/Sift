/**
 * Inject SimScore styles into the host page.
 * All classes prefixed `ss-` to avoid conflicts.
 * Called once per page — subsequent calls are no-ops.
 */
const STYLE_ID = "simscore-styles";

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

const CSS = /* css */ `
/* ═══════════════════════════════════════════
   SimScore — Ambient Score Styling
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
`;
