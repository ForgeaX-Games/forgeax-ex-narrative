/**
 * universal-agent runner.test.ts (B-M2)
 *
 * 测试范围：
 *   1. planAgent — 按 needs 过滤 capability，永远启用项 / minNeed 阈值
 *   2. runUniversalAgent — execute → aggregate 写入 ctx
 *   3. evaluator 集成 — 低分 retry，retry hint 注入 ctx
 *   4. emptyFallback — needs 全 0 时走 fallback 路径
 */

import { describe, it, expect, vi } from "vitest";
import type { NarrativeContext } from "../../../../types/index.js";
import type { LLMClient } from "../../../runtime/llm-client.js";
import { runUniversalAgent } from "../runner.js";
import { planAgent } from "../planner.js";
import type { Capability, UniversalAgentSpec } from "../types.js";

function makeCtx(needs: Partial<Record<string, number>>, genreCode = "rpg-jrpg"): NarrativeContext {
  return {
    user_input: "测试用户输入",
    tier_detection: {
      tier: "tier1",
      genre_code: genreCode,
      genre_name: "test",
      reasoning: "test",
    },
    demand_analysis: {
      genre_code: genreCode,
      genre_name: "test",
      tier: "tier1",
      theme: { code: "auto", name: "auto" },
      volume: { duration_minutes: 0, feasibility: "ok" },
      narrative_needs: needs as Record<string, number>,
      narrative_type: "structured" as never,
      required_systems: [],
      recommended_systems: [],
      loop_templates: { system_loop: [], gameplay_loop: [], resource_loop: [] },
      narrative_routing: { available_modes: [], recommended_mode: "" },
      reasoning: "",
    } as never,
  } as NarrativeContext;
}

function fakeLLM(): LLMClient {
  return {
    callWithRetry: vi.fn(),
  } as unknown as LLMClient;
}

describe("universal-agent / planner", () => {
  const cap = (id: string, needsKeys: string[], minNeed = 1): Capability => ({
    id,
    description: id,
    needsKeys: needsKeys as never,
    minNeed: minNeed as never,
    execute: async () => ({ id }),
  });

  it("enables capability whose needsKeys is empty (always-on)", () => {
    const ctx = makeCtx({ W: 0, C: 0, S: 0 });
    const plan = planAgent([cap("base", []), cap("worldview", ["W"])], ctx);
    expect(plan.enabled.map((c) => c.id)).toContain("base");
    expect(plan.enabled.map((c) => c.id)).not.toContain("worldview");
  });

  it("enables capability when ANY needsKey >= minNeed", () => {
    const ctx = makeCtx({ W: 0, C: 2, S: 0 });
    const plan = planAgent([cap("char_or_world", ["W", "C"])], ctx);
    expect(plan.enabled.map((c) => c.id)).toEqual(["char_or_world"]);
  });

  it("respects minNeed threshold (skip when all < minNeed)", () => {
    const ctx = makeCtx({ S: 1, Q: 1 });
    const plan = planAgent([cap("heavy_story", ["S", "Q"], 3)], ctx);
    expect(plan.enabled).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toMatch(/< 3/);
  });

  it("falls back to default 0 needs when ctx has no demand_analysis", () => {
    const ctx = { user_input: "x" } as NarrativeContext;
    const plan = planAgent([cap("requires_W", ["W"])], ctx);
    expect(plan.enabled).toEqual([]);
  });
});

