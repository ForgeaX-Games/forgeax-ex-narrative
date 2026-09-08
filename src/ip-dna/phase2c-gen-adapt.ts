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
import type { TargetStructure, VnUnitActMap, VnActUnitSeed } from "../types/index.js";
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

/** 管线家族选择（rpg=层级树管线；vn=互动影游管线）。 */
export type PipelineFamily = "rpg" | "vn";

export interface GameUnitPipelinePlan {
  /** 游戏单元序号。 */
  unitIndex: number;
  /** 该单元对应的管线模板。 */
  pipelineTemplate: PipelineTemplateId;
  /** 复杂度档（喂节点预算）。 */
  complexity: number;
  /** 目标节点数（≥25）。 */
  targetNodeCount: number;
  /** RPG：层级目标结构。 */
  targetStructure?: TargetStructure;
  /** VN：开放幕数（不固定三幕）。 */
  vnActCount?: number;
  /** 系列模式下对应的顶层节点语义（rpg L0 框架节点 / vn P0 幕节点）。 */
  topLevelMapping?: "rpg-L0" | "vn-P0";
}

/**
 * VN 开放幕数解析（§4.6 关键适配）：
 *   - P1-1（章→幕锚定）：给定 unitCount（裁剪范围内源最小叙事单元数）时，**开放幕数 = 单元数**，
 *     clamp 到 [2, MAX_OPEN_ACTS]——每源单元锚定一幕（忠实章边界），修"幕数与章数无关"。
 *   - 回退（无 unitCount，如轻需求/普通 VN）：按目标节点数派生（每幕 ≈ 9 情节点），clamp [2, 6]。
 */
export function resolveVnActCount(targetNodeCount: number, unitCount?: number): number {
  if (unitCount && unitCount >= 1) return Math.max(2, Math.min(MAX_OPEN_ACTS, unitCount));
  const n = Math.max(MIN_PLOT_TREE_NODES, targetNodeCount);
  const acts = Math.round(n / 9);
  return Math.max(2, Math.min(6, acts));
}

/** 汉字幕号（1-based；超 10 直接用阿拉伯数字，仅作序号语义）。 */
const CN_ACT_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function actNumeral(n: number): string {
  return CN_ACT_NUMERALS[n - 1] ?? String(n);
}

/**
 * 构建"章→幕锚定映射"（P1-1，IP 改编专用）：把裁剪范围内的源最小叙事单元映射为 VN 幕。
 *   - 单元数 ≤ MAX_OPEN_ACTS：1 源单元 = 1 幕（忠实章边界）；
 *   - 单元数 > MAX_OPEN_ACTS：按序把相邻单元均分到 MAX_OPEN_ACTS 个幕（分桶合并）。
 * 每幕携带源单元的标题/事件脉络/角色/场景，供 vn-segment-confirm 按密度展开且不截断丢弃。
 */
export function buildUnitActMap(
  units: { id: string; title: string; summary: string; characters: string[]; scene: string }[],
  maxActs: number = MAX_OPEN_ACTS,
): VnUnitActMap {
  const n = units.length;
  if (n === 0) return { acts: [] };
  const actCount = Math.max(1, Math.min(maxActs, n));
  const acts: VnActUnitSeed[] = [];
  // 均匀分布到恰好 actCount 个桶（覆盖全部单元、不丢失）：n ≤ 上限时天然 1:1；超上限则相邻分桶。
  for (let k = 0; k < actCount; k++) {
    const start = Math.floor((k * n) / actCount);
    const end = Math.floor(((k + 1) * n) / actCount);
    const bucket = units.slice(start, end);
    if (bucket.length === 0) continue;
    const idx = acts.length + 1;
    acts.push({
      actIndex: idx,
      actId: actNumeral(idx),
      sourceUnitIds: bucket.map((u) => u.id),
      title: bucket.map((u) => u.title).filter(Boolean).join(" / "),
      summary: bucket.map((u) => u.summary).filter(Boolean).join("；"),
      characters: [...new Set(bucket.flatMap((u) => u.characters))],
      scene: bucket.map((u) => u.scene).filter(Boolean).join(" / "),
    });
  }
  return { acts };
}

/**
 * 由目标节点数派生 RPG 层级目标结构（粗分配：L0 框架节点 × L1 × L2）。
 * 满足 l0*l1*l2 ≈ targetNodeCount 且 ≥25；优先保证 L2（=游戏叙事节点）密度。
 */
