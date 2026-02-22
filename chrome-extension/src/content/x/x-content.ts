import { STORAGE_KEYS } from "../../shared/constants";
import { scoreTexts } from "../common/batch-scorer";
import {
  applyScore,
  clearAppliedScores,
  loadSettings,
  isSiteEnabled,
  onModelReady,
  onCategoriesChanged,
  resetSiftMarkers,
} from "../common/widget";

async function processX() {
  if (!isSiteEnabled("x")) return;

  const tweets =
    document.querySelectorAll<HTMLElement>('[data-testid="tweetText"]');
  const unprocessed: { el: HTMLElement; text: string }[] = [];

  tweets.forEach((el) => {
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
    const items = await scoreTexts(texts);

    items.forEach(({ result, ranking }, i) => {
      const { el } = unprocessed[i];
      el.dataset.sift = "done";
      el.classList.remove("ss-pending");
      applyScore(result, el, el.parentElement || el, "x", ranking);
    });
  } catch {
    // Reset so items can be retried
    unprocessed.forEach(({ el }) => {
      delete el.dataset.sift;
      el.classList.remove("ss-pending");
    });
  }
}

// Debounced MutationObserver
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => processX(), 300);
});

(async () => {
  await loadSettings();
  void processX();
  observer.observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
  onModelReady(() => void processX());
  onCategoriesChanged(() => void processX());

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes[STORAGE_KEYS.SITE_ENABLED]) return;
    const enabled = changes[STORAGE_KEYS.SITE_ENABLED].newValue?.x !== false;
    if (!enabled) {
      clearAppliedScores();
      resetSiftMarkers();
      return;
    }
    void processX();
  });
})();
