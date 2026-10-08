/**
 * 分支复杂度控制框架
 *
 * complexity(1-5) → entropy → { branch_threshold, merge_threshold, deviation_ceiling }
 *
 * 旧函数 (calculateBranchDecision, deviationToNumeric 等) 保留用于过渡期兼容，
 * 新代码应使用 getEntropy / getLayerEntropy / getTargetBranchRatio / enforceBranchInPlan 等。
 */
import type { GlobalControlParams, LayerControl, NarrativeContext } from "../../types/index.js";
import { deviationFromLegacy } from "../../types/index.js";
import type { StructureTopology } from "../../knowledge/narrative-axes/index.js";
import { NEUTRAL_TOPOLOGY, getStructureTopology } from "../../knowledge/narrative-axes/index.js";

/**
 * 取本次运行的结构拓扑参数 —— 三层（L0/L1/L2）的分支控制都经它。
 *
 * 事实源只有 `ctx.narrative_axes.structure` 一处：那是三轴综合投票的结论
 * （或用户显式指定）。结构未定时返回中性拓扑，此时树形完全由体量决定，
 * 与接入结构参数之前的行为一致 —— 没有依据就不替用户选结构。
 */
export function structureTopology(ctx: NarrativeContext): StructureTopology {
  return getStructureTopology(ctx.narrative_axes?.structure);
}

export interface L0Budget {
  /** 主干章节数上限。 */
  trunkMax: number;
  /** 含分支与结局的 L0 总节点上限。 */
  totalMax: number;
  /** 主干下限，只在没有用户覆盖时有意义。 */
  trunkMin: number;
  /** 上限是否来自用户明说的章节数。 */
  fromOverride: boolean;
}

/**
 * L0 预算 —— 体量给基线，用户明说的章节数覆盖主干。
 *
 * 两个量不能混：用户说的「5 个章节」是**主干**数，分支节点与结局节点在它之外，
 * 由叙事结构决定。若把 5 当成总量上限，故事一旦分叉就会把主干截回 3 章，
 * 用户看到的是「我要 5 章，它给了 3 章」。
 *
 * 从前 `l0_nodes` 写进上下文后无人读取：L1/L2 认节点预算覆盖，L0 只认体量。
 * 同一个覆盖对象三层里两层生效，是三套结构概念并行时最容易踩到的那处不一致。
 */
export function resolveL0Budget(ctx: NarrativeContext, branchNodeCount = 0): L0Budget {
  const gcp = ctx.global_control_params;
  const budget = getNodeBudget(gcp?.complexity ?? DEFAULT_COMPLEXITY_TIER);
  const override = gcp?.node_budget_override?.l0_nodes;

  if (override == null) {
    return {
      trunkMax: Math.max(2, budget.l0_max - branchNodeCount),
      totalMax: budget.l0_max,
      trunkMin: budget.l0_min,
      fromOverride: false,
    };
  }
  return {
    trunkMax: override,
    totalMax: override + branchNodeCount,
    trunkMin: override,
    fromOverride: true,
  };
}

// ═══════════════════════════════════════════════════
// 1. 常量表
// ═══════════════════════════════════════════════════

/**
 * 「档位」在代码里有两种语义，必须分清，混用过一次就还会混：
 *   - **体量档位 complexity**：1-5 的整数枚举（极简 / 短篇 / 标准 / 丰富 / 史诗），
 *     UI 上叫「叙事体量」，本文件所有查表都以它为键；
 *   - **归一强度 0-1**：只有 temperature 缩放这类连续量需要，由 normalizedComplexity() 换算。
 *
 * 曾经两处直接写 `?? 0.5` 当档位缺省值，被 Math.round 压成 1（极简），
 * 于是没带体量的改编一律产出极简。给出具名常量与显式换算，就不会再靠字面量。
 */
export const DEFAULT_COMPLEXITY_TIER = 2;

/**
 * 体量档位本身（1-5 的整数），把缺省与越界一起收干净。
 *
 * 有这个函数是因为上面那条警告应验了一次：要档位的人顺手拿了 `normalizedComplexity`，
 * 拿到的是 0-1，查表全落到第 1 档（极简）——而它不报错。名字只差一个词的两个函数里
 * 只有一个有具名入口时，错拿的那个总是有具名的那个。
 */
