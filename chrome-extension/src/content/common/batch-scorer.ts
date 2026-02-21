import { MSG, SCORE_BATCH_SIZE } from "../../shared/constants";
import type { ScoredItem, PresetRanking } from "../../shared/types";

async function waitForModel(maxWaitMs = 120_000): Promise<void> {
  let delay = 1000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS });
      if (resp?.modelReady && resp?.hasAnchor) return;
    } catch {
      // Extension context might not be ready yet
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 10_000);
  }
  throw new Error("Model did not become ready in time");
}

export async function scoreTexts(texts: string[]): Promise<ScoredItem[]> {
  await waitForModel();

  const items: ScoredItem[] = [];

  for (let i = 0; i < texts.length; i += SCORE_BATCH_SIZE) {
    const batch = texts.slice(i, i + SCORE_BATCH_SIZE);
    const response = await chrome.runtime.sendMessage({
      type: MSG.SCORE_TEXTS,
      payload: { texts: batch },
    });
    if (response?.error) {
      throw new Error(response.error);
    }
    if (response?.results) {
      const rankings: (PresetRanking | undefined)[] = response.rankings ?? [];
      response.results.forEach((result: ScoredItem["result"], j: number) => {
        items.push({ result, ranking: rankings[j] });
      });
    }
  }

  return items;
}
