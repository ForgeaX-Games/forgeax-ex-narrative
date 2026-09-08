import { describe, it, expect } from "vitest";
import { executeAgent } from "../core/agent-exec.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import type { NarrativeContext, DetailedOutlineNode } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * M4 情节席（plot_generation）切波次原语的双路等价护栏。
 *
 * 与 runner-migration-m3.test.ts 同一惯例：legacy step 函数与 WaveRunner 必须对
 * 同一份 ctx、同一批模型输出写回一模一样的东西。本席比 M2/M3 多一层——拓扑分层
 * 并行执行、层间滑动窗口摘要、单元级三重约束重试——这三样都要核到。
 */

function stubLlm(replies: string[]): LLMClient & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  let i = 0;
  const llm = {
    calls,
    async callWithRetry(
      system: string,
      user: string,
      _opts?: unknown,
      validate?: (raw: string) => void,
    ): Promise<string> {
      calls.push({ system, user });
      const reply = replies[Math.min(i, replies.length - 1)]!;
      i += 1;
      validate?.(reply);
      return reply;
    },
  };
  return llm as unknown as LLMClient & { calls: Array<{ system: string; user: string }> };
}

function makeNode(overrides: Partial<DetailedOutlineNode>): DetailedOutlineNode {
  return {
    node_id: "n1",
    parent_id: "root",
    name: "节点",
    narrative_stage: "opening",
    prev_node: [],
    next_node: [],
    content: "节点范围描述",
    story_elements: { plot: { cause: "起因", process: "", result: "结果" } },
    ...overrides,
  } as DetailedOutlineNode;
}

function baseCtx(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    user_input: "一个雨季小镇的悬疑故事",
    detailed_outlines_generated: {
      detailed_outlines: [
        makeNode({
          node_id: "n1",
          name: "雨夜叩门",
          narrative_stage: "opening",
          content: "游医林昭在雨夜出诊，途中目睹了一场命案的开端",
          story_elements: { plot: { cause: "林昭出诊", process: "", result: "目睹命案" } },
          next_node: ["n2"],
        }),
        makeNode({
          node_id: "n2",
          parent_id: "root",
          name: "真相浮出",
          narrative_stage: "climax",
          content: "林昭追查命案真相，发现与自己的过去交织",
          story_elements: { plot: { cause: "目睹命案", process: "", result: "真相浮现" } },
          prev_node: ["n1"],
        }),
      ],
    },
    ...overrides,
  } as unknown as NarrativeContext;
}

const PLOT_N1 = JSON.stringify({
  node_id: "n1",
  parent_id: "root",
  content: "林昭出诊的雨夜，他撑伞走过青石板路，忽然在巷口目睹命案的血迹与倒地的身影，心头一凛。",
  story_elements: { plot: { cause: "林昭出诊", process: "雨夜巷口遇命案", result: "目睹命案" } },
  jrpg_elements: {
    scene_location: "雨夜巷口",
    scene_characters: ["林昭"],
    dialogue_segments: [{ speaker: "林昭", text: "这是……", emotion: "震惊" }],
    key_items: ["医箱"],
  },
});

const PLOT_N2 = JSON.stringify({
  node_id: "n2",
  parent_id: "root",
  content: "林昭顺着目睹命案留下的线索追查，层层剥开真相浮现的脉络，才发现这一切与自己的过去紧密相连。",
  story_elements: { plot: { cause: "目睹命案", process: "追查线索", result: "真相浮现" } },
  jrpg_elements: {
    scene_location: "旧宅",
    scene_characters: ["林昭"],
    dialogue_segments: [],
    key_items: [],
  },
});

async function viaLegacy(ctx: NarrativeContext, llm: LLMClient): Promise<NarrativeContext> {
  await STEP_REGISTRY.get("plot_generation")!.fn!(ctx, llm);
  return ctx;
}

async function viaRunner(ctx: NarrativeContext, llm: LLMClient): Promise<NarrativeContext> {
  const outcome = await executeAgent("plot_generation", ctx, llm);
  expect(outcome.via, "plot_generation 没走 runner").toBe("runner");
  return ctx;
}

