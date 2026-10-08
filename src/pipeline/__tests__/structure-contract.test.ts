/**
 * 契约硬规则：这棵树算不算一棵合格的树。
 *
 * 与既有的结局检查、节奏检查是不同的问题 —— 那两组问「这棵树好不好」，答案可以见仁见智；
 * 这组问的是形制，编号乱序、假分支、标了结局又有后继都不是风格选择。
 *
 * 规则来自 §4.3 的编号律与外部提示词三版演进的踩坑史。**光靠提示词约束不够**是这组存在
 * 的理由：提示词第三版拿近半篇幅讲「分叉后不要一跳就合流」，反复叮嘱仍会犯，所以要机械兜底。
 *
 * 每条规则都配一个**不该被它抓**的形状。少了那一半，把规则写成「凡分叉即报错」也能让
 * 前一半全绿，而那种实现会把系统自己生成的标准骨架判成缺陷 —— 本轮就实际发生过一次。
 */
import { describe, it, expect } from "vitest";
import { buildStructureCheckReport } from "../steps/structure-check.js";
import type { NarrativeContext, OutlineNode, EndingSpec } from "../../types/index.js";

function outline(
  node_id: string,
  parent_id: string,
  prev: string[],
  next: string[],
  extra: Partial<OutlineNode> = {},
): OutlineNode {
  return {
    node_id,
    parent_id,
    name: node_id,
    narrative_stage: "",
    prev_node: prev,
    next_node: next,
    story_elements: { plot: { cause: "", process: "", result: "" } },
    ...extra,
  } as OutlineNode;
}

function contractIssues(nodes: OutlineNode[]): string[] {
  const report = buildStructureCheckReport({
    outlines_generated: { outlines: nodes },
  } as unknown as NarrativeContext);
  return report.layers[0]!.contract.issues;
}

/** 一个菱形：分叉 → 各支一个节点 → 合并点。`buildSkeleton` 的 shouldMerge 就生成这形状。 */
function diamond(prefix: string, group: string, entry: string[], exit: string[]): OutlineNode[] {
  return [
    outline(`${prefix}_1`, group, entry, [`${prefix}_2`, `${prefix}_3`]),
    outline(`${prefix}_2`, group, [`${prefix}_1`], [`${prefix}_4`]),
    outline(`${prefix}_3`, group, [`${prefix}_1`], [`${prefix}_4`]),
    outline(`${prefix}_4`, group, [`${prefix}_2`, `${prefix}_3`], exit),
  ];
}

describe("编号律", () => {
  it("id 未按 DFS 序递增就报出来", () => {
    // 乱序的树没法靠 id 判先后，而人工排查、日志对照、断点续跑都在靠 id 认位置。
    const issues = contractIssues([
      outline("1_1", "1", [], ["1_3"]),
      outline("1_3", "1", ["1_1"], ["1_2"]),
      outline("1_2", "1", ["1_3"], []),
    ]);
    expect(issues.some((m) => m.includes("未按 DFS 序递增"))).toBe(true);
  });

  it("递增的编号不报", () => {
    const issues = contractIssues([
      outline("1_1", "1", [], ["1_2"]),
      outline("1_2", "1", ["1_1"], ["2_1"]),
      outline("2_1", "2", ["1_2"], []),
    ]);
    expect(issues.filter((m) => m.includes("DFS"))).toEqual([]);
  });

  it("id 解析不出数值序时不报，不把格式差异当乱序", () => {
    // 各层 id 格式不统一，拿解析失败当错误会让一份干净的报告判成 error，
    // 真问题就淹在噪声里。
    const issues = contractIssues([
      outline("start", "1", [], ["mid"]),
      outline("mid", "1", ["start"], ["finale"]),
      outline("finale", "1", ["mid"], []),
    ]);
    expect(issues.filter((m) => m.includes("DFS"))).toEqual([]);
  });
});

describe("场号同步律", () => {
  it("同一叙事单元的节点被拆成两段就报出来", () => {
    const issues = contractIssues([
      outline("1_1", "1", [], ["2_1"]),
      outline("2_1", "2", ["1_1"], ["1_2"]),
      outline("1_2", "1", ["2_1"], []),
    ]);
    expect(issues.some((m) => m.includes("不连续"))).toBe(true);
  });

  it("单元依次出现、各自连续就不报", () => {
    const issues = contractIssues([
      outline("1_1", "1", [], ["1_2"]),
      outline("1_2", "1", ["1_1"], ["2_1"]),
      outline("2_1", "2", ["1_2"], ["2_2"]),
      outline("2_2", "2", ["2_1"], []),
    ]);
    expect(issues.filter((m) => m.includes("不连续"))).toEqual([]);
  });
});

