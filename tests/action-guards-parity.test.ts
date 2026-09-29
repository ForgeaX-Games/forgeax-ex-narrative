import { describe, it, expect } from "vitest";
import { runControls, isEntryConfigEditable, type RunStateInput } from "../viz/src/store/runState.js";
import {
  pipelineGuards,
  entryGuards,
  stepGuards,
  findingGuards,
  type PipelineGuardInput,
} from "../src/pipeline/core/action-guards.js";

/**
 * 契约测试：画布 `runControls()` 与后端 `pipelineGuards()` 必须同构（键权层方案 M1）。
 *
 * 两边不是同一份代码——画布要同步渲染，不能等一次网络往返，本地纯函数派生仍然是对的；
 * 但两边算法必须一致，否则 chat 读后端计算出的 controls、画布读本地计算出的 controls，
 * 会在同一条目上说出两套不同的"能不能做"。这份测试把两边的输入映射到同一组语义，
 * 跑同一批用例，断言输出逐字段相等，锁住"两边不会漂"这件事。
 */

function toBackendInput(s: RunStateInput): PipelineGuardInput {
  return {
    entryStatus: s.activeEntryStatus,
    canResume: s.activeCanResume,
    generating: s.generating,
    hasDrafts: s.hasDrafts,
    pendingFork: s.pendingFork,
  };
}

const base: RunStateInput = {
  activeEntryStatus: null,
  activeCanResume: false,
  generating: false,
  hasDrafts: false,
  pendingFork: false,
};

const cases: RunStateInput[] = [
  base,
  { ...base, generating: true },
  { ...base, generating: true, hasDrafts: true, pendingFork: true },
  { ...base, activeEntryStatus: "running" },
  { ...base, activeEntryStatus: "interrupted", activeCanResume: true },
  { ...base, activeEntryStatus: "interrupted", activeCanResume: false },
  { ...base, activeEntryStatus: "completed" },
  { ...base, activeEntryStatus: "completed", hasDrafts: true },
  { ...base, activeEntryStatus: "interrupted", activeCanResume: true, hasDrafts: true },
  { ...base, activeEntryStatus: "interrupted", activeCanResume: true, pendingFork: true },
  { ...base, activeEntryStatus: "completed", pendingFork: true },
];

describe("键权层 M1 — pipelineGuards() 与画布 runControls() 同构", () => {
  for (const [i, c] of cases.entries()) {
    it(`用例 #${i}: ${JSON.stringify(c)}`, () => {
      const front = runControls(c);
      const back = pipelineGuards(toBackendInput(c));
      expect(back.state).toBe(front.state);
      expect(back.cancelEnabled).toBe(front.cancelEnabled);
      expect(back.primary).toBe(front.primary);
    });
  }

  it("canResume 与 canRegenerate 是 state 的衍生，不是独立输入", () => {
    expect(pipelineGuards(toBackendInput({ ...base, activeEntryStatus: "interrupted", activeCanResume: true })).canResume).toBe(true);
    expect(pipelineGuards(toBackendInput({ ...base, activeEntryStatus: "interrupted", activeCanResume: false })).canResume).toBe(false);
    expect(pipelineGuards(toBackendInput({ ...base, generating: true })).canRegenerate).toBe(false);
    expect(pipelineGuards(toBackendInput({ ...base, activeEntryStatus: "completed" })).canRegenerate).toBe(true);
  });
});

describe("键权层 M1 — entryGuards()", () => {
  it("生成中不可编辑、不可开新跑/新泳道", () => {
    const g = entryGuards({ entryStatus: "running", hasConflictingRun: true });
    expect(g.canEdit).toBe(false);
    expect(g.canStart).toBe(false);
    expect(g.canCreateLane).toBe(false);
  });

  it("完成/中断且无冲突跑：可编辑、可开新跑", () => {
    for (const entryStatus of ["completed", "interrupted"] as const) {
      const g = entryGuards({ entryStatus, hasConflictingRun: false });
      expect(g.canEdit).toBe(true);
      expect(g.canStart).toBe(true);
      expect(g.canCreateLane).toBe(true);
    }
  });

  it("没跑过（entryStatus=null）不可编辑，但可以开始", () => {
    const g = entryGuards({ entryStatus: null, hasConflictingRun: false });
    expect(g.canEdit).toBe(false);
    expect(g.canStart).toBe(true);
  });

  it("有冲突跑（跨条目全局锁）时不可开新跑，但已完成条目仍可编辑", () => {
    const g = entryGuards({ entryStatus: "completed", hasConflictingRun: true });
    expect(g.canEdit).toBe(true);
    expect(g.canStart).toBe(false);
    expect(g.canCreateLane).toBe(false);
  });

  // 画布侧的 `isEntryConfigEditable()` 决定 @ 入口带不带当前条目键：不可改配置时
  // 不带，退回"另起一个任务"。它与 canEdit 是同一条判据，抄两遍就会漂。
  it("画布 isEntryConfigEditable() 与后端 canEdit 同构", () => {
    for (const entryStatus of ["running", "completed", "interrupted", null] as const) {
      expect(isEntryConfigEditable(entryStatus)).toBe(
        entryGuards({ entryStatus, hasConflictingRun: false }).canEdit,
      );
    }
  });
});

describe("键权层 M1 — stepGuards()", () => {
  it("条目生成中：即使该步已完成也不可编辑/重roll", () => {
    const g = stepGuards({ entryStatus: "running", stepStatus: "completed", hasDraft: false });
    expect(g.canEdit).toBe(false);
    expect(g.canReroll).toBe(false);
  });

  it("条目可编辑 + 该步已完成：可编辑、可单节点重roll", () => {
    const g = stepGuards({ entryStatus: "completed", stepStatus: "completed", hasDraft: false });
    expect(g.canEdit).toBe(true);
    expect(g.canReroll).toBe(true);
  });

  it("该步还没跑到：不可编辑/重roll", () => {
    const g = stepGuards({ entryStatus: "completed", stepStatus: "pending", hasDraft: false });
    expect(g.canEdit).toBe(false);
    expect(g.canReroll).toBe(false);
  });

  it("影响面重生成需要有草稿", () => {
    expect(
      stepGuards({ entryStatus: "completed", stepStatus: "completed", hasDraft: true }).canImpactRegenerate,
    ).toBe(true);
    expect(
      stepGuards({ entryStatus: "completed", stepStatus: "completed", hasDraft: false }).canImpactRegenerate,
    ).toBe(false);
  });
});

describe("键权层 M1 — findingGuards()", () => {
  it("open + 有 repairKind：三键全亮", () => {
    const g = findingGuards({ status: "open", repairKind: "topology" });
    expect(g.canSelect).toBe(true);
    expect(g.canApplyFix).toBe(true);
    expect(g.canDismiss).toBe(true);
  });

  it("open 但只报不修（无 repairKind）：能选、能忽略，不能修", () => {
    const g = findingGuards({ status: "open" });
    expect(g.canSelect).toBe(true);
    expect(g.canApplyFix).toBe(false);
    expect(g.canDismiss).toBe(true);
  });

  it("已 fixed / 已 dismissed：三键全灭", () => {
    for (const status of ["fixed", "dismissed"] as const) {
      const g = findingGuards({ status, repairKind: "content" });
      expect(g.canSelect).toBe(false);
      expect(g.canApplyFix).toBe(false);
      expect(g.canDismiss).toBe(false);
    }
  });

  it("缺省 status 视为 open（旧报告没有这个字段）", () => {
    const g = findingGuards({ repairKind: "content" });
    expect(g.canApplyFix).toBe(true);
  });
});
