/**
 * 分支复杂度控制框架
 *
 * complexity(1-5) → entropy → { branch_threshold, merge_threshold, deviation_ceiling }
 *
 * 旧函数 (calculateBranchDecision, deviationToNumeric 等) 保留用于过渡期兼容，
 * 新代码应使用 getEntropy / getLayerEntropy / getTargetBranchRatio / enforceBranchInPlan 等。
 */
import type { LayerControl } from "../../types/index.js";

// ═══════════════════════════════════════════════════
// 1. 常量表
// ═══════════════════════════════════════════════════

export const COMPLEXITY_ENTROPY: Record<number, number> = {
  1: 0.15,
  2: 0.30,
  3: 0.50,
  4: 0.65,
  5: 0.80,
};

const LAYER_DECAY: Record<number, number> = { 0: 1.0, 1: 0.85, 2: 0.72 };

interface LayerProfile {
  gross_min: number;
  gross_max: number;
  merge_tendency_base: number;
  entropy_floor: number;
  entropy_ceil: number;
}

interface ComplexityProfile {
  layers: Record<number, LayerProfile>;
}

/**
 * 5 级 x 3 层参数表。
 * gross_min/max: 该层分支事件频率区间 (0-1)
 * merge_tendency_base: 该层聚合倾向 (0-1)
 * entropy_floor/ceil: 用于 layerEntropy 插值的地板/天花板（基于衰减后的值）
 */
export const COMPLEXITY_PROFILES: Record<number, ComplexityProfile> = {
  1: {
    layers: {
      0: { gross_min: 0.00, gross_max: 0.10, merge_tendency_base: 0.00, entropy_floor: 0.10, entropy_ceil: 0.20 },
      1: { gross_min: 0.00, gross_max: 0.00, merge_tendency_base: 0.00, entropy_floor: 0.08, entropy_ceil: 0.17 },
      2: { gross_min: 0.00, gross_max: 0.00, merge_tendency_base: 0.00, entropy_floor: 0.07, entropy_ceil: 0.14 },
    },
  },
  2: {
    layers: {
      0: { gross_min: 0.05, gross_max: 0.20, merge_tendency_base: 0.10, entropy_floor: 0.20, entropy_ceil: 0.40 },
      1: { gross_min: 0.10, gross_max: 0.20, merge_tendency_base: 0.30, entropy_floor: 0.17, entropy_ceil: 0.34 },
      2: { gross_min: 0.00, gross_max: 0.00, merge_tendency_base: 0.00, entropy_floor: 0.14, entropy_ceil: 0.29 },
    },
  },
  3: {
    layers: {
      0: { gross_min: 0.20, gross_max: 0.30, merge_tendency_base: 0.15, entropy_floor: 0.40, entropy_ceil: 0.60 },
      1: { gross_min: 0.25, gross_max: 0.40, merge_tendency_base: 0.47, entropy_floor: 0.34, entropy_ceil: 0.51 },
      2: { gross_min: 0.30, gross_max: 0.50, merge_tendency_base: 0.67, entropy_floor: 0.29, entropy_ceil: 0.43 },
    },
  },
  4: {
    layers: {
      0: { gross_min: 0.25, gross_max: 0.40, merge_tendency_base: 0.15, entropy_floor: 0.55, entropy_ceil: 0.75 },
      1: { gross_min: 0.35, gross_max: 0.50, merge_tendency_base: 0.47, entropy_floor: 0.47, entropy_ceil: 0.64 },
      2: { gross_min: 0.40, gross_max: 0.60, merge_tendency_base: 0.62, entropy_floor: 0.40, entropy_ceil: 0.54 },
    },
  },
  5: {
    layers: {
      0: { gross_min: 0.30, gross_max: 0.45, merge_tendency_base: 0.15, entropy_floor: 0.70, entropy_ceil: 0.90 },
      1: { gross_min: 0.40, gross_max: 0.55, merge_tendency_base: 0.42, entropy_floor: 0.60, entropy_ceil: 0.77 },
      2: { gross_min: 0.50, gross_max: 0.65, merge_tendency_base: 0.57, entropy_floor: 0.50, entropy_ceil: 0.65 },
    },
  },
};

// ═══════════════════════════════════════════════════
// 1b. 节点预算表（每档复杂度的硬约束）
// ═══════════════════════════════════════════════════

