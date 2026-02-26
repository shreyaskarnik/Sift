/** Result of scoring a single text against the anchor */
export interface VibeResult {
  text: string;
  rawScore: number;
  status: string;
  emoji: string;
  colorHSL: string;
  /** True if item matched a muted keyword and was filtered */
  filtered?: boolean;
}

/** A user-provided training label (thumbs up/down) */
export interface TrainingLabel {
  text: string;
  label: "positive" | "negative";
  source: "hn" | "reddit" | "x" | "x-import" | "web";
  timestamp: number;
  /** Resolved category ID (override > auto > fallback). Required in schema v2+. */
  anchor: string;
  /** Frozen anchorText at label-save time for training data integrity (schema v3+). */
  anchorText?: string;
  /** What the model predicted as best-match category ID. */
  autoAnchor?: string;
  /** Confidence: top1.score - top2.score gap. */
  autoConfidence?: number;
  /** How anchor was resolved. */
  anchorSource?: "auto" | "override" | "fallback";
}

/** A category definition (built-in or user-created). */
export interface CategoryDef {
  id: string;           // immutable, human-readable (e.g. "ai-research")
  anchorText: string;   // text that gets embedded (e.g. "AI_RESEARCH")
  label: string;        // display name (e.g. "AI Research")
  builtin: boolean;     // true = curated library, false = user-created
  group?: string;       // UI grouping: "tech", "lifestyle", "world"
  archived?: boolean;   // true = hidden from UI/scoring, labels preserved
}

/** Lightweight lookup map written to storage for UI contexts. */
export type CategoryMap = Record<string, { label: string; anchorText: string }>;

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
  rankings?: (PresetRanking | undefined)[];
}

/** A single preset's similarity score. */
export interface PresetRank {
  anchor: string;
  score: number;
}

/** All presets ranked by similarity for a single text. */
export interface PresetRanking {
  ranks: PresetRank[];     // all presets, sorted by score desc
  top: PresetRank;         // ranks[0] — scoring winner
  confidence: number;      // top1.score - top2.score
  ambiguous: boolean;      // confidence < 0.05
}

/** A scored text with optional preset ranking. */
export interface ScoredItem {
  result: VibeResult;
  ranking?: PresetRanking;
}

/** Payload for SAVE_LABEL */
export interface SaveLabelPayload {
  label: TrainingLabel;
  anchorOverride?: string;
  presetRanking?: PresetRanking;
}

/** Payload for IMPORT_X_LABELS */
export interface ImportXLabelsPayload {
  labels: TrainingLabel[];
}

/** Payload for SET_LABELS */
export interface SetLabelsPayload {
  labels: TrainingLabel[];
}

/** Payload for UPDATE_LABEL — identifies label by text+timestamp composite key */
export interface UpdateLabelPayload {
  /** Original text for matching */
  matchText: string;
  /** Original timestamp for matching */
  matchTimestamp: number;
  /** Fields to update (partial) */
  updates: {
    text?: string;
    label?: "positive" | "negative";
    anchor?: string;
  };
}

/** Payload for DELETE_LABEL — identifies label by text+timestamp composite key */
export interface DeleteLabelPayload {
  matchText: string;
  matchTimestamp: number;
}

/** Payload for FETCH_PAGE_TITLE */
export interface FetchPageTitlePayload {
  url: string;
}

/** Payload for EXPLAIN_SCORE */
export interface ExplainScorePayload {
  text: string;
  score: number;
  anchorId?: string;
  ranking?: PresetRanking;
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
  ranking?: PresetRanking;
  state: "ready" | "loading" | "unavailable" | "disabled";
}

/** Payload broadcast via PAGE_SCORE_UPDATED (includes tabId for routing) */
export interface PageScoreUpdatedPayload extends PageScoreResponse {
  tabId: number;
}

/** Per-category label statistics for taste UI */
export interface CategoryLabelStats {
  pos: number;
  neg: number;
  lastTimestamp: number;
}

/** Aggregated category score (from radar chart computation) */
export interface AggregatedCategory {
  id: string;
  label: string;
  score: number;
}

/** Return value from renderRadarChart */
export interface RadarRenderResult {
  rendered: boolean;
  categories: AggregatedCategory[];
}

/** A single probe result in the taste profile */
export interface TasteProbeResult {
  probe: string;
  score: number;
  category: string;
}

/** Response from COMPUTE_TASTE_PROFILE.
 * "loading" is a popup-only UI state (never emitted by background). */
export interface TasteProfileResponse {
  state: "loading" | "ready" | "insufficient_labels" | "error";
  message?: string;
  probes: TasteProbeResult[];
  labelCount: number;
  timestamp: number;
  cacheKey: string;
}

/** A single HN story scored by the agent */
export interface AgentStory {
  id: number;
  title: string;
  url: string;
  domain: string;
  hnScore: number;
  by: string;
  time: number;
  descendants: number;
  tasteScore: number;
  topCategory?: string;
}

/** Response from AGENT_FETCH_HN */
export interface AgentFetchHNResponse {
  stories: AgentStory[];
  elapsed: number;
  error?: string;
}

/** A cached embedding entry in chrome.storage.local */
export interface EmbeddingCacheEntry {
  /** Float32Array serialized as number[] for JSON storage */
  embedding: number[];
  /** Model ID that generated this embedding (cache invalidation key) */
  modelId: string;
  /** Unix timestamp for LRU eviction */
  timestamp: number;
}
