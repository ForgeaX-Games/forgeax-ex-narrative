/**
 * L3 顺手记账这条路：情节席可选地产出状态变更，账本步骤补齐剩下的，剧本席读到快照。
 *
 * 盯的是这条链上三个容易失守的地方：
 *   1. 归一化不许把"没填"兜底成"没变化"——兜了，该补的节点永远不会被送去补全；
 *   2. 补全只填空缺，不覆盖节点自己写时声明的那一份；
 *   3. 账本记到了，下游要真读得到，否则记了没人看。
 */
import { describe, expect, it, vi } from "vitest";
import { PLOT_GENERATION_COMPOSER, normalizePlotGeneration } from "../steps/plot-generation.js";
import { stateLedger } from "../steps/state-ledger-step.js";
import { SCRIPT_GENERATION_COMPOSER } from "../steps/script-generation.js";
import type { LLMClient } from "../runtime/llm-client.js";
import type { NarrativeContext, PlotNode } from "../../types/index.js";

function plot(over: Partial<PlotNode>): PlotNode {
  return {
    node_id: "n1",
    parent_id: "",
    content: "一段足够长的情节正文，用来通过补全的正文长度门槛。",
    story_elements: { plot: { cause: "", process: "", result: "" } },
    jrpg_elements: {
      scene_location: "村口",
      scene_locations: [],
      scene_characters: [],
      dialogue_segments: [],
      key_items: [],
      narration_hints: [],
      bgm_hint: "",
      camera_hint: "",
    },
    boundary_constraints: { cause: "", result: "" },
    prev_node: [],
    next_node: [],
    narrative_stage: "setup",
    ...over,
  } as PlotNode;
}

function ctxWith(plots: PlotNode[]): NarrativeContext {
  return {
    user_input: "测试",
    plots_generated: { plots, plot_id_map: {} },
    detailed_character_sheets: [{ name: "阿零", label: "主角" }],
    item_database: [],
    story_title: "断剑志",
  } as unknown as NarrativeContext;
}

function stubLlm(reply: string): LLMClient {
  return { callWithRetry: vi.fn(async () => reply) } as unknown as LLMClient;
}

describe("L3 提示词：记账是可选的", () => {
  const system = PLOT_GENERATION_COMPOSER.blocks.output ?? "";

  it("明说两项可省，且说清为什么可省", () => {
    expect(system).toContain("spacetime");
    expect(system).toContain("state_deltas");
    expect(system).toContain("可省");
  });

  it("把空数组与不填的区别说给模型听（这是补全机制的依据）", () => {
    expect(system).toContain('写 []');
    expect(system).toContain("没填");
  });

  it("给出属性白名单，而不是让模型自创键名", () => {
    expect(system).toContain("physical.attire");
    expect(system).toContain("自创的会被丢掉");
  });
});

