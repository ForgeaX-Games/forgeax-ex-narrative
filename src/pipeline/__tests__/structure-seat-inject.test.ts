/**
 * L1/L2 注入路由：原作的树进来了，两席就不再自己规划。
 *
 * 主病灶的下半段是「L1/L2 各自 1:N 重新规划」。止血保住了 L0，映射器把树翻译成了
 * 结构席的形态，这里验最后一环：注入骨架在场时，规划 LLM 不被调用，原作的分叉、
 * 合流、结局分档与最优路径一路到 L2 不变形。
 */
import { describe, it, expect, vi } from "vitest";
import { outlineBatch } from "../steps/outline-batch.js";
import { detailedOutlineBatch } from "../steps/detailed-outline-batch.js";
import { plotTreeToStructureSeat, plotTreeToStoryFramework } from "../../ip-dna/plot-tree-to-structure.js";
import type { NarrativeContext } from "../../types/index.js";
import type { PlotTree } from "../../types/narrative-ip-dna.js";
import type { LLMClient } from "../runtime/llm-client.js";

function tree(): PlotTree {
  return {
    entryNodeId: "1.1",
    topology: { nodeCount: 5, startCount: 1, endCount: 2, pivotCount: 1, mergeCount: 0 },
    nodes: [
      {
        id: "1.1", sceneId: "1", title: "起", nodeTypes: ["start"], isMainLine: true,
        prevNodes: [], nextNodes: [{ to: "1.2", event: "continue" }],
      },
      {
        id: "1.2", sceneId: "1", title: "岔", nodeTypes: ["pivot"], isMainLine: true,
        prevNodes: ["1.1"],
        nextNodes: [
          { to: "2.1", event: "choose", label: "A" },
          { to: "2.2", event: "choose", label: "B" },
        ],
        question: "留还是走？",
        options: [
          { label: "A", text: "留下", leadsTo: "2.1", cost: "信任 -1" },
          { label: "B", text: "离开", leadsTo: "2.2" },
        ],
      },
      {
        id: "2.1", sceneId: "2", title: "留", nodeTypes: ["end"], isMainLine: true,
        prevNodes: ["1.2"], nextNodes: [], endingType: "good", endingPosition: "final",
      },
      {
        id: "2.2", sceneId: "2", title: "走", nodeTypes: ["end"],
        prevNodes: ["1.2"], nextNodes: [], endingType: "bad", endingPosition: "mid",
      },
    ],
  };
}

/**
 * 只会填内容的假 LLM，记下每次调用的两段提示词。
 *
 * system 与 user 都要记：节点 ID 规则住在 user 段，只记 system 的话
 * 「规划 LLM 没被调用」这条断言会恒为真，等于没验。
 */
function fakeLlm(): LLMClient & { prompts: string[] } {
  const prompts: string[] = [];
  const client = {
    prompts,
    async callWithRetry(system: string, user: string): Promise<string> {
      prompts.push(system, user);
      // 两层的填充都按 node_id 回一份内容；规划请求一律不该走到这里。
      return JSON.stringify({
        outlines: [],
        detailed_outlines: [],
        nodes: [],
        fills: [],
      });
    },
  };
  return client as unknown as LLMClient & { prompts: string[] };
}

/** 规划提示词的指纹：节点 ID 规则只出现在两层的 Step 1 规划 prompt 里。 */
const L1_PLAN_FINGERPRINT = "大纲节点ID规则";
const L2_PLAN_FINGERPRINT = "细纲节点ID规则";

function seededCtx(): NarrativeContext {
  const t = tree();
  return {
    user_input: "把它改成一款游戏",
    story_framework: plotTreeToStoryFramework(t),
    injected_structure_seed: plotTreeToStructureSeat(t),
    global_control_params: { complexity: 3, deviation: 0 },
  } as unknown as NarrativeContext;
}

