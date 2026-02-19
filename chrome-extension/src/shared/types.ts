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
  source: "hn" | "reddit" | "x" | "x-import";
  timestamp: number;
}

/** Model loading status */
export interface ModelStatus {
  state: "idle" | "loading" | "ready" | "error";
  progress?: number;
  message?: string;
  backend?: "webgpu" | "wasm";
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