export function deriveRpgTargetStructure(targetNodeCount: number, complexity: number): TargetStructure {
  const n = Math.max(MIN_PLOT_TREE_NODES, targetNodeCount);
  // 经验分配：L0 = 3~5，L1 每父 2~3，L2 每父 2~3
  const l0 = Math.max(3, Math.min(6, Math.round(Math.cbrt(n))));
  const remaining = n / l0;
  const l1 = Math.max(2, Math.min(4, Math.round(Math.sqrt(remaining))));
  const l2 = Math.max(2, Math.ceil(remaining / l1));
  return {
    l0_nodes: l0,
    l1_per_parent: l1,
    l2_per_parent: l2,
    enable_branch: complexity >= 3,
    plot_length: n,
  };
}

export interface MapToPipelineOptions {
  family: PipelineFamily;
  /** 缺省复杂度（单元未指定时）。 */
  defaultComplexity?: number;
  /** P1-1：本游戏单元内的源最小叙事单元数——VN 据此定"开放幕数=单元数"（章→幕锚定）。 */
  unitCount?: number;
}

/** 单个游戏单元 → 管线计划。 */
export function mapGameUnitToPipeline(
  unit: GameUnit,
  mode: GameMode,
  opts: MapToPipelineOptions,
): GameUnitPipelinePlan {
  const complexity = unit.targetComplexity ?? opts.defaultComplexity ?? 3;
  const targetNodeCount = Math.max(MIN_PLOT_TREE_NODES, unit.targetNodeCount ?? DEFAULT_UNITS_PER_GAME_UNIT);
  const topLevelMapping =
    mode === "series" ? (opts.family === "rpg" ? "rpg-L0" : "vn-P0") : undefined;

  if (opts.family === "vn") {
    return {
      unitIndex: unit.index,
      pipelineTemplate: "tpl-vn-v2",
      complexity,
      targetNodeCount,
      vnActCount: resolveVnActCount(targetNodeCount, opts.unitCount),
      topLevelMapping,
    };
  }
  return {
    unitIndex: unit.index,
    pipelineTemplate: "tpl-rpg",
    complexity,
    targetNodeCount,
    targetStructure: deriveRpgTargetStructure(targetNodeCount, complexity),
    topLevelMapping,
  };
}

/**
 * 管线家族 → 规范代表品类 code（§4.6 关键接缝）。
 *
 * 背景：编排器生成默认走 design_auto 模式，叙事步骤链的模板由
 * `demand_analysis.genre_code` 解析。编排器不向生成管线传 genre_code 时，
 * 管线会退化为后备品类 `rpg-jrpg`（→ tpl-rpg），导致改编选定 `pipeline_family: vn`
 * 的内容仍误跑 RPG 层级链。把家族映射回其规范代表品类，使模板解析锁定到对应链：
 *   - vn  → adv-interactive（GENRE_TEMPLATE_OVERRIDES 中映射到 tpl-vn-v2）
 *   - rpg → undefined（沿用既有 LLM 检测 / rpg-jrpg 默认，行为不变）
 *
 * 返回 undefined 表示「不强制品类」。调用方若已显式指定 genreCode 则不应覆盖。
 */
export function representativeGenreForFamily(family: PipelineFamily): string | undefined {
  return family === "vn" ? "adv-interactive" : undefined;
}

/**
 * 目标输出形态 → 管线家族（§4.4d，与 representativeGenreForFamily 互为逆向）。
 * 依 pipeline_template（含 "vn" → vn / "rpg" → rpg）优先，再看 genre_code 关键词兜底。
 * 无法判定返回 undefined（由调用方回退缺省——IP 改编缺省 = vn）。
 */
export function familyFromTargetOutput(
  target?: { genre_code?: string; pipeline_template?: string },
): PipelineFamily | undefined {
  if (!target) return undefined;
  const tpl = (target.pipeline_template ?? "").toLowerCase();
  if (tpl.includes("vn")) return "vn";
  if (tpl.includes("rpg")) return "rpg";
  const g = (target.genre_code ?? "").toLowerCase();
  if (!g) return undefined;
  if (/(vn|interactive|adv|avg|galgame|visual)/.test(g)) return "vn";
  if (/rpg/.test(g)) return "rpg";
  return undefined;
}

/** 整套游戏单元规划 → 一组管线计划（单品=1 个；系列=N 个）。 */
export function planPipelineRuns(
  plan: GameUnitPlan,
  opts: MapToPipelineOptions,
): GameUnitPipelinePlan[] {
  return plan.units.map((u) => mapGameUnitToPipeline(u, plan.mode, opts));
}