describe("L1 注入路由", () => {
  it("注入骨架在场时不调规划 LLM", async () => {
    const ctx = seededCtx();
    const llm = fakeLlm();
    await outlineBatch(ctx, llm);
    // 规划提示词里必有「ID规则」与输出 JSON 数组的要求；填充提示词没有。
    expect(llm.prompts.some((p) => p.includes(L1_PLAN_FINGERPRINT))).toBe(false);
  });

  it("L1 节点就是注入的那些，不多不少", async () => {
    const ctx = seededCtx();
    await outlineBatch(ctx, fakeLlm());
    expect(ctx.outlines_generated?.outlines.map((o) => o.node_id)).toEqual([
      "1_1", "1_2", "2_1", "2_2",
    ]);
  });

  // 结构语义取注入值而不是从骨架反推：原作已经把语义说清楚了。
  it("原作的分叉、选择条件与代价一路不变形", async () => {
    const ctx = seededCtx();
    await outlineBatch(ctx, fakeLlm());
    const pivot = ctx.outlines_generated!.outlines.find((o) => o.node_id === "1_2")!;
    expect(pivot.node_function).toBe("branch");
    expect(pivot.edges).toHaveLength(2);
    const a = pivot.edges!.find((e) => e.to === "2_1")!;
    expect(a.kind).toBe("choose");
    expect(a.condition?.description).toBe("留下");
    expect(a.condition?.cost).toBe("信任 -1");
  });

  it("两个结局的分档都留住了，中途与全剧终没被抹平", async () => {
    const ctx = seededCtx();
    await outlineBatch(ctx, fakeLlm());
    const byId = new Map(ctx.outlines_generated!.outlines.map((o) => [o.node_id, o]));
    expect(byId.get("2_1")!.ending).toMatchObject({ kind: "good", scope: "global" });
    expect(byId.get("2_2")!.ending).toMatchObject({ kind: "bad", scope: "local" });
  });

  it("原作主线成为最优路径，没被重新猜一遍", async () => {
    const ctx = seededCtx();
    await outlineBatch(ctx, fakeLlm());
    const onPath = ctx.outlines_generated!.outlines
      .filter((o) => o.on_optimal_path)
      .map((o) => o.node_id);
    expect(onPath).toEqual(["1_1", "1_2", "2_1"]);
  });

  it("正文字段留给填充，不被注入值占位", async () => {
    const ctx = seededCtx();
    await outlineBatch(ctx, fakeLlm());
    for (const o of ctx.outlines_generated!.outlines) {
      expect(typeof o.content).toBe("string");
      expect(o.name).toBeTruthy();
    }
  });

  // 没有注入骨架的普通生成必须照旧走规划：注入判定不能误伤常规路径。
  it("没有注入骨架时仍走常规规划", async () => {
    const ctx = seededCtx();
    delete (ctx as { injected_structure_seed?: unknown }).injected_structure_seed;
    const llm = fakeLlm();
    await outlineBatch(ctx, llm).catch(() => {});
    expect(llm.prompts.some((p) => p.includes(L1_PLAN_FINGERPRINT))).toBe(true);
  });

  // 父指针对不上说明映射与本次 L0 不是一套，此时退回常规规划比产出空树可诊断。
  it("注入骨架的父指针与本次 L0 对不上时退回常规规划", async () => {
    const ctx = seededCtx();
    ctx.injected_structure_seed = {
      ...ctx.injected_structure_seed!,
      outlines: ctx.injected_structure_seed!.outlines.map((o) => ({ ...o, parent_id: "99" })),
    };
    const llm = fakeLlm();
    await outlineBatch(ctx, llm).catch(() => {});
    expect(llm.prompts.some((p) => p.includes(L1_PLAN_FINGERPRINT))).toBe(true);
  });
});

describe("L2 注入路由", () => {
  async function runBothLayers() {
    const ctx = seededCtx();
    const llm = fakeLlm();
    await outlineBatch(ctx, llm);
    llm.prompts.length = 0;
    await detailedOutlineBatch(ctx, llm);
    return { ctx, llm };
  }

  it("注入骨架在场时不调规划 LLM", async () => {
    const { llm } = await runBothLayers();
    expect(llm.prompts.some((p) => p.includes(L2_PLAN_FINGERPRINT))).toBe(false);
  });

  it("L2 与 L1 一一对应，父指针指向 L1", async () => {
    const { ctx } = await runBothLayers();
    const l2 = ctx.detailed_outlines_generated!.detailed_outlines;
    expect(l2.map((d) => d.node_id)).toEqual(["1_1_1", "1_2_1", "2_1_1", "2_2_1"]);
    expect(l2.map((d) => d.parent_id)).toEqual(["1_1", "1_2", "2_1", "2_2"]);
  });

  it("原作的结构语义到 L2 仍在", async () => {
    const { ctx } = await runBothLayers();
    const byId = new Map(ctx.detailed_outlines_generated!.detailed_outlines.map((d) => [d.node_id, d]));
    expect(byId.get("1_2_1")!.node_function).toBe("branch");
    expect(byId.get("1_2_1")!.next_node).toEqual(["2_1_1", "2_2_1"]);
    expect(byId.get("2_2_1")!.ending).toMatchObject({ kind: "bad", scope: "local" });
    expect(byId.get("2_1_1")!.on_optimal_path).toBe(true);
    expect(byId.get("2_2_1")!.on_optimal_path).toBeUndefined();
  });
});
