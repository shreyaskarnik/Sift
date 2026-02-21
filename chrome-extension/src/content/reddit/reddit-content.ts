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

function getTitleElements(): { el: Element; text: string }[] {
  const items: { el: Element; text: string }[] = [];

  // New Reddit (shreddit web components)
  document.querySelectorAll("shreddit-post").forEach((post) => {
    const title = post.getAttribute("post-title");
    if (title && post.getAttribute("data-sift") !== "done") {
      items.push({ el: post, text: title });
    }
  });

  // Old Reddit
  if (items.length === 0) {
    document.querySelectorAll<HTMLAnchorElement>("a.title").forEach((el) => {
      const text = el.textContent?.trim();
      if (text && el.dataset.sift !== "done") {
        items.push({ el, text });
      }
    });
  }

  // Fallback: new reddit non-shreddit
  if (items.length === 0) {
    document.querySelectorAll("a[data-click-id='body'] h3").forEach((h3) => {
      const text = h3.textContent?.trim();
      const parent = h3.closest("a");
      if (text && parent && (parent as HTMLElement).dataset.sift !== "done") {
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

  // Mark pending
  items.forEach(({ el }) => {
    if (el instanceof HTMLElement) el.dataset.sift = "pending";
    else el.setAttribute("data-sift", "pending");
    (el as HTMLElement).classList.add("ss-pending");
  });

  try {
    const texts = items.map((i) => i.text);
    const scored = await scoreTexts(texts);

    scored.forEach(({ result, ranking }, i) => {
      const { el } = items[i];
      if (el instanceof HTMLElement) el.dataset.sift = "done";
      else el.setAttribute("data-sift", "done");
      (el as HTMLElement).classList.remove("ss-pending");

      const htmlEl = el as HTMLElement;

      if (el.tagName === "SHREDDIT-POST") {
        const titleSlot =
          el.querySelector('[slot="title"]') ||
          el.querySelector("a[slot='full-post-link']");
        applyScore(result, htmlEl, (titleSlot || htmlEl) as HTMLElement, "reddit", ranking);
      } else {
        applyScore(result, htmlEl, htmlEl, "reddit", ranking);
      }
    });
  } catch {
    // Reset so items can be retried
    items.forEach(({ el }) => {
      if (el instanceof HTMLElement) delete el.dataset.sift;
      else el.removeAttribute("data-sift");
      (el as HTMLElement).classList.remove("ss-pending");
    });
  }
}

// Debounced MutationObserver
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => processReddit(), 300);
});

(async () => {
  await loadSettings();
  void processReddit();
  observer.observe(document.body, { childList: true, subtree: true });
  onModelReady(() => void processReddit());

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes[STORAGE_KEYS.SITE_ENABLED]) return;
    const enabled = changes[STORAGE_KEYS.SITE_ENABLED].newValue?.reddit !== false;
    if (!enabled) {
      clearAppliedScores();
      resetSiftMarkers();
      return;
    }
    void processReddit();
  });
})();
