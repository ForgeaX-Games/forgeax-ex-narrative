/**
 * Topological sort utilities for DAG-based story node processing.
 * Extracted from script-scene-generation.ts for reuse across quest/scene steps.
 */
import type { PlotNode } from "../../types/index.js";

/**
 * Group plot nodes into topological "waves". Nodes in the same wave have no
 * dependencies on each other and can be processed concurrently.
 */
export function topologicalWaves(plots: PlotNode[]): PlotNode[][] {
  const nodeMap = new Map(plots.map(p => [p.node_id, p]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  const plotIds = new Set(plots.map(p => p.node_id));

  for (const p of plots) {
    if (!inDegree.has(p.node_id)) inDegree.set(p.node_id, 0);
    if (!adjList.has(p.node_id)) adjList.set(p.node_id, []);

    for (const next of (p.next_node ?? [])) {
      if (!plotIds.has(next)) continue;
      adjList.get(p.node_id)!.push(next);
      inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
    }
  }

  const waves: PlotNode[][] = [];
  let queue = plots.filter(p => (inDegree.get(p.node_id) ?? 0) === 0);

  while (queue.length > 0) {
    waves.push(queue);
    const nextQueue: PlotNode[] = [];
    for (const node of queue) {
      for (const nextId of (adjList.get(node.node_id) ?? [])) {
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

  return waves;
}

/**
 * Split an array into chunks of the given size.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
