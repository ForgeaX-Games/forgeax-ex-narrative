/**
 * run-manifest.ts — Phase-1 M2 SSOT
 *
 * RunManifest = 前后端唯一边界契约（动态配置表）：
 *   - 前端 I：写 config + compositionGraph
 *   - 后端算法：Planner 解析出有序 agents，Runner 更新 lifecycle + 产出
 *   - 前端 O：读 agents[].lifecycle + 各环节产出渲染
 *
 * 多管线条目：一个 EntryRecord = 一组 RunManifest（每条独立开始节点一份）。
 */
import type { ModeId, TierId, ContentLocale } from "./index.js";
import type {
  AgentLifecycle,
  AgentLifecycleRecord,
  AgentPrototype,
} from "../pipeline/core/agent-contract.js";

// ════════════════════════════════════════════════════════
// 管线代号 / 提示词库版本
// ════════════════════════════════════════════════════════

/**
 * 管线模板代号。
 * - 新架构朴素代号：tpl-jrpg / tpl-vn / …
 * - 归档精调：tpl-jrpg-v2 / tpl-vn-v2
 * - 过渡期仍接受历史 id（tpl-rpg 等），由 planner 归一。
 */
export type PipelineTemplateCode = string;

// ════════════════════════════════════════════════════════
// 画布拓扑（前端 I → 后端）
// ════════════════════════════════════════════════════════

export interface CompositionNode {
  id: string;
  /** catalog / agent id（如 engineer.worldview / expert.genre.rpg-jrpg） */
  catalogId: string;
  category: "input" | "routing" | "expert" | "assistant" | "engineer";
  /** 绑定的执行 agent id（工程师节点 = step id；专家 = nested 预设） */
  agentId?: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface CompositionEdge {
  id: string;
  source: string;
  target: string;
}

export interface CompositionGraph {
  nodes: CompositionNode[];
  edges: CompositionEdge[];
  /** 本管线锚定的开始节点 id（input 类）；判定「一条管线」的唯一标志。 */
  startNodeId: string;
}

// ════════════════════════════════════════════════════════
// Manifest 内每个 agent 的运行态切片
// ════════════════════════════════════════════════════════

export interface ManifestAgentSlot {
  agentId: string;
  name: string;
  prototype: AgentPrototype;
  /** 在有序列表中的位置（0-based）。 */
  index: number;
  lifecycle: AgentLifecycleRecord;
  /** 写入 ctx 的主产出字段名。 */
  outputField?: string;
  /** 产出摘要键（供 O 侧文本视图绑定）；完整数据在 ctx / 落盘文件。 */
  outputRef?: string;
}

// ════════════════════════════════════════════════════════
// RunManifest（一条管线一份）
// ════════════════════════════════════════════════════════

export interface RunManifestConfig {
  /**
   * 叙事层级。三期起**不再是用户输入**：给了 genreCode 就由品类查表派生，
   * 只作只读展示与模板/needs 兜底（PRD v1.4 §3.2.2）。
   */
  tier?: TierId | null;
  mode?: ModeId | null;
  genreCode?: string | null;
  /** 叙事类型轴 code（剧情/喜剧/…），见 knowledge/narrative-axes/story-types.ts */
  storyType?: string | null;
  /** 叙事题材轴 code（职场/校园/…），见 knowledge/narrative-axes/story-themes.ts */
  storyTheme?: string | null;
  /**
   * 标签选择。类型/题材两轴为空时由它兜底推导（deriveAxesFromTags），
   * 让标签输入路径也能参与结构投票。
   */
  tags?: { selections?: Record<string, string>; customTexts?: Record<string, string> };
  /** 叙事结构：由三轴综合推导写回，或用户显式指定 */
  narrativeStructure?: string | null;
  /** 结构结论的来源，供 UI 标注是自动推导还是用户指定 */
  structureSource?: "explicit" | "vote" | "none";
  /**
   * 结构推导的全过程，落盘供 UI 回答「为什么是这个结构」。
   *
   * 投票器一直在返回这两样（resolve-structure.ts 的注释写明「用于 UI 展示为什么是它」），
   * 但从前只有结论进 manifest，过程原地丢弃 —— 于是产品要的「多方维度比较」
   * 在界面上完全看不见，用户只看到一个没有来由的结论。
   */
  structureRationale?: {
    /** 参与综合的全部候选，按得票降序。 */
    candidates?: string[];
    /** 各轴给出的倾向原样回传：品类 / 类型 / 题材。 */
    byAxis?: Record<string, string[]>;
    /** 类型/题材若由标签兜底而来，记下命中的标签维与原文。 */
    tagDerived?: Record<string, { dimension: string; value: string }>;
  };
  /** 叙事体量档位（1-5）。UI 上叫「叙事体量」，字段名沿用 complexity 不动。 */
  complexity?: number;
  routeGroup?: "planning" | "narrative";
  locale?: ContentLocale;
  autoDetect?: boolean;
  /** 管线代号；决定提示词库版本与预制步序。 */
  pipelineTemplate?: PipelineTemplateCode;
  /** 用户输入原文（或合成后的 tags 文本）。 */
  userInput?: string;
  /** IP DNA run 引用（文件上传路径）。 */
  ipRunKey?: string;
}

export type PipelineRunStatus =
  | "draft"
  | "planned"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * 一条管线的动态配置表。
 * - draft：仅有 config/composition，尚未 /plan
 * - planned：agents 已由 Planner 填好，lifecycle 多为 pending
 * - running…：Runner 更新 lifecycle
 */
export interface RunManifest {
  /** 管线级唯一 id（同一条目下多管线互不冲突）。 */
  pipelineId: string;
  /** 所属项目条目 key。 */
  entryKey: string;
  status: PipelineRunStatus;
  config: RunManifestConfig;
  /** 画布自由编排拓扑；缺省表示走预设/左栏路径。 */
  compositionGraph?: CompositionGraph;
  /**
   * agents[] 这个步序是谁定的。
   *
   * `composition` = 用户在画布上编排的链，`preset` = 按 (mode, 品类, 层级) 路由的预设管线。
   * 前端靠它决定要不要把 agents[] 原样回传给 `/entry/start`：自由编排必须回传，
   * 否则后端重新路由到预设管线，用户就会看着自己的编排、跑着别人的步序。
   */
  stepSource?: "preset" | "composition";
  /**
   * Planner 解析后的有序 agents（含 lifecycle）。
   * 未运行预览与运行态均读此字段 —— 前端不重算。
   */
  agents: ManifestAgentSlot[];
  /** 并行组：agents 下标数组。 */
  parallelGroups?: number[][];
  /**
   * 提示词库版本——已退役字段（A3，2026-08）。原 `promptLibraryForTemplate` 从
   * 未被任何生产逻辑读取分支，三个 RPG 模板也从没有过真正对应的第二套提示词，
   * 详见 `pipeline/_archive/jrpg/README.md` 第四节。字段本身保留只为兼容读取
   * 历史 manifest（可能落有 `"v2"`）；新建 manifest 一律固定写 `"v1"`。
   */
  promptLibrary: "v1" | "v2";
  /** 是否完整（有开始节点且下游可达至少一执行节点）；不完整仍可预览，不可 /start。 */
  complete: boolean;
  incompletenessReason?: string;
  createdAt: string;
  updatedAt: string;
  /** 关联的后端 run id（SSE / checkpoint）。 */
  runId?: string;
}

// ════════════════════════════════════════════════════════
// 项目条目（多管线容器）
// ════════════════════════════════════════════════════════

export interface EntryRecord {
  key: string;
  title?: string;
  /** 一条目 = 一组 manifest；按独立开始节点切分。 */
  pipelines: RunManifest[];
  /** UI：条目是否展开显示多管线列表。 */
  expanded?: boolean;
  /** 当前聚焦的管线 id（状态栏/文本视图默认展示）。 */
  activePipelineId?: string;
  createdAt: string;
  updatedAt: string;
}

/** 从画布图按「独立开始节点」切分出多条 CompositionGraph。 */
export function splitCompositionByStartNodes(
  nodes: CompositionNode[],
  edges: CompositionEdge[],
): CompositionGraph[] {
  const startNodes = nodes.filter((n) => n.category === "input");
  if (startNodes.length === 0) return [];

  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }

