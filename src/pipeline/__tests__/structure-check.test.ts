import { describe, it, expect } from "vitest";
import { buildStructureCheckReport } from "../steps/structure-check.js";
import type { NarrativeContext, OutlineNode, VnBranchedBeats } from "../../types/index.js";

/**
 * 结构检查席位覆盖席位表 2.5.15 点名、而内联修复钩子一直没做的两项：
 * 结局节点设置与节奏设置。这里只测这两项和总判定——
 * 连接/环路/分支-合并沿用既有规则引擎，已有各自的测试。
 */

function outline(
  node_id: string,
  parent_id: string,
  prev: string[],
  next: string[],
): OutlineNode {
  return {
    node_id,
    parent_id,
    name: node_id,
    narrative_stage: "",
    prev_node: prev,
    next_node: next,
    story_elements: { plot: { cause: "", process: "", result: "" } },
  } as OutlineNode;
}

function ctxWithOutlines(nodes: OutlineNode[]): NarrativeContext {
  return { outlines_generated: { outlines: nodes } } as unknown as NarrativeContext;
}

/** 一条 A→B→C 的线，挂在同一幕下。 */
function chain(prefix: string, group: string, n: number): OutlineNode[] {
  return Array.from({ length: n }, (_, i) =>
    outline(
      `${prefix}${i}`,
      group,
      i === 0 ? [] : [`${prefix}${i - 1}`],
      i === n - 1 ? [] : [`${prefix}${i + 1}`],
    ),
  );
}

describe("结构检查：结局节点", () => {
  it("每个节点都有后继时报「走不到头」", () => {
    // 三节点成环，无终点
    const nodes = [
      outline("a", "act1", ["c"], ["b"]),
      outline("b", "act1", ["a"], ["c"]),
      outline("c", "act1", ["b"], ["a"]),
    ];
    const report = buildStructureCheckReport(ctxWithOutlines(nodes));
    expect(report.layers[0]!.endings.count).toBe(0);
    expect(report.layers[0]!.endings.issues.join()).toContain("走不到头");
  });

  it("只能从孤立环走到的结局报「走不到」", () => {
    const nodes = [
      // 唯一起点链
      ...chain("a", "act1", 3),
      // 与起点不连通的环，以及只挂在环上的结局
      outline("p", "act1", ["q"], ["q"]),
      outline("q", "act1", ["p"], ["p", "lost"]),
      outline("lost", "act1", ["q"], []),
    ];
    const report = buildStructureCheckReport(ctxWithOutlines(nodes));
    expect(report.layers[0]!.endings.issues.join()).toContain("lost");
    expect(report.layers[0]!.endings.issues.join()).toContain("走不到");
  });

  it("结局过多时提醒可能把中途终点误标成了结局", () => {
    const nodes = [
      outline("hub", "act1", [], Array.from({ length: 9 }, (_, i) => `e${i}`)),
      ...Array.from({ length: 9 }, (_, i) => outline(`e${i}`, "act1", ["hub"], [])),
    ];
    const report = buildStructureCheckReport(ctxWithOutlines(nodes));
    expect(report.layers[0]!.endings.issues.join()).toContain("超过");
  });
});

describe("结构检查：节奏", () => {
  it("叙事单元长度倍差过大时报失衡", () => {
    const nodes = [...chain("a", "act1", 12), ...chain("b", "act2", 2)];
    const report = buildStructureCheckReport(ctxWithOutlines(nodes));
    expect(report.layers[0]!.pacing.issues.join()).toContain("单元长度失衡");
  });

  it("长链完全没有分叉时报过于线性", () => {
    const report = buildStructureCheckReport(ctxWithOutlines(chain("a", "act1", 10)));
    expect(report.layers[0]!.pacing.issues.join()).toContain("完全线性");
  });

  it("短链没有分叉属正常，不报", () => {
    const report = buildStructureCheckReport(ctxWithOutlines(chain("a", "act1", 4)));
    expect(report.layers[0]!.pacing.issues.join()).not.toContain("完全线性");
  });

  it("分支密度过高时报主线被稀释", () => {
    // 6 个节点里 4 个在分叉
    const nodes = [
      outline("a", "act1", [], ["b", "c"]),
      outline("b", "act1", ["a"], ["d", "e"]),
      outline("c", "act1", ["a"], ["d", "e"]),
      outline("d", "act1", ["b", "c"], ["e", "f"]),
      outline("e", "act1", ["b", "c", "d"], []),
      outline("f", "act1", ["d"], []),
    ];
    const report = buildStructureCheckReport(ctxWithOutlines(nodes));
    expect(report.layers[0]!.pacing.branchRatio).toBeGreaterThan(0.5);
    expect(report.layers[0]!.pacing.issues.join()).toContain("分支密度");
  });
});

