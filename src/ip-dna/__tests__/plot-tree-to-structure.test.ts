/**
 * 原作剧情树 → 结构席骨架。
 *
 * 主病灶是「IP 结构被洗掉」：原作的树经过降维、压成三段字符串、再被 L0/L1/L2 各自
 * 重新规划，到 L3 已经不剩什么。这里守住映射本身不丢东西 —— 保全清单里的每一项都
 * 要有断言，否则"保真"只是个说法。
 */
import { describe, it, expect } from "vitest";
import {
  plotTreeToStructureSeat,
  plotTreeToStoryFramework,
} from "../plot-tree-to-structure.js";
import type { PlotTree } from "../../types/narrative-ip-dna.js";
import { inferNodeFunction } from "../../pipeline/graph/node-function.js";

/**
 * 两场、七节点、一个三选分叉、一次合流、两个结局。
 * 场 1：开场 → 抉择（三选）
 * 场 2：三条支线，其中两条合流后走全剧终，一条直接走中途 game over
 */
function tree(): PlotTree {
  return {
    entryNodeId: "1.1",
    topology: { nodeCount: 7, startCount: 1, endCount: 2, pivotCount: 1, mergeCount: 1 },
    nodes: [
      {
        id: "1.1", sceneId: "1", title: "雪夜启程", nodeTypes: ["start"],
        prevNodes: [], nextNodes: [{ to: "1.2", event: "continue" }], isMainLine: true,
      },
      {
        id: "1.2", sceneId: "1", title: "三岔口", nodeTypes: ["pivot"],
        prevNodes: ["1.1"],
        nextNodes: [
          { to: "2.1", event: "choose", label: "A" },
          { to: "2.2", event: "choose", label: "B" },
          { to: "2.3", event: "choose", label: "C", condition: "持有信号枪" },
        ],
        question: "往哪走？",
        options: [
          { label: "A", text: "走冰原", leadsTo: "2.1", cost: "体力 -2" },
          { label: "B", text: "走隧道", leadsTo: "2.2" },
          { label: "C", text: "原地呼救", leadsTo: "2.3" },
        ],
        isMainLine: true,
      },
      {
        id: "2.1", sceneId: "2", title: "冰原", nodeTypes: ["normal"],
        prevNodes: ["1.2"], nextNodes: [{ to: "2.4", event: "merge" }], isMainLine: true,
      },
      {
        id: "2.2", sceneId: "2", title: "隧道", nodeTypes: ["normal"],
        prevNodes: ["1.2"], nextNodes: [{ to: "2.4", event: "merge" }],
      },
      {
        id: "2.3", sceneId: "2", title: "冻毙", nodeTypes: ["end"],
        prevNodes: ["1.2"], nextNodes: [], endingType: "bad", endingPosition: "mid",
      },
      {
        id: "2.4", sceneId: "2", title: "汇合", nodeTypes: ["merge"],
        prevNodes: ["2.1", "2.2"], nextNodes: [{ to: "2.5", event: "continue" }], isMainLine: true,
      },
      {
        id: "2.5", sceneId: "2", title: "生还", nodeTypes: ["end"],
        prevNodes: ["2.4"], nextNodes: [], endingType: "good", endingPosition: "final",
        isMainLine: true,
      },
    ],
  };
}

