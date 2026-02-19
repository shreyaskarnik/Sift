import { scoreTexts } from "../common/batch-scorer";
import { applyScore, loadSettings, isSiteEnabled, onModelReady } from "../common/widget";

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
  unprocessed.forEach(({ el }) => { el.dataset.sift = "pending"; });

  try {
    const texts = unprocessed.map((u) => u.text);
    const results = await scoreTexts(texts);

    results.forEach((result, i) => {
      const { el } = unprocessed[i];
      el.dataset.sift = "done";
      const titleLine = el.parentElement as HTMLElement;
      applyScore(result, titleLine, titleLine, "hn");
    });
  } catch {
    // Reset so items can be retried when model becomes ready
    unprocessed.forEach(({ el }) => { delete el.dataset.sift; });
  }
}

(async () => {
  await loadSettings();
  processHN();
  // Re-process when model becomes ready (handles cold start timing)
  onModelReady(() => processHN());
})();
