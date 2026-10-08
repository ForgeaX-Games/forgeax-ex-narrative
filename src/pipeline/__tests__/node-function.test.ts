/**
 * 剧情树原语的锁：五种功能位、边级条件、分支代价档、结局分档，以及三层职责不越界。
 *
 * 这里锁的是新架构的叙事内核——大纲定叙事单元、结构展开成剧情树、情节填节点内容，
 * 对所有品类同构；剧情树的形态差异由叙事策略的结构轴决定，而非由品类另开管线实现。
 *
 * 其中「条件挂在边上」「merge 边显式标聚合」「分支代价档」「结局分 local/global」
 * 四件形制是从归档影游实现迁进来的既有设计，非新造。本文件同时锁住迁移的正确性：
 * 归档产物与新产物必须走同一批规则。
 */
import { describe, expect, it } from "vitest";
import type { NodeEdge } from "../../types/index.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import { checkNodeFunctions, inferNodeFunction } from "../graph/node-function.js";
import { STORY_FRAMEWORK_PLAN_COMPOSER } from "../steps/story-framework.js";
import { OUTLINE_PLAN_COMPOSER } from "../steps/outline-batch.js";
import { PLOT_GENERATION_COMPOSER } from "../steps/plot-generation.js";

const choice = (to: string, label: string): NodeEdge => ({
  to,
  kind: "choose",
  label,
  condition: { type: "choice", description: `选了 ${label}`, cost: "损失一名同伴" },
});

describe("节点功能位推断", () => {
  it("五种功能位各按入出度落位", () => {
    expect(inferNodeFunction([], ["b"])).toBe("start");
    expect(inferNodeFunction(["a"], ["b", "c"])).toBe("branch");
    expect(inferNodeFunction(["a", "b"], ["c"])).toBe("merge");
    expect(inferNodeFunction(["a"], [])).toBe("ending");
    expect(inferNodeFunction(["a"], ["b"])).toBe("normal");
  });

  it("入口先被认出来：无前驱且多出边判 start，避免整棵树找不到起点", () => {
    expect(inferNodeFunction([], ["b", "c"])).toBe("start");
  });

  it("孤立节点判为结局——写了个到不了的结局比走不出的开头常见", () => {
    expect(inferNodeFunction([], [])).toBe("ending");
  });

  it("声明与拓扑不符时报分歧——通常是想做分支但连接没接上", () => {
    const issues = checkNodeFunctions([
      { id: "n1", prev: ["n0"], next: ["n2"], declared: "branch" },
    ]);
    const mismatch = issues.filter((i) => i.kind === "mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.message).toContain("出度 1");
  });
});

describe("边级条件（形制取自归档影游 VnNextEdge）", () => {
  it("分支的每条出边都要带条件，缺一条就点名指向谁", () => {
        const issues = checkNodeFunctions([
      {
        id: "n3",
        prev: ["n2"],
        next: ["n4", "n5"],
        branchType: "converge",
        edges: [choice("n4", "A"), { to: "n5", kind: "choose", label: "B" }],
      },
    ]);
    const missing = issues.filter((i) => i.kind === "missing_condition");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain("n5");
  });

  it("条件齐备就不报", () => {
    const issues = checkNodeFunctions([
      {
        id: "n3",
        prev: ["n2"],
        next: ["n4", "n5"],
        branchType: "diverge",
        edges: [choice("n4", "A"), choice("n5", "B")],
      },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("edges 与 next_node 指向不同批目标时报不一致——下游读哪个都不对", () => {
    const issues = checkNodeFunctions([
      { id: "n1", prev: ["n0"], next: ["n2"], edges: [{ to: "n9", kind: "continue" }] },
    ]);
    expect(issues.some((i) => i.kind === "edge_mismatch")).toBe(true);
  });

  it("聚合必须由上游的 merge 边显式标出，而非靠入度事后推断", () => {
    const withoutMerge = checkNodeFunctions([
      { id: "a", prev: [], next: ["m"], edges: [{ to: "m", kind: "continue" }] },
      { id: "b", prev: [], next: ["m"], edges: [{ to: "m", kind: "continue" }] },
      { id: "m", prev: ["a", "b"], next: ["z"], edges: [{ to: "z", kind: "continue" }] },
    ]);
    expect(withoutMerge.some((i) => i.nodeId === "m" && i.kind === "missing_condition")).toBe(true);

    const withMerge = checkNodeFunctions([
      { id: "a", prev: [], next: ["m"], edges: [{ to: "m", kind: "merge" }] },
      { id: "b", prev: [], next: ["m"], edges: [{ to: "m", kind: "continue" }] },
      { id: "m", prev: ["a", "b"], next: ["z"], edges: [{ to: "z", kind: "continue" }] },
    ]);
    expect(withMerge.some((i) => i.nodeId === "m")).toBe(false);
  });
});

describe("分支代价档与假分支（形制取自归档影游 branch_type）", () => {
  it("分支不给代价档要报：不写清后果量级就会铺出殊途同归的假分支", () => {
    const issues = checkNodeFunctions([
      {
        id: "n3",
        prev: ["n2"],
        next: ["n4", "n5"],
        edges: [choice("n4", "A"), choice("n5", "B")],
      },
    ]);
    expect(issues.some((i) => i.kind === "missing_branch_type")).toBe(true);
  });

  it("所有出边指向同一节点 = 假分支，选择没有产生差异", () => {
    const issues = checkNodeFunctions([
      {
        id: "n3",
        prev: ["n2"],
        next: ["n4", "n4"],
        branchType: "converge",
        edges: [choice("n4", "A"), choice("n4", "B")],
      },
    ]);
    expect(issues.some((i) => i.kind === "fake_branch")).toBe(true);
  });
});

describe("结局分档（形制取自归档影游 VnEnding）", () => {
  it("结局要给达成条件", () => {
    const without = checkNodeFunctions([{ id: "end1", prev: ["n9"], next: [] }]);
    expect(without.some((i) => i.kind === "missing_condition")).toBe(true);

    const withTrigger = checkNodeFunctions([
      { id: "end1", prev: ["n9"], next: [], endingTrigger: "在终局抉择中选择留下" },
    ]);
    expect(withTrigger).toHaveLength(0);
  });
});

describe("三层职责在提示词里各守其位", () => {
  const cot = (c: PromptComposer): string => {
    const block = c.blocks.cot;
    return typeof block === "string" ? block : "";
  };

  it("大纲席定叙事单元，不再讲幕", () => {
    const text = cot(STORY_FRAMEWORK_PLAN_COMPOSER);
    expect(text).toContain("叙事单元");
    expect(text).toContain("单元之间的联系");
    // 允许出现"不是幕"这类否定式说明，但不允许把幕当作要产出的东西
    expect(text).not.toMatch(/划分幕结构|每一幕/);
  });

  it("结构席给出五种功能位与条件要求", () => {
    const text = cot(OUTLINE_PLAN_COMPOSER);
    for (const kw of ["起始", "分支", "聚合", "结局", "普通"]) {
      expect(text, `结构席未交代「${kw}」节点`).toContain(kw);
    }
    expect(text).toContain("必须给出条件");
    // 形态服从策略卡，而非按品类硬编码
    expect(text).toContain("结构轴策略卡");
  });

  it("情节席落到剧本形态：情节描写 + 对话", () => {
    const text = cot(PLOT_GENERATION_COMPOSER);
    expect(text).toContain("情节描写");
    expect(text).toContain("对话");
    // 且不越界去改结构
    expect(text).toContain("不可改动的骨架");
  });
});
