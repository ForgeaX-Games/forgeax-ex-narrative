/**
 * Detroit-style pipeline layout for React Flow.
 *
 * 两条铁律，越过它们画面就开始说谎：
 *
 * 1. 横向次序 = 管线执行次序。只有同一个 step 内部真的并行产出两支（legacy 的
 *    script_scene_generation 同时给出任务与场景），才画成上下并列的分叉；
 *    相隔数个席位、串行执行的两步不许并列——那是凭空捏出来的并行关系。
 * 2. 结构由产物推导。没有产物的步骤就是一张普通卡，不预先长出空容器与 `(0)` 卡片。
 *
 * 场景生成的内部分段（骨架层 → 展开 → 合并）来自后端 scene_map 的真实字段，
 * 有几层骨架就画几张卡；节点 id 一律是 `<容器id>::段名`，容器 id 就是 step id。
 *
 * 容器几何只有一个裁决者：resolveContainerGeometry（自内向外的包围盒）。
 * 各 builder 的算术式只负责"还没有子节点时的初始摆位"。
 */
import { useMemo } from "react";
import type { Node, Edge } from "reactflow";
import type { StepState } from "../store/narrativeStore";
import type { NarrativeContext, StoryNode, SceneNode, SkeletonLayerScene, AnnounceStepGroup, StepStatus } from "../types";
import { PIPELINE_STEPS } from "../types";
import type { EntryCard } from "./useEntryCard";

// ── Dimensions ──────────────────────────────────────────────────────────────
/*
 * 管线节点的格子尺寸 = 编排节点那张卡的尺寸（.composer-node 宽 190）。
 * 两侧共用一副形式，就得共用一副尺寸：格子还按老的 140×68 留，卡片被压窄、简介只剩一行，
 * 看上去仍是旧的小卡，"统一"就只统一在 DOM 里。
 */
const PL_W = 190;
const PL_H = 78;
/**
 * 同级节点的水平间距。
 *
 * 从 44 加倍到 88：两层容器（专家 > 席位 > 实现步）同时在场时，每层边框都要吃掉
 * 一点间隙，44 的时候外层边框与邻卡之间只剩几个像素，读起来像贴在一起。
 * 间距也是层级的视觉线索——留够了，嵌套关系才看得出来。
 */
const H_GAP = 88;
const INIT_X = 32;
const INIT_Y = 80;

const CN_W = 128;
const CN_H = 72;
const COL_GAP = 48;
const ROW_GAP = 20;
const BIG_TITLE_H = 32;
const BIG_PAD = 16;

const GROUP_MIN_W = 300;
const GROUP_MIN_H = 180;

/**
 * 各类节点的"标题栏"选择器 —— 拖动只认标题栏。
 *
 * 卡身上的点击另有含义（展开详情、折叠容器）；若整张卡都能拖，
 * 一次手抖就把"看一眼"变成"挪一格"。标题栏是那条既显眼又没有别的语义的把手。
 */
const DRAG_HANDLE: Record<string, string> = {
  pipelineStep: ".rf-pipeline-header",
  narrativeCard: ".rf-pipeline-header",
  storyChild: ".rf-child-header",
  storyGroup: ".rf-story-group-header",
};

/**
 * 除"标题栏下沿"以外的方向上，子节点的活动范围实际不设限。
 *
 * ReactFlow 的 extent 要求四个具体数字，这里用一个足够大的有限值代替无穷——
 * Infinity 会在它内部的 clamp 运算里变成 NaN。
 */
const DRAG_FREE = 100_000;

const FORK_V_GAP = 36;
const INNER_GAP = 44;

// ── node_id parser ──────────────────────────────────────────────────────────

function parseNodeIdForPosition(nodeId: string): { xKey: number[]; branchKey: string } {
  if (!nodeId) return { xKey: [0], branchKey: "" };
  const parts = nodeId.split("_");
  const xComponents: number[] = [];
  const branchLetters: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^(\d+)([a-z])?$/);
    if (m) {
      xComponents.push(parseInt(m[1]));
      if (m[2]) branchLetters.push(m[2]);
    } else {
      const numMatch = part.match(/^(\d+)/);
      xComponents.push(numMatch ? parseInt(numMatch[1]) : 0);
    }
  }
  return { xKey: xComponents, branchKey: branchLetters.join("_") };
}

function compareXKeys(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Symmetric row offset for a branch letter within a sibling group.
 * 2 siblings: a→-1, b→+1
 * 3 siblings: a→-1, b→0, c→+1
 */
function symmetricOffset(idx: number, groupSize: number): number {
  if (groupSize <= 1) return 0;
  if (groupSize % 2 === 1) return idx - Math.floor(groupSize / 2);
  const half = groupSize / 2;
  return idx < half ? idx - half : idx - half + 1;
}

// ── Compute col/row for story nodes ─────────────────────────────────────────

interface ColRow { col: number; row: number }

/**
 * Connection-based layout: column from node_id numeric sequence (xKey),
 * row from fork/merge topology (symmetric offsets via next_node/prev_node).
 *
 * Falls back to node-ID parsing when no connections exist.
 */
function computeStoryLayout(nodes: StoryNode[]): Map<string, ColRow> {
  const result = new Map<string, ColRow>();
  if (!nodes.length) return result;
  const validNodes = nodes.filter((n) => n.node_id);
  if (!validNodes.length) return result;

  // ── Layout-id resolver：优先用 _layoutId（branch_tree 这种语义化 id 的节点必填），
  //    否则用 node_id（RPG story_framework 等本身就是 Detroit 风格 id）。
  const idToNode = new Map(validNodes.map((n) => [n.node_id, n]));
  const layoutIdOf = (id: string): string => idToNode.get(id)?._layoutId ?? id;

  const hasConnections = validNodes.some(
    (n) => (n.next_node && n.next_node.length > 0) || (n.prev_node && n.prev_node.length > 0),
  );

  if (!hasConnections) {
    return computeStoryLayoutFromIds(validNodes);
  }

  // ── Build adjacency from connection data ──
  const nodeIds = new Set(validNodes.map((n) => n.node_id));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const n of validNodes) {
    const nexts = (n.next_node ?? []).filter((id) => nodeIds.has(id));
    outgoing.set(n.node_id, nexts);
    for (const nxt of nexts) incoming.get(nxt)!.push(n.node_id);
  }

  // ── Topological sort → processing order for row assignment ──
  const inDeg = new Map<string, number>();
  for (const id of nodeIds) inDeg.set(id, (incoming.get(id) ?? []).length);

  const waves: string[][] = [];
  let queue = [...nodeIds].filter((id) => (inDeg.get(id) ?? 0) === 0);
  const visited = new Set<string>();

  while (queue.length > 0) {
    waves.push(queue);
    for (const id of queue) visited.add(id);
    const next: string[] = [];
    for (const id of queue) {
      for (const nxt of outgoing.get(id) ?? []) {
        if (visited.has(nxt)) continue;
        const d = (inDeg.get(nxt) ?? 1) - 1;
        inDeg.set(nxt, d);
        if (d <= 0) { next.push(nxt); visited.add(nxt); }
      }
    }
    queue = next;
  }
  for (const id of nodeIds) {
    if (!visited.has(id)) {
      if (!waves.length) waves.push([]);
      waves[waves.length - 1].push(id);
    }
  }

  // ── Column assignment: xKey from layout-id (numbers = sequence) ──
  const parsedIds = new Map<string, { xKey: number[] }>();
  for (const n of validNodes) parsedIds.set(n.node_id, parseNodeIdForPosition(layoutIdOf(n.node_id)));
  const xKeyStrs = new Map<string, number[]>();
  for (const [, p] of parsedIds) xKeyStrs.set(JSON.stringify(p.xKey), p.xKey);
  const sortedXKeys = [...xKeyStrs.values()].sort(compareXKeys);
  const xKeyToCol = new Map<string, number>();
  sortedXKeys.forEach((k, i) => xKeyToCol.set(JSON.stringify(k), i));

  const colMap = new Map<string, number>();
  for (const n of validNodes) {
    const p = parsedIds.get(n.node_id)!;
    colMap.set(n.node_id, xKeyToCol.get(JSON.stringify(p.xKey)) ?? 0);
  }

  // ── Immediate fork size (no propagation through linear nodes) ──
  // Only counts direct fork children's sizes; linear nodes are always size 1.
  // This keeps the layout compact — downstream forks handle their own spacing.
  const leafCache = new Map<string, number>();
  function leafCount(id: string, depth = 0): number {
    if (depth > 50) return 1;
    if (leafCache.has(id)) return leafCache.get(id)!;
    const nexts = outgoing.get(id) ?? [];
    if (nexts.length <= 1) { leafCache.set(id, 1); return 1; }
    const total = nexts.reduce((s, n) => s + leafCount(n, depth + 1), 0);
    leafCache.set(id, total);
    return total;
  }

  // ── Row assignment: fork → symmetric, merge → average, linear → inherit ──
  const rowMap = new Map<string, number>();

  for (const wave of waves) {
    for (const id of wave) {
      if (rowMap.has(id)) continue;
      const parents = incoming.get(id) ?? [];
      if (parents.length === 0) {
        rowMap.set(id, 0);
      } else if (parents.length >= 2) {
        const pRows = parents.map((p) => rowMap.get(p) ?? 0);
        rowMap.set(id, Math.round(pRows.reduce((a, b) => a + b, 0) / pRows.length));
      } else {
        const parentId = parents[0];
        const siblings = outgoing.get(parentId) ?? [];
        if (siblings.length <= 1) {
          rowMap.set(id, rowMap.get(parentId) ?? 0);
        }
      }
    }

    for (const id of wave) {
      const nexts = outgoing.get(id) ?? [];
      if (nexts.length <= 1) continue;

      const sorted = [...nexts].sort((a, b) => {
        const pA = parseNodeIdForPosition(layoutIdOf(a));
        const pB = parseNodeIdForPosition(layoutIdOf(b));
        const xCmp = compareXKeys(pA.xKey, pB.xKey);
        if (xCmp !== 0) return xCmp;
        return pA.branchKey.localeCompare(pB.branchKey);
      });

      const parentRow = rowMap.get(id) ?? 0;
      const sizes = sorted.map((n) => leafCount(n));
      const totalSpanWithGaps = sizes.reduce((s, v) => s + v, 0) + (sorted.length - 1);
      let pos = parentRow - (totalSpanWithGaps - 1) / 2;

      for (let i = 0; i < sorted.length; i++) {
        if (!rowMap.has(sorted[i])) {
          const center = pos + (sizes[i] - 1) / 2;
          const diff = center - parentRow;
          const rounded = diff > 0 ? Math.ceil(center) : diff < 0 ? Math.floor(center) : parentRow;
          rowMap.set(sorted[i], rounded);
        }
        pos += sizes[i] + 1;
      }
    }
  }

  // ── Phase 3: collision resolution ──
  // Without linear propagation, nested forks at the same column may collide.
  // Scan each column and push overlapping nodes apart.
  const colNodes = new Map<number, string[]>();
  for (const id of nodeIds) {
    const c = colMap.get(id)!;
    if (!colNodes.has(c)) colNodes.set(c, []);
    colNodes.get(c)!.push(id);
  }
  for (const ids of colNodes.values()) {
    if (ids.length <= 1) continue;
    ids.sort((a, b) => (rowMap.get(a) ?? 0) - (rowMap.get(b) ?? 0));
    for (let i = 1; i < ids.length; i++) {
      const prevRow = rowMap.get(ids[i - 1])!;
      const curRow = rowMap.get(ids[i])!;
      if (curRow <= prevRow) {
        rowMap.set(ids[i], prevRow + 1);
      }
    }
  }

  for (const n of validNodes) {
    result.set(n.node_id, { col: colMap.get(n.node_id) ?? 0, row: rowMap.get(n.node_id) ?? 0 });
  }
  return result;
}

/**
 * Fallback: compute layout purely from node ID structure (when no connections exist).
 */
function computeStoryLayoutFromIds(validNodes: StoryNode[]): Map<string, ColRow> {
  const result = new Map<string, ColRow>();

  // 优先用 _layoutId（语义化 id 的节点必填），否则 fallback 到 node_id。
  const parsed = new Map<string, { xKey: number[]; branchKey: string; parts: string[] }>();
  for (const n of validNodes) {
    const layoutId = n._layoutId ?? n.node_id;
    const p = parseNodeIdForPosition(layoutId);
    parsed.set(n.node_id, { ...p, parts: layoutId.split("_") });
  }

  const xKeyStrs = new Map<string, number[]>();
  for (const [, p] of parsed) xKeyStrs.set(JSON.stringify(p.xKey), p.xKey);
  const sortedXKeys = [...xKeyStrs.values()].sort(compareXKeys);
  const xKeyToCol = new Map<string, number>();
  sortedXKeys.forEach((k, i) => xKeyToCol.set(JSON.stringify(k), i));

  const branchGroupLetters = new Map<string, Set<string>>();
  for (const [, p] of parsed) {
    for (let i = 0; i < p.parts.length; i++) {
      const match = p.parts[i].match(/^(\d+)([a-z])$/);
      if (!match) continue;
      const prefix = [...p.parts.slice(0, i), match[1]].join("_");
      if (!branchGroupLetters.has(prefix)) branchGroupLetters.set(prefix, new Set());
      branchGroupLetters.get(prefix)!.add(match[2]);
    }
  }
  const branchGroupSizes = new Map<string, number>();
  for (const [prefix, letters] of branchGroupLetters) branchGroupSizes.set(prefix, letters.size);

  for (const n of validNodes) {
    const p = parsed.get(n.node_id)!;
    const col = xKeyToCol.get(JSON.stringify(p.xKey)) ?? 0;
    let row = 0;
    let branchDepth = 0;
    for (let i = 0; i < p.parts.length; i++) {
      const match = p.parts[i].match(/^(\d+)([a-z])$/);
      if (!match) continue;
      branchDepth++;
      const prefix = [...p.parts.slice(0, i), match[1]].join("_");
      const groupSize = branchGroupSizes.get(prefix) ?? 2;
      const idx = match[2].charCodeAt(0) - 97;
      const scale = Math.max(1, 3 - branchDepth);
      row += symmetricOffset(idx, groupSize) * scale;
    }
    result.set(n.node_id, { col, row });
  }
  return result;
}

function colRowToPixels(layout: Map<string, ColRow>): {
  positions: Map<string, { x: number; y: number }>; width: number; height: number;
} {
  if (!layout.size) return { positions: new Map(), width: GROUP_MIN_W, height: GROUP_MIN_H };
  let minRow = Infinity, maxRow = -Infinity, maxCol = 0;
  for (const { col, row } of layout.values()) {
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }
  if (!isFinite(minRow)) { minRow = 0; maxRow = 0; }

  const padTop = BIG_TITLE_H + BIG_PAD;
  const rowOffset = -minRow;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, { col, row }] of layout) {
    positions.set(id, {
      x: BIG_PAD + col * (CN_W + COL_GAP),
      y: padTop + (row + rowOffset) * (CN_H + ROW_GAP),
    });
  }
  const cols = maxCol + 1;
  const rowSpan = maxRow - minRow;
  const totalW = Math.max(GROUP_MIN_W, BIG_PAD + cols * CN_W + Math.max(0, cols - 1) * COL_GAP + BIG_PAD);
  const totalH = Math.max(GROUP_MIN_H, padTop + CN_H + rowSpan * (CN_H + ROW_GAP) + BIG_PAD);
  return { positions, width: totalW, height: totalH };
}

// ── Unified story node extraction ────────────────────────────────────────────
//
// One config table + one function replaces the previous 7 scattered extractors.
// Each entry describes how to pull StoryNode[] from a step's ctx field data.

type PlotLike = { node_id: string; content_id?: string; prev_node?: string[]; next_node?: string[]; narrative_stage?: string };

interface StoryExtractConfig {
  arrayPath: string;
  normalize:
    | null | "plot" | "chapter" | "sceneGroup" | "quest" | "branchTree" | "branchTreeOverlay"
    // 互动影游 v2（tpl-vn-v2）：复用 Detroit 布局
    | "vnLinear"        // 线性序列（场 / 情节点）→ 顺序成链
    | "vnBranched"      // G-01 剧情树（beats prev/next + endings）→ 真分支 DAG
    | "vnTreeOverlay";  // 剧本 / 分镜：复用 G-01 拓扑，按 beat_id 覆盖内容
}

const STEP_STORY_EXTRACT: Record<string, StoryExtractConfig> = {
  story_framework:  { arrayPath: "framework.nodes",  normalize: null },
  outline_batch:    { arrayPath: "outlines",          normalize: null },
  detailed_outline: { arrayPath: "detailed_outlines", normalize: null },
  plot_generation:  { arrayPath: "plots",             normalize: "plot" },
  script_generation:{ arrayPath: "chapters",          normalize: "chapter" },
  quest_generation: { arrayPath: "quests",            normalize: "quest" },
  scene_plan: { arrayPath: "_phase2_per_node",  normalize: "sceneGroup" },
  // VN / 互动影游剧情树（与 RPG story_framework 共用 Detroit 布局）
  branch_tree:      { arrayPath: "nodes",             normalize: "branchTree" },
  // dialogue_script / cinematic_storyboard 没有自己的拓扑（prev/next）— 它们的"剧情树"
  // 完全是 branch_tree 的影子（按相同 node_id 挂载内容）。展示策略：复用 branch_tree 拓扑，
  // 在每个节点上覆盖该 step 的内容（对话摘要 / 镜头数 + QTE 标记 / 场景描述）。
  dialogue_script:      { arrayPath: "scripts",     normalize: "branchTreeOverlay" },
  cinematic_storyboard: { arrayPath: "storyboards", normalize: "branchTreeOverlay" },
  // ── 互动影游 v2（tpl-vn-v2）各步骤大节点 + 剧情树 ──
  // 注：vn_outline_acts（E1-02 三幕扩写）走主循环的专属嵌套分支（buildOutlineActsPreStep），
  // 不在此表中（它是"三幕剧本子组 + 人物小传/关键道具"的多层嵌套，而非单层 storyGroup）。
  vn_scenes:         { arrayPath: "scenes",      normalize: "vnLinear" },     // E1-03 场搭建
  vn_beats:          { arrayPath: "beats",       normalize: "vnLinear" },     // E1-04 情节点
  vn_branched_beats: { arrayPath: "beats",       normalize: "vnBranched" },   // G-01 剧情树改造
  vn_screenplay:     { arrayPath: "beats",       normalize: "vnTreeOverlay" },// G-02 剧本创作
  vn_storyboard:     { arrayPath: "storyboards", normalize: "vnTreeOverlay" },// G-03 分镜设计
};

function getByPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function plotToStoryNode(p: Record<string, unknown>): StoryNode {
  const se = p.story_elements as { plot?: { cause?: string } } | undefined;
  const cause = se?.plot?.cause ?? "";
  const content = String(p.content ?? "");
  const firstLine = content.split(/[。\n]/)[0]?.slice(0, 30) ?? "";
  return {
    node_id: String(p.node_id ?? ""),
    content_id: String(p.content_id ?? ""),
    name: cause || firstLine || String(p.node_id ?? ""),
    narrative_function: String(p.narrative_stage ?? ""),
    main_content: content.slice(0, 120),
    prev_node: (p.prev_node as string[]) ?? [],
    next_node: (p.next_node as string[]) ?? [],
    narrative_stage: String(p.narrative_stage ?? ""),
    // 最优路径标记要跟着转过来，否则情节层的主线高亮在这一步静默丢掉。
    on_optimal_path: p.on_optimal_path as boolean | undefined,
    _rawData: p,
  };
}

function questToStoryNode(q: Record<string, unknown>): StoryNode {
  const desc = String(q.description ?? "");
  const storyNodeId = String(q.story_node_id ?? "");
  return {
    node_id: storyNodeId,
    content_id: storyNodeId,
    name: String(q.name ?? q.quest_id ?? ""),
    narrative_function: String(q.type ?? ""),
    main_content: desc.slice(0, 120),
    prev_node: [],
    next_node: [],
    narrative_stage: String(q.framework_node ?? ""),
    _rawData: q,
  };
}

