import { MSG } from "../shared/constants";
import type { AgentFetchHNResponse, AgentStory } from "../shared/types";

const fetchBtn = document.getElementById("fetch-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const emptyEl = document.getElementById("empty") as HTMLDivElement;
const listEl = document.getElementById("story-list") as HTMLDivElement;

function formatRelativeTime(epochSec: number): string {
  const delta = Math.floor(Date.now() / 1000) - epochSec;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function renderStories(stories: AgentStory[]): void {
  listEl.replaceChildren();
  emptyEl.textContent = "";

  stories.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "story-row";

    // Rank
    const rank = document.createElement("span");
    rank.className = "story-rank";
    rank.textContent = String(i + 1);

    // Body
    const body = document.createElement("div");
    body.className = "story-body";

    // Title line
    const titleDiv = document.createElement("div");
    titleDiv.className = "story-title";

    const link = document.createElement("a");
    link.href = `https://news.ycombinator.com/item?id=${s.id}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = s.title;
    titleDiv.appendChild(link);

    // Domain span
    const domain = document.createElement("span");
    domain.style.cssText = "color:var(--text-dim);font-size:10px;margin-left:6px";
    domain.textContent = `(${s.domain})`;
    titleDiv.appendChild(domain);

    // Meta
    const meta = document.createElement("div");
    meta.className = "story-meta";
    meta.textContent = `${s.hnScore} pts \u00B7 ${s.by} \u00B7 ${s.descendants} comments \u00B7 ${formatRelativeTime(s.time)}`;

    body.appendChild(titleDiv);
    body.appendChild(meta);

    // Score
    const score = document.createElement("span");
    score.className = "story-score";
    score.textContent = Math.round(s.tasteScore * 100).toString();

    row.appendChild(rank);
    row.appendChild(body);
    row.appendChild(score);
    listEl.appendChild(row);
  });
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

    statusEl.textContent = `Done \u2014 ${resp.stories.length} stories scored in ${resp.elapsed.toFixed(1)}s`;
    renderStories(resp.stories);
  } catch (err) {
    statusEl.textContent = "";
    emptyEl.textContent =
      err instanceof Error ? err.message : "Unexpected error";
  } finally {
    fetchBtn.disabled = false;
  }
}

fetchBtn.addEventListener("click", fetchFeed);
