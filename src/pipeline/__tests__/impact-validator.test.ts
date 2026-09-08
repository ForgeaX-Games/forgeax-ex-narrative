/**
 * impact-validator.test.ts (Gap D)
 * ─────────────────────────────────────────────────────────────────
 * 校验 LLM 影响面输出的结构化护栏。
 */
import { describe, it, expect } from "vitest";
import { validateImpactAnalysis } from "../runtime/impact-validator.js";

const PIPELINE = [
  "preference_summary",
  "preference_analysis",
  "initial_plan",
  "worldview",
  "character_enrichment",
  "story_framework",
  "outline_batch",
  "detailed_outline",
  "plot_generation",
  "script_generation",
  "scene_plan",
];

describe("validateImpactAnalysis - cosmetic", () => {
  it("不允许回溯到修改步骤之前", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: ["worldview", "story_framework"], canSkip: [] },
      ["story_framework"],
      "cosmetic",
      PIPELINE,
      "cosmetic",
    );
    expect(r.affectedSteps).toContain("story_framework");
    expect(r.affectedSteps).not.toContain("worldview");
    expect(r.warnings.some(w => w.includes("worldview") && w.includes("最早允许回溯边界"))).toBe(true);
    expect(r.earliestAllowedStep).toBe("story_framework");
  });

  it("修改步骤本身漏报时自动补回", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: [], canSkip: [] },
      ["script_generation"],
      "cosmetic",
      PIPELINE,
    );
    expect(r.affectedSteps).toEqual(["script_generation"]);
    expect(r.warnings.some(w => w.includes("script_generation") && w.includes("自动补回"))).toBe(true);
  });
});

describe("validateImpactAnalysis - content", () => {
  it("允许回溯一层", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: ["worldview", "story_framework", "outline_batch"], canSkip: [] },
      ["story_framework"],
      "content",
      PIPELINE,
      "content",
    );
    // story_framework idx=5, allow back 1 → idx=4 (character_enrichment)
    // worldview idx=3 < 4 → 剔除
    expect(r.affectedSteps).not.toContain("worldview");
    expect(r.affectedSteps).toContain("story_framework");
    expect(r.affectedSteps).toContain("outline_batch");
    expect(r.earliestAllowedStep).toBe("character_enrichment");
  });
});

describe("validateImpactAnalysis - structural", () => {
  it("允许回溯到叙事根步骤", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: ["initial_plan", "worldview", "story_framework"], canSkip: [] },
      ["script_generation"],
      "structural",
      PIPELINE,
      "structural",
    );
    // structural 允许到 NARRATIVE_ROOTS 中最早一个 = preference_summary (idx=0)
    expect(r.affectedSteps).toContain("initial_plan");
    expect(r.affectedSteps).toContain("worldview");
    expect(r.affectedSteps).toContain("story_framework");
    expect(r.earliestAllowedStep).toBe("preference_summary");
  });
});

describe("validateImpactAnalysis - canSkip", () => {
  it("剔除与 modifications 重叠的 canSkip", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: ["script_generation"], canSkip: ["script_generation", "scene_plan"] },
      ["script_generation"],
      "cosmetic",
      PIPELINE,
    );
    expect(r.canSkip).not.toContain("script_generation");
    expect(r.canSkip).toContain("scene_plan");
    expect(r.warnings.some(w => w.includes("script_generation") && w.includes("修改步骤本身"))).toBe(true);
  });

  it("剔除与 affectedSteps 冲突的 canSkip", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: ["script_generation", "scene_plan"], canSkip: ["scene_plan"] },
      ["script_generation"],
      "content",
      PIPELINE,
      "content",
    );
    expect(r.canSkip).not.toContain("scene_plan");
  });

  it("剔除不在管线中的步骤", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: ["script_generation", "fake_step"], canSkip: ["another_fake"] },
      ["script_generation"],
      "cosmetic",
      PIPELINE,
    );
    expect(r.affectedSteps).not.toContain("fake_step");
    expect(r.canSkip).not.toContain("another_fake");
    expect(r.warnings.some(w => w.includes("fake_step") && w.includes("不在"))).toBe(true);
  });
});

describe("validateImpactAnalysis - nodeImpacts", () => {
  it("剔除 stepId 不在 affectedSteps 中的 nodeImpacts", () => {
    const r = validateImpactAnalysis(
      {
        affectedSteps: ["script_generation"],
        canSkip: [],
        nodeImpacts: [
          { stepId: "script_generation", nodeIds: ["1", "2"] },
          { stepId: "worldview", nodeIds: ["w1"] },
        ],
      },
      ["script_generation"],
      "content",
      PIPELINE,
      "content",
    );
    expect(r.nodeImpacts).toEqual([{ stepId: "script_generation", nodeIds: ["1", "2"] }]);
    expect(r.warnings.some(w => w.includes("worldview") && w.includes("nodeImpacts"))).toBe(true);
  });

  it("nodeIds 为空数组时剔除", () => {
    const r = validateImpactAnalysis(
      {
        affectedSteps: ["script_generation"],
        canSkip: [],
        nodeImpacts: [{ stepId: "script_generation", nodeIds: [] }],
      },
      ["script_generation"],
      "content",
      PIPELINE,
    );
    expect(r.nodeImpacts).toBeNull();
  });
});

describe("validateImpactAnalysis - 非法 category 兜底", () => {
  it("LLM 给出非法 category 时回退到启发式", () => {
    const r = validateImpactAnalysis(
      { affectedSteps: ["worldview", "script_generation"], canSkip: [] },
      ["script_generation"],
      "structural",
      PIPELINE,
      "INVALID_CATEGORY",
    );
    // 应回退到 structural（启发式）→ 允许 worldview
    expect(r.affectedSteps).toContain("worldview");
    expect(r.warnings.some(w => w.includes("INVALID_CATEGORY") && w.includes("非法"))).toBe(true);
  });
});
