/**
 * 连接推断与修复（移植自 v3 的完整机制）
 *
 * 核心设计（来自 v3）：
 * - 分支路径匹配：通过 extractFullBranchPath 提取完整分支路径，
 *   areBranchesCompatible 判断两个节点是否可以连接
 * - 跨父连接：按分支路径语义匹配，而非简单的索引/数量匹配
 * - 终止父节点：尊重 L0 的 next_node=[] 约束，其子节点不自动向下连接
 * - 双向一致性：所有连接确保 prev_node ↔ next_node 双向同步
 */

interface NodeLike {
  node_id: string;
  parent_id: string;
  prev_node: string[];
  next_node: string[];
  sequence_index?: number;
  is_branch?: boolean;
}

// ── 分支路径工具（移植自 v3 node_id_parser.py） ──────────────────────────────

/**
 * 提取节点 ID 的完整分支路径。
 *
 * 例：
 *   "5_3a"       → "a"
 *   "6a_1"       → "a"
 *   "5_3a_2b"    → "a_b"
 *   "5_1"        → ""  (主干)
 */
export function extractFullBranchPath(nodeId: string): string {
  if (!nodeId) return "";
  const segments = nodeId.split("_");
  const letters: string[] = [];
  for (const seg of segments) {
    const m = seg.match(/^(\d+)([a-z])$/);
    if (m) letters.push(m[2]);
  }
  return letters.join("_");
}

/**
 * 判断两个节点的分支路径是否兼容（可以连接）。
 *
 * 规则（来自 v3，增强前缀兼容）：
 * - 无分支路径的节点（主干）可以连接任何节点
 * - 有分支路径的节点可以连接：同路径、主干、或前缀/父路径节点
 *   例：路径 "a" 兼容 "a_a"（父分支→子分支），但 "a_a" 不兼容 "a_b"（跨分支）
 */
export function areBranchesCompatible(idA: string, idB: string): boolean {
  const pathA = extractFullBranchPath(idA);
  const pathB = extractFullBranchPath(idB);
  if (!pathA || !pathB) return true;
  if (pathA === pathB) return true;
  const segsA = pathA.split("_");
  const segsB = pathB.split("_");
  const shorter = segsA.length <= segsB.length ? segsA : segsB;
  const longer = segsA.length <= segsB.length ? segsB : segsA;
  return shorter.every((s, i) => s === longer[i]);
}

// ── node_id 数值排序（统一排序逻辑） ─────────────────────────────────────────

export function compareNodeIds(a: string, b: string): number {
  const segsA = a.split("_");
  const segsB = b.split("_");
  const len = Math.min(segsA.length, segsB.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(segsA[i]) || 0;
    const nb = parseInt(segsB[i]) || 0;
    if (na !== nb) return na - nb;
    const la = segsA[i].replace(/^\d+/, "");
    const lb = segsB[i].replace(/^\d+/, "");
    if (la !== lb) return la < lb ? -1 : 1;
  }
  return segsA.length - segsB.length;
}

// ── 组内连接修复 ─────────────────────────────────────────────────────────────

export function repairIntraGroupConnections<T extends NodeLike>(nodes: T[]): T[] {
  const nodeIds = new Set(nodes.map((n) => n.node_id));
  const groups = new Map<string, T[]>();

  for (const n of nodes) {
    const group = groups.get(n.parent_id) ?? [];
    group.push(n);
    groups.set(n.parent_id, group);
  }

  for (const [, group] of groups) {
    group.sort((a, b) => {
      if (a.sequence_index !== undefined && b.sequence_index !== undefined)
        return a.sequence_index - b.sequence_index;
      return compareNodeIds(a.node_id, b.node_id);
    });

    for (let i = 0; i < group.length; i++) {
      const curr = group[i];

      if (i > 0) {
        const prev = group[i - 1];
        if (
          prev.sequence_index !== curr.sequence_index &&
          !curr.prev_node.includes(prev.node_id)
        ) {
          curr.prev_node.push(prev.node_id);
        }
      }

      if (i < group.length - 1) {
        const next = group[i + 1];
        if (
          next.sequence_index !== curr.sequence_index &&
          !curr.next_node.includes(next.node_id)
        ) {
          curr.next_node.push(next.node_id);
        }
      }
    }
  }

  for (const n of nodes) {
    n.prev_node = [...new Set(n.prev_node)].filter((id) => nodeIds.has(id));
    n.next_node = [...new Set(n.next_node)].filter((id) => nodeIds.has(id));
  }

  return nodes;
}

