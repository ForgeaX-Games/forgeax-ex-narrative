/**
 * Node-level dependency tracing for partial re-generation.
 *
 * 给定一个被修改的节点（例如 RPG L0 的 node "5"，或者 VN branch_tree 的 node "A1-3"），
 * 静态推导其在下游各 step 中的"波及子树"，用于 fork 时只重生成受影响的节点。
 *
 * 当前覆盖一条节点级链路（RPG / 标准叙事链）：
 *      story_framework  → outline_batch (L1.parent_id = L0.node_id)
 *                       → detailed_outline (L2.parent_id = L1.node_id)
 *                       → plot_generation (L3.node_id = L2.node_id, 1:1)
 *                       → script_generation (L4.plot_node_id = L3.node_id)
 *                       → quest_generation (L5.story_node_id = L3.node_id)
 *                       → scene_plan (Scene._phase2_per_node[k] = L3.node_id)
 *
 * 依赖关系以 STEP_PARENT 显式声明（DAG），traceNodeSubtree 用 BFS 下溯。
 *
 * C2（2026-08）已封存：原 VN / 互动影游链（branch_tree 分叉到 dialogue_script /
 * cinematic_storyboard）随实现本体一并搬进 `_archive/vn-v1/`，此文件不再登记
 * 这三个 stepId 的依赖边与节点访问器。
 */
import type { NarrativeContext } from "../../types/index.js";
import { STEP_IDS } from "../routing/modes.js";

const S = STEP_IDS;

export interface NodeImpact {
  stepId: string;
  affectedNodeIds: string[];
  preservedNodeIds: string[];
}

/**
 * 步骤之间的父子依赖关系（DAG）：键为子步骤，值为其依赖的父步骤。
 * 修改某节点后，沿 children 链路 BFS 下溯，找出所有受波及的下游节点。
 */
const STEP_PARENT: Record<string, string> = {
  // RPG / 标准叙事链
  [S.OUTLINE_BATCH]:        S.STORY_FRAMEWORK,
  [S.DETAILED_OUTLINE]:     S.OUTLINE_BATCH,
  [S.PLOT_GENERATION]:      S.DETAILED_OUTLINE,
  [S.SCRIPT_GENERATION]:    S.PLOT_GENERATION,
  [S.QUEST_GENERATION]:     S.PLOT_GENERATION,
  [S.SCENE_PLAN]:     S.PLOT_GENERATION,
};

/** 反向 children 表（运行时一次性算）。 */
const STEP_CHILDREN: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [child, parent] of Object.entries(STEP_PARENT)) {
    if (!out[parent]) out[parent] = [];
    out[parent].push(child);
  }
  return out;
})();

/** 具有节点级数据的步骤集合（与下面 getAllNodeIds 的 case 一一对应）。 */
const NODE_LEVEL_STEPS: ReadonlySet<string> = new Set<string>([
  S.STORY_FRAMEWORK,
  S.OUTLINE_BATCH,
  S.DETAILED_OUTLINE,
  S.PLOT_GENERATION,
  S.SCRIPT_GENERATION,
  S.QUEST_GENERATION,
  S.SCENE_PLAN,
]);

/* ────────────────────────── 节点访问器 ────────────────────────── */

function getAllNodeIds(ctx: NarrativeContext, stepId: string): string[] {
  switch (stepId) {
    case S.STORY_FRAMEWORK:
      return (ctx.story_framework?.framework?.nodes ?? []).map(n => n.node_id);
    case S.OUTLINE_BATCH:
      return (ctx.outlines_generated?.outlines ?? []).map(n => n.node_id);
    case S.DETAILED_OUTLINE:
      return (ctx.detailed_outlines_generated?.detailed_outlines ?? []).map(n => n.node_id);
    case S.PLOT_GENERATION:
      return (ctx.plots_generated?.plots ?? []).map(n => n.node_id);
    case S.SCRIPT_GENERATION:
      return (ctx.jrpg_script?.chapters ?? []).map(c => c.plot_node_id ?? c.node_id);
    case S.QUEST_GENERATION:
      return (ctx.quest_graph?.quests ?? []).map(q => q.story_node_id);
    case S.SCENE_PLAN: {
      const sm = ctx.scene_map as Record<string, unknown> | undefined;
      const p2 = sm?._phase2_per_node as Record<string, unknown> | undefined;
      return p2 ? Object.keys(p2) : [];
    }
    default:
      return [];
  }
}

/**
 * 在子步骤中找出受 parentNodeIds 影响的节点 ID。
 * 根据各子步骤的引用字段定义：
 *   - L1/L2 用 parent_id 字段
 *   - L3 与 L2 是 1:1 (node_id 同名)
 *   - L4 用 plot_node_id 指 L3
 *   - L5 用 story_node_id 指 L3
 *   - Scene 用 _phase2_per_node 的键指 L3
 */
