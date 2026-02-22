import type { TrainingLabel } from "../shared/types";

export interface ParseResult {
  labels: TrainingLabel[];
  skipped: number;
}

/**
 * Parse X archive files (like.js, bookmark.js) into training labels.
 * All imported items are treated as positive labels.
 */
export async function parseXArchiveFiles(files: FileList): Promise<ParseResult> {
  const labels: TrainingLabel[] = [];
  let skipped = 0;
  const now = Date.now();

  for (const file of Array.from(files)) {
    const text = await file.text();
    const result = parseXArchiveContent(text);
    skipped += result.skipped;

    for (const tweetText of result.texts) {
      labels.push({
        text: tweetText,
        label: "positive",
        source: "x-import",
        timestamp: now,
        anchor: "",
      });
    }
  }

  return { labels, skipped };
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

function parseXArchiveContent(content: string): { texts: string[]; skipped: number } {
  // Strip the "window.YTD.*.part0 = " prefix
  const jsonStart = content.indexOf("[");
  if (jsonStart === -1) return { texts: [], skipped: 0 };

  try {
    const jsonStr = content.slice(jsonStart);
    const data = JSON.parse(jsonStr);

    if (!Array.isArray(data)) return { texts: [], skipped: 0 };

    const texts: string[] = [];
    let skipped = 0;

    for (const item of data) {
      // Handle both like.js and bookmark.js formats
      const entry = item.like || item.bookmark || item;
      const fullText = entry.fullText || entry.full_text || entry.text;

      if (fullText && typeof fullText === "string") {
        const cleaned = cleanTweetText(fullText);
        if (cleaned.length >= MIN_TEXT_LENGTH) {
          texts.push(cleaned);
        } else {
          skipped++;
        }
      }
    }

    return { texts, skipped };
  } catch {
    return { texts: [], skipped: 0 };
  }
}
