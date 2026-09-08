/**
 * Unified step display state derivation.
 * All UI surfaces (sidebar PipelineStatus, TextViewPanel, graph mode)
 * share this pure function + icon mapping.
 */

export type StepDisplayState =
  | "completed"
  | "running"
  | "pending"
  | "incomplete"
  | "failed"
  | "skipped"
  | "editing"
  | "draft_ready";

export type EntryStatus = "completed" | "interrupted" | "running" | null;

export interface DraftState {
  editing?: boolean;
  saved?: boolean;
}

export function resolveStepDisplay(
  stepStatus: "completed" | "pending" | "running" | "skipped" | "failed",
  entryStatus: EntryStatus,
  draft: DraftState | undefined,
): StepDisplayState {
  if (draft?.editing) return "editing";
  if (draft?.saved) return "draft_ready";
  if (stepStatus === "completed") return "completed";
  if (stepStatus === "running") return "running";
  if (stepStatus === "failed") return "failed";
  // 缺上游没跑：自成一态。归进 pending 会让用户干等，归进 completed 就是骗人。
  if (stepStatus === "skipped") return "skipped";
  if (entryStatus === "running") return "pending";
  if (entryStatus === "interrupted") return "incomplete";
  return "pending";
}

export function getStepIcon(display: StepDisplayState): string {
  switch (display) {
    case "completed":   return "✓";
    case "running":     return "⟳";
    case "pending":     return "○";
    case "incomplete":  return "◌";
    case "failed":      return "✕";
    case "skipped":     return "⊘";
    case "editing":     return "✎";
    case "draft_ready": return "✎";
  }
}