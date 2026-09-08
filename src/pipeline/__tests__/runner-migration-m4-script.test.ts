import { describe, it, expect } from "vitest";
import { executeAgent } from "../core/agent-exec.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import type { NarrativeContext, PlotNode } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * M4 分镜席（script_generation）切波次原语的双路等价护栏。
 *
 * 与 runner-migration-m4.test.ts（情节席）同一惯例，多核一件事——本席比情节席
 * 多一个跨层累加的全局序号（index/total），用于提示词"第 X/Y 个情节节点"与
 * 产出 title 兜底；两条路径的序号必须逐节点对齐。
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

function makePlot(overrides: Partial<PlotNode>): PlotNode {
  return {
    node_id: "n1",
    parent_id: "root",
    content: "情节内容",
    story_elements: { plot: { cause: "起因", process: "", result: "结果" } },
    jrpg_elements: {
      scene_location: "", scene_locations: [], scene_characters: [],
      dialogue_segments: [], key_items: [], narration_hints: [], bgm_hint: "", camera_hint: "",
    },
    boundary_constraints: { cause: "起因", result: "结果" },
    prev_node: [],
    next_node: [],
    narrative_stage: "opening",
    ...overrides,
  } as PlotNode;
}

function baseCtx(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    user_input: "一个雨季小镇的悬疑故事",
    plots_generated: {
      plots: [
        makePlot({
          node_id: "n1",
          content: "林昭出诊途中目睹命案",
          story_elements: { plot: { cause: "林昭出诊", process: "", result: "目睹命案" } },
          boundary_constraints: { cause: "林昭出诊", result: "目睹命案" },
          next_node: ["n2"],
        }),
        makePlot({
          node_id: "n2",
          content: "林昭追查真相",
          story_elements: { plot: { cause: "目睹命案", process: "", result: "真相浮现" } },
          boundary_constraints: { cause: "目睹命案", result: "真相浮现" },
          narrative_stage: "climax",
          prev_node: ["n1"],
        }),
      ],
      plot_id_map: { n1: "np_0", n2: "np_1" },
    },
    ...overrides,
  } as unknown as NarrativeContext;
}

const CHAPTER_N1 = JSON.stringify({
  chapter_id: "sc_n1", plot_node_id: "n1", chapter_type: "opening", title: "雨夜叩门",
  conflict: { type: "悬疑", tension_level: 6, stakes: "生死", turning_point: "命案浮现" },
  character_arcs: [],
  scenes: [{
    scene_id: "s1", location: "雨夜巷口", atmosphere: "阴郁", camera_direction: "俯拍", bgm: "低沉",
    content: [{ type: "narration", text: "林昭出诊路上，忽然目睹命案。" }],
  }],
});

const CHAPTER_N2 = JSON.stringify({
  chapter_id: "sc_n2", plot_node_id: "n2", chapter_type: "climax", title: "真相浮出",
  conflict: { type: "悬疑", tension_level: 8, stakes: "身份", turning_point: "真相揭示" },
  character_arcs: [],
  scenes: [{
    scene_id: "s1", location: "旧宅", atmosphere: "紧张", camera_direction: "特写", bgm: "紧张",
    content: [{ type: "dialogue", speaker: "林昭", text: "原来如此……真相浮现了。", emotion: "震惊" }],
  }],
});

async function viaLegacy(ctx: NarrativeContext, llm: LLMClient): Promise<NarrativeContext> {
  await STEP_REGISTRY.get("script_generation")!.fn!(ctx, llm);
  return ctx;
}

async function viaRunner(ctx: NarrativeContext, llm: LLMClient): Promise<NarrativeContext> {
  const outcome = await executeAgent("script_generation", ctx, llm);
  expect(outcome.via, "script_generation 没走 runner").toBe("runner");
  return ctx;
}

describe("M4 分镜席（script_generation）：双路等价", () => {
  it("两层拓扑（n1→n2）：合并结果逐字一致，含全局序号派生的 title/chapter_id", async () => {
    const legacy = await viaLegacy(baseCtx(), stubLlm([CHAPTER_N1, CHAPTER_N2]));
    const runner = await viaRunner(baseCtx(), stubLlm([CHAPTER_N1, CHAPTER_N2]));

    expect(runner.jrpg_script).toEqual(legacy.jrpg_script);
    expect(runner.jrpg_script?.chapters).toHaveLength(2);
    expect(runner.jrpg_script?.chapters.map((c) => c.chapter_id)).toEqual(["sc_n1", "sc_n2"]);
  });

  it("两条路发给模型的提示词逐字相同（含全局序号与滑动窗口摘要）", async () => {
    const legacyLlm = stubLlm([CHAPTER_N1, CHAPTER_N2]);
    await viaLegacy(baseCtx(), legacyLlm);
    const runnerLlm = stubLlm([CHAPTER_N1, CHAPTER_N2]);
    await viaRunner(baseCtx(), runnerLlm);

    expect(runnerLlm.calls.length).toBe(legacyLlm.calls.length);
    for (let i = 0; i < legacyLlm.calls.length; i++) {
      expect(runnerLlm.calls[i]!.system, `第 ${i} 次调用 system 不一致`).toBe(legacyLlm.calls[i]!.system);
      expect(runnerLlm.calls[i]!.user, `第 ${i} 次调用 user 不一致`).toBe(legacyLlm.calls[i]!.user);
    }
    expect(legacyLlm.calls[0]!.user).toContain("第 1/2 个情节节点");
    const n2Call = legacyLlm.calls.find((c) => c.user.includes('"node_id": "n2"'));
    expect(n2Call!.user).toContain("第 2/2 个情节节点");
    expect(n2Call!.user).toContain("前一节点实际生成摘要");
  });

  it("节点过滤（nodeFilter）：只对目标节点发起调用，序号按过滤后的集合重新计数", async () => {
    const withFilter = () => baseCtx({ _nodeFilter: ["n2"] } as unknown as Partial<NarrativeContext>);

    const legacyLlm = stubLlm([CHAPTER_N2]);
    const legacy = await viaLegacy(withFilter(), legacyLlm);
    const runnerLlm = stubLlm([CHAPTER_N2]);
    const runner = await viaRunner(withFilter(), runnerLlm);

    expect(runnerLlm.calls.length).toBe(legacyLlm.calls.length);
    expect(runner.jrpg_script).toEqual(legacy.jrpg_script);
    // 过滤后只剩 n2 一个节点，序号重新从 0 计，故为"第 1/1 个"而非"第 2/2 个"。
    expect(legacyLlm.calls[0]!.user).toContain("第 1/1 个情节节点");
  });

  it("空情节：两条路径都不发请求，jrpg_script 保持未定义", async () => {
    const emptyCtx = () => baseCtx({
      plots_generated: { plots: [], plot_id_map: {} },
    } as unknown as Partial<NarrativeContext>);

    const legacyLlm = stubLlm(["should not be called"]);
    const legacy = await viaLegacy(emptyCtx(), legacyLlm);
    expect(legacyLlm.calls).toHaveLength(0);
    expect(legacy.jrpg_script).toBeUndefined();

    const runnerLlm = stubLlm(["should not be called"]);
    const runner = await viaRunner(emptyCtx(), runnerLlm);
    expect(runnerLlm.calls).toHaveLength(0);
    expect(runner.jrpg_script?.chapters ?? []).toHaveLength(0);
  });
});
