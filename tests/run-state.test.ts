import { describe, it, expect } from "vitest";
import {
  RUN_STATE_LABEL,
  resolveRunState,
  runControls,
  type RunStateInput,
} from "../viz/src/store/runState.js";

/**
 * 运行状态机（契约 docs/contracts.md §2.2 那张两键亮灭表）。
 *
 * 这份测试守两件事：
 *  1. `paused` 与 `interrupted` 必须分开 —— 分野是有没有断点。混成一个，界面就会对
 *     "第一步就挂了"的条目给出「断点续传」，而那个请求注定 404。
 *  2. 两个键出自同一次派生，不会同时亮，也不会同时灭在该有动作的时候。
 */

const base: RunStateInput = {
  activeEntryStatus: null,
  activeCanResume: false,
  generating: false,
  hasDrafts: false,
  pendingFork: false,
};

describe("resolveRunState — 六态里的当前那一态", () => {
  it("① 待生成：没跑过", () => {
    expect(resolveRunState(base)).toBe("pending");
  });

  it("② 生成中：运行信号先于落盘态（SSE 起来那一瞬条目态还没翻）", () => {
    expect(resolveRunState({ ...base, generating: true })).toBe("running");
    expect(resolveRunState({ ...base, activeEntryStatus: "running" })).toBe("running");
    // 正在跑压过一切，包括草稿与分叉待决。
    expect(
      resolveRunState({ ...base, generating: true, hasDrafts: true, pendingFork: true }),
    ).toBe("running");
  });

  it("③ 已中断 + 有断点 = paused（界面上说的暂停）", () => {
    expect(
      resolveRunState({ ...base, activeEntryStatus: "interrupted", activeCanResume: true }),
    ).toBe("paused");
  });

  it("③' 已中断 + 无断点 = interrupted（只能重开）", () => {
    expect(
      resolveRunState({ ...base, activeEntryStatus: "interrupted", activeCanResume: false }),
    ).toBe("interrupted");
  });

  it("④ 已完成", () => {
    expect(resolveRunState({ ...base, activeEntryStatus: "completed" })).toBe("completed");
  });

  it("paused 不是落盘态：它只由 (interrupted, canResume) 这一对算出来", () => {
    // 同一个落盘状态，断点有无决定两种说法——这正是"不新增第五个持久态"的代价与收益。
    const withCk = { ...base, activeEntryStatus: "interrupted" as const, activeCanResume: true };
    expect(resolveRunState(withCk)).toBe("paused");
    expect(resolveRunState({ ...withCk, activeCanResume: false })).toBe("interrupted");
  });
});

describe("runControls — 两键亮灭（契约 §2.2）", () => {
  it("待生成：取消灰、主键开始", () => {
    expect(runControls(base)).toEqual({ state: "pending", cancelEnabled: false, primary: "start" });
  });

  it("生成中：取消亮、主键灭", () => {
    expect(runControls({ ...base, generating: true })).toEqual({
      state: "running",
      cancelEnabled: true,
      primary: "none",
    });
  });

  it("已暂停：取消灰、主键续跑", () => {
    expect(
      runControls({ ...base, activeEntryStatus: "interrupted", activeCanResume: true }),
    ).toEqual({ state: "paused", cancelEnabled: false, primary: "resume" });
  });

  it("已中断无断点：主键是开始（不给注定 404 的续跑键）", () => {
    expect(runControls({ ...base, activeEntryStatus: "interrupted" })).toEqual({
      state: "interrupted",
      cancelEnabled: false,
      primary: "start",
    });
  });

  it("已完成且没改过：两键皆灰", () => {
    expect(runControls({ ...base, activeEntryStatus: "completed" })).toEqual({
      state: "completed",
      cancelEnabled: false,
      primary: "none",
    });
  });

  it("已完成 + 有编辑草稿：主键变重新生成（⑥ 影响面重生成）", () => {
    expect(
      runControls({ ...base, activeEntryStatus: "completed", hasDrafts: true }).primary,
    ).toBe("regen");
  });

  it("草稿压过续跑：改过正文就不该接着旧断点往下写", () => {
    expect(
      runControls({
        ...base,
        activeEntryStatus: "interrupted",
        activeCanResume: true,
        hasDrafts: true,
      }).primary,
    ).toBe("regen");
  });

  it("分叉待决压过续跑与两键皆灰：改了需求要照新需求跑一条新的", () => {
    expect(
      runControls({
        ...base,
        activeEntryStatus: "interrupted",
        activeCanResume: true,
        pendingFork: true,
      }).primary,
    ).toBe("start");
    expect(
      runControls({ ...base, activeEntryStatus: "completed", pendingFork: true }).primary,
    ).toBe("start");
  });

  it("两键不会同时亮：只有生成中亮取消，而那时主键必灭", () => {
    const cases: RunStateInput[] = [
      base,
      { ...base, generating: true },
      { ...base, activeEntryStatus: "running" },
      { ...base, activeEntryStatus: "interrupted", activeCanResume: true },
      { ...base, activeEntryStatus: "interrupted" },
      { ...base, activeEntryStatus: "completed" },
      { ...base, activeEntryStatus: "completed", hasDrafts: true },
      { ...base, pendingFork: true },
    ];
    for (const c of cases) {
      const { cancelEnabled, primary } = runControls(c);
      expect(cancelEnabled ? primary === "none" : true).toBe(true);
    }
  });

  it("每一态都有文案键，界面不会漏出裸状态名", () => {
    for (const state of ["pending", "running", "paused", "interrupted", "completed"] as const) {
      expect(RUN_STATE_LABEL[state]).toMatch(/^run\.state\./);
    }
  });
});
