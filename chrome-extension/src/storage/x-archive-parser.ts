import type { TrainingLabel } from "../shared/types";

/**
 * Parse X archive files (like.js, bookmark.js) into training labels.
 * All imported items are treated as positive labels.
 */
export async function parseXArchiveFiles(files: FileList): Promise<TrainingLabel[]> {
  const labels: TrainingLabel[] = [];
  const now = Date.now();

  for (const file of Array.from(files)) {
    const text = await file.text();
    const parsed = parseXArchiveContent(text);

    for (const tweetText of parsed) {
      labels.push({
        text: tweetText,
        label: "positive",
        source: "x-import",
        timestamp: now,
        anchor: "",
      });
    }
  }

  return labels;
}

/** Clean raw tweet text for embedding training. */
function cleanTweetText(raw: string): string {
  let text = raw;
  // Strip t.co URLs
  text = text.replace(/https?:\/\/t\.co\/\S+/g, "");
  // Strip other URLs
  text = text.replace(/https?:\/\/\S+/g, "");
  // Strip trailing truncation marker
  text = text.replace(/…\s*$/, "");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** Minimum character length for useful training text. */
const MIN_TEXT_LENGTH = 15;

function parseXArchiveContent(content: string): string[] {
  // Strip the "window.YTD.*.part0 = " prefix
  const jsonStart = content.indexOf("[");
  if (jsonStart === -1) return [];

  try {
    const jsonStr = content.slice(jsonStart);
    const data = JSON.parse(jsonStr);

    if (!Array.isArray(data)) return [];

    const texts: string[] = [];

    for (const item of data) {
      // Handle both like.js and bookmark.js formats
      const entry = item.like || item.bookmark || item;
      const fullText = entry.fullText || entry.full_text || entry.text;

      if (fullText && typeof fullText === "string") {
        const cleaned = cleanTweetText(fullText);
        if (cleaned.length >= MIN_TEXT_LENGTH) {
          texts.push(cleaned);
        }
      }
    }

    return texts;
  } catch {
    return [];
  }
}