/* ───────────── branch_tree (VN / 互动影游) → StoryNode[] ─────────────
 *
 * 设计同 plot_generation：把每个 BranchTreeNode 转成 StoryNode 喂给
 * computeStoryLayout，复用 Detroit 风格的 DAG 布局算法。
 *
 * 字段映射：
 *   id             → node_id
 *   title          → name
 *   summary        → main_content
 *   scene_role     → narrative_function（opening/rising/turning/climax/ending）
 *   next[].to      → next_node[]
 *   反向遍历 next   → prev_node[]
 *   node_kind      → 决定 is_branch_point（qte_climax 节点视作分支点）
 *   next[].kind    → 决定 branch_letter（pass=P, fail=F, choice=A/B/C, auto=空）
 *
 * 老 entry 兼容：next[].kind / node_kind 缺省时按 next.length 推：
 *   - next.length > 1 → branch（依索引取 a/b/c）
 *   - next.length = 1 → auto（无 branch_letter）
 *   - next.length = 0 → ending leaf
 */
interface BranchTreeRawNode {
  id?: string;
  title?: string;
  summary?: string;
  scene_role?: string;
  node_kind?: "normal" | "qte_climax";
  next?: Array<{ to?: string; label?: string; kind?: "choice" | "auto" | "qte_pass" | "qte_fail" }>;
  act_id?: string;
}

function branchKindToLetter(kind: string | undefined, idx: number, total: number): string {
  if (kind === "qte_pass") return "P";
  if (kind === "qte_fail") return "F";
  if (kind === "auto") return "";
  if (total <= 1) return "";
  return String.fromCharCode(97 + Math.min(idx, 25)); // a/b/c…/z（极端情况兜底）
}

/* ── 展示侧结局兜底（镜像后端 graph-qa 的令牌启发式，纯前端、不改数据） ──
 * branch_tree 的 endings[] 经常是"独立结局目录"，没有任何 node.next 指向它们
 * （真正的结局场景是 N_*_PREP 这类死胡同叶子）。后端 graph-qa 上线后会按令牌
 * 把死胡同→孤儿结局连上；但历史记录 / 漏网产出里它们仍是孤儿，会被分层算法
 * 当成入度 0 的根甩到第 0 列（左下角结块），把整棵树拉歪。这里在渲染前用同一套
 * 令牌配对补边：后端已连好时是 no-op，否则恢复成 "*_PREP → ENDING_*" 的正常收束。
 */
const ENDING_TYPE_ALIASES: Record<string, string[]> = {
  GOOD: ["GOOD", "HE", "GE", "TE", "TRUE"],
  TRUE: ["TRUE", "TE"],
  HE: ["HE", "GOOD"],
  BAD: ["BAD", "BE"],
  BE: ["BE", "BAD"],
  NEUTRAL: ["NEUTRAL", "NE"],
  NE: ["NE", "NEUTRAL"],
  HIDDEN: ["HIDDEN", "SE"],
};

function endingTokens(id: string, type?: string): Set<string> {
  const set = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim().toUpperCase();
    if (t.length < 2) return;
    set.add(t);
    for (const a of ENDING_TYPE_ALIASES[t] ?? []) set.add(a);
  };
  for (const tok of id.split(/[^A-Za-z0-9]+/)) push(tok);
  if (type) push(type);
  return set;
}

function intersectSize(a: Set<string>, b: Set<string>): number {
  let c = 0;
  for (const x of a) if (b.has(x)) c++;
  return c;
}

function branchTreeToStoryNodes(raw: unknown): StoryNode[] {
  // 同时支持两种形式：① 直接传 nodes 数组（向后兼容）
  //                   ② 传整个 branch_tree 根对象 { nodes, endings, ... }（推荐，包含 endings 叶节点）
  let nodesInput: unknown[] = [];
  let endingsInput: unknown[] = [];
  if (Array.isArray(raw)) {
    nodesInput = raw;
  } else if (raw && typeof raw === "object") {
    const root = raw as Record<string, unknown>;
    if (Array.isArray(root.nodes)) nodesInput = root.nodes;
    if (Array.isArray(root.endings)) endingsInput = root.endings;
  } else {
    return [];
  }

  // endings[] 转换为 BranchTreeRawNode 形式（叶节点）— 让结局也能在剧情树里显示
  const endingTypeById = new Map<string, string | undefined>();
  const endingNodes: BranchTreeRawNode[] = endingsInput
    .filter((e): e is Record<string, unknown> =>
      !!e && typeof e === "object" && typeof (e as Record<string, unknown>).id === "string"
    )
    .map((e) => {
      const id = e.id as string;
      endingTypeById.set(id, e.type as string | undefined);
      return {
        id,
        title: (e.title as string | undefined) ?? id,
        summary: (e.trigger as string | undefined) ?? "",
        scene_role: "ending",
        node_kind: "normal" as const,
        next: [] as Array<{ to?: string }>,
      };
    });

  const rawNodes: BranchTreeRawNode[] = [
    ...nodesInput.filter((n): n is BranchTreeRawNode =>
      !!n && typeof n === "object" && typeof (n as BranchTreeRawNode).id === "string"
    ),
    ...endingNodes,
  ];
  if (rawNodes.length === 0) return [];
  const idSet = new Set(rawNodes.map((n) => n.id!));
  const nodeMap = new Map(rawNodes.map((n) => [n.id!, n]));

  // ── 渲染前：把"孤儿结局"接到令牌最匹配的死胡同叶子（详见 endingTokens 注释）──
  if (endingNodes.length > 0) {
    const endingIdSet = new Set(endingNodes.map((n) => n.id!));
    const incCount = new Map<string, number>();
    for (const n of rawNodes) {
      for (const b of n.next ?? []) {
        if (b?.to && idSet.has(b.to)) incCount.set(b.to, (incCount.get(b.to) ?? 0) + 1);
      }
    }
    const hasValidNext = (n: BranchTreeRawNode) =>
      (n.next ?? []).some((b) => b?.to && idSet.has(b.to));
    const orphanEndings = endingNodes.filter((e) => (incCount.get(e.id!) ?? 0) === 0);
    // 死胡同叶子：非结局目录项、且无有效出边（N_*_PREP、scene_role=ending 的终止场景等）
    const deadLeaves = rawNodes.filter((n) => !endingIdSet.has(n.id!) && !hasValidNext(n));
    const usedLeaves = new Set<string>();
    const wire = (leaf: BranchTreeRawNode, endingId: string) => {
      (leaf.next ??= []).push({ to: endingId });
      incCount.set(endingId, (incCount.get(endingId) ?? 0) + 1);
    };
    // ① 令牌唯一配对（N_TE_PREP → ENDING_TE）
    for (const ending of orphanEndings) {
      const eTok = endingTokens(ending.id!, endingTypeById.get(ending.id!));
      let best: BranchTreeRawNode | null = null;
      let bestScore = 0;
      for (const leaf of deadLeaves) {
        if (usedLeaves.has(leaf.id!)) continue;
        const score = intersectSize(endingTokens(leaf.id!, leaf.title), eTok);
        if (score > bestScore) { bestScore = score; best = leaf; }
      }
      if (best && bestScore > 0) { wire(best, ending.id!); usedLeaves.add(best.id!); }
    }
    // ② 仍孤儿的结局：挂到任一未占用的死胡同叶子（允许一叶多结局兜底），保证不漏在第 0 列
    let cursor = 0;
    for (const ending of orphanEndings) {
      if ((incCount.get(ending.id!) ?? 0) > 0) continue;
      let leaf = deadLeaves.find((l) => !usedLeaves.has(l.id!));
      if (!leaf && deadLeaves.length > 0) leaf = deadLeaves[cursor++ % deadLeaves.length];
      if (leaf) { wire(leaf, ending.id!); usedLeaves.add(leaf.id!); }
    }
  }

  // 构建邻接表（用于 prev / depth / layoutId 推算）
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of idSet) { outgoing.set(id, []); incoming.set(id, []); }
  for (const n of rawNodes) {
    for (const b of n.next ?? []) {
      const to = b?.to;
      if (!to || !idSet.has(to)) continue;
      outgoing.get(n.id!)!.push(to);
      incoming.get(to)!.push(n.id!);
    }
  }

  // ── 回边检测（迭代 DFS）——剧情回环/闪回（VN 的 merge_back、"绕回早先场景"等）会形成环。
  //    Kahn 拓扑分层不容环：环内节点入度永远减不到 0 → 判定"不可达" → 被下方兜底逻辑全堆到最后一列。
  //    解法：找出指向"当前递归栈上节点"的回边，分层时只用「正向边」算 depth/列号；
  //    回边本身仍保留在 next/prev 里（照常渲染成一条往回指的连线），不丢任何拓扑信息。
  const backEdges = new Set<string>(); // "u->v"
  {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>([...idSet].map((id) => [id, WHITE]));
    // 优先从天然根（入度 0）出发，再兜底扫剩余节点（纯环子图无入度 0 节点时）。
    const startOrder = [
      ...[...idSet].filter((id) => (incoming.get(id)?.length ?? 0) === 0),
      ...idSet,
    ];
    for (const start of startOrder) {
      if (color.get(start) !== WHITE) continue;
      const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
      color.set(start, GRAY);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const nexts = outgoing.get(top.id) ?? [];
        if (top.i < nexts.length) {
          const v = nexts[top.i++];
          const c = color.get(v);
          if (c === GRAY) backEdges.add(`${top.id}->${v}`);              // 回边（指向栈上节点）
          else if (c === WHITE) { color.set(v, GRAY); stack.push({ id: v, i: 0 }); }
        } else {
          color.set(top.id, BLACK);
          stack.pop();
        }
      }
    }
  }

  // 正向边图（剔除回边）——仅用于分层，保证每个节点都拿到合理列号。
  const fwdOut = new Map<string, string[]>();
  const fwdInDeg = new Map<string, number>();
  for (const id of idSet) { fwdOut.set(id, []); fwdInDeg.set(id, 0); }
  for (const [u, vs] of outgoing) {
    for (const v of vs) {
      if (backEdges.has(`${u}->${v}`)) continue;
      fwdOut.get(u)!.push(v);
      fwdInDeg.set(v, (fwdInDeg.get(v) ?? 0) + 1);
    }
  }

  // ── 拓扑深度（BFS wave，基于正向边）—— layoutId 列号的来源
  const depth = new Map<string, number>();
  const inDeg = new Map<string, number>(fwdInDeg);
  let queue = [...idSet].filter((id) => (inDeg.get(id) ?? 0) === 0);
  let d = 0;
  while (queue.length) {
    const wave: string[] = [];
    for (const id of queue) if (!depth.has(id)) { depth.set(id, d); wave.push(id); }
    const nextWave: string[] = [];
    for (const id of wave) {
      for (const c of fwdOut.get(id) ?? []) {
        if (depth.has(c)) continue;
        const nd = (inDeg.get(c) ?? 0) - 1;
        inDeg.set(c, nd);
        if (nd <= 0) nextWave.push(c);
      }
    }
    queue = nextWave;
    d++;
  }
  // 兜底：剔除回边后理论上全可达；万一仍有遗漏（多重交叉环），放到最深一层 + 1。
  const maxDepth = depth.size > 0 ? Math.max(...depth.values()) : 0;
  for (const id of idSet) if (!depth.has(id)) depth.set(id, maxDepth + 1);

  // ── 同 depth 节点按"主父 id + 在父 next 中的索引"稳定排序，赋 a/b/c 字母后缀
  // 单节点 wave 给纯数字（"1"/"5"），多节点 wave 全部带字母后缀（"3a"/"3b"/"3c"）。
  // 这就是 Detroit 风格 layoutId，专给 parseNodeIdForPosition 解析用。
  const layoutId = new Map<string, string>();
  const byDepth = new Map<number, string[]>();
  for (const id of idSet) {
    const k = depth.get(id)!;
    if (!byDepth.has(k)) byDepth.set(k, []);
    byDepth.get(k)!.push(id);
  }
  for (const [k, ids] of byDepth) {
    const colNum = k + 1;
    if (ids.length === 1) {
      layoutId.set(ids[0], `${colNum}`);
      continue;
    }
    const sorted = [...ids].sort((a, b) => {
      const pa = (incoming.get(a) ?? [])[0] ?? "";
      const pb = (incoming.get(b) ?? [])[0] ?? "";
      if (pa !== pb) return pa.localeCompare(pb);
      const sib = outgoing.get(pa) ?? [];
      return sib.indexOf(a) - sib.indexOf(b);
    });
    sorted.forEach((id, idx) => {
      layoutId.set(id, `${colNum}${String.fromCharCode(97 + Math.min(idx, 25))}`);
    });
  }

  // 反向构建 prev_node
  const prevMap = new Map<string, string[]>();
  for (const id of idSet) prevMap.set(id, incoming.get(id) ?? []);

  /**
   * 推算"该节点作为某条分支的标签字母"。
   * 与 plot_generation / story_framework 的 branch_letter 语义对齐：
   *   - 沿父节点 next[] 中的索引 + kind 推断
   *   - 多 parent (merge node) 没有意义 → undefined
   *   - 单 parent 但父只有 1 个 next（自动衔接）→ undefined
   *   - 父是 fork：依索引 + kind 给 P/F (qte) 或 a/b/c (choice)
   */
  const inferBranchLetter = (childId: string, parents: string[]): string | undefined => {
    if (parents.length !== 1) return undefined;
    const parent = nodeMap.get(parents[0]);
    if (!parent || !Array.isArray(parent.next)) return undefined;
    const validParentNext = parent.next.filter((b) => b?.to && idSet.has(b.to));
    if (validParentNext.length <= 1) return undefined;
    const idx = validParentNext.findIndex((b) => b.to === childId);
    if (idx < 0) return undefined;
    const kind = validParentNext[idx]?.kind;
    return branchKindToLetter(kind, idx, validParentNext.length);
  };

  return rawNodes.map((n) => {
    const validNext = (n.next ?? []).filter((b) => b?.to && idSet.has(b.to));
    const next_node = validNext.map((b) => b.to!);
    const prev_node = prevMap.get(n.id!) ?? [];
    const isBranch = next_node.length > 1;
    const isMerge = prev_node.length > 1;
    const isBranchPoint = isBranch || n.node_kind === "qte_climax";
    const branchLetter = inferBranchLetter(n.id!, prev_node);

    return {
      node_id: n.id!,
      content_id: n.id!,
      _layoutId: layoutId.get(n.id!), // ★ Detroit 风格 layoutId（"1"/"2a"/"3"），仅供 layout 解析
      name: n.title ?? n.id!,
      narrative_function: n.scene_role ?? n.act_id ?? "",
      main_content: n.summary ?? "",
      narrative_stage: n.scene_role,
      is_branch: isBranch,
      is_branch_point: isBranchPoint,
      is_merge_point: isMerge,
      branch_letter: branchLetter,
      prev_node,
      next_node,
      _rawData: n as unknown as Record<string, unknown>,
    };
  });
}

/**
 * branchTreeOverlay：复用 branch_tree 拓扑 + 用本 step 的内容覆盖 main_content / name。
 *
 * 设计动机：dialogue_script 和 cinematic_storyboard 没有自己的 prev/next 拓扑，
 * 它们的"剧情树"完全是 branch_tree 的影子（按相同 node_id 挂载内容）。
 * 用户在节点模式画布上看到的不应该是"另一棵树"，而是"同一棵树的不同视图"。
 *
 * - dialogue_script：节点显示 scene + 前两行台词（"speaker: text / speaker: text"）
 * - cinematic_storyboard：节点显示镜头数 + 是否含 QTE + scene_prompt 摘要
 * - 缺该节点内容（LLM 没产出）→ 节点空显示"(无内容)"，不破坏拓扑
 */
/** 把双语对象 / string / 任意值统一抽成中文文本（fallback 英文 / JSON），用于节点摘要展示。 */
function pickZhText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.zh === "string") return obj.zh;
    if (typeof obj.en === "string") return obj.en;
    if (typeof obj.cn === "string") return obj.cn;
  }
  return String(v);
}

function overlayStepContent(
  baseNodes: StoryNode[],
  stepId: string,
  fieldData: unknown,
): StoryNode[] {
  const data = fieldData as Record<string, unknown>;

  if (stepId === "dialogue_script") {
    const scripts = (Array.isArray(data.scripts) ? data.scripts : []) as Array<{
      node_id?: string;
      title?: unknown;
      scene?: unknown;
      lines?: Array<{ speaker?: unknown; text?: unknown }>;
    }>;
    const map = new Map(scripts.filter((s) => s.node_id).map((s) => [s.node_id!, s]));
    return baseNodes.map((n) => {
      const d = map.get(n.node_id);
      if (!d) {
        return { ...n, main_content: "(对话未生成)", _rawData: { node_id: n.node_id } as Record<string, unknown> };
      }
      const linesBrief = (d.lines ?? [])
        .slice(0, 2)
        .map((l) => `${pickZhText(l.speaker)}: ${pickZhText(l.text)}`)
        .join(" / ");
      const scene = pickZhText(d.scene).slice(0, 60);
      const titleZh = pickZhText(d.title);
      return {
        ...n,
        name: titleZh || n.name,
        main_content: [scene, linesBrief].filter(Boolean).join("\n").slice(0, 160),
        _rawData: d as unknown as Record<string, unknown>,
      };
    });
  }

  if (stepId === "cinematic_storyboard") {
    const sbs = (Array.isArray(data.storyboards) ? data.storyboards : []) as Array<{
      node_id?: string;
      scene_prompt?: unknown;
      shots?: Array<{ qte?: unknown }>;
    }>;
    const map = new Map(sbs.filter((s) => s.node_id).map((s) => [s.node_id!, s]));
    return baseNodes.map((n) => {
      const sb = map.get(n.node_id);
      if (!sb) {
        return { ...n, main_content: "(分镜未生成)", _rawData: { node_id: n.node_id } as Record<string, unknown> };
      }
      const shotCount = sb.shots?.length ?? 0;
      const hasQTE = (sb.shots ?? []).some((s) => s.qte != null);
      // scene_prompt 实际是 { zh, en } 双语 object（不是 string），必须先抽中文
      const scene = pickZhText(sb.scene_prompt).slice(0, 80);
      const tag = `${shotCount} 镜头${hasQTE ? " · 🎯 QTE" : ""}`;
      return {
        ...n,
        // 让节点上能直接显示"🎯 QTE"标记 — 解决"画布上看不到 QTE"问题
        name: hasQTE ? `🎯 ${n.name ?? n.node_id}` : n.name,
        main_content: `${tag}\n${scene}`.slice(0, 160),
        _rawData: sb as unknown as Record<string, unknown>,
      };
    });
  }

  return baseNodes;
}

// ── 互动影游 v2 normalizers ──────────────────────────────────────────────────

/**
 * 情节点(beat)没有独立的 title 字段——后端只产 beat_id + content。直接拿 beat_id
 * 当标题会显示成一串编号(12.1/16.2…)，这里从正文首句派生一个简短标题，与 RPG
 * plotToStoryNode 的 `cause || firstLine` 兜底同理。节点编号仍在卡片头部(nodeId)
 * 展示，不丢失。.rf-child-name 有 2 行夹断，故给到 ~28 字交给 CSS 收尾。
 */
function deriveBeatTitle(content: string, fallbackId: string): string {
  const text = (content ?? "").trim();
  if (!text) return fallbackId;
  const first = text.split(/[。！？!?\n;；]/)[0]?.trim() ?? "";
  const base = first || text;
  const MAX = 28;
  return base.length > MAX ? `${base.slice(0, MAX)}…` : base;
}

/**
 * vnLinear：把"场 / 情节点"这类线性序列摆成一条横向链。
 * 顺序即叙事顺序，逐个 prev/next 衔接，并写 _layoutId="1","2",... 保证列号干净递增。
 */
