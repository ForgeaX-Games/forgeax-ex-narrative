/**
 * 跨步节点联动 — 找出"哪些 step 包含给定 nodeId"。
 *
 * 设计原点：互动影游的剧情树（branch_tree）节点 ID 在多个步骤里被复用 —
 *   - branch_tree.nodes[].id              (主干 + 分支节点)
 *   - branch_tree.endings[].id            (结局节点)
 *   - dialogue_script.scripts[].node_id   (每节点对应一份对话)
 *   - cinematic_storyboard.storyboards[].node_id  (每节点对应一份分镜)
 *   - story_framework.framework.nodes[].node_id   (RPG 故事框架)
 *   - outline_batch.outlines[].node_id            (RPG 大纲)
 *   - detailed_outline.detailed_outlines[].node_id (RPG 细纲)
 *   - plot_generation.plots[].node_id              (RPG 剧情)
 *
 * 这样设计的契约就是：剧情树是骨干，其他步骤的产出"挂"在同名节点下。
 * 这一函数把这些规则集中在一处，避免分散到各 panel 里硬编码字段路径。
 *
 * 返回：含该 nodeId 的 stepId 数组（按 PIPELINE_STEPS 中出现的顺序）。
 */
import type { NarrativeContext } from "../types";

type NodeContainer = {
  stepId: string;
  /** 取出该 step 在 ctx 上的"节点列表" */
  extract: (ctx: Record<string, unknown>) => Array<{ id?: string; node_id?: string }>;
};

const NODE_CONTAINERS: NodeContainer[] = [
  // 互动影游 / VN 三件套
  {
    stepId: "branch_tree",
    extract: (ctx) => {
      const bt = ctx.branch_tree as { nodes?: unknown[]; endings?: unknown[] } | undefined;
      const nodes = (Array.isArray(bt?.nodes) ? bt!.nodes : []) as Array<{ id?: string }>;
      const endings = (Array.isArray(bt?.endings) ? bt!.endings : []) as Array<{ id?: string }>;
      return [...nodes, ...endings];
    },
  },
  {
    stepId: "dialogue_script",
    extract: (ctx) => {
      const ds = ctx.dialogue_script as { scripts?: unknown[] } | undefined;
      return (Array.isArray(ds?.scripts) ? ds!.scripts : []) as Array<{ node_id?: string }>;
    },
  },
  {
    stepId: "cinematic_storyboard",
    extract: (ctx) => {
      const cs = ctx.cinematic_storyboard as { storyboards?: unknown[] } | undefined;
      return (Array.isArray(cs?.storyboards) ? cs!.storyboards : []) as Array<{ node_id?: string }>;
    },
  },
  // RPG 五件套
  {
    stepId: "story_framework",
    extract: (ctx) => {
      const sf = ctx.story_framework as { framework?: { nodes?: unknown[] } } | undefined;
      return (Array.isArray(sf?.framework?.nodes) ? sf!.framework!.nodes : []) as Array<{ node_id?: string }>;
    },
  },
  {
    stepId: "outline_batch",
    extract: (ctx) => {
      const og = ctx.outlines_generated as { outlines?: unknown[] } | undefined;
      return (Array.isArray(og?.outlines) ? og!.outlines : []) as Array<{ node_id?: string }>;
    },
  },
  {
    stepId: "detailed_outline",
    extract: (ctx) => {
      const dg = ctx.detailed_outlines_generated as { detailed_outlines?: unknown[] } | undefined;
      return (Array.isArray(dg?.detailed_outlines) ? dg!.detailed_outlines : []) as Array<{ node_id?: string }>;
    },
  },
  {
    stepId: "plot_generation",
    extract: (ctx) => {
      const pg = ctx.plots_generated as { plots?: unknown[] } | undefined;
      return (Array.isArray(pg?.plots) ? pg!.plots : []) as Array<{ node_id?: string }>;
    },
  },
];

/**
 * 找出"也包含给定 nodeId 的其他 step"。
 *
 * @param result   activeResult（NarrativeContext）
 * @param nodeId   待联动的剧情节点 ID（如 "N_05_DREAM_AWAKEN" / "A1_N03"）
 * @param excludeStepId  排除当前已聚焦的 step（默认排除自身，让 chip 条只列"其他可跳"项）
 * @returns 含该 nodeId 的 stepId 列表（保留 NODE_CONTAINERS 顺序）
 */
export function findStepsContainingNodeId(
  result: NarrativeContext | null,
  nodeId: string,
  excludeStepId?: string | null,
): string[] {
  if (!result || !nodeId) return [];
  const ctx = result as Record<string, unknown>;
  const out: string[] = [];
  for (const container of NODE_CONTAINERS) {
    if (excludeStepId && container.stepId === excludeStepId) continue;
    const items = container.extract(ctx);
    if (items.some((it) => (it.id ?? it.node_id) === nodeId)) {
      out.push(container.stepId);
    }
  }
  return out;
}

/**
 * 给定 stepId 取出其"节点列表"中该 nodeId 的具体内容。
 * 方便 UI 在 chip hover 时给个简短预览（例如 dialogue 的 title / scene）。
 */
export function getNodeContentInStep(
  result: NarrativeContext | null,
  stepId: string,
  nodeId: string,
): unknown | null {
  if (!result || !nodeId) return null;
  const container = NODE_CONTAINERS.find((c) => c.stepId === stepId);
  if (!container) return null;
  const items = container.extract(result as Record<string, unknown>);
  return items.find((it) => (it.id ?? it.node_id) === nodeId) ?? null;
}
