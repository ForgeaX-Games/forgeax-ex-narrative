/**
 * universal-agent/runner.ts  (B-M2)
 * ─────────────────────────────────────────────────────────────────
 * 通用三件套主流程：plan → execute → evaluate → write。
 *
 * 入口：
 *   await runUniversalAgent(spec, ctx, llm)
 *
 * 调用契约：
 *   - 输入 ctx.demand_analysis.narrative_needs 决定计划
 *   - 失败处理：
 *       · 任一 capability 异常 → 抛出（保留 stack trace）
 *       · 评估器低分 → 自动重试（带 improvementHint），超过 maxRetries 仍写入最后结果
 *   - 不修改 ctx 中除 spec.outputField 之外的字段（只读其它）
 */

import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { getStepSkill } from "../../../knowledge/game-narrative/skill-loader.js";
import type { CapabilityContext, CapabilityResult, UniversalAgentSpec } from "./types.js";
import { planAgent } from "./planner.js";
import { evaluateOutput } from "./evaluator.js";

/**
 * 执行一个 Universal Agent。结果写入 ctx[spec.outputField]。
 */
export async function runUniversalAgent<TOutput>(
  spec: UniversalAgentSpec<TOutput>,
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<TOutput> {
  // ─── Plan ────────────────────────────────────────────────────────────
  const plan = planAgent(spec.capabilities, ctx);

  if (process.env.NARRATIVE_AGENT_DEBUG === "1") {
    console.log(`[universal-agent:${spec.name}] plan: ${plan.enabled.length} enabled, ${plan.skipped.length} skipped`);
    for (const s of plan.skipped) {
      console.log(`  skip ${s.capability.id} — ${s.reason}`);
    }
  }

  // 全部裁掉时走 emptyFallback
  if (plan.enabled.length === 0) {
    const fallback = spec.emptyFallback ? spec.emptyFallback() : (undefined as unknown as TOutput);
    writeOutput(ctx, spec.outputField, fallback);
    return fallback;
  }

  // ─── Execute (with retry-on-eval-fail) ───────────────────────────────
  const maxRetries = spec.evaluator?.maxRetries ?? 1;
  let aggregated: TOutput | null = null;
  let lastImprovementHint: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const results: CapabilityResult[] = [];
    for (const cap of plan.enabled) {
      const skillBlock = getStepSkill(plan.genreCode ?? null, spec.stepId);
      const capCtx: CapabilityContext = {
        needs: plan.needs,
        genreCode: plan.genreCode,
        skill: skillBlock,
        capabilityId: cap.id,
      };
      // attempt > 0 时，给 ctx 临时挂一个 hint（capability 自行决定是否使用）
      if (attempt > 0 && lastImprovementHint) {
        (ctx as Record<string, unknown>).__universal_agent_retry_hint = lastImprovementHint;
      }
      const t0 = Date.now();
      try {
        const out = await cap.execute(ctx, llm, capCtx);
        results.push({ capabilityId: cap.id, output: out, durationMs: Date.now() - t0 });
      } finally {
        delete (ctx as Record<string, unknown>).__universal_agent_retry_hint;
      }
    }

    aggregated = spec.aggregate(results, ctx);

    // ─── Evaluate ────────────────────────────────────────────────────
    if (!spec.evaluator || spec.evaluator.disabled) break;

    const verdict = await evaluateOutput(
      aggregated,
      spec.evaluator,
      llm,
      `Agent: ${spec.name} / Step: ${spec.stepId} / Genre: ${plan.genreCode ?? "?"} / Attempt: ${attempt + 1}`,
    );

    if (process.env.NARRATIVE_AGENT_DEBUG === "1") {
      console.log(`[universal-agent:${spec.name}] eval attempt ${attempt + 1}: score=${verdict.score.toFixed(2)} ${verdict.passed ? "PASS" : "FAIL"}`);
    }

    if (verdict.passed) break;
    lastImprovementHint = verdict.improvementHint ?? verdict.reasoning;
    if (attempt >= maxRetries) {
      // 重试耗尽：保留最后一次结果，但日志告警
      console.warn(`[universal-agent:${spec.name}] eval still failing after ${maxRetries + 1} attempts, accepting last output`);
      break;
    }
  }

  const finalOutput = aggregated as TOutput;
  writeOutput(ctx, spec.outputField, finalOutput);
  return finalOutput;
}

function writeOutput(ctx: NarrativeContext, field: string, value: unknown): void {
  (ctx as Record<string, unknown>)[field] = value;
}
