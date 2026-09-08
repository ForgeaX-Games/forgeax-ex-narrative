/**
 * graph-qa.ts — 语义 ID 图族的通用「算法 + LLM」质量门
 * ──────────────────────────────────────────────────────────────────────
 * 适用对象：以**语义 ID**（如 N_OLD_STREET / ENDING_TE / beat 6.1）为节点、
 * 用 next 单向边表达的剧情图（branch_tree / vn-branched-beats / quest /
 * dialogue / region 等）。
 *
 * ⚠️ 与 connection-repair.ts 的分工：
 *   connection-repair 专供 RPG L0–L4，依赖 "5_3a" 这种**分支路径编码**做跨父
 *   补边，不适用语义 ID。本模块是面向语义 ID 图族的**独立**质保内核，RPG 链
 *   路不受影响。
 *
 * 闭环（对齐需求）：
 *   ① algoValidate → 合法 → 直接结束（零 LLM 成本，对正常产出是 no-op）
 *   ② 不合法 → algoRepair（确定性修复）→ 产出 {原始问题, 已修复, 残留}
 *   ③ 仍有残留 && 允许 LLM → critic 判链路 + 给针对性 patch → 回填 → 再 algoValidate 收口
 *
 * 设计为**无状态纯函数 + 适配器**：改这一处，所有接入它的 step 全体受益。
 */
import type { LLMClient } from "../pipeline/runtime/llm-client.js";
import { extractJSON } from "../pipeline/runtime/llm-client.js";

/* ───────────── 规范图模型 ───────────── */

export interface QaNode {
  id: string;
  /** 出边目标 id 列表（修复后去重）。 */
  next: string[];
  /** 终止节点（结局/收束）。dead-end 对它是合法的。 */
  isEnding?: boolean;
  /** 结局↔死胡同配对用的语义令牌（如 ["TE"]、["good"]）；缺省时由 id 推断。 */
  tokens?: string[];
  /** 仅供 LLM critic prompt 展示，便于模型理解节点语义。 */
  label?: string;
}

export interface QaGraph {
  rootId: string;
  nodes: QaNode[];
}

export type QaIssueKind =
  | "no_entry"
  | "dangling_edge"
  | "dup_edge"
  | "orphan_node"
  | "orphan_ending"
  | "dead_end"
  | "cycle"
  | "unreachable";

export interface QaIssue {
  kind: QaIssueKind;
  nodeId?: string;
  detail: string;
  severity: "error" | "warn";
}

export interface GraphQaReport {
  /** 最终是否合法（无 error 级残留）。 */
  valid: boolean;
  /** 进入质量门时检出的全部问题。 */
  originalIssues: QaIssue[];
  /** 算法层执行的修复动作（人类可读）。 */
  repairsApplied: string[];
  /** 算法修复后仍存在的问题。 */
  residualIssues: QaIssue[];
  /** LLM critic 是否被触发并改动了图。 */
  llmTouched: boolean;
  /** LLM critic 的简评（若触发）。 */
  llmVerdict?: string;
}

/**
 * 适配器：把某 step 的原始产出 ⇄ 规范图。
 * applyRepairs 负责把修复后的边写回原始结构（只动连接关系，不碰内容字段）。
 */
export interface GraphAdapter<TRaw> {
  toCanonical(raw: TRaw): QaGraph;
  applyRepairs(raw: TRaw, repaired: QaGraph): void;
}

export interface GraphQaOptions<TRaw = unknown> {
  /** 接入 LLM critic 兜底（仅在算法修复后仍有 error 残留时触发）。 */
  llm?: LLMClient;
  /** 关掉 LLM 兜底（默认开；env NARRATIVE_DISABLE_GRAPH_LLM_REPAIR=1 也可全局关）。 */
  allowLlmRepair?: boolean;
  /** 给 LLM 的语境提示（题材/剧情梗概等），帮助它判断"链路是否正确"。 */
  contextHint?: string;
  /** 日志回调（缺省 console.warn）。 */
  log?: (msg: string) => void;
  /** 标签，用于日志定位（如 "branch_tree"）。 */
  label?: string;
  /** 供 LLM patch 用：原始节点摘要 {id -> summary}，让模型基于剧情判断连法。 */
  summaries?: Record<string, string>;
  /**
   * 是否把"非结局却无出边"视为错误（剧情树族 true；任务/区域等允许自然 sink 的图 false）。
   * 默认 true。
   */
  flagDeadEnds?: boolean;
  /** 孤儿（无入边的非根节点）严重级别。多入口图（如任务链有主线+支线入口）用 "warn"。默认 "error"。 */
  orphanSeverity?: "error" | "warn";
  /** 多入口图的额外根节点（除 rootId 外）。可达性/孤儿判定会一并视作合法入口。 */
  extraRoots?: string[];
  /**
   * 叙事序提示（id → 数值，越小越靠前）。提供后，孤儿非结局节点会被**确定性重接**到
   * 「叙事序紧邻其前、且从根可达」的前驱（节点性质修复：补回"来路"）；缺省时退化为从根补边。
   * VN 传 beat_id 的「场.序」数值；branch_tree 可传 A1-2 这类的解析序。
   */
  orderOf?: (id: string) => number;
  void?: TRaw;
}