function findChildNodes(
  ctx: NarrativeContext,
  childStepId: string,
  parentNodeIds: ReadonlySet<string>,
): string[] {
  switch (childStepId) {
    case S.OUTLINE_BATCH:
      return (ctx.outlines_generated?.outlines ?? [])
        .filter(n => parentNodeIds.has(n.parent_id))
        .map(n => n.node_id);

    case S.DETAILED_OUTLINE:
      return (ctx.detailed_outlines_generated?.detailed_outlines ?? [])
        .filter(n => parentNodeIds.has(n.parent_id))
        .map(n => n.node_id);

    case S.PLOT_GENERATION:
      return (ctx.plots_generated?.plots ?? [])
        .filter(n => parentNodeIds.has(n.node_id))
        .map(n => n.node_id);

    case S.SCRIPT_GENERATION:
      return (ctx.jrpg_script?.chapters ?? [])
        .filter(c => parentNodeIds.has(c.plot_node_id ?? c.node_id))
        .map(c => c.plot_node_id ?? c.node_id);

    case S.QUEST_GENERATION:
      return (ctx.quest_graph?.quests ?? [])
        .filter(q => parentNodeIds.has(q.story_node_id))
        .map(q => q.story_node_id);

    case S.SCENE_PLAN: {
      const sm = ctx.scene_map as Record<string, unknown> | undefined;
      const p2 = sm?._phase2_per_node as Record<string, unknown> | undefined;
      if (!p2) return [];
      return Object.keys(p2).filter(k => parentNodeIds.has(k));
    }

    default:
      return [];
  }
}

/* ────────────────────────── Public API ────────────────────────── */

/**
 * 沿 STEP_CHILDREN DAG 做 BFS，返回每个受影响步骤的节点级 impact。
 * 对应"修改 X step 的 N 个节点 → 下游 step 的 M 个节点会失效"。
 *
 * 不含原始步骤（修改本身）的下游若没有节点级数据，跳过；不会影响整步重跑兜底。
 */
export function traceNodeSubtree(
  modifiedStepId: string,
  modifiedNodeIds: string[],
  ctx: NarrativeContext,
): NodeImpact[] {
  if (!NODE_LEVEL_STEPS.has(modifiedStepId) || modifiedNodeIds.length === 0) return [];

  const impacts: NodeImpact[] = [];

  // 修改步骤自身：affected = modifiedNodeIds, preserved = 其它
  const allInModified = getAllNodeIds(ctx, modifiedStepId);
  const modSet = new Set(modifiedNodeIds);
  impacts.push({
    stepId: modifiedStepId,
    affectedNodeIds: modifiedNodeIds,
    preservedNodeIds: allInModified.filter(id => !modSet.has(id)),
  });

  // BFS 下溯：使用 visited(stepId) 防止 DAG 重复处理（当前依赖图无环，仍加保险）
  const visited = new Set<string>([modifiedStepId]);
  const queue: Array<{ stepId: string; nodeIds: Set<string> }> = [
    { stepId: modifiedStepId, nodeIds: new Set(modifiedNodeIds) },
  ];

  while (queue.length > 0) {
    const { stepId, nodeIds } = queue.shift()!;
    const children = STEP_CHILDREN[stepId];
    if (!children) continue;
    for (const childStep of children) {
      if (visited.has(childStep)) continue;
      visited.add(childStep);

      const allChildren = getAllNodeIds(ctx, childStep);
      if (allChildren.length === 0) continue;

      const affected = findChildNodes(ctx, childStep, nodeIds);
      if (affected.length === 0) continue;

      const affectedSet = new Set(affected);
      impacts.push({
        stepId: childStep,
        affectedNodeIds: affected,
        preservedNodeIds: allChildren.filter(id => !affectedSet.has(id)),
      });

      queue.push({ stepId: childStep, nodeIds: affectedSet });
    }
  }

  return impacts;
}

/** 该步骤是否带节点级数据（决定 partialClear / mergeBack 是否生效）。 */
export function isNodeLevelStep(stepId: string): boolean {
  return NODE_LEVEL_STEPS.has(stepId);
}

/** 把 NodeImpact[] 折叠成 RerunOptions.nodeFilter（{ stepId: nodeIds }）。 */
export function buildNodeFilter(
  impacts: NodeImpact[],
): Record<string, string[]> {
  const filter: Record<string, string[]> = {};
  for (const impact of impacts) {
    if (impact.affectedNodeIds.length > 0) {
      filter[impact.stepId] = impact.affectedNodeIds;
    }
  }
  return filter;
}
