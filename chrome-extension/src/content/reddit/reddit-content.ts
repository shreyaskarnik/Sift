import { scoreTexts } from "../common/batch-scorer";
import { applyScore, loadSettings, isSiteEnabled } from "../common/widget";

function getTitleElements(): { el: Element; text: string }[] {
  const items: { el: Element; text: string }[] = [];

  // New Reddit (shreddit web components)
  document.querySelectorAll("shreddit-post").forEach((post) => {
    const title = post.getAttribute("post-title");
    if (title && !post.getAttribute("data-simscore")) {
      items.push({ el: post, text: title });
    }
  });

  // Old Reddit
  if (items.length === 0) {
    document.querySelectorAll<HTMLAnchorElement>("a.title").forEach((el) => {
      const text = el.textContent?.trim();
      if (text && !el.dataset.simscore) {
        items.push({ el, text });
      }
    });
  }

  // Fallback: new reddit non-shreddit
  if (items.length === 0) {
    document.querySelectorAll("a[data-click-id='body'] h3").forEach((h3) => {
      const text = h3.textContent?.trim();
      const parent = h3.closest("a");
      if (text && parent && !parent.dataset.simscore) {
        items.push({ el: parent, text });
      }
    });
  }

  return items;
}

async function processReddit() {
  if (!isSiteEnabled("reddit")) return;

  const items = getTitleElements();
  if (items.length === 0) return;

  items.forEach(({ el }) => {
    if (el instanceof HTMLElement) el.dataset.simscore = "pending";
    else el.setAttribute("data-simscore", "pending");
  });

  const texts = items.map((i) => i.text);
  const results = await scoreTexts(texts);

  results.forEach((result, i) => {
    const { el } = items[i];
    if (el instanceof HTMLElement) el.dataset.simscore = "done";
    else el.setAttribute("data-simscore", "done");

    const htmlEl = el as HTMLElement;

    if (el.tagName === "SHREDDIT-POST") {
      const titleSlot =
        el.querySelector('[slot="title"]') ||
        el.querySelector("a[slot='full-post-link']");
      applyScore(result, htmlEl, (titleSlot || htmlEl) as HTMLElement, "reddit");
    } else {
      applyScore(result, htmlEl, htmlEl, "reddit");
    }
  });
}

// Debounced MutationObserver
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => processReddit(), 300);
});

(async () => {
  await loadSettings();
  processReddit();
  observer.observe(document.body, { childList: true, subtree: true });
})();
