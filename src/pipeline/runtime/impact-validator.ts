/**
 * impact-validator.ts (Gap D)
 * ─────────────────────────────────────────────────────────────────
 * 影响面分析的结构化校验：限制 LLM 上游回溯不超过合理边界。
 *
 * 背景：
 *   /api/narrative/analyze-impact 的 LLM Agent 可以判断 affectedSteps（含上游回溯），
 *   prompt 里有 Rule 5「结构性变更才允许回溯」+ Rule 8「上游回溯」，但 LLM 仍可能违规。
 *   极端 case：用户只是改了一行措辞（cosmetic），LLM 把 worldview 也塞进 affectedSteps，
 *   导致 fork 时把整个世界观都洗了 → 用户感觉不可预期。
 *
 * 校验规则（按变更类别）：
 *   - cosmetic   ：affectedSteps 不能早于"最早被修改步骤"本身
 *   - content    ：允许回溯一层（即修改步骤的直接父步骤）
 *   - structural ：允许回溯到「叙事根步骤」中最早的那个（worldview/initial_plan/...）
 *
 * 兜底：
 *   - 不在管线中的 stepId → 剔除并 warning
 *   - 早于允许边界的 stepId → 剔除并 warning
 *   - 修改步骤本身永远在 affectedSteps 中（缺则补）
 *   - canSkip 不能与 modifications 或 safeAffected 重叠
 */

/** 允许 structural 变更回溯到的「叙事根步骤」候选集合。 */
const NARRATIVE_ROOTS: ReadonlySet<string> = new Set([
  "core_concept",      // D0
  "system_architecture", // D1
  "system_detail",     // D2
  "value_framework",   // D3
  "design_doc",        // D4
  "preference_summary",
  "preference_analysis",
  "initial_plan",
  "worldview",
  "story_framework",
  "branch_tree",       // VN/互动影游链根
]);

export type ChangeCategory = "structural" | "content" | "cosmetic";

export interface RawImpactAnalysis {
  affectedSteps?: string[];
  canSkip?: string[];
  nodeImpacts?: Array<{ stepId: string; nodeIds: string[] }> | null;
  rerunFrom?: string;
  changeCategory?: string;
  reasoning?: string;
  confidence?: number;
  nodeLevel?: boolean;
}

export interface ValidatedImpactAnalysis {
  affectedSteps: string[];
  canSkip: string[];
  nodeImpacts: Array<{ stepId: string; nodeIds: string[] }> | null;
  warnings: string[];
  /** 实际采用的最早回溯边界（在 allSteps 中的索引），便于前端展示 */
  earliestAllowedIdx: number;
  earliestAllowedStep: string | null;
}

/**
 * 计算「该变更类别下允许的最早回溯步骤索引」。
 * - cosmetic：不允许回溯，最早 = 第一个 modified step 自身
 * - content：允许回溯 1 层（即第一个 modified step 的前一步）
 * - structural：允许回溯到 NARRATIVE_ROOTS 中最早出现的那个
 */
function computeEarliestAllowedIdx(
  category: ChangeCategory,
  earliestModIdx: number,
  allSteps: string[],
): number {
  if (category === "cosmetic") return earliestModIdx;
  if (category === "content")  return Math.max(0, earliestModIdx - 1);
  // structural
  const rootIndices = allSteps
    .map((s, idx) => (NARRATIVE_ROOTS.has(s) ? idx : -1))
    .filter(i => i >= 0);
  if (rootIndices.length === 0) return 0;
  // 最早允许 = 出现在 allSteps 中、属于 NARRATIVE_ROOTS 的最早一个
  return Math.min(...rootIndices);
}

/**
 * 校验并修正 LLM 影响面分析输出。
 *
 * @param analysis    LLM 返回的原始分析（可能含违规字段）
 * @param modifiedStepIds  用户实际编辑过的步骤 ID 列表
 * @param dominantCategory 启发式预分类结果（兜底）
 * @param allSteps    当前管线的完整步骤序列
 * @param llmCategory LLM 判定的变更类别（如有，优先用）
 */
