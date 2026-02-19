import { scoreTexts } from "../common/batch-scorer";
import { applyScore, loadSettings, isSiteEnabled } from "../common/widget";

async function processX() {
  if (!isSiteEnabled("x")) return;

  const tweets =
    document.querySelectorAll<HTMLElement>('[data-testid="tweetText"]');
  const unprocessed: { el: HTMLElement; text: string }[] = [];

  tweets.forEach((el) => {
    if (el.dataset.simscore) return;
    el.dataset.simscore = "pending";
    const text = el.textContent?.trim();
    if (text) unprocessed.push({ el, text });
  });

  if (unprocessed.length === 0) return;

  const texts = unprocessed.map((u) => u.text);
  const results = await scoreTexts(texts);

  results.forEach((result, i) => {
    const { el } = unprocessed[i];
    el.dataset.simscore = "done";
    applyScore(result, el, el, "x");
  });
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
})();
