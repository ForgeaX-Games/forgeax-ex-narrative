/**
 * 结构读数一律从连接算出来。
 *
 * 被守的分歧：`nodeTypes` 与 `topology` 的计数都是派生量，却由提取阶段的模型填。声明与
 * 图矛盾时（标着 normal 的节点连了三条出边），提取侧读声明、生成侧读拓扑，同一个节点
 * 就有两个功能位 —— 两边各自都"对"，合起来那棵树说不清自己长什么样。
 *
 * 所以每条断言都用**故意标错**的 fixture：声明与连接一致的 fixture 分不出实现读的是哪个。
 */
import { describe, it, expect } from "vitest";
import {
  inferPlotNodeTypes,
  derivePlotTopology,
  normalizePlotTree,
} from "../plot-tree-normalize.js";
import { normalizeTemplate } from "../phase2-extract.js";
import { plotTreeToStructureSeat } from "../plot-tree-to-structure.js";
import type { PlotTree, PlotTreeNode } from "../../types/narrative-ip-dna.js";

function node(p: Partial<PlotTreeNode> & { id: string }): PlotTreeNode {
  return {
    sceneId: "1",
    nodeTypes: ["normal"],
    prevNodes: [],
    nextNodes: [],
    ...p,
  };
}

/**
 * 一棵声明与连接处处矛盾的树：
 *   a 标 normal，实际出度 2（是分叉）；
 *   m 标 normal，实际入度 2（是汇点）；
 *   e 标 pivot，实际出度 0（是结局）。
 * 模型报的 topology 也是一套无关的数。
 */
function lyingTree(): PlotTree {
  return {
    entryNodeId: "a",
    nodes: [
      node({ id: "a", nodeTypes: ["normal"], nextNodes: [{ to: "b", event: "choose", label: "A" }, { to: "c", event: "choose", label: "B" }] }),
      node({ id: "b", prevNodes: ["a"], nextNodes: [{ to: "m", event: "merge" }] }),
      node({ id: "c", prevNodes: ["a"], nextNodes: [{ to: "m", event: "merge" }] }),
      node({ id: "m", nodeTypes: ["normal"], prevNodes: ["b", "c"], nextNodes: [{ to: "e", event: "continue" }] }),
      node({ id: "e", nodeTypes: ["pivot"], prevNodes: ["m"], nextNodes: [], endingType: "good", endingPosition: "final" }),
    ],
    topology: { nodeCount: 99, startCount: 7, endCount: 0, pivotCount: 0, mergeCount: 0 },
  };
}

describe("节点类型由入出度派生", () => {
  it("一个节点可以同时是汇点和分叉", () => {
    // 入度 3 出度 2：两件事都成立，所以给全部命中。生成侧的 NodeFunction 是单值字段，
    // 只能取 branch —— 这就是这边多重、那边单值的原因。
    expect(inferPlotNodeTypes({ prevNodes: ["a", "b", "c"], nextNodes: [{ to: "x", event: "choose" }, { to: "y", event: "choose" }] }).sort())
      .toEqual(["merge", "pivot"]);
  });

  it("孤立节点同时得到 start 与 end，不替它挑一个说法", () => {
    // 那是个错误形状，但两个标签都是实话；连接检查另行报它。
    expect(inferPlotNodeTypes({ prevNodes: [], nextNodes: [] }).sort()).toEqual(["end", "start"]);
  });

  it("都不成立时给 normal，数组永不为空", () => {
    // 空数组会让所有 includes 型读取一律落空，那是"没有任何结构角色"的意思，
    // 而没有节点是那样。
    expect(inferPlotNodeTypes({ prevNodes: ["a"], nextNodes: [{ to: "b", event: "continue" }] })).toEqual(["normal"]);
  });
});

describe("声明与连接矛盾时以连接为准", () => {
  it("归一改写 nodeTypes：标错的三个节点都按图纠正", () => {
    const byId = new Map(normalizePlotTree(lyingTree()).nodes.map((n) => [n.id, n.nodeTypes]));
    // a 还是入口（入度 0），所以它同时是 start 与 pivot，两件事都成立。
    expect(byId.get("a")!.sort()).toEqual(["pivot", "start"]);
    expect(byId.get("m")).toEqual(["merge"]);
    expect(byId.get("e")).toEqual(["end"]);
  });

  it("计数按图重算，不采信模型报的数", () => {
    // 报的是 nodeCount 99 / startCount 7 / endCount 0，图里是 5 / 1 / 1。
    const topo = derivePlotTopology(lyingTree().nodes);
    expect(topo).toMatchObject({ nodeCount: 5, startCount: 1, endCount: 1, pivotCount: 1, mergeCount: 1 });
    expect(topo.endingCountsByType).toEqual({ good: 1 });
  });

  it("原作的结构形态不动：它派生不出来", () => {
    // shape 取生成侧那套 12 码，要读懂剧情才判得出，图里没有。计数全部重算、它原样
    // 保留，正是"派生量派生、非派生量不动"的分界。
    const tree = lyingTree();
    tree.topology.shape = "ring";
    expect(normalizePlotTree(tree).topology.shape).toBe("ring");
  });

  it("功能位与两侧同源：提取侧产出的树，生成侧按度数重算得同一个答案", () => {
    const seat = plotTreeToStructureSeat(lyingTree());
    // 生成侧 id 由场号与场内序号重建，原作 id 住在 sourceIds —— 那正是它的用途。
    const bySource = new Map(seat.outlines.map((o) => [seat.sourceIds[o.node_id], o]));
    const byId = { get: (srcId: string) => bySource.get(srcId) };
    // a 标的是 normal，得到的是 start —— 读的是图，不是声明。它同时入度 0、出度 2，
    // 而 NodeFunction 是单值，按次序取 start；分叉性仍从它的两条 choose 出边读得到。
    expect(byId.get("a")!.node_function).toBe("start");
    expect(byId.get("a")!.edges!.map((e) => e.kind)).toEqual(["choose", "choose"]);
    expect(byId.get("m")!.node_function).toBe("merge");
    // e 标的是 pivot，实际无后继，是结局。
    expect(byId.get("e")!.node_function).toBe("ending");
  });

  it("归一是模型产出进入系统的必经之路", () => {
    // 归一点只有一处才谈得上"以连接为准"：漏一条路，那条路上的树就仍带着声明进来。
    const t = normalizeTemplate({ story_structure: { topology: { nodeCount: 99, startCount: 7, endCount: 0, pivotCount: 0, mergeCount: 0 }, plot_tree: lyingTree() } });
    expect(t.story_structure.topology).toMatchObject({ nodeCount: 5, pivotCount: 1, mergeCount: 1 });
    expect(t.story_structure.plot_tree!.nodes.find((n) => n.id === "a")!.nodeTypes.sort()).toEqual(["pivot", "start"]);
  });

  it("没有树时才保留模型报的数：那时算不出来", () => {
    const t = normalizeTemplate({ story_structure: { topology: { nodeCount: 12, startCount: 1, endCount: 3, pivotCount: 2, mergeCount: 1 } } });
    expect(t.story_structure.topology.nodeCount).toBe(12);
    expect(t.story_structure.plot_tree).toBeUndefined();
  });

  it("幂等：连接没变，归一多少次结果相同", () => {
    const once = normalizePlotTree(lyingTree());
    expect(normalizePlotTree(once)).toEqual(once);
  });
});