// ── 跨父连接推断（移植自 v3 的分支路径匹配） ───────────────────────────────

/**
 * 跨父连接推断（1v1/Nv1/1vN/NvN）
 *
 * 移植自 v3 的 fix_cross_stage_connections + route_unmerged_branches：
 * - 对每个有 next_node 的父节点，找出其子节点中的"叶子"（组内无后继者）
 * - 对每个叶子，通过分支路径匹配找到兼容的下游入口节点
 * - 终止父节点（next_node=[]）的子节点不会被自动连接到下游
 */
export function inferCrossParentConnections<T extends NodeLike>(
  nodes: T[],
  parentNodes: Array<{ node_id: string; next_node: string[] }>,
): T[] {
  const childrenByParent = new Map<string, T[]>();
  for (const n of nodes) {
    const group = childrenByParent.get(n.parent_id) ?? [];
    group.push(n);
    childrenByParent.set(n.parent_id, group);
  }

  for (const [, group] of childrenByParent) {
    group.sort((a, b) => {
      if (a.sequence_index !== undefined && b.sequence_index !== undefined)
        return a.sequence_index - b.sequence_index;
      return compareNodeIds(a.node_id, b.node_id);
    });
  }

  const link = (src: T, tgt: T) => {
    if (!src.next_node.includes(tgt.node_id)) src.next_node.push(tgt.node_id);
    if (!tgt.prev_node.includes(src.node_id)) tgt.prev_node.push(src.node_id);
  };

  for (const parent of parentNodes) {
    const myChildren = childrenByParent.get(parent.node_id);
    if (!myChildren || myChildren.length === 0) continue;

    const nextParentIds = parent.next_node;
    if (nextParentIds.length === 0) continue;

    // 收集所有下游入口节点（每个 next parent 中无组内前驱的节点）
    const entryNodes: T[] = [];
    for (const npId of nextParentIds) {
      const nextGroup = childrenByParent.get(npId);
      if (!nextGroup || nextGroup.length === 0) continue;
      const groupIds = new Set(nextGroup.map((n) => n.node_id));
      const roots = nextGroup.filter(
        (n) => !n.prev_node.some((pid) => groupIds.has(pid)),
      );
      if (roots.length > 0) {
        for (const r of roots) entryNodes.push(r);
      } else {
        entryNodes.push(nextGroup[0]);
      }
    }
    if (entryNodes.length === 0) continue;

    // 找出当前父节点子组中的叶子（组内无后继的节点）
    const groupIds = new Set(myChildren.map((n) => n.node_id));
    const leafChildren = myChildren.filter(
      (n) => !n.next_node.some((id) => groupIds.has(id)),
    );
    const exitNodes = leafChildren.length > 0 ? leafChildren : [myChildren[myChildren.length - 1]];

    // 对每个出口节点，用分支路径匹配找兼容的入口
    for (const exitNode of exitNodes) {
      const compatible = entryNodes.filter((e) =>
        areBranchesCompatible(exitNode.node_id, e.node_id),
      );

      if (compatible.length > 0) {
        for (const tgt of compatible) link(exitNode, tgt);
      } else {
        // 无兼容匹配（例如主干出口 → 所有入口）
        for (const tgt of entryNodes) link(exitNode, tgt);
      }
    }

    // 反向检查：L0 计划内的入口节点未被任何出口连接到（orphan entry fallback）
    // 例：L0 node 4 → [5a, 5b, 5c]，但 L1 只有 a/b 分支，5c_1 成为孤儿
    for (const entry of entryNodes) {
      const hasIncoming = exitNodes.some((ex) =>
        ex.next_node.includes(entry.node_id),
      );
      if (hasIncoming) continue;

      // 策略1：找分支路径兼容的出口
      const compatExits = exitNodes.filter((ex) =>
        areBranchesCompatible(ex.node_id, entry.node_id),
      );
      if (compatExits.length > 0) {
        for (const ex of compatExits) link(ex, entry);
        continue;
      }

      // 策略2：找主干出口（无分支路径的节点，可连接任何入口）
      const trunkExits = exitNodes.filter(
        (ex) => !extractFullBranchPath(ex.node_id),
      );
      if (trunkExits.length > 0) {
        for (const ex of trunkExits) link(ex, entry);
        continue;
      }

      // 策略3：所有出口都连（L0 计划了此路径，但下层缺少对应分支）
      for (const ex of exitNodes) link(ex, entry);
    }
  }

  return nodes;
}

