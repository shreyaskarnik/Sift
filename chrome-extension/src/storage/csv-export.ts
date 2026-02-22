import type { TrainingLabel, CategoryMap } from "../shared/types";

interface LabelEntry {
  text: string;
  anchorText: string;  // frozen per-label embedding text for CSV output
}

interface AnchorGroup {
  positives: LabelEntry[];
  negatives: LabelEntry[];
}

/**
 * Group labels by resolved anchor ID. Shared by export and readiness check.
 * Each entry carries its own frozen `anchorText` for CSV output (RD-6),
 * so labels whose anchorText differs within the same category are preserved.
 */
function groupByAnchor(
  labels: TrainingLabel[],
  fallbackAnchor: string,
  categoryMap?: CategoryMap,
): Map<string, AnchorGroup> {
  const groups = new Map<string, AnchorGroup>();
  for (const label of labels) {
    const anchors = resolveAnchorsForLabel(label, fallbackAnchor);
    for (const anchor of anchors) {
      const group = groups.get(anchor) ?? { positives: [], negatives: [] };
      // Per-label anchorText: frozen value > category map lookup > raw anchor ID
      const anchorText = label.anchorText ?? categoryMap?.[anchor]?.anchorText ?? anchor;
      const entry: LabelEntry = { text: label.text, anchorText };
      if (label.label === "positive") group.positives.push(entry);
      else group.negatives.push(entry);
      groups.set(anchor, group);
    }
  }
  return groups;
}

/** Count how many triplets an export would produce (0 = not exportable). */
export function countExportableTriplets(
  labels: TrainingLabel[],
  fallbackAnchor: string,
): number {
  const groups = groupByAnchor(labels, fallbackAnchor);
  let count = 0;
  for (const group of groups.values()) {
    if (group.positives.length > 0 && group.negatives.length > 0) {
      count += Math.max(group.positives.length, group.negatives.length);
    }
  }
  return count;
}

/**
 * Generate multi-anchor Anchor,Positive,Negative triplet CSV from training labels.
 *
 * CSV uses the frozen anchorText (embedding text), not the category ID,
 * so the Python training pipeline receives human-readable anchor strings.
 *
 * @param categoryMap Optional — used as fallback for pre-migration labels missing anchorText
 */
export function exportToCSV(
  labels: TrainingLabel[],
  fallbackAnchor: string,
  categoryMap?: CategoryMap,
): string {
  const normalizedFallback = fallbackAnchor.trim();
  const groups = groupByAnchor(labels, normalizedFallback, categoryMap);

  const rows = ["Anchor,Positive,Negative"];
  let emittedRows = 0;

  for (const [_id, group] of groups) {
    if (group.positives.length === 0 || group.negatives.length === 0) {
      continue;
    }

    if (group.positives.length >= group.negatives.length) {
      let negIdx = 0;
      for (const pos of group.positives) {
        const neg = group.negatives[negIdx % group.negatives.length];
        // Use the positive entry's frozen anchorText (canonical — anchor aligns with positive intent)
        rows.push(`${csvEscape(pos.anchorText)},${csvEscape(pos.text)},${csvEscape(neg.text)}`);
        negIdx++;
        emittedRows++;
      }
    } else {
      let posIdx = 0;
      for (const neg of group.negatives) {
        const pos = group.positives[posIdx % group.positives.length];
        // Use the positive entry's frozen anchorText (canonical)
        rows.push(`${csvEscape(pos.anchorText)},${csvEscape(pos.text)},${csvEscape(neg.text)}`);
        posIdx++;
        emittedRows++;
      }
    }
  }

  if (emittedRows === 0) {
    throw new Error("No anchor group has both positive and negative labels to export.");
  }

  return rows.join("\n") + "\n";
}

function resolveAnchorsForLabel(label: TrainingLabel, fallbackAnchor: string): string[] {
  const stampedAnchor = label.anchor?.trim();
  if (stampedAnchor) return [stampedAnchor];
  return [fallbackAnchor];
}

function csvEscape(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.includes(",") || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}
