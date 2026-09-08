/**
 * 剧情树的增删（节点视图的增删改查里，改与查已有）。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么增删不能只是数组 push / splice
 * ─────────────────────────────────────────────────────────────────
 * 剧情树的连接靠每个节点自己记的 `prev_node` / `next_node` 两份名单，两份必须互相对上：
 * A 说下一个是 B，B 就得说上一个是 A。直接往数组里塞一个节点，它不在任何人的名单里 ——
 * 那是一个孤儿，后续按连接遍历的步骤（大纲展开、情节填充、连接修复）会直接跳过它，
 * 用户看到"加上了"，跑出来却没有它。
 *
 * 删一个节点更麻烦：它的上游指着它、下游被它指着，光把节点从数组里拿掉，
 * 两边就各留一条指向不存在节点的悬空边。`connection-repair.ts` 的 `fullValidation`
 * 正是查这个，但那是生成期的兜底，不该拿它给用户的手工编辑擦屁股。
 *
 * 所以这里的两个操作都以"维持不变式"为职责：
 *
 *   插入 —— 接上 prev/next 双向名单；若指定的 prev 与 next 原本直接相连，把那条直连拆掉
 *           （否则新节点是并联的旁路，而用户要的是串进去）
 *   删除 —— 先把它的上下游对接起来（缝合），再清掉所有指向它的引用
 *
 * ─────────────────────────────────────────────────────────────────
 * 只管四层剧情树，不管任务图
 * ─────────────────────────────────────────────────────────────────
 * L0 框架 / L1 大纲 / L2 细纲 / L3 情节都是 `node_id + prev_node + next_node` 同一套词汇。
 * 任务图（`quest_graph`）用的是另一套（`prerequisites` / `next_quests`，外加
 * `main_quest_chain` 与 `branch_quests` 两份全局索引），拿这里的逻辑去动它会留下不一致的索引，
 * 所以调用方要显式拒绝任务图而不是"看起来能跑就跑"。
 */

export interface GraphNode {
  node_id: string;
  prev_node?: string[];
  next_node?: string[];
  [key: string]: unknown;
}

