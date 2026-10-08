/**
 * Phase 2c · 输出游戏化资产整理与管线适配 —— 蓝图 §3.1c / §4.6。
 *
 * 把游戏单元规划映射到现有生成管线（tpl-rpg / tpl-vn-v2），统一单品/系列两模式：
 *   - 单品 single：完整游戏叙事内容(游戏单元(剧情树)) - 游戏叙事节点(L2/P1)。整段=一次管线运行。
 *   - 系列 series：完整内容 - 部(游戏单元(剧情树)，对应 rpg L0框架节点 / vn P0幕节点) - 节点。
 *     每个"部"=一个游戏单元=一次管线运行。
 *
 * 恒等：游戏单元=一棵剧情树；游戏叙事节点=rpg L2 / vn P1；每单元剧情树 ≥ 25 节点。
 * VN 适配：开放幕数（不再固定三幕）+ 复杂度/节点数量控制（对齐 rpg）。
 */

import type { PipelineTemplateId } from "../pipeline/routing/templates.js";
import type { NodeBudgetOverride, VnUnitActMap, VnActUnitSeed } from "../types/index.js";
import type { GameUnit, GameUnitPlan, GameMode } from "../types/narrative-ip-dna.js";
import { DEFAULT_UNITS_PER_GAME_UNIT } from "./phase2b-adapt.js";

/** 每个游戏单元剧情树的最小节点数（恒等约束，§4.6）。 */
export const MIN_PLOT_TREE_NODES = 25;

/** VN 开放幕数上限（P1-1）：章→幕锚定时，源单元数超此上限则按序分桶到该上限个幕。 */
export const MAX_OPEN_ACTS = 12;

/** 系列游戏单元结局总数默认上限（§4.6b，蓝图建议 3-5，取上界防结局爆炸）。 */
export const DEFAULT_MAX_ENDINGS_PER_SERIES_UNIT = 5;

/**
 * 系列结局收束 + 跨部承接约束（§4.6b，精简版：以提示词约束注入下游，不新增落盘字段）。
 *
 * 覆盖底层管线「结局不设上限」对系列单元的问题——每部约束结局数量、区分承接/收束结局：
 *   - 非末部：恰好 1（最多 2）个「承接结局」通向下一部（留主角状态/世界变化/悬念钩子），其余就地收束；
 *   - 末部：全部就地收束，不再留钩子。
 * 跨部只经承接结局的收尾状态传递，禁止跨部节点直接连边（bounded coupling）。
 * 返回空串表示非系列/无需注入。
 */
export function buildSeriesEndingDirective(
  mode: GameMode,
  unitIndex: number,
  totalUnits: number,
  maxEndings: number = DEFAULT_MAX_ENDINGS_PER_SERIES_UNIT,
): string {
  if (mode !== "series" || totalUnits <= 1) return "";
  const isLast = unitIndex >= totalUnits;
  const head = `## 系列结局收束约束（本部为系列第 ${unitIndex}/共 ${totalUnits} 部）`;
  if (isLast) {
    return [
      head,
      `- 本部是系列最后一部：所有结局均为「就地收束」结局，不再为后续留承接钩子。`,
      `- 本部结局总数控制在 ${maxEndings} 个以内，避免结局无限膨胀。`,
    ].join("\n");
  }
  return [
    head,
    `- 恰好设置 1 个（最多 2 个）「承接结局」作为通向下一部的正典出口：该结局须为下一部留下延续钩子（主角状态、世界关键变化、未竟悬念）。`,
    `- 其余结局一律为「就地收束」结局，本部内闭合。`,
    `- 本部结局总数控制在 ${maxEndings} 个以内。`,
    `- 跨部只通过承接结局的收尾状态传递，禁止本部节点与其他部节点直接连边。`,
  ].join("\n");
}

/**
 * 游戏单元 → 生成期节点控制。
 *
 * 不分品类。这里曾按"管线家族"（rpg / vn）分成两套：RPG 给层级节点预算，VN 给开放幕数。
 * 但 C1（2026-08）之后不管 RPG 还是影游都不再有"幕"——大纲定叙事单元、结构展开为剧情树、
 * 情节填节点内容，三层职责对所有品类同构，形态差异由叙事结构轴的策略卡表达（见
 * narrative-pipelines.ts 的 pl-film-game）。幕数那一侧的读取者已随 tpl-vn-v2 一并封存进
 * `pipeline/_archive/vn-v2/`，此后只写不读。
 *
 * 同时去掉了 `pipelineTemplate` 与 `topLevelMapping`：两者都只被算出来放着，没有运行时
 * 读取者。模板由品类自己路由，不需要在这里再判一遍。
 */
export interface GameUnitPipelinePlan {
  /** 游戏单元序号。 */
  unitIndex: number;
  /** 复杂度档（喂节点预算）。 */
  complexity: number;
  /** 目标节点数（≥25）。 */
  targetNodeCount: number;
  /** 各层节点预算覆盖。 */
  nodeBudgetOverride?: NodeBudgetOverride;
}

/**
 * 由目标节点数派生各层节点预算（粗分配：L0 框架节点 × L1 × L2）。
 * 满足 l0*l1*l2 ≈ targetNodeCount 且 ≥25；优先保证 L2（=游戏叙事节点）密度。
 *
 * 只派生「每层开几个节点」。分叉密度、聚合倾向、结局数量属于叙事结构，
 * 由 `narrative_axes.structure` 的 topology 决定，不在这里旁路。
 */
export function deriveNodeBudgetOverride(targetNodeCount: number): NodeBudgetOverride {
  const n = Math.max(MIN_PLOT_TREE_NODES, targetNodeCount);
  // 经验分配：L0 = 3~5，L1 每父 2~3，L2 每父 2~3
  const l0 = Math.max(3, Math.min(6, Math.round(Math.cbrt(n))));
  const remaining = n / l0;
  const l1 = Math.max(2, Math.min(4, Math.round(Math.sqrt(remaining))));
  const l2 = Math.max(2, Math.ceil(remaining / l1));
  return { l0_nodes: l0, l1_per_parent: l1, l2_per_parent: l2 };
}

export interface MapToPipelineOptions {
  /** 缺省复杂度（单元未指定时）。 */
  defaultComplexity?: number;
}

/** 单个游戏单元 → 管线计划。 */
export function mapGameUnitToPipeline(
  unit: GameUnit,
  opts: MapToPipelineOptions = {},
): GameUnitPipelinePlan {
  const complexity = unit.targetComplexity ?? opts.defaultComplexity ?? 3;
  const targetNodeCount = Math.max(MIN_PLOT_TREE_NODES, unit.targetNodeCount ?? DEFAULT_UNITS_PER_GAME_UNIT);
  return {
    unitIndex: unit.index,
    complexity,
    targetNodeCount,
    nodeBudgetOverride: deriveNodeBudgetOverride(targetNodeCount),
  };
}

/** 整套游戏单元规划 → 一组管线计划（单品=1 个；系列=N 个）。 */
export function planPipelineRuns(
  plan: GameUnitPlan,
  opts: MapToPipelineOptions = {},
): GameUnitPipelinePlan[] {
  return plan.units.map((u) => mapGameUnitToPipeline(u, opts));
}