function vnLinearToStoryNodes(stepId: string, arr: Record<string, unknown>[]): StoryNode[] {
  const idOf = (item: Record<string, unknown>, i: number): string => {
    if (stepId === "vn_scenes") return String(item.scene_id ?? `s${i + 1}`);
    return String(item.beat_id ?? `b${i + 1}`);
  };
  const ids = arr.map((item, i) => idOf(item, i));
  return arr.map((item, i) => {
    const isScene = stepId === "vn_scenes";
    const name = isScene
      ? `场${item.scene_id ?? i + 1}${item.location_name ? ` · ${pickZhText(item.location_name)}` : ""}`
      : pickZhText(item.title) || deriveBeatTitle(pickZhText(item.content ?? item.summary), String(item.beat_id ?? `b${i + 1}`));
    const fn = isScene
      ? [item.act_id ? `第${item.act_id}幕` : "", pickZhText(item.time_of_day), pickZhText(item.indoor_outdoor)]
          .filter(Boolean).join(" · ")
      : item.scene_id != null ? `场${item.scene_id}` : "";
    return {
      node_id: ids[i],
      content_id: ids[i],
      _layoutId: String(i + 1),
      name,
      narrative_function: fn,
      main_content: pickZhText(item.content ?? item.summary ?? item.description).slice(0, 140),
      prev_node: i > 0 ? [ids[i - 1]] : [],
      next_node: i < arr.length - 1 ? [ids[i + 1]] : [],
      _rawData: item,
    };
  });
}

/**
 * vnBranched：G-01 剧情树改造（vn_branched_beats）→ 真分支 DAG。
 * beats 自带 prev_nodes / next_nodes 拓扑（next_nodes 是 {to,kind,label}），外加 endings。
 * 复用 branchTreeToStoryNodes 的 BFS 深度 → _layoutId 算法，与 RPG 剧情树同款布局。
 */
function vnBranchedToStoryNodes(data: unknown): StoryNode[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const beats = (Array.isArray(d.beats) ? d.beats : []) as Record<string, unknown>[];
  const endings = (Array.isArray(d.endings) ? d.endings : []) as Record<string, unknown>[];
  if (beats.length === 0) return [];

  // vn 的 edge.kind（linear/choice/branch_qte/merge_back）→ branch_tree 的 kind（auto/choice/...）
  const kindMap: Record<string, string> = {
    linear: "auto",
    merge_back: "auto",
    choice: "choice",
    branch_qte: "choice",
  };

  // ── 撞号消歧 + 边一致性修复（仅影游剧情树）──────────────────────────────
  // 根因：后端跨幕/支线生成偶发让两个**内容全然不同**的 beat 共用同一 beat_id
  //   （如两个"6.1"：一个 prev=[2.2]，一个 prev=[5.1,5.2]）。前端若按 beat_id 合并，
  //   该节点会同时背两组 prev/next → 被误判成"既聚合又分支"的怪点 → 整条主轴被
  //   折叠成假图、连线歪扭。修复分两步：
  //   ① 撞号消歧：给每个撞号 occurrence 分配唯一 uid（"6.1" / "6.1#1"），并用
  //      prev/next 上下文把边重接到正确 occurrence（父子互为反向引用即可判定）。
  //   ② 边一致性：候选边 = next ∪ (prev 反转)，仅去精确自环。后端已按"是否成环"
  //      + graph-qa 双重对账，前端不再二次裁剪（详见下方注释）。
  // 显示标题取自内容（deriveBeatTitle），故 uid 后缀不外露。
  // ⚠ 无撞号的正常产出下，本段（消歧 + 去自环）为恒等变换（no-op）。
  const beatIdSet = new Set(beats.map((b) => String(b.beat_id ?? "")).filter(Boolean));
  const occCount = new Map<string, number>();
  for (const id of beats.map((b) => String(b.beat_id ?? ""))) {
    if (id) occCount.set(id, (occCount.get(id) ?? 0) + 1);
  }
  const occSeen = new Map<string, number>();
  const uids = beats.map((b) => {
    const id = String(b.beat_id ?? "");
    if (!id) return "";
    if ((occCount.get(id) ?? 0) <= 1) return id;
    const n = occSeen.get(id) ?? 0;
    occSeen.set(id, n + 1);
    return n === 0 ? id : `${id}#${n}`; // 首个保留原 id，其余加后缀
  });
  const origIdOf = (uid: string) => uid.split("#")[0];
  const prevsOf = (b: Record<string, unknown>) =>
    (Array.isArray(b.prev_nodes) ? b.prev_nodes : []).map((p) => String(p)).filter(Boolean);
  const nextTosOf = (b: Record<string, unknown>) =>
    (Array.isArray(b.next_nodes) ? b.next_nodes : [])
      .map((e) => String((e as Record<string, unknown>)?.to ?? "")).filter(Boolean);
  const occList = new Map<string, Array<{ b: Record<string, unknown>; uid: string }>>();
  beats.forEach((b, i) => {
    const id = String(b.beat_id ?? "");
    if (!id) return;
    if (!occList.has(id)) occList.set(id, []);
    occList.get(id)!.push({ b, uid: uids[i] });
  });
  // 源 occurrence → 目标原始 id：选 prev 含源 beat_id 的那个目标 occurrence
  const resolveChild = (sBeatId: string, tid: string): string => {
    const os = occList.get(tid);
    if (!os || os.length === 0) return tid; // 非 beat（ending）
    if (os.length === 1) return os[0].uid;
    return (os.find((o) => prevsOf(o.b).includes(sBeatId)) ?? os[0]).uid;
  };
  // 父原始 id → 子 occurrence：选 next 含子 beat_id 的那个父 occurrence
  const resolveParent = (pid: string, cBeatId: string) => {
    const os = occList.get(pid);
    if (!os || os.length === 0) return undefined;
    if (os.length === 1) return os[0];
    return os.find((o) => nextTosOf(o.b).includes(cBeatId)) ?? os[0];
  };
  const origEdgeMeta = new Map<string, Map<string, Record<string, unknown>>>();
  const candidates = new Map<string, Set<string>>();
  const addCandidate = (from: string, to: string, meta?: Record<string, unknown>) => {
    if (!from || !to) return;
    if (!candidates.has(from)) candidates.set(from, new Set());
    candidates.get(from)!.add(to);
    if (meta) {
      if (!origEdgeMeta.has(from)) origEdgeMeta.set(from, new Map());
      if (!origEdgeMeta.get(from)!.has(to)) origEdgeMeta.get(from)!.set(to, meta);
    }
  };
  beats.forEach((b, i) => {
    const su = uids[i];
    const sBeatId = String(b.beat_id ?? "");
    if (!su) return;
    for (const e of (Array.isArray(b.next_nodes) ? b.next_nodes : []) as Array<Record<string, unknown>>) {
      const to = e?.to ? String(e.to) : "";
      if (!to) continue;
      addCandidate(su, beatIdSet.has(to) ? resolveChild(sBeatId, to) : to, e);
    }
    for (const p of prevsOf(b)) {
      if (!beatIdSet.has(p)) continue;
      const pOcc = resolveParent(p, sBeatId);
      if (!pOcc) continue;
      const meta = (Array.isArray(pOcc.b.next_nodes) ? pOcc.b.next_nodes : [])
        .find((e) => String((e as Record<string, unknown>)?.to ?? "") === sBeatId) as Record<string, unknown> | undefined;
      addCandidate(pOcc.uid, su, meta); // prev 反转：父 → 我
    }
  });
  const fixedNext = new Map<string, Array<Record<string, unknown>>>();
  for (const u of uids) if (u) fixedNext.set(u, []);
  for (const [from, tos] of candidates) {
    for (const to of tos) {
      const meta = origEdgeMeta.get(from)?.get(to);
      // ⚠ 不再按「场.序」二次裁剪回跳边。后端 reconcileBeatEdges + graph-qa 已是边对账权威：
      //   · 真·乱连回跳（成环边）早被后端 DFS 回边检测剔除（与本文件下游 DFS 同源）；
      //   · graph-qa 把 LLM 漏接的死胡同重连到正确去向（如支线"挣扎回归主线" 10.3→6.1、
      //     拒绝分支汇回 1.3→1.2）——这类边**场号大、数值上像回跳，但叙事前向、且不构成环**。
      //   旧逻辑用 orderOf 在前端再裁一刀，恰好把这些 QA 修复边误删 → 支线变死胡同、节点被甩到
      //   末列结块（正是本次显示问题的根因）。真正的环（merge_back / 残留乱连）由下游 DFS 回边
      //   检测处理（渲染成回指连线、不参与分层），不依赖此处启发式。这里仅去掉精确自环。
      if (to === from) continue;
      // ★ to 必须用解析后的 uid（消歧目标），而非 meta.to（原始未消歧 beat_id）。
      // prev 反转建边时 meta 取自父节点的 next_nodes，其 to 仍是撞号原始 id（如 "5.1"），
      // 直接 push meta 会让边指回首个 occurrence，令 5.1#1 / 5.2#1 永远拿不到入边 → 孤儿。
      fixedNext.get(from)!.push(meta ? { ...meta, to } : { to, kind: "linear" });
    }
  }

  const treeNodes = beats.map((b, i) => {
    const uid = uids[i];
    const pivot = b.pivot_kind ? String(b.pivot_kind) : "";
    const summary = pickZhText(b.content ?? b.summary);
    return {
      id: uid,
      // 后端产出真标题时直接用；旧数据无 title 时回落到正文首句派生。
      title: pickZhText(b.title) || deriveBeatTitle(summary, origIdOf(uid)),
      summary,
      scene_role: b.is_ending ? "ending" : pivot,
      node_kind: pivot === "branch_qte" ? "qte_climax" : "normal",
      next: (fixedNext.get(uid) ?? []).map((e) => ({
        to: e.to ? String(e.to) : undefined,
        label: e.label != null ? pickZhText(e.label) : undefined,
        kind: kindMap[String(e.kind ?? "linear")] ?? "auto",
      })),
    };
  });

  // scope=local 是中段结局（提前 game over / 提前圆满），用 ⚑ 标记以区别于剧终大结局 🏁。
  // 中段结局的列位由其前驱 beat 的 rank 决定，故天然落在剧情树中段而非最右列。
  const treeEndings = endings.map((e) => {
    const isLocal = String(e.scope ?? "global") === "local";
    return {
      id: String(e.ending_id ?? ""),
      title: `${isLocal ? "⚑" : "🏁"} ${pickZhText(e.title ?? e.ending_id)}`,
      trigger: pickZhText(e.trigger ?? e.content),
    };
  });

  return branchTreeToStoryNodes({ nodes: treeNodes, endings: treeEndings } as unknown);
}

/**
 * overlayVnStepContent：G-02 剧本 / G-03 分镜复用 G-01 剧情树拓扑，按 beat_id 覆盖内容。
 * 设计同 overlayStepContent（dialogue/storyboard）：用户看到的是"同一棵树的不同视图"。
 */
function overlayVnStepContent(baseNodes: StoryNode[], stepId: string, fieldData: unknown): StoryNode[] {
  const data = (fieldData ?? {}) as Record<string, unknown>;

  if (stepId === "vn_screenplay") {
    const beats = (Array.isArray(data.beats) ? data.beats : []) as Array<Record<string, unknown>>;
    const map = new Map(beats.filter((b) => b.beat_id).map((b) => [String(b.beat_id), b]));
    return baseNodes.map((n) => {
      const beatKey = n.node_id.split("#")[0]; // 消歧 uid（"6.1#1"）→ 原始 beat_id
      const d = map.get(beatKey);
      if (!d) return { ...n, main_content: "(剧本未生成)", _rawData: { beat_id: beatKey } };
      const dialogue = (Array.isArray(d.dialogue) ? d.dialogue : []) as Array<Record<string, unknown>>;
      const lineCount = dialogue.length;
      const firstLines = dialogue.slice(0, 2)
        .map((l) => `${pickZhText(l.character ?? l.speaker)}: ${pickZhText(l.line ?? l.text)}`)
        .join(" / ");
      const desc = pickZhText(d.description ?? d.scene_description).slice(0, 60);
      const tag = lineCount > 0 ? `${lineCount} 句台词` : "(无台词)";
      return {
        ...n,
        main_content: [desc, `${tag}`, firstLines].filter(Boolean).join("\n").slice(0, 180),
        _rawData: d,
      };
    });
  }

  if (stepId === "vn_storyboard") {
    const sbs = (Array.isArray(data.storyboards) ? data.storyboards : []) as Array<Record<string, unknown>>;
    const map = new Map(sbs.filter((s) => s.beat_id).map((s) => [String(s.beat_id), s]));
    return baseNodes.map((n) => {
      const beatKey = n.node_id.split("#")[0]; // 消歧 uid（"6.1#1"）→ 原始 beat_id
      const sb = map.get(beatKey);
      if (!sb) return { ...n, main_content: "(分镜未生成)", _rawData: { beat_id: beatKey } };
      const shots = (Array.isArray(sb.shots) ? sb.shots : []) as Array<Record<string, unknown>>;
      const hasQTE = shots.some((s) => s.qte != null);
      const scene = pickZhText(sb.scene_prompt ?? sb.scene_description).slice(0, 80);
      const tag = `${shots.length} 镜头${hasQTE ? " · 🎯 QTE" : ""}`;
      return {
        ...n,
        name: hasQTE ? `🎯 ${n.name ?? n.node_id}` : n.name,
        main_content: `${tag}\n${scene}`.slice(0, 180),
        _rawData: sb,
      };
    });
  }

  return baseNodes;
}

function chapterToStoryNode(ch: Record<string, unknown>): StoryNode {
  const scenes = Array.isArray(ch.scenes) ? ch.scenes : [];
  const nodeId = String(ch.node_id ?? ch.plot_node_id ?? "");
  return {
    node_id: nodeId,
    content_id: String(ch.chapter_id ?? ch.content_id ?? ""),
    name: String(ch.title ?? ""),
    narrative_function: String(ch.chapter_type ?? ""),
    main_content: `${scenes.length} 场景`,
    prev_node: (ch.prev_node as string[]) ?? [],
    next_node: (ch.next_node as string[]) ?? [],
    is_branch: ch.is_branch as boolean | undefined,
    narrative_stage: ch.narrative_stage as string | undefined,
    _rawData: ch,
  };
}

function sceneLevel(s: SceneNode): number {
  return s.scene_level ?? s.level ?? 0;
}

function sceneGroupSummary(grp: SceneNode[]): { topName: string; summary: string } {
  const topScene = grp.reduce((best, s) => (sceneLevel(s) < sceneLevel(best) ? s : best), grp[0]);
  const l3 = grp.filter((s) => sceneLevel(s) === 3).length;
  const l4 = grp.filter((s) => sceneLevel(s) === 4).length;
  const l5 = grp.filter((s) => sceneLevel(s) === 5).length;
  const parts = [l3 && `地标×${l3}`, l4 && `房间×${l4}`, l5 && `物品×${l5}`].filter(Boolean);
  return {
    topName: topScene?.name ?? grp[0]?.parent ?? "",
    summary: `${grp.length} 场景` + (parts.length ? ` (${parts.join(" ")})` : ""),
  };
}

function sceneGroupToStoryNodes(
  p2Data: Record<string, SceneNode[]>,
  plots: PlotLike[],
): StoryNode[] {
  const plotMap = new Map(plots.map((p) => [p.node_id, p]));
  return Object.entries(p2Data).map(([plotId, grp]) => {
    const plot = plotMap.get(plotId);
    const { topName, summary } = sceneGroupSummary(grp);
    return {
      node_id: plotId,
      content_id: grp[0]?.uid ?? "",
      name: topName || plotId,
      narrative_function: "场景展开",
      main_content: summary,
      prev_node: plot?.prev_node ?? [],
      next_node: plot?.next_node ?? [],
      is_branch: (plot?.prev_node?.length ?? 0) > 1 || (plot?.next_node?.length ?? 0) > 1,
      narrative_stage: plot?.narrative_stage,
      _rawData: { plot_id: plotId, scenes: grp } as Record<string, unknown>,
    };
  });
}

/**
 * 场景树（uid / parent_uid 的层级结构）→ 剧情节点。
 *
 * 这是场景列表助手当前的产物形态：一棵从世界到房间的场景树，父子就是包含关系。
 * 拓扑照搬 parent_uid：世界在最左，房间在最右。
 *
 * _layoutId 写成「深度 + 兄弟序字母」（如 3c）而不是 uid：列是按"不同 xKey 的排序序号"
 * 分配的，uid 每个都不同就会一个节点占一列——15 个场景摊成 15 列的对角阶梯，同一层
 * 的四个孩子分散在四列上。同深度共用一个 xKey，画出来才是"世界 | 城区 | 建筑 | 房间"
 * 这样按层分列的树。字母只用于同层内的稳定排序（超过 26 个就不给字母，退回插入序）。
 */
function sceneTreeToStoryNodes(scenes: SceneNode[]): StoryNode[] {
  const known = new Set(scenes.map((s) => String(s.uid)));
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const s of scenes) {
    const parent = s.parent_uid == null ? "" : String(s.parent_uid);
    if (!parent || !known.has(parent)) continue;
    parentOf.set(String(s.uid), parent);
    const list = childrenOf.get(parent);
    if (list) list.push(String(s.uid));
    else childrenOf.set(parent, [String(s.uid)]);
  }

  // 深度以 parent_uid 链为准：scene_level 是后端顺手带的，缺了或对不上时不能作为唯一依据。
  const depthOf = (uid: string): number => {
    let depth = 0;
    let cur = parentOf.get(uid);
    while (cur && depth < 64) {
      depth++;
      cur = parentOf.get(cur);
    }
    return depth;
  };
  const byDepth = new Map<number, string[]>();
  for (const s of scenes) {
    const uid = String(s.uid);
    const d = depthOf(uid);
    const list = byDepth.get(d);
    if (list) list.push(uid);
    else byDepth.set(d, [uid]);
  }
  const layoutIdOfUid = new Map<string, string>();
  for (const [depth, uids] of byDepth) {
    const ordered = [...uids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = 0; i < ordered.length; i++) {
      const letter = ordered.length <= 26 ? String.fromCharCode(97 + i) : "";
      layoutIdOfUid.set(ordered[i], `${depth}${letter}`);
    }
  }

  const textOf = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const d = value as Record<string, unknown>;
      const first = d.location_description ?? d.semantics_description ?? d.art_style_description;
      if (typeof first === "string") return first;
    }
    return "";
  };

  return scenes.map((s) => {
    const uid = String(s.uid);
    const parent = s.parent_uid == null ? "" : String(s.parent_uid);
    const labels = Array.isArray(s.label) ? s.label.map(String) : s.label ? [String(s.label)] : [];
    return {
      node_id: uid,
      content_id: uid,
      _layoutId: layoutIdOfUid.get(uid) ?? uid,
      name: s.name,
      narrative_function: labels.join(" · ") || `L${s.scene_level ?? s.level ?? 0}`,
      main_content: textOf(s.description).slice(0, 140),
      prev_node: parent && known.has(parent) ? [parent] : [],
      next_node: childrenOf.get(uid) ?? [],
      // 一个场景装着几个子场景是包含关系，不是剧情分叉：这两项若留空，卡面会按
      // 兄弟序字母盖 ⑂A、按子场景数量盖 ⑂，把"里面有四个地方"读成"这里有四条路"。
      is_branch: false,
      is_fork: false,
      _rawData: s as unknown as Record<string, unknown>,
    };
  });
}

function sceneFallbackFromMerged(
  scenes: SceneNode[],
  plots: PlotLike[],
): StoryNode[] {
  const plotMap = new Map(plots.map((p) => [p.node_id, p]));
  const groups = new Map<string, SceneNode[]>();
  for (const s of scenes) {
    for (const unit of s.story_units ?? []) {
      if (!groups.has(unit)) groups.set(unit, []);
      groups.get(unit)!.push(s);
    }
  }
  return Array.from(groups.entries()).map(([plotId, grp]) => {
    const plot = plotMap.get(plotId);
    const { topName, summary } = sceneGroupSummary(grp);
    return {
      node_id: plotId,
      content_id: grp[0]?.uid ?? "",
      name: topName || plotId,
      narrative_function: "场景展开",
      main_content: summary,
      prev_node: plot?.prev_node ?? [],
      next_node: plot?.next_node ?? [],
      is_branch: (plot?.prev_node?.length ?? 0) > 1 || (plot?.next_node?.length ?? 0) > 1,
      narrative_stage: plot?.narrative_stage,
      _rawData: { plot_id: plotId, scenes: grp } as Record<string, unknown>,
    };
  });
}