describe("结构检查：影游剧情树", () => {
  it("分叉后既不汇聚也不走向结局，报断头路", () => {
    // RPG 各层里「没有后继」就等于结局，断头路只可能出现在带显式结局标记的剧情树上
    const tree = {
      acts: [],
      scenes: [],
      beats: [
        {
          beat_id: "b1",
          act_id: "一",
          scene_id: "",
          content: "",
          prev_nodes: [],
          next_nodes: [
            { to: "b2", kind: "choice", label: "A" },
            { to: "b3", kind: "choice", label: "B" },
          ],
          is_main_line: true,
          is_ending: false,
        },
        // B 支走到这里就没了，也没标结局
        {
          beat_id: "b2",
          act_id: "一",
          scene_id: "",
          content: "",
          prev_nodes: ["b1"],
          next_nodes: [],
          is_main_line: false,
          is_ending: false,
        },
        {
          beat_id: "b3",
          act_id: "一",
          scene_id: "",
          content: "",
          prev_nodes: ["b1"],
          next_nodes: [],
          is_main_line: false,
          is_ending: false,
        },
      ],
      endings: [],
    } as unknown as VnBranchedBeats;

    const report = buildStructureCheckReport({
      vn_branched_beats: tree,
    } as unknown as NarrativeContext);
    const vn = report.layers.find((l) => l.layer === "VN")!;
    expect(vn.pacing.issues.join()).toContain("断头路");
  });

  it("独立结局表里的结局不会被当成断头路", () => {
    const tree = {
      acts: [],
      scenes: [],
      beats: [
        {
          beat_id: "b1",
          act_id: "一",
          scene_id: "",
          content: "",
          prev_nodes: [],
          next_nodes: [
            { to: "b2", kind: "choice", label: "A" },
            { to: "END_B1", kind: "choice", label: "B" },
          ],
          is_main_line: true,
          is_ending: false,
        },
        {
          beat_id: "b2",
          act_id: "一",
          scene_id: "",
          content: "",
          prev_nodes: ["b1"],
          next_nodes: [{ to: "END_H1", kind: "linear" }],
          is_main_line: true,
          is_ending: false,
        },
      ],
      endings: [
        { ending_id: "END_H1", label: "H", title: "", content: "" },
        { ending_id: "END_B1", label: "B", title: "", content: "" },
      ],
    } as unknown as VnBranchedBeats;

    const report = buildStructureCheckReport({
      vn_branched_beats: tree,
    } as unknown as NarrativeContext);

    const vn = report.layers.find((l) => l.layer === "VN")!;
    expect(vn.endings.nodeIds.sort()).toEqual(["END_B1", "END_H1"]);
    expect(vn.pacing.issues.join()).not.toContain("断头路");
  });
});

describe("结构检查：总判定", () => {
  it("一层结构都没有时不报 pass", () => {
    const report = buildStructureCheckReport({} as NarrativeContext);
    expect(report.layers).toEqual([]);
    expect(report.verdict).toBe("warn");
    expect(report.summary).toContain("没有可检查的结构");
  });

  it("干净结构判 pass", () => {
    // 分叉 → 各走一步 → 汇聚 → 结局
    const nodes = [
      outline("start", "act1", [], ["l", "r"]),
      outline("l", "act1", ["start"], ["merge"]),
      outline("r", "act1", ["start"], ["merge"]),
      outline("merge", "act1", ["l", "r"], ["end"]),
      outline("end", "act1", ["merge"], []),
    ];
    const report = buildStructureCheckReport(ctxWithOutlines(nodes));
    expect(report.layers[0]!.endings.issues).toEqual([]);
    expect(report.layers[0]!.pacing.issues).toEqual([]);
  });
});

