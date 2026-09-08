/**
 * P0 回归护栏（CHAT 7 修复方案）：
 *   P0-1 目标输出形态锁定——buildGenerationPipelineConfig 对 vn 家族缺省锁 vn_full（不跑 design_auto 策划文档）；
 *        familyFromTargetOutput 从 target_output 反推 family。
 *   P0-2 顶层聚合——mergePlotTrees 给节点 id 加单元前缀防碰撞、topology 按实际节点重算（修 58≠12 断裂）。
 * 均为纯函数确定性断言，不依赖付费 LLM。
 */
import { describe, it, expect } from "vitest";
import { buildGenerationPipelineConfig } from "../orchestrator.js";
import { familyFromTargetOutput } from "../phase2c-gen-adapt.js";
import { aggregateTemplates } from "../phase2-extract.js";
import type { NarrativeTemplate, PlotTree } from "../../types/narrative-ip-dna.js";

// ── P0-1 buildGenerationPipelineConfig：VN 家族缺省 vn_full ──
describe("P0-1 buildGenerationPipelineConfig 模式解析", () => {
  it("vn 家族 + 未指定模式 → vn_full + adv-interactive", () => {
    const cfg = buildGenerationPipelineConfig({ pipelineConfig: {} }, "vn");
    expect(cfg.mode).toBe("vn_full");
    expect(cfg.genreCode).toBe("adv-interactive");
  });

  it("vn 家族 + design_auto（通用默认）→ 覆盖为 vn_full（不跑 D0-D4 策划）", () => {
    const cfg = buildGenerationPipelineConfig({ pipelineConfig: {}, generationMode: "design_auto" }, "vn");
    expect(cfg.mode).toBe("vn_full");
  });

  it("vn 家族 + 显式 design_vn_full → 尊重不覆盖（策划+叙事）", () => {
    const cfg = buildGenerationPipelineConfig({ pipelineConfig: {}, generationMode: "design_vn_full" }, "vn");
    expect(cfg.mode).toBe("design_vn_full");
  });

  it("rpg 家族 + design_auto → 保持 design_auto（既有行为不变），不注入代表品类", () => {
    const cfg = buildGenerationPipelineConfig({ pipelineConfig: {}, generationMode: "design_auto" }, "rpg");
    expect(cfg.mode).toBe("design_auto");
    expect(cfg.genreCode).toBeUndefined();
  });

  it("显式 genreCode 不被家族代表品类覆盖", () => {
    const cfg = buildGenerationPipelineConfig({ pipelineConfig: { genreCode: "adv-avg" } }, "vn");
    expect(cfg.genreCode).toBe("adv-avg");
  });
});

// ── P0-1 familyFromTargetOutput：target_output → family ──
describe("P0-1 familyFromTargetOutput", () => {
  it("pipeline_template 含 vn → vn；含 rpg → rpg", () => {
    expect(familyFromTargetOutput({ pipeline_template: "tpl-vn-v2" })).toBe("vn");
    expect(familyFromTargetOutput({ pipeline_template: "tpl-rpg" })).toBe("rpg");
  });
  it("genre_code 关键词兜底：adv-interactive → vn；rpg-jrpg → rpg", () => {
    expect(familyFromTargetOutput({ genre_code: "adv-interactive" })).toBe("vn");
    expect(familyFromTargetOutput({ genre_code: "rpg-jrpg" })).toBe("rpg");
  });
  it("无法判定 → undefined（由调用方回退缺省 vn）", () => {
    expect(familyFromTargetOutput(undefined)).toBeUndefined();
    expect(familyFromTargetOutput({})).toBeUndefined();
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