export interface NodeBudget {
  l0_min: number;
  l0_max: number;
  l1_per_min: number;
  l1_per_max: number;
  l2_per_min: number;
  l2_per_max: number;
  total_label: string;
}

/**
 * 每档复杂度对应的节点数量硬约束。
 *
 * l0_min/l0_max: L0 总节点数范围（含分支/结局等结构节点）。
 *   LLM 自由决定 L0 结构（多结局/多线/多开局），结构感知截断仅在极端超标时裁剪主干。
 *   总量约束由 L0 x L1 x L2 的组合关系自动平衡。
 * l1_per: 每个 L0 父节点的 L1 子节点数量范围（1=继承不扩展）
 * l2_per: 每个 L1 父节点的 L2 子节点数量范围（1=继承不扩展）
 *
 * 极简(1): L0 搭好后不再扩展，L1/L2 继承 L0 结构，预期 5-10
 * 短篇(2): 仅 L1 克制细化，L2 继承 L1，预期 15-25
 * 标准(3): L1/L2 均克制细化，预期 35-50
 * 丰富(4): L1/L2 正常细化，预期 75-100
 * 史诗(5): 不限
 */
export const COMPLEXITY_NODE_BUDGET: Record<number, NodeBudget> = {
  1: { l0_min: 5, l0_max: 10, l1_per_min: 1, l1_per_max: 1, l2_per_min: 1, l2_per_max: 1, total_label: "5-10" },
  2: { l0_min: 4, l0_max: 9,  l1_per_min: 2, l1_per_max: 3, l2_per_min: 1, l2_per_max: 1, total_label: "15-25" },
  3: { l0_min: 5, l0_max: 10, l1_per_min: 2, l1_per_max: 3, l2_per_min: 1, l2_per_max: 2, total_label: "35-50" },
  4: { l0_min: 6, l0_max: 12, l1_per_min: 3, l1_per_max: 4, l2_per_min: 2, l2_per_max: 3, total_label: "75-100" },
  5: { l0_min: 7, l0_max: 15, l1_per_min: 3, l1_per_max: 5, l2_per_min: 2, l2_per_max: 4, total_label: "100+" },
};

export function getNodeBudget(complexity: number): NodeBudget {
  return COMPLEXITY_NODE_BUDGET[clamp(Math.round(complexity), 1, 5)]
    ?? COMPLEXITY_NODE_BUDGET[3]!;
}

// ═══════════════════════════════════════════════════
// 2. 核心计算函数
// ═══════════════════════════════════════════════════

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 叙事熵：查表，唯一输入 = complexity */
export function getEntropy(complexity: number): number {
  return COMPLEXITY_ENTROPY[clamp(Math.round(complexity), 1, 5)] ?? 0.30;
}

/** 层级熵衰减：entropy * (layerControl.entropy_inheritance ?? LAYER_DECAY[layer]) */
export function getLayerEntropy(
  entropy: number,
  layer: number,
  layerControl?: LayerControl,
): number {
  const raw = layerControl?.entropy_inheritance ?? LAYER_DECAY[layer] ?? 0.72;
  const decay = clamp(raw, 0.5, 1.0);
  return entropy * decay;
}

/** deviation 允许上限 */
export function getDeviationCeiling(entropy: number): number {
  return clamp(entropy * 1.3, 0.2, 1.0);
}

// ═══════════════════════════════════════════════════
// 3. 目标分支率 / 聚合倾向 / 整体分支指数
// ═══════════════════════════════════════════════════

export interface BranchTarget {
  min: number;
  target: number;
  max: number;
}

/** 从 COMPLEXITY_PROFILES 查表 + layerEntropy 插值 */
export function getTargetBranchRatio(
  complexity: number,
  layerEntropy: number,
  layer: number,
): BranchTarget {
  const c = clamp(Math.round(complexity), 1, 5);
  const profile = COMPLEXITY_PROFILES[c]?.layers[layer];
  if (!profile) return { min: 0, target: 0, max: 0 };

  const range = profile.entropy_ceil - profile.entropy_floor;
  const t = range > 0 ? clamp((layerEntropy - profile.entropy_floor) / range, 0, 1) : 0.5;
  const grossTarget = lerp(profile.gross_min, profile.gross_max, t);

  return { min: profile.gross_min, target: grossTarget, max: profile.gross_max };
}

/** 聚合倾向：纯查表 */
export function getMergeTendency(complexity: number, layer: number): number {
  const c = clamp(Math.round(complexity), 1, 5);
  return COMPLEXITY_PROFILES[c]?.layers[layer]?.merge_tendency_base ?? 0;
}