interface ValidateChecks {
  flagDeadEnds: boolean;
  orphanSeverity: "error" | "warn";
  roots: string[];
}

function resolveChecks(g: QaGraph, opts: GraphQaOptions): ValidateChecks {
  return {
    flagDeadEnds: opts.flagDeadEnds !== false,
    orphanSeverity: opts.orphanSeverity ?? "error",
    roots: [g.rootId, ...(opts.extraRoots ?? [])].filter(Boolean),
  };
}

/* ───────────── 工具：令牌抽取（结局↔死胡同配对） ───────────── */

/** 从 id 抽取大写语义令牌：ENDING_TE → ["ENDING","TE"]；N_TE_PREP → ["N","TE","PREP"]。 */
function idTokens(id: string): string[] {
  return id
    .split(/[^A-Za-z0-9]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length >= 2);
}

/** 结局类别码归一：good→GOOD/HE/GE 这类宽匹配，统一收敛成集合。 */
const ENDING_TYPE_ALIASES: Record<string, string[]> = {
  GOOD: ["GOOD", "HE", "GE", "TE", "TRUE"],
  TRUE: ["TRUE", "TE"],
  HE: ["HE", "GOOD"],
  BAD: ["BAD", "BE"],
  BE: ["BE", "BAD"],
  NEUTRAL: ["NEUTRAL", "NE"],
  NE: ["NE", "NEUTRAL"],
  HIDDEN: ["HIDDEN", "HE2", "SE"],
};

function nodeTokens(n: QaNode): Set<string> {
  const set = new Set<string>(n.tokens?.map((t) => t.toUpperCase()) ?? []);
  for (const t of idTokens(n.id)) {
    set.add(t);
    for (const alias of ENDING_TYPE_ALIASES[t] ?? []) set.add(alias);
  }
  return set;
}

/* ───────────── ① 算法校验（纯检测，不改图） ───────────── */

export function validateGraph(g: QaGraph, checks?: Partial<ValidateChecks>): QaIssue[] {
  const flagDeadEnds = checks?.flagDeadEnds !== false;
  const orphanSeverity: "error" | "warn" = checks?.orphanSeverity ?? "error";
  const roots = new Set(checks?.roots ?? [g.rootId]);
  const issues: QaIssue[] = [];
  const idSet = new Set(g.nodes.map((n) => n.id));
  const indeg = new Map<string, number>();
  for (const n of g.nodes) indeg.set(n.id, 0);

  // 边级：悬空 / 重复
  for (const n of g.nodes) {
    const seen = new Set<string>();
    for (const to of n.next) {
      if (!idSet.has(to)) {
        issues.push({ kind: "dangling_edge", nodeId: n.id, detail: `${n.id} → "${to}" 目标不存在`, severity: "error" });
        continue;
      }
      if (seen.has(to)) {
        issues.push({ kind: "dup_edge", nodeId: n.id, detail: `${n.id} → ${to} 重复边`, severity: "warn" });
      } else {
        seen.add(to);
        indeg.set(to, (indeg.get(to) ?? 0) + 1);
      }
    }
  }

  // 入口存在性
  if (g.nodes.length > 0 && !idSet.has(g.rootId)) {
    issues.push({ kind: "no_entry", detail: `根节点 "${g.rootId}" 不在节点集合中`, severity: "error" });
  }

  // 孤儿（非根、入度 0）+ 死胡同（非结局、出度 0）+ 孤儿结局（结局、入度 0）
  for (const n of g.nodes) {
    const inDegree = indeg.get(n.id) ?? 0;
    if (inDegree === 0 && !roots.has(n.id)) {
      if (n.isEnding) {
        // 孤儿结局恒为 error（结局必须可达）
        issues.push({ kind: "orphan_ending", nodeId: n.id, detail: `结局 ${n.id} 无任何入边（不可达）`, severity: "error" });
      } else {
        issues.push({ kind: "orphan_node", nodeId: n.id, detail: `节点 ${n.id} 无任何入边（孤儿）`, severity: orphanSeverity });
      }
    }
    if (flagDeadEnds && !n.isEnding && n.next.length === 0) {
      issues.push({ kind: "dead_end", nodeId: n.id, detail: `节点 ${n.id} 非结局却无出边（死胡同）`, severity: "error" });
    }
  }

  // 环
  const cycle = detectCycle(g);
  if (cycle.length > 0) {
    issues.push({ kind: "cycle", detail: `检测到环路: ${cycle.join(" → ")}`, severity: "error" });
  }

  // 可达性（从所有根 BFS）
  const reachable = reachableFromRoots(g, roots);
  for (const n of g.nodes) {
    if (!reachable.has(n.id) && !roots.has(n.id)) {
      // 孤儿已单独报；这里只补"虽有入边但整条子图从根不可达"的情况
      const alreadyOrphan = (indeg.get(n.id) ?? 0) === 0;
      if (!alreadyOrphan) {
        issues.push({ kind: "unreachable", nodeId: n.id, detail: `节点 ${n.id} 从根不可达`, severity: "warn" });
      }
    }
  }

  return issues;
}

