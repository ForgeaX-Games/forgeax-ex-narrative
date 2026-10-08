import { describe, it, expect } from "vitest";
import { normalizeTemplate } from "../phase2-extract.js";
import { hydrateContextFromSeed, type GenerationSeed } from "../generation-seed.js";
import { isIpDnaSeeded } from "../fidelity.js";
import type { NarrativeIpDna } from "../../types/narrative-ip-dna.js";
import type { NarrativeContext } from "../../types/index.js";

function makeSeed(): GenerationSeed {
  const template = normalizeTemplate({
    worldview: { setting: "末世", scene_structure: "", item_inventory: "" },
    characters: [{ name: "张三", profile: "主角" }],
    core_elements: { subject: "末世", theme: "希望", core_conflict: "资源", literature_style: "写实", emotion_experience: "紧张" },
    summary: { characters: ["张三"], scene: "城市", events: "遭遇" },
  });
  const scopedDna: NarrativeIpDna = {
    schema_version: "1.0.0", story_id: "20260101_0000", title: "冰封", media_type: "book",
    rootId: "r", nodes: { r: { id: "r", levelType: "complete", index: 0, title: "冰封", parent: null, children: [], template } },
    scoped_to_game_unit: 2,
  };
  return {
    storyTitle: "冰封",
    storyTimestamp: "20260101_0000",
    topTemplate: template,
    scopedDna,
    ledger: { story_id: "20260101_0000", storyTitle: "冰封", entries: [] },
    userInput: "忠实改编\n\n关系简报",
    complexity: 0.6,
    nodeBudgetOverride: { l0_nodes: 3, l1_per_parent: 4, l2_per_parent: 5 },
    relationNetwork: "关系简报",
  };
}

describe("GenerationSeed hydrate (T4)", () => {
  it("hydrates a typed seed into a generation context (single injection point)", () => {
    const ctx = hydrateContextFromSeed(makeSeed());
    expect(ctx.narrativeIpDna?.scoped_to_game_unit).toBe(2);
    expect((ctx as Record<string, unknown>)._long_memory_ledger).toBeTruthy();
    expect(ctx.user_input).toContain("关系简报");
    expect(ctx.complexity).toBe(0.6);
    // 节点预算 → global_control_params.node_budget_override（每层开几个节点，不是叙事结构）
    const budget = ctx.global_control_params?.node_budget_override;
    expect(budget).toEqual({ l0_nodes: 3, l1_per_parent: 4, l2_per_parent: 5 });
    expect(ctx.relation_network).toBe("关系简报");
  });

  /**
   * 预算不看品类。
   *
   * 这里曾有一条反向断言，要求 vn 家族**不要**设 global_control_params —— 它冻结的是个
   * bug：缺省家族正是 vn，于是缺省路径下改编选的体量算了也白算。家族随之删除，预算
   * 无条件生效。
   */
  it("applies the node budget without asking what genre it is", () => {
    const ctx = hydrateContextFromSeed(makeSeed());
    expect(ctx.global_control_params?.node_budget_override).toEqual({
      l0_nodes: 3,
      l1_per_parent: 4,
      l2_per_parent: 5,
    });
  });

  it("hydrates operatorLayers into ctx._operator_layers (§3.2)", () => {
    const seed = {
      ...makeSeed(),
      operatorLayers: {
        top: [{ uid: "t1", name: "顶", definition: "", adaptation: { type: "", element: "" }, usage_guide: "", example: "", knowledge_location: "", knowledge_domain: "叙事者定位" }],
        mid: [],
        leaf: [],
        global: [],
      },
    };
    const ctx = hydrateContextFromSeed(seed);
    expect((ctx as Record<string, unknown>)._operator_layers).toBeTruthy();
  });

  it("isIpDnaSeeded predicate gates the short-circuit", () => {
    expect(isIpDnaSeeded(hydrateContextFromSeed(makeSeed()))).toBe(true);
    expect(isIpDnaSeeded({ user_input: "x" } as NarrativeContext)).toBe(false);
  });
});
