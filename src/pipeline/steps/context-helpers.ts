/**
 * 叙事管线上下文辅助函数
 *
 * 为 L0-L4 各步骤提供可复用的上下文构建工具：
 *   - 角色/道具摘要（过滤非叙事字段，保留叙事关键信息）
 *   - 故事弧摘要
 *   - 祖先链上下文（L3/L4 用）
 *   - 跨组邻居摘要（L1/L2 分组填充用）
 *   - 滑动窗口摘要（拓扑分层执行时传递前驱信息）
 *   - 拓扑分层（分支并行 + 主干顺序）
 */
import type {
  CharacterSheet,
  GameItem,
  InitialOutline,
  NarrativeContext,
  FrameworkNode,
  OutlineNode,
} from "../../types/index.js";

/**
 * 角色摘要：保留叙事相关字段，过滤 game_mechanics / visual_prompt 等。
 * L0/L1/L2 大纲填充时使用；L3/L4 已使用全量角色档案。
 */
export function buildCharacterDigest(sheets: CharacterSheet[]): string {
  if (!sheets || sheets.length === 0) return "（无角色档案）";
  return sheets.map((c) => {
    const pd = c.psychological_drivers as Record<string, unknown> | undefined;
    const pl = c.personal_life;
    const parts = [
      `- ${c.name}（${c.label}）`,
      c.role_in_story ? `故事定位: ${c.role_in_story}` : "",
      pd?.core_motivation ? `核心动机: ${pd.core_motivation}` : "",
      c.character_arc_spectrum ? `弧光: ${c.character_arc_spectrum}` : "",
      c.background_information
        ? `背景: ${c.background_information.slice(0, 80)}${c.background_information.length > 80 ? "..." : ""}`
        : "",
      formatRelationships(c.relationships),
      pl?.speech_pattern ? `说话方式: ${pl.speech_pattern}` : "",
      pl?.private_wish ? `内心期待: ${pl.private_wish}` : "",
      pl?.vulnerability ? `矛盾面: ${pl.vulnerability}` : "",
      formatIndependentBonds(pl?.independent_bonds),
    ];
    return parts.filter(Boolean).join("\n  ");
  }).join("\n");
}

function formatIndependentBonds(
  bonds: Array<{ name: string; relationship: string; detail: string }> | undefined,
): string {
  if (!bonds || bonds.length === 0) return "";
  const items = bonds.map((b) => `${b.name}(${b.relationship}: ${b.detail})`);
  return `私人牵绊: ${items.join("; ")}`;
}

function formatRelationships(rel: Record<string, unknown> | undefined): string {
  if (!rel) return "";
  const parts: string[] = [];
  for (const [key, val] of Object.entries(rel)) {
    if (Array.isArray(val) && val.length > 0) {
      const items = val.map((v: Record<string, unknown>) => {
        if (typeof v === "object" && v !== null) {
          const name = v.name ?? v.character ?? "";
          const r = v.relationship ?? v.description ?? v.type ?? "";
          return name ? `${name}(${r})` : String(r);
        }
        return String(v);
      }).filter(Boolean).slice(0, 5);
      if (items.length > 0) parts.push(`${key}: ${items.join(", ")}`);
    }
  }
  return parts.length > 0 ? `关系: ${parts.join("; ")}` : "";
}

/**
 * 道具摘要：名称 + 品类 + 稀有度 + 关联角色。
 */
export function buildItemDigest(items: GameItem[]): string {
  if (!items || items.length === 0) return "（无道具清单）";
  return items.map((i) => {
    const owner = i.related_character || i.initial_owner || "";
    return `- ${i.name}（${i.category}, ${i.rarity}${owner ? `, 关联: ${owner}` : ""}）: ${i.description.slice(0, 60)}`;
  }).join("\n");
}

/**
 * 故事弧光摘要：从 initial_story_outline 提取 theme / character_arc / key_plot_points。
 */
