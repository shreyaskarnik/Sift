import { scoreTexts } from "../common/batch-scorer";
import { applyScore, loadSettings, isSiteEnabled, onModelReady } from "../common/widget";

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
  unprocessed.forEach(({ el }) => { el.dataset.sift = "pending"; });

  try {
    const texts = unprocessed.map((u) => u.text);
    const results = await scoreTexts(texts);

    results.forEach((result, i) => {
      const { el } = unprocessed[i];
      el.dataset.sift = "done";
      applyScore(result, el, el, "x");
    });
  } catch {
    // Reset so items can be retried
    unprocessed.forEach(({ el }) => { delete el.dataset.sift; });
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
  processX();
  observer.observe(document.body, { childList: true, subtree: true });
  onModelReady(() => processX());
})();
