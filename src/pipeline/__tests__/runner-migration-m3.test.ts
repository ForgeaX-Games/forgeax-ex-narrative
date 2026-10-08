import { describe, it, expect } from "vitest";
import { executeAgent } from "../core/agent-exec.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * M3 结构表达（story_framework）的双路等价护栏。
 *
 * story_framework 是第一个迁上 sequence 原语的席位：route（deterministic）→
 * plan（llm）→ prepare_full/prepare_fixed（deterministic，互斥）→ fill（llm）四阶段，
 * 与 runner-migration-m2.test.ts 同一惯例——legacy step 函数与 runner 必须对同一份
 * ctx、同一批模型输出写回一模一样的东西，三种模式（full/regen/skip）都要核。
 */

/** 按调用顺序依次吐固定回复的假 LLM，故事框架恰好两段 LLM 调用（plan/fill）用得上。 */
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

function baseCtx(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    user_input: "一个雨季小镇的悬疑故事",
    worldview_structure: { world_name: "雨镇" },
    ...overrides,
  } as unknown as NarrativeContext;
}

async function viaLegacy(ctx: NarrativeContext, llm: LLMClient): Promise<NarrativeContext> {
  await STEP_REGISTRY.get("story_framework")!.fn!(ctx, llm);
  return ctx;
}

async function viaRunner(ctx: NarrativeContext, llm: LLMClient): Promise<NarrativeContext> {
  const outcome = await executeAgent("story_framework", ctx, llm);
  expect(outcome.via, "story_framework 没走 runner").toBe("runner");
  return ctx;
}

const PLAN_REPLY = JSON.stringify({
  has_branch: false,
  nodes: [
    { node_id: "n1", stage_type: "opening", is_branch: false },
    { node_id: "n2", stage_type: "climax", is_branch: false },
  ],
});

const FILL_REPLY = JSON.stringify({
  node_contents: [
    { node_id: "n1", name: "雨夜叩门", narrative_function: "建置", main_content: "游医林昭在雨夜出诊时目睹了一场命案。" },
    { node_id: "n2", name: "真相浮出", narrative_function: "高潮", main_content: "尘封多年的旧案与林昭的过去交织在一起。" },
  ],
});

describe("M3 结构表达（story_framework）：双路等价", () => {
  it("full 模式：规划+填充两段 LLM 调用，骨架与内容合并结果一致", async () => {
    const legacy = await viaLegacy(baseCtx(), stubLlm([PLAN_REPLY, FILL_REPLY]));
    const runner = await viaRunner(baseCtx(), stubLlm([PLAN_REPLY, FILL_REPLY]));

    expect(runner.story_framework).toEqual(legacy.story_framework);
    expect(runner.story_framework?.framework.nodes).toHaveLength(2);
    expect(runner.story_framework?.framework.nodes[0]?.next_node).toEqual(["n2"]);
    expect(runner.story_framework?.framework.nodes[1]?.prev_node).toEqual(["n1"]);
  });

  it("full 模式：两条路发给模型的提示词逐字相同", async () => {
    const legacyLlm = stubLlm([PLAN_REPLY, FILL_REPLY]);
    await viaLegacy(baseCtx(), legacyLlm);
    const runnerLlm = stubLlm([PLAN_REPLY, FILL_REPLY]);
    await viaRunner(baseCtx(), runnerLlm);

    expect(legacyLlm.calls).toHaveLength(2);
    expect(runnerLlm.calls).toHaveLength(2);
    expect(runnerLlm.calls[0]!.system).toBe(legacyLlm.calls[0]!.system);
    expect(runnerLlm.calls[0]!.user).toBe(legacyLlm.calls[0]!.user);
    expect(runnerLlm.calls[1]!.system).toBe(legacyLlm.calls[1]!.system);
    expect(runnerLlm.calls[1]!.user).toBe(legacyLlm.calls[1]!.user);
  });

  it("regen 模式：仅对目标节点重跑一次 LLM 调用（填充），骨架从既有节点截取", async () => {
    const existing = () =>
      baseCtx({
        story_framework: {
          framework: {
            nodes: [
              { node_id: "n1", content_id: "fw_n1", name: "旧-开端", narrative_function: "建置", main_content: "旧内容1", stage_type: "opening", is_branch: false, sequence_index: 0, prev_node: [], next_node: ["n2"] },
              { node_id: "n2", content_id: "fw_n2", name: "旧-高潮", narrative_function: "冲突", main_content: "旧内容2", stage_type: "climax", is_branch: false, sequence_index: 1, prev_node: ["n1"], next_node: [] },
            ],
          },
          dynamic_structure: { structure_type: "linear", framework_nodes: [], branch_groups: [] },
        },
        _nodeFilter: ["n2"],
      } as unknown as Partial<NarrativeContext>);

    const regenFill = JSON.stringify({
      node_contents: [
        { node_id: "n2", name: "新-高潮", narrative_function: "冲突升级", main_content: "重写后的高潮内容。" },
      ],
    });

    const legacyLlm = stubLlm([regenFill]);
    const legacy = await viaLegacy(existing(), legacyLlm);
    const runnerLlm = stubLlm([regenFill]);
    const runner = await viaRunner(existing(), runnerLlm);

    expect(legacyLlm.calls).toHaveLength(1); // regen 不过规划阶段
    expect(runnerLlm.calls).toHaveLength(1);
    expect(runner.story_framework).toEqual(legacy.story_framework);
    // regen 只回填目标节点本身（legacy 既有行为：调用方负责按 node_id 把结果拼回总表）。
    expect(runner.story_framework?.framework.nodes).toHaveLength(1);
    const n2 = runner.story_framework?.framework.nodes.find((n) => n.node_id === "n2");
    expect(n2?.name).toBe("新-高潮");
  });

  it("skip 模式：过滤目标为空节点集时不发请求，story_framework 原样保留", async () => {
    const existing = () =>
      baseCtx({
        story_framework: {
          framework: {
            nodes: [
              { node_id: "n1", content_id: "fw_n1", name: "旧-开端", narrative_function: "建置", main_content: "旧内容1", stage_type: "opening", is_branch: false, sequence_index: 0, prev_node: [], next_node: [] },
            ],
          },
          dynamic_structure: { structure_type: "linear", framework_nodes: [], branch_groups: [] },
        },
        _nodeFilter: ["not_exist"],
      } as unknown as Partial<NarrativeContext>);

    const legacyLlm = stubLlm(["should not be called"]);
    const legacy = await viaLegacy(existing(), legacyLlm);
    const runnerLlm = stubLlm(["should not be called"]);
    const runner = await viaRunner(existing(), runnerLlm);

    expect(legacyLlm.calls).toHaveLength(0);
    expect(runnerLlm.calls).toHaveLength(0);
    expect(runner.story_framework).toEqual(legacy.story_framework);
  });
});
