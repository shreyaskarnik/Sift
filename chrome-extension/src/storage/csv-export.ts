import type { TrainingLabel } from "../shared/types";

/**
 * Generate Anchor,Positive,Negative triplet CSV from training labels.
 * Uses cycling to balance when positives != negatives count.
 * Ported from session_manager.py._create_hn_dataset()
 */
export function exportToCSV(labels: TrainingLabel[], anchor: string): string {
  const positives = labels.filter((l) => l.label === "positive").map((l) => l.text);
  const negatives = labels.filter((l) => l.label === "negative").map((l) => l.text);

  if (positives.length === 0 || negatives.length === 0) {
    throw new Error("Need at least one positive and one negative label to export triplets.");
  }

  const rows = ["Anchor,Positive,Negative"];

  if (positives.length >= negatives.length) {
    // More positives: iterate positives, cycle negatives
    let negIdx = 0;
    for (const pos of positives) {
      const neg = negatives[negIdx % negatives.length];
      rows.push(`${csvEscape(anchor)},${csvEscape(pos)},${csvEscape(neg)}`);
      negIdx++;
    }
  } else {
    // More negatives: iterate negatives, cycle positives
    let posIdx = 0;
    for (const neg of negatives) {
      const pos = positives[posIdx % positives.length];
      rows.push(`${csvEscape(anchor)},${csvEscape(pos)},${csvEscape(neg)}`);
      posIdx++;
    }
  }

  return rows.join("\n") + "\n";
}

function csvEscape(value: string): string {
  // Normalize whitespace to single spaces (removes newlines, tabs, etc.)
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.includes(",") || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}
