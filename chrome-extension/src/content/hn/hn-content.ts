import { STORAGE_KEYS } from "../../shared/constants";
import { scoreTexts } from "../common/batch-scorer";
import {
  applyScore,
  clearAppliedScores,
  loadSettings,
  isSiteEnabled,
  onModelReady,
  resetSiftMarkers,
} from "../common/widget";

async function processHN() {
  if (!isSiteEnabled("hn")) return;

  const links = document.querySelectorAll<HTMLAnchorElement>(".titleline > a");
  const unprocessed: { el: HTMLAnchorElement; text: string }[] = [];

  links.forEach((el) => {
    if (el.dataset.sift === "done") return;
    const text = el.textContent?.trim();
    if (text) unprocessed.push({ el, text });
  });

  if (unprocessed.length === 0) return;

  // Mark pending
  unprocessed.forEach(({ el }) => {
    el.dataset.sift = "pending";
    el.classList.add("ss-pending");
  });

  try {
    const texts = unprocessed.map((u) => u.text);
    const results = await scoreTexts(texts);

    results.forEach((result, i) => {
      const { el } = unprocessed[i];
      el.dataset.sift = "done";
      el.classList.remove("ss-pending");
      const titleLine = el.parentElement as HTMLElement;
      applyScore(result, titleLine, titleLine, "hn");
    });
  } catch {
    // Reset so items can be retried when model becomes ready
    unprocessed.forEach(({ el }) => {
      delete el.dataset.sift;
      el.classList.remove("ss-pending");
    });
  }
}

(async () => {
  await loadSettings();
  void processHN();
  // Re-process when model becomes ready (handles cold start timing)
  onModelReady(() => void processHN());

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes[STORAGE_KEYS.SITE_ENABLED]) return;
    const enabled = changes[STORAGE_KEYS.SITE_ENABLED].newValue?.hn !== false;
    if (!enabled) {
      clearAppliedScores();
      resetSiftMarkers();
      return;
    }
    void processHN();
  });
})();
