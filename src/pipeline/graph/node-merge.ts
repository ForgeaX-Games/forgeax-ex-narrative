/**
 * Partial clear and merge-back utilities for node-level re-generation.
 *
 * 让 fork 重生成只动"受 nodeFilter 影响的节点"，而不是删整个 ctx 字段重跑全部：
 *   1. partialClearNodes(stepId, nodeIds)  ← 重跑前调用，按 ID 删
 *   2. snapshotStepNodes(stepId)            ← 重跑前快照所有节点
 *   3. step.fn(ctx, llm)                    ← step 内部读 _nodeFilter（若识别）
 *   4. mergeNodesBack(stepId, nodeIds, snap)← 重跑后合并：
 *        kept     = snap[!idSet]            （未受影响的节点，从快照取）
 *        affected = current[idSet]          （受影响的节点，从重跑结果取）
 *        ctx[X]   = [...kept, ...affected]
 *
 * 注：mergeNodesBack 用「按 idSet 切片」而非「kept + current 全集」。
 * 即便 step.fn 没识别 _nodeFilter（生成了全集而不是仅 affected），
 * 切片也保证最终结果不重复、未受影响节点 100% 保留。
 *
 * 当前覆盖：RPG 链 L0-L5 + Scene。
 *
 * C2（2026-08）已封存：原 VN/互动影游链（branch_tree / dialogue_script /
 * cinematic_storyboard，含派生字段 video_prompts 的节点级切片）随实现本体
 * 一并搬进 `_archive/vn-v1/`，本文件不再登记这三个 stepId 的 case 分支。
 */
import type {
  NarrativeContext,
  FrameworkNode,
  OutlineNode,
  DetailedOutlineNode,
  PlotNode,
  ScriptChapter,
  Quest,
} from "../../types/index.js";
import { STEP_IDS } from "../routing/modes.js";

const S = STEP_IDS;

/* ────────────── 通用 helpers ────────────── */

function getNodeIdFromChapter(ch: ScriptChapter): string {
  return ch.plot_node_id ?? ch.node_id;
}

function getNodeIdFromQuest(q: Quest): string {
  return q.story_node_id;
}

/** 把 (kept_from_snap, affected_from_current) 拼回去。 */
function spliceArrays<T>(
  prev: T[] | undefined,
  current: T[] | undefined,
  isAffected: (item: T) => boolean,
): T[] | undefined {
  if (!prev && !current) return undefined;
  const kept = (prev ?? []).filter(item => !isAffected(item));
  const affected = (current ?? []).filter(isAffected);
  return [...kept, ...affected];
}

/* ────────────────────────── partialClearNodes ────────────────────────── */

/**
 * Remove specific nodes from a step's ctx output, preserving the rest.
 * Call this BEFORE re-executing a step with a nodeFilter.
 */
