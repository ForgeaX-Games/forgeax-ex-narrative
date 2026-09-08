/**
 * 剧情树增删的客户端。
 *
 * 后端 `POST /api/narrative/tree-node` 负责维持连接不变式（双向名单、无孤儿、无悬空边），
 * 前端这一层只做两件事：说清要在哪儿插/删哪个，以及把后端给的 warning 带回来。
 *
 * warning 不是错误：比如"删掉的是入口节点，某某成为新入口"。它改变了故事的开头，
 * 用户该知道，但操作是成功的 —— 所以不能当异常抛掉。
 */
import { API_BASE } from "../hooks/useNarrativeStream";

/** 可增删的层级。任务图不在其中（它另有 prerequisites / 主线索引，见后端注释）。 */
export const TREE_STEPS = new Set([
  "story_framework",
  "outline_batch",
  "detailed_outline",
  "plot_generation",
]);

export interface TreeNodeResult {
  nodes: Array<Record<string, unknown>>;
  warnings: string[];
}

async function call(body: Record<string, unknown>): Promise<TreeNodeResult> {
  const res = await fetch(`${API_BASE}/api/narrative/tree-node`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; problems?: string[] };
    throw new Error([d.error, ...(d.problems ?? [])].filter(Boolean).join("；") || `tree-node failed: ${res.status}`);
  }
  const d = data as Partial<TreeNodeResult>;
  return { nodes: d.nodes ?? [], warnings: d.warnings ?? [] };
}

/**
 * 在 `afterNodeId` 之后插入一个新节点。
 *
 * 顺带把那个上游原来的下游接成新节点的下游 —— 这就是"串进去"：
 * A → C 变成 A → 新 → C，而不是 A 同时指向新和 C 那种并联旁路。
 */
export function addTreeNodeAfter(args: {
  sourceDir: string;
  stepId: string;
  afterNodeId: string;
  nextNodeIds: string[];
  nodeId: string;
  name: string;
}): Promise<TreeNodeResult> {
  return call({
    sourceDir: args.sourceDir,
    stepId: args.stepId,
    op: "add",
    node: {
      node_id: args.nodeId,
      name: args.name,
      // 内容留空：结构先立住，正文交给这个节点的单节点重 roll 去填。
      narrative_function: "",
      main_content: "",
    },
    prev: [args.afterNodeId],
    next: args.nextNodeIds,
  });
}

export function deleteTreeNode(args: {
  sourceDir: string;
  stepId: string;
  nodeId: string;
}): Promise<TreeNodeResult> {
  return call({ sourceDir: args.sourceDir, stepId: args.stepId, op: "delete", nodeId: args.nodeId });
}

/**
 * 给新节点起一个不撞车的 id。
 *
 * 沿用同层已有 id 的形状加后缀，而不是另起一套编号：这一层的 id 形态（`1` / `1_2` / `3a`）
 * 是各步骤自己解析的，凭空造个 `new-1` 出来，按 id 推断层级/序号的地方会认不出。
 */
export function nextNodeId(baseId: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let i = 1; i < 100; i++) {
    const candidate = `${baseId}x${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${baseId}x${Date.now()}`;
}