describe("原作剧情树 → L1/L2 结构席骨架", () => {
  it("最小叙事单元成为 L1，父指针指向它所属的场", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    expect(outlines).toHaveLength(7);
    expect(outlines.map((o) => o.node_id)).toEqual([
      "1_1", "1_2", "2_1", "2_2", "2_3", "2_4", "2_5",
    ]);
    expect(outlines.map((o) => o.parent_id)).toEqual(["1", "1", "2", "2", "2", "2", "2"]);
  });

  // 原作 id 允许带字母（`1.1b`）。下游 connection-repair 从 id 里按 `<数字><字母>`
  // 读"分支路径"，`1_1b` 会被读成"在分支 b 上"，于是它与别的分支被判不兼容，修复链
  // 把原作真实存在的边删掉。生成侧 id 必须是纯数字段。
  it("生成侧 id 只含数字段，不把原作 id 的字母带进来", () => {
    const withLetters: PlotTree = {
      ...tree(),
      nodes: tree().nodes.map((n) => ({ ...n, id: `${n.id}b`, prevNodes: n.prevNodes.map((p) => `${p}b`), nextNodes: n.nextNodes.map((e) => ({ ...e, to: `${e.to}b` })) })),
      entryNodeId: "1.1b",
    };
    const { outlines, detailedOutlines } = plotTreeToStructureSeat(withLetters);
    for (const n of [...outlines, ...detailedOutlines]) {
      expect(n.node_id, n.node_id).toMatch(/^\d+(_\d+)*$/);
    }
  });

  it("原作 id 记在对照表里，没有丢", () => {
    const { outlines, sourceIds } = plotTreeToStructureSeat(tree());
    expect(sourceIds[outlines[0]!.node_id]).toBe("1.1");
    expect(sourceIds["2_5"]).toBe("2.5");
  });

  it("拓扑照抄原作，包括跨场的边", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    const byId = new Map(outlines.map((o) => [o.node_id, o]));
    // 场 1 的分叉指向场 2 的三个节点。
    expect(byId.get("1_2")!.next_node).toEqual(["2_1", "2_2", "2_3"]);
    // 合流点保留两个入边。
    expect(byId.get("2_4")!.prev_node).toEqual(["2_1", "2_2"]);
  });

  it("提问与选项成为出边上的选择条件，代价一并带过来", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    const pivot = outlines.find((o) => o.node_id === "1_2")!;
    expect(pivot.node_function).toBe("branch");
    expect(pivot.edges).toHaveLength(3);
    const a = pivot.edges!.find((e) => e.to === "2_1")!;
    expect(a.kind).toBe("choose");
    expect(a.label).toBe("A");
    expect(a.condition?.type).toBe("choice");
    expect(a.condition?.description).toBe("走冰原");
    expect(a.condition?.cost).toBe("体力 -2");
  });

  // NodeCondition 是单条件模型，而原作能同时给「玩家做了什么」和「要满足什么前提」。
  // 只取其一，下游情节层与任务层就少掉一个约束 —— 那是「原作结构被洗掉」的细粒度形态。
  it("选项文案与边上条件同时存在时合并，不丢一半", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    const c = outlines.find((o) => o.node_id === "1_2")!.edges!.find((e) => e.to === "2_3")!;
    expect(c.condition?.description).toBe("原地呼救；持有信号枪");
  });

  it("边的三种事件映射成三种边类型", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    const byId = new Map(outlines.map((o) => [o.node_id, o]));
    expect(byId.get("1_1")!.edges![0]!.kind).toBe("continue");
    expect(byId.get("2_1")!.edges![0]!.kind).toBe("merge");
    expect(byId.get("1_2")!.edges!.every((e) => e.kind === "choose")).toBe(true);
  });

  it("结局分档带上二维：好坏归 good/bad/neutral，中途与全剧终归 local/global", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    const byId = new Map(outlines.map((o) => [o.node_id, o]));
    // 中途 game over 与全剧终是两回事：不分档，允许失败的游戏会被判"结局太多"。
    expect(byId.get("2_3")!.ending).toMatchObject({ kind: "bad", scope: "local" });
    expect(byId.get("2_5")!.ending).toMatchObject({ kind: "good", scope: "global" });
  });

  it("结局的达成条件取原作入边说过的话，没说就不编", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    const byId = new Map(outlines.map((o) => [o.node_id, o]));
    // 2.3 由选项 C 通向，且原作给了额外前提 —— 两者都要出现在达成条件里。
    expect(byId.get("2_3")!.ending!.trigger).toBe("原地呼救；持有信号枪");
    // 2.5 的入边是无条件推进，原作没给条件。
    expect(byId.get("2_5")!.ending!.trigger).toBeUndefined();
  });

  it("主线标记成为最优路径标记", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    const onPath = outlines.filter((o) => o.on_optimal_path).map((o) => o.node_id);
    expect(onPath).toEqual(["1_1", "1_2", "2_1", "2_4", "2_5"]);
  });

  // 显式功能位与拓扑推断两边同序，一致才不会被 node-function 的分歧检查报警。
  it("功能位与入出度推断一致", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    for (const o of outlines) {
      expect(inferNodeFunction(o.prev_node, o.next_node), o.node_id).toBe(o.node_function);
    }
  });

  it("分叉给出代价档：分向结局的是终结型，会合流的是收束型", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    // 1.2 的三条支线里有一条直通结局 → terminal。
    expect(outlines.find((o) => o.node_id === "1_2")!.branch_type).toBe("terminal");
  });

  it("L2 与 L1 一一对应，拓扑同构、父指针指向 L1", () => {
    const { outlines, detailedOutlines } = plotTreeToStructureSeat(tree());
    expect(detailedOutlines).toHaveLength(outlines.length);
    expect(detailedOutlines.map((d) => d.node_id)).toEqual(outlines.map((o) => `${o.node_id}_1`));
    expect(detailedOutlines.map((d) => d.parent_id)).toEqual(outlines.map((o) => o.node_id));
    const l2Pivot = detailedOutlines.find((d) => d.node_id === "1_2_1")!;
    expect(l2Pivot.next_node).toEqual(["2_1_1", "2_2_1", "2_3_1"]);
    expect(l2Pivot.edges!.map((e) => e.to)).toEqual(["2_1_1", "2_2_1", "2_3_1"]);
  });

  it("结构席不写正文：内容字段留空交给内容填充", () => {
    const { outlines } = plotTreeToStructureSeat(tree());
    for (const o of outlines) {
      expect(o.content).toBe("");
      expect(o.story_elements.plot.cause).toBe("");
    }
  });
});

