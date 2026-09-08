/**
 * API client for extensions that interact with the Narrative Studio backend.
 * Covers regeneration, review state, and stale step preview.
 *
 * Usage in an extension:
 *   import { NarrativeExtensionClient } from "@forgeax-extension/narrative";
 *   const client = new NarrativeExtensionClient("http://localhost:8900");
 */

import type {
  RegenerateRequest,
  RegenerateResponse,
  ReviewEntry,
  ReviewState,
  ReviewStatusValue,
  StaleStepsResponse,
  NarrativeStatusSummary,
} from "./extension-types.js";

export class NarrativeExtensionClient {
  constructor(private baseUrl: string) {}

  async regenerateStep(req: RegenerateRequest): Promise<RegenerateResponse> {
    const res = await fetch(`${this.baseUrl}/api/narrative/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string;
      };
      throw new Error(body.error ?? `Regenerate failed: ${res.status}`);
    }
    return (await res.json()) as RegenerateResponse;
  }

  async getStaleSteps(sourceDir: string, fromStepId: string): Promise<StaleStepsResponse> {
    const params = new URLSearchParams({ sourceDir, fromStepId });
    const res = await fetch(`${this.baseUrl}/api/narrative/stale-steps?${params}`);
    if (!res.ok) throw new Error(`Failed to fetch stale steps: ${res.status}`);
    return (await res.json()) as StaleStepsResponse;
  }

  async getReviewState(dir: string): Promise<ReviewState> {
    const res = await fetch(`${this.baseUrl}/api/narrative/review/${encodeURIComponent(dir)}`);
    if (!res.ok) throw new Error(`Failed to fetch review state: ${res.status}`);
    return (await res.json()) as ReviewState;
  }

  async setStepReview(
    dir: string,
    stepId: string,
    status: ReviewStatusValue,
    feedback?: string,
    regenerateRunId?: string,
  ): Promise<{ ok: boolean; entry: ReviewEntry; review: ReviewState }> {
    const res = await fetch(`${this.baseUrl}/api/narrative/review/${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, status, feedback, regenerateRunId }),
    });
    if (!res.ok) throw new Error(`Failed to set review: ${res.status}`);
    return (await res.json()) as {
      ok: boolean;
      entry: ReviewEntry;
      review: ReviewState;
    };
  }

  async getRunStatus(runId: string): Promise<{ status: string; progress: unknown[] }> {
    const res = await fetch(`${this.baseUrl}/api/narrative/status/${runId}`);
    if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
    return (await res.json()) as { status: string; progress: unknown[] };
  }

  /**
   * Build a NarrativeStatusSummary from run + review data.
   * Useful for a NarrativeStatusCard in an extension sidebar.
   */
  async buildStatusSummary(
    runId: string | null,
    runStatus: "idle" | "running" | "completed" | "failed",
    dir: string | null,
    opts?: { tier?: string; mode?: string; completedSteps?: number; totalSteps?: number; regeneratingStepId?: string },
  ): Promise<NarrativeStatusSummary> {
    let pendingReviews = 0;
    let approvedSteps = 0;
    let rejectedSteps = 0;

    if (dir) {
      try {
        const review = await this.getReviewState(dir);
        for (const entry of review.entries) {
          if (entry.status === "pending") pendingReviews++;
          else if (entry.status === "approved") approvedSteps++;
          else if (entry.status === "rejected") rejectedSteps++;
        }
      } catch { /* review not available yet */ }
    }

    return {
      runId,
      status: runStatus,
      tier: opts?.tier,
      mode: opts?.mode,
      completedSteps: opts?.completedSteps ?? 0,
      totalSteps: opts?.totalSteps ?? 0,
      pendingReviews,
      approvedSteps,
      rejectedSteps,
      isRegenerating: !!opts?.regeneratingStepId,
      regeneratingStepId: opts?.regeneratingStepId,
    };
  }
}