describe("universal-agent / runner", () => {
  it("executes enabled capabilities and aggregates output", async () => {
    const ctx = makeCtx({ W: 3, C: 3, S: 3 });
    const llm = fakeLLM();

    const exec1 = vi.fn().mockResolvedValue({ kind: "world", data: "w" });
    const exec2 = vi.fn().mockResolvedValue({ kind: "char", data: "c" });
    const exec3 = vi.fn().mockResolvedValue({ kind: "skipped" });

    const spec: UniversalAgentSpec<{ items: unknown[] }> = {
      stepId: "test_step",
      name: "TestAgent",
      outputField: "test_output",
      capabilities: [
        { id: "world", description: "w", needsKeys: ["W"], execute: exec1 },
        { id: "char",  description: "c", needsKeys: ["C"], execute: exec2 },
        { id: "lore",  description: "l", needsKeys: ["L"], execute: exec3 }, // L=0, should skip
      ],
      aggregate: (results) => ({ items: results.map((r) => r.output) }),
    };

    const out = await runUniversalAgent(spec, ctx, llm);
    expect(exec1).toHaveBeenCalledOnce();
    expect(exec2).toHaveBeenCalledOnce();
    expect(exec3).not.toHaveBeenCalled();
    expect(out.items).toHaveLength(2);
    expect((ctx as Record<string, unknown>).test_output).toEqual(out);
  });

  it("uses emptyFallback when plan is empty", async () => {
    const ctx = makeCtx({ W: 0, C: 0, S: 0 });
    const llm = fakeLLM();
    const exec = vi.fn();

    const spec: UniversalAgentSpec<{ stub: true }> = {
      stepId: "test_step",
      name: "TestAgent",
      outputField: "fallback_output",
      capabilities: [
        { id: "world", description: "w", needsKeys: ["W"], execute: exec },
      ],
      aggregate: () => ({ stub: true }),
      emptyFallback: () => ({ stub: true }),
    };

    const out = await runUniversalAgent(spec, ctx, llm);
    expect(exec).not.toHaveBeenCalled();
    expect(out).toEqual({ stub: true });
    expect((ctx as Record<string, unknown>).fallback_output).toEqual({ stub: true });
  });

  it("retries when evaluator scores below minScore (with hint injection)", async () => {
    const ctx = makeCtx({ W: 3 });
    const llm = {
      callWithRetry: vi.fn()
        // first eval call → low score
        .mockResolvedValueOnce(JSON.stringify({ score: 0.3, reasoning: "weak", improvement: "add tension" }))
        // second eval call → pass
        .mockResolvedValueOnce(JSON.stringify({ score: 0.85, reasoning: "good" })),
    } as unknown as LLMClient;

    const exec = vi.fn().mockImplementation(async (ctxArg: NarrativeContext) => {
      const hint = (ctxArg as Record<string, unknown>).__universal_agent_retry_hint;
      return { attempt: hint ? "with-hint" : "fresh", hint };
    });

    const spec: UniversalAgentSpec<{ output: unknown }> = {
      stepId: "test_step",
      name: "TestAgent",
      outputField: "out",
      capabilities: [
        { id: "world", description: "w", needsKeys: ["W"], execute: exec },
      ],
      aggregate: (r) => ({ output: r.map((x) => x.output) }),
      evaluator: { minScore: 0.6, maxRetries: 1 },
    };

    await runUniversalAgent(spec, ctx, llm);
    expect(exec).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    // first call: no hint
    expect(exec.mock.calls[0][0].__universal_agent_retry_hint).toBeUndefined();
    // second call: hint present DURING execution (cleared after)
    // We assert via the captured output:
    const stored = (ctx as Record<string, unknown>).out as { output: Array<{ attempt: string }> };
    expect(stored.output[0].attempt).toBe("with-hint");
    // ctx hint must be cleaned up after final run
    expect((ctx as Record<string, unknown>).__universal_agent_retry_hint).toBeUndefined();
  });

  it("accepts last output when evaluator keeps failing past maxRetries", async () => {
    const ctx = makeCtx({ W: 3 });
    const llm = {
      callWithRetry: vi.fn()
        .mockResolvedValue(JSON.stringify({ score: 0.2, reasoning: "weak forever" })),
    } as unknown as LLMClient;

    const exec = vi.fn().mockResolvedValue({ x: 1 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const spec: UniversalAgentSpec<unknown> = {
      stepId: "s",
      name: "T",
      outputField: "out",
      capabilities: [{ id: "c", description: "c", needsKeys: ["W"], execute: exec }],
      aggregate: (r) => r.map((x) => x.output),
      evaluator: { minScore: 0.6, maxRetries: 1 },
    };

    await runUniversalAgent(spec, ctx, llm);
    expect(exec).toHaveBeenCalledTimes(2); // initial + 1 retry, then accept
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("disabled evaluator → no eval calls, single execution", async () => {
    const ctx = makeCtx({ W: 3 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;
    const exec = vi.fn().mockResolvedValue({ ok: true });

    const spec: UniversalAgentSpec<unknown> = {
      stepId: "s",
      name: "T",
      outputField: "out",
      capabilities: [{ id: "c", description: "c", needsKeys: ["W"], execute: exec }],
      aggregate: (r) => r,
      evaluator: { disabled: true },
    };

    await runUniversalAgent(spec, ctx, llm);
    expect(exec).toHaveBeenCalledOnce();
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });
});