  return startNodes.map((start) => {
    const reachable = new Set<string>();
    const queue = [start.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const next of outgoing.get(cur) ?? []) {
        if (!reachable.has(next)) queue.push(next);
      }
    }
    const subNodes = nodes.filter((n) => reachable.has(n.id));
    const subEdges = edges.filter(
      (e) => reachable.has(e.source) && reachable.has(e.target),
    );
    return {
      nodes: subNodes,
      edges: subEdges,
      startNodeId: start.id,
    };
  });
}

/** 判断子图是否「完整」到可执行（有 input + 至少一条到 routing/expert/engineer 的边）。 */
export function isCompositionComplete(graph: CompositionGraph): {
  complete: boolean;
  reason?: string;
} {
  const start = graph.nodes.find((n) => n.id === graph.startNodeId);
  if (!start || start.category !== "input") {
    return { complete: false, reason: "missing_start_input" };
  }
  const hasExec = graph.nodes.some(
    (n) =>
      n.id !== start.id &&
      (n.category === "expert" ||
        n.category === "engineer" ||
        n.category === "assistant" ||
        n.category === "routing"),
  );
  if (!hasExec) {
    return { complete: false, reason: "no_downstream_executable" };
  }
  const hasEdgeFromStart = graph.edges.some((e) => e.source === start.id);
  if (!hasEdgeFromStart) {
    return { complete: false, reason: "start_isolated" };
  }
  return { complete: true };
}

/** 由 completedSteps[] 旧格式桥接 lifecycle map。 */
export function lifecycleFromCompletedSteps(
  orderedAgentIds: string[],
  completedSteps: string[],
  lastCompletedStep?: string,
): Record<string, AgentLifecycle> {
  const done = new Set(completedSteps);
  const out: Record<string, AgentLifecycle> = {};
  let pastLast = !lastCompletedStep;
  for (const id of orderedAgentIds) {
    if (done.has(id)) {
      out[id] = "completed";
      if (id === lastCompletedStep) pastLast = true;
    } else if (!pastLast) {
      // resume 跳过区间内未记录的 → skipped
      out[id] = "skipped";
    } else {
      out[id] = "pending";
    }
  }
  return out;
}

export function emptyLifecycle(status: AgentLifecycle = "pending"): AgentLifecycleRecord {
  return { status, updatedAt: new Date().toISOString() };
}