describe("原作剧情树 → L0 框架", () => {
  it("按场聚合而不是按最小叙事单元", () => {
    const fw = plotTreeToStoryFramework(tree());
    expect(fw.framework.nodes.map((n) => n.node_id)).toEqual(["1", "2"]);
  });

  /**
   * 这条是这次改动的理由本身：MIN_PLOT_TREE_NODES 是 25，而 L0 预算最宽的史诗档
   * 上限是 15。按最小叙事单元展开，光 L0 就超预算两三倍，体量档位当场失效。
   */
  it("25 节点的原作给出个位数的 L0，而不是 25 章", () => {
    const many: PlotTree = {
      entryNodeId: "1.1",
      topology: { nodeCount: 25, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 },
      nodes: Array.from({ length: 25 }, (_, i) => ({
        id: `${Math.floor(i / 5) + 1}.${(i % 5) + 1}`,
        sceneId: String(Math.floor(i / 5) + 1),
        nodeTypes: ["normal" as const],
        prevNodes: [],
        nextNodes: [],
      })),
    };
    expect(plotTreeToStoryFramework(many).framework.nodes).toHaveLength(5);
    expect(plotTreeToStructureSeat(many).outlines).toHaveLength(25);
  });

  it("场间连接由跨场的边推导，场内的边不算", () => {
    const fw = plotTreeToStoryFramework(tree());
    const byId = new Map(fw.framework.nodes.map((n) => [n.node_id, n]));
    expect(byId.get("1")!.next_node).toEqual(["2"]);
    expect(byId.get("2")!.prev_node).toEqual(["1"]);
    // 场 1 内部 1.1→1.2 的边不该冒充场级连接。
    expect(byId.get("1")!.prev_node).toEqual([]);
  });

  // L0 的 is_branch 决定 seeded 模式把原作记成 branching 还是 linear，
  // 判错会让原作的分叉在 L0 就被抹平，后面哪层都救不回来。
  it("场里有分叉，这一章就标成分叉章", () => {
    const fw = plotTreeToStoryFramework(tree());
    const byId = new Map(fw.framework.nodes.map((n) => [n.node_id, n]));
    expect(byId.get("1")!.is_branch).toBe(true);
    expect(byId.get("2")!.is_branch).toBeUndefined();
  });

  it("场号不是纯数字时退回场序号，保证 id 段合法", () => {
    const odd: PlotTree = {
      ...tree(),
      nodes: tree().nodes.map((n) => ({ ...n, sceneId: n.sceneId === "1" ? "序章" : "第二幕" })),
    };
    expect(plotTreeToStoryFramework(odd).framework.nodes.map((n) => n.node_id)).toEqual(["1", "2"]);
    for (const o of plotTreeToStructureSeat(odd).outlines) {
      expect(o.node_id).toMatch(/^\d+_\d+$/);
    }
  });
});
