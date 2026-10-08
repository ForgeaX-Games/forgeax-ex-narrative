/**
 * P0 回归护栏（CHAT 7 修复方案）：
 *   P0-1 目标输出形态——buildGenerationPipelineConfig 解析出的 mode 必须真的跑得起来；
 *        品类直接往下传，不经 rpg/vn 家族桶（家族已随 C1 的管线统一删除）。
 *   P0-2 顶层聚合——mergePlotTrees 给节点 id 加单元前缀防碰撞、topology 按实际节点重算（修 58≠12 断裂）。
 * 均为纯函数确定性断言，不依赖付费 LLM。
 */
import { describe, it, expect } from "vitest";
import { buildGenerationPipelineConfig, DEFAULT_ADAPTATION_GENRE } from "../orchestrator.js";
import { getModeConfig } from "../../pipeline/routing/modes.js";
import { aggregateTemplates } from "../phase2-extract.js";
import type { NarrativeTemplate, PlotTree } from "../../types/narrative-ip-dna.js";

// ── P0-1 buildGenerationPipelineConfig：解析出的 mode 必须跑得起来 ──
describe("P0-1 buildGenerationPipelineConfig 模式解析", () => {
  /**
   * 这一条是这组断言的地基：其余几条问"解析出了什么"，只有它问"解析出的东西能不能用"。
   *
   * 缺了它，上一版把 vn 家族锁到 `vn_full` 的断言可以一路绿着 —— `vn_full` 还在 ModeId
   * 联合里，字符串相等的断言看不出它已经不在 MODE_CONFIGS 中，而 getModeConfig 会对它
   * 抛 `Unknown mode`。vn 正是 IP 改编的缺省家族，所以那是缺省路径上的崩溃。
   */
  /**
   * 这一条是这组断言的地基：其余几条问"解析出了什么"，只有它问"解析出的东西能不能用"。
   *
   * 缺了它，上一版把 vn 家族锁到 `vn_full` 的断言可以一路绿着 —— `vn_full` 还在 ModeId
   * 联合里，字符串相等的断言看不出它已经不在 MODE_CONFIGS 中，而 getModeConfig 会对它
   * 抛 `Unknown mode`。vn 曾是 IP 改编的缺省家族，所以那是缺省路径上的崩溃。
   */
  it("解析出的 mode 都能被 getModeConfig 解析", () => {
    for (const generationMode of [undefined, "design_auto"] as const) {
      const cfg = buildGenerationPipelineConfig({
        pipelineConfig: {},
        ...(generationMode ? { generationMode } : {}),
      });
      // mode 为空是合法的：run() 会按 tier 取缺省。有值就必须解析得出配置。
      if (cfg.mode) expect(() => getModeConfig(cfg.mode!)).not.toThrow();
    }
  });

  it("不改写 mode，品类自己路由", () => {
    // 形态差异由叙事结构轴表达，不靠给影游单列一条 mode（C1 已退役那四条专属入口）。
    expect(buildGenerationPipelineConfig({ pipelineConfig: {} }).mode).toBeUndefined();
    expect(
      buildGenerationPipelineConfig({ pipelineConfig: {}, generationMode: "design_auto" }).mode,
    ).toBe("design_auto");
  });

  it("未指定品类时给缺省品类，显式品类不被覆盖", () => {
    expect(buildGenerationPipelineConfig({ pipelineConfig: {} }).genreCode).toBe(
      DEFAULT_ADAPTATION_GENRE,
    );
    expect(
      buildGenerationPipelineConfig({ pipelineConfig: { genreCode: "adv-avg" } }).genreCode,
    ).toBe("adv-avg");
  });
});

// ── P0-2 mergePlotTrees（经 aggregateTemplates）：加前缀防碰撞 + topology 重算 ──
function mkTemplate(nodeIdA: string, nodeIdB: string): NarrativeTemplate {
  const plot_tree: PlotTree = {
    entryNodeId: nodeIdA,
    nodes: [
      { id: nodeIdA, sceneId: "1", nodeTypes: ["start"], prevNodes: [], nextNodes: [{ to: nodeIdB, event: "continue" }] },
      { id: nodeIdB, sceneId: "1", nodeTypes: ["end"], prevNodes: [nodeIdA], nextNodes: [], endingType: "open", endingPosition: "final" },
    ],
    topology: { nodeCount: 2, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 },
  };
  return {
    worldview: { setting: "", scene_structure: "", item_inventory: "" },
    characters: [],
    story_structure: { topology: plot_tree.topology, plot_tree },
    core_elements: { subject: "", theme: "", core_conflict: "", literature_style: "", emotion_experience: "" },
    summary: { characters: [], scene: "", events: "" },
  };
}

describe("P0-2 mergePlotTrees 加前缀防碰撞 + topology 重算", () => {
  it("两个都用 1.1/1.2 的子树聚合后不丢节点（4 个），topology 与实际节点一致", () => {
    // 两章都从 1.1 起编号——旧实现按 id 去重会塌成 2 个节点、topology 却相加成 4，断裂。
    const agg = aggregateTemplates([mkTemplate("1.1", "1.2"), mkTemplate("1.1", "1.2")]);
    const tree = agg.story_structure.plot_tree!;
    expect(tree.nodes.length).toBe(4); // 无碰撞丢失
    const ids = tree.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(4); // id 全唯一（已加单元前缀）
    // topology 计数 == 实际节点，不再 58≠12
    expect(tree.topology.nodeCount).toBe(4);
    expect(tree.topology.startCount).toBe(2);
    expect(tree.topology.endCount).toBe(2);
    // story_structure.topology 与合并树一致
    expect(agg.story_structure.topology.nodeCount).toBe(4);
  });

  it("前缀重写保持边引用有效（nextNodes.to / prevNodes 指向存在的节点）", () => {
    const agg = aggregateTemplates([mkTemplate("1.1", "1.2"), mkTemplate("1.1", "1.2")]);
    const tree = agg.story_structure.plot_tree!;
    const idSet = new Set(tree.nodes.map((n) => n.id));
    for (const n of tree.nodes) {
      for (const e of n.nextNodes) expect(idSet.has(e.to)).toBe(true);
      for (const p of n.prevNodes) expect(idSet.has(p)).toBe(true);
    }
  });
});
