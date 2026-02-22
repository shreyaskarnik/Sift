/**
 * Label migration system — upgrades stored labels across schema versions.
 *
 * v2 → v3: Maps old anchor strings (e.g. "MY_FAVORITE_NEWS") to immutable
 *           category IDs (e.g. "news"). Unknown anchors get auto-created
 *           archived CategoryDef entries with "legacy-" prefixed IDs.
 */
import {
  LABEL_SCHEMA_VERSION,
  LEGACY_ANCHOR_MAP,
  DEFAULT_ACTIVE_IDS,
  BUILTIN_CATEGORIES,
  STORAGE_KEYS,
} from "../shared/constants";
import type { TrainingLabel, CategoryDef } from "../shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a stable, deduplicated ID for an unknown legacy anchor string.
 *
 * Slugify rules:
 *   1. Lowercase
 *   2. Replace non-alphanumeric chars with `-`
 *   3. Collapse consecutive `-`
 *   4. Strip leading/trailing `-`
 *   5. Cap at 40 chars
 *   6. Prefix with `legacy-`
 *   7. Dedupe against existingIds with `-2`, `-3`, etc.
 *
 * Exported for testability.
 */
export function makeLegacyId(anchorString: string, existingIds: Set<string>): string {
  let slug = anchorString
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  if (slug.length > 40) {
    slug = slug.slice(0, 40).replace(/-$/, "");
  }

  // Fallback for empty/whitespace-only input
  if (!slug) {
    slug = "unknown";
  }

  let candidate = `legacy-${slug}`;
  if (!existingIds.has(candidate)) return candidate;

  let counter = 2;
  while (existingIds.has(`${candidate}-${counter}`)) {
    counter++;
  }
  return `${candidate}-${counter}`;
}

// ---------------------------------------------------------------------------
// Migration entry point
// ---------------------------------------------------------------------------

/**
 * Run all necessary migrations from `fromVersion` up to LABEL_SCHEMA_VERSION.
 *
 * - First run (no labels or version 0): writes version + DEFAULT_ACTIVE_IDS.
 * - v2 → v3: remaps label anchors via LEGACY_ANCHOR_MAP; creates archived
 *   CategoryDef entries for any unknown anchors.
 */
export async function migrateLabels(fromVersion: number): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.LABELS,
    STORAGE_KEYS.CATEGORY_DEFS,
  ]);
  const labels: TrainingLabel[] = stored[STORAGE_KEYS.LABELS] ?? [];
  const customDefs: CategoryDef[] = stored[STORAGE_KEYS.CATEGORY_DEFS] ?? [];

  // First run — no labels, just bootstrap
  if (fromVersion === 0 && labels.length === 0) {
    console.log("[migration] First run — setting schema v3 + default active categories");
    await chrome.storage.local.set({
      [STORAGE_KEYS.LABEL_SCHEMA]: LABEL_SCHEMA_VERSION,
      [STORAGE_KEYS.ACTIVE_CATEGORY_IDS]: [...DEFAULT_ACTIVE_IDS],
    });
    return;
  }

  // v2 → v3 migration
  if (fromVersion < 3) {
    console.log(`[migration] Migrating labels from schema v${fromVersion} → v${LABEL_SCHEMA_VERSION}`);

    // Collect all known IDs (builtin + existing custom) to avoid collisions
    const allKnownIds = new Set<string>([
      ...BUILTIN_CATEGORIES.map((c) => c.id),
      ...customDefs.map((c) => c.id),
    ]);

    // Track auto-created legacy defs to avoid duplicate creation
    const newLegacyDefs: CategoryDef[] = [];
    // Map from old anchor string → new legacy ID (for dedup across labels)
    const legacyIdCache = new Map<string, string>();

    for (const label of labels) {
      const oldAnchor = label.anchor;
      if (!oldAnchor) continue;

      // Preserve the original anchor string for training data integrity
      label.anchorText = oldAnchor;

      // Check if already mapped to a known category ID
      if (LEGACY_ANCHOR_MAP[oldAnchor]) {
        label.anchor = LEGACY_ANCHOR_MAP[oldAnchor];
      } else if (allKnownIds.has(oldAnchor)) {
        // Already a valid category ID (e.g. labels saved after partial migration)
        // No change needed
      } else {
        // Unknown anchor — create an archived legacy CategoryDef
        let legacyId = legacyIdCache.get(oldAnchor);
        if (!legacyId) {
          legacyId = makeLegacyId(oldAnchor, allKnownIds);
          allKnownIds.add(legacyId);
          legacyIdCache.set(oldAnchor, legacyId);

          newLegacyDefs.push({
            id: legacyId,
            anchorText: oldAnchor,
            label: oldAnchor,
            builtin: false,
            archived: true,
          });
        }
        label.anchor = legacyId;
      }
    }

    const mergedDefs = [...customDefs, ...newLegacyDefs];
    const migratedCount = labels.length;
    const legacyCount = newLegacyDefs.length;
    console.log(
      `[migration] Migrated ${migratedCount} labels, created ${legacyCount} legacy category defs`,
    );

    await chrome.storage.local.set({
      [STORAGE_KEYS.LABELS]: labels,
      [STORAGE_KEYS.CATEGORY_DEFS]: mergedDefs,
      [STORAGE_KEYS.LABEL_SCHEMA]: LABEL_SCHEMA_VERSION,
      [STORAGE_KEYS.ACTIVE_CATEGORY_IDS]: [...DEFAULT_ACTIVE_IDS],
    });
  }
}
