/**
 * 边的走向词汇全仓只有一套，且只回答一个问题。
 *
 * 被守的两件事：
 *
 * 1. **两套词汇归一。** 提取侧曾用 `continue | merge | choose.${label}`，生成侧用
 *    `linear | choice | merge_back | ending`，中间靠一个翻译函数对接。翻译能跑，但
 *    两侧各自演进时没人保证对得上，而 `choose.A` 的后缀与同一条边的 `label` 字段是
 *    一份没人读、却可能与 label 不一致的副本。
 *
 * 2. **边不兼职说节点的事。** 四档互斥，却在回答三个正交的问题（目标出度是否为零、
 *    目标入度是否大于一、本节点出度是否大于一）。挤进一个字段就只能定优先级，而任何
 *    优先级都丢信息：按旧次序，"从分叉点选出去、直奔结局"的边记成 ending，它是一个
 *    玩家选择这件事就没了。这里用那个恰好触发两难的形状钉住新行为。
 */
import { describe, it, expect } from "vitest";
import { deriveTreeFields } from "../graph/outline-tree.js";
import { toEdgeKind } from "../../types/index.js";
import { plotTreeToStructureSeat } from "../../ip-dna/plot-tree-to-structure.js";
import type { PlotTree } from "../../types/narrative-ip-dna.js";

describe("边的走向只说走法", () => {
  /**
   * 旧次序两难的最小形状：n1 分叉成两支，其中 n_die 直奔结局（入度 1、出度 0），
   * 另一支 n_go 继续。旧实现给 n1→n_die 记 ending，于是"这是玩家选的一条路"没了。
   */
  it("分叉出去直奔结局的边，仍然记成玩家的选择", () => {
    const f = deriveTreeFields([
      { node_id: "n1", prev_node: [], next_node: ["n_go", "n_die"] },
      { node_id: "n_go", prev_node: ["n1"], next_node: ["n_end"] },
      { node_id: "n_die", prev_node: ["n1"], next_node: [] },
      { node_id: "n_end", prev_node: ["n_go"], next_node: [] },
    ]);
    const edges = f.get("n1")!.edges;
    expect(edges.map((e) => e.kind)).toEqual(["choose", "choose"]);
    // 标签还在，下游渲染两个选项仍拿得到 A/B。
    expect(edges.map((e) => e.label)).toEqual(["A", "B"]);
    // 结局性没有丢，只是从节点功能位读，而不是从边读。
    expect(f.get("n_die")!.node_function).toBe("ending");
    expect(f.get("n_end")!.node_function).toBe("ending");
  });

  it("提取侧的边不经翻译就是生成侧的边", () => {
    const tree: PlotTree = {
      entryNodeId: "1.1",
      nodes: [
        {
          id: "1.1", sceneId: "1", title: "岔口", nodeTypes: ["pivot"], prevNodes: [],
          question: "走哪条路",
          nextNodes: [
            { to: "1.2", event: "choose", label: "A" },
            { to: "1.3", event: "choose", label: "B" },
          ],
        },
        { id: "1.2", sceneId: "1", title: "左", nodeTypes: ["normal"], prevNodes: ["1.1"], nextNodes: [{ to: "1.4", event: "merge" }] },
        { id: "1.3", sceneId: "1", title: "右", nodeTypes: ["normal"], prevNodes: ["1.1"], nextNodes: [{ to: "1.4", event: "merge" }] },
        { id: "1.4", sceneId: "1", title: "合", nodeTypes: ["merge", "end"], prevNodes: ["1.2", "1.3"], nextNodes: [] },
      ],
      topology: { nodeCount: 4, startCount: 1, endCount: 1, pivotCount: 1, mergeCount: 1 },
    };
    const byId = new Map(plotTreeToStructureSeat(tree).outlines.map((o) => [o.node_id, o]));
    expect(byId.get("1_1")!.edges!.map((e) => e.kind)).toEqual(["choose", "choose"]);
    // 标签只有一处住所：边上的 label。曾经它同时编在 event 的 `choose.A` 后缀里。
    expect(byId.get("1_1")!.edges!.map((e) => e.label)).toEqual(["A", "B"]);
    expect(byId.get("1_2")!.edges![0]!.kind).toBe("merge");
  });

  describe("归一吃得下归档的四档", () => {
    it("归档词汇各归其契约值", () => {
      expect(toEdgeKind("linear")).toBe("continue");
      expect(toEdgeKind("merge_back")).toBe("merge");
      expect(toEdgeKind("choice")).toBe("choose");
      // branch_qte 与 choice 的差别在玩家怎么操作，不在这条边怎么走。
      expect(toEdgeKind("branch_qte")).toBe("choose");
    });

    it("契约三值自身是不动点", () => {
      for (const k of ["continue", "merge", "choose"] as const) expect(toEdgeKind(k)).toBe(k);
    });

    it("认不出来的词归 continue，不凭空造分叉或汇点", () => {
      // 归成 choose 或 merge 会让结构检查按一个不存在的拓扑去判。
      for (const junk of ["ending", "", null, undefined, 3, {}]) expect(toEdgeKind(junk)).toBe("continue");
    });
  });
});
