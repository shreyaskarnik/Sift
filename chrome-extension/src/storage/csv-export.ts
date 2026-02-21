import type { TrainingLabel } from "../shared/types";

interface AnchorGroup {
  positives: string[];
  negatives: string[];
}

/** Group labels by resolved anchor. Shared by export and readiness check. */
function groupByAnchor(
  labels: TrainingLabel[],
  fallbackAnchor: string,
): Map<string, AnchorGroup> {
  const groups = new Map<string, AnchorGroup>();
  for (const label of labels) {
    const anchors = resolveAnchorsForLabel(label, fallbackAnchor);
    for (const anchor of anchors) {
      const group = groups.get(anchor) ?? { positives: [], negatives: [] };
      if (label.label === "positive") group.positives.push(label.text);
      else group.negatives.push(label.text);
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
 * Anchor resolution: label.anchor (required in schema v2+), then fallbackAnchor.
 */
export function exportToCSV(labels: TrainingLabel[], fallbackAnchor: string): string {
  const normalizedFallback = fallbackAnchor.trim();
  const groups = groupByAnchor(labels, normalizedFallback);

  const rows = ["Anchor,Positive,Negative"];
  let emittedRows = 0;

  for (const [anchor, group] of groups) {
    if (group.positives.length === 0 || group.negatives.length === 0) {
      continue;
    }

    if (group.positives.length >= group.negatives.length) {
      let negIdx = 0;
      for (const pos of group.positives) {
        const neg = group.negatives[negIdx % group.negatives.length];
        rows.push(`${csvEscape(anchor)},${csvEscape(pos)},${csvEscape(neg)}`);
        negIdx++;
        emittedRows++;
      }
    } else {
      let posIdx = 0;
      for (const neg of group.negatives) {
        const pos = group.positives[posIdx % group.positives.length];
        rows.push(`${csvEscape(anchor)},${csvEscape(pos)},${csvEscape(neg)}`);
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
