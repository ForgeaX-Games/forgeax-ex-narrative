/**
 * Phase 2b · 改编三步确认（前置）—— 蓝图 §5.1 / §4.4 / §4.4b。
 *
 * 三步（确定性核心，可单测）：
 *   ① 嵌套裁剪 adaptation_scope —— 从层级树裁出要改编的连通子树（最小单元集合）；
 *   ② 游戏单元分配 game_unit_plan —— 默认 ≈25 最小单元/单元、末单元<25 并入前一单元、
 *      硬区间(部/卷/册)不可跨、软区间(章)优先切点；mode∈{single, series}；
 *   ③ 触发 scoped 提取（由 Phase2 消费本步产出的 directive）。
 *
 * 子仓库无平台对话功能时：默认全量（full scope）+ 默认 series 切分（见 buildDefaultDirective）。
 */

import type {
  NarrativeIpDna,
  HierarchyNode,
  AdaptationScope,
  AdaptationScopeSelection,
  GameUnit,
  GameUnitPlan,
  GameMode,
  AdaptationDirective,
  AdaptationDimensions,
} from "../types/narrative-ip-dna.js";

/** 默认每个游戏单元的最小叙事单元数（≈25 节点/25000字/20分钟，§4.4b）。 */
export const DEFAULT_UNITS_PER_GAME_UNIT = 25;

/** 硬区间层级（不可被游戏单元跨越）。 */
const HARD_LEVELS = new Set(["part"]);
/** 软区间层级（优先切点，可跨）。 */
const SOFT_LEVELS = new Set(["chapter"]);

// ─────────────────────────────────────────────────────────────────
// 最小单元展开 + scope 裁剪
// ─────────────────────────────────────────────────────────────────

/** 按层级树前序遍历，返回所有最小叙事单元（叶子 unit 节点）的有序列表。 */
export function flattenMinimalUnits(dna: NarrativeIpDna): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  const walk = (id: string): void => {
    const node = dna.nodes[id];
    if (!node) return;
    if (node.children.length === 0) {
      out.push(node);
      return;
    }
    // 子节点按 index 排序保证顺序稳定
    const sorted = [...node.children].sort((a, b) => dna.nodes[a].index - dna.nodes[b].index);
    for (const c of sorted) walk(c);
  };
  walk(dna.rootId);
  return out;
}

/** 取某叶子节点最近的指定层级祖先 id（无则返回 null）。 */
function nearestAncestorOfLevel(dna: NarrativeIpDna, leafId: string, levels: Set<string>): string | null {
  let cur = dna.nodes[leafId]?.parent ?? null;
  while (cur) {
    const node = dna.nodes[cur];
    if (levels.has(node.levelType)) return cur;
    cur = node.parent;
  }
  return null;
}

/**
 * 按嵌套 adaptation_scope 裁出选中的最小单元集合（保序）。
 * full=true 时返回全部最小单元。
 */
export function cropByScope(dna: NarrativeIpDna, scope: AdaptationScope): HierarchyNode[] {
  const all = flattenMinimalUnits(dna);
  if (scope.full || !scope.selections || scope.selections.length === 0) return all;

  const orderIndex = new Map<string, number>();
  all.forEach((u, i) => orderIndex.set(u.id, i));

  const selectedIds = new Set<string>();
  const collectFromSelection = (sel: AdaptationScopeSelection): void => {
    // 区间形态（每部=一个最小单元闭区间）：取文档序中 [start, end] 内全部叶子。
    if (sel.leafRange) {
      const lo = orderIndex.get(sel.leafRange.start);
      const hi = orderIndex.get(sel.leafRange.end);
      if (lo != null && hi != null) {
        const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
        for (let i = a; i <= b; i++) selectedIds.add(all[i].id);
      }
      if (sel.children) for (const child of sel.children) collectFromSelection(child);
      return;
    }
    if (!sel.nodeId) return;
    const node = dna.nodes[sel.nodeId];
    if (!node) return;
    // 该选择节点子树下的全部叶子
    const leaves = subtreeLeaves(dna, sel.nodeId);
    let chosen = leaves;
    // childRange 限定直接子层的序号区间
    if (sel.childRange) {
      const [lo, hi] = sel.childRange;
      const inRangeChildIds = node.children.filter((c) => {
        const idx = dna.nodes[c].index;
        return idx >= lo && idx <= hi;
      });
      const rangeLeafSet = new Set<string>();
      for (const c of inRangeChildIds) for (const lf of subtreeLeaves(dna, c)) rangeLeafSet.add(lf.id);
      chosen = leaves.filter((lf) => rangeLeafSet.has(lf.id));
    }
    for (const lf of chosen) selectedIds.add(lf.id);
    // 递归更深嵌套选择（覆盖式细化）
    if (sel.children) for (const child of sel.children) collectFromSelection(child);
  };
  for (const sel of scope.selections) collectFromSelection(sel);

  return all.filter((u) => selectedIds.has(u.id));
}

