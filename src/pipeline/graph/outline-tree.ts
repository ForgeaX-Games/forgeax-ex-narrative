/**
 * outline-tree.ts —— 剧情树字段的落盘归一化
 *
 * 结构席的产物要带满剧情树信息（node_function / edges / branch_type / ending /
 * on_optimal_path），但这几项的来源不同，混在一起写就会出现「让模型猜它猜不到的
 * 东西」或「代码编造它无从判断的语义」两类错误。所以在此分三档：
 *
 *   可推导  node_function、edges 的走向类型、branch_type 的代价档
 *           —— 骨架的拓扑是代码算出来的（见 outline-batch.buildSkeleton），
 *              入出度与汇点都是已知事实，问模型等于让它复述我们已经知道的东西。
 *   须语义  边的条件（凭什么走这条路）、代价、人设倾向、结局分档与达成条件
 *           —— 这些要读懂剧情才能给，只能由模型给。
 *   只报告  语义项缺失
 *           —— 见 node-function.checkNodeFunctions。代码不编造结局分档，
 *              宁可让结构检查报「结局未给达成条件」，也不要塞一个假的分档。
 *
 * 这样分工的直接好处：历史产物（没有任何树字段）跑一遍归一化就能补齐拓扑部分，
 * 语义部分缺什么由检查器逐条说清楚。
 */
import type {
  BranchType,
  EndingSpec,
  NodeCondition,
  NodeEdge,
  NodeFunction,
} from "../../types/index.js";
import { inferNodeFunction } from "./node-function.js";

/** 归一化只需要拓扑，不关心内容——因此接受任何带这三个字段的节点。 */
export interface TreeShapeNode {
  node_id: string;
  prev_node: string[];
  next_node: string[];
}

/** 模型为某个节点补的语义信息（分支条件 / 代价档 / 结局分档）。 */
export interface TreeSemantics {
  /** 按目标节点 id 给的边条件。 */
  edge_conditions?: Record<string, NodeCondition>;
  branch_type?: BranchType;
  ending?: EndingSpec;
}

export interface DerivedTreeFields {
  node_function: NodeFunction;
  edges: NodeEdge[];
  branch_type?: BranchType;
}

const CHOICE_LABELS = "ABCDEFGH";

/**
 * 一条边的走向类型。
 *
 * 不再有「结局边」这一档，所以也不再有次序两难：从前判定次序必须在「目标是结局」与
 * 「本节点在分叉」之间选一个优先，而两种次序各丢一半信息（见 `NodeEdge.kind`）。
 * 结局性由目标节点自己的出度表达，边只说走法。
 */
function edgeKind(
  node: TreeShapeNode,
  target: TreeShapeNode | undefined,
): NodeEdge["kind"] {
  if (!target) return "continue";
  if (target.prev_node.length > 1) return "merge";
  if (node.next_node.length > 1) return "choose";
  return "continue";
}

/**
 * 分岔的代价档。
 *
 *   converge 各分支下一步汇到同一个节点——路径不同、结果相同；
 *   terminal 有分支直接进结局——这一步选错就完；
 *   diverge  各分支各走各的，短期内不汇。
 *
 * 只看一步之内的汇合，是因为骨架的分支恰好是「分叉 → 各分支节点 → 合并点」这种
 * 一步汇合的形状（buildSkeleton 的 shouldMerge 分支）。看更远会把「各自走很久
 * 最终都到大结局」误判成 converge，而那正是 diverge 想表达的意思。
 */
function deriveBranchType(
  targets: Array<TreeShapeNode | undefined>,
): BranchType {
  if (targets.some((t) => t && t.next_node.length === 0)) return "terminal";

  const nextSets = targets.map((t) => new Set(t?.next_node ?? []));
  if (nextSets.length > 1) {
    const [first, ...rest] = nextSets;
    const shared = [...first!].filter((id) => rest.every((s) => s.has(id)));
    if (shared.length > 0) return "converge";
  }
  return "diverge";
}

/**
 * 从拓扑推出每个节点的功能位与出边。
 *
 * 不覆盖模型或上游已经显式声明的值——本函数只补空缺。
 */
