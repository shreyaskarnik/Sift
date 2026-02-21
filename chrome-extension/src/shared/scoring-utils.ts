import { VIBE_THRESHOLDS } from "./constants";

/**
 * Two-zone hue: blue (low) → amber (high), no green midpoint.
 *
 * Below GOOD (0.5): stays in blue family (220→230).
 * Above GOOD (0.5): warm family (50 gold → 25 amber).
 *
 * The step at 0.5 aligns with the GOOD threshold — a clear
 * semantic signal: blue = "meh", warm = "relevant to your lens".
 * Avoids green, which falsely reads as "good/go" to most users.
 */
export function scoreToHue(score: number): number {
  if (score < 0.5) {
    // Cool zone: 220 (blue) → 230 (slightly indigo)
    return 220 + 10 * (score / 0.5);
  }
  // Warm zone: 50 (gold) → 25 (deep amber)
  return 50 - 25 * ((score - 0.5) / 0.5);
}

/** Return band label (HIGH, GOOD, FLAT, LOW) for a clamped 0-1 score. */
export function getScoreBand(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  for (const threshold of VIBE_THRESHOLDS) {
    if (clamped >= threshold.score) {
      return threshold.status.replace("VIBE:", "");
    }
  }
  return "LOW";
}

/**
 * Strip trailing site-name suffixes from page titles.
 * Only strips if the suffix segment is 1-5 words and looks like a brand
 * (starts with uppercase or is all-caps). Preserves meaningful content.
 *
 * "OpenAI launches new model - TechCrunch" → "OpenAI launches new model"
 * "Why AI matters - a deep dive into transformers" → unchanged (lowercase = content)
 */
export function normalizeTitle(title: string): string {
  // Match " - Foo Bar", " | Foo Bar", " — Foo", " · Site Name"
  const match = title.match(/^(.+?)\s*[-|—·]\s*([^-|—·]{2,40})$/);
  if (!match) return title.trim();

  const [, before, suffix] = match;
  const words = suffix.trim().split(/\s+/);

  // Only strip if suffix is 1-5 words and starts with an uppercase letter (brand-like)
  if (words.length <= 5 && /^[A-Z]/.test(words[0])) {
    return before.trim();
  }

  return title.trim();
}
