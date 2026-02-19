import { scoreTexts } from "../common/batch-scorer";
import { applyScore, loadSettings, isSiteEnabled } from "../common/widget";

async function processHN() {
  if (!isSiteEnabled("hn")) return;

  const links = document.querySelectorAll<HTMLAnchorElement>(".titleline > a");
  const unprocessed: { el: HTMLAnchorElement; text: string }[] = [];

  links.forEach((el) => {
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
    const titleLine = el.parentElement as HTMLElement;
    applyScore(result, titleLine, titleLine, "hn");
  });
}

(async () => {
  await loadSettings();
  processHN();
})();
