/**
 * dependency-graph.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/planner/dependency-graph.ts`：从 STEP_REGISTRY 读取 dependsOn 建图，
 * 对 Planner 选出的步骤执行拓扑排序并标记可并行组。随 `planner/` 整体搬入，
 * 理由见 `./README.md`。
 *
 * 本文件不再被任何活跃代码 import。
 */
import { STEP_REGISTRY } from "../../core/step-registry.js";

/**
 * 对给定的 step 列表做拓扑排序，返回有序序列。
 * 互不依赖的 step 聚合为 string[]（并行组）。
 */
export function topologicalSort(stepIds: string[]): (string | string[])[] {
  const stepSet = new Set(stepIds);

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of stepIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const id of stepIds) {
    const desc = STEP_REGISTRY.get(id);
    if (!desc) continue;
    for (const dep of desc.dependsOn) {
      if (!stepSet.has(dep)) continue;
      adj.get(dep)!.push(id);
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
    }
  }

  const result: (string | string[])[] = [];
  const queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    if (queue.length === 1) {
      const node = queue.shift()!;
      result.push(node);
      for (const next of adj.get(node) ?? []) {
        const newDeg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    } else {
      const parallelGroup = [...queue];
      queue.length = 0;
      result.push(parallelGroup);
      for (const node of parallelGroup) {
        for (const next of adj.get(node) ?? []) {
          const newDeg = (inDegree.get(next) ?? 1) - 1;
          inDegree.set(next, newDeg);
          if (newDeg === 0) queue.push(next);
        }
      }
    }
  }

  return result;
}
