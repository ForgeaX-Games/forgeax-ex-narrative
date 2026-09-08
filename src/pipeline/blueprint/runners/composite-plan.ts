/**
 * composite-plan.ts — composite 子 DAG 波次规划（无 Runner 依赖，避免循环 import）
 */
import type { CompositeConfig } from "../types.js";

/**
 * 将 children + edges + parallelGroups 规划为执行波次。
 * - 有 edges：Kahn 拓扑，同一入度层可并发
 * - 无 edges：按 children 顺序；parallelGroups 内并发
 */
export function planExecutionWaves(config: CompositeConfig): string[][] {
  const { children, edges, parallelGroups } = config;
  if (children.length === 0) return [];

  if (!edges?.length) {
    return wavesFromOrderAndGroups(children, parallelGroups);
  }

  const childSet = new Set(children);
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of children) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    if (!childSet.has(e.source) || !childSet.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const waves: string[][] = [];
  const remaining = new Set(children);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => (indegree.get(id) ?? 0) === 0);
    if (ready.length === 0) {
      for (const id of remaining) waves.push([id]);
      break;
    }
    const wave = mergeWithParallelGroups(ready, parallelGroups);
    for (const group of wave) {
      waves.push(group);
      for (const id of group) {
        remaining.delete(id);
        for (const next of adj.get(id) ?? []) {
          indegree.set(next, (indegree.get(next) ?? 1) - 1);
        }
      }
    }
  }
  return waves;
}

function wavesFromOrderAndGroups(
  children: string[],
  parallelGroups?: string[][],
): string[][] {
  if (!parallelGroups?.length) {
    return children.map((id) => [id]);
  }
  const grouped = new Set<string>();
  const waves: string[][] = [];
  const groupIndex = new Map<string, number>();
  parallelGroups.forEach((g, i) => {
    for (const id of g) groupIndex.set(id, i);
  });

  let i = 0;
  while (i < children.length) {
    const id = children[i]!;
    const gi = groupIndex.get(id);
    if (gi === undefined) {
      waves.push([id]);
      grouped.add(id);
      i++;
      continue;
    }
    const group = parallelGroups[gi]!.filter((x) => children.includes(x) && !grouped.has(x));
    waves.push(group);
    for (const x of group) grouped.add(x);
    while (i < children.length && grouped.has(children[i]!)) i++;
  }
  return waves;
}

function mergeWithParallelGroups(
  ready: string[],
  parallelGroups?: string[][],
): string[][] {
  if (!parallelGroups?.length) {
    return [ready];
  }
  const used = new Set<string>();
  const waves: string[][] = [];
  for (const g of parallelGroups) {
    const hit = g.filter((id) => ready.includes(id));
    if (hit.length > 0) {
      waves.push(hit);
      for (const id of hit) used.add(id);
    }
  }
  for (const id of ready) {
    if (!used.has(id)) waves.push([id]);
  }
  return waves.length > 0 ? waves : [ready];
}