describe("M4 情节席（plot_generation）：双路等价", () => {
  it("两层拓扑（n1→n2）：合并结果与 plot_id_map 逐字一致", async () => {
    const legacy = await viaLegacy(baseCtx(), stubLlm([PLOT_N1, PLOT_N2]));
    const runner = await viaRunner(baseCtx(), stubLlm([PLOT_N1, PLOT_N2]));

    expect(runner.plots_generated).toEqual(legacy.plots_generated);
    expect(runner.plots_generated?.plots).toHaveLength(2);
    expect(runner.plots_generated?.plot_id_map).toEqual({ n1: "np_0", n2: "np_1" });
  });

  it("两条路发给模型的提示词逐字相同（含滑动窗口摘要注入）", async () => {
    // 桩内容与关键词重叠约束不严格匹配会触发约束重试——这不是本测试要盯的东西，
    // 两条路径用同一批桩回复时重试次数天然相同，故只比较"两边调用数一致"而非
    // 硬编码某个具体数字，重试次数漂移了这里也不会误报。
    const legacyLlm = stubLlm([PLOT_N1, PLOT_N2]);
    await viaLegacy(baseCtx(), legacyLlm);
    const runnerLlm = stubLlm([PLOT_N1, PLOT_N2]);
    await viaRunner(baseCtx(), runnerLlm);

    expect(runnerLlm.calls.length).toBe(legacyLlm.calls.length);
    for (let i = 0; i < legacyLlm.calls.length; i++) {
      expect(runnerLlm.calls[i]!.system, `第 ${i} 次调用 system 不一致`).toBe(legacyLlm.calls[i]!.system);
      expect(runnerLlm.calls[i]!.user, `第 ${i} 次调用 user 不一致`).toBe(legacyLlm.calls[i]!.user);
    }
    // n2 的首次 user 段应带上 n1 实际生成内容的滑动窗口摘要。
    const n2FirstCallIdx = legacyLlm.calls.findIndex((c) => c.user.includes('"node_id": "n2"'));
    expect(legacyLlm.calls[n2FirstCallIdx]!.user).toContain("前一节点实际生成摘要");
  });

  it("节点过滤（nodeFilter）：只对目标节点发起 LLM 调用，产出与 legacy 一致", async () => {
    const withFilter = () => baseCtx({ _nodeFilter: ["n2"] } as unknown as Partial<NarrativeContext>);

    const legacyLlm = stubLlm([PLOT_N2]);
    const legacy = await viaLegacy(withFilter(), legacyLlm);
    const runnerLlm = stubLlm([PLOT_N2]);
    const runner = await viaRunner(withFilter(), runnerLlm);

    // 只对 n1 目标节点发起调用（可能因约束重试而 >1 次），n1 不在过滤范围内不应被调用。
    expect(runnerLlm.calls.length).toBe(legacyLlm.calls.length);
    for (const call of legacyLlm.calls) expect(call.user).toContain('"node_id": "n2"');
    expect(runner.plots_generated).toEqual(legacy.plots_generated);
    expect(runner.plots_generated?.plots).toHaveLength(1);
    expect(runner.plots_generated?.plots[0]?.node_id).toBe("n2");
  });

  it("空细纲：两条路径都不发请求，plots_generated 保持未定义", async () => {
    const emptyCtx = () => baseCtx({
      detailed_outlines_generated: { detailed_outlines: [] },
    } as unknown as Partial<NarrativeContext>);

    const legacyLlm = stubLlm(["should not be called"]);
    const legacy = await viaLegacy(emptyCtx(), legacyLlm);
    expect(legacyLlm.calls).toHaveLength(0);
    expect(legacy.plots_generated).toBeUndefined();

    // runner 路径：wave 分层器在空节点时返回空层数组，WaveRunner 应产出空合并结果
    // 而非抛错——与 legacy 提前 return 的效果一致（下游读到的都是"没有情节"）。
    const runnerLlm = stubLlm(["should not be called"]);
    const runner = await viaRunner(emptyCtx(), runnerLlm);
    expect(runnerLlm.calls).toHaveLength(0);
    expect(runner.plots_generated?.plots ?? []).toHaveLength(0);
  });

  it("单元级约束重试：内容与骨架完全脱节时触发重试，两条路径重试次数与最终产出一致", async () => {
    // 单节点场景：首次回复的 content 与 cause/result/scope 关键词毫无重叠，触发约束重试；
    // 第二次回复内容良好，重试后接受。
    const singleNodeCtx = () => baseCtx({
      detailed_outlines_generated: {
        detailed_outlines: [
          makeNode({
            node_id: "n1",
            name: "雨夜叩门",
            content: "游医林昭在雨夜出诊，途中目睹了一场命案的开端",
            story_elements: { plot: { cause: "林昭出诊", process: "", result: "目睹命案" } },
          }),
        ],
      },
    } as unknown as Partial<NarrativeContext>);

    const BAD_REPLY = JSON.stringify({
      node_id: "n1",
      parent_id: "root",
      content: "阳光明媚的沙滩上，海鸥飞过，游客们在享受假期，完全与本节点无关的度假描写。",
      story_elements: { plot: { cause: "度假", process: "海边玩耍", result: "心情愉悦" } },
      jrpg_elements: {},
    });

    const legacyLlm = stubLlm([BAD_REPLY, PLOT_N1]);
    const legacy = await viaLegacy(singleNodeCtx(), legacyLlm);
    const runnerLlm = stubLlm([BAD_REPLY, PLOT_N1]);
    const runner = await viaRunner(singleNodeCtx(), runnerLlm);

    expect(legacyLlm.calls.length).toBeGreaterThan(1);
    expect(runnerLlm.calls).toHaveLength(legacyLlm.calls.length);
    expect(runner.plots_generated).toEqual(legacy.plots_generated);
  });
});
