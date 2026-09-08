/**
 * repair.ts — 按勾选的 finding 执行定点修复
 *
 * ─────────────────────────────────────────────────────────────────
 * 闭环缺的那一半
 * ─────────────────────────────────────────────────────────────────
 * 两个检查席一直是「只审不修」：报告出得很细，但作者看完还得自己回到对应席位
 * 重跑一遍，而重跑是整步重来——为了修一处断边把整层结构重新生成，代价与风险
 * 都不成比例。所以这里补的是「勾哪条修哪条」。
 *
 * 两条修法对应两种问题：
 * - `topology` 走连接修复。图上的事有确定答案，不需要模型，也不该让模型猜。
 * - `content` 走定点重写。只把命中的那个节点交给模型改，其余节点连提示词都不进——
 *   这既是省钱，也是防止"修一处、顺手动了十处"。
 *
 * 骨架不可变这条与打磨席同源：定点重写只接受新的正文，节点的连接关系一律以
 * 原件为准。
 */
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import {
  fullValidation,
  repairIntraGroupConnections,
  filterCrossBranchConnections,
  ensureBidirectionalConsistency,
  fixNvNRouting,
} from "../../utils/connection-repair.js";
import type { QaFinding } from "./findings.js";

/**
 * ctx 字段 → 产出它的那一步。
 *
 * 修完要按步重写产物文件与存版本快照，就得知道这个字段归谁。不从注册表反查是
 * 因为反查会撞上多义：打磨席原位写回之后，`plots_generated` 有四个 step 声称
 * 自己产出它，而"这份文件属于哪一步"只有一个答案。
 */
export const FIELD_OWNER_STEP: Readonly<Record<string, string>> = {
  outlines_generated: "outline_batch",
  detailed_outlines_generated: "detailed_outline",
  plots_generated: "plot_generation",
  vn_branched_beats: "vn_branched_beats",
};

/** 字段里装节点数组的键。 */
const FIELD_NODES_KEY: Readonly<Record<string, string>> = {
  outlines_generated: "outlines",
  detailed_outlines_generated: "detailed_outlines",
  plots_generated: "plots",
  vn_branched_beats: "beats",
};

export interface RepairOutcome {
  findingId: string;
  status: "applied" | "skipped" | "failed";
  /** 为什么是这个结果。跳过与失败必须说得出理由，否则用户只看到"没反应"。 */
  detail: string;
}

interface GraphNode {
  node_id: string;
  parent_id: string;
  prev_node: string[];
  next_node: string[];
  is_branch?: boolean;
  content?: string;
  [key: string]: unknown;
}

function fieldNodes(ctx: NarrativeContext, field: string): GraphNode[] | undefined {
  const base = (ctx as Record<string, unknown>)[field];
  if (typeof base !== "object" || base === null) return undefined;
  const nodes = (base as Record<string, unknown>)[FIELD_NODES_KEY[field] ?? ""];
  return Array.isArray(nodes) ? (nodes as GraphNode[]) : undefined;
}

function writeFieldNodes(ctx: NarrativeContext, field: string, nodes: GraphNode[]): void {
  const raw = ctx as Record<string, unknown>;
  const base = raw[field] as Record<string, unknown>;
  raw[field] = { ...base, [FIELD_NODES_KEY[field]]: nodes };
}

/**
 * 对一层结构跑一遍连接修复。
 *
 * 用的是 `structure_validation` 内联钩子那同一套算子——修法只该有一份实现，
 * 生成期自动跑的与作者事后手动点的必须给出同样的结果。少了
 * `inferCrossParentConnections` 与 `fixDanglingBranches`：那两个要父层节点表
 * 作参照，而事后修复未必拿得到对应的上一层。
 *
 * 返回修复前后各自的硬错误数。数字不降就是这条修不动，如实报给用户，
 * 不假装成功。
 */