export interface CrudOutcome {
  nodes: GraphNode[];
  /** 结构上说得过去但值得说一声的事（比如删掉的是唯一入口）。 */
  warnings: string[];
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 深拷一份再改：入参可能是 checkpoint 里的 ctx，原地改会让"失败就不落盘"变成空话。 */
const clone = (nodes: GraphNode[]): GraphNode[] => nodes.map((n) => ({
  ...n,
  prev_node: [...listOf(n.prev_node)],
  next_node: [...listOf(n.next_node)],
}));

function linkPair(byId: Map<string, GraphNode>, from: string, to: string): void {
  const f = byId.get(from);
  const t = byId.get(to);
  if (!f || !t) return;
  f.next_node = uniq([...listOf(f.next_node), to]);
  t.prev_node = uniq([...listOf(t.prev_node), from]);
}

function unlinkPair(byId: Map<string, GraphNode>, from: string, to: string): void {
  const f = byId.get(from);
  const t = byId.get(to);
  if (f) f.next_node = listOf(f.next_node).filter((x) => x !== to);
  if (t) t.prev_node = listOf(t.prev_node).filter((x) => x !== from);
}

export interface InsertRequest {
  /** 新节点本体。至少要有 `node_id`；其余字段按该层的形状由调用方给全。 */
  node: GraphNode;
  /** 插在谁后面（可多个上游）。 */
  prev?: string[];
  /** 插在谁前面（可多个下游）。 */
  next?: string[];
}

/**
 * 插入一个节点。
 *
 * `prev` 与 `next` 都不给时是一个孤立节点 —— 允许，但会给一条 warning：用户可能是想
 * 先加出来再连线，也可能是忘了连。这里不替他猜，只把"现在它谁也不接"说清楚。
 */
export function insertNode(nodes: GraphNode[], req: InsertRequest): CrudOutcome {
  const id = req.node?.node_id;
  if (!id || typeof id !== "string" || !id.trim()) {
    throw new Error("新节点缺少 node_id");
  }
  const next = clone(nodes);
  if (next.some((n) => n.node_id === id)) {
    throw new Error(`node_id 已存在：${id}`);
  }

  const byId = new Map(next.map((n) => [n.node_id, n]));
  const prevIds = uniq(listOf(req.prev)).filter((p) => byId.has(p));
  const nextIds = uniq(listOf(req.next)).filter((n) => byId.has(n));
  const missing = [...uniq(listOf(req.prev)), ...uniq(listOf(req.next))].filter((x) => !byId.has(x));

  const fresh: GraphNode = {
    ...req.node,
    node_id: id,
    prev_node: prevIds,
    next_node: nextIds,
  };
  next.push(fresh);
  byId.set(id, fresh);

  for (const p of prevIds) {
    const f = byId.get(p)!;
    f.next_node = uniq([...listOf(f.next_node), id]);
  }
  for (const n of nextIds) {
    const t = byId.get(n)!;
    t.prev_node = uniq([...listOf(t.prev_node), id]);
  }

  // 串进去，不是并上去：prev 与 next 原本直连的那条边要断开。
  for (const p of prevIds) {
    for (const n of nextIds) {
      if (listOf(byId.get(p)!.next_node).includes(n)) unlinkPair(byId, p, n);
    }
  }

  const warnings: string[] = [];
  if (prevIds.length === 0 && nextIds.length === 0) {
    warnings.push(`${id} 没有连接任何上下游，它现在是一个孤立节点`);
  }
  if (missing.length) {
    warnings.push(`忽略了不存在的连接对象：${missing.join(", ")}`);
  }
  return { nodes: next, warnings };
}

/**
 * 删除一个节点，并把它的上下游缝合起来。
 *
 * 缝合是笛卡尔积：两个上游 × 三个下游会连出六条边。这在分支结构里是对的 ——
 * 删掉一个汇聚点，原本经它汇合的各条线都得各自接上后续，少连一条就是断链。
 */
export function removeNode(nodes: GraphNode[], nodeId: string): CrudOutcome {
  const next = clone(nodes);
  const target = next.find((n) => n.node_id === nodeId);
  if (!target) throw new Error(`节点不存在：${nodeId}`);
  if (next.length <= 1) throw new Error("这是最后一个节点，删掉剧情树就空了");

  const byId = new Map(next.map((n) => [n.node_id, n]));
  const prevIds = listOf(target.prev_node).filter((p) => p !== nodeId && byId.has(p));
  const nextIds = listOf(target.next_node).filter((n) => n !== nodeId && byId.has(n));

  for (const p of prevIds) {
    for (const n of nextIds) linkPair(byId, p, n);
  }

  const warnings: string[] = [];
  if (prevIds.length === 0 && nextIds.length > 0) {
    // 删的是入口：它的下游继承了"没有上游"，也就是成了新入口。说一声，因为这改变了开头。
    warnings.push(`${nodeId} 是入口节点，${nextIds.join("、")} 成为新的入口`);
  }
  if (nextIds.length === 0 && prevIds.length > 0) {
    warnings.push(`${nodeId} 是结尾节点，${prevIds.join("、")} 成为新的结尾`);
  }

  const kept = next.filter((n) => n.node_id !== nodeId);
  for (const n of kept) {
    n.prev_node = listOf(n.prev_node).filter((x) => x !== nodeId);
    n.next_node = listOf(n.next_node).filter((x) => x !== nodeId);
  }
  return { nodes: kept, warnings };
}

/**
 * 悬空边与单向边自检。用在落盘之前：不变式破了就别写。
 *
 * 两个方向都要查。只查一边是不够的：`A.next=[B]` 而 `B.prev=[]` 这种，从 prev 那侧
 * 永远看不见（B 的 prev 是空的，循环体一次都不进），而它恰恰是最坏的一种坏法 ——
 * 顺着 next 走能到 B，顺着 prev 回溯却回不去 A，两个方向读出来是两棵不同的树。
 */
export function validateNodeLinks(nodes: GraphNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const problems: string[] = [];
  for (const n of nodes) {
    for (const p of listOf(n.prev_node)) {
      const other = byId.get(p);
      if (!other) problems.push(`${n.node_id}.prev_node 指向不存在的 ${p}`);
      else if (!listOf(other.next_node).includes(n.node_id)) {
        problems.push(`${p} → ${n.node_id} 单向：${p}.next_node 里没有 ${n.node_id}`);
      }
    }
    for (const nx of listOf(n.next_node)) {
      const other = byId.get(nx);
      if (!other) problems.push(`${n.node_id}.next_node 指向不存在的 ${nx}`);
      else if (!listOf(other.prev_node).includes(n.node_id)) {
        problems.push(`${n.node_id} → ${nx} 单向：${nx}.prev_node 里没有 ${n.node_id}`);
      }
    }
  }
  if (nodes.length > 0 && !nodes.some((n) => listOf(n.prev_node).length === 0)) {
    problems.push("没有入口节点（所有节点都有上游）");
  }
  return problems;
}
