/**
 * Offscreen document — bridges chrome.runtime messages ↔ sandboxed iframe.
 *
 * The sandboxed iframe runs Transformers.js / ONNX Runtime without CSP
 * restrictions (blob URLs are allowed in sandbox pages). This document
 * just relays messages between the service worker and the sandbox.
 */
import { MSG, DEFAULT_QUERY_ANCHOR, STORAGE_KEYS } from "../shared/constants";
import type { ExtensionMessage, ScoreTextsPayload } from "../shared/types";

// ---------------------------------------------------------------------------
// Sandbox iframe setup
// ---------------------------------------------------------------------------

const iframe = document.createElement("iframe");
iframe.src = "sandbox.html";
iframe.style.display = "none";
document.body.appendChild(iframe);

function postToSandbox(msg: any): void {
  iframe.contentWindow?.postMessage(msg, "*");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let modelReady = false;
let anchorReady = false;
let sandboxReady = false;
let initPending = false;

/** Pending score request — only one at a time */
let pendingScoreResolve: ((response: any) => void) | null = null;

/** Pending anchor set request */
let pendingAnchorResolve: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadAnchor(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.ANCHOR, (result) => {
      const stored = result[STORAGE_KEYS.ANCHOR];
      resolve(
        typeof stored === "string" && stored.length > 0
          ? stored
          : DEFAULT_QUERY_ANCHOR
      );
    });
  });
}

async function setAnchor(anchor: string): Promise<void> {
  return new Promise((resolve) => {
    pendingAnchorResolve = resolve;
    postToSandbox({ type: "set_anchor", anchor });
  });
}

// ---------------------------------------------------------------------------
// Sandbox message handler
// ---------------------------------------------------------------------------

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg?.type) return;

  if (msg.type === "sandbox_ready") {
    sandboxReady = true;
    // Always auto-init the model as soon as the sandbox is ready.
    // This avoids timing races with the background's INIT_MODEL message.
    postToSandbox({ type: "init" });
    return;
  }

  if (msg.type === "status") {
    if (msg.state === "ready") {
      modelReady = true;
      // Model loaded — embed the anchor
      loadAnchor().then((anchor) => {
        setAnchor(anchor).then(() => {
          anchorReady = true;
          // If there's a pending score request, now process it
          // (handled by the score flow below)
        });
      });
    }
    // Forward status to service worker
    chrome.runtime
      .sendMessage({
        type: MSG.MODEL_STATUS,
        payload: {
          state: msg.state,
          progress: msg.progress,
          message: msg.message,
          backend: msg.backend,
        },
      })
      .catch(() => {});
    return;
  }

  if (msg.type === "anchor_set") {
    anchorReady = true;
    pendingAnchorResolve?.();
    pendingAnchorResolve = null;
    return;
  }

  if (msg.type === "score_results") {
    pendingScoreResolve?.({ results: msg.results });
    pendingScoreResolve = null;
    return;
  }

  if (msg.type === "error") {
    // Could be from anchor or score
    if (pendingAnchorResolve) {
      pendingAnchorResolve();
      pendingAnchorResolve = null;
    }
    if (pendingScoreResolve) {
      pendingScoreResolve({ error: msg.message });
      pendingScoreResolve = null;
    }
    chrome.runtime
      .sendMessage({
        type: MSG.MODEL_STATUS,
        payload: { state: "error", message: msg.message },
      })
      .catch(() => {});
    return;
  }
});

// ---------------------------------------------------------------------------
// Chrome runtime message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | undefined => {
    if (message.type === MSG.INIT_MODEL) {
      if (sandboxReady) {
        postToSandbox({ type: "init" });
      } else {
        initPending = true;
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MSG.SCORE_TEXTS) {
      const payload = message.payload as ScoreTextsPayload;
      if (!payload?.texts?.length) {
        sendResponse({ results: [] });
        return;
      }
      if (!modelReady) {
        sendResponse({ error: "Model not ready" });
        return;
      }

      // Score request — wait for anchor if needed, then score
      const doScore = () => {
        pendingScoreResolve = sendResponse;
        postToSandbox({ type: "score", texts: payload.texts });
      };

      if (anchorReady) {
        doScore();
      } else {
        // Wait for anchor to be set, then score
        const prevResolve = pendingAnchorResolve;
        pendingAnchorResolve = () => {
          prevResolve?.();
          doScore();
        };
      }
      return true; // Keep message channel open
    }

    if (message.type === MSG.UPDATE_ANCHOR) {
      const payload = message.payload as { anchor: string };
      if (payload?.anchor && modelReady) {
        anchorReady = false;
        setAnchor(payload.anchor);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MSG.GET_STATUS) {
      sendResponse({ modelReady, hasAnchor: anchorReady });
      return;
    }

    return;
  }
);
