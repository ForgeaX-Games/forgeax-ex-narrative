import { describe, it, expect } from "vitest";
import {
  assertRequirementMatrixComplete,
  REQUIREMENT_FIELD_MATRIX,
  prototypeFromStructure,
  connectionCapabilitiesOf,
  shouldSkipByLifecycle,
  narrativeAgentFromDef,
} from "../core/agent-contract.js";
import { planExecutionWaves } from "../blueprint/runners/composite-plan.js";
import {
  splitCompositionByStartNodes,
  isCompositionComplete,
} from "../../types/run-manifest.js";
import type { AgentDef } from "../blueprint/types.js";

describe("M0 agent contract gate", () => {
  it("requirement × field matrix is fully expressible", () => {
    expect(() => assertRequirementMatrixComplete()).not.toThrow();
    expect(REQUIREMENT_FIELD_MATRIX.length).toBeGreaterThanOrEqual(10);
    expect(REQUIREMENT_FIELD_MATRIX.every((r) => r.expressible)).toBe(true);
  });

  it("maps structure primitives to 4 prototypes", () => {
    expect(prototypeFromStructure("single-turn")).toBe("atomic");
    expect(prototypeFromStructure("deterministic")).toBe("atomic");
    expect(prototypeFromStructure("sequence")).toBe("serial");
    expect(prototypeFromStructure("chunked")).toBe("parallel");
    expect(prototypeFromStructure("composite")).toBe("nested");
    expect(prototypeFromStructure("conditional")).toBe("nested");
  });

  it("nested prototype can nest children", () => {
    expect(connectionCapabilitiesOf("nested").canNestChildren).toBe(true);
    expect(connectionCapabilitiesOf("atomic").canNestChildren).toBe(false);
  });

  it("lifecycle skip rules", () => {
    expect(shouldSkipByLifecycle("completed")).toBe(true);
    expect(shouldSkipByLifecycle("skipped")).toBe(true);
    expect(shouldSkipByLifecycle("pending")).toBe(false);
    expect(shouldSkipByLifecycle("failed")).toBe(false);
  });

  it("bridges AgentDef → NarrativeAgent with derived prototype", () => {
    const def: AgentDef = {
      id: "worldview",
      name: "世界观",
      structure: {
        type: "single-turn",
        config: { responseFormat: "json" },
      },
      prompts: { templateId: "worldview", skillSlots: ["style_guide"] },
      io: { requiredInputs: ["initial_story_outline"], outputField: "worldview_structure" },
      dependencies: ["initial_plan"],
    };
    const agent = narrativeAgentFromDef(def);
    expect(agent.prototype).toBe("atomic");
    expect(agent.io.outputField).toBe("worldview_structure");
  });
});

describe("M1 composite waves", () => {
  it("serializes children when no edges", () => {
    expect(
      planExecutionWaves({ children: ["a", "b", "c"] }),
    ).toEqual([["a"], ["b"], ["c"]]);
  });

  it("respects parallelGroups without edges", () => {
    expect(
      planExecutionWaves({
        children: ["a", "b", "c", "d"],
        parallelGroups: [["b", "c"]],
      }),
    ).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("topo-sorts with edges", () => {
    const waves = planExecutionWaves({
      children: ["a", "b", "c"],
      edges: [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ],
    });
    expect(waves[0]).toEqual(["a"]);
    expect(new Set(waves[1])).toEqual(new Set(["b", "c"]));
  });
});

describe("M2 multi-pipeline composition", () => {
  it("splits canvas by independent start nodes", () => {
    const graphs = splitCompositionByStartNodes(
      [
        { id: "in1", catalogId: "input.text", category: "input", config: {} },
        { id: "in2", catalogId: "input.text", category: "input", config: {} },
        { id: "r1", catalogId: "routing.planning", category: "routing", config: {} },
        { id: "e1", catalogId: "engineer.worldview", category: "engineer", config: {} },
      ],
      [
        { id: "e1", source: "in1", target: "r1" },
        { id: "e2", source: "r1", target: "e1" },
        // in2 isolated start — still a pipeline
      ],
    );
    expect(graphs).toHaveLength(2);
    expect(graphs.map((g) => g.startNodeId).sort()).toEqual(["in1", "in2"]);
    expect(graphs.find((g) => g.startNodeId === "in1")!.nodes).toHaveLength(3);
    expect(graphs.find((g) => g.startNodeId === "in2")!.nodes).toHaveLength(1);
  });

  it("marks incomplete graphs", () => {
    const incomplete = isCompositionComplete({
      startNodeId: "in1",
      nodes: [{ id: "in1", catalogId: "input.text", category: "input", config: {} }],
      edges: [],
    });
    expect(incomplete.complete).toBe(false);

    const complete = isCompositionComplete({
      startNodeId: "in1",
      nodes: [
        { id: "in1", catalogId: "input.text", category: "input", config: {} },
        { id: "ex", catalogId: "expert.jrpg", category: "expert", config: {} },
      ],
      edges: [{ id: "e", source: "in1", target: "ex" }],
    });
    expect(complete.complete).toBe(true);
  });
});
