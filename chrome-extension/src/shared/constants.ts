// Ported from src/config.py

import type { CategoryDef } from "./types";

/** ONNX-quantized embedding model for scoring via Transformers.js */
export const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

/**
 * EmbeddingGemma task prompt prefix for classification embeddings.
 * Must match the prompt used during fine-tuning (config.py TASK_NAME = "Classification").
 * See config_sentence_transformers.json in the model repo.
 */
export const EMBED_TASK_PREFIX = "task: classification | query: ";

/** Default anchor phrase for contrastive similarity scoring */
export const DEFAULT_QUERY_ANCHOR = "news";

// ---------------------------------------------------------------------------
// Category library (25 built-in categories with immutable IDs)
// ---------------------------------------------------------------------------

/** Full curated category library. IDs are permanent — never rename or regenerate. */
export const BUILTIN_CATEGORIES: readonly CategoryDef[] = [
  { id: "news",         anchorText: "MY_FAVORITE_NEWS",       label: "News",               builtin: true },
  { id: "ai-research",  anchorText: "AI_RESEARCH",            label: "AI Research",         builtin: true, group: "tech" },
  { id: "startups",     anchorText: "STARTUP_NEWS",           label: "Startups",            builtin: true, group: "tech" },
  { id: "deep-tech",    anchorText: "DEEP_TECH",              label: "Deep Tech",           builtin: true, group: "tech" },
  { id: "science",      anchorText: "SCIENCE_DISCOVERIES",    label: "Science",             builtin: true, group: "tech" },
  { id: "programming",  anchorText: "PROGRAMMING_DEV_TOOLS",  label: "Programming",         builtin: true, group: "tech" },
  { id: "open-source",  anchorText: "OPEN_SOURCE",            label: "Open Source",         builtin: true, group: "tech" },
  { id: "security",     anchorText: "SECURITY_PRIVACY",       label: "Security & Privacy",  builtin: true, group: "tech" },
  { id: "design",       anchorText: "DESIGN_UX",              label: "Design & UX",         builtin: true, group: "tech" },
  { id: "product",      anchorText: "PRODUCT_SAAS",           label: "Product & SaaS",      builtin: true, group: "tech" },
  { id: "finance",      anchorText: "FINANCE_MARKETS",        label: "Finance & Markets",   builtin: true, group: "world" },
  { id: "crypto",       anchorText: "CRYPTO_WEB3",            label: "Crypto & Web3",       builtin: true, group: "world" },
  { id: "politics",     anchorText: "POLITICS",               label: "Politics",            builtin: true, group: "world" },
  { id: "legal",        anchorText: "LEGAL_POLICY",           label: "Legal & Policy",      builtin: true, group: "world" },
  { id: "climate",      anchorText: "CLIMATE_ENERGY",         label: "Climate & Energy",    builtin: true, group: "world" },
  { id: "space",        anchorText: "SPACE_AEROSPACE",        label: "Space & Aerospace",   builtin: true, group: "world" },
  { id: "health",       anchorText: "HEALTH_BIOTECH",         label: "Health & Biotech",    builtin: true, group: "lifestyle" },
  { id: "education",    anchorText: "EDUCATION",              label: "Education",           builtin: true, group: "lifestyle" },
  { id: "gaming",       anchorText: "GAMING",                 label: "Gaming",              builtin: true, group: "lifestyle" },
  { id: "sports",       anchorText: "SPORTS",                 label: "Sports",              builtin: true, group: "lifestyle" },
  { id: "music",        anchorText: "MUSIC",                  label: "Music",               builtin: true, group: "lifestyle" },
  { id: "culture",      anchorText: "CULTURE_ARTS",           label: "Culture & Arts",      builtin: true, group: "lifestyle" },
  { id: "food",         anchorText: "FOOD_COOKING",           label: "Food & Cooking",      builtin: true, group: "lifestyle" },
  { id: "travel",       anchorText: "TRAVEL",                 label: "Travel",              builtin: true, group: "lifestyle" },
  { id: "parenting",    anchorText: "PARENTING",              label: "Parenting",           builtin: true, group: "lifestyle" },
] as const;

/** Category IDs activated on first install — all builtins active by default. */
export const DEFAULT_ACTIVE_IDS: readonly string[] =
  BUILTIN_CATEGORIES.map((c) => c.id);

/** Maps old v2 anchor strings to new immutable category IDs for migration. */
export const LEGACY_ANCHOR_MAP: Record<string, string> = {
  MY_FAVORITE_NEWS:   "news",
  AI_RESEARCH:        "ai-research",
  STARTUP_NEWS:       "startups",
  DEEP_TECH:          "deep-tech",
  SCIENCE_DISCOVERIES: "science",
};


// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Vibe thresholds — score boundaries for each status tier */
export const VIBE_THRESHOLDS = [
  { score: 0.8, status: "VIBE:HIGH", emoji: "✨" },
  { score: 0.5, status: "VIBE:GOOD", emoji: "👍" },
  { score: 0.2, status: "VIBE:FLAT", emoji: "😐" },
  { score: 0.0, status: "VIBE:LOW", emoji: "👎" },
] as const;

/** Chrome message types for runtime messaging */
export const MSG = {
  // Model lifecycle
  INIT_MODEL: "INIT_MODEL",
  MODEL_STATUS: "MODEL_STATUS",
  GET_STATUS: "GET_STATUS",

  // Inference
  SCORE_TEXTS: "SCORE_TEXTS",
  SCORE_RESULTS: "SCORE_RESULTS",

  // Training data
  SAVE_LABEL: "SAVE_LABEL",

  // Score inspector
  EXPLAIN_SCORE: "EXPLAIN_SCORE",

  // Settings
  RELOAD_MODEL: "RELOAD_MODEL",

  // Storage
  GET_LABELS: "GET_LABELS",
  SET_LABELS: "SET_LABELS",
  CLEAR_LABELS: "CLEAR_LABELS",
  IMPORT_X_LABELS: "IMPORT_X_LABELS",

  // Page scoring
  GET_PAGE_SCORE: "GET_PAGE_SCORE",
  PAGE_SCORE_UPDATED: "PAGE_SCORE_UPDATED",

  // Category management
  CATEGORIES_CHANGED: "CATEGORIES_CHANGED",

  // Taste profile
  COMPUTE_TASTE_PROFILE: "COMPUTE_TASTE_PROFILE",

  // Label manager
  FETCH_PAGE_TITLE: "FETCH_PAGE_TITLE",
  UPDATE_LABEL: "UPDATE_LABEL",
  DELETE_LABEL: "DELETE_LABEL",
  RESTORE_LABEL: "RESTORE_LABEL",

  // Agent
  AGENT_FETCH_HN: "AGENT_FETCH_HN",
} as const;

/** Storage keys for chrome.storage.local */
export const STORAGE_KEYS = {
  LABELS: "training_labels",
  MODEL_DTYPE: "model_dtype",
  CUSTOM_MODEL_ID: "custom_model_id",
  CUSTOM_MODEL_URL: "custom_model_url",
  SENSITIVITY: "score_sensitivity",
  SITE_ENABLED: "site_enabled",
  PAGE_SCORING_ENABLED: "page_scoring_enabled",
  LABEL_SCHEMA: "label_schema_version",
  CATEGORY_DEFS: "category_defs",
  ACTIVE_CATEGORY_IDS: "active_category_ids",
  CATEGORY_MAP: "category_map",
  CATEGORIES_VERSION: "categories_version",
  TOP_K_PILLS: "top_k_pills",
  TASTE_PROFILE: "taste_profile",
  EMBEDDING_CACHE: "embedding_cache",
  MUTED_KEYWORDS: "muted_keywords",
  ONBOARDING_DISMISSED: "onboarding_dismissed",
} as const;

/** Default number of category pills shown per scored item */
export const DEFAULT_TOP_K_PILLS = 2;

/** Minimum score gap between top two presets to consider the match unambiguous */
export const ANCHOR_TIE_GAP = 0.05;

/** Minimum score for a secondary preset to qualify as a visible pill */
export const ANCHOR_MIN_SCORE = 0.15;

/** Batch size for content script scoring requests */
export const SCORE_BATCH_SIZE = 16;

/** Maximum number of cached embeddings in chrome.storage.local */
export const EMBEDDING_CACHE_MAX = 2000;

/** Maximum number of muted keywords */
export const MUTED_KEYWORDS_MAX = 200;

/** Minimum positive labels required to compute a taste profile */
export const TASTE_MIN_LABELS = 10;

/** Number of top probes to return in taste profile results */
export const TASTE_TOP_K = 15;

/** Max probes from any single category in the final top-K (diversity cap) */
export const TASTE_MAX_PER_CATEGORY = 3;

/** Negative centroid scaling factor for contrastive taste vector */
export const TASTE_NEG_ALPHA = 0.3;

/** Minimum negative labels to include contrastive signal */
export const TASTE_MIN_NEGATIVES = 3;

/** Bump when TrainingLabel schema changes. Background runs migration on mismatch. */
export const LABEL_SCHEMA_VERSION = 3;
