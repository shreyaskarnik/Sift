/** Result of scoring a single text against the anchor */
export interface VibeResult {
  text: string;
  rawScore: number;
  status: string;
  emoji: string;
  colorHSL: string;
}

/** A user-provided training label (thumbs up/down) */
export interface TrainingLabel {
  text: string;
  label: "positive" | "negative";
  source: "hn" | "reddit" | "x" | "x-import" | "web";
  timestamp: number;
  /** Active anchor at label time (bookkeeping). */
  anchor?: string;
  /** Auto-detected top preset lens/lenses for the labeled text. */
  detectedAnchors?: string[];
}

/** Model loading status */
export interface ModelStatus {
  state: "idle" | "loading" | "ready" | "error";
  progress?: number;
  message?: string;
  backend?: "webgpu" | "wasm";
  modelId?: string;
}

/** Message envelope for chrome.runtime messaging */
export interface ExtensionMessage {
  type: string;
  payload?: unknown;
}

/** Payload for SCORE_TEXTS */
export interface ScoreTextsPayload {
  texts: string[];
}

/** Payload for SCORE_RESULTS */
export interface ScoreResultsPayload {
  results: VibeResult[];
}

/** Payload for SAVE_LABEL */
export interface SaveLabelPayload {
  label: TrainingLabel;
}

/** Payload for UPDATE_ANCHOR */
export interface UpdateAnchorPayload {
  anchor: string;
}

/** Payload for IMPORT_X_LABELS */
export interface ImportXLabelsPayload {
  labels: TrainingLabel[];
}

/** Payload for SET_LABELS */
export interface SetLabelsPayload {
  labels: TrainingLabel[];
}

/** Payload for EXPLAIN_SCORE */
export interface ExplainScorePayload {
  text: string;
  score: number;
}

/** Payload for GET_PAGE_SCORE */
export interface GetPageScorePayload {
  tabId: number;
}

/** Response from GET_PAGE_SCORE */
export interface PageScoreResponse {
  title: string;
  normalizedTitle: string;
  result: VibeResult | null;
  state: "ready" | "loading" | "unavailable" | "disabled";
}