export function validateImpactAnalysis(
  analysis: RawImpactAnalysis,
  modifiedStepIds: string[],
  dominantCategory: ChangeCategory,
  allSteps: string[],
  llmCategory?: string,
): ValidatedImpactAnalysis {
  const warnings: string[] = [];

  // 1) 决定最终采用的 category（LLM 输出优先，但限制为合法枚举）
  const category: ChangeCategory =
    (llmCategory === "structural" || llmCategory === "content" || llmCategory === "cosmetic")
      ? llmCategory
      : dominantCategory;
  if (llmCategory && llmCategory !== category) {
    warnings.push(`LLM changeCategory '${llmCategory}' 非法，回退到启发式预分类 '${category}'`);
  }

  // 2) 找出第一个修改步骤在管线中的位置
  const modIndices = modifiedStepIds
    .map(s => allSteps.indexOf(s))
    .filter(i => i >= 0);
  const earliestModIdx = modIndices.length > 0 ? Math.min(...modIndices) : 0;

  // 3) 计算允许的最早回溯边界
  const earliestAllowedIdx = computeEarliestAllowedIdx(category, earliestModIdx, allSteps);
  const earliestAllowedStep = allSteps[earliestAllowedIdx] ?? null;

  // 4) 过滤 affectedSteps：只保留在 allSteps 中且 ≥ earliestAllowedIdx 的
  const rawAffected = analysis.affectedSteps ?? [];
  const safeAffected: string[] = [];
  for (const sid of rawAffected) {
    const idx = allSteps.indexOf(sid);
    if (idx < 0) {
      warnings.push(`affectedSteps 中的 '${sid}' 不在当前管线中，已剔除`);
      continue;
    }
    if (idx < earliestAllowedIdx) {
      warnings.push(
        `affectedSteps 中的 '${sid}' (idx=${idx}) 早于 '${category}' 变更的最早允许回溯边界 ` +
        `'${earliestAllowedStep}' (idx=${earliestAllowedIdx})，已剔除（防 LLM 错杀上游）`,
      );
      continue;
    }
    if (!safeAffected.includes(sid)) safeAffected.push(sid);
  }

  // 5) 修改步骤本身必须在 affectedSteps 中（LLM 漏报兜底）
  for (const sid of modifiedStepIds) {
    if (allSteps.includes(sid) && !safeAffected.includes(sid)) {
      safeAffected.push(sid);
      warnings.push(`修改步骤 '${sid}' 缺失于 LLM affectedSteps，已自动补回`);
    }
  }

  // 6) canSkip 校验：不能含 modifications 或 safeAffected
  const modSet = new Set(modifiedStepIds);
  const affectedSet = new Set(safeAffected);
  const rawSkip = analysis.canSkip ?? [];
  const safeSkip: string[] = [];
  for (const sid of rawSkip) {
    if (!allSteps.includes(sid)) {
      warnings.push(`canSkip 中的 '${sid}' 不在当前管线中，已剔除`);
      continue;
    }
    if (modSet.has(sid)) {
      warnings.push(`canSkip 中的 '${sid}' 是用户修改步骤本身，已剔除（修改步骤永远要重跑）`);
      continue;
    }
    if (affectedSet.has(sid)) {
      warnings.push(`canSkip 中的 '${sid}' 与 affectedSteps 冲突，已剔除`);
      continue;
    }
    if (!safeSkip.includes(sid)) safeSkip.push(sid);
  }

  // 7) nodeImpacts 校验：只保留 stepId 在 safeAffected 中的（避免对未受影响步骤做节点级覆盖）
  const rawNodeImpacts = analysis.nodeImpacts ?? null;
  let nodeImpacts: Array<{ stepId: string; nodeIds: string[] }> | null = null;
  if (rawNodeImpacts) {
    const filtered = rawNodeImpacts.filter(ni => {
      if (!affectedSet.has(ni.stepId)) {
        warnings.push(`nodeImpacts 中的 '${ni.stepId}' 不在 affectedSteps 中，已剔除`);
        return false;
      }
      if (!Array.isArray(ni.nodeIds) || ni.nodeIds.length === 0) {
        warnings.push(`nodeImpacts 中的 '${ni.stepId}' nodeIds 为空，已剔除`);
        return false;
      }
      return true;
    });
    nodeImpacts = filtered.length > 0 ? filtered : null;
  }

  return {
    affectedSteps: safeAffected,
    canSkip: safeSkip,
    nodeImpacts,
    warnings,
    earliestAllowedIdx,
    earliestAllowedStep,
  };
}