// ── 跨分支非法连接过滤（移植自 v3 fix_parallel_branch_connections） ──────────

/**
 * 过滤跨分支的非法连接。
 * 有分支路径的节点只能连接同路径或主干节点。
 */
export function filterCrossBranchConnections<T extends NodeLike>(nodes: T[]): T[] {
  const nodeIds = new Set(nodes.map((n) => n.node_id));

  for (const n of nodes) {
    const myPath = extractFullBranchPath(n.node_id);
    if (!myPath) continue;

    n.next_node = n.next_node.filter(
      (id) => nodeIds.has(id) && areBranchesCompatible(n.node_id, id),
    );
    n.prev_node = n.prev_node.filter(
      (id) => nodeIds.has(id) && areBranchesCompatible(n.node_id, id),
    );
  }

  return nodes;
}

// ── 双向一致性（移植自 v3 ensure_bidirectional_consistency） ─────────────────

export function ensureBidirectionalConsistency<T extends NodeLike>(nodes: T[]): T[] {
  const nodeIndex = new Map(nodes.map((n) => [n.node_id, n]));

  for (const node of nodes) {
    for (const nextId of node.next_node) {
      const nxt = nodeIndex.get(nextId);
      if (nxt && !nxt.prev_node.includes(node.node_id)) {
        nxt.prev_node.push(node.node_id);
      }
    }
    for (const prevId of node.prev_node) {
      const prev = nodeIndex.get(prevId);
      if (prev && !prev.next_node.includes(node.node_id)) {
        prev.next_node.push(node.node_id);
      }
    }
  }

  return nodes;
}

// ── 环路检测（移植自 v3 node_structure_rules.py detect_cycles） ──────────────

/**
 * DFS 三色标记法检测有向图环路。
 * 返回第一个环路路径（空数组表示无环）。
 */
export function detectCycles<T extends NodeLike>(nodes: T[]): string[] {
  const nodeIds = new Set(nodes.map((n) => n.node_id));
  const graph = new Map<string, string[]>();
  for (const n of nodes) {
    graph.set(n.node_id, n.next_node.filter((id) => nodeIds.has(id)));
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): string[] {
    visited.add(nodeId);
    stack.add(nodeId);
    path.push(nodeId);

    for (const nxt of graph.get(nodeId) ?? []) {
      if (!graph.has(nxt)) continue;
      if (!visited.has(nxt)) {
        const cycle = dfs(nxt);
        if (cycle.length > 0) return cycle;
      } else if (stack.has(nxt)) {
        const idx = path.indexOf(nxt);
        if (idx >= 0) return [...path.slice(idx), nxt];
      }
    }

    stack.delete(nodeId);
    path.pop();
    return [];
  }

  for (const n of nodes) {
    if (!visited.has(n.node_id)) {
      const cycle = dfs(n.node_id);
      if (cycle.length > 0) return cycle;
    }
  }
  return [];
}

// ── 并行分支识别与合并验证（移植自 v3 node_structure_rules.py） ──────────────

/**
 * 识别并行分支组：同 parent + 同 sequence_index 的分支节点。
 * 返回 { groupKey: [nodeId, ...] } 形式（只保留 ≥2 个节点的组）。
 */
