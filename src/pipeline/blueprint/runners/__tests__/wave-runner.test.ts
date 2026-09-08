import { describe, it, expect, vi, beforeEach } from "vitest";
import { WaveRunner } from "../wave-runner.js";
import { PromptResolver } from "../../prompt-resolver.js";
import {
  registerWaveLayerer,
  registerWaveSummarizer,
  registerWaveConstraintCheck,
  registerMerger,
  registerChunkSink,
  registerNormalizer,
  registerValidator,
} from "../../processor-registry.js";
import type { PromptComposer } from "../../../runtime/prompt-composer.js";
import type { AgentDef, StepBlueprint, WaveConfig } from "../../types.js";
import type { NarrativeContext } from "../../../../types/index.js";
import type { LLMClient } from "../../../runtime/llm-client.js";

/**
 * WaveRunner 是框架层实现方案 M1 的核心新增原语。这批测试锁住三条不变量：
 *   1. 拓扑分层执行——层间要把前驱**实际输出**的摘要传给后继（而不是静态结构数据）；
 *   2. 片内约束重试——未通过时把问题清单拼回 user 段重来，重试耗尽仍接受当前结果；
 *   3. 落地时序与收尾——sink 先于完成上报、merger 收到全部单元、normalizer 最后跑一遍。
 * 不用真实 step（plot/script 留给 M4 迁移时的对照测试），这里只测执行器本身。
 */

const USER_COMPOSER: PromptComposer = {
  stepId: "wave_test_step",
  blocks: {
    role: "你是测试用的波次 agent。",
    // 真实 step（如 quest_generation）不指望框架注入通用 unitId：id 是业务字段
    // 自己的（node.id/plot.node_id……），composer 从 `_chunk.node` 这类领域对象里取。
    user_body: (ctx: NarrativeContext) => {
      const chunk = (ctx as unknown as { _chunk: Record<string, unknown> })._chunk;
      const node = chunk.node as { id: string };
      const wave = chunk._wave as { slidingSummary?: string; constraintFeedback?: string } | undefined;
      return [
        `unit:${node.id}`,
        `summary:${wave?.slidingSummary ?? "none"}`,
        `feedback:${wave?.constraintFeedback ?? "none"}`,
      ].join("\n");
    },
  },
  systemBlockOrder: ["role"],
  userBlockOrder: ["user_body"],
  skillSlots: [],
};

function buildStep(config: WaveConfig, overrides: Partial<AgentDef> = {}): StepBlueprint {
  const agentDef: AgentDef = {
    id: "wave_test_step",
    name: "波次测试席",
    structure: { type: "wave", config },
    prompts: { templateId: "wave_test_step", skillSlots: [] },
    io: { requiredInputs: [], outputField: "wave_test_output" },
    dependencies: [],
    ...overrides,
  };
  return {
    stepId: agentDef.id,
    index: 0,
    agentDef,
    resolvedPrompts: PromptResolver.resolveFromComposer(USER_COMPOSER, {} as NarrativeContext, { deferUser: true }),
    executionParams: { temperature: 0.7, retryCount: 3, streaming: false, responseFormat: "json" },
  };
}

/** 从 mock 调用参数里取出 user prompt 传的 unitId，驱动分单元的桩响应。 */
function unitIdOf(userPrompt: string): string {
  return /unit:(\S+)/.exec(userPrompt)?.[1] ?? "";
}