function detectCycle(g: QaGraph): string[] {
  const idSet = new Set(g.nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, n.next.filter((t) => idSet.has(t)));
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  function dfs(id: string): string[] {
    visited.add(id);
    stack.add(id);
    path.push(id);
    for (const nx of adj.get(id) ?? []) {
      if (!visited.has(nx)) {
        const c = dfs(nx);
        if (c.length) return c;
      } else if (stack.has(nx)) {
        const idx = path.indexOf(nx);
        if (idx >= 0) return [...path.slice(idx), nx];
      }
    }
    stack.delete(id);
    path.pop();
    return [];
  }
  for (const n of g.nodes) {
    if (!visited.has(n.id)) {
      const c = dfs(n.id);
      if (c.length) return c;
    }
  }
  return [];
}

function reachableFromRoots(g: QaGraph, roots: Set<string>): Set<string> {
  const idSet = new Set(g.nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, n.next.filter((t) => idSet.has(t)));
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const r of roots) {
    if (idSet.has(r) && !seen.has(r)) {
      seen.add(r);
      queue.push(r);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nx of adj.get(cur) ?? []) {
      if (!seen.has(nx)) {
        seen.add(nx);
        queue.push(nx);
      }
    }
  }
  return seen;
}

/* ───────────── ② 算法修复（确定性，in-place 改 g.nodes[].next） ───────────── */

export interface RepairOptions {
  roots?: Set<string>;
  /** 叙事序（id → 数值）。提供后孤儿非结局节点按"紧邻前驱"重接；缺省退化为从根补边。 */
  orderOf?: (id: string) => number;
  /** 是否修复孤儿非结局节点（仅在 orphanSeverity==="error" 的图启用）。默认 true。 */
  repairOrphans?: boolean;
}

export interface RepairResult {
  graph: QaGraph;
  /** 全部修复动作（含安全的去重/删悬空，人类可读）。 */
  repairs: string[];
  /**
   * 「语义级」修复：改动了剧情走向、需要 LLM 复核的动作（孤儿重接 / 死胡同接结局 /
   * 孤儿结局补源）。纯去重/删悬空不计入——它们不改变叙事链路，无需 LLM 复核。
   */
  semantic: string[];
}

