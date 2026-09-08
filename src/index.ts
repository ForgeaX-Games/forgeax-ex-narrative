export { NarrativePipeline } from "./pipeline/core/pipeline.js";
export type { PipelineStep, RerunOptions } from "./pipeline/core/pipeline.js";
export { LLMClient, parseJSON, extractJSON } from "./pipeline/runtime/llm-client.js";
export type { LLMCallOptions } from "./pipeline/runtime/llm-client.js";
export { getModeConfig, getModesForTier, TIER_DEFAULT_MODE, STEP_IDS, STEP_OUTPUT_FIELDS } from "./pipeline/routing/modes.js";
export { detectTier } from "./pipeline/routing/tier-router.js";
export { GENRE_TAXONOMY, matchGenre } from "./knowledge/genre-taxonomy.js";
export { TIER4_PRESETS, matchPreset, CATEGORY_KEYWORDS } from "./knowledge/game-narrative/tier4-presets.js";
export type * from "./types/index.js";

// Narrative Runtime integration
export { NarrativeExtensionClient } from "./integration/extension-client.js";
export type {
  ReviewStatusValue,
  ReviewEntry,
  ReviewState,
  RegenerateRequest,
  RegenerateResponse,
  StaleStepsResponse,
  NarrativeStatusSummary,
  NarrativeBridgeOutbound,
  NarrativeBridgeInbound,
} from "./integration/extension-types.js";
