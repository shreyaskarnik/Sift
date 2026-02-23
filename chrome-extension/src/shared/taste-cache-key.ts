/**
 * Shared taste profile cache-key computation.
 * Used by background (after compute), popup (staleness check), and full-page view.
 */
import { STORAGE_KEYS, DEFAULT_ACTIVE_IDS } from "./constants";
import { PROBES_VERSION } from "./taste-probes";
import type { TrainingLabel } from "./types";

function djb2Hash(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Build a composite cache key from labels + active categories + model + probe version.
 * Labels are deduped (newest-first) and sorted for determinism.
 */
export async function computeTasteCacheKey(labels: TrainingLabel[]): Promise<string> {
  const sorted = [...labels].sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Set<string>();
  const positives: string[] = [];
  const negatives: string[] = [];
  for (const l of sorted) {
    const norm = l.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (l.label === "positive") positives.push(l.text);
    else negatives.push(l.text);
  }
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACTIVE_CATEGORY_IDS,
    STORAGE_KEYS.CUSTOM_MODEL_ID,
    STORAGE_KEYS.CUSTOM_MODEL_URL,
  ]);
  const catIds = ((stored[STORAGE_KEYS.ACTIVE_CATEGORY_IDS] as string[]) ?? [...DEFAULT_ACTIVE_IDS]).sort().join(",");
  const modelKey = stored[STORAGE_KEYS.CUSTOM_MODEL_URL]
    || stored[STORAGE_KEYS.CUSTOM_MODEL_ID]
    || "default";
  return djb2Hash(
    `${[...positives].sort().join("|")}\0${[...negatives].sort().join("|")}\0${catIds}\0${modelKey}\0${PROBES_VERSION}`,
  );
}

/**
 * Build cache key from pre-split positives/negatives + active category IDs.
 * Used by background after it has already deduped and split labels.
 */
export function computeTasteCacheKeyFromParts(
  positives: string[],
  negatives: string[],
  activeCatIds: Iterable<string>,
  modelKey: string,
): string {
  const sortedPos = [...positives].sort().join("|");
  const sortedNeg = [...negatives].sort().join("|");
  const sortedCats = [...activeCatIds].sort().join(",");
  return djb2Hash(
    `${sortedPos}\0${sortedNeg}\0${sortedCats}\0${modelKey}\0${PROBES_VERSION}`,
  );
}
