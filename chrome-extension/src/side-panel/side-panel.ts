import { MSG } from "../shared/constants";
import type { ModelStatus } from "../shared/types";

// Stub — full UI implementation comes in Task 7
const loadingEl = document.querySelector(".sp-loading");
if (loadingEl) loadingEl.textContent = "Sift side panel ready.";

// Listen for model status to verify background communication works
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.MODEL_STATUS) {
    const status = message.payload as ModelStatus;
    if (loadingEl) loadingEl.textContent = `Model: ${status.state}`;
  }
});

// Request current status
chrome.runtime.sendMessage({ type: MSG.GET_STATUS }).then((resp) => {
  if (resp && loadingEl) {
    loadingEl.textContent = `Model: ${resp.modelReady ? "ready" : "loading..."}`;
  }
}).catch(() => {});