/**
 * Build quest StoryNodes that mirror the plot DAG structure.
 *
 * Quests are derived from plot nodes, so their tree structure should be
 * identical to the plot tree. We use `story_node_id` (= plot `node_id`)
 * as the quest node's `node_id`, and derive all connections from the plot DAG.
 *
 * For plots that generate multiple quests, we merge them into a single
 * representative node (showing all quest names), keeping the 1:1 mapping
 * with the plot DAG.
 */
function buildQuestNodesFromPlotDAG(
  rawQuests: Record<string, unknown>[],
  plots: PlotLike[],
): StoryNode[] {
  // Group quests by story_node_id (= source plot node_id)
  const plotToQuests = new Map<string, Record<string, unknown>[]>();
  for (const q of rawQuests) {
    const plotId = String(q.story_node_id ?? "");
    if (!plotId) continue;
    const group = plotToQuests.get(plotId) ?? [];
    group.push(q);
    plotToQuests.set(plotId, group);
  }

  // Build a plot DAG lookup
  const plotMap = new Map(plots.map((p) => [p.node_id, p]));

  const nodes: StoryNode[] = [];

  for (const [plotId, quests] of plotToQuests) {
    const plot = plotMap.get(plotId);

    // Derive prev_node / next_node from the plot DAG,
    // but only include connections to plots that actually have quests
    const prevNode = (plot?.prev_node ?? []).filter((id) => plotToQuests.has(id));
    const nextNode = (plot?.next_node ?? []).filter((id) => plotToQuests.has(id));

    // Merge quest info for the node display
    const primaryQuest = quests[0];
    const allNames = quests.map((q) => String(q.name ?? "")).filter(Boolean);
    const desc = quests.map((q) => String(q.description ?? "").slice(0, 60)).join(" | ");

    nodes.push({
      node_id: plotId,
      content_id: plotId,
      name: allNames.length <= 1 ? allNames[0] ?? "" : allNames.join(" / "),
      narrative_function: String(primaryQuest.type ?? ""),
      main_content: desc.slice(0, 120),
      prev_node: prevNode,
      next_node: nextNode,
      narrative_stage: String(primaryQuest.framework_node ?? ""),
      _rawData: quests.length === 1
        ? primaryQuest
        : { _merged: true, quests, quest_count: quests.length } as unknown as Record<string, unknown>,
    });
  }

  return nodes;
}

function toStoryNodes(
  stepId: string,
  fieldData: unknown,
  plots?: PlotLike[],
  result?: NarrativeContext | null,
): StoryNode[] {
  const config = STEP_STORY_EXTRACT[stepId];
  if (!config || !fieldData || typeof fieldData !== "object") return [];

  if (config.normalize === "sceneGroup") {
    const d = fieldData as Record<string, unknown>;
    const p2 = d._phase2_per_node as Record<string, SceneNode[]> | undefined;
    if (p2 && typeof p2 === "object" && Object.keys(p2).length > 0) {
      return sceneGroupToStoryNodes(p2, plots ?? []);
    }
    const scenes = d.scenes as SceneNode[] | undefined;
    if (Array.isArray(scenes) && scenes.length > 0) {
      // story_units 是"场景按剧情节点展开"那一版的产物；场景列表助手（2.3.6）现在直接
      // 给一棵 uid/parent_uid 的场景树，没有 story_units。认树优先，别把真产物当没有。
      if (scenes.some((s) => (s.story_units?.length ?? 0) > 0)) {
        return sceneFallbackFromMerged(scenes, plots ?? []);
      }
      return sceneTreeToStoryNodes(scenes);
    }
    return [];
  }

  // branchTree 需要同时读 nodes[] 和 endings[]，所以传整个根对象
  if (config.normalize === "branchTree") {
    return branchTreeToStoryNodes(fieldData);
  }

  // branchTreeOverlay (dialogue_script / cinematic_storyboard)：复用 branch_tree 拓扑 +
  // 用本 step 的内容覆盖每节点 main_content / name / _rawData。
  // - 拓扑来源：result.branch_tree（既有 nodes[] 也有 endings[]）
  // - 内容来源：fieldData.scripts[].node_id / fieldData.storyboards[].node_id
  // 缺 branch_tree 时退化为空（前端会显示"先生成剧情树"提示），不会乱画。
  if (config.normalize === "branchTreeOverlay") {
    const tree = result?.branch_tree;
    if (!tree) return [];
    const baseNodes = branchTreeToStoryNodes(tree);
    return overlayStepContent(baseNodes, stepId, fieldData);
  }

  // 互动影游 v2：G-01 剧情树（自带 beats prev/next + endings，传整个根对象）
  if (config.normalize === "vnBranched") {
    return vnBranchedToStoryNodes(fieldData);
  }

  // 互动影游 v2：剧本 / 分镜复用 G-01（vn_branched_beats）拓扑，按 beat_id 覆盖内容。
  // 缺 vn_branched_beats 时退化为空（前端提示先生成剧情树），不会乱画。
  if (config.normalize === "vnTreeOverlay") {
    const tree = (result as Record<string, unknown> | null | undefined)?.vn_branched_beats;
    if (!tree) return [];
    const baseNodes = vnBranchedToStoryNodes(tree);
    return overlayVnStepContent(baseNodes, stepId, fieldData);
  }

  const raw = getByPath(fieldData, config.arrayPath);
  if (!Array.isArray(raw) || raw.length === 0) {
    if (stepId === "story_framework") {
      const d = fieldData as Record<string, unknown>;
      const ds = d.dynamic_structure as { framework_nodes?: StoryNode[] } | undefined;
      if (ds?.framework_nodes?.length) return ds.framework_nodes;
      if (Array.isArray(d.nodes) && d.nodes.length) return d.nodes as StoryNode[];
    }
    return [];
  }

  switch (config.normalize) {
    case null:
      return (raw as StoryNode[]).map((n) => ({
        ...n,
        _rawData: n._rawData ?? (n as unknown as Record<string, unknown>),
      }));
    case "plot":
      return (raw as Record<string, unknown>[]).map(plotToStoryNode);
    case "chapter":
      return (raw as Record<string, unknown>[]).map(chapterToStoryNode);
    case "quest":
      return (plots?.length)
        ? buildQuestNodesFromPlotDAG(raw as Record<string, unknown>[], plots)
        : (raw as Record<string, unknown>[]).map(questToStoryNode);
    case "vnLinear":
      return vnLinearToStoryNodes(stepId, raw as Record<string, unknown>[]);
    // 注：branchTree / vnBranched / vnTreeOverlay 在上面已早返回（传整个根对象，不走 arrayPath）
    default:
      return [];
  }
}

function resolvePlots(
  allSteps: StepState[] | undefined, result: NarrativeContext | null,
): PlotLike[] {
  if (result?.plots_generated?.plots?.length) return result.plots_generated.plots;
  if (!allSteps) return [];
  const plotStep = allSteps.find((s) => s.id === "plot_generation");
  if (plotStep?.data && typeof plotStep.data === "object") {
    const d = plotStep.data as Record<string, unknown>;
    if (Array.isArray(d.plots)) return d.plots as PlotLike[];
  }
  return [];
}

function getStoryNodes(
  stepId: string, stepData: unknown, result: NarrativeContext | null, allSteps?: StepState[],
): StoryNode[] {
  if (!(stepId in STEP_STORY_EXTRACT)) return [];
  const plots = resolvePlots(allSteps, result);
  const fromData = toStoryNodes(stepId, stepData, plots, result);
  if (fromData.length > 0) return prepareStoryNodes(fromData);

  // Composite wrapper fallback: data may be { jrpg_script, scene_map }
  if (stepData && typeof stepData === "object") {
    const compositeFieldMap: Record<string, string> = {
      script_generation: "jrpg_script",
      quest_generation: "quest_graph",
      scene_plan: "scene_map",
    };
    const field = compositeFieldMap[stepId];
    if (field) {
      const nested = (stepData as Record<string, unknown>)[field];
      if (nested) {
        const fromNested = toStoryNodes(stepId, nested, plots, result);
        if (fromNested.length > 0) return prepareStoryNodes(fromNested);
      }
    }
  }

  const ctxFieldMap: Record<string, string> = {
    story_framework: "story_framework", outline_batch: "outlines_generated",
    detailed_outline: "detailed_outlines_generated", plot_generation: "plots_generated",
    script_generation: "jrpg_script", quest_generation: "quest_graph",
    scene_plan: "scene_map",
    // 互动影游 v2：step.data 缺失时从 ctx 同名字段兜底取
    vn_scenes: "vn_scenes", vn_beats: "vn_beats", vn_branched_beats: "vn_branched_beats",
    vn_screenplay: "vn_screenplay", vn_storyboard: "vn_storyboard",
  };
  const ctxKey = ctxFieldMap[stepId];
  if (ctxKey && result) {
    const ctxData = (result as Record<string, unknown>)[ctxKey];
    const fromCtx = toStoryNodes(stepId, ctxData, plots, result);
    if (fromCtx.length > 0) return prepareStoryNodes(fromCtx);
  }
  return [];
}

// ── Structural edge builder (column-based, no backend data dependency) ───────

function connectColumnPair(cur: StoryNode[], nxt: StoryNode[]): void {
  if (cur.length === 1 && nxt.length >= 1) {
    for (const t of nxt) {
      if (!cur[0].next_node!.includes(t.node_id)) cur[0].next_node!.push(t.node_id);
    }
  } else if (cur.length >= 1 && nxt.length === 1) {
    for (const s of cur) {
      if (!s.next_node!.includes(nxt[0].node_id)) s.next_node!.push(nxt[0].node_id);
    }
  } else {
    const byBranch = new Map<string, StoryNode>();
    for (const n of nxt) {
      const p = parseNodeIdForPosition(n.node_id);
      if (p.branchKey) byBranch.set(p.branchKey, n);
    }
    for (const s of cur) {
      const sp = parseNodeIdForPosition(s.node_id);
      const match = sp.branchKey ? byBranch.get(sp.branchKey) : undefined;
      if (match) {
        if (!s.next_node!.includes(match.node_id)) s.next_node!.push(match.node_id);
      } else {
        for (const t of nxt) {
          if (!s.next_node!.includes(t.node_id)) s.next_node!.push(t.node_id);
        }
      }
    }
  }
}

function buildEdgesFromLayout(nodes: StoryNode[], layout: Map<string, ColRow>): void {
  if (!nodes.length) return;

  for (const n of nodes) {
    n.next_node = [];
    n.prev_node = [];
  }

  const parentGroups = new Map<string, StoryNode[]>();
  for (const n of nodes) {
    const parts = n.node_id.split("_");
    const parentPrefix = parts.length > 1 ? parts.slice(0, -1).join("_") : "_root";
    if (!parentGroups.has(parentPrefix)) parentGroups.set(parentPrefix, []);
    parentGroups.get(parentPrefix)!.push(n);
  }

  function connectWithinGroup(group: StoryNode[]) {
    const byCol = new Map<number, StoryNode[]>();
    for (const n of group) {
      const col = layout.get(n.node_id)?.col ?? 0;
      if (!byCol.has(col)) byCol.set(col, []);
      byCol.get(col)!.push(n);
    }
    const cols = [...byCol.keys()].sort((a, b) => a - b);
    for (const col of cols) {
      byCol.get(col)!.sort((a, b) =>
        (layout.get(a.node_id)?.row ?? 0) - (layout.get(b.node_id)?.row ?? 0),
      );
    }
    for (let ci = 0; ci < cols.length - 1; ci++) {
      connectColumnPair(byCol.get(cols[ci])!, byCol.get(cols[ci + 1])!);
    }
  }

  for (const [, group] of parentGroups) connectWithinGroup(group);

  const sortedPrefixes = [...parentGroups.keys()].sort((a, b) => {
    const ak = parseNodeIdForPosition(a).xKey;
    const bk = parseNodeIdForPosition(b).xKey;
    return compareXKeys(ak, bk);
  });

  function getExitNodes(group: StoryNode[]): StoryNode[] {
    return group.filter((n) => !n.next_node || n.next_node.length === 0);
  }
  function getEntryNodes(group: StoryNode[]): StoryNode[] {
    return group.filter((n) => !n.prev_node || n.prev_node.length === 0);
  }

  let i = 0;
  while (i < sortedPrefixes.length) {
    const curPrefix = sortedPrefixes[i];
    const curGroup = parentGroups.get(curPrefix)!;
    const curXKey = parseNodeIdForPosition(curPrefix).xKey;

    let j = i + 1;
    while (
      j < sortedPrefixes.length &&
      compareXKeys(parseNodeIdForPosition(sortedPrefixes[j]).xKey, curXKey) === 0
    ) {
      j++;
    }

    if (j < sortedPrefixes.length) {
      const nextXKey = parseNodeIdForPosition(sortedPrefixes[j]).xKey;
      let k = j + 1;
      while (
        k < sortedPrefixes.length &&
        compareXKeys(parseNodeIdForPosition(sortedPrefixes[k]).xKey, nextXKey) === 0
      ) {
        k++;
      }

      const exitNodes: StoryNode[] = [];
      for (let ii = i; ii < j; ii++) {
        exitNodes.push(...getExitNodes(parentGroups.get(sortedPrefixes[ii])!));
      }
      const entryNodes: StoryNode[] = [];
      for (let jj = j; jj < k; jj++) {
        entryNodes.push(...getEntryNodes(parentGroups.get(sortedPrefixes[jj])!));
      }

      if (exitNodes.length && entryNodes.length) {
        const exitByBranch = new Map<string, StoryNode[]>();
        for (const n of exitNodes) {
          const branch = parseNodeIdForPosition(n.node_id).branchKey || "_";
          if (!exitByBranch.has(branch)) exitByBranch.set(branch, []);
          exitByBranch.get(branch)!.push(n);
        }
        const entryByBranch = new Map<string, StoryNode[]>();
        for (const n of entryNodes) {
          const p = parseNodeIdForPosition(sortedPrefixes.find(
            (pf) => parentGroups.get(pf)!.includes(n),
          ) ?? n.node_id);
          const branch = p.branchKey || "_";
          if (!entryByBranch.has(branch)) entryByBranch.set(branch, []);
          entryByBranch.get(branch)!.push(n);
        }

        let matched = false;
        for (const [branch, exits] of exitByBranch) {
          if (branch === "_") continue;
          const targets = entryByBranch.get(branch);
          if (targets) {
            for (const s of exits) {
              for (const t of targets) {
                if (!s.next_node!.includes(t.node_id)) s.next_node!.push(t.node_id);
              }
            }
            matched = true;
          }
        }

        if (!matched) {
          connectColumnPair(exitNodes, entryNodes);
        } else {
          const unmatchedExits = exitNodes.filter(
            (n) => !n.next_node || n.next_node.length === 0,
          );
          const unmatchedEntries = entryNodes.filter(
            (n) => !exitNodes.some((e) => e.next_node?.includes(n.node_id)),
          );
          if (unmatchedExits.length && unmatchedEntries.length) {
            connectColumnPair(unmatchedExits, unmatchedEntries);
          }
        }
      }

      i = j;
    } else {
      i = j;
    }
  }

  for (const n of nodes) {
    for (const nxtId of n.next_node ?? []) {
      const tgt = nodes.find((t) => t.node_id === nxtId);
      if (tgt && !(tgt.prev_node ?? []).includes(n.node_id)) {
        (tgt.prev_node ??= []).push(n.node_id);
      }
    }
  }
}

function sanitizeConnections(nodes: StoryNode[]): void {
  const nodeIds = new Set(nodes.map((n) => n.node_id));
  for (const n of nodes) {
    if (n.next_node) n.next_node = n.next_node.filter((id) => nodeIds.has(id));
    if (n.prev_node) n.prev_node = n.prev_node.filter((id) => nodeIds.has(id));
  }
  for (const n of nodes) {
    for (const nxtId of n.next_node ?? []) {
      const tgt = nodes.find((t) => t.node_id === nxtId);
      if (tgt && !(tgt.prev_node ?? []).includes(n.node_id)) {
        (tgt.prev_node ??= []).push(n.node_id);
      }
    }
  }
}

/**
 * Infer missing intra-group connections from node_id structure.
 *
 * For nodes sharing the same parent prefix (e.g. "2_2a_*"), sort by
 * sequence number and link adjacent nodes when a gap exists. This repairs
 * data where filterCrossBranchConnections incorrectly removed parent→child
 * branch links.
 */
function inferMissingConnections(nodes: StoryNode[]): void {
  const nodeMap = new Map(nodes.map((n) => [n.node_id, n]));

  // Group by parent prefix: everything before the last "_segment"
  const groups = new Map<string, StoryNode[]>();
  for (const n of nodes) {
    const parts = n.node_id.split("_");
    const parentPrefix = parts.length > 1 ? parts.slice(0, -1).join("_") : "";
    if (!parentPrefix) continue;
    const group = groups.get(parentPrefix) ?? [];
    group.push(n);
    groups.set(parentPrefix, group);
  }

  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => compareXKeys(
      parseNodeIdForPosition(a.node_id).xKey,
      parseNodeIdForPosition(b.node_id).xKey,
    ));

    // Identify sequence clusters (same xKey = parallel branches)
    const clusters: StoryNode[][] = [];
    let cur: StoryNode[] = [group[0]];
    for (let i = 1; i < group.length; i++) {
      const prevX = parseNodeIdForPosition(group[i - 1].node_id).xKey;
      const curX = parseNodeIdForPosition(group[i].node_id).xKey;
      if (compareXKeys(prevX, curX) === 0) {
        cur.push(group[i]);
      } else {
        clusters.push(cur);
        cur = [group[i]];
      }
    }
    clusters.push(cur);

    // Link adjacent clusters when no connection exists between them
    for (let ci = 0; ci < clusters.length - 1; ci++) {
      const exits = clusters[ci];
      const entries = clusters[ci + 1];

      for (const src of exits) {
        const hasAnyNext = (src.next_node ?? []).some((id) =>
          entries.some((e) => e.node_id === id),
        );
        if (hasAnyNext) continue;

        if (exits.length === 1 && entries.length >= 1) {
          for (const tgt of entries) {
            src.next_node = src.next_node ?? [];
            if (!src.next_node.includes(tgt.node_id)) src.next_node.push(tgt.node_id);
            tgt.prev_node = tgt.prev_node ?? [];
            if (!tgt.prev_node.includes(src.node_id)) tgt.prev_node.push(src.node_id);
          }
        } else if (entries.length === 1) {
          const tgt = entries[0];
          src.next_node = src.next_node ?? [];
          if (!src.next_node.includes(tgt.node_id)) src.next_node.push(tgt.node_id);
          tgt.prev_node = tgt.prev_node ?? [];
          if (!tgt.prev_node.includes(src.node_id)) tgt.prev_node.push(src.node_id);
        }
      }
    }
  }
}

/**
 * Connect orphan branch nodes by tracing up sibling parent chains
 * to find the fork ancestor.
 *
 * Example: 5c is orphaned, siblings 5a→prev[4a]→prev[3], 5b→prev[4b]→prev[3].
 * Node 3 is the fork ancestor (next_node.length > 1). Connect 3→5c.
 */
