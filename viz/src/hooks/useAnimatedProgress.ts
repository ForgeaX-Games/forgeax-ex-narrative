/**
 * Animated progress tracker for pipeline steps.
 *
 * Each step's animation duration is scaled to its estimated real duration:
 *   Phase 1: 0%  → 50%  in  est * 0.33  (fast ramp)
 *   Phase 2: 51% → 99%  in  est * 0.67  (slow crawl)
 *   Phase 3: holds at 99% until step completes → jumps to 100%
 *
 * revealTimestamps is ONLY set for steps that transition running→completed
 * in this session. Steps that were already completed on page load get NO
 * reveal timestamp → no staggered animation → nodes appear instantly.
 */
import { useRef, useEffect, useState } from "react";
import { useNarrativeStore } from "../store/narrativeStore";

interface StepProgress {
  stepId: string;
  startedAt: number;
  completedAt: number | null;
}

const PHASE1_RATIO = 0.33;
const PHASE1_TARGET = 50;
const PHASE2_TARGET = 99;

// complexity=3 基准预估时长，complexity 1~5 线性缩放
const STEP_BASE_MS: Record<string, number> = {
  tier_router:              3_000,
  pipeline_config:          3_000,
  preference_summary:      10_000,
  preference_analysis:     25_000,
  initial_outline:         20_000,
  core_settings:           15_000,
  worldview:               25_000,
  plot_synopsis:           10_000,
  story_framework:         60_000,
  outline_batch:           90_000,
  detailed_outline:       150_000,
  character_enrichment:    30_000,
  item_database:           40_000,
  plot_generation:        120_000,
  structure_validation_l3:  5_000,
  script_generation:      120_000,
  quest_generation:       120_000,
  scene_plan:       120_000,
  script_scene_generation:180_000,
  narrative_card:          15_000,
  lore_generation:         30_000,
};
const DEFAULT_EST_MS = 15_000;

// 复杂度不影响偏好/设定等前置步骤（LLM 调用次数固定）
// 主要影响 L0~L4 结构/内容生成步骤
const COMPLEXITY_SENSITIVE = new Set([
  "story_framework", "outline_batch", "detailed_outline",
  "plot_generation", "script_generation", "scene_plan",
  "quest_generation", "script_scene_generation",
  "character_enrichment", "item_database",
]);
const C_FACTOR: Record<number, number> = { 1: 0.35, 2: 0.65, 3: 1.0, 4: 1.6, 5: 2.2 };

function getEstimated(stepId: string, complexity: number): number {
  const base = STEP_BASE_MS[stepId] ?? DEFAULT_EST_MS;
  if (!COMPLEXITY_SENSITIVE.has(stepId)) return base;
  const factor = C_FACTOR[complexity] ?? 1.0;
  return Math.round(base * factor);
}

function calcPct(sp: StepProgress, now: number, complexity: number): number {
  if (sp.completedAt !== null) return 100;
  const est = getEstimated(sp.stepId, complexity);
  const phase1Dur = est * PHASE1_RATIO;
  const phase2Dur = est * (1 - PHASE1_RATIO);
  const elapsed = now - sp.startedAt;

  if (elapsed <= phase1Dur) {
    return Math.round((elapsed / phase1Dur) * PHASE1_TARGET);
  }

  const phase2Elapsed = elapsed - phase1Dur;
  if (phase2Elapsed <= phase2Dur) {
    return PHASE1_TARGET + Math.round((phase2Elapsed / phase2Dur) * (PHASE2_TARGET - PHASE1_TARGET));
  }

  return PHASE2_TARGET;
}

export interface AnimState {
  progressMap: Map<string, number>;
  revealTimestamps: Map<string, number>;
}

export function useAnimatedProgress(): AnimState {
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const activeResult = useNarrativeStore((s) => s.activeResult);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);

  const isViewingRunning = activeEntryKey === runningEntryKey && !!runningRunId;
  const steps = isViewingRunning ? runningProgress : activeSteps;
  const runStatus = isViewingRunning ? "running" : (activeEntryStatus ?? "idle");
  const complexity = (activeResult as Record<string, unknown> | null)?.global_control_params
    ? ((activeResult as Record<string, unknown>).global_control_params as Record<string, number>)?.complexity ?? 3
    : 3;

  const trackingRef = useRef(new Map<string, StepProgress>());
  const revealRef = useRef(new Map<string, number>());
  const rafRef = useRef<number>(0);
  const prevStatusRef = useRef<string>("idle");
  const [animState, setAnimState] = useState<AnimState>({
    progressMap: new Map(),
    revealTimestamps: new Map(),
  });

  useEffect(() => {
    const tracking = trackingRef.current;
    const now = Date.now();

    for (const step of steps) {
      const sp = tracking.get(step.id);

      if (step.status === "running" && !sp) {
        tracking.set(step.id, { stepId: step.id, startedAt: now, completedAt: null });
      }

      if (step.status === "completed" && sp && sp.completedAt === null) {
        sp.completedAt = now;
        if (!revealRef.current.has(step.id)) {
          revealRef.current.set(step.id, now);
        }
      }

      if (step.status === "completed" && !sp) {
        tracking.set(step.id, { stepId: step.id, startedAt: 0, completedAt: 0 });
      }
    }
  }, [steps]);

  useEffect(() => {
    let running = true;
    let lastUpdate = 0;

    function tick() {
      if (!running) return;
      const now = Date.now();

      const throttleMs = runStatus === "running" ? 1000 : 200;
      if (now - lastUpdate < throttleMs) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastUpdate = now;

      const tracking = trackingRef.current;
      const pm = new Map<string, number>();
      let anyActive = false;

      for (const [id, sp] of tracking) {
        const pct = calcPct(sp, now, complexity);
        pm.set(id, pct);
        if (pct < 100) anyActive = true;
      }

      setAnimState({ progressMap: pm, revealTimestamps: new Map(revealRef.current) });

      if (anyActive || runStatus === "running") {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [runStatus, complexity]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = runStatus;

    if (runStatus === "idle") {
      trackingRef.current.clear();
      revealRef.current.clear();
      setAnimState({ progressMap: new Map(), revealTimestamps: new Map() });
    }

    if (
      (runStatus === "completed" || runStatus === "interrupted") &&
      prev !== "running"
    ) {
      trackingRef.current.clear();
      revealRef.current.clear();
      setAnimState({ progressMap: new Map(), revealTimestamps: new Map() });
    }
  }, [runStatus]);

  return animState;
}