export function buildStoryArcDigest(outline: InitialOutline | undefined): string {
  if (!outline) return "（无）";
  const parts = [
    outline.theme ? `主题: ${outline.theme}` : "",
    outline.character_arc ? `角色弧光: ${outline.character_arc}` : "",
    outline.main_conflict ? `主线冲突: ${outline.main_conflict}` : "",
    outline.key_plot_points?.length > 0
      ? `关键节点: ${outline.key_plot_points.join("；")}`
      : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * L3/L4 祖先链上下文：从 L2 node_id 反推 L1 → L0 祖先，提供层级定位。
 *
 * node_id 编码规则：L0="1", L1="1_2", L2="1_2_1"
 * 通过拆分 node_id 的下划线层级，从 ctx 中查找对应的 L0/L1 节点。
 */
export function buildAncestorChainContext(
  nodeId: string,
  ctx: NarrativeContext,
): string {
  const parts: string[] = [];

  const segments = nodeId.split("_");

  // L0: first segment (e.g. "1" from "1_2_1", or "3a" from "3a_1_1")
  // Detroit encoding: branch nodes use letter suffix like "3a"/"3b"
  if (segments.length >= 1) {
    const rawL0 = segments[0];
    const fwNodes = ctx.story_framework?.framework.nodes ?? [];
    // exact match first (handles "3a"), fallback to stripped numeric (handles legacy)
    const l0Node = fwNodes.find((n) => n.node_id === rawL0)
      ?? fwNodes.find((n) => n.node_id === rawL0.replace(/[a-z]+$/, ""));
    const l0Id = l0Node?.node_id ?? rawL0;
    if (l0Node) {
      parts.push(
        `L0 [${l0Id}] ${l0Node.name}（${l0Node.narrative_function}）: ${(l0Node.main_content ?? "").slice(0, 120)}`,
      );
    }
  }

  // L1: first two segments (e.g. "1_2" from "1_2_1")
  if (segments.length >= 2) {
    const l1Id = segments.slice(0, 2).join("_");
    const l1Node = ctx.outlines_generated?.outlines.find(
      (n) => n.node_id === l1Id,
    );
    if (l1Node) {
      parts.push(
        `L1 [${l1Id}] ${l1Node.name}（${l1Node.narrative_stage}）: ${l1Node.content.slice(0, 120)}`,
      );
    }
  }

  if (parts.length === 0) return "";
  return parts.join("\n");
}

/**
 * 跨组邻居摘要：找到当前父节点在同层级中的前后邻居，提供衔接上下文。
 *
 * L1 分组填充时 allParents = frameworkNodes (L0 nodes)
 * L2 分组填充时 allParents = outlineNodes (L1 nodes)
 */
export function buildAdjacentGroupDigest<
  T extends { node_id: string; name: string; next_node?: string[]; prev_node?: string[] },
>(
  currentParentId: string,
  allParents: T[],
): string {
  const parentMap = new Map(allParents.map((p) => [p.node_id, p]));
  const current = parentMap.get(currentParentId);
  if (!current) return "";

  const lines: string[] = [];

  // prev neighbors
  const prevIds = (current as { prev_node?: string[] }).prev_node ?? [];
  for (const pid of prevIds) {
    const prev = parentMap.get(pid);
    if (!prev) continue;
    const content = getNodeContent(prev);
    lines.push(`前序 [${pid}] ${prev.name}: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`);
  }

  // next neighbors
  const nextIds = (current as { next_node?: string[] }).next_node ?? [];
  for (const nid of nextIds) {
    const next = parentMap.get(nid);
    if (!next) continue;
    const content = getNodeContent(next);
    lines.push(`后续 [${nid}] ${next.name}: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`);
  }

  if (lines.length === 0) return "";
  return lines.join("\n");
}

function getNodeContent(node: Record<string, unknown>): string {
  // FrameworkNode uses main_content, OutlineNode uses content
  return String(node.main_content ?? node.content ?? "");
}

/**
 * 滑动窗口摘要：截取已生成内容的最后 maxLen 字作为前驱上下文。
 * 用于拓扑分层执行时，让后继节点了解前驱实际生成了什么、如何收束。
 */
export function buildSlidingWindowSummary(
  content: string,
  maxLen = 200,
): string {
  if (!content) return "";
  if (content.length <= maxLen) return content;
  return "..." + content.slice(-maxLen);
}

/**
 * 拓扑分层：将 DAG 节点按依赖关系分为可并行执行的层。
 *
 * 同层节点互不依赖 → 可并行；层间顺序执行。
 * 分支点的多个后继自然落入同一层 → 并行；
 * 合并点等所有前驱完成后才进入下一层。
 *
 * 基于 Kahn's algorithm (BFS topological sort)，与 topo-sort.ts 的
 * topologicalWaves 逻辑一致，但泛型化以支持 DetailedOutlineNode / PlotNode 等。
 */
export function topologicalLayers<
  T extends { node_id: string; prev_node?: string[]; next_node?: string[] },
>(nodes: T[]): T[][] {
  const nodeMap = new Map(nodes.map((n) => [n.node_id, n]));
  const nodeIds = new Set(nodes.map((n) => n.node_id));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const n of nodes) {
    if (!inDegree.has(n.node_id)) inDegree.set(n.node_id, 0);
    if (!adjList.has(n.node_id)) adjList.set(n.node_id, []);
    for (const next of n.next_node ?? []) {
      if (!nodeIds.has(next)) continue;
      adjList.get(n.node_id)!.push(next);
      inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
    }
  }

  const layers: T[][] = [];
  let queue = nodes.filter((n) => (inDegree.get(n.node_id) ?? 0) === 0);

  while (queue.length > 0) {
    layers.push(queue);
    const nextQueue: T[] = [];
    for (const node of queue) {
      for (const nextId of adjList.get(node.node_id) ?? []) {
        const deg = (inDegree.get(nextId) ?? 1) - 1;
        inDegree.set(nextId, deg);
        if (deg === 0) {
          const nextNode = nodeMap.get(nextId);
          if (nextNode) nextQueue.push(nextNode);
        }
      }
    }
    queue = nextQueue;
  }

  // safety: nodes not reached by BFS (cycles or disconnected) get appended as final layer
  const visited = new Set(layers.flat().map((n) => n.node_id));
  const remaining = nodes.filter((n) => !visited.has(n.node_id));
  if (remaining.length > 0) layers.push(remaining);

  return layers;
}