describe("标了结局的节点不得有出边", () => {
  const ending: EndingSpec = { kind: "good", scope: "global", trigger: "救出所有人" };

  it("声明与拓扑矛盾时报出来", () => {
    // 这查的是声明与拓扑的矛盾：各层的 isEnding 由出度派生、恒不矛盾，而 ending
    // 字段是结构席显式给的，能与出边并存。
    const issues = contractIssues([
      outline("1_1", "1", [], ["1_2"]),
      outline("1_2", "1", ["1_1"], ["1_3"], { ending }),
      outline("1_3", "1", ["1_2"], []),
    ]);
    expect(issues.some((m) => m.includes("标了结局") && m.includes("1_2"))).toBe(true);
  });

  it("真终点上的结局声明不报", () => {
    const issues = contractIssues([
      outline("1_1", "1", [], ["1_2"]),
      outline("1_2", "1", ["1_1"], [], { ending }),
    ]);
    expect(issues.filter((m) => m.includes("标了结局"))).toEqual([]);
  });
});

describe("假分支：几条边指向同一个目标", () => {
  it("重复的出边报出来", () => {
    const issues = contractIssues([
      outline("1_1", "1", [], ["1_2", "1_2"]),
      outline("1_2", "1", ["1_1"], []),
    ]);
    expect(issues.some((m) => m.includes("假分支"))).toBe(true);
  });

  it("指向不同目标的分叉不报", () => {
    const issues = contractIssues(diamond("1", "1", [], []));
    expect(issues.filter((m) => m.includes("假分支"))).toEqual([]);
  });
});

describe("糖葫芦串是全树性质", () => {
  it("单个菱形不报——那是 converge 代价档的正常形态", () => {
    // `buildSkeleton` 的 shouldMerge 分支自己就生成这个形状。一处菱形报缺陷，
    // 等于把系统的标准骨架判成缺陷。
    expect(contractIssues(diamond("1", "1", [], [])).filter((m) => m.includes("糖葫芦"))).toEqual([]);
  });

  it("每处分叉都在一跳内合流就报——玩家的任何决定都被一跳抹平", () => {
    // 两个菱形串在一起：●-<>-●-<>-●，宽度恒为二、深度上毫无分歧。
    const issues = contractIssues([
      ...diamond("1", "1", [], ["2_1"]),
      ...diamond("2", "2", ["1_4"], []),
    ]);
    expect(issues.some((m) => m.includes("糖葫芦串"))).toBe(true);
  });

  it("只要有一处分支撑过两跳就不报", () => {
    // 第二处分叉的两支各走两个节点才汇回 —— 树里有了真正承载分歧的地方。
    const issues = contractIssues([
      ...diamond("1", "1", [], ["2_1"]),
      outline("2_1", "2", ["1_4"], ["2_2", "2_4"]),
      outline("2_2", "2", ["2_1"], ["2_3"]),
      outline("2_3", "2", ["2_2"], ["2_6"]),
      outline("2_4", "2", ["2_1"], ["2_5"]),
      outline("2_5", "2", ["2_4"], ["2_6"]),
      outline("2_6", "2", ["2_3", "2_5"], []),
    ]);
    expect(issues.filter((m) => m.includes("糖葫芦"))).toEqual([]);
  });

  it("直通结局的支不算一跳合流——那是 terminal 档，本就不该汇回", () => {
    const issues = contractIssues([
      ...diamond("1", "1", [], ["2_1"]),
      outline("2_1", "2", ["1_4"], ["2_2", "2_3"]),
      outline("2_2", "2", ["2_1"], []),
      outline("2_3", "2", ["2_1"], []),
    ]);
    expect(issues.filter((m) => m.includes("糖葫芦"))).toEqual([]);
  });
});

describe("契约问题记 error", () => {
  it("不与「可以这样也可以那样」的警告混在一起", () => {
    // 记成 warn 的后果是它淹在一堆风格提示里，而它恰恰是那个必须动手的。
    const report = buildStructureCheckReport({
      outlines_generated: { outlines: [outline("1_1", "1", [], ["1_2", "1_2"]), outline("1_2", "1", ["1_1"], [])] },
    } as unknown as NarrativeContext);
    const fake = report.findings.find((f) => f.issue.includes("假分支"))!;
    expect(fake.severity).toBe("error");
    expect(fake.repairKind).toBe("topology");
    expect(report.verdict).toBe("fail");
  });
});