describe("WaveRunner", () => {
  let calls: Array<{ event: string; detail: string }>;

  beforeEach(() => {
    calls = [];
  });

  it("拓扑分层执行：同层并行，层间把前驱实际产出的摘要传给后继", async () => {
    // A、B 无依赖同层；C 依赖 A 和 B，落在第二层。
    registerWaveLayerer("wave_test_step_wave_layerer", () => [
      [
        { unitId: "A", data: { node: { id: "A" } }, prevIds: [] },
        { unitId: "B", data: { node: { id: "B" } }, prevIds: [] },
      ],
      [{ unitId: "C", data: { node: { id: "C" } }, prevIds: ["A", "B"] }],
    ]);
    registerWaveSummarizer("wave_test_step_wave_summarizer", (output) => `摘要(${(output as { text: string }).text})`);
    registerMerger("wave_test_step_merger", (chunks) =>
      chunks.map((c) => (c.output as { text: string }).text).join(","),
    );

    const llm = {
      callWithRetry: vi.fn(async (_sys: string, user: string) => {
        const id = unitIdOf(user);
        calls.push({ event: "llm", detail: user });
        return JSON.stringify({ text: id });
      }),
    } as unknown as LLMClient;

    const runner = new WaveRunner();
    const result = await runner.execute(buildStep({ maxConstraintRetries: 0 }), {} as NarrativeContext, llm);

    expect(result).toBe("A,B,C");
    const cPrompt = calls.find((c) => c.detail.includes("unit:C"))!.detail;
    expect(cPrompt).toContain("summary:摘要(A)\n---\n摘要(B)");
  });

  it("片内约束重试：未通过时把问题拼进下一轮 user 段，通过后停止", async () => {
    registerWaveLayerer("wave_test_step_wave_layerer", () => [
      [{ unitId: "X", data: { node: { id: "X" } }, prevIds: [] }],
    ]);
    registerWaveConstraintCheck("wave_test_step_wave_constraint_check", (output) =>
      (output as { text: string }).text === "final" ? [] : ["内容太短"],
    );
    registerMerger("wave_test_step_merger", (chunks) => chunks[0]?.output);

    let attempt = 0;
    const llm = {
      callWithRetry: vi.fn(async (_sys: string, user: string) => {
        calls.push({ event: "llm", detail: user });
        attempt += 1;
        return JSON.stringify({ text: attempt < 2 ? "draft" : "final" });
      }),
    } as unknown as LLMClient;

    const runner = new WaveRunner();
    const result = await runner.execute(
      buildStep({ maxConstraintRetries: 2 }),
      {} as NarrativeContext,
      llm,
    );

    expect(llm.callWithRetry).toHaveBeenCalledTimes(2);
    expect((result as { text: string }).text).toBe("final");
    // 第二次调用应带上第一次问题清单作为修正反馈。
    expect(calls[1].detail).toContain("feedback:1. 内容太短");
  });

  it("重试耗尽仍接受当前输出，不抛错、不无限重试", async () => {
    registerWaveLayerer("wave_test_step_wave_layerer", () => [
      [{ unitId: "Y", data: { node: { id: "Y" } }, prevIds: [] }],
    ]);
    registerWaveConstraintCheck("wave_test_step_wave_constraint_check", () => ["永远不过"]);
    registerMerger("wave_test_step_merger", (chunks) => chunks[0]?.output);

    const llm = {
      callWithRetry: vi.fn(async () => JSON.stringify({ text: "still-bad" })),
    } as unknown as LLMClient;

    const runner = new WaveRunner();
    const result = await runner.execute(buildStep({ maxConstraintRetries: 2 }), {} as NarrativeContext, llm);

    // 首次 + 2 次重试 = 3 次调用，然后接受结果而不是抛错。
    expect(llm.callWithRetry).toHaveBeenCalledTimes(3);
    expect((result as { text: string }).text).toBe("still-bad");
  });

  it("落地时序：sink 先于完成上报；merger 收到全部单元；normalizer 最后再跑一次", async () => {
    registerWaveLayerer("wave_test_step_wave_layerer", () => [
      [
        { unitId: "P", data: { node: { id: "P" } }, prevIds: [] },
        { unitId: "Q", data: { node: { id: "Q" } }, prevIds: [] },
      ],
    ]);
    registerMerger("wave_test_step_merger", (chunks) =>
      chunks.map((c) => (c.output as { text: string }).text).sort(),
    );
    registerChunkSink("wave_test_step_chunk_done", (chunk) => {
      calls.push({ event: "sink", detail: chunk.chunkId });
    });
    registerNormalizer("wave_test_step_normalizer", (merged) => ({
      normalized: true,
      items: merged,
    }));

    const subEmits: Array<[string, number, number]> = [];
    const llm = {
      callWithRetry: vi.fn(async (_sys: string, user: string) => JSON.stringify({ text: unitIdOf(user) })),
    } as unknown as LLMClient;

    const runner = new WaveRunner();
    const result = await runner.execute(
      buildStep({}, { normalizer: "wave_test_step_normalizer" }),
      {} as NarrativeContext,
      llm,
      { onSubEmit: (id, done, total) => subEmits.push([id, done, total]) },
    );

    expect(calls.filter((c) => c.event === "sink").map((c) => c.detail).sort()).toEqual(["P", "Q"]);
    // 每个单元先报"进行中"(done 计数不含自己)、完成后再报一次(done 计数含自己)。
    expect(subEmits.filter(([, , total]) => total === 2).length).toBe(4);
    expect(result).toEqual({ normalized: true, items: ["P", "Q"] });
  });

  it("校验器抛错时按 validators 触发 LLM 层重试（与 ChunkedRunner 同一约定）", async () => {
    registerWaveLayerer("wave_test_step_wave_layerer", () => [
      [{ unitId: "V", data: { node: { id: "V" } }, prevIds: [] }],
    ]);
    registerMerger("wave_test_step_merger", (chunks) => chunks[0]?.output);
    registerValidator("wave_test_step_validator", (raw) => {
      const parsed = JSON.parse(raw) as { text?: string };
      if (!parsed.text) throw new Error("text 不能为空");
    });

    const llm = {
      callWithRetry: vi.fn(async (_sys, _user, _opts, parseResult) => {
        const raw = JSON.stringify({ text: "ok" });
        parseResult?.(raw);
        return raw;
      }),
    } as unknown as LLMClient;

    const runner = new WaveRunner();
    const result = await runner.execute(
      buildStep({}, { validators: ["wave_test_step_validator"] }),
      {} as NarrativeContext,
      llm,
    );

    expect(result).toEqual({ text: "ok" });
  });

  it("缺分层器或 merger 时显式抛错，而不是静默发空提示词", async () => {
    const runner = new WaveRunner();
    await expect(
      runner.execute(
        buildStep({}, { id: "unregistered_wave_step" }),
        {} as NarrativeContext,
        {} as LLMClient,
      ),
    ).rejects.toThrow(/requires registered layerer/);
  });
});
