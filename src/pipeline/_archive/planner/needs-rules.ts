/**
 * needs-rules.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/planner/needs-rules.ts`：Step 2 兜底逻辑，当品类无 pipelineTemplate
 * 预置方案时纯粹基于 needs 矩阵阈值选择步骤，与 `buildClassicAutoSteps` 等价。
 * 随 `planner/` 整体搬入，理由见 `./README.md`。
 *
 * 本文件不再被任何活跃代码 import。
 */
import type { NeedsKey, NeedsScore } from "../universal-agent/types.js";

interface NeedsRule {
  stepId: string;
  condition: (needs: Partial<Record<NeedsKey, NeedsScore>>) => boolean;
}

const g = (needs: Partial<Record<NeedsKey, NeedsScore>>, key: NeedsKey): number =>
  needs[key] ?? 0;

/**
 * 通用 needs 规则表（与 buildClassicAutoSteps 对齐）。
 * 顺序即管线执行顺序。
 */
export const NEEDS_RULES: NeedsRule[] = [
  { stepId: "worldview",            condition: (n) => g(n, "W") >= 1 },
  { stepId: "character_enrichment", condition: (n) => g(n, "C") >= 2 },
  { stepId: "item_database",        condition: (n) => g(n, "I") >= 2 },
  { stepId: "story_framework",      condition: (n) => g(n, "S") >= 2 },
  { stepId: "outline_batch",        condition: (n) => g(n, "S") >= 2 },
  { stepId: "detailed_outline",     condition: (n) => g(n, "S") >= 3 },
  { stepId: "plot_generation",      condition: (n) => g(n, "D") >= 2 || g(n, "S") >= 3 },
  { stepId: "script_generation",    condition: (n) => g(n, "D") >= 3 },
  { stepId: "quest_generation",     condition: (n) => g(n, "Q") >= 2 },
  { stepId: "scene_generation",     condition: (n) => g(n, "E") >= 2 },
];

export function selectStepsByNeeds(
  needs: Partial<Record<NeedsKey, NeedsScore>>,
): string[] {
  return NEEDS_RULES
    .filter((rule) => rule.condition(needs))
    .map((rule) => rule.stepId);
}
