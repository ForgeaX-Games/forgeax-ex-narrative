import { describe, it, expect } from "vitest";
import { normalizeTemplate } from "../phase2-extract.js";
import { hydrateContextFromSeed, isIpDnaSeeded, type GenerationSeed } from "../generation-seed.js";
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
    family: "rpg",
    targetStructure: {
      l0_nodes: 3, l1_per_parent: 4, l2_per_parent: 5, enable_branch: false, plot_length: 40,
    } as never,
    vnActCount: 5,
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
    // RPG → global_control_params.target_structure
    expect(ctx.global_control_params?.target_structure?.plot_length).toBe(40);
    expect(ctx.vn_target_act_count).toBe(5);
    expect(ctx.relation_network).toBe("关系简报");
  });

  it("does not set global_control_params for vn family", () => {
    const seed = { ...makeSeed(), family: "vn" as const };
    const ctx = hydrateContextFromSeed(seed);
    expect(ctx.global_control_params).toBeUndefined();
    expect(ctx.vn_target_act_count).toBe(5);
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