export function complexityTier(complexity: number | undefined | null): number {
  return clamp(Math.round(complexity ?? DEFAULT_COMPLEXITY_TIER), 1, 5);
}

/** 体量档位 → 0-1 归一强度。喂给按 0-1 设计的参数（如 temperature 缩放）时必须经它。 */
export function normalizedComplexity(complexity: number | undefined | null): number {
  return (complexityTier(complexity) - 1) / 4;
}

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

/**
 * 目标分支率 = 体量查表 × 结构调制。
 *
 * 两个输入各管一件事，缺一不可：
 *   - **体量**（COMPLEXITY_PROFILES）决定「这个规模的故事该有多少分叉」；
 *   - **结构**（StructureTopology.branchDensity）决定「这种讲法该有多少分叉」。
 *
 * 从前只有前者，于是三轴综合出的结构对树的形状毫无影响 —— 投票出「线性」
 * 和投票出「网状」，同一体量下长出来的树一模一样。
 * topology 省略时取中性（系数 1），行为与接入结构参数之前完全一致。
 */
export function getTargetBranchRatio(
  complexity: number,
  layerEntropy: number,
  layer: number,
  topology: StructureTopology = NEUTRAL_TOPOLOGY,
): BranchTarget {
  const c = clamp(Math.round(complexity), 1, 5);
  const profile = COMPLEXITY_PROFILES[c]?.layers[layer];
  if (!profile) return { min: 0, target: 0, max: 0 };

  const range = profile.entropy_ceil - profile.entropy_floor;
  const t = range > 0 ? clamp((layerEntropy - profile.entropy_floor) / range, 0, 1) : 0.5;
  const grossTarget = lerp(profile.gross_min, profile.gross_max, t);

  const k = Math.max(0, topology.branchDensity);
  return {
    min: clamp(profile.gross_min * k, 0, 1),
    target: clamp(grossTarget * k, 0, 1),
    max: clamp(profile.gross_max * k, 0, 1),
  };
}

