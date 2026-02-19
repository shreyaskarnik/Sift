// Ported from src/vibe_logic.py

import { VIBE_THRESHOLDS } from "./constants";
import type { VibeResult } from "./types";

/** Compute cosine similarity between two vectors (assumed pre-normalized → dot product) */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/** Map a cosine similarity score to a VibeResult (port of map_score_to_vibe) */
export function mapScoreToVibe(text: string, score: number): VibeResult {
  const clamped = Math.max(0, Math.min(1, score));

  // HSL hue: 0 (red) → 120 (green), linear interpolation
  const hue = Math.floor(clamped * 120);
  const colorHSL = `hsl(${hue}, 80%, 50%)`;

  // Walk thresholds from highest to lowest
  let status = VIBE_THRESHOLDS[VIBE_THRESHOLDS.length - 1].status;
  let emoji = VIBE_THRESHOLDS[VIBE_THRESHOLDS.length - 1].emoji;

  for (const threshold of VIBE_THRESHOLDS) {
    if (clamped >= threshold.score) {
      status = threshold.status;
      emoji = threshold.emoji;
      break;
    }
  }

  return { text, rawScore: score, status, emoji, colorHSL };
}