export function repairGraph(g: QaGraph, opts: RepairOptions = {}): RepairResult {
  const repairs: string[] = [];
  const semantic: string[] = [];
  const note = (msg: string, isSemantic: boolean) => {
    repairs.push(msg);
    if (isSemantic) semantic.push(msg);
  };
  const idSet = new Set(g.nodes.map((n) => n.id));
  const rootSet = opts.roots ?? new Set([g.rootId]);
  const repairOrphans = opts.repairOrphans !== false;

  // 2.1 去重 + 删悬空边（安全清理，不计语义）
  for (const n of g.nodes) {
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const to of n.next) {
      if (!idSet.has(to)) {
        note(`删除悬空边 ${n.id} → ${to}`, false);
        continue;
      }
      if (seen.has(to)) {
        note(`去重边 ${n.id} → ${to}`, false);
        continue;
      }
      seen.add(to);
      cleaned.push(to);
    }
    n.next = cleaned;
  }

  // 2.2 死胡同叶子 → 孤儿结局：按令牌配对（一举修复 dead_end + orphan_ending）
  const indeg = computeIndegree(g);
  const orphanEndings = g.nodes.filter((n) => n.isEnding && (indeg.get(n.id) ?? 0) === 0 && n.id !== g.rootId);
  const deadLeaves = g.nodes.filter((n) => !n.isEnding && n.next.length === 0);

  const usedLeaves = new Set<string>();
  for (const ending of orphanEndings) {
    const eTokens = nodeTokens(ending);
    let best: QaNode | null = null;
    let bestScore = 0;
    for (const leaf of deadLeaves) {
      if (usedLeaves.has(leaf.id)) continue;
      const score = intersectCount(nodeTokens(leaf), eTokens);
      if (score > bestScore) {
        bestScore = score;
        best = leaf;
      }
    }
    if (best && bestScore > 0) {
      best.next.push(ending.id);
      usedLeaves.add(best.id);
      indeg.set(ending.id, (indeg.get(ending.id) ?? 0) + 1);
      note(`令牌配对：死胡同 ${best.id} → 孤儿结局 ${ending.id}`, true);
    }
  }

  // 2.3 剩余死胡同叶子（无结局可配）→ 指向「令牌最相近的结局」（任一结局，保证可结束）
  const allEndings = g.nodes.filter((n) => n.isEnding);
  for (const leaf of deadLeaves) {
    if (leaf.next.length > 0) continue; // 已在 2.2 修复
    if (allEndings.length === 0) continue;
    let best = allEndings[0];
    let bestScore = -1;
    const lTokens = nodeTokens(leaf);
    for (const e of allEndings) {
      const score = intersectCount(lTokens, nodeTokens(e));
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    leaf.next.push(best.id);
    indeg.set(best.id, (indeg.get(best.id) ?? 0) + 1);
    note(`死胡同兜底：${leaf.id} → 结局 ${best.id}`, true);
  }

  // 2.4 剩余孤儿结局（无死胡同可配）→ 从「可达且接近收束」的普通叶子补边
  const stillOrphanEndings = allEndings.filter((n) => (indeg.get(n.id) ?? 0) === 0 && !rootSet.has(n.id));
  if (stillOrphanEndings.length > 0) {
    const reachable = reachableFromRoots(g, rootSet);
    const candidates = g.nodes
      .filter((n) => !n.isEnding && reachable.has(n.id))
      .sort((a, b) => a.next.length - b.next.length);
    for (const ending of stillOrphanEndings) {
      const src = pickEndingSource(candidates, nodeTokens(ending)) ?? candidates[0];
      if (src) {
        src.next.push(ending.id);
        indeg.set(ending.id, (indeg.get(ending.id) ?? 0) + 1);
        note(`孤儿结局兜底：${src.id} → ${ending.id}`, true);
      }
    }
  }

  // 2.5 孤儿非结局节点 → 补回"来路"（图1 根因：无前驱的 beat 被挤到最前列）。
  //     节点性质修复：每个非根、非结局节点必须有 ≥1 个前驱且从根可达。
  //     重接策略：优先接到「叙事序紧邻其前、且从根可达」的非结局前驱；无序信息时退化为接根。
  if (repairOrphans) {
    const orderOf = opts.orderOf;
    // 反复重接，直到无新孤儿（重接后其后继子图随之可达，可能暴露/消解链式孤儿）
    for (let pass = 0; pass < g.nodes.length; pass++) {
      const indeg2 = computeIndegree(g);
      const reachable = reachableFromRoots(g, rootSet);
      const orphans = g.nodes.filter(
        (n) => !n.isEnding && !rootSet.has(n.id) && (indeg2.get(n.id) ?? 0) === 0,
      );
      if (orphans.length === 0) break;
      // 先处理叙事序最靠前的孤儿，保证链式重接顺序自然
      if (orderOf) orphans.sort((a, b) => orderOf(a.id) - orderOf(b.id));
      const orphan = orphans[0];
      let pred: QaNode | null = null;
      if (orderOf) {
        const oOrder = orderOf(orphan.id);
        // 候选 = 叙事序在孤儿之前、且本身从根可达的非结局节点（避免接成新孤岛），按序号降序
        const befores = g.nodes
          .filter((c) => !c.isEnding && c.id !== orphan.id && (reachable.has(c.id) || rootSet.has(c.id)) && orderOf(c.id) < oOrder)
          .sort((a, b) => orderOf(b.id) - orderOf(a.id));
        // 优先紧邻且仍有线性余量（next<2，不撑破 pivot 的 choice/branch_qte 出边约束）的前驱；
        // 找不到这样的就退而取紧邻者（剧情由 LLM 复核纠偏）
        pred = befores.find((c) => c.next.length < 2) ?? befores[0] ?? null;
      }
      // 退化兜底：无序信息 / 找不到更靠前的可达前驱 → 接根（保证可达，剧情由 LLM 复核）
      if (!pred) {
        const rootId = [...rootSet][0] ?? g.rootId;
        pred = g.nodes.find((n) => n.id === rootId) ?? null;
      }
      if (pred && !pred.next.includes(orphan.id)) {
        pred.next.push(orphan.id);
        note(`孤儿重接：${pred.id} → ${orphan.id}（补回前驱）`, true);
      } else {
        break; // 无法重接（防死循环）
      }
    }
  }

  return { graph: g, repairs, semantic };
}

