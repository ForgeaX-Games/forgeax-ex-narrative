import { describe, it, expect } from "vitest";
import {
  deriveTreeFields,
  mergeTreeSemantics,
  treeSemanticsPromptSpec,
  type TreeShapeNode,
} from "../graph/outline-tree.js";
import { checkNodeFunctions } from "../graph/node-function.js";

/**
 * 一个「分岔 → 两支 → 汇回 → 结局」的最小剧情树，形状与 buildSkeleton
 * 在 shouldMerge 时产出的骨架一致。
 */
const DIAMOND: TreeShapeNode[] = [
  { node_id: "n1", prev_node: [], next_node: ["n2a", "n2b"] },
  { node_id: "n2a", prev_node: ["n1"], next_node: ["n3"] },
  { node_id: "n2b", prev_node: ["n1"], next_node: ["n3"] },
  { node_id: "n3", prev_node: ["n2a", "n2b"], next_node: ["n4"] },
  { node_id: "n4", prev_node: ["n3"], next_node: [] },
];

describe("剧情树落盘归一化", () => {
  it("功能位由入出度推出", () => {
    const f = deriveTreeFields(DIAMOND);
    expect(f.get("n1")!.node_function).toBe("start");
    expect(f.get("n2a")!.node_function).toBe("normal");
    expect(f.get("n3")!.node_function).toBe("merge");
    expect(f.get("n4")!.node_function).toBe("ending");
  });

  it("分岔的出边标 choice 并带 A/B 标签", () => {
    const edges = deriveTreeFields(DIAMOND).get("n1")!.edges;
    expect(edges.map((e) => e.kind)).toEqual(["choice", "choice"]);
    expect(edges.map((e) => e.label)).toEqual(["A", "B"]);
  });

  it("汇回的边标 merge_back，进结局的边标 ending", () => {
    const f = deriveTreeFields(DIAMOND);
    expect(f.get("n2a")!.edges[0]!.kind).toBe("merge_back");
    expect(f.get("n3")!.edges[0]!.kind).toBe("ending");
  });

  it("一步汇合判 converge，直接进结局判 terminal，各走各的判 diverge", () => {
    expect(deriveTreeFields(DIAMOND).get("n1")!.branch_type).toBe("converge");

    const terminal: TreeShapeNode[] = [
      { node_id: "a", prev_node: [], next_node: ["b", "dead"] },
      { node_id: "b", prev_node: ["a"], next_node: ["end"] },
      { node_id: "dead", prev_node: ["a"], next_node: [] },
      { node_id: "end", prev_node: ["b"], next_node: [] },
    ];
    expect(deriveTreeFields(terminal).get("a")!.branch_type).toBe("terminal");

    const diverge: TreeShapeNode[] = [
      { node_id: "a", prev_node: [], next_node: ["l1", "r1"] },
      { node_id: "l1", prev_node: ["a"], next_node: ["l2"] },
      { node_id: "r1", prev_node: ["a"], next_node: ["r2"] },
      { node_id: "l2", prev_node: ["l1"], next_node: ["l3"] },
      { node_id: "r2", prev_node: ["r1"], next_node: ["r3"] },
      { node_id: "l3", prev_node: ["l2"], next_node: [] },
      { node_id: "r3", prev_node: ["r2"], next_node: [] },
    ];
    expect(deriveTreeFields(diverge).get("a")!.branch_type).toBe("diverge");
  });

  it("非分岔节点不给代价档", () => {
    expect(deriveTreeFields(DIAMOND).get("n2a")!.branch_type).toBeUndefined();
  });

  it("边的目标与 next_node 一致，结构检查不报 edge_mismatch", () => {
    const fields = deriveTreeFields(DIAMOND);
    const issues = checkNodeFunctions(
      DIAMOND.map((n) => ({
        id: n.node_id,
        prev: n.prev_node,
        next: n.next_node,
        declared: fields.get(n.node_id)!.node_function,
        edges: fields.get(n.node_id)!.edges,
        branchType: fields.get(n.node_id)!.branch_type,
      })),
    );
    expect(issues.filter((i) => i.kind === "edge_mismatch")).toEqual([]);
    expect(issues.filter((i) => i.kind === "mismatch")).toEqual([]);
  });

  it("模型给的条件挂到对应边上；没给的边不留空条件", () => {
    const derived = deriveTreeFields(DIAMOND).get("n1")!;
    const merged = mergeTreeSemantics(derived, {
      edge_conditions: {
        n2a: { type: "choice", description: "选择救人", cost: "错过线索" },
      },
      branch_type: "diverge",
    });
    expect(merged.edges.find((e) => e.to === "n2a")!.condition?.description).toBe("选择救人");
    expect(merged.edges.find((e) => e.to === "n2b")!.condition).toBeUndefined();
    // 模型的判断优先于拓扑推导（分歧交给结构检查报告）
    expect(merged.branch_type).toBe("diverge");
  });

  it("结局分档不编造：模型没给就是没有", () => {
    const derived = deriveTreeFields(DIAMOND).get("n4")!;
    expect(mergeTreeSemantics(derived, undefined).ending).toBeUndefined();
    expect(
      mergeTreeSemantics(derived, { ending: { label: "H", scope: "global" } }).ending?.scope,
    ).toBe("global");
  });

  it("提示词只对有分岔/结局的节点组追加语义要求", () => {
    expect(treeSemanticsPromptSpec(DIAMOND)).toContain("n1");
    expect(treeSemanticsPromptSpec(DIAMOND)).toContain("n4");

    const linear: TreeShapeNode[] = [
      { node_id: "a", prev_node: [], next_node: ["b"] },
      { node_id: "b", prev_node: ["a"], next_node: ["c"] },
    ];
    expect(treeSemanticsPromptSpec(linear)).toBe("");
  });
});