export function identifyParallelBranches<T extends NodeLike>(nodes: T[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const n of nodes) {
    if (!n.is_branch) continue;
    let seqKey: string;
    if (n.sequence_index !== undefined) {
      seqKey = `${n.parent_id}_${n.sequence_index}`;
    } else {
      // Strip the last branch letter from each segment to get the numeric prefix
      // e.g. "1_2a_3b" → segments ["1","2a","3b"] → strip last seg letter → "1_2a_3"
      const segs = n.node_id.split("_");
      const lastSeg = segs[segs.length - 1];
      const stripped = lastSeg.replace(/[a-z]$/, "");
      seqKey = [...segs.slice(0, -1), stripped].join("_");
    }
    const list = groups.get(seqKey) ?? [];
    list.push(n.node_id);
    groups.set(seqKey, list);
  }

  const result = new Map<string, string[]>();
  for (const [key, ids] of groups) {
    if (ids.length > 1) result.set(key, ids);
  }
  return result;
}

/**
 * 验证每个并行分支组至少有一个合并/后继目标。
 * 如果某组所有分支的 next_node 都为空，说明该组成了死胡同。
 */
export function validateBranchMergePairs<T extends NodeLike>(nodes: T[]): string[] {
  const errors: string[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.node_id, n]));
  const parallelGroups = identifyParallelBranches(nodes);

  for (const [groupKey, branchIds] of parallelGroups) {
    const allNext = new Set<string>();
    for (const bid of branchIds) {
      const node = nodeMap.get(bid);
      if (node) {
        for (const nid of node.next_node) allNext.add(nid);
      }
    }
    if (allNext.size === 0) {
      errors.push(`分支组 ${groupKey} (${branchIds.join(", ")}) 没有合并点或后继节点`);
    }
  }
  return errors;
}

// ── 悬挂分支修复（移植自 v3 NodeStructureFixer.fix_dangling_branches） ───────

/**
 * 修复悬挂分支：有 is_branch 标记但 next_node 为空的非末位节点。
 *
 * 策略（来自 v3）：
 * 1. 尝试按分支字母路由到对应的下游父节点的第一个子节点
 * 2. 如果找不到，检查是否有同分支字母的后续兄弟；若无，标记为 ENDING
 */
export function fixDanglingBranches<T extends NodeLike>(
  nodes: T[],
  parentNodes?: Array<{ node_id: string; next_node: string[] }>,
): { nodes: T[]; logs: string[] } {
  const logs: string[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.node_id, n]));
  const nodeIds = new Set(nodeMap.keys());

  const childrenByParent = new Map<string, T[]>();
  for (const n of nodes) {
    const group = childrenByParent.get(n.parent_id) ?? [];
    group.push(n);
    childrenByParent.set(n.parent_id, group);
  }

  const dangling = nodes.filter(
    (n) => n.is_branch && n.next_node.length === 0,
  );

  for (const node of dangling) {
    const branchPath = extractFullBranchPath(node.node_id);
    let fixed = false;

    if (parentNodes) {
      const parentNode = parentNodes.find((p) => p.node_id === node.parent_id);
      if (parentNode) {
        for (const nextParentId of parentNode.next_node) {
          const nextGroup = childrenByParent.get(nextParentId);
          if (!nextGroup || nextGroup.length === 0) continue;

          const entryId = nextGroup[0].node_id;
          const entryPath = extractFullBranchPath(entryId);

          if (!branchPath || !entryPath || branchPath === entryPath) {
            node.next_node.push(entryId);
            const entry = nodeMap.get(entryId);
            if (entry && !entry.prev_node.includes(node.node_id)) {
              entry.prev_node.push(node.node_id);
            }
            fixed = true;
            logs.push(`修复: ${node.node_id} -> ${entryId} (分支路由)`);
            break;
          }
        }
      }
    }

    if (!fixed) {
      const mySegs = node.node_id.split("_");
      const lastSeg = mySegs[mySegs.length - 1];
      const branchLetter = lastSeg.match(/^(\d+)([a-z])$/)?.[2] ?? "";

      let hasLaterSibling = false;
      for (const otherId of nodeIds) {
        if (otherId === node.node_id) continue;
        const other = nodeMap.get(otherId);
        if (!other || other.parent_id !== node.parent_id) continue;

        const otherPath = extractFullBranchPath(otherId);
        const otherBranch = otherPath.split("_").pop() ?? "";
        if (otherBranch === branchLetter && compareNodeIds(otherId, node.node_id) > 0) {
          hasLaterSibling = true;
          break;
        }
      }

      if (!hasLaterSibling) {
        (node as Record<string, unknown>).node_type = "ENDING";
        (node as Record<string, unknown>).narrative_stage = "ending";
        logs.push(`标记为结局: ${node.node_id} (分支线终点)`);
      } else {
        logs.push(`无法自动修复: ${node.node_id} (悬空分支，需手动检查)`);
      }
    }
  }

  return { nodes, logs };
}