function subtreeLeaves(dna: NarrativeIpDna, rootId: string): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  const walk = (id: string): void => {
    const node = dna.nodes[id];
    if (!node) return;
    if (node.children.length === 0) { out.push(node); return; }
    const sorted = [...node.children].sort((a, b) => dna.nodes[a].index - dna.nodes[b].index);
    for (const c of sorted) walk(c);
  };
  walk(rootId);
  return out;
}

// ─────────────────────────────────────────────────────────────────
// 游戏单元分配（默认 25 / 末单元合并 / 硬软区间）
// ─────────────────────────────────────────────────────────────────

export interface PlanGameUnitsOptions {
  mode: GameMode;
  /** 每单元目标最小单元数（默认 25）。 */
  targetUnits?: number;
  /** 目标复杂度档（透传到 GameUnit）。 */
  targetComplexity?: number;
  userSpecified?: boolean;
}

/**
 * 把裁剪后的最小单元列表分配为游戏单元（确定性核心）。
 *
 * - single 模式：整段=一个游戏单元（一棵剧情树）。
 * - series 模式：按 targetUnits 切分；硬区间(part)变化强制断；软区间(chapter)变化是优先切点；
 *   末单元 < targetUnits 时并入前一单元。
 */
export function planGameUnits(
  dna: NarrativeIpDna,
  units: HierarchyNode[],
  opts: PlanGameUnitsOptions,
): GameUnitPlan {
  const target = opts.targetUnits ?? DEFAULT_UNITS_PER_GAME_UNIT;
  if (units.length === 0) {
    return { mode: opts.mode, units: [], userSpecified: !!opts.userSpecified };
  }

  if (opts.mode === "single") {
    return {
      mode: "single",
      units: [makeGameUnit(1, units, undefined, opts, target)],
      userSpecified: !!opts.userSpecified,
    };
  }

  // series：按硬/软区间 + 目标数切分
  const hardOf = (u: HierarchyNode) => nearestAncestorOfLevel(dna, u.id, HARD_LEVELS);
  const softOf = (u: HierarchyNode) => nearestAncestorOfLevel(dna, u.id, SOFT_LEVELS);

  const groups: HierarchyNode[][] = [];
  let current: HierarchyNode[] = [];
  let currentHard = hardOf(units[0]);

  const closeCurrent = (): void => {
    if (current.length > 0) groups.push(current);
    current = [];
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const hard = hardOf(u);
    // 硬区间变化 → 强制断（新部另起单元）
    if (current.length > 0 && hard !== currentHard) {
      closeCurrent();
      currentHard = hard;
    }
    current.push(u);

    if (current.length >= target) {
      // 达到目标：在软区间边界处优先切（下一个单元属于不同章 → 现在切）
      const next = units[i + 1];
      const atSoftBoundary = !next || softOf(next) !== softOf(u) || hardOf(next) !== hard;
      if (atSoftBoundary) closeCurrent();
    }
  }
  closeCurrent();

  // 末单元合并：< target 且存在前一组，且与前一组同属一个硬区间
  if (groups.length >= 2) {
    const last = groups[groups.length - 1];
    const prev = groups[groups.length - 2];
    const sameHard = hardOf(last[0]) === hardOf(prev[prev.length - 1]);
    if (last.length < target && sameHard) {
      prev.push(...last);
      groups.pop();
    }
  }

  const gameUnits: GameUnit[] = groups.map((g, i) => {
    const partId = hardOf(g[0]) ?? undefined;
    return makeGameUnit(i + 1, g, partId, opts, target);
  });

  return { mode: "series", units: gameUnits, userSpecified: !!opts.userSpecified };
}