export function partialClearNodes(
  ctx: NarrativeContext,
  stepId: string,
  nodeIds: string[],
): void {
  const idSet = new Set(nodeIds);

  switch (stepId) {
    case S.STORY_FRAMEWORK: {
      const fw = ctx.story_framework;
      if (!fw?.framework?.nodes) break;
      fw.framework.nodes = fw.framework.nodes.filter(n => !idSet.has(n.node_id));
      if (fw.dynamic_structure?.framework_nodes) {
        fw.dynamic_structure.framework_nodes = fw.dynamic_structure.framework_nodes.filter(
          n => !idSet.has(n.node_id),
        );
      }
      break;
    }

    case S.OUTLINE_BATCH: {
      const og = ctx.outlines_generated;
      if (!og?.outlines) break;
      og.outlines = og.outlines.filter(n => !idSet.has(n.node_id));
      break;
    }

    case S.DETAILED_OUTLINE: {
      const dg = ctx.detailed_outlines_generated;
      if (!dg?.detailed_outlines) break;
      dg.detailed_outlines = dg.detailed_outlines.filter(n => !idSet.has(n.node_id));
      break;
    }

    case S.PLOT_GENERATION: {
      const pg = ctx.plots_generated;
      if (!pg?.plots) break;
      pg.plots = pg.plots.filter(n => !idSet.has(n.node_id));
      if (pg.plot_id_map) {
        for (const nid of nodeIds) delete pg.plot_id_map[nid];
      }
      break;
    }

    case S.SCRIPT_GENERATION: {
      const sc = ctx.jrpg_script;
      if (!sc?.chapters) break;
      sc.chapters = sc.chapters.filter(ch => !idSet.has(getNodeIdFromChapter(ch)));
      break;
    }

    case S.QUEST_GENERATION: {
      const qg = ctx.quest_graph;
      if (!qg?.quests) break;
      qg.quests = qg.quests.filter(q => !idSet.has(getNodeIdFromQuest(q)));
      if (qg.main_quest_chain) {
        qg.main_quest_chain = qg.main_quest_chain.filter(id => {
          const quest = qg.quests.find(q => q.quest_id === id);
          return quest !== undefined;
        });
      }
      break;
    }

    case S.SCENE_PLAN: {
      const sm = ctx.scene_map as Record<string, unknown> | undefined;
      if (!sm) break;
      const p2 = sm._phase2_per_node as Record<string, unknown> | undefined;
      if (p2) {
        for (const nid of nodeIds) delete p2[nid];
      }
      break;
    }
  }
}

/* ────────────────────────── snapshotStepNodes ────────────────────────── */

/**
 * Snapshot a step's current node data for later merge-back.
 * Call BEFORE executing the step to capture what should be preserved.
 */
export function snapshotStepNodes(
  ctx: NarrativeContext,
  stepId: string,
): unknown {
  switch (stepId) {
    case S.STORY_FRAMEWORK:
      return ctx.story_framework?.framework?.nodes
        ? {
            nodes: [...ctx.story_framework.framework.nodes],
            dynNodes: ctx.story_framework.dynamic_structure?.framework_nodes
              ? [...ctx.story_framework.dynamic_structure.framework_nodes]
              : [],
          }
        : undefined;

    case S.OUTLINE_BATCH:
      return ctx.outlines_generated
        ? { outlines: [...ctx.outlines_generated.outlines] }
        : undefined;

    case S.DETAILED_OUTLINE:
      return ctx.detailed_outlines_generated
        ? { detailed_outlines: [...ctx.detailed_outlines_generated.detailed_outlines] }
        : undefined;

    case S.PLOT_GENERATION:
      return ctx.plots_generated
        ? { plots: [...ctx.plots_generated.plots], plot_id_map: { ...ctx.plots_generated.plot_id_map } }
        : undefined;

    case S.SCRIPT_GENERATION:
      return ctx.jrpg_script
        ? { title: ctx.jrpg_script.title, chapters: [...ctx.jrpg_script.chapters] }
        : undefined;

    case S.QUEST_GENERATION:
      return ctx.quest_graph
        ? { quests: [...ctx.quest_graph.quests], main_quest_chain: [...ctx.quest_graph.main_quest_chain], branch_quests: { ...ctx.quest_graph.branch_quests } }
        : undefined;

    case S.SCENE_PLAN: {
      const sm = ctx.scene_map as Record<string, unknown> | undefined;
      if (!sm) return undefined;
      const p2 = sm._phase2_per_node as Record<string, unknown> | undefined;
      return p2 ? { _phase2_per_node: { ...p2 } } : undefined;
    }

    default:
      return undefined;
  }
}

/* ────────────────────────── mergeNodesBack ────────────────────────── */

/**
 * Merge newly generated nodes back into a step's ctx output.
 * 切片合并：kept = snap[!idSet]，affected = current[idSet]，ctx[X] = kept + affected
 * 即便 step.fn 没识别 _nodeFilter（生成了全集），切片也保证未受影响节点 100% 保留。
 */