function pickEndingSource(candidates: QaNode[], eTokens: Set<string>): QaNode | null {
  let best: QaNode | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = intersectCount(nodeTokens(c), eTokens);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function computeIndegree(g: QaGraph): Map<string, number> {
  const idSet = new Set(g.nodes.map((n) => n.id));
  const indeg = new Map<string, number>();
  for (const n of g.nodes) indeg.set(n.id, 0);
  for (const n of g.nodes) {
    for (const to of n.next) {
      if (idSet.has(to)) indeg.set(to, (indeg.get(to) ?? 0) + 1);
    }
  }
  return indeg;
}

function intersectCount(a: Set<string>, b: Set<string>): number {
  let c = 0;
  for (const x of a) if (b.has(x)) c++;
  return c;
}

/* ───────────── ③ LLM critic 兜底（仅算法修不动时触发） ───────────── */

interface QaLlmPatch {
  op: "add_edge" | "remove_edge" | "retarget_edge" | "mark_ending";
  from?: string;
  to?: string;
  new_to?: string;
  node_id?: string;
}

const QA_CRITIC_SYSTEM = `你是互动叙事的剧情结构审校器。算法已先做过确定性修复（去重 / 补来路 / 接结局），现在把图与"算法所做的修复"交给你，请**站在剧情合理性**上复核并给出**最小**修补，使结构既合法又叙事通顺：
- 每个非结局节点必须有出边（不能是死胡同）；每个节点必须能从根到达（不能是孤儿）。
- **重点复核算法那几处"补回的边"是否接错了人**：算法只看序号/令牌，可能把孤儿接到了剧情上不相干的前驱、把死胡同硬接到不相称的结局。若接错，用 retarget_edge 改到剧情上正确的前驱/结局；接对了就别动。
- ⚠ **死胡同优先"汇回正轨"而非"接死亡结局"**：算法常把无出边的节点兜底接到某个结局（往往是 BE/失败结局）。但若该节点的内容只是"挫折 / 受损 / 受阻但人还在、事未了"（非致命、非终结），正确做法是 **retarget 到剧情上紧随其后的推进节点**（让支线挣扎后**汇回主线**继续故事），**不要**让它草草撞进死亡/失败结局。只有当节点内容**明确是致命/终局**（角色死亡、彻底失败、故事到此为止）时，接结局才合理。判断依据是节点摘要的语义，不是它的编号大小。
- 不要制造环路；不要凭空发明新节点（只能在已有 id 间连边/改边/标记结局）。
- 若算法的修复在剧情上已成立、也无残留问题，返回空 patches 即可。
只输出 JSON：
{
  "verdict": "对链路与算法修复的一句话判断",
  "patches": [
    { "op": "add_edge", "from": "源id", "to": "目标id" },
    { "op": "retarget_edge", "from": "源id", "to": "原目标id", "new_to": "新目标id" },
    { "op": "remove_edge", "from": "源id", "to": "目标id" },
    { "op": "mark_ending", "node_id": "应当是结局的节点id" }
  ]
}`;

function buildCriticUserPrompt(
  g: QaGraph,
  issues: QaIssue[],
  opts: GraphQaOptions,
  appliedRepairs: string[],
): string {
  const nodeLines = g.nodes
    .map((n) => {
      const tag = n.isEnding ? "[结局]" : "";
      const summary = opts.summaries?.[n.id] ? ` — ${opts.summaries[n.id].slice(0, 60)}` : n.label ? ` — ${n.label}` : "";
      return `- ${n.id}${tag} → [${n.next.join(", ")}]${summary}`;
    })
    .join("\n");
  const repairLines = appliedRepairs.length ? appliedRepairs.map((r) => `- ${r}`).join("\n") : "（无）";
  const issueLines = issues.length ? issues.map((i) => `- (${i.kind}) ${i.detail}`).join("\n") : "（算法已消除全部结构错误，仅需复核连法是否接对人）";
  return [
    opts.contextHint ? `## 剧情语境\n${opts.contextHint}` : "",
    `## 根节点\n${g.rootId}`,
    `## 节点与出边（含算法修复后的现状）\n${nodeLines}`,
    `## 算法刚才做的"语义级"修复（请逐条复核是否接对了剧情）\n${repairLines}`,
    `## 算法修复后仍残留的结构问题\n${issueLines}`,
    `请基于剧情合理性复核上述修复并给出最小修补 JSON（接对了就返回空 patches）。`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function applyLlmPatches(g: QaGraph, patches: QaLlmPatch[], repairs: string[]): void {
  const map = new Map(g.nodes.map((n) => [n.id, n]));
  for (const p of patches) {
    switch (p.op) {
      case "add_edge": {
        const from = p.from && map.get(p.from);
        if (from && p.to && map.has(p.to) && !from.next.includes(p.to)) {
          from.next.push(p.to);
          repairs.push(`[LLM] add_edge ${p.from} → ${p.to}`);
        }
        break;
      }
      case "retarget_edge": {
        const from = p.from && map.get(p.from);
        if (from && p.to && p.new_to && map.has(p.new_to)) {
          const idx = from.next.indexOf(p.to);
          if (idx >= 0) {
            from.next[idx] = p.new_to;
            repairs.push(`[LLM] retarget ${p.from}: ${p.to} → ${p.new_to}`);
          }
        }
        break;
      }
      case "remove_edge": {
        const from = p.from && map.get(p.from);
        if (from && p.to) {
          const before = from.next.length;
          from.next = from.next.filter((t) => t !== p.to);
          if (from.next.length < before) repairs.push(`[LLM] remove_edge ${p.from} → ${p.to}`);
        }
        break;
      }
      case "mark_ending": {
        const n = p.node_id && map.get(p.node_id);
        if (n) {
          n.isEnding = true;
          repairs.push(`[LLM] mark_ending ${p.node_id}`);
        }
        break;
      }
    }
  }
}

async function llmCritic(
  g: QaGraph,
  issues: QaIssue[],
  llm: LLMClient,
  opts: GraphQaOptions,
  repairs: string[],
  appliedSemanticRepairs: string[] = [],
): Promise<string | undefined> {
  try {
    const raw = await llm.callWithRetry(QA_CRITIC_SYSTEM, buildCriticUserPrompt(g, issues, opts, appliedSemanticRepairs), {
      responseFormat: "json",
      temperature: 0.2,
    });
    const parsed = extractJSON<{ verdict?: string; patches?: QaLlmPatch[] }>(raw);
    if (parsed?.patches && Array.isArray(parsed.patches)) {
      applyLlmPatches(g, parsed.patches, repairs);
    }
    return parsed?.verdict;
  } catch (e) {
    // Fail-open：critic 失败不阻断管线，保留算法修复结果。
    (opts.log ?? console.warn)(`[graph-qa${opts.label ? ":" + opts.label : ""}] LLM critic 失败: ${(e as Error)?.message ?? e}`);
    return undefined;
  }
}

/* ───────────── 覆盖率校验（跨步引用，非拓扑） ───────────── */

export interface CoverageReport {
  valid: boolean;
  /** 参考集中缺少产出的 id（如 branch_tree 有此节点但 dialogue 没写脚本）。 */
  missing: string[];
  /** 产出里多出的 id（不在参考集；通常无害，仅告警）。 */
  extra: string[];
  /** 指向未知目标的跨引用（如 choices.leads_to 指向不存在的节点）。 */
  danglingRefs: Array<{ from: string; to: string }>;
}

/**
 * 覆盖率/引用合法性校验（report-only，不改数据）。
 * 用于"下游产出应覆盖上游图节点 + 跨引用必须落在合法目标内"的场景
 * （dialogue_script / cinematic_storyboard 对齐 branch_tree）。
 * 改这一处，所有调用它的下游步骤同时受益。
 */
export function validateCoverage(input: {
  referenceIds: string[];
  producedIds: string[];
  crossRefs?: Array<{ from: string; to: string }>;
  validRefTargets?: Iterable<string>;
}): CoverageReport {
  const ref = new Set(input.referenceIds);
  const produced = new Set(input.producedIds);
  const missing = [...ref].filter((id) => !produced.has(id));
  const extra = [...produced].filter((id) => !ref.has(id));
  const targets = new Set(input.validRefTargets ?? [...ref]);
  const danglingRefs = (input.crossRefs ?? []).filter((r) => r.to && !targets.has(r.to));
  return { valid: missing.length === 0 && danglingRefs.length === 0, missing, extra, danglingRefs };
}

/* ───────────── 主入口 ───────────── */

export async function runGraphQA<TRaw>(
  raw: TRaw,
  adapter: GraphAdapter<TRaw>,
  opts: GraphQaOptions<TRaw> = {},
): Promise<GraphQaReport> {
  const log = opts.log ?? ((m: string) => console.warn(m));
  const tag = opts.label ? `:${opts.label}` : "";
  const g = adapter.toCanonical(raw);
  const checks = resolveChecks(g, opts);
  const rootSet = new Set(checks.roots);

  const originalIssues = validateGraph(g, checks);
  const errors = originalIssues.filter((i) => i.severity === "error");

  // ① 合法 → no-op 直接结束
  if (errors.length === 0) {
    return { valid: true, originalIssues, repairsApplied: [], residualIssues: originalIssues, llmTouched: false };
  }

  log(`[graph-qa${tag}] 检出 ${errors.length} 个结构错误，启动算法修复`);

  // ② 算法修复 → 复检
  const { repairs, semantic } = repairGraph(g, {
    roots: rootSet,
    orderOf: opts.orderOf,
    repairOrphans: checks.orphanSeverity === "error",
  });
  let residualIssues = validateGraph(g, checks);
  let residualErrors = residualIssues.filter((i) => i.severity === "error");
  let llmTouched = false;
  let llmVerdict: string | undefined;

  // ③ LLM critic：不止"修不动才上"——只要算法做过**语义级**修复（改了剧情走向，
  //    如孤儿重接 / 死胡同接结局），就让 LLM 复核连法是否成立（算法是死的）；
  //    或仍有 error 残留时强制修。两种情况都把"原始问题 + 算法已做的修复"交给 LLM 判断。
  const llmAllowed =
    opts.allowLlmRepair !== false && process.env.NARRATIVE_DISABLE_GRAPH_LLM_REPAIR !== "1" && !!opts.llm;
  const needLlm = residualErrors.length > 0 || semantic.length > 0;
  if (needLlm && llmAllowed && opts.llm) {
    const reason = residualErrors.length > 0 ? `残留 ${residualErrors.length} 个错误` : `复核 ${semantic.length} 处语义修复`;
    log(`[graph-qa${tag}] 启动 LLM critic（${reason}）`);
    const beforeRepairs = repairs.length;
    llmVerdict = await llmCritic(g, residualErrors, opts.llm, opts, repairs, semantic);
    llmTouched = repairs.length > beforeRepairs;
    if (llmTouched) {
      residualIssues = validateGraph(g, checks);
      residualErrors = residualIssues.filter((i) => i.severity === "error");
    }
  }

  // 写回原始结构
  adapter.applyRepairs(raw, g);

  log(
    `[graph-qa${tag}] 修复完成：${repairs.length} 处动作，残留 ${residualErrors.length} 个错误` +
      (residualErrors.length > 0 ? `（${residualErrors.map((e) => e.detail).join("; ")}）` : ""),
  );

  return {
    valid: residualErrors.length === 0,
    originalIssues,
    repairsApplied: repairs,
    residualIssues,
    llmTouched,
    llmVerdict,
  };
}