describe("账本步骤：只补空缺", () => {
  it("节点自己声明的变更不被补全覆盖", async () => {
    const own = plot({
      node_id: "n1",
      spacetime: { time: "元年", location: "祠堂" },
      state_deltas: [{ dimension: "plot", subject: "主线", attribute: "stage", to: "开场" }],
    });
    const ctx = ctxWith([own]);
    const llm = stubLlm(
      JSON.stringify([
        { node_id: "n1", spacetime: { time: "百年后", location: "王城" }, changes: [] },
      ]),
    );
    await stateLedger(ctx, llm);

    // 已填的节点根本不该进补全批次
    expect(llm.callWithRetry).not.toHaveBeenCalled();
    expect(ctx.world_state_ledger!.deltas[0].spacetime.location).toBe("祠堂");
  });

  it("漏填的节点补回来，并写回节点本身", async () => {
    const ctx = ctxWith([plot({ node_id: "n1" })]);
    await stateLedger(
      ctx,
      stubLlm(
        JSON.stringify([
          {
            node_id: "n1",
            spacetime: { time: "元年", location: "村口" },
            changes: [{ dimension: "world", subject: "王都", attribute: "state", to: "戒严" }],
          },
        ]),
      ),
    );
    expect(ctx.world_state_ledger!.deltas[0].changes).toHaveLength(1);
    // 账本与情节产物说的是同一件事
    expect(ctx.plots_generated!.plots[0].state_deltas).toHaveLength(1);
    expect(ctx.plots_generated!.plots[0].spacetime).toEqual({ time: "元年", location: "村口" });
  });

  it("声明了空数组的节点不送补全", async () => {
    const ctx = ctxWith([plot({ node_id: "n1", state_deltas: [] })]);
    const llm = stubLlm("[]");
    await stateLedger(ctx, llm);
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });

  it("补全调用失败不阻塞：账本仍落盘，只是那几个节点空着", async () => {
    const ctx = ctxWith([plot({ node_id: "n1" })]);
    const llm = {
      callWithRetry: vi.fn(async () => {
        throw new Error("model down");
      }),
    } as unknown as LLMClient;
    await stateLedger(ctx, llm);
    expect(ctx.world_state_ledger!.deltas).toHaveLength(1);
    expect(ctx.world_state_ledger!.deltas[0].changes).toEqual([]);
  });

  it("没有情节时给空账本，而不是不写——好让'跑过没有'分得出来", async () => {
    const ctx = ctxWith([]);
    await stateLedger(ctx, stubLlm("[]"));
    expect(ctx.world_state_ledger).toBeDefined();
    expect(ctx.world_state_ledger!.deltas).toEqual([]);
  });

  it("基线从角色档案与道具库搭，不从影游专有产物", async () => {
    const ctx = ctxWith([plot({ node_id: "n1", state_deltas: [] })]);
    await stateLedger(ctx, stubLlm("[]"));
    expect(ctx.world_state_ledger!.baseline.characters.map((c) => c.name)).toEqual(["阿零"]);
    expect(ctx.world_state_ledger!.baseline.plot_state).toBe("断剑志");
  });
});

describe("L3 归一化：没填就是没填", () => {
  async function normalizeOne(raw: Record<string, unknown>): Promise<PlotNode> {
    const ctx = ctxWith([]);
    const merged = {
      plots: [plot({ node_id: "n1", ...raw }) as PlotNode],
      plot_id_map: {},
    };
    // normalizePlotGeneration 只负责落盘与结构校验，字段形状由 normalizePlot 决定；
    // 这里直接验证落盘后的形状。
    const out = await normalizePlotGeneration(merged, ctx);
    return out.plots[0];
  }

  it("模型没给 state_deltas 时字段不存在（而不是空数组）", async () => {
    const node = await normalizeOne({});
    expect("state_deltas" in node).toBe(false);
  });

  it("模型给了空数组时保留空数组", async () => {
    const node = await normalizeOne({ state_deltas: [] });
    expect(node.state_deltas).toEqual([]);
  });
});

describe("剧本席读账本", () => {
  const nodes = [
    plot({ node_id: "n1", state_deltas: [{ dimension: "character", subject: "阿零", attribute: "physical.attire", to: "染血的皮甲" }] }),
    plot({ node_id: "n2", prev_node: ["n1"] }),
  ];

  it("有账本时，提示词里带上这一节点此刻的世界状态", async () => {
    const ctx = ctxWith(nodes);
    await stateLedger(ctx, stubLlm("[]"));
    (ctx as Record<string, unknown>)._chunk = { plot: nodes[1], index: 1, total: 2 };
    const user = SCRIPT_GENERATION_COMPOSER.blocks.main!(ctx);
    expect(user).toContain("世界当前状态");
    expect(user).toContain("染血的皮甲");
  });

  it("没账本时不塞占位段落（可选上游没跑不该变成噪声）", () => {
    const ctx = ctxWith(nodes);
    (ctx as Record<string, unknown>)._chunk = { plot: nodes[1], index: 1, total: 2 };
    expect(SCRIPT_GENERATION_COMPOSER.blocks.main!(ctx)).not.toContain("世界当前状态");
  });
});