// ── NvN 路由引擎（移植自 v3 branch_routing_engine.py fix_nvn_routing） ───────

/**
 * NvN 路由修复：
 * - 有分支路径的节点只保留兼容的 next_node
 * - 主干节点如果指向多个不同分支路径的节点，标记为 is_branch_point
 */
export function fixNvNRouting<T extends NodeLike>(nodes: T[]): T[] {
  const nodeIndex = new Map(nodes.map((n) => [n.node_id, n]));

  for (const node of nodes) {
    const nextNodes = node.next_node;
    if (nextNodes.length <= 1) continue;

    const currPath = extractFullBranchPath(node.node_id);

    if (currPath) {
      const matched = nextNodes.filter((nid) => areBranchesCompatible(node.node_id, nid));
      if (matched.length > 0) {
        node.next_node = matched;
      } else {
        const nonBranch = nextNodes.filter((nid) => !extractFullBranchPath(nid));
        if (nonBranch.length > 0) {
          node.next_node = nonBranch;
        }
      }
    } else {
      const branchPaths = new Set<string>();
      for (const nid of nextNodes) {
        const p = extractFullBranchPath(nid);
        if (p) branchPaths.add(p);
      }
      if (branchPaths.size > 1) {
        (node as Record<string, unknown>).is_branch_point = true;
      }
    }
  }

  return nodes;
}

// ── 结构验证（增强版） ────────────────────────────────────────────────────────

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  cycles: string[];
  branchMergeErrors: string[];
}

export function validateConnections<T extends NodeLike>(nodes: T[]): string[] {
  return fullValidation(nodes).errors;
}

export function fullValidation<T extends NodeLike>(nodes: T[]): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.node_id));

  for (const n of nodes) {
    for (const prevId of n.prev_node) {
      if (!nodeIds.has(prevId)) errors.push(`${n.node_id}: prev_node "${prevId}" 不存在`);
    }
    for (const nextId of n.next_node) {
      if (!nodeIds.has(nextId)) errors.push(`${n.node_id}: next_node "${nextId}" 不存在`);
    }
  }

  const firstNodes = nodes.filter((n) => n.prev_node.length === 0);
  if (firstNodes.length === 0 && nodes.length > 0) {
    errors.push("没有找到入口节点（prev_node 为空的节点）");
  }

  for (const n of nodes) {
    for (const nextId of n.next_node) {
      if (!areBranchesCompatible(n.node_id, nextId)) {
        errors.push(`${n.node_id}: 跨分支连接 → ${nextId} (路径 "${extractFullBranchPath(n.node_id)}" vs "${extractFullBranchPath(nextId)}")`);
      }
    }
  }

  const cycles = detectCycles(nodes);
  const branchMergeErrors = validateBranchMergePairs(nodes);

  if (cycles.length > 0) {
    errors.push(`[CRITICAL] 检测到环路: ${cycles.join(" → ")}`);
  }

  for (const bme of branchMergeErrors) {
    warnings.push(bme);
  }

  return { errors, warnings, cycles, branchMergeErrors };
}
