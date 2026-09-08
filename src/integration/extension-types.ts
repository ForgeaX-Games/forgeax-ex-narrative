/**
 * Types for integrating extensions with Narrative Studio.
 * Import these from `@forgeax-extension/narrative`.
 */

export type ReviewStatusValue = "pending" | "approved" | "rejected";

export interface ReviewEntry {
  stepId: string;
  status: ReviewStatusValue;
  feedback?: string;
  reviewedAt?: string;
  regenerateRunId?: string;
}

export interface ReviewState {
  entries: ReviewEntry[];
  updatedAt: string;
}

export interface RegenerateRequest {
  sourceDir: string;
  fromStepId: string;
  userInstructions?: string;
  stopAfterStep?: string;
  patchedContext?: Record<string, unknown>;
  model?: string;
}

export interface RegenerateResponse {
  id: string;
  status: string;
  message: string;
  sourceDir: string;
  fromStepId: string;
  staleSteps: string[];
  tier?: string;
  mode?: string;
}

export interface StaleStepsResponse {
  fromStepId: string;
  mode: string;
  staleSteps: string[];
  staleFields: string[];
}

export interface NarrativeStatusSummary {
  runId: string | null;
  status: "idle" | "running" | "completed" | "failed";
  tier?: string;
  mode?: string;
  completedSteps: number;
  totalSteps: number;
  pendingReviews: number;
  approvedSteps: number;
  rejectedSteps: number;
  isRegenerating: boolean;
  regeneratingStepId?: string;
}

/**
 * Bridge message types that the extension host should handle
 * when embedding the narrative-studio viz iframe.
 */
export type NarrativeBridgeOutbound =
  | { type: "narrative:ready" }
  | { type: "narrative:run-started"; payload: { runId: string; tier?: string; mode?: string } }
  | { type: "narrative:run-completed"; payload: { runId: string } }
  | { type: "narrative:run-failed"; payload: { runId: string; error: string } }
  | { type: "narrative:step-changed"; payload: { stepId: string; status: string; label?: string } }
  | { type: "narrative:progress"; payload: { stepId: string; label?: string; step: number; totalSteps: number; status: string } }
  | { type: "narrative:regenerate-requested"; payload: { stepId: string; instructions?: string } }
  | { type: "narrative:step-approved"; payload: { stepId: string } }
  | { type: "narrative:step-rejected"; payload: { stepId: string; reason?: string } }
  | { type: "narrative:surface-snapshot"; payload: { surface: string; snapshot: Record<string, unknown> } };

export type NarrativeBridgeInbound =
  | { type: "narrative:load-run"; payload: { runId: string } }
  | { type: "narrative:reload" }
  | { type: "narrative:trigger-regenerate"; payload: { stepId: string; instructions?: string } };