function makeGameUnit(
  index: number,
  unitNodes: HierarchyNode[],
  partId: string | undefined,
  opts: PlanGameUnitsOptions,
  target: number,
): GameUnit {
  return {
    index,
    partId,
    unitRange: { start: unitNodes[0].id, end: unitNodes[unitNodes.length - 1].id },
    boundary: partId ? "hard" : "soft",
    targetComplexity: opts.targetComplexity,
    targetNodeCount: Math.max(target, DEFAULT_UNITS_PER_GAME_UNIT),
  };
}

// ─────────────────────────────────────────────────────────────────
// 改编指令组装
// ─────────────────────────────────────────────────────────────────

export interface BuildDirectiveOptions {
  scope?: AdaptationScope;
  mode?: GameMode;
  targetUnits?: number;
  targetComplexity?: number;
  dimensions?: Partial<AdaptationDimensions>;
  userSpecified?: boolean;
  /** 用户精确选填的游戏单元规划（§4.4 第②步对话产物）；提供则直接采用，覆盖默认切分。 */
  gameUnitPlan?: GameUnitPlan;
  /** 作者自定义改编补充说明（§5.1 自由文本）；合并进 directive.adaptation_notes，空则忠实转化。 */
  adaptationNotes?: string;
}

/**
 * 组装改编指令（adaptation_scope + game_unit_plan + dimensions）。
 * 默认：全量 scope + 全维度模板 + 按体量定档的游戏单元切分。子仓库无对话功能时即走此默认（§5.1）。
 *
 * mode 默认策略（§4.4「按体量」）：未显式指定 mode 时按内容体量定档——
 *   - 默认 series 切分若得到多个游戏单元 → series（有"部"层，对齐系列游戏）；
 *   - 仅得到 1 个游戏单元（短单 IP）→ 视为 single（完整内容本身即游戏单元，无"部"层）。
 * 用户/对话显式指定 mode（或 gameUnitPlan.mode）时一律尊重，不做此降档。
 */
export function buildAdaptationDirective(
  dna: NarrativeIpDna,
  opts: BuildDirectiveOptions = {},
): AdaptationDirective {
  const scope: AdaptationScope = opts.scope ?? { full: true };
  const cropped = cropByScope(dna, scope);
  const explicitMode: GameMode | undefined = opts.mode ?? opts.gameUnitPlan?.mode;
  const mode: GameMode = explicitMode ?? "series";
  // 用户精确选填的 game_unit_plan 优先采用（§4.4 第②步对话产物），否则按默认规则切分。
  let plan = opts.gameUnitPlan ?? planGameUnits(dna, cropped, {
    mode,
    targetUnits: opts.targetUnits,
    targetComplexity: opts.targetComplexity,
    userSpecified: opts.userSpecified,
  });
  // 无对话默认按体量定档（§820/§4.4）：series 默认切分只得 1 个单元 → 降档为单品（去"部"层），
  // 与蓝图「单品游戏：完整内容本身即游戏单元，无部层」对齐；显式 series 则保持不变。
  if (!explicitMode && !opts.gameUnitPlan && plan.mode === "series" && plan.units.length <= 1) {
    plan = planGameUnits(dna, cropped, {
      mode: "single",
      targetUnits: opts.targetUnits,
      targetComplexity: opts.targetComplexity,
      userSpecified: opts.userSpecified,
    });
  }

  const dimensions: AdaptationDimensions = {
    levelNodeIds: opts.dimensions?.levelNodeIds ?? cropped.map((u) => u.id),
    templateFields: opts.dimensions?.templateFields ?? [
      "worldview",
      "characters",
      "story_structure",
      "core_elements",
    ],
    fieldTargets: opts.dimensions?.fieldTargets,
  };

  const adaptation_notes = opts.adaptationNotes?.trim() || undefined;

  return {
    story_id: dna.story_id,
    adaptation_scope: scope,
    game_unit_plan: plan,
    dimensions,
    ...(adaptation_notes ? { adaptation_notes } : {}),
  };
}