export function deriveTreeFields(
  nodes: readonly TreeShapeNode[],
): Map<string, DerivedTreeFields> {
  const index = new Map(nodes.map((n) => [n.node_id, n]));
  const out = new Map<string, DerivedTreeFields>();

  for (const node of nodes) {
    const targets = node.next_node.map((id) => index.get(id));
    const isBranch = node.next_node.length > 1;

    const edges: NodeEdge[] = node.next_node.map((to, i) => {
      const kind = edgeKind(node, index.get(to));
      const edge: NodeEdge = { to, kind };
      if (kind === "choose") edge.label = CHOICE_LABELS[i] ?? String(i + 1);
      return edge;
    });

    out.set(node.node_id, {
      node_function: inferNodeFunction(node.prev_node, node.next_node),
      edges,
      branch_type: isBranch ? deriveBranchType(targets) : undefined,
    });
  }

  return out;
}

/**
 * 向模型索要语义项的提示词片段（只对需要它的节点追加）。
 *
 * 与 deriveTreeFields 是一体两面：那边推导拓扑，这边只问推导不出来的部分。
 * 放在这里而不是各层 step 里，是因为 L1 与 L2 问的是同一件事——分开写迟早
 * 变成两套口径，模型在两层给出不同形状的字段。
 */
export function treeSemanticsPromptSpec(nodes: readonly TreeShapeNode[]): string {
  const branchSources = nodes.filter((n) => n.next_node.length > 1);
  const endings = nodes.filter((n) => n.next_node.length === 0);
  if (branchSources.length === 0 && endings.length === 0) return "";

  const parts: string[] = ["## 剧情树语义（只对下列节点补充）"];

  if (branchSources.length > 0) {
    parts.push(`### 分岔节点：${branchSources.map((n) => n.node_id).join("、")}
每个分岔节点追加两个字段：
- edge_conditions: 以目标 node_id 为键，说明玩家凭什么走向那一支
  { "<目标node_id>": { "type": "choice|state|item|visited", "description": "条件描述",
    "cost": "走这条路要付的代价", "persona_alignment": "契合什么样的人设倾向" } }
- branch_type: converge（路径不同、结果相同）| diverge（结局不同）| terminal（直接走向结局）

分岔的质量要求：
- 每条支路要让玩家付出**不同的**代价。几条路殊途同归又代价相同，是假分支；
- 选项之间是价值取舍（要什么、放弃什么），不是策略优劣；
- 分岔处的节点内容要把"现状 → 抛出问题"讲清楚，选项就是对那个问题的回答。`);
  }

  if (endings.length > 0) {
    parts.push(`### 结局节点：${endings.map((n) => n.node_id).join("、")}
每个结局节点追加：
- ending: { "kind": "good 圆满 | bad 悲剧 | neutral 无明确落点（含开放结局）",
    "scope": "global 全剧终 | local 局部结局（中途失败、提前圆满）", "trigger": "达成条件" }

两维必须分清：
- kind 说的是**情感落点**。反转结局与隐藏结局按它落在好还是坏来判，不要往 neutral 塞——
  隐藏说的是"要满足条件才走到"，那是可达性，与好坏是两回事（可达性写进 trigger）。
  neutral 只留给真正没有明确落点的结局，比如开放式收尾。
- scope 说的是**是否全剧终**。中途 game over 是 local，全剧终才是 global。

结局节点的内容必须正面回应核心冲突，不能只写"后来怎样了"。`);
  }

  return `\n${parts.join("\n\n")}\n`;
}

/**
 * 把推导结果与模型给的语义合成最终字段。
 *
 * 模型优先于推导：结构席若显式说了这是 terminal 分支，就按它说的落盘，
 * 拓扑看起来像 converge 的分歧交给结构检查去报——那多半是它想做的分支
 * 没在连接上体现出来，属于要人看的问题，不是要代码悄悄改平的问题。
 */
export function mergeTreeSemantics(
  derived: DerivedTreeFields,
  semantics: TreeSemantics | undefined,
): {
  node_function: NodeFunction;
  edges: NodeEdge[];
  branch_type?: BranchType;
  ending?: EndingSpec;
} {
  const conditions = semantics?.edge_conditions ?? {};
  const edges = derived.edges.map((e) => {
    const condition = conditions[e.to];
    return condition?.description?.trim() ? { ...e, condition } : e;
  });

  return {
    node_function: derived.node_function,
    edges,
    branch_type: semantics?.branch_type ?? derived.branch_type,
    // 结局分档不推导：情感落点与 local/global 都要读懂剧情才知道，
    // 编一个默认值等于让结构检查检不出「结局没交代」。
    ending: semantics?.ending,
  };
}