function repairOrphanBranchNodes(nodes: StoryNode[]): void {
  const nodeMap = new Map(nodes.map((n) => [n.node_id, n]));
  const allIds = new Set(nodes.map((n) => n.node_id));

  function linkNodes(src: StoryNode, tgt: StoryNode): void {
    if (!(src.next_node ?? []).includes(tgt.node_id)) {
      (src.next_node ??= []).push(tgt.node_id);
    }
    if (!(tgt.prev_node ?? []).includes(src.node_id)) {
      (tgt.prev_node ??= []).push(src.node_id);
    }
  }

  function extractBranchNum(id: string): { num: string; letter: string } | null {
    const m = id.match(/^(\d+)([a-z]+)$/);
    return m ? { num: m[1], letter: m[2] } : null;
  }

  function findCommonAncestor(ids: string[]): StoryNode | null {
    if (ids.length === 0) return null;
    if (ids.length === 1) return nodeMap.get(ids[0]) ?? null;

    const ancestorSets = ids.map((startId) => {
      const set = new Set<string>();
      const q = [startId];
      while (q.length > 0) {
        const cur = q.shift()!;
        set.add(cur);
        const node = nodeMap.get(cur);
        for (const pid of node?.prev_node ?? []) {
          if (!set.has(pid)) q.push(pid);
        }
      }
      return set;
    });

    let common = ancestorSets[0];
    for (let i = 1; i < ancestorSets.length; i++) {
      common = new Set([...common].filter((id) => ancestorSets[i].has(id)));
    }
    if (common.size === 0) return null;

    // Find the closest common ancestor (by min total distance)
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const cid of common) {
      let totalDist = 0;
      for (const startId of ids) {
        const visited = new Map<string, number>();
        const q: [string, number][] = [[startId, 0]];
        while (q.length > 0) {
          const [cur, d] = q.shift()!;
          if (cur === cid) { totalDist += d; break; }
          if (visited.has(cur)) continue;
          visited.set(cur, d);
          const node = nodeMap.get(cur);
          for (const pid of node?.prev_node ?? []) q.push([pid, d + 1]);
        }
      }
      if (totalDist < bestDist) { bestDist = totalDist; bestId = cid; }
    }
    return bestId ? nodeMap.get(bestId)! : null;
  }

  const hasIncoming = new Set<string>();
  for (const n of nodes) {
    for (const nid of n.next_node ?? []) {
      if (allIds.has(nid)) hasIncoming.add(nid);
    }
  }

  const chainHeads = nodes.filter((n) => !hasIncoming.has(n.node_id));
  const rootHead = chainHeads.find((n) => /^1(_|$)/.test(n.node_id));
  const orphanHeads = chainHeads.filter((n) => n !== rootHead && (n.prev_node?.length ?? 0) === 0);
  if (!orphanHeads.length) return;

  for (const head of orphanHeads) {
    const headParts = head.node_id.split("_");
    const headBase = headParts[0];
    const branchInfo = extractBranchNum(headBase);
    if (!branchInfo) continue;

    const siblingPattern = new RegExp(
      `^${branchInfo.num}(?![0-9])([a-z]+)` +
      (headParts.length > 1
        ? `_${headParts.slice(1).join("_").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
        : "") +
      "$",
    );
    const siblings = nodes.filter(
      (n) => n.node_id !== head.node_id && siblingPattern.test(n.node_id),
    );
    if (!siblings.length) continue;

    // Collect siblings' immediate parents
    const parentIds = new Set<string>();
    for (const sib of siblings) {
      for (const pid of sib.prev_node ?? []) {
        if (nodeMap.has(pid)) parentIds.add(pid);
      }
    }

    if (parentIds.size === 0) continue;

    // All siblings share the same parent → connect there (e.g. L0: 5a,5b ← 4)
    if (parentIds.size === 1) {
      linkNodes(nodeMap.get([...parentIds][0])!, head);
      continue;
    }

    // Multiple parents → connect to the last sibling's parent (by branchKey)
    // e.g. L1: 5a_1←4_3a, 5b_1←4_3b → connect 5c_1 to 4_3b (short edge, no crossing)
    const sortedParents = [...parentIds].sort((a, b) => {
      const pA = parseNodeIdForPosition(a);
      const pB = parseNodeIdForPosition(b);
      return pA.branchKey.localeCompare(pB.branchKey) || compareXKeys(pA.xKey, pB.xKey);
    });
    linkNodes(nodeMap.get(sortedParents[sortedParents.length - 1])!, head);
  }
}

function prepareStoryNodes(rawNodes: StoryNode[]): StoryNode[] {
  const nodes = rawNodes
    .filter((n) => n.node_id)
    .map((n) => ({
      ...n,
      next_node: [...(n.next_node ?? [])],
      prev_node: [...(n.prev_node ?? [])],
    }));
  if (!nodes.length) return nodes;

  const hasOriginalConnections = nodes.some(
    (n) => n.next_node.length > 0 || n.prev_node.length > 0,
  );

  // 节点带 _layoutId 说明它来自 next[]-driven 拓扑（如 branch_tree），
  // 已自带完整正确的 next/prev 关系，不需要 RPG 专用的 ID 前缀修复函数。
  // 那两个函数（inferMissingConnections / repairOrphanBranchNodes）按
  // "node_id.split('_') 前缀同组"或"数字+字母后缀"逻辑推断连线，
  // 在语义化 ID 上会乱加边（如 END_BE_01 和 END_BE_02 被误识别为同组）。
  const isLayoutIdDriven = nodes.some((n) => n._layoutId);

  if (!hasOriginalConnections) {
    const layout = computeStoryLayout(nodes);
    buildEdgesFromLayout(nodes, layout);
  } else if (isLayoutIdDriven) {
    sanitizeConnections(nodes);
  } else {
    sanitizeConnections(nodes);
    repairOrphanBranchNodes(nodes);
    inferMissingConnections(nodes);
  }
  return nodes;
}

export const STORY_STEP_IDS = new Set<string>(Object.keys(STEP_STORY_EXTRACT));

// ── Shared child-rendering helper ───────────────────────────────────────────

// "打时间差"模型：当前层的节点展示总时长 ≈ 下一层的预估生成时间
// 预估时间随复杂度变化：complexity 1~5 对应不同的时间乘数
// complexity=3 为基准值，1/2 更快，4/5 更慢（分支多、节点多、内容多）
const COMPLEXITY_TIME_FACTOR: Record<number, number> = {
  1: 0.35, 2: 0.65, 3: 1.0, 4: 1.6, 5: 2.2,
};

const NEXT_STEP_BASE_MS: Record<string, number> = {
  story_framework:        90_000,    // L0 展示 ← L1 生成基准 ~90s @c3
  outline_batch:         150_000,    // L1 展示 ← L2 生成基准 ~150s @c3
  detailed_outline:            0,    // L2 快速展示 → 快速默认
  plot_generation:             0,
  script_generation:           0,
  "qsg::quest":                0,
  "qsg::scene::p2":            0,
};
const FAST_PER_NODE_MS = 2_000;

function getNextStepTotalMs(groupId: string, complexity: number): number {
  const baseKey = groupId.split("::")[0];
  const base = NEXT_STEP_BASE_MS[groupId] ?? NEXT_STEP_BASE_MS[baseKey] ?? 0;
  if (base === 0) return 0;
  const factor = COMPLEXITY_TIME_FACTOR[complexity] ?? 1.0;
  return Math.round(base * factor);
}

// ── Edge bend-point routing: avoid node overlap ─────────────────────────────

const BEND_MARGIN = 8;

interface ObstacleRect { x: number; y: number; w: number; h: number }

/**
 * Compute the fraction (0..1) within [sourceRightEdge, targetLeftEdge] where
 * the vertical bend should occur, avoiding obstacles. Returns undefined when
 * no obstacles are in the way (caller uses default 0.5 midpoint).
 */
function findSafeBendFraction(
  sx: number, sy: number, sw: number, sh: number,
  tx: number, ty: number, th: number,
  obstacles: ObstacleRect[],
): number | undefined {
  const left = sx + sw + BEND_MARGIN;
  const right = tx - BEND_MARGIN;
  const span = right - left;
  if (span <= 0) return undefined;

  const yMin = Math.min(sy, ty);
  const yMax = Math.max(sy + sh, ty + th);

  const blocked: [number, number][] = [];
  for (const obs of obstacles) {
    if (obs.y + obs.h < yMin || obs.y > yMax) continue;
    const bL = Math.max(left, obs.x - BEND_MARGIN);
    const bR = Math.min(right, obs.x + obs.w + BEND_MARGIN);
    if (bR > bL) blocked.push([bL, bR]);
  }

  if (blocked.length === 0) return undefined;

  blocked.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [blocked[0]];
  for (let i = 1; i < blocked.length; i++) {
    const last = merged[merged.length - 1];
    if (blocked[i][0] <= last[1]) {
      last[1] = Math.max(last[1], blocked[i][1]);
    } else {
      merged.push(blocked[i]);
    }
  }

  const freeIntervals: [number, number][] = [];
  let cursor = left;
  for (const [mL, mR] of merged) {
    if (mL > cursor) freeIntervals.push([cursor, mL]);
    cursor = Math.max(cursor, mR);
  }
  if (cursor < right) freeIntervals.push([cursor, right]);

  if (freeIntervals.length === 0) return undefined;

  let best = freeIntervals[0];
  for (const iv of freeIntervals) {
    if (iv[1] - iv[0] > best[1] - best[0]) best = iv;
  }

  const bendX = (best[0] + best[1]) / 2;
  return (bendX - left) / span;
}

const LANE_MARGIN = 10;

/**
 * 为「跨列长边」找一条水平绕行通道的 Y（与 obstacles 同坐标系，通常是 parent-relative）。
 *
 * 仅当「源右沿 ~ 目标左沿」这条走廊里确有节点挡道时返回通道 Y；否则返回 undefined
 * （直连/单竖折即可，交给原有逻辑）。返回的 Y 取离直线中点最近的空白带，绕行幅度最小。
 *
 * 背景：分层图里收束节点用最长路径分层，浅父→深收束的边会横跨中间多列，
 * 直线必然压过中间列节点（RPG 拓扑规整不触发，影游分支长度不均会触发）。
 */
function findClearLaneY(
  sx: number, sy: number, sw: number, sh: number,
  tx: number, ty: number, th: number,
  obstacles: ObstacleRect[],
): number | undefined {
  const corridorL = sx + sw + BEND_MARGIN;
  const corridorR = tx - BEND_MARGIN;
  if (corridorR - corridorL <= 0) return undefined; // 相邻/重叠，无走廊

  // 走廊 X 区间内的挡路节点（源/目标天然落在走廊两端外，被排除）
  const blockers = obstacles.filter((o) => o.x + o.w > corridorL && o.x < corridorR);
  if (blockers.length === 0) return undefined; // 走廊本就空，直连即可

  // Y 感知闸门：只有当「源心→目标心」这条直线**真的穿过**某个走廊节点时才绕行。
  // 否则（挡路节点只是 X 落在走廊里，但在直线的上方/下方）直连或单竖折本就不会碰，
  // 交还原逻辑——避免把本可直走的边硬塞进贴着相邻节点的窄通道（9.2→10.1 同在主干
  // 行、中间列的 13.1 在上方却被当障碍 → 边被压到 spine 顶，就是这么来的）。
  const syc = sy + sh / 2;
  const tyc = ty + th / 2;
  const lineYAt = (x: number) => syc + (tyc - syc) * ((x - corridorL) / (corridorR - corridorL));
  const reallyBlocks = blockers.some((o) => {
    const yl = lineYAt(Math.max(o.x, corridorL));
    const yr = lineYAt(Math.min(o.x + o.w, corridorR));
    return Math.max(yl, yr) >= o.y - LANE_MARGIN && Math.min(yl, yr) <= o.y + o.h + LANE_MARGIN;
  });
  if (!reallyBlocks) return undefined;

  // 合并占用 Y 区间（含通道余量）
  const occ = blockers
    .map((o) => [o.y - LANE_MARGIN, o.y + o.h + LANE_MARGIN] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[occ[0][0], occ[0][1]]];
  for (let i = 1; i < occ.length; i++) {
    const last = merged[merged.length - 1];
    if (occ[i][0] <= last[1]) last[1] = Math.max(last[1], occ[i][1]);
    else merged.push([occ[i][0], occ[i][1]]);
  }

  // 候选通道：最上方之上、相邻占用带之间、最下方之下
  const candidates: number[] = [merged[0][0] - LANE_MARGIN];
  for (let i = 0; i < merged.length - 1; i++) {
    candidates.push((merged[i][1] + merged[i + 1][0]) / 2);
  }
  candidates.push(merged[merged.length - 1][1] + LANE_MARGIN);

  // 取离「直线中点 Y」最近的通道，绕行最小
  const aimY = (sy + sh / 2 + ty + th / 2) / 2;
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - aimY) < Math.abs(best - aimY)) best = c;
  }
  return Math.round(best);
}

// ── Shared child-rendering helper ───────────────────────────────────────────

function renderStoryChildren(
  groupId: string,
  storyNodes: StoryNode[],
  pixels: ReturnType<typeof colRowToPixels>,
  status: string,
  revealTimestamps: Map<string, number> | undefined,
  pipelineStatus: string | undefined,
  complexity: number,
  rfNodes: Node[],
  rfEdges: Edge[],
) {
  const incomingCounts = new Map<string, number>();
  for (const sn of storyNodes) {
    for (const nid of sn.next_node ?? []) incomingCounts.set(nid, (incomingCounts.get(nid) ?? 0) + 1);
  }

  /**
   * 主线节点集合；这一层没有任何节点被标过就是 undefined。
   *
   * 区分"没标"与"标了但一个都不在主线上"是必要的：线性形态后端不逐点标注，
   * 此时全线即主线，把整张图高亮起来等于没有高亮——不如不画。
   */
  const optimalIds = (() => {
    const marked = storyNodes.filter((sn) => sn.on_optimal_path === true);
    return marked.length > 0 ? new Set(marked.map((sn) => sn.node_id)) : undefined;
  })();

  const nextTotal = getNextStepTotalMs(groupId, complexity);
  const totalChildren = storyNodes.length;
  const perNodeMs = nextTotal > 0
    ? Math.max(2_000, nextTotal / Math.max(totalChildren, 1))
    : FAST_PER_NODE_MS;
  const revealTs = revealTimestamps?.get(groupId);
  const now = Date.now();
  const renderedChildIds = new Set<string>();

  // 单节点操作（重 roll / 树增删）要落到真正的 step id 上，而非分段容器 id
  // （如 `vn_outline_acts::acts`）——后端的 regenerate/tree-node 接口只认 step id。
  const stepId = groupId.split("::")[0];
  const existingIds = storyNodes.map((sn) => sn.node_id);

  for (let si = 0; si < storyNodes.length; si++) {
    const sn = storyNodes[si];
    const childPos = pixels.positions.get(sn.node_id);
    if (!childPos) continue;

    const isMerge = (incomingCounts.get(sn.node_id) ?? 0) > 1;
    const isFork = sn.is_fork ?? (sn.next_node?.length ?? 0) > 1;
    const parsedId = parseNodeIdForPosition(sn.node_id);
    const branchLetter = parsedId.branchKey || undefined;
    const onOptimalPath = optimalIds?.has(sn.node_id) ?? false;

    // Absolute timestamp when this node should appear (-1 = no animation)
    let animStartTime: number;
    if (revealTs && pipelineStatus === "running") {
      const targetTs = revealTs + si * perNodeMs;
      animStartTime = targetTs > now ? targetTs : -1;
    } else {
      animStartTime = -1;
    }

    rfNodes.push({
      id: `${groupId}__${sn.node_id}`,
      type: "storyChild",
      position: { x: childPos.x, y: childPos.y },
      parentNode: groupId,
      data: {
        nodeId: sn.node_id, contentId: sn.content_id,
        name: sn.name, narrativeFunction: sn.narrative_function,
        isBranch: sn.is_branch ?? !!branchLetter, isMerge, isFork, branchLetter,
        onOptimalPath,
        content: sn.main_content ?? (sn as unknown as Record<string, unknown>).content,
        stageType: sn.stage_type ?? sn.narrative_stage,
        animStartTime,
        ringDuration: perNodeMs,
        storyElements: (sn as unknown as Record<string, unknown>).story_elements,
        fullData: sn._rawData,
        stepId,
        nextNodeIds: sn.next_node ?? [],
        existingIds,
      },
      style: { width: CN_W, height: CN_H },
    });
    renderedChildIds.add(sn.node_id);
  }

  const childAnimMap = new Map<string, number>();
  const childPosMap = new Map<string, { x: number; y: number }>();
  for (const node of rfNodes) {
    if (node.parentNode === groupId && node.type === "storyChild") {
      childAnimMap.set(node.id, (node.data as { animStartTime?: number }).animStartTime ?? -1);
      childPosMap.set(node.id, node.position);
    }
  }

  const obstacles: ObstacleRect[] = [];
  for (const pos of childPosMap.values()) {
    obstacles.push({ x: pos.x, y: pos.y, w: CN_W, h: CN_H });
  }

  for (const sn of storyNodes) {
    if (!renderedChildIds.has(sn.node_id)) continue;
    for (const nextId of sn.next_node ?? []) {
      if (renderedChildIds.has(nextId)) {
        const targetIsMerge = (incomingCounts.get(nextId) ?? 0) > 1;
        // 一条边算在主线上，要求两端都在主线上：只看起点会把"主线分岔出去的
        // 那条支线"也画成主线，恰好是最该区分的地方。
        const edgeOnOptimalPath =
          !!optimalIds && optimalIds.has(sn.node_id) && optimalIds.has(nextId);
        const sourceFullId = `${groupId}__${sn.node_id}`;
        const targetFullId = `${groupId}__${nextId}`;
        const targetAnimTime = childAnimMap.get(targetFullId) ?? -1;

        const srcPos = childPosMap.get(sourceFullId);
        const tgtPos = childPosMap.get(targetFullId);
        let bendFraction: number | undefined;
        let routeLaneOffsetY: number | undefined;
        if (srcPos && tgtPos) {
          // 走廊里有节点挡道（跨列长边）→ 走水平绕行通道；否则退回单竖折避障。
          const laneY = findClearLaneY(
            srcPos.x, srcPos.y, CN_W, CN_H,
            tgtPos.x, tgtPos.y, CN_H,
            obstacles,
          );
          if (laneY !== undefined) {
            routeLaneOffsetY = laneY - (srcPos.y + CN_H / 2);
          } else if (Math.abs(srcPos.y - tgtPos.y) >= 4) {
            bendFraction = findSafeBendFraction(
              srcPos.x, srcPos.y, CN_W, CN_H,
              tgtPos.x, tgtPos.y, CN_H,
              obstacles,
            );
          }
        }

        rfEdges.push({
          id: `e_${groupId}__${sn.node_id}__${nextId}`,
          source: sourceFullId,
          target: targetFullId,
          type: "detroit",
          zIndex: 1000,
          data: {
            isBranch: sn.is_branch ?? false,
            isMerge: targetIsMerge,
            onOptimalPath: edgeOnOptimalPath,
            status: "done" as const,
            level: "inner" as const,
            animStartTime: targetAnimTime,
            bendFraction,
            routeLaneOffsetY,
          },
        });
      }
    }
  }
}

// ── Fork data structures ────────────────────────────────────────────────────

interface ForkBranch {
  nodes: StoryNode[];
  pixels: ReturnType<typeof colRowToPixels>;
  w: number;
  h: number;
  expand: boolean;
}

/**
 * 场景生成的内部分段。每一段都必须有产物才会出现在这里 —— 没跑过的步骤不该凭空
 * 长出三层嵌套。骨架层同理：有几层数据就画几张卡，`L2 骨架 (0)` 这种卡不该存在。
 */
interface ScenePhaseData {
  containerExpand: boolean;
  /** 有数据的骨架层（l0/l1/l2 中非空者），空数组表示这一段整段不存在。 */
  p1Layers: { key: "l0" | "l1" | "l2"; count: number }[];
  /** 骨架层是否值得套一层子容器：只有一层时不套（与席位容器"独苗不套框"同一条规矩）。 */
  p1Grouped: boolean;
  p1Expand: boolean;
  p1W: number;
  p1H: number;
  p2Nodes: StoryNode[];
  p2Pixels: ReturnType<typeof colRowToPixels> | null;
  p2W: number;
  p2H: number;
  p2Expand: boolean;
  /** 合并卡：只有"骨架 + 展开"两段都在时才有东西可合并。 */
  hasMerge: boolean;
  containerW: number;
  containerH: number;
}

interface ForkData {
  /** 任务分支只在同一个 step 同时产出任务与场景时才存在（legacy script_scene_generation）。 */
  quest?: ForkBranch;
  scene: ScenePhaseData;
  totalW: number;
  totalH: number;
}

/**
 * 互动影游 E1-02 三幕扩写（vn_outline_acts）专属嵌套结构：
 *   vn_outline_acts（大容器 storyGroup）
 *     ├─ 线路1（上）：vn_outline_acts::acts（"三幕剧本"子组 storyGroup）
 *     │     └─ 第一幕 → 第二幕 → 第三幕（storyChild 串行）
 *     └─ 线路2（下）：人物小传 → 关键道具（storyChild 串行，直接挂容器）
 *  两条线路平级并行（仿 RPG 场景生成的 fork 思路，但更轻量）。
 */
interface OutlineNestData {
  containerExpand: boolean;
  actsExpand: boolean;
  actNodes: StoryNode[];
  actPixels: ReturnType<typeof colRowToPixels> | null;
  actsW: number;
  actsH: number;
  line2Nodes: StoryNode[]; // [人物小传, 关键道具]（任一缺失则省略）
  containerW: number;
  containerH: number;
}

interface PreStep {
  stepId: string;
  label: string;
  status: string;
  isStory: boolean;
  storyNodes: StoryNode[];
  shouldExpand: boolean;
  w: number;
  h: number;
  storyPixels: ReturnType<typeof colRowToPixels> | null;
  fork?: ForkData;
  /** fork/场景嵌套这一块在图上的节点 id（见 buildSceneNestPreStep）。 */
  sceneContainerId?: string;
  outlineNest?: OutlineNestData;
}

/**
 * 场景生成（含 legacy「任务+场景」合并 step）的嵌套结构。
 *
 * 全部由数据推导：哪一段有产物就画哪一段，一段都没有则返回 null，
 * 由调用方退化成一张普通管线卡。这是"画布如实反映后端产出"的底线——
 * 上一版这里的展开条件只看用户有没有折叠，于是从未运行的步骤也会稳定长出
 * 「骨架提取 + L0/L1/L2 (0) + 空的场景展开 + 合并」七个节点。
 *
 * containerId 决定这一块在图上的身份：独立的 scene_plan 用它自己的 step id
 * （席位/专家容器是按 step id 收成员的，用合成 id 会让它落在容器外面），
 * legacy 合并 step 仍用 qsg::scene，以免用户已有的折叠状态失效。
 */
function buildSceneNestPreStep(
  stepId: string, label: string, status: string,
  questNodes: StoryNode[], sceneNodes: StoryNode[],
  collapsedIds: Set<string>,
  containerId: string,
  p1LayerData?: { l0: SkeletonLayerScene[]; l1: SkeletonLayerScene[]; l2: SkeletonLayerScene[] } | null,
): PreStep | null {
  const p1Layers = ([["l0", p1LayerData?.l0], ["l1", p1LayerData?.l1], ["l2", p1LayerData?.l2]] as const)
    .filter(([, arr]) => Array.isArray(arr) && arr.length > 0)
    .map(([key, arr]) => ({ key, count: arr!.length }));

  const hasQuest = questNodes.length > 0;
  const hasScenes = sceneNodes.length > 0;
  if (p1Layers.length === 0 && !hasScenes && !hasQuest) return null;

  // ── 任务分支（上）──
  let quest: ForkBranch | undefined;
  if (hasQuest) {
    const qPixels = colRowToPixels(computeStoryLayout(questNodes));
    const questExpand = !collapsedIds.has(`${containerId}::quest`) && !collapsedIds.has("qsg::quest");
    quest = {
      nodes: questNodes,
      pixels: qPixels,
      w: questExpand ? Math.max(GROUP_MIN_W, qPixels.width) : PL_W,
      h: questExpand ? Math.max(GROUP_MIN_H, qPixels.height) : PL_H,
      expand: questExpand,
    };
  }

  // ── 场景容器（下）──
  const containerExpand = !collapsedIds.has(containerId);
  // 只有一层骨架时不套子容器：一个框裹一张卡只是多一层边框。
  const p1Grouped = p1Layers.length > 1;
  const p1Expand = containerExpand && p1Grouped && !collapsedIds.has(`${containerId}::p1`);
  const hasMerge = p1Layers.length > 0 && hasScenes;

  let p1W = PL_W;
  let p1H = PL_H;
  if (p1Expand) {
    // 有几层就几张卡，外加一张骨架合并卡。
    const cards = p1Layers.length + 1;
    p1W = BIG_PAD + cards * PL_W + (cards - 1) * INNER_GAP + BIG_PAD;
    p1H = BIG_TITLE_H + BIG_PAD + PL_H + BIG_PAD;
  }

  let p2W = PL_W;
  let p2H = PL_H;
  let p2Pixels: ReturnType<typeof colRowToPixels> | null = null;
  const p2Expand = containerExpand && hasScenes && !collapsedIds.has(`${containerId}::p2`);
  if (p2Expand) {
    p2Pixels = colRowToPixels(computeStoryLayout(sceneNodes));
    p2W = Math.max(GROUP_MIN_W, p2Pixels.width);
    p2H = Math.max(GROUP_MIN_H, p2Pixels.height);
  }

  let containerW = PL_W;
  let containerH = PL_H;
  if (containerExpand) {
    const segW: number[] = [];
    if (p1Layers.length > 0) segW.push(p1W);
    if (hasScenes) segW.push(p2W);
    if (hasMerge) segW.push(PL_W);
    const innerW = segW.reduce((sum, w) => sum + w, 0) + Math.max(0, segW.length - 1) * INNER_GAP;
    const innerH = Math.max(p1Layers.length > 0 ? p1H : 0, hasScenes ? p2H : 0, PL_H);
    containerW = Math.max(GROUP_MIN_W, BIG_PAD + innerW + BIG_PAD);
    containerH = BIG_TITLE_H + BIG_PAD + innerH + BIG_PAD;
  }

  const totalW = Math.max(quest?.w ?? 0, containerW);
  const totalH = quest ? quest.h + FORK_V_GAP + containerH : containerH;

  return {
    stepId, label, status,
    isStory: false, storyNodes: [], shouldExpand: false,
    w: totalW, h: totalH, storyPixels: null,
    sceneContainerId: containerId,
    fork: {
      quest,
      scene: {
        containerExpand,
        p1Layers, p1Grouped, p1Expand, p1W, p1H,
        p2Nodes: sceneNodes, p2Pixels, p2W, p2H, p2Expand,
        hasMerge,
        containerW, containerH,
      },
      totalW, totalH,
    },
  };
}

/**
 * 构建 E1-02 三幕扩写（vn_outline_acts）的嵌套 PreStep。
 * 数据来源：stepData.acts（三幕）+ result.vn_character_bios（人物小传）+ result.vn_key_items（关键道具）。
 * 无三幕数据 → 退化为普通 pipelineStep（isStory:false，不展开）。
 */
function buildOutlineActsPreStep(
  stepId: string, label: string, status: string,
  stepData: unknown, result: NarrativeContext | null, collapsedIds: Set<string>,
): PreStep {
  const data = (stepData && typeof stepData === "object" ? stepData : {}) as Record<string, unknown>;
  const ctxOutline = (result as Record<string, unknown> | null | undefined)?.vn_outline_acts as
    Record<string, unknown> | undefined;
  const actsArr = (Array.isArray(data.acts) ? data.acts
    : Array.isArray(ctxOutline?.acts) ? ctxOutline!.acts
    : []) as Record<string, unknown>[];

  // 无三幕 → 退化为普通管线节点
  if (actsArr.length === 0) {
    return {
      stepId, label, status,
      isStory: false, storyNodes: [], shouldExpand: false,
      w: PL_W, h: PL_H, storyPixels: null,
    };
  }

  // 线路1：三幕剧本子组的 3 个串行 storyChild（第一→二→三幕）
  const actIds = actsArr.map((a, i) => `act_${a.act_id ?? i + 1}`);
  const actNodes: StoryNode[] = actsArr.map((a, i) => ({
    node_id: actIds[i],
    content_id: actIds[i],
    _layoutId: String(i + 1),
    name: `第${a.act_id ?? i + 1}幕${a.act_name ? ` · ${pickZhText(a.act_name)}` : ""}`,
    narrative_function: pickZhText(a.act_name),
    main_content: pickZhText(a.content ?? a.summary).slice(0, 140),
    prev_node: i > 0 ? [actIds[i - 1]] : [],
    next_node: i < actsArr.length - 1 ? [actIds[i + 1]] : [],
    _rawData: a,
  }));

  // 线路2：人物小传 → 关键道具（聚合成两个 storyChild）
  // 运行期 activeResult 为 null，companion 字段随 SSE 帧（stepData）附带下发：
  // 优先读 stepData.character_bios / key_items，回退 result（完成后看历史时）。
  const bios = ((data.character_bios as Record<string, unknown> | undefined) ??
    (result as Record<string, unknown> | null | undefined)?.vn_character_bios) as
    Record<string, unknown> | undefined;
  const items = ((data.key_items as Record<string, unknown> | undefined) ??
    (result as Record<string, unknown> | null | undefined)?.vn_key_items) as
    Record<string, unknown> | undefined;
  const bioChars = (Array.isArray(bios?.characters) ? bios!.characters : []) as Record<string, unknown>[];
  const keyItems = (Array.isArray(items?.items) ? items!.items : []) as Record<string, unknown>[];

  const line2Nodes: StoryNode[] = [];
  if (bioChars.length > 0) {
    line2Nodes.push({
      node_id: "vn_bios",
      content_id: "vn_bios",
      name: "人物小传",
      narrative_function: "角色",
      main_content: `${bioChars.length} 人：${bioChars.map((c) => pickZhText(c.name)).filter(Boolean).join("、")}`.slice(0, 140),
      prev_node: [],
      next_node: keyItems.length > 0 ? ["vn_items"] : [],
      _rawData: bios as Record<string, unknown>,
    });
  }
  if (keyItems.length > 0) {
    line2Nodes.push({
      node_id: "vn_items",
      content_id: "vn_items",
      name: "关键道具",
      narrative_function: "道具",
      main_content: `${keyItems.length} 件：${keyItems.map((it) => pickZhText(it.name)).filter(Boolean).join("、")}`.slice(0, 140),
      prev_node: bioChars.length > 0 ? ["vn_bios"] : [],
      next_node: [],
      _rawData: items as Record<string, unknown>,
    });
  }

  const containerExpand = !collapsedIds.has("vn_outline_acts");
  const actsExpand = containerExpand && !collapsedIds.has("vn_outline_acts::acts");

  // 三幕剧本子组尺寸
  let actsW = PL_W;
  let actsH = PL_H;
  let actPixels: ReturnType<typeof colRowToPixels> | null = null;
  if (actsExpand) {
    actPixels = colRowToPixels(computeStoryLayout(actNodes));
    actsW = Math.max(GROUP_MIN_W, actPixels.width);
    actsH = Math.max(GROUP_MIN_H, actPixels.height);
  }

  // 容器尺寸
  let containerW = PL_W;
  let containerH = PL_H;
  if (containerExpand) {
    const padTop = BIG_TITLE_H + BIG_PAD;
    const line2W = line2Nodes.length > 0
      ? line2Nodes.length * CN_W + Math.max(0, line2Nodes.length - 1) * COL_GAP
      : 0;
    const innerW = Math.max(actsW, line2W);
    const line2Block = line2Nodes.length > 0 ? FORK_V_GAP + CN_H : 0;
    containerW = Math.max(GROUP_MIN_W, BIG_PAD + innerW + BIG_PAD);
    containerH = padTop + actsH + line2Block + BIG_PAD;
  }

  return {
    stepId, label, status,
    isStory: true, storyNodes: actNodes, shouldExpand: false,
    w: containerW, h: containerH, storyPixels: null,
    outlineNest: {
      containerExpand, actsExpand,
      actNodes, actPixels, actsW, actsH,
      line2Nodes, containerW, containerH,
    },
  };
}

// ── 专家容器（席位管线嵌套渲染）─────────────────────────────────────────────

/**
 * 容器标题条的高度，与 CSS 的 .rf-story-group-header{height:32px} 同一个数。
 *
 * 布局是唯一知道"子节点该从哪儿开始"的地方，而标题条高度写在 CSS 里；
 * 两边各写一个数就会漂：上一版顶部内边距只比标题条高 2px，子卡看起来就贴在标题上。
 * 这里显式取"标题条 + 一段呼吸位"，任何一层容器都不许让子节点压到标题条下沿以上。
 */
const GROUP_HEADER_H = 32;
/** 标题条与内容之间、以及内容与容器底边之间的呼吸位。 */
const GROUP_INNER_GAP = 16;

const EXPERT_PAD_X = 24;
const EXPERT_PAD_TOP = GROUP_HEADER_H + GROUP_INNER_GAP;
const EXPERT_PAD_BOTTOM = GROUP_INNER_GAP;

/**
 * 席位容器：左右比专家窄一圈（层级由外到内应当收紧），但顶部一样要让开整条标题条——
 * 顶部这一项没有"省一点"的余地，省下来的就是子卡压在标题上。
 */
const SEAT_PAD_X = 14;
const SEAT_PAD_TOP = GROUP_HEADER_H + GROUP_INNER_GAP;
const SEAT_PAD_BOTTOM = GROUP_INNER_GAP;

function nodeW(n: Node): number {
  const w = n.style?.width;
  return typeof w === "number" ? w : PL_W;
}

function nodeH(n: Node): number {
  const h = n.style?.height;
  return typeof h === "number" ? h : PL_H;
}

/**
 * 卡片标题的取名顺序：后端给的名字最优先。
 *
 * StepState.label 来自 SSE 的 stage 或 announce 的 stepNames，两者都出自后端
 * STEP_REGISTRY —— 那是环节名的唯一真值。前端静态步表只在后端没给名字时兜底
 * （老存档回放、旧后端），最后才退回 id。以前这里只读静态表，于是后端改了名、
 * 画布还写着旧名，得两边一起改才对得上。
 */
function stepTitle(step: StepState, staticLabel?: string): string {
  if (step.label && step.label !== step.id) return step.label;
  return staticLabel ?? step.id;
}

/** 一组步骤的合并状态：有败即败，有跑即跑，全成才成，否则待跑。 */
function aggregateStatus(statuses: StepStatus[]): StepStatus {
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.length > 0 && statuses.every((s) => s === "completed")) return "completed";
  return "pending";
}

/**
 * 把同属一个专家席位管线的顶层步骤收进一个可展开的容器节点。
 *
 * 做成主布局之后的后置 pass，而不是插进上面那段选步逻辑里：
 * story / fork / vn 那几套嵌套已经把主循环占满了，在里面再叠一层专家分组
 * 会牵动所有既有分支的坐标。这里只做两件与选步无关的事——算包围盒、改父子，
 * 于是无论成员是普通管线步还是本身就带子图的 storyGroup 都一视同仁。
 *
 * 归属真值来自后端 announce 的 stepGroups（席位管线定义），前端不猜。
 */
/** 一层容器的规格：标题、副标题、以及这一层的直接成员。 */
interface ContainerSpec {
  id: string;
  label: string;
  sublabel?: string;
  /** 席位容器专用：渲染层据此查 i18n 名，label 只作缺键兜底。 */
  seatId?: string;
  /** 直接成员：可以是 step 节点，也可以是更内一层的容器。 */
  memberIds: string[];
  pad: { x: number; top: number; bottom: number };
}

function applyExpertGrouping(
  rfNodes: Node[],
  rfEdges: Edge[],
  groups: AnnounceStepGroup[],
  collapsedIds: Set<string>,
  steps: StepState[],
): { nodes: Node[]; edges: Edge[] } {
  if (groups.length === 0) return { nodes: rfNodes, edges: rfEdges };

  // 容器状态要能层层聚合，所以 statusOf 是可写的：内层容器算完把自己的状态登记进来，
  // 外层再据此聚合，不必重新遍历后代。
  const statusOf = new Map<string, StepStatus>(steps.map((s) => [s.id, s.status]));

  /**
   * 席位（编号 2.3.x）是画布的单位，step 只是它的实现。
   *
   * 单步席位：卡的标题直接换成席位名。剩下 step 名会让用户在「需求清单」这一席上
   * 读到「偏好总结」——那是四期前的词，新架构里这一席就叫需求清单。
   * 多步席位：给一层席位容器，实现层的两张卡收在里面，容器标题才是席位名。
   */
  let nodes = rfNodes;
  const seatSpecs: ContainerSpec[] = [];
  const seatLevelMembers = new Map<string, string[]>();

  for (const group of groups) {
    const seats = group.seats ?? [];
    if (seats.length === 0) {
      seatLevelMembers.set(group.id, group.steps);
      continue;
    }
    const members: string[] = [];
    for (const seat of seats) {
      if (seat.steps.length === 1) {
        const stepId = seat.steps[0];
        members.push(stepId);
        nodes = nodes.map((n) =>
          n.id === stepId && n.type === "pipelineStep"
            ? { ...n, data: { ...n.data, seatId: seat.id, seatName: seat.name } }
            : n,
        );
        continue;
      }
      const seatContainerId = `seat::${seat.id}`;
      members.push(seatContainerId);
      seatSpecs.push({
        // 本地化留给渲染层（seatId + i18n 键）：布局是 memo 出来的，
        // 在这里定死语言的话切换语言不会重算，标题会停在旧语种上。
        id: seatContainerId,
        label: seat.name,
        seatId: seat.id,
        memberIds: seat.steps,
        pad: { x: SEAT_PAD_X, top: SEAT_PAD_TOP, bottom: SEAT_PAD_BOTTOM },
      });
    }
    // announce 只报了席位归属、没报全部步时，剩下的步（元节点之外的散步）仍留在专家层。
    const claimed = new Set(seats.flatMap((s) => s.steps));
    for (const stepId of group.steps) {
      if (!claimed.has(stepId)) members.push(stepId);
    }
    seatLevelMembers.set(group.id, members);
  }

  const expertSpecs: ContainerSpec[] = groups.map((group) => ({
    id: `expert::${group.id}`,
    label: group.label,
    // 管线名做副标题：标题回答"谁在跑"（专家），副标题回答"跑的是哪条管线"。
    sublabel: group.pipelineName,
    memberIds: seatLevelMembers.get(group.id) ?? group.steps,
    pad: { x: EXPERT_PAD_X, top: EXPERT_PAD_TOP, bottom: EXPERT_PAD_BOTTOM },
  }));

  // 由内向外：席位容器先成形，专家容器才能把它们当成员收进去。
  const inner = applyContainers({ nodes, edges: rfEdges }, seatSpecs, collapsedIds, statusOf);
  return applyContainers(inner, expertSpecs, collapsedIds, statusOf);
}

function applyContainers(
  input: { nodes: Node[]; edges: Edge[] },
  specs: ContainerSpec[],
  collapsedIds: Set<string>,
  statusOf: Map<string, StepStatus>,
): { nodes: Node[]; edges: Edge[] } {
  let nodes = input.nodes;
  let edges = input.edges;
  if (specs.length === 0) return { nodes, edges };

  for (const spec of specs) {
    const containerId = spec.id;
    if (nodes.some((n) => n.id === containerId)) continue;

    const member = new Set(spec.memberIds);
    const children = nodes.filter((n) => !n.parentNode && member.has(n.id));
    // 独苗不值得套容器：一个容器裹一个节点只是多一层边框。
    if (children.length < 2) continue;

    const minX = Math.min(...children.map((c) => c.position.x));
    const minY = Math.min(...children.map((c) => c.position.y));
    const maxX = Math.max(...children.map((c) => c.position.x + nodeW(c)));
    const maxY = Math.max(...children.map((c) => c.position.y + nodeH(c)));

    const origin = { x: minX - spec.pad.x, y: minY - spec.pad.top };
    const childIds = new Set(children.map((c) => c.id));
    const memberStatuses = children.map((c) => statusOf.get(c.id) ?? "pending");
    const status = aggregateStatus(memberStatuses);
    const doneCount = memberStatuses.filter((s) => s === "completed").length;
    const expanded = !collapsedIds.has(containerId);
    // 登记自身状态，供外一层聚合。
    statusOf.set(containerId, status);

    const container: Node = {
      id: containerId,
      type: "storyGroup",
      draggable: true,
      position: origin,
      data: {
        label: spec.label,
        sublabel: spec.sublabel,
        seatId: spec.seatId,
        status,
        childCount: children.length,
        expanded,
        progress: doneCount / children.length,
        // 内边距随节点一起走：拖动时要靠它算"标题栏以下那块画布"的边界。
        pad: spec.pad,
      },
      style: expanded
        ? {
            width: maxX - minX + spec.pad.x * 2,
            height: maxY - minY + spec.pad.top + spec.pad.bottom,
          }
        : { width: PL_W, height: PL_H },
    };

    const firstIdx = nodes.findIndex((n) => childIds.has(n.id));

    if (!expanded) {
      // 折叠：成员及其后代一并撤下，指向成员的边改指容器，组内边丢掉——
      // 否则 ReactFlow 会为找不到端点的边报警并留下悬空连线。
      const dropped = new Set<string>();
      const collect = (id: string) => {
        dropped.add(id);
        for (const n of nodes) if (n.parentNode === id) collect(n.id);
      };
      children.forEach((c) => collect(c.id));
      nodes = nodes.filter((n) => !dropped.has(n.id));
      nodes.splice(firstIdx, 0, container);
      nodes = [...nodes];
      edges = edges
        .filter((e) => !(dropped.has(e.source) && dropped.has(e.target)))
        .map((e) => ({
          ...e,
          source: dropped.has(e.source) ? containerId : e.source,
          target: dropped.has(e.target) ? containerId : e.target,
        }));
      continue;
    }

    // 展开：成员坐标转为相对容器。成员自己的后代仍相对各自父节点，无需动。
    nodes = nodes.map((n) =>
      childIds.has(n.id)
        ? {
            ...n,
            parentNode: containerId,
            extent: "parent" as const,
            position: { x: n.position.x - origin.x, y: n.position.y - origin.y },
          }
        : n,
    );
    // 父节点必须排在子节点之前，否则 ReactFlow 解析不到 parentNode。
    nodes.splice(firstIdx, 0, container);
    nodes = [...nodes];

    // 跨容器的边收到容器把手上：展开态若让 pipeline_config 直连组内第一步，
    // 线会从边框外面穿进去戳到内层卡上，读起来像"外面那步是组里的"。
    // 专家容器与它外面的元节点是同一层的两个东西，连线就该连在这一层。
    // 组内边不动——它们本就在同一层（容器内部）。
    const inside = new Set<string>();
    const collectInside = (nodeId: string) => {
      inside.add(nodeId);
      for (const n of nodes) if (n.parentNode === nodeId) collectInside(n.id);
    };
    children.forEach((c) => collectInside(c.id));
    // 只在被改指的边之间去重：多条入边收到同一把手后会重合。组内既有的平行边
    // （故事子图那种同一对节点多条连线）不在此列，不能连它们一起去掉。
    const rewired = new Set<string>();
    const next: Edge[] = [];
    for (const e of edges) {
      const sIn = inside.has(e.source);
      const tIn = inside.has(e.target);
      if (sIn === tIn) {
        next.push(e);
        continue;
      }
      const moved = {
        ...e,
        source: sIn ? containerId : e.source,
        target: tIn ? containerId : e.target,
      };
      if (moved.source === moved.target) continue;
      const key = `${moved.source}->${moved.target}`;
      if (rewired.has(key)) continue;
      rewired.add(key);
      next.push(moved);
    }
    edges = next;
  }

  return { nodes, edges };
}

// ── 人手拖动 ────────────────────────────────────────────────────────────────

/**
 * 把人手拖出来的位移叠回布局标准位。
 *
 * 存的是差值，所以在哪个坐标系里加都成立（子节点相对父节点、顶层相对画布）。
 * 时机很关键：容器成形之前叠给成员，容器的包围盒就会连拖走的位置一起算进去，
 * 松手后框自然长大把它包住；容器自身的位移则只能在成形之后叠。
 */
function applyNodeDrags(
  nodes: Node[],
  drags: Record<string, { dx: number; dy: number }>,
  accept: (node: Node) => boolean,
): Node[] {
  const ids = Object.keys(drags);
  if (ids.length === 0) return nodes;
  return nodes.map((n) => {
    const d = drags[n.id];
    if (!d || !accept(n)) return n;
    return { ...n, position: { x: n.position.x + d.dx, y: n.position.y + d.dy } };
  });
}

function isContainerId(id: string): boolean {
  return id.startsWith("expert::") || id.startsWith("seat::");
}

const FALLBACK_PAD = { x: BIG_PAD, top: BIG_TITLE_H + BIG_PAD, bottom: BIG_PAD };

interface Pad { x: number; top: number; bottom: number }

/** 布局重算过程中的可变几何：位置对父节点相对，尺寸绝对。 */
interface Geo { x: number; y: number; w: number; h: number }

function padOf(node: Node | undefined): Pad {
  return (node?.data as { pad?: Pad } | undefined)?.pad ?? FALLBACK_PAD;
}

/** 长大后的容器与邻居之间至少留出的缝。 */
const SPREAD_MARGIN = 16;

/**
 * 容器长大之后，把被它压到的同排邻居让开，两个方向都让。
 *
 * 容器撑大是"装得下子节点"的必然结果，但它不该拿邻居的位置去装自己的内容：
 * 上一版拖大一个容器，它的右边框就直接盖进下一步的格子里，两个框叠在一起——
 * 这正是用户最初抱怨的那种"叠在一起"，只不过换了个成因。
 *
 * 两类让位，方向相反，缺一不可：
 * - 向右长的容器：把后面的节点往右推（anchored 之外的常规情形）。
 * - 向左扩张的容器（anchored）：它的原点已经跟着手指往左移了，这时候再把它推回右边，
 *   等于把人的拖动悄悄吃掉——现象是"拖了半天什么都没动，只有框越来越宽"。
 *   所以锚住它，改推它左边的节点继续往左，一路级联。管线整条向左变长，但拖到哪就停在哪。
 *
 * x 与 y 都相交才算压到，所以被竖向挪开的节点不受牵连。
 */
function spreadTopLevelOverlaps(nodes: Node[], geo: Map<string, Geo>, anchored: Set<string>): void {
  const tops = nodes
    .filter((n) => !n.parentNode && geo.has(n.id))
    .map((n) => ({ id: n.id, g: geo.get(n.id)! }))
    .sort((a, b) => a.g.x - b.g.x);
  if (tops.length < 2) return;

  const hits = (a: Geo, b: Geo): boolean =>
    a.y < b.y + b.h && b.y < a.y + a.h && a.x < b.x + b.w && b.x < a.x + a.w;

  // 先处理向左扩张：从锚住的节点往前级联，逐个把左邻挤到 16px 之外。
  for (let i = 0; i < tops.length; i++) {
    if (!anchored.has(tops[i].id)) continue;
    let limitLeft = tops[i].g.x;
    for (let j = i - 1; j >= 0; j--) {
      const g = tops[j].g;
      const overlapsY = g.y < tops[i].g.y + tops[i].g.h && tops[i].g.y < g.y + g.h;
      if (!overlapsY) continue;
      if (g.x + g.w + SPREAD_MARGIN > limitLeft) g.x = limitLeft - SPREAD_MARGIN - g.w;
      limitLeft = Math.min(limitLeft, g.x);
    }
  }

  // 再处理向右：按 x 升序，每个节点躲开已经就位的前面那些。
  const placed: Geo[] = [];
  for (const { id, g } of tops) {
    if (anchored.has(id)) { placed.push(g); continue; }
    let minX = g.x;
    for (const p of placed) {
      if (hits(g, p)) minX = Math.max(minX, p.x + p.w + SPREAD_MARGIN);
    }
    // 子节点是相对坐标，父节点一挪它们自然跟着走，这里不必逐个改。
    if (minX > g.x) g.x = minX;
    placed.push(g);
  }
}

/**
 * 容器几何的唯一裁决者：尺寸 = 子节点包围盒 + 内边距，自内向外递归。
 *
 * 为什么要有这么一遍：容器尺寸原先有两个来源——各 builder 的算术式，和子节点实际落点。
 * 平时两者恰好相等，所以看不出问题；人手一拖，算术式不动、子节点跑了，框就装不住内容。
 * 让包围盒当唯一裁决之后，算术式退化成"还没有子节点时的初始摆位"，不再参与最终几何。
 *
 * 递归方向必须自内向外：孙节点撑大子容器，子容器再撑大父容器。故按深度倒序处理。
 *
 * 向左越界时不是把子节点推回去，而是把容器原点往左挪、内部子节点整体重新基准化——
 * "内层始终在外层内"有两种实现，这里选的是撑大外层而不是压回内层。
 * 唯一的硬墙是标题栏下沿：任何子节点都不许压到父节点的标题上，那是层级的前后台关系。
 */
function resolveContainerGeometry(nodes: Node[]): Node[] {
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentNode) continue;
    const list = kids.get(n.parentNode);
    if (list) list.push(n.id);
    else kids.set(n.parentNode, [n.id]);
  }
  if (kids.size === 0) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const geo = new Map(
    nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, w: nodeW(n), h: nodeH(n) }]),
  );

  const depthOf = (id: string): number => {
    let depth = 0;
    let cur = byId.get(id)?.parentNode;
    // 上限只是防环，正常嵌套不超过四五层。
    while (cur && depth < 32) {
      depth++;
      cur = byId.get(cur)?.parentNode;
    }
    return depth;
  };

  const containerIds = [...kids.keys()]
    .filter((id) => byId.has(id))
    .sort((a, b) => depthOf(b) - depthOf(a));

  const anchored = new Set<string>();

  for (const containerId of containerIds) {
    const container = byId.get(containerId)!;
    // 折叠态的框是一张卡的尺寸，成员已被撤下，没有包围盒可言。
    if ((container.data as { expanded?: boolean } | undefined)?.expanded === false) continue;

    const pad = padOf(container);
    const childIds = kids.get(containerId)!;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const childId of childIds) {
      const g = geo.get(childId);
      if (!g) continue;
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.w);
      maxY = Math.max(maxY, g.y + g.h);
    }
    if (!Number.isFinite(minX)) continue;

    // 只往外长，不往里收：左/上边缘保持在布局给的位置，否则容器会跟着子节点四处漂，
    // 整行的推进节奏（H_GAP）就没有了准头。
    const growLeft = Math.max(0, pad.x - minX);
    const growTop = Math.max(0, pad.top - minY);
    if (growLeft > 0 || growTop > 0) {
      const own = geo.get(containerId)!;
      own.x -= growLeft;
      own.y -= growTop;
      // 顶层容器往左长出去了：让位那一步不许再把它推回来（否则拖动被悄悄吃掉）。
      if (growLeft > 0 && !container.parentNode) anchored.add(containerId);
      // 子节点是相对坐标：容器原点外移了，子节点要同量内移才留在原来的绝对位置。
      for (const childId of childIds) {
        const g = geo.get(childId);
        if (!g) continue;
        g.x += growLeft;
        g.y += growTop;
      }
      minX += growLeft; maxX += growLeft;
      minY += growTop; maxY += growTop;
    }

    // 取"布局给的尺寸"与"装得下子节点的尺寸"的较大者：不拖动时与 builder 完全一致
    // （整行按 builder 的宽度推进，收缩会让 H_GAP 变得参差），一拖动就跟着长。
    const own = geo.get(containerId)!;
    own.w = Math.max(own.w, maxX + pad.x);
    own.h = Math.max(own.h, maxY + pad.bottom);
  }

  spreadTopLevelOverlaps(nodes, geo, anchored);

  return nodes.map((n) => {
    const g = geo.get(n.id);
    if (!g) return n;
    const samePos = g.x === n.position.x && g.y === n.position.y;
    const sameSize = g.w === nodeW(n) && g.h === nodeH(n);
    if (samePos && sameSize) return n;
    return {
      ...n,
      position: { x: g.x, y: g.y },
      style: { ...n.style, width: g.w, height: g.h },
    };
  });
}

/**
 * 给每个节点装上"标题栏当把手"，并划定子节点的活动范围。
 *
 * 范围只有一条硬墙：父容器标题栏的下沿（pad.top）。子节点再怎么拖也压不到父节点的
 * 标题上——那是层级的前后台关系，不是能商量的美观问题。其余三个方向一律放开，
 * 越界由 resolveContainerGeometry 把父容器撑大来吸收；把子节点钳在当前边框内的话，
 * "容器跟着长"这件事永远没有机会发生。
 */
function applyDragAffordances(nodes: Node[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    const handle = n.type ? DRAG_HANDLE[n.type] : undefined;
    if (!handle) return n;
    const next: Node = { ...n, draggable: true, dragHandle: handle };
    if (!n.parentNode) return next;

    const parent = byId.get(n.parentNode);
    if (!parent) return next;
    const pad = padOf(parent);
    next.extent = [
      [-DRAG_FREE, pad.top],
      [DRAG_FREE, DRAG_FREE],
    ];
    return next;
  });
}

// ── Main hook ───────────────────────────────────────────────────────────────

export function useDetroitLayout(
  steps: StepState[],
  result: NarrativeContext | null,
  collapsedIds: Set<string>,
  selectedStepId?: string | null,
  progressMap?: Map<string, number>,
  revealTimestamps?: Map<string, number>,
  pipelineStatus?: string,
  expertGroups: AnnounceStepGroup[] = [],
  nodeDrags: Record<string, { dx: number; dy: number }> = {},
  entryCard: EntryCard | null = null,
): { layoutNodes: Node[]; layoutEdges: Edge[] } {
  return useMemo(() => {
    try {
      return computeLayoutImpl(
        steps, result, collapsedIds, selectedStepId, progressMap, revealTimestamps, pipelineStatus,
        expertGroups, nodeDrags, entryCard,
      );
    } catch (err) {
      // 任何下游崩溃都精准 log + 返回空 layout（避免整个画布因为某个 step 数据异常而瘫掉）。
      const e = err as Error;
      const stepsSnap = steps.map((s) => ({ id: s.id, status: s.status, hasData: s.data != null }));
      const resultKeys = result ? Object.keys(result as Record<string, unknown>) : null;
      console.error("[useDetroitLayout] layout computation crashed:", e);
      console.error("[useDetroitLayout] steps:", stepsSnap);
      console.error("[useDetroitLayout] result keys:", resultKeys);
      // 同步把错误推到 window，方便页面上的 banner 抓取（避免用户必须开 DevTools 才能看到错误）
      type LayoutErrPayload = {
        message: string;
        stack: string | undefined;
        steps: typeof stepsSnap;
        resultKeys: string[] | null;
        ts: number;
      };
      const w = window as unknown as { __narrativeLayoutError__?: LayoutErrPayload };
      w.__narrativeLayoutError__ = {
        message: `${e.name}: ${e.message}`,
        stack: e.stack,
        steps: stepsSnap,
        resultKeys,
        ts: Date.now(),
      };
      window.dispatchEvent(new CustomEvent("narrative-layout-error", { detail: w.__narrativeLayoutError__ }));
      return { layoutNodes: [], layoutEdges: [] };
    }
  }, [steps, result, collapsedIds, selectedStepId, progressMap, revealTimestamps, pipelineStatus, expertGroups, nodeDrags, entryCard]);
}

function computeLayoutImpl(
  steps: StepState[],
  result: NarrativeContext | null,
  collapsedIds: Set<string>,
  selectedStepId: string | null | undefined,
  progressMap: Map<string, number> | undefined,
  revealTimestamps: Map<string, number> | undefined,
  pipelineStatus: string | undefined,
  expertGroups: AnnounceStepGroup[],
  nodeDrags: Record<string, { dx: number; dy: number }> = {},
  entryCard: EntryCard | null = null,
): { layoutNodes: Node[]; layoutEdges: Edge[] } {
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];
  if (steps.length === 0) return { layoutNodes: [], layoutEdges: [] };
  {
    // ─ Body wrapped in extra block to keep diff minimal — body is verbatim from the old useMemo. ─

    const complexity = (result as Record<string, unknown>)?.global_control_params
      ? ((result as Record<string, unknown>).global_control_params as Record<string, unknown>)?.complexity as number ?? 3
      : 3;

    const preSteps: PreStep[] = [];

    const STEP_ID_FIX: Record<string, string> = {
      initial_story_outline: "initial_outline",
      core_settings_extraction: "core_settings",
      worldview_construction: "worldview",
      detailed_outline_batch: "detailed_outline",
    };

    for (const stepState of steps) {
      const stepId = STEP_ID_FIX[stepState.id] ?? stepState.id;
      const stepDef = PIPELINE_STEPS.find((s) => s.id === stepId);

      // 运行横幅不上画布：它报的是本次 Tier/Mode/总步数，没有产物，卡上永远写着
      // "无节点数据"。用户在入口节点已经选定了专家，画布第一眼就该是那位专家。
      // 哪些帧算横幅由后端声明（announce.metaSteps / 帧上的 meta），这里不认 id 字符串。
      if (stepState.isMeta) continue;

      // 互动影游 E1-02 三幕扩写：专属嵌套大节点（三幕剧本子组 + 人物小传/关键道具）
      if (stepId === "vn_outline_acts") {
        preSteps.push(buildOutlineActsPreStep(
          stepId, stepTitle(stepState, stepDef?.label ?? "三幕扩写"), stepState.status,
          stepState.data, result, collapsedIds,
        ));
        continue;
      }

      if (stepId === "script_scene_generation") {
        const plots = resolvePlots(steps, result);
        let questData = stepState.data;
        if (questData && typeof questData === "object") {
          const d = questData as Record<string, unknown>;
          if (d.quest_graph) questData = d.quest_graph;
        }
        if (!questData) questData = result?.quest_graph;
        const questNodes = prepareStoryNodes(toStoryNodes("quest_generation", questData, plots));
        let sceneData = stepState.data;
        if (sceneData && typeof sceneData === "object") {
          const d = sceneData as Record<string, unknown>;
          if (d.scene_map) sceneData = d.scene_map;
        }
        if (!sceneData || (typeof sceneData === "object" && !(sceneData as Record<string, unknown>)._phase2_per_node && !(sceneData as Record<string, unknown>).scenes)) {
          sceneData = result?.scene_map;
        }
        const sceneNodes = prepareStoryNodes(toStoryNodes("scene_plan", sceneData, plots));
        const compositeP1 = sceneData && typeof sceneData === "object"
          ? (sceneData as Record<string, unknown>)._phase1_by_layer as { l0: SkeletonLayerScene[]; l1: SkeletonLayerScene[]; l2: SkeletonLayerScene[] } | undefined
          : undefined;
        // 这一个 step 确实同时产出任务与场景，所以它内部才有"两支并行"的说法。
        const combined = buildSceneNestPreStep(
          stepId, stepTitle(stepState, stepDef?.label ?? "任务+场景"), stepState.status,
          questNodes, sceneNodes, collapsedIds, "qsg::scene",
          compositeP1 ?? result?.scene_map?._phase1_by_layer,
        );
        if (combined) {
          preSteps.push(combined);
          continue;
        }
        // 无产物 → 落到下面的通用路径，画一张普通卡。
      }

      /*
       * 场景生成的内部分段（骨架层 → 展开 → 合并）来自后端 scene_map 的真实产物，
       * 所以它单独有一个嵌套 builder。但它就是管线里的一步，位置由 pipelineOrder 决定：
       * 上一版把它和相隔四个席位的 quest_generation 强行并成一列上下叠放，
       * 而两者从来不并行（管线是串行 for 循环），并列排布是凭空捏的。
       */
      if (stepId === "scene_plan") {
        // 运行期 result 还是 null，骨架层随 SSE 帧挂在 step 数据上（可能再包一层 scene_map）；
        // 只读 result 的话，跑的时候骨架那一段永远不出现。
        const live = stepState.data && typeof stepState.data === "object"
          ? stepState.data as Record<string, unknown>
          : undefined;
        const liveMap = live?.scene_map && typeof live.scene_map === "object"
          ? live.scene_map as Record<string, unknown>
          : live;
        const p1 = (liveMap?._phase1_by_layer ?? result?.scene_map?._phase1_by_layer) as
          { l0: SkeletonLayerScene[]; l1: SkeletonLayerScene[]; l2: SkeletonLayerScene[] } | undefined;
        const sceneNest = buildSceneNestPreStep(
          stepId, stepTitle(stepState, stepDef?.label), stepState.status,
          [], prepareStoryNodes(getStoryNodes("scene_plan", stepState.data, result, steps)),
          collapsedIds, stepId,
          p1 ?? null,
        );
        if (sceneNest) {
          preSteps.push(sceneNest);
          continue;
        }
      }

      const isStory = stepId in STEP_STORY_EXTRACT;
      // 单 step 的 storyNodes 提取放在 try-catch 里 — 这样即使某个 step 数据异常崩了，
      // 也只是把这个 step 降级为普通 PipelineStep（不展开），其他 step 照常渲染。
      let storyNodes: StoryNode[] = [];
      if (isStory) {
        try {
          storyNodes = getStoryNodes(stepId, stepState.data, result, steps);
        } catch (err) {
          console.error(`[useDetroitLayout] getStoryNodes("${stepId}") crashed:`, err);
          storyNodes = [];
        }
      }
      const hasChildren = storyNodes.length > 0;
      const shouldExpand = isStory && hasChildren && !collapsedIds.has(stepId);

      let w = PL_W, h = PL_H;
      let storyPixels: ReturnType<typeof colRowToPixels> | null = null;
      let safeShouldExpand = shouldExpand;
      let safeStoryNodes = storyNodes;
      if (shouldExpand) {
        try {
          const layout = computeStoryLayout(storyNodes);
          storyPixels = colRowToPixels(layout);
          w = Math.max(GROUP_MIN_W, storyPixels.width);
          h = Math.max(GROUP_MIN_H, storyPixels.height);
        } catch (err) {
          console.error(`[useDetroitLayout] computeStoryLayout("${stepId}") crashed:`, err);
          safeShouldExpand = false;
          safeStoryNodes = [];
          storyPixels = null;
          w = PL_W; h = PL_H;
        }
      }

      preSteps.push({ stepId, label: stepTitle(stepState, stepDef?.label), status: stepState.status,
        isStory, storyNodes: safeStoryNodes, shouldExpand: safeShouldExpand, w, h, storyPixels });
    }

    // ── Phase 2: position + render ──────────────────────────────────────

    const maxH = Math.max(...preSteps.map((s) => s.h), PL_H);
    const centerY = INIT_Y + Math.round(maxH / 2);
    let curX = INIT_X;

    let prevNodeIds: string[] = [];
    let prevStatus = "pending";
    const pipelineNodeRects = new Map<string, ObstacleRect>();

    /*
     * 入口节点跟着进画布：它是这张图的锚点（后端拿它的 id 当 startNodeId），
     * 一开跑就消失会让人以为"我配的东西丢了"。
     *
     * 它不是 step，所以数据不来自 SSE，而来自编排态那枚 input.entry 节点 +
     * 本次运行的上下文（需求、三轴、品类）——见 useEntryCard。摆在第一列、
     * 连一条边到第一步，跨容器的那一段由 applyContainers 收到容器把手上。
     */
    if (entryCard) {
      const entryY = Math.round(centerY - PL_H / 2);
      rfNodes.push({
        id: entryCard.id,
        type: "pipelineStep",
        position: { x: INIT_X, y: entryY },
        data: {
          label: entryCard.label,
          status: "completed",
          stepType: "special",
          stepData: entryCard.fields,
        },
        style: { width: PL_W, height: PL_H },
      });
      pipelineNodeRects.set(entryCard.id, { x: INIT_X, y: entryY, w: PL_W, h: PL_H });
      curX = INIT_X + PL_W + H_GAP;
      prevNodeIds = [entryCard.id];
      prevStatus = "completed";
    }

    function outerBendFraction(srcId: string, tgtId: string): number | undefined {
      const src = pipelineNodeRects.get(srcId);
      const tgt = pipelineNodeRects.get(tgtId);
      if (!src || !tgt) return undefined;
      const srcCy = src.y + src.h / 2;
      const tgtCy = tgt.y + tgt.h / 2;
      if (Math.abs(srcCy - tgtCy) < 4) return undefined;
      const obs = Array.from(pipelineNodeRects.values()).filter(
        (r) => r !== src && r !== tgt,
      );
      return findSafeBendFraction(src.x, src.y, src.w, src.h, tgt.x, tgt.y, tgt.h, obs);
    }

    for (let i = 0; i < preSteps.length; i++) {
      const ps = preSteps[i];
      const posX = curX;

      // Pre-register current step's rects so outerBendFraction can find the target
      if (ps.fork) {
        const topY = Math.round(centerY - ps.h / 2);
        const fd = ps.fork;
        const cid = ps.sceneContainerId ?? ps.stepId;
        let scnY = topY;
        if (fd.quest) {
          pipelineNodeRects.set(`${cid}::quest`, { x: posX, y: topY, w: fd.quest.w, h: fd.quest.h });
          scnY = topY + fd.quest.h + FORK_V_GAP;
        }
        pipelineNodeRects.set(cid, { x: posX, y: scnY, w: fd.scene.containerW, h: fd.scene.containerH });
      } else {
        const posY = Math.round(centerY - ps.h / 2);
        pipelineNodeRects.set(ps.stepId, { x: posX, y: posY, w: ps.w, h: ps.h });
      }

      // ── Pipeline edges from previous step(s) ──
      if (prevNodeIds.length > 0) {
        const edgeStatus = prevStatus === "completed" ? "done" : prevStatus === "running" ? "running" : "pending";
        if (ps.fork) {
          // 入边连到这一块真正存在的顶层节点上：只有场景时就一条，
          // legacy 合并 step 同时有任务与场景时才是两条。
          const cid = ps.sceneContainerId ?? ps.stepId;
          const targets = ps.fork.quest ? [`${cid}::quest`, cid] : [cid];
          for (const pId of prevNodeIds) {
            for (const target of targets) {
              rfEdges.push({
                id: `e_pipeline_${pId}_${target}`, source: pId, target,
                type: "detroit", data: { status: edgeStatus, level: "outer", bendFraction: outerBendFraction(pId, target) },
              });
            }
          }
        } else {
          for (const pId of prevNodeIds) {
            rfEdges.push({
              id: `e_pipeline_${pId}_${ps.stepId}`, source: pId, target: ps.stepId,
              type: "detroit", data: { status: edgeStatus, level: "outer", bendFraction: outerBendFraction(pId, ps.stepId) },
            });
          }
        }
      }

      // ── Render the step ──
      if (ps.outlineNest) {
        // 互动影游 E1-02 三幕扩写：嵌套大节点
        const od = ps.outlineNest;
        const posY = Math.round(centerY - ps.h / 2);
        const onProgress = progressMap?.get(ps.stepId) ?? (ps.status === "completed" ? 100 : 0);

        // 大容器
        rfNodes.push({
          id: "vn_outline_acts", type: "storyGroup",
          position: { x: posX, y: posY },
          data: {
            label: ps.label, status: ps.status,
            childCount: 1 + od.line2Nodes.length, expanded: od.containerExpand,
            progress: onProgress,
          },
          style: { width: ps.w, height: ps.h },
        });
        pipelineNodeRects.set("vn_outline_acts", { x: posX, y: posY, w: ps.w, h: ps.h });

        if (od.containerExpand) {
          const padTop = BIG_TITLE_H + BIG_PAD;

          // 线路1（上）：三幕剧本子组（第一→二→三幕串行）
          rfNodes.push({
            id: "vn_outline_acts::acts", type: "storyGroup",
            position: { x: BIG_PAD, y: padTop },
            parentNode: "vn_outline_acts",
            data: {
              label: "三幕剧本", status: ps.status,
              childCount: od.actNodes.length, expanded: od.actsExpand,
              progress: onProgress,
            },
            style: { width: od.actsW, height: od.actsH },
          });
          if (od.actsExpand && od.actPixels) {
            renderStoryChildren(
              "vn_outline_acts::acts", od.actNodes, od.actPixels,
              ps.status, revealTimestamps, pipelineStatus, complexity, rfNodes, rfEdges,
            );
          }

          // 线路2（下）：人物小传 → 关键道具（直接挂容器的 storyChild，与线路1平级）
          if (od.line2Nodes.length > 0) {
            const y2 = padTop + od.actsH + FORK_V_GAP;
            for (let li = 0; li < od.line2Nodes.length; li++) {
              const ln = od.line2Nodes[li];
              const childX = BIG_PAD + li * (CN_W + COL_GAP);
              rfNodes.push({
                id: `vn_outline_acts__${ln.node_id}`,
                type: "storyChild",
                position: { x: childX, y: y2 },
                parentNode: "vn_outline_acts",
                data: {
                  nodeId: ln.node_id, contentId: ln.content_id,
                  name: ln.name, narrativeFunction: ln.narrative_function,
                  isBranch: false, isMerge: false, isFork: false,
                  content: ln.main_content,
                  animStartTime: -1,
                  fullData: ln._rawData,
                },
                style: { width: CN_W, height: CN_H },
              });
            }
            for (let li = 0; li < od.line2Nodes.length - 1; li++) {
              rfEdges.push({
                id: `e_vn_outline_line2_${li}`,
                source: `vn_outline_acts__${od.line2Nodes[li].node_id}`,
                target: `vn_outline_acts__${od.line2Nodes[li + 1].node_id}`,
                type: "detroit", zIndex: 1000,
                data: { status: "done" as const, level: "inner" as const, animStartTime: -1 },
              });
            }
          }
        }

        prevNodeIds = ["vn_outline_acts"];

      } else if (ps.fork) {
        const fd = ps.fork;
        const topY = Math.round(centerY - ps.h / 2);
        const cid = ps.sceneContainerId ?? ps.stepId;
        const stepProgress = progressMap?.get(ps.stepId) ?? (ps.status === "completed" ? 100 : 0);
        const emitted: string[] = [];

        // ─── 任务分支（上）：只有同一 step 真的产出了任务树才存在 ───
        let sceneY = topY;
        if (fd.quest) {
          const questId = `${cid}::quest`;
          rfNodes.push({
            id: questId, type: "storyGroup",
            position: { x: posX, y: topY },
            data: {
              label: "任务生成", status: ps.status,
              childCount: fd.quest.nodes.length, expanded: fd.quest.expand,
              progress: stepProgress,
            },
            style: { width: fd.quest.w, height: fd.quest.h },
          });
          pipelineNodeRects.set(questId, { x: posX, y: topY, w: fd.quest.w, h: fd.quest.h });
          if (fd.quest.expand) {
            renderStoryChildren(
              questId, fd.quest.nodes, fd.quest.pixels,
              ps.status, revealTimestamps, pipelineStatus, complexity, rfNodes, rfEdges,
            );
          }
          emitted.push(questId);
          sceneY = topY + fd.quest.h + FORK_V_GAP;
        }

        // ─── 场景容器：骨架层 → 展开 → 合并，每段都以产物为前提 ───
        const sd = fd.scene;
        const sceneChildCount = sd.p2Nodes.length;

        rfNodes.push({
          id: cid, type: "storyGroup",
          position: { x: posX, y: sceneY },
          data: {
            label: fd.quest ? "场景生成" : ps.label, status: ps.status,
            childCount: sceneChildCount, expanded: sd.containerExpand,
            progress: stepProgress,
          },
          style: { width: sd.containerW, height: sd.containerH },
        });
        pipelineNodeRects.set(cid, { x: posX, y: sceneY, w: sd.containerW, h: sd.containerH });
        emitted.push(cid);

        if (sd.containerExpand) {
          const padTop = BIG_TITLE_H + BIG_PAD;
          const hasP1 = sd.p1Layers.length > 0;
          const innerH = Math.max(hasP1 ? sd.p1H : 0, sceneChildCount > 0 ? sd.p2H : 0, PL_H);

          const p1Status = ps.status === "pending" ? "pending" : "completed";
          const p3Status = ps.status === "completed" ? "completed" : "pending";
          const phaseEdgeStatus = ps.status === "completed" ? "done" : ps.status === "running" ? "running" : "pending";

          // 段与段之间从左往右推进；每段是否存在由产物决定，所以宽度要一段段累加，
          // 不能像上一版那样按"固定三段"算偏移。
          let segX = BIG_PAD;
          /** 段的出口节点 id：段内边从上一段的出口连到下一段。 */
          let prevSegId: string | null = null;
          const linkSeg = (segId: string) => {
            if (prevSegId) {
              rfEdges.push({
                id: `e_${prevSegId}__${segId}`, source: prevSegId, target: segId,
                type: "detroit", zIndex: 1000, data: { status: phaseEdgeStatus, level: "inner" },
              });
            }
            prevSegId = segId;
          };

          // ── 骨架层：有几层数据就几张卡；多于一层才套「骨架提取」子容器 ──
          if (hasP1) {
            const layerCards = sd.p1Layers.map((layer) => ({
              id: `${cid}::p1::${layer.key}`,
              label: `${layer.key.toUpperCase()} 骨架 (${layer.count})`,
            }));

            if (sd.p1Grouped) {
              const p1Id = `${cid}::p1`;
              rfNodes.push({
                id: p1Id, type: "storyGroup",
                position: { x: segX, y: padTop + Math.round((innerH - sd.p1H) / 2) },
                parentNode: cid,
                data: {
                  label: "骨架提取", status: p1Status,
                  childCount: sd.p1Layers.reduce((sum, l) => sum + l.count, 0),
                  expanded: sd.p1Expand,
                  progress: p1Status === "completed" ? 100 : 0,
                },
                style: { width: sd.p1W, height: sd.p1H },
              });

              if (sd.p1Expand) {
                const cards = [...layerCards, { id: `${cid}::p1::merge`, label: "骨架合并" }];
                for (let pi = 0; pi < cards.length; pi++) {
                  rfNodes.push({
                    id: cards[pi].id, type: "pipelineStep",
                    position: { x: BIG_PAD + pi * (PL_W + INNER_GAP), y: BIG_TITLE_H + BIG_PAD },
                    parentNode: p1Id,
                    data: {
                      label: cards[pi].label, status: p1Status,
                      stepType: "pipeline", isSelected: false,
                      progress: p1Status === "completed" ? 100 : 0,
                    },
                    style: { width: PL_W, height: PL_H },
                  });
                  if (pi > 0) {
                    rfEdges.push({
                      id: `e_p1_${cards[pi - 1].id}__${cards[pi].id}`,
                      source: cards[pi - 1].id, target: cards[pi].id,
                      type: "detroit", zIndex: 1000, data: { status: phaseEdgeStatus, level: "inner" },
                    });
                  }
                }
              }
              segX += sd.p1W + INNER_GAP;
              linkSeg(p1Id);
            } else {
              // 独苗骨架层：直接摆那张卡，不套框。
              const only = layerCards[0];
              rfNodes.push({
                id: only.id, type: "pipelineStep",
                position: { x: segX, y: padTop + Math.round((innerH - PL_H) / 2) },
                parentNode: cid,
                data: {
                  label: only.label, status: p1Status,
                  stepType: "pipeline", isSelected: false,
                  progress: p1Status === "completed" ? 100 : 0,
                },
                style: { width: PL_W, height: PL_H },
              });
              segX += PL_W + INNER_GAP;
              linkSeg(only.id);
            }
          }

          // ── 场景展开：有场景树才有这一段；用户折叠时留一张折叠卡（不是撤掉） ──
          if (sceneChildCount > 0) {
            const p2Id = `${cid}::p2`;
            rfNodes.push({
              id: p2Id, type: "storyGroup",
              position: { x: segX, y: padTop + Math.round((innerH - sd.p2H) / 2) },
              parentNode: cid,
              data: {
                label: "场景展开", status: ps.status,
                childCount: sceneChildCount, expanded: sd.p2Expand,
                progress: stepProgress,
              },
              style: { width: sd.p2W, height: sd.p2H },
            });
            if (sd.p2Expand && sd.p2Pixels) {
              renderStoryChildren(
                p2Id, sd.p2Nodes, sd.p2Pixels,
                ps.status, revealTimestamps, pipelineStatus, complexity, rfNodes, rfEdges,
              );
            }
            segX += sd.p2W + INNER_GAP;
            linkSeg(p2Id);
          }

          // ── 合并：两段都在才有东西可合 ──
          if (sd.hasMerge) {
            const p3Id = `${cid}::p3`;
            rfNodes.push({
              id: p3Id, type: "pipelineStep",
              position: { x: segX, y: padTop + Math.round((innerH - PL_H) / 2) },
              parentNode: cid,
              data: {
                label: "合并", status: p3Status,
                stepType: "pipeline", isSelected: false,
                progress: p3Status === "completed" ? 100 : 0,
              },
              style: { width: PL_W, height: PL_H },
            });
            linkSeg(p3Id);
          }
        }

        prevNodeIds = emitted;

      } else if (ps.shouldExpand && ps.storyPixels) {
        const posY = Math.round(centerY - ps.h / 2);
        rfNodes.push({
          id: ps.stepId, type: "storyGroup",
          position: { x: posX, y: posY },
          data: {
            label: ps.label, status: ps.status,
            childCount: ps.storyNodes.length, expanded: true,
            progress: progressMap?.get(ps.stepId) ?? (ps.status === "completed" ? 100 : 0),
          },
          style: { width: ps.w, height: ps.h },
        });
        pipelineNodeRects.set(ps.stepId, { x: posX, y: posY, w: ps.w, h: ps.h });
        renderStoryChildren(
          ps.stepId, ps.storyNodes, ps.storyPixels,
          ps.status, revealTimestamps, pipelineStatus, complexity, rfNodes, rfEdges,
        );
        prevNodeIds = [ps.stepId];

      } else if (ps.isStory && ps.storyNodes.length > 0) {
        // 折叠态的 story step：有节点数据但被用户折叠 → 渲染为可点击展开的 storyGroup
        const posY = Math.round(centerY - ps.h / 2);
        rfNodes.push({
          id: ps.stepId, type: "storyGroup",
          position: { x: posX, y: posY },
          data: {
            label: ps.label, status: ps.status,
            childCount: ps.storyNodes.length, expanded: false,
            progress: progressMap?.get(ps.stepId) ?? (ps.status === "completed" ? 100 : 0),
          },
          style: { width: PL_W, height: PL_H },
        });
        pipelineNodeRects.set(ps.stepId, { x: posX, y: posY, w: PL_W, h: PL_H });
        prevNodeIds = [ps.stepId];

      } else if (ps.stepId === "narrative_card") {
        const posY = Math.round(centerY - ps.h / 2);
        const cardW = PL_W + 40;
        rfNodes.push({
          id: ps.stepId, type: "narrativeCard",
          position: { x: posX, y: posY },
          data: { label: ps.label, status: ps.status, card: result?.narrative_card },
          style: { width: cardW, height: PL_H },
        });
        pipelineNodeRects.set(ps.stepId, { x: posX, y: posY, w: cardW, h: PL_H });
        prevNodeIds = [ps.stepId];

      } else {
        const posY = Math.round(centerY - ps.h / 2);
        const st = steps.find((s) => s.id === ps.stepId);
        rfNodes.push({
          id: ps.stepId, type: "pipelineStep",
          position: { x: posX, y: posY },
          data: {
            label: ps.label, status: ps.status,
            stepType: PIPELINE_STEPS.find((s) => s.id === ps.stepId)?.type ?? "pipeline",
            isSelected: selectedStepId === ps.stepId,
            progress: progressMap?.get(ps.stepId) ?? (ps.status === "completed" ? 100 : 0),
            stepData: st?.data,
            // 跳过原因随卡片走：卡上直接写"已跳过：需先运行【X助手】"，
            // 用户不必去日志里翻为什么这一步没有产物。
            skipHint: st?.skipInfo?.hint,
          },
          style: { width: PL_W, height: PL_H },
        });
        pipelineNodeRects.set(ps.stepId, { x: posX, y: posY, w: PL_W, h: PL_H });
        prevNodeIds = [ps.stepId];
      }

      prevStatus = ps.status;
      curX = posX + ps.w + H_GAP;
    }

    // 顺序即因果：成员的位移先叠（席位/专家容器成形时才会把拖走的位置算进包围盒），
    // 容器自身的位移后叠，最后由 resolveContainerGeometry 自内向外把每层框重新裁到
    // "装得下所有子节点"。前两步只动位置，尺寸的事只有它一家说了算。
    const dragged = applyNodeDrags(rfNodes, nodeDrags, (n) => !isContainerId(n.id));
    const grouped = applyExpertGrouping(dragged, rfEdges, expertGroups, collapsedIds, steps);
    const withContainerDrags = applyNodeDrags(grouped.nodes, nodeDrags, (n) => isContainerId(n.id));
    const resolved = resolveContainerGeometry(withContainerDrags);
    return { layoutNodes: applyDragAffordances(resolved), layoutEdges: grouped.edges };
  }
}



