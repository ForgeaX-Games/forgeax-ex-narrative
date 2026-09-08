/**
 * M6 — composite 子 DAG 必须能调度只有 StepDescriptor 的 legacy 子步。
 *
 * 回归目标：`POST /api/narrative/agent/tpl-jrpg/run` 曾必然抛
 * `AgentDef not registered: preference_summary`，因为 CompositeRunner
 * 直接查 AgentDef registry，而 tpl-jrpg 的子步全是 legacy step。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { CompositeRunner, makeCompositeAgentDef } from "../blueprint/runners/composite-runner.js";
import { registerAgentDef, getAgentDefOrThrow } from "../blueprint/agent-def-registry.js";
import type { CompositeConfig, StepBlueprint } from "../blueprint/types.js";
import { registerStep } from "../core/step-registry.js";
import { hasNarrativeAgent } from "../core/agent-registry.js";
import { executeAgent } from "../core/agent-exec.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

const fakeLlm = {} as LLMClient;

/** 记录执行顺序的 legacy step，输出写入 ctx[`out_${id}`]。 */
function registerFakeLegacyStep(id: string, trace: string[]): void {
  registerStep({
    id,
    name: `fake ${id}`,
    dependsOn: [],
    outputFields: [`out_${id}`],
    fn: async (ctx) => {
      trace.push(id);
      (ctx as Record<string, unknown>)[`out_${id}`] = `${id}-done`;
    },
  });
}

function compositeStep(id: string, config: CompositeConfig): StepBlueprint {
  const def = makeCompositeAgentDef(id, `fake composite ${id}`, config);
  registerAgentDef(def);
  return {
    stepId: id,
    index: 0,
    agentDef: def,
    // 父 composite 的提示词必须不被子步继承。
    resolvedPrompts: { systemPrompt: "PARENT-SYS", userPromptTemplate: "PARENT-USER" },
    executionParams: { temperature: 0.7, retryCount: 3, streaming: false, responseFormat: "json" },
  };
}

describe("M6 composite 调度 legacy 子步", () => {
  const trace: string[] = [];

  beforeAll(() => {
    for (const id of ["m6_a", "m6_b", "m6_c", "m6_d"]) {
      registerFakeLegacyStep(id, trace);
    }
  });

  it("按拓扑波次跑完全 legacy 子 DAG 并写回 ctx", async () => {
    trace.length = 0;
    const step = compositeStep("m6.parent", {
      children: ["m6_a", "m6_b", "m6_c", "m6_d"],
      edges: [
        { source: "m6_a", target: "m6_b" },
        { source: "m6_a", target: "m6_c" },
        { source: "m6_b", target: "m6_d" },
        { source: "m6_c", target: "m6_d" },
      ],
    });
    const ctx = { user_input: "测试" } as unknown as NarrativeContext;

    const results = (await new CompositeRunner().execute(step, ctx, fakeLlm)) as Array<{
      agentId: string;
      output: unknown;
    }>;

    expect(trace[0]).toBe("m6_a");
    expect(trace.at(-1)).toBe("m6_d");
    expect(new Set(trace.slice(1, 3))).toEqual(new Set(["m6_b", "m6_c"]));
    expect(results.map((r) => r.agentId)).toHaveLength(4);
    expect((ctx as Record<string, unknown>).out_m6_d).toBe("m6_d-done");
  });

  it("legacy 子步的产出通过 outputField 回填", async () => {
    const ctx = {} as unknown as NarrativeContext;
    const outcome = await executeAgent("m6_a", ctx, fakeLlm);
    expect(outcome.via).toBe("legacy");
    expect(outcome.outputField).toBe("out_m6_a");
    expect(outcome.output).toBe("m6_a-done");
  });

  // M9：单 agent SSE 靠 onAgentComplete 逐子步出帧，缺一个子步就等于画布上少一个节点。
  it("每个子步各报一次 onAgentComplete（单 agent SSE 的帧来源）", async () => {
    trace.length = 0;
    const step = compositeStep("m9.parent", {
      children: ["m6_a", "m6_b"],
      edges: [{ source: "m6_a", target: "m6_b" }],
    });
    const completed: Array<{ id: string; output: unknown }> = [];
    const progressed: string[] = [];
    await new CompositeRunner().execute(
      step,
      { user_input: "x" } as unknown as NarrativeContext,
      fakeLlm,
      {
        onProgress: (id) => progressed.push(id),
        onAgentComplete: (id, output) => completed.push({ id, output }),
      },
    );
    expect(completed.map((c) => c.id)).toEqual(["m6_a", "m6_b"]);
    expect(completed[0]!.output).toBe("m6_a-done");
    expect(progressed).toContain("m6_a");
    expect(progressed).toContain("m6_b");
  });

  it("拒绝自引用嵌套", async () => {
    const step = compositeStep("m6.selfref", { children: ["m6.selfref"] });
    await expect(
      new CompositeRunner().execute(step, {} as unknown as NarrativeContext, fakeLlm),
    ).rejects.toThrow(/cannot nest itself/);
  });

  it("跨层环被 nestAncestors 拦截", async () => {
    registerAgentDef(
      makeCompositeAgentDef("m6.inner", "inner", { children: ["m6.outer"] }),
    );
    const step = compositeStep("m6.outer", { children: ["m6.inner"] });
    await expect(
      new CompositeRunner().execute(step, {} as unknown as NarrativeContext, fakeLlm),
    ).rejects.toThrow(/cycle detected/);
  });
});

describe("M6 真实 tpl-jrpg composite 可解析", () => {
  it("tpl-jrpg 的每个子步都能经统一门面解析（不再抛 AgentDef not registered）", () => {
    for (const id of ["tpl-jrpg", "expert.jrpg"]) {
      const config = getAgentDefOrThrow(id).structure.config as CompositeConfig;
      expect(config.children.length).toBeGreaterThan(0);
      const unresolved = config.children.filter((child) => !hasNarrativeAgent(child));
      expect(unresolved).toEqual([]);
    }
  });
});
