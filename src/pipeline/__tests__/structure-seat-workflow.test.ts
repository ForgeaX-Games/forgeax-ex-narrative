import { describe, it, expect } from "vitest";
import { executeAgent } from "../core/agent-exec.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * M3 结构表达（structure 席）的席位级 composite 外壳护栏。
 *
 * "structure" 这个 id 不在 run() 的 STEP_FNS 里，也不替代 outline_batch/
 * detailed_outline 各自的独立调度——它只是把"这一席由这两步按序组成"这件事
 * 变成一个可查询、可单独调用的节点。校验点：declared 形态是 composite，
 * 子步按 edges 声明的顺序执行，且落到的还是 STEP_REGISTRY 里那两个未改动的
 * legacy 函数（零漂移）。
 */
describe("structure 席：席位级 composite 外壳", () => {
  it("AgentDef 声明为 composite，children 按 outline_batch → detailed_outline 串联", () => {
    const def = getAgentDef("structure");
    expect(def).toBeTruthy();
    expect(def?.structure.type).toBe("composite");
    const config = def?.structure.config as { children: string[]; edges: Array<{ source: string; target: string }> };
    expect(config.children).toEqual(["outline_batch", "detailed_outline"]);
    expect(config.edges).toEqual([{ source: "outline_batch", target: "detailed_outline" }]);
  });

  it("执行 structure 时按序落到两个 legacy step 函数，不改变它们的实现", async () => {
    const outlineDesc = STEP_REGISTRY.get("outline_batch")!;
    const detailedDesc = STEP_REGISTRY.get("detailed_outline")!;
    const originalOutline = outlineDesc.fn;
    const originalDetailed = detailedDesc.fn;
    const trace: string[] = [];

    (outlineDesc as { fn: unknown }).fn = async (ctx: NarrativeContext) => {
      trace.push("outline_batch");
      (ctx as Record<string, unknown>).outlines_generated = { outlines: [] };
    };
    (detailedDesc as { fn: unknown }).fn = async (ctx: NarrativeContext) => {
      trace.push("detailed_outline");
      (ctx as Record<string, unknown>).detailed_outlines_generated = { detailed_outlines: [] };
    };

    try {
      const ctx = { user_input: "测试" } as unknown as NarrativeContext;
      const outcome = await executeAgent("structure", ctx, {} as LLMClient);

      expect(trace).toEqual(["outline_batch", "detailed_outline"]);
      expect(outcome.via).toBe("runner"); // composite 本身走 runner，子步各走各的
      expect((ctx as Record<string, unknown>).outlines_generated).toEqual({ outlines: [] });
      expect((ctx as Record<string, unknown>).detailed_outlines_generated).toEqual({ detailed_outlines: [] });
    } finally {
      (outlineDesc as { fn: unknown }).fn = originalOutline;
      (detailedDesc as { fn: unknown }).fn = originalDetailed;
    }
  });
});