export interface LayerBranchStats {
  layer: number;
  totalNodes: number;
  branchNodes: number;
  grossRatio: number;
  mergedCount: number;
  netRatio: number;
}

/** 汇总多层的统计为一个整体分支指数 (0-1) */
export function computeOverallBranchIndex(layerStats: LayerBranchStats[]): number {
  if (layerStats.length === 0) return 0;
  const weights: Record<number, number> = { 0: 0.5, 1: 0.3, 2: 0.2 };
  let wSum = 0;
  let vSum = 0;
  for (const s of layerStats) {
    const w = weights[s.layer] ?? 0.1;
    wSum += w;
    vSum += w * s.netRatio;
  }
  return wSum > 0 ? vSum / wSum : 0;
}

// ═══════════════════════════════════════════════════
// 4. 反推 & 强制
// ═══════════════════════════════════════════════════

/** 从 grossTarget 反推每个父节点的分支概率 */
export function deriveBranchProbability(
  grossTarget: number,
  parentCount: number,
  avgChildCount: number,
): number {
  if (parentCount <= 0 || avgChildCount <= 0) return 0;
  const estTotal = parentCount * avgChildCount;
  const targetBranchNodes = grossTarget * estTotal;
  const neededBranchPoints = Math.ceil(targetBranchNodes / 2);
  let bp = neededBranchPoints / parentCount;
  if (avgChildCount < 3) {
    bp = Math.min(bp, 1 / avgChildCount);
  }
  return clamp(bp, 0, 1);
}

export interface StructurePlanItem {
  parent_id: string;
  child_count: number;
  branch_count: number;
  should_merge?: boolean;
  branch_position?: string;
  narrative_stage?: string;
}

const STAGE_BRANCH_PRIORITY: Record<string, number> = {
  climax: 4,
  rising: 3,
  falling: 2,
  opening: 1,
  resolution: 0,
};

/**
 * 在 LLM Step1 结果上强制分支下限 + 聚合目标。
 * 只 enforce 下限（防止 LLM 偷懒），不设上限（不限制 LLM 发挥）。
 */
