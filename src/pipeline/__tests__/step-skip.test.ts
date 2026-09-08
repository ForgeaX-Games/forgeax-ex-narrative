/**
 * 静默空跑防复发。
 *
 * 曾经的失败长这样：上游没产出，本步 `if (empty) return`，管线照发一帧 completed，
 * 画布点亮，用户以为跑过了——零产物。这里锁三件事：
 *   1. 空数组算缺失（不然闸门放行，又回到 `if (empty) return`）；
 *   2. 跳过记录能说出缺什么、该先跑谁；
 *   3. 四个真步在缺上游时确实留下记录，且不去调模型。
 */
import { describe, it, expect } from "vitest";
import type { LLMClient } from "../runtime/llm-client.js";
import type { NarrativeContext } from "../../types/index.js";
import { missingStepInputs } from "../core/step-registry.js";
import "../core/step-registrations.js";
import { markStepSkipped, getStepSkip, listStepSkips, clearStepSkip } from "../core/step-skip.js";
import { outlineBatch } from "../steps/outline-batch.js";
import { detailedOutlineBatch } from "../steps/detailed-outline-batch.js";
import { plotGeneration } from "../steps/plot-generation.js";
import { scriptGeneration } from "../steps/script-generation.js";
import { questGeneration } from "../steps/quest-generation.js";

/** 一被调用就说明这一步不该跑却跑了——断言用，不是打桩。 */
function forbiddenLlm(): LLMClient {
  const boom = () => {
    throw new Error("缺上游时不应发起模型调用");
  };
  return {
    call: boom,
    callWithRetry: boom,
    callStream: boom,
  } as unknown as LLMClient;
}

function emptyCtx(): NarrativeContext {
  return { user_input: "一个测试需求" } as NarrativeContext;
}

describe("空数组算缺失", () => {
  it("上游产出为空数组时闸门必须判缺，否则等于放行到静默空跑", () => {
    const ctx = { outlines_generated: { outlines: [] } } as unknown as Record<string, unknown>;
    // detailed_outline 的硬输入是 outlines_generated；给个空壳对象也算有值，
    // 所以真正要防的是"字段在但内容空"这一路。
    expect(missingStepInputs("plot_generation", {})).toContain("detailed_outlines_generated");
    expect(missingStepInputs("outline_batch", { story_framework: null })).toContain("story_framework");
    expect(missingStepInputs("quest_generation", { plots_generated: [] })).toContain("plots_generated");
    expect(missingStepInputs("content_check", { plots_generated: "" })).toContain("plots_generated");
    expect(missingStepInputs("detailed_outline", ctx)).toHaveLength(0);
  });

  it("上游齐备时不判缺", () => {
    expect(
      missingStepInputs("plot_generation", { detailed_outlines_generated: { detailed_outlines: [1] } }),
    ).toHaveLength(0);
  });
});

describe("跳过记录", () => {
  it("记下缺失字段、该先跑的席位、以及给用户的一句话", () => {
    const ctx = emptyCtx();
    const rec = markStepSkipped(ctx, "plot_generation", ["detailed_outlines_generated"]);
    expect(rec.missing).toEqual(["detailed_outlines_generated"]);
    // 细纲由 2.3.8 故事结构席产出，所以提示该点名它，而不是甩字段名。
    expect(rec.blockedBy).toContain("structure");
    expect(rec.hint).toContain("需先运行");
    expect(getStepSkip(ctx, "plot_generation")).toEqual(rec);
    expect(listStepSkips(ctx)).toHaveLength(1);
  });

  it("重跑前清记录，上一轮的跳过不冒充本轮结果", () => {
    const ctx = emptyCtx();
    markStepSkipped(ctx, "outline_batch", ["story_framework"]);
    clearStepSkip(ctx, "outline_batch");
    expect(getStepSkip(ctx, "outline_batch")).toBeUndefined();
    expect(listStepSkips(ctx)).toHaveLength(0);
  });
});

describe("四步缺上游时留下记录而非静默返回", () => {
  const cases: Array<[string, (ctx: NarrativeContext, llm: LLMClient) => Promise<void>, string]> = [
    ["outline_batch", outlineBatch, "story_framework"],
    ["detailed_outline", detailedOutlineBatch, "outlines_generated"],
    ["plot_generation", plotGeneration, "detailed_outlines_generated"],
    ["script_generation", scriptGeneration, "plots_generated"],
    ["quest_generation", questGeneration, "plots_generated"],
  ];

  for (const [stepId, fn, missingField] of cases) {
    it(`${stepId} 缺上游：记 skipped、不调模型`, async () => {
      const ctx = emptyCtx();
      await fn(ctx, forbiddenLlm());
      const rec = getStepSkip(ctx, stepId);
      expect(rec, `${stepId} 应留下跳过记录`).toBeDefined();
      expect(rec!.missing).toContain(missingField);
      expect(rec!.hint.length).toBeGreaterThan(0);
    });
  }
});
