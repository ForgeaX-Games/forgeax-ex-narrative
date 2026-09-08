/**
 * universal-agent/planner.ts  (B-M2)
 * ─────────────────────────────────────────────────────────────────
 * Plan 阶段：根据 needs 矩阵 + 品类元信息决定本次启用哪些 capability。
 *
 * 决策规则（按优先级）：
 *   1. capability.needsKeys 为空 → 永远启用
 *   2. 任一 needsKey 在 needs 矩阵的当前分数 >= capability.minNeed → 启用
 *   3. 否则跳过，记录跳过原因
 *
 * Plan 是纯函数，可独立单测；不调用 LLM。
 */

import type { NarrativeContext } from "../../../types/index.js";
import type { AgentPlan, Capability, NeedsKey, NeedsMatrix, NeedsScore } from "./types.js";

const DEFAULT_NEEDS: Readonly<NeedsMatrix> = Object.freeze({
  W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 0, L: 0,
});

const ALL_NEED_KEYS: NeedsKey[] = ["W", "C", "S", "D", "Q", "E", "I", "U", "L"];

/**
 * 从 ctx 中读取 needs 矩阵；缺失时回退到全 0 默认值。
 */
export function extractNeedsMatrix(ctx: NarrativeContext): Readonly<NeedsMatrix> {
  const raw = ctx.demand_analysis?.narrative_needs;
  if (!raw || typeof raw !== "object") return DEFAULT_NEEDS;
  const matrix: NeedsMatrix = {};
  for (const key of ALL_NEED_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "number" && v >= 0 && v <= 3) {
      matrix[key] = Math.round(v) as NeedsScore;
    }
  }
  return matrix;
}

/**
 * 根据 needs + capabilities 列表生成执行计划。
 */
export function planAgent(
  capabilities: Capability[],
  ctx: NarrativeContext,
): AgentPlan {
  const needs = extractNeedsMatrix(ctx);
  const genreCode = ctx.tier_detection?.genre_code ?? ctx.demand_analysis?.genre_code ?? null;

  const enabled: Capability[] = [];
  const skipped: AgentPlan["skipped"] = [];

  for (const cap of capabilities) {
    if (cap.needsKeys.length === 0) {
      enabled.push(cap);
      continue;
    }
    const minNeed = cap.minNeed ?? 1;
    let hit: NeedsKey | null = null;
    for (const k of cap.needsKeys) {
      const v = needs[k] ?? 0;
      if (v >= minNeed) {
        hit = k;
        break;
      }
    }
    if (hit) {
      enabled.push(cap);
    } else {
      const detail = cap.needsKeys
        .map((k) => `${k}=${needs[k] ?? 0}`)
        .join(",");
      skipped.push({
        capability: cap,
        reason: `needs[${detail}] 全部 < ${minNeed}`,
      });
    }
  }

  return { enabled, skipped, needs, genreCode };
}
