/**
 * jrpg-walkthrough.test.ts —— M7 实跑验证
 *
 * 用桩 LLM 走一条 JRPG：确认十三席的执行确实经过 agent 层（executeAgent → AgentDef），
 * 而不是各处直接调 step.fn；并确认结构席这一趟真的把剧情树字段落了盘。
 *
 * 桩 LLM 的回答由提示词反推（从「需要填充的全部 node_id 列表」里读出该答哪些节点），
 * 而不是写死一份 fixture——写死的 fixture 在骨架算法改动后会静默失配，
 * 反推则会跟着骨架一起变，测的是链路而不是某次快照。
 */
import { describe, it, expect } from "vitest";
import "../blueprint/agent-def-registrations.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { executeAgent } from "../core/agent-exec.js";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import { getNarrativeAgentOrThrow } from "../core/agent-registry.js";
import { resolveSeatStepGroups } from "../routing/narrative-pipelines.js";

function nodeIdsFromPrompt(prompt: string): string[] {
  const m = /需要填充的全部 node_id 列表：(.+)/.exec(prompt);
  return m ? m[1]!.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
}

/** 从提示词的「节点骨架」段读出每个节点的出边，用来决定该给谁补分岔/结局语义。 */
function skeletonFromPrompt(prompt: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /- \[([^\]]+)\] prev=(\[[^\]]*\]) next=(\[[^\]]*\])/g;
  for (let m = re.exec(prompt); m; m = re.exec(prompt)) {
    out.set(m[1]!, JSON.parse(m[3]!) as string[]);
  }
  return out;
}

function fillFor(prompt: string): Array<Record<string, unknown>> {
  const skeleton = skeletonFromPrompt(prompt);
  return nodeIdsFromPrompt(prompt).map((id) => {
    const next = skeleton.get(id) ?? [];
    const base: Record<string, unknown> = {
      node_id: id,
      name: `节点${id}`,
      narrative_stage: "rising",
      story_elements: {
        plot: { cause: "起因", process: "过程", result: "结果" },
        dialogue_hint: "克制",
        monologue_hint: "自省",
        narration_hint: "冷静",
        atmosphere: "压抑",
      },
      content: "内容".repeat(60),
    };
    if (next.length > 1) {
      base.branch_type = "converge";
      base.edge_conditions = Object.fromEntries(
        next.map((to) => [
          to,
          { type: "choice", description: `选择通向 ${to}`, cost: "失去一段时间" },
        ]),
      );
    }
    if (next.length === 0) {
      base.ending = { label: "H", scope: "global", trigger: "抵达终局" };
    }
    return base;
  });
}

function makeStubLlm(): LLMClient {
  const call = async (_system: string, user: string): Promise<string> => {
    // 规划轮：要一个非空 JSON 数组，每个上游节点一条展开计划
    if (/输出\s*JSON\s*数组|输出JSON数组/.test(user)) {
      const parents = [...user.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]!);
      const uniq = [...new Set(parents)];
      return JSON.stringify(
        (uniq.length > 0 ? uniq : ["fw_1"]).map((parent_id) => ({
          parent_id,
          outline_count: 4,
          detail_count: 4,
          branch_count: 2,
          branch_position: 2,
          should_merge: true,
          narrative_stage: "rising",
          optimal_branch: "a",
        })),
      );
    }
    if (/"outlines"/.test(user)) return JSON.stringify({ outlines: fillFor(user) });
    if (/"detailed_outlines"/.test(user)) {
      return JSON.stringify({ detailed_outlines: fillFor(user) });
    }
    return "{}";
  };
  return {
    call,
    callWithRetry: call,
  } as unknown as LLMClient;
}

function makeCtx(): NarrativeContext {
  return {
    user_input: "做一个关于赎罪的 JRPG",
    tier_detection: { tier: "tier1", genre_code: "rpg-jrpg", genre_name: "JRPG", reasoning: "" },
    demand_analysis: { genre_code: "rpg-jrpg", genre_name: "JRPG", tier: "tier1" },
    story_framework: {
      framework: {
        nodes: [
          { node_id: "fw_1", name: "启程", narrative_function: "setup", main_content: "主角离乡" },
          { node_id: "fw_2", name: "深入", narrative_function: "escalation", main_content: "真相浮现" },
        ],
      },
    },
  } as unknown as NarrativeContext;
}

describe("M7 JRPG 走一条", () => {
  it("JRPG 专家的每一席都能从 agent 层查到，且带席位归属", () => {
    const { pipeline, stepGroups } = resolveSeatStepGroups("rpg-jrpg", "tier1");
    expect(pipeline.id).toBe("pl-narrative");
    expect(stepGroups.length).toBeGreaterThan(8);

    for (const id of stepGroups) {
      const agent = getNarrativeAgentOrThrow(id);
      expect(agent.seatId, `${id} 丢了席位归属`).toBeTruthy();
      expect(getAgentDef(id), `${id} 没有 AgentDef，仍是裸 step`).toBeTruthy();
    }
  });

  it("结构席两步经 executeAgent 跑完，剧情树字段落盘", async () => {
    const ctx = makeCtx();
    const llm = makeStubLlm();

    const l1 = await executeAgent("outline_batch", ctx, llm);
    expect(l1.via).toBeDefined();

    const outlines = ctx.outlines_generated?.outlines ?? [];
    expect(outlines.length).toBeGreaterThan(0);

    // 每个节点都有功能位与出边，且出边目标与 next_node 一致
    for (const n of outlines) {
      expect(n.node_function, `${n.node_id} 缺 node_function`).toBeTruthy();
      expect((n.edges ?? []).map((e) => e.to).sort()).toEqual([...n.next_node].sort());
    }

    // 分岔节点拿到了代价档与带条件的出边（语义来自模型，拓扑来自骨架）
    const branches = outlines.filter((n) => n.next_node.length > 1);
    expect(branches.length).toBeGreaterThan(0);
    for (const b of branches) {
      expect(b.branch_type).toBeTruthy();
      expect(b.edges!.every((e) => e.condition?.description)).toBe(true);
    }

    // 结局节点拿到了分档
    const endings = outlines.filter((n) => n.next_node.length === 0);
    expect(endings.length).toBeGreaterThan(0);
    expect(endings.every((e) => e.ending?.scope)).toBe(true);

    await executeAgent("detailed_outline", ctx, llm);
    const details = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
    expect(details.length).toBeGreaterThan(0);
    for (const n of details) {
      expect(n.node_function, `${n.node_id} 缺 node_function`).toBeTruthy();
      expect(typeof n.on_optimal_path).toBe("boolean");
    }
    // 最优路径既不是全 true 也不是全 false：分岔处只有一支在链上
    const onPath = details.filter((n) => n.on_optimal_path).length;
    expect(onPath).toBeGreaterThan(0);
    expect(onPath).toBeLessThan(details.length);
  }, 30_000);
});