export function mergeNodesBack(
  ctx: NarrativeContext,
  stepId: string,
  nodeIds: string[],
  preserved: unknown,
): void {
  const idSet = new Set(nodeIds);

  switch (stepId) {
    case S.STORY_FRAMEWORK: {
      const current = ctx.story_framework;
      const prev = preserved as { nodes: FrameworkNode[]; dynNodes: FrameworkNode[] } | undefined;
      if (!current?.framework?.nodes || !prev) break;
      current.framework.nodes = spliceArrays(prev.nodes, current.framework.nodes,
        n => idSet.has(n.node_id)) ?? current.framework.nodes;
      if (current.dynamic_structure?.framework_nodes && prev.dynNodes) {
        current.dynamic_structure.framework_nodes = spliceArrays(prev.dynNodes, current.dynamic_structure.framework_nodes,
          n => idSet.has(n.node_id)) ?? current.dynamic_structure.framework_nodes;
      }
      break;
    }

    case S.OUTLINE_BATCH: {
      const current = ctx.outlines_generated;
      const prev = preserved as { outlines: OutlineNode[] } | undefined;
      if (!current || !prev?.outlines) break;
      current.outlines = spliceArrays(prev.outlines, current.outlines,
        n => idSet.has(n.node_id)) ?? current.outlines;
      break;
    }

    case S.DETAILED_OUTLINE: {
      const current = ctx.detailed_outlines_generated;
      const prev = preserved as { detailed_outlines: DetailedOutlineNode[] } | undefined;
      if (!current || !prev?.detailed_outlines) break;
      current.detailed_outlines = spliceArrays(prev.detailed_outlines, current.detailed_outlines,
        n => idSet.has(n.node_id)) ?? current.detailed_outlines;
      break;
    }

    case S.PLOT_GENERATION: {
      const current = ctx.plots_generated;
      const prev = preserved as { plots: PlotNode[]; plot_id_map: Record<string, string> } | undefined;
      if (!current || !prev?.plots) break;
      current.plots = spliceArrays(prev.plots, current.plots,
        n => idSet.has(n.node_id)) ?? current.plots;
      if (prev.plot_id_map && current.plot_id_map) {
        const merged = { ...prev.plot_id_map };
        for (const nid of nodeIds) {
          if (current.plot_id_map[nid]) merged[nid] = current.plot_id_map[nid];
        }
        current.plot_id_map = merged;
      }
      break;
    }

    case S.SCRIPT_GENERATION: {
      const current = ctx.jrpg_script;
      const prev = preserved as { title: string; chapters: ScriptChapter[] } | undefined;
      if (!current || !prev?.chapters) break;
      current.chapters = spliceArrays(prev.chapters, current.chapters,
        ch => idSet.has(getNodeIdFromChapter(ch))) ?? current.chapters;
      break;
    }

    case S.QUEST_GENERATION: {
      const current = ctx.quest_graph;
      const prev = preserved as { quests: Quest[]; main_quest_chain: string[]; branch_quests: Record<string, string[]> } | undefined;
      if (!current || !prev?.quests) break;
      current.quests = spliceArrays(prev.quests, current.quests,
        q => idSet.has(getNodeIdFromQuest(q))) ?? current.quests;
      break;
    }

    case S.SCENE_PLAN: {
      const current = ctx.scene_map as Record<string, unknown> | undefined;
      const prev = preserved as Record<string, unknown> | undefined;
      if (!current || !prev) break;
      const currP2 = current._phase2_per_node as Record<string, unknown> | undefined;
      const prevP2 = prev._phase2_per_node as Record<string, unknown> | undefined;
      if (currP2 && prevP2) {
        // 复用旧值覆盖未受影响的键，受影响键已在 currP2 中
        for (const [k, v] of Object.entries(prevP2)) {
          if (!idSet.has(k)) currP2[k] = v;
        }
      }
      break;
    }
  }
}

/**
 * Read the current _nodeFilter from ctx (injected by rerunFromStep).
 * Step functions call this to determine which nodes to process.
 * Returns null if no filter is active (process all nodes).
 */
export function getNodeFilter(ctx: NarrativeContext): Set<string> | null {
  const filter = (ctx as Record<string, unknown>)._nodeFilter as string[] | undefined;
  if (!filter || filter.length === 0) return null;
  return new Set(filter);
}