export function repairFieldTopology(
  ctx: NarrativeContext,
  field: string,
): { before: number; after: number; changed: boolean } | undefined {
  const nodes = fieldNodes(ctx, field);
  if (!nodes) return undefined;

  const before = fullValidation(nodes).errors.length;
  const original = JSON.stringify(nodes);
  // 连接算子是原地改的（`prev_node.push(...)`），连数组一起深拷再交给它们——
  // 浅拷会让它们改到 ctx 里那份，于是"改了没有"永远比较不出差别。
  let repaired = nodes.map((n) => ({
    ...n,
    prev_node: [...n.prev_node],
    next_node: [...n.next_node],
  }));
  repaired = repairIntraGroupConnections(repaired);
  repaired = fixNvNRouting(repaired);
  repaired = filterCrossBranchConnections(repaired);
  repaired = ensureBidirectionalConsistency(repaired);
  const after = fullValidation(repaired).errors.length;

  const changed = JSON.stringify(repaired) !== original;
  if (changed) writeFieldNodes(ctx, field, repaired);
  return { before, after, changed };
}

const REWRITE_SYSTEM = `你在做定点修订：作者已经指出这个节点的具体问题，你只改这一处。

规则：
- 只输出修订后的正文，不解释、不总结；
- 节点的连接关系、父节点、节点 ID 一律不改——它们由结构层决定，本次修订无权改动；
- 已确立的人物姓名、地名、道具名不改；
- 只解决被指出的问题，不顺手重写其它部分。作者要能把新旧两版对读出差别在哪。

输出格式（严格 JSON）：
{ "content": "修订后的正文", "changes": ["改了什么，逐条说清"] }`;

/**
 * 定点重写一个节点：把该节点身上的全部待修问题一次交给模型。
 *
 * 一次一个节点而不是一次一条问题：同一节点上的几处问题往往互相牵连，分开改会
 * 后一次覆盖前一次。
 */
export async function rewriteNodeContent(
  llm: LLMClient,
  node: GraphNode,
  findings: readonly QaFinding[],
): Promise<{ content: string; changes: string[] }> {
  const issues = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.criterion}/${f.severity}] ${f.issue}\n   原文片段：${f.excerpt}\n   建议：${f.suggestion}`,
    )
    .join("\n");

  const user = `## 待修订节点（${node.node_id}）
${node.content ?? ""}

## 作者指出的问题
${issues}`;

  const raw = await llm.callWithRetry(REWRITE_SYSTEM, user, { responseFormat: "json", temperature: 0.4 }, (r) => {
    const parsed = extractJSON<Record<string, unknown>>(r);
    if (!parsed.content || !String(parsed.content).trim()) {
      throw new Error("修订后的 content 不能为空");
    }
  });

  const parsed = extractJSON<Record<string, unknown>>(raw);
  return {
    content: String(parsed.content),
    changes: Array.isArray(parsed.changes) ? parsed.changes.map(String) : [],
  };
}

/** 按 nodeId 归拢待修问题——同一节点的问题一次改完。 */
export function groupByNode(findings: readonly QaFinding[]): Map<string, QaFinding[]> {
  const byNode = new Map<string, QaFinding[]>();
  for (const f of findings) {
    byNode.set(f.nodeId, [...(byNode.get(f.nodeId) ?? []), f]);
  }
  return byNode;
}

/** 找到某个字段里的指定节点。 */
export function findNode(
  ctx: NarrativeContext,
  field: string,
  nodeId: string,
): GraphNode | undefined {
  return fieldNodes(ctx, field)?.find((n) => n.node_id === nodeId);
}

/** 把重写后的正文写回节点（骨架字段一概不动）。 */
export function applyRewrittenContent(
  ctx: NarrativeContext,
  field: string,
  nodeId: string,
  content: string,
  changes: readonly string[],
): boolean {
  const nodes = fieldNodes(ctx, field);
  if (!nodes) return false;
  const idx = nodes.findIndex((n) => n.node_id === nodeId);
  if (idx < 0) return false;
  const next = [...nodes];
  next[idx] = { ...nodes[idx], content, _repair_changes: [...changes] };
  writeFieldNodes(ctx, field, next);
  return true;
}
