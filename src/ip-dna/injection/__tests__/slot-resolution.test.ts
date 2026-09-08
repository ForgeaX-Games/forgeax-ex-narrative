import { describe, it, expect } from "vitest";
import { registerAgentDef } from "../../../pipeline/blueprint/agent-def-registry.js";
import type { AgentDef } from "../../../pipeline/blueprint/types.js";
import { getSlotSpec, isOperatorConsumingStep } from "../slot-registry.js";

describe("slot spec resolution (T1 declarative)", () => {
  it("prefers AgentDef.io.consumesIpDna over OPERATOR_SLOT_REGISTRY", () => {
    const def: AgentDef = {
      id: "__t1_decl_step__",
      name: "声明式测试步骤",
      structure: { type: "single-turn", config: { responseFormat: "json" } },
      prompts: { templateId: "__t1_decl_step__", skillSlots: [] },
      io: {
        requiredInputs: [],
        outputField: "x",
        consumesIpDna: { slots: ["对白算子"], kag: true, ledger: false, queryHint: "声明式" },
      },
      dependencies: [],
    };
    registerAgentDef(def);
    const spec = getSlotSpec("__t1_decl_step__");
    expect(spec?.slots).toEqual(["对白算子"]);
    expect(spec?.kag).toBe(true);
    expect(isOperatorConsumingStep("__t1_decl_step__")).toBe(true);
  });

  it("falls back to registry for steps without a declarative AgentDef", () => {
    expect(getSlotSpec("plot_generation")?.slots).toContain("情节算子");
    expect(isOperatorConsumingStep("plot_generation")).toBe(true);
  });

  it("registry steps declare extraction layers (§3.2)", () => {
    expect(getSlotSpec("worldview")?.layers).toEqual(["top"]);
    expect(getSlotSpec("outline_batch")?.layers).toEqual(["mid"]);
    expect(getSlotSpec("plot_generation")?.layers).toEqual(["leaf"]);
    expect(getSlotSpec("story_framework")?.layers).toEqual(["top"]);
  });

  it("returns undefined for non-consuming steps", () => {
    expect(getSlotSpec("tier_router")).toBeUndefined();
    expect(isOperatorConsumingStep("tier_router")).toBe(false);
  });
});