/**
 * 归一后的 findings。
 *
 * 报告本身早就能报出问题，卡在「报出来的问题没法被勾、没法被修」——裸字符串
 * 数组既没有稳定标识也没有节点定位。这组断言守的是那三件让闭环成立的事：
 * id 稳定、节点定位取得到、可修与不可修分得清。
 */
describe("结构检查：findings 归一", () => {
  /** 一条断边：b 指向不存在的 zzz。 */
  function brokenCtx(): NarrativeContext {
    return ctxWithOutlines([
      outline("a", "act1", [], ["b"]),
      outline("b", "act1", ["a"], ["zzz"]),
    ]);
  }

  it("三处裸字符串都进了扁平清单", () => {
    const report = buildStructureCheckReport(brokenCtx());
    const layer = report.layers[0]!;
    const rawCount =
      layer.errors.length +
      layer.warnings.length +
      layer.cycles.length +
      layer.branchMergeErrors.length +
      layer.endings.issues.length +
      layer.pacing.issues.length +
      layer.functions.issues.length;
    expect(report.findings).toHaveLength(rawCount);
    expect(rawCount).toBeGreaterThan(0);
  });

  it("同一份产物重复检查得到同一批 id——否则勾选一刷新就全对不上号", () => {
    const a = buildStructureCheckReport(brokenCtx()).findings.map((f) => f.id);
    const b = buildStructureCheckReport(brokenCtx()).findings.map((f) => f.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("连接类问题带 topology 修法与目标层，定位得到出问题的节点", () => {
    const report = buildStructureCheckReport(brokenCtx());
    const broken = report.findings.find((f) => f.issue.includes("zzz"))!;
    expect(broken.repairKind).toBe("topology");
    expect(broken.targetField).toBe("outlines_generated");
    expect(broken.nodeId).toBe("b");
  });

  it("要作者自己定夺的问题不给修法——给了勾选框点下去也没反应", () => {
    // 8 个节点全线性：报"过于线性"，这得靠加分支解决，不是连接修复能办的。
    const report = buildStructureCheckReport(ctxWithOutlines(chain("n", "act1", 8)));
    const pacing = report.findings.find((f) => f.issue.includes("完全线性"))!;
    expect(pacing.repairKind).toBeUndefined();
    expect(pacing.targetField).toBeUndefined();
  });

  it("图上干净的结构不产出任何待修条目", () => {
    const nodes = [
      outline("start", "act1", [], ["l", "r"]),
      outline("l", "act1", ["start"], ["merge"]),
      outline("r", "act1", ["start"], ["merge"]),
      outline("merge", "act1", ["l", "r"], ["end"]),
      outline("end", "act1", ["merge"], []),
    ];
    const { findings } = buildStructureCheckReport(ctxWithOutlines(nodes));
    expect(findings.filter((f) => f.repairKind)).toEqual([]);
    expect(findings.some((f) => f.severity === "error")).toBe(false);
  });

  it("分层：多层结构的 finding 各自指向自己那层的字段", () => {
    const report = buildStructureCheckReport({
      outlines_generated: { outlines: [outline("a", "act1", [], ["missing"])] },
      plots_generated: {
        plots: [
          { node_id: "p1", parent_id: "act1", prev_node: [], next_node: ["gone"], content: "x" },
        ],
      },
    } as unknown as NarrativeContext);

    const fields = new Set(report.findings.filter((f) => f.targetField).map((f) => f.targetField));
    expect(fields).toEqual(new Set(["outlines_generated", "plots_generated"]));
  });
});
