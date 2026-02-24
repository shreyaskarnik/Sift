import { MSG, STORAGE_KEYS } from "../shared/constants";
import type { AgentFetchHNResponse, AgentStory, CategoryMap } from "../shared/types";

let categoryMap: CategoryMap = {};

const fetchBtn = document.getElementById("fetch-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const emptyEl = document.getElementById("empty") as HTMLDivElement;
const listEl = document.getElementById("story-list") as HTMLDivElement;

function formatRelativeTime(epochSec: number): string {
  const delta = Math.floor(Date.now() / 1000) - epochSec;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)} minutes ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} hours ago`;
  return `${Math.floor(delta / 86400)} days ago`;
}

function renderStories(stories: AgentStory[]): void {
  listEl.replaceChildren();
  emptyEl.textContent = "";

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];

    // Row 1: rank + title + (domain)
    const athing = document.createElement("div");
    athing.className = "story-athing";

    const rank = document.createElement("span");
    rank.className = "story-rank";
    rank.textContent = `${i + 1}.`;

    const titleline = document.createElement("span");
    titleline.className = "story-titleline";

    const link = document.createElement("a");
    link.href = `https://news.ycombinator.com/item?id=${s.id}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = s.title;
    titleline.appendChild(link);

    if (s.domain) {
      const domainSpan = document.createElement("span");
      domainSpan.className = "story-domain";
      domainSpan.textContent = `(${s.domain})`;
      titleline.appendChild(domainSpan);
    }

    if (s.topCategory) {
      const pill = document.createElement("span");
      pill.className = "story-category";
      pill.textContent = categoryMap[s.topCategory]?.label ?? s.topCategory;
      titleline.appendChild(pill);
    }

    athing.appendChild(rank);
    athing.appendChild(titleline);
    listEl.appendChild(athing);

    // Row 2: subtext (points, author, time, comments) + taste score
    const subtext = document.createElement("div");
    subtext.className = "story-subtext";

    const subline = document.createElement("span");
    subline.className = "story-subline";
    subline.textContent = `${s.hnScore} points by ${s.by} ${formatRelativeTime(s.time)} | ${s.descendants} comments`;

    const taste = document.createElement("span");
    taste.className = "story-taste";
    taste.textContent = `${Math.round(s.tasteScore * 100)}`;

    subtext.appendChild(subline);
    subtext.appendChild(taste);
    listEl.appendChild(subtext);
  }
}

async function fetchFeed(): Promise<void> {
  fetchBtn.disabled = true;
  listEl.replaceChildren();
  emptyEl.textContent = "";
  statusEl.textContent = "Fetching stories and scoring...";

  try {
    const resp = (await chrome.runtime.sendMessage({
      type: MSG.AGENT_FETCH_HN,
    })) as AgentFetchHNResponse;

    if (resp.error) {
      statusEl.textContent = "";
      emptyEl.textContent = resp.error;
      return;
    }

    const sec = (resp.elapsed / 1000).toFixed(1);
    statusEl.textContent = `${resp.stories.length} stories scored in ${sec}s`;
    renderStories(resp.stories);
  } catch (err) {
    statusEl.textContent = "";
    emptyEl.textContent = err instanceof Error ? err.message : "Unexpected error";
  } finally {
    fetchBtn.disabled = false;
  }
}

// Load category map for label resolution
chrome.storage.local.get([STORAGE_KEYS.CATEGORY_MAP]).then((store) => {
  categoryMap = (store[STORAGE_KEYS.CATEGORY_MAP] as CategoryMap) ?? {};
});

fetchBtn.addEventListener("click", fetchFeed);
