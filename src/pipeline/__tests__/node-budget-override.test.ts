import { describe, it, expect } from "vitest";
import { resolveL0Budget, getNodeBudget } from "../runtime/layer-threshold-config.js";
import { normalizePreferenceAnalysis } from "../steps/user-preference-analysis.js";
import type { NarrativeContext, PreferenceAnalysis } from "../../types/index.js";

/**
 * 节点预算覆盖与叙事结构是两件事。
 *
 * 「每层开几个节点」由体量给基线、由用户明说的精确数字覆盖；
 * 「在哪分叉、分了收不收、几个结局」由 narrative_axes.structure 的 topology 决定。
 * 从前这两件事都叫 structure，于是 L0 层还冒出第三套五值形态枚举
 * （linear/dual_climax/multi_thread/nested/spiral）只活在提示词里、无人读写。
 */

const ctxWith = (gcp: Partial<NarrativeContext["global_control_params"]>): NarrativeContext =>
  ({ global_control_params: { complexity: 3, deviation: 0, ...gcp } }) as NarrativeContext;

describe("L0 预算：体量给基线，用户明说的章节数覆盖", () => {
  it("没有覆盖时上限来自体量档位", () => {
    const b = resolveL0Budget(ctxWith({}));
    expect(b.fromOverride).toBe(false);
    expect(b.totalMax).toBe(getNodeBudget(3).l0_max);
  });

  it("用户说几章就是几章主干，不被体量压回", () => {
    const b = resolveL0Budget(ctxWith({ node_budget_override: { l0_nodes: 12, l1_per_parent: 2, l2_per_parent: 2 } }));
    expect(b.fromOverride).toBe(true);
    expect(b.trunkMax).toBe(12);
  });

  // 「5 个章节」说的是主干。把它当成总量上限，故事一旦分叉主干就被截回 3 章，
  // 用户看到的是「我要 5 章，它给了 3 章」。
  it("分支与结局节点在用户指定的章节数之外", () => {
    const override = { l0_nodes: 5, l1_per_parent: 2, l2_per_parent: 2 };
    const withoutBranches = resolveL0Budget(ctxWith({ node_budget_override: override }), 0);
    const withBranches = resolveL0Budget(ctxWith({ node_budget_override: override }), 4);
    expect(withoutBranches.trunkMax).toBe(5);
    expect(withBranches.trunkMax).toBe(5);
    expect(withBranches.totalMax).toBe(9);
  });

  it("没有覆盖时分支节点从体量总量里让出来，主干相应收窄", () => {
    const l0Max = getNodeBudget(3).l0_max;
    const b = resolveL0Budget(ctxWith({}), 3);
    expect(b.totalMax).toBe(l0Max);
    expect(b.trunkMax).toBe(l0Max - 3);
  });

  it("体量缺省时不崩，走默认档位", () => {
    const b = resolveL0Budget({} as NarrativeContext);
    expect(b.totalMax).toBeGreaterThan(0);
    expect(b.fromOverride).toBe(false);
  });
});

describe("偏好分析写回的节点预算覆盖", () => {
  const analysisWith = (nodeBudget: unknown): PreferenceAnalysis =>
    ({ 全局控制参数: { complexity: 3, node_budget_override: nodeBudget } }) as unknown as PreferenceAnalysis;

  const normalizedBudget = (nodeBudget: unknown) => {
    const ctx = { complexity: 3 } as NarrativeContext;
    normalizePreferenceAnalysis(analysisWith(nodeBudget), ctx);
    return ctx.global_control_params?.node_budget_override ?? null;
  };

  it("三个字段齐全且合理时原样采纳 —— 用户说 20 章就是 20 章", () => {
    expect(normalizedBudget({ l0_nodes: 20, l1_per_parent: 3, l2_per_parent: 3 })).toEqual({
      l0_nodes: 20,
      l1_per_parent: 3,
      l2_per_parent: 3,
    });
  });

  it("没给覆盖时落为 null，节点数交给体量", () => {
    expect(normalizedBudget(undefined)).toBeNull();
  });

  // 半个覆盖比没有覆盖更难排查：缺一个字段就整体作废，退回体量预算。
  it("字段不全时整个覆盖作废", () => {
    expect(normalizedBudget({ l0_nodes: 5, l1_per_parent: 2 })).toBeNull();
  });

  it("挡住物理上不成立的读数，但不按体量档位夹", () => {
    expect(normalizedBudget({ l0_nodes: 0, l1_per_parent: 2, l2_per_parent: 2 })).toBeNull();
    expect(normalizedBudget({ l0_nodes: 999, l1_per_parent: 2, l2_per_parent: 2 })).toBeNull();
    expect(normalizedBudget({ l0_nodes: -3, l1_per_parent: 2, l2_per_parent: 2 })).toBeNull();
    expect(normalizedBudget({ l0_nodes: "五章", l1_per_parent: 2, l2_per_parent: 2 })).toBeNull();
  });

  it("小数读数取整而不是整体作废", () => {
    expect(normalizedBudget({ l0_nodes: 5.4, l1_per_parent: 2, l2_per_parent: 2 })?.l0_nodes).toBe(5);
  });
});
