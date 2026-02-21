// Ported from src/config.py

/** ONNX-quantized embedding model for scoring via Transformers.js */
export const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

/** Default anchor phrase for contrastive similarity scoring */
export const DEFAULT_QUERY_ANCHOR = "MY_FAVORITE_NEWS";

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
  UPDATE_ANCHOR: "UPDATE_ANCHOR",
  RELOAD_MODEL: "RELOAD_MODEL",

  // Storage
  GET_LABELS: "GET_LABELS",
  SET_LABELS: "SET_LABELS",
  CLEAR_LABELS: "CLEAR_LABELS",
  IMPORT_X_LABELS: "IMPORT_X_LABELS",
} as const;

/** Storage keys for chrome.storage.local */
export const STORAGE_KEYS = {
  LABELS: "training_labels",
  ANCHOR: "query_anchor",
  MODEL_DTYPE: "model_dtype",
  CUSTOM_MODEL_ID: "custom_model_id",
  CUSTOM_MODEL_URL: "custom_model_url",
  SENSITIVITY: "score_sensitivity",
  SITE_ENABLED: "site_enabled",
} as const;

/** Batch size for content script scoring requests */
export const SCORE_BATCH_SIZE = 16;