export function enforceBranchInPlan(
  plans: StructurePlanItem[],
  grossTarget: BranchTarget,
  mergeTendency: number,
  _layer: number,
): StructurePlanItem[] {
  if (plans.length === 0) return plans;
  const result = plans.map((p) => ({ ...p }));

  const totalChildren = result.reduce((s, p) => s + p.child_count, 0);
  if (totalChildren === 0) return result;

  const estBranchNodes = result.reduce(
    (s, p) => s + (p.branch_count >= 2 ? p.branch_count : 0), 0,
  );
  const actualGross = estBranchNodes / totalChildren;

  // 只 enforce 下限：分支率不足时，强制最适合的父节点增加分支
  if (actualGross < grossTarget.min) {
    const sorted = [...result].sort(
      (a, b) =>
        (STAGE_BRANCH_PRIORITY[b.narrative_stage ?? ""] ?? 1) -
        (STAGE_BRANCH_PRIORITY[a.narrative_stage ?? ""] ?? 1),
    );

    const targetBranchNodes = Math.ceil(grossTarget.min * totalChildren);
    let deficit = targetBranchNodes - estBranchNodes;
    for (const p of sorted) {
      if (deficit <= 0) break;
      if (p.branch_count < 2 && p.child_count >= 2) {
        p.branch_count = 2;
        deficit -= 2;
      }
    }
  }

  // 确保有分支的 plan 的 branch_count 不小于 2
  for (const p of result) {
    if (p.branch_count > 1 && p.branch_count < 2) p.branch_count = 2;
  }

  // 聚合倾向 enforce（双向：防过多也防过少）
  const branching = result.filter((p) => p.branch_count >= 2);
  if (branching.length > 0) {
    const mergeCount = branching.filter((p) => p.should_merge).length;
    const mergeRatio = mergeCount / branching.length;
    const tolerance = 0.20;

    if (mergeRatio < mergeTendency - tolerance) {
      let needed = Math.ceil((mergeTendency - tolerance) * branching.length) - mergeCount;
      for (const p of branching) {
        if (needed <= 0) break;
        if (!p.should_merge) {
          p.should_merge = true;
          needed--;
        }
      }
    } else if (mergeRatio > mergeTendency + tolerance) {
      let excess = mergeCount - Math.floor((mergeTendency + tolerance) * branching.length);
      for (const p of branching) {
        if (excess <= 0) break;
        if (p.should_merge) {
          p.should_merge = false;
          excess--;
        }
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════
// 5. Prompt 生成（结构 + 内容分离）
// ═══════════════════════════════════════════════════

/** 结构规则 prompt section（确定性参数，代码会校验） */
export function buildBranchPromptSection(
  layer: number,
  complexity: number,
  layerEntropy: number,
): string {
  const target = getTargetBranchRatio(complexity, layerEntropy, layer);
  const merge = getMergeTendency(complexity, layer);

  const pctMin = Math.round(target.min * 100);
  const pctMax = Math.round(target.max * 100);
  const pctMerge = Math.round(merge * 100);

  const branchFloorHint = complexity >= 4
    ? "建议每个分支点至少 2~3 条路线（高复杂度鼓励多分支）"
    : "每个分支点至少 2 条路线";

  const mergeGuidance =
    layer === 0
      ? "L0 分支代表不可逆的命运分歧，极少合并。"
      : layer === 1
        ? `约 ${pctMerge}% 的 L1 分支应合并，需要自然的叙事收束点。`
        : `约 ${pctMerge}% 的 L2 分支应合并回主线，仅保留最有意义的变化。`;

  const lines: string[] = [
    `## 结构控制规则（必须遵守，代码会校验）`,
    ``,
    `### 分支规则`,
    `- 本层叙事熵: ${layerEntropy.toFixed(2)}`,
    `- 目标分支率: 不低于 ${pctMin}%（建议 ${pctMin}%~${pctMax}%）`,
    `- ${branchFloorHint}`,
    `- 分支偏好: 优先在 climax/rising 阶段`,
    `- branch_count=1 表示不分支，≥2 表示实际分支条数，由你根据叙事需要自由决定`,
    ``,
    `### 聚合规则（破镜难圆——聚合永远比分支难）`,
    `- 本层聚合倾向: ${pctMerge}%`,
    `- ${mergeGuidance}`,
    `- should_merge=true → 本层合并 | should_merge=false → 路由到 L0 预设分支`,
  ];

  return lines.join("\n");
}

/** 内容色彩 prompt section（纯内容层，deviation 指导） */
export function buildDeviationPrompt(deviation: number): string {
  let label: string;
  let guidance: string;

  if (deviation > 0.3) {
    label = "创新突破";
    guidance = "分支应体现创新选择——角色的非常规决定、意料之外的转折";
  } else if (deviation < -0.3) {
    label = "解构颠覆";
    guidance = "分支应体现套路颠覆——英雄堕落、反派救赎、悲剧走向";
  } else {
    label = "经典叙事";
    guidance = "分支遵循经典叙事——光明/黑暗路线、正义/堕落";
  }

  return [
    `## 分支内容色彩（指导分支之间的内容差异）`,
    `- 反套路程度: ${deviation.toFixed(2)}（${label}）`,
    `- ${guidance}`,
  ].join("\n");
}

/** 节点数量指导 prompt section（优先使用 COMPLEXITY_NODE_BUDGET） */
export function buildNodeCountPromptSection(
  layer: number,
  layerEntropy: number,
  minOverride?: number,
  maxOverride?: number,
  complexity?: number,
): string {
  const budget = complexity != null ? getNodeBudget(complexity) : undefined;

  let minNodes: number;
  let maxNodes: number;

  if (budget) {
    if (layer === 0) { minNodes = budget.l0_min; maxNodes = budget.l0_max; }
    else if (layer === 1) { minNodes = budget.l1_per_min; maxNodes = budget.l1_per_max; }
    else { minNodes = budget.l2_per_min; maxNodes = budget.l2_per_max; }
  } else {
    const defaultRanges: Record<number, [number, number]> = { 0: [3, 8], 1: [2, 4], 2: [1, 3] };
    const [dMin, dMax] = defaultRanges[layer] ?? [1, 3];
    minNodes = minOverride ?? dMin;
    maxNodes = maxOverride ?? dMax;
  }

  if (minOverride != null) minNodes = Math.max(minNodes, minOverride);
  if (maxOverride != null) maxNodes = Math.min(maxNodes, maxOverride);
  if (maxNodes < minNodes) maxNodes = minNodes;

  const result = calculateNodeCount(layer, layerEntropy, minNodes, maxNodes);

  const inheritHint = (minNodes === 1 && maxNodes === 1)
    ? "\n- ⚠️ 本层不扩展新节点，每个父节点保持1个子节点（直接继承）"
    : "";

  return `## 节点数量规则
- 建议节点数: ${result.suggested} 个（范围 ${result.min}~${result.max}）
- 节点宜精不宜多，每个节点应承载独立的叙事功能${inheritHint}`;
}

// ═══════════════════════════════════════════════════
// 6. 节点数量计算（deviation 已移除，只用 layerEntropy）
// ═══════════════════════════════════════════════════

export interface NodeCountResult {
  min: number;
  max: number;
  suggested: number;
}

export function calculateNodeCount(
  _layer: number,
  layerEntropy: number,
  minNodes: number,
  maxNodes: number,
): NodeCountResult {
  const factor = clamp(0.3 + 0.7 * layerEntropy, 0.3, 1.0);
  const actualMax = Math.max(minNodes, minNodes + Math.floor((maxNodes - minNodes) * factor));
  const suggested = minNodes + Math.floor((maxNodes - minNodes) * layerEntropy);

  return { min: minNodes, max: actualMax, suggested: Math.max(minNodes, suggested) };
}

// ═══════════════════════════════════════════════════
// 6b. X方向硬裁剪（只钳制 child_count 上限，不碰 branch_count）
// ═══════════════════════════════════════════════════

export function clampChildCount(
  plans: StructurePlanItem[],
  layer: number,
  layerEntropy: number,
  minOverride?: number,
  maxOverride?: number,
  complexity?: number,
): StructurePlanItem[] {
  let effectiveMin = minOverride ?? 1;
  let effectiveMax = maxOverride ?? 5;

  if (complexity != null) {
    const budget = getNodeBudget(complexity);
    if (layer === 1) {
      effectiveMin = budget.l1_per_min;
      effectiveMax = budget.l1_per_max;
    } else if (layer === 2) {
      effectiveMin = budget.l2_per_min;
      effectiveMax = budget.l2_per_max;
    }
    if (minOverride != null) effectiveMin = Math.max(effectiveMin, minOverride);
    if (maxOverride != null) effectiveMax = Math.min(effectiveMax, maxOverride);

    // budget 模式下直接用 effectiveMax 作硬上限，
    // 不再经 calculateNodeCount 的 floor 截断（窄范围如 2-3 会被截到 2-2）
    const isInherit = effectiveMin === 1 && effectiveMax === 1;
    return plans.map(p => ({
      ...p,
      child_count: Math.max(effectiveMin, Math.min(p.child_count, effectiveMax)),
      // 继承模式（min=max=1）：强制禁止分支，防止 buildSkeleton 膨胀
      ...(isInherit ? { branch_count: 1 } : {}),
    }));
  }

  const { max } = calculateNodeCount(layer, layerEntropy, effectiveMin, effectiveMax);
  return plans.map(p => ({
    ...p,
    child_count: Math.max(effectiveMin, Math.min(p.child_count, max)),
  }));
}

// ═══════════════════════════════════════════════════
// 7. 旧 API 兼容层（过渡期保留，新代码不应使用）
// ═══════════════════════════════════════════════════

export type BranchDecisionType = "MUST_BRANCH" | "LLM_DECIDE" | "NO_BRANCH";

export interface BranchDecision {
  decision: boolean;
  minBranches: number;
  maxBranches: number;
  decisionType: BranchDecisionType;
  effectiveBp: number;
  margin: number;
}

/** @deprecated 过渡期保留，新代码用 getTargetBranchRatio + enforceBranchInPlan */
export function getLayerParams(
  layer: number,
  layerControl?: LayerControl,
): { branchProbability: number; minNodes: number; maxNodes: number } {
  const defaultBp: Record<number, number> = { 0: 0.3, 1: 0.3, 2: 0.25 };
  const defaultMin: Record<number, number> = { 0: 5, 1: 2, 2: 1 };
  const defaultMax: Record<number, number> = { 0: 8, 1: 4, 2: 3 };

  return {
    branchProbability: layerControl?.branch_probability ?? defaultBp[layer] ?? 0.3,
    minNodes: layerControl?.min_nodes ?? defaultMin[layer] ?? 2,
    maxNodes: layerControl?.max_nodes ?? defaultMax[layer] ?? 4,
  };
}