/** 聚合倾向 = 体量查表 × 结构的 mergeAffinity（>1 分了要收，<1 分了不回头）。 */
export function getMergeTendency(
  complexity: number,
  layer: number,
  topology: StructureTopology = NEUTRAL_TOPOLOGY,
): number {
  const c = clamp(Math.round(complexity), 1, 5);
  const base = COMPLEXITY_PROFILES[c]?.layers[layer]?.merge_tendency_base ?? 0;
  return clamp(base * Math.max(0, topology.mergeAffinity), 0, 1);
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
 *
 * 补分支时开几条路线由结构说 —— 多视角与网状天然宽于两条，
 * 一律补成 2 会把「视角轮替」压成「二选一」。
 */
export function enforceBranchInPlan(
  plans: StructurePlanItem[],
  grossTarget: BranchTarget,
  mergeTendency: number,
  _layer: number,
  topology: StructureTopology = NEUTRAL_TOPOLOGY,
): StructurePlanItem[] {
  if (plans.length === 0) return plans;
  const result = plans.map((p) => ({ ...p }));

  const totalChildren = result.reduce((s, p) => s + p.child_count, 0);
  if (totalChildren === 0) return result;

  const width = Math.max(2, Math.round(topology.branchWidth));
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
        p.branch_count = width;
        deficit -= width;
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

/** 分叉点该落在父节点序列的第几位。结构的 branchPlacement 决定 Y 型 / 中段 / 胖尾。 */
export function defaultBranchPosition(
  childCount: number,
  placement: StructureTopology["branchPlacement"],
): number {
  if (childCount <= 1) return 1;
  if (placement === "early") return 2;
  if (placement === "late") return Math.max(2, childCount - 1);
  return Math.max(2, Math.round(childCount / 2) + 1);
}

/**
 * 结构规则 prompt section（确定性参数，代码会校验）。
 *
 * 数值与结构画像必须同时出现且同向：数值是 enforce 的依据，画像是模型能理解的
 * "为什么是这个数"。只给数值时模型会照自己的审美规划，随后被 enforce 改掉；
 * 只给画像时数值校验又对不上。
 */
export function buildBranchPromptSection(
  layer: number,
  complexity: number,
  layerEntropy: number,
  topology: StructureTopology = NEUTRAL_TOPOLOGY,
): string {
  const target = getTargetBranchRatio(complexity, layerEntropy, layer, topology);
  const merge = getMergeTendency(complexity, layer, topology);

  const pctMin = Math.round(target.min * 100);
  const pctMax = Math.round(target.max * 100);
  const pctMerge = Math.round(merge * 100);
  const width = Math.max(2, Math.round(topology.branchWidth));

  const branchFloorHint = width > 2
    ? `本结构的分支点宜开 ${width} 条路线（并列视角/多路径是它的结构特征，不是复杂度堆砌）`
    : complexity >= 4
      ? "建议每个分支点 2~3 条路线（高体量鼓励多分支）"
      : "每个分支点至少 2 条路线";

  const placementHint = {
    early: "分叉宜早（在父节点序列的前段就分开，让各线有足够篇幅展开）",
    middle: "分叉宜落在中段（先把处境立稳，再让选择产生分歧）",
    late: "分叉宜晚（主线走到接近结局处才分开，形成胖尾形态）",
  }[topology.branchPlacement];

  const endingsHint = {
    single: "结局收敛到一个",
    few: "结局 2~3 个",
    many: "结局多个，各分支尽量落到不同结局",
  }[topology.endings];

  const mergeGuidance =
    layer === 0
      ? "L0 分支代表不可逆的命运分歧，极少合并。"
      : layer === 1
        ? `约 ${pctMerge}% 的 L1 分支应合并，需要自然的叙事收束点。`
        : `约 ${pctMerge}% 的 L2 分支应合并回主线，仅保留最有意义的变化。`;

  const lines: string[] = [`## 结构控制规则（必须遵守，代码会校验）`, ``];

  if (topology.shape) {
    lines.push(
      `### 本作的叙事结构`,
      `- 形态: ${topology.shape}`,
      `- 主干: ${{ single: "单主干", parallel: "多线并行", cyclic: "回环", scattered: "无固定主干" }[topology.spine]}`,
      `- ${placementHint}`,
      `- ${endingsHint}`,
      ``,
    );
  }

  lines.push(
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
  );

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

/**
 * 情节层的调控 prompt section（纯内容层：这个节点的正文怎么写）。
 *
 * 与 `buildDeviationPrompt` 同源不同向：那个讲"分支之间的内容差异该有多大"，是造树时的
 * 指导；情节席不造树，树已经由上游两席定好，它只为某一个已知节点写正文。同一个 deviation
 * 在这里问的是另一件事 —— 这段正文按常规写还是往反套路写。
 *
 * 存在的理由是情节席从前拿到的是 `JSON.stringify(global_control_params)` 一行原始对象，
 * 里头带着两个 `@deprecated` 字段。`deviation_direction` 与 `deviation` 并存尤其糟：模型
 * 同时看到"positive"和一个数，两套说法讲同一件事，而废弃的那套没人再维护。
 */
export function buildPlotControlPrompt(gcp?: GlobalControlParams): string {
  if (!gcp) return "（未指定，按中等体量与经典叙事写）";

  const deviation = deviationFromLegacy(gcp);
  const label =
    deviation > 0.3 ? "创新突破" : deviation < -0.3 ? "解构颠覆" : "经典叙事";
  const guidance =
    deviation > 0.3
      ? "正文可以给出意料之外的处理——角色的非常规反应、不按预期发展的场面"
      : deviation < -0.3
        ? "正文可以颠覆读者的预期——把通常该赢的写输、该救的写弃"
        : "正文按经典写法处理，不刻意求新";

  return [
    `- 叙事体量：${gcp.complexity}/5（体量已在结构层决定了树的大小，这里只影响单个节点写多厚）`,
    `- 反套路程度：${deviation.toFixed(2)}（${label}）——${guidance}`,
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
