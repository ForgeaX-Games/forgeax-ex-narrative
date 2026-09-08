import { describe, it, expect } from "vitest";
import {
  compositionLockReason,
  computePhase,
  isCompositionEditable,
  type PhaseInput,
} from "../viz/src/store/phase.js";

/**
 * §状态机重构：顶层 phase 派生（SSOT）的纯函数单测。逐条对齐产品 2.1–2.7 的交互契约，
 * 作为「取消生成 / 开始生成」按钮亮灭与 header 状态灯的唯一权威依据。
 *
 * 放在 plugin 根 tests/（既不在 backend rootDir=src，也不在 viz/src tsc include 内），
 * 仅由 plugin 根的 vitest 项目扫描拾取，避免两处 tsc 构建把跨包/vitest 依赖拉进来。
 */

const base: PhaseInput = {
  runningRunId: null,
  ipDnaGenerating: false,
  activeEntryStatus: null,
  activeEntryKey: null,
  inputConfirmed: false,
  routingConfigured: false,
  runningProgress: [],
  pendingFork: false,
  pendingForkKind: null,
};

describe("computePhase — 顶层交互状态机 SSOT", () => {
  it("2.1 未开始：无输入/无条目/无预处理 → idle（两键皆灰）", () => {
    expect(computePhase({ ...base })).toBe("idle");
  });

  it("2.2 已确认输入但未选路由 → input（两键仍皆灰）", () => {
    expect(computePhase({ ...base, inputConfirmed: true })).toBe("input");
    expect(computePhase({ ...base, activeEntryKey: "2026-07-02_10-00-00-000" })).toBe("input");
    expect(computePhase({ ...base, runningProgress: [{ id: "ip_input" }] })).toBe("input");
  });

  it("2.3 选定路由 → routed（开始生成亮、取消灰）", () => {
    expect(computePhase({ ...base, inputConfirmed: true, routingConfigured: true })).toBe("routed");
  });

  it("2.4 点击开始生成后 SSE run 运行 → generating（取消亮、开始灰）", () => {
    expect(
      computePhase({ ...base, inputConfirmed: true, routingConfigured: true, runningRunId: "run_1" }),
    ).toBe("generating");
  });

  it("2.4 IP DNA 下游 job 运行（无 SSE runId）→ generating", () => {
    expect(
      computePhase({ ...base, inputConfirmed: true, routingConfigured: true, ipDnaGenerating: true }),
    ).toBe("generating");
  });

  it("generating 优先级最高：即便 status=completed，只要仍在跑仍为 generating", () => {
    expect(computePhase({ ...base, activeEntryStatus: "completed", runningRunId: "run_1" })).toBe("generating");
  });

  it("2.7 生成完成 → done", () => {
    expect(computePhase({ ...base, inputConfirmed: true, activeEntryStatus: "completed" })).toBe("done");
  });

  it("分叉泛化：completed 且未改配置 → done（两键灰）", () => {
    expect(computePhase({ ...base, activeEntryStatus: "completed", pendingFork: false })).toBe("done");
  });

  it("分叉泛化：completed + 改 ROUTING(pendingFork routing) → routed（点亮开始生成；预览仍锚旧条目）", () => {
    expect(
      computePhase({ ...base, activeEntryStatus: "completed", activeEntryKey: "old-done-key", pendingFork: true, pendingForkKind: "routing" }),
    ).toBe("routed");
  });

  it("分叉泛化：completed + 改 INPUT(pendingFork input) → 仍 done（由 INPUT 区「确认」承接，不点亮底部开始生成）", () => {
    expect(
      computePhase({ ...base, activeEntryStatus: "completed", activeEntryKey: "old-done-key", pendingFork: true, pendingForkKind: "input" }),
    ).toBe("done");
  });

  it("分叉泛化：中断态 + 改 ROUTING → routed（fork 新条目，压过 resume；预览仍锚旧条目）", () => {
    expect(
      computePhase({ ...base, activeEntryStatus: "interrupted", activeEntryKey: "old-intr-key", pendingFork: true, pendingForkKind: "routing" }),
    ).toBe("routed");
  });

  it("分叉泛化：config 态(status=null) + 改 ROUTING → routed（点亮开始生成投产/或 fork）", () => {
    expect(
      computePhase({ ...base, inputConfirmed: true, activeEntryKey: "cfg-key", pendingFork: true, pendingForkKind: "routing" }),
    ).toBe("routed");
  });

  it("分叉优先级：即便 pendingFork routing，正在跑仍是 generating（不会误点亮开始生成）", () => {
    expect(
      computePhase({ ...base, activeEntryStatus: "completed", pendingFork: true, pendingForkKind: "routing", runningRunId: "run_x" }),
    ).toBe("generating");
  });

  it("2.6 被动中断后回落：routingConfigured 时 → routed（开始生成重新点亮）", () => {
    expect(
      computePhase({ ...base, inputConfirmed: true, routingConfigured: true, activeEntryStatus: "interrupted" }),
    ).toBe("routed");
  });

  it("中断但未配路由 → input（开始生成仍灰，需先选路由）", () => {
    expect(
      computePhase({ ...base, inputConfirmed: true, routingConfigured: false, activeEntryStatus: "interrupted" }),
    ).toBe("input");
  });

  it("useAutoAttach 门禁语义：IP 预处理期（有 ip_* 前驱步、无 runId）phase 恒非 generating", () => {
    const phase = computePhase({
      ...base,
      inputConfirmed: true,
      runningProgress: [{ id: "ip_input" }, { id: "ip_standardize" }],
    });
    expect(phase).not.toBe("generating");
    expect(["input", "routed"]).toContain(phase);
  });
});

/**
 * 生产前后的编排闸门。
 *
 * 这一节存在的理由是它此前只以「App.tsx 不挂载 ComposerView」的形式存在 ——
 * 那种闸门测不到，也没法让调色板读同一个判据，于是调色板在锁定期仍可起拖、
 * 拖出去无声无息。现在判据是纯函数，画布挂载与调色板可拖都读它。
 */
describe("isCompositionEditable — 编排闸门", () => {
  it("只有未开始（idle）能改编排", () => {
    expect(isCompositionEditable("idle")).toBe(true);
  });

  it("确认输入之后就锁：图已随条目落盘，再动就说不清跑的是哪份", () => {
    expect(isCompositionEditable("input")).toBe(false);
    expect(isCompositionEditable("routed")).toBe(false);
  });

  it("生成中与已完成都锁", () => {
    expect(isCompositionEditable("generating")).toBe(false);
    expect(isCompositionEditable("done")).toBe(false);
  });

  it("每个锁定态都得说得出为什么——键无声不响应是最难自查的一种", () => {
    expect(compositionLockReason("idle")).toBeNull();
    for (const p of ["input", "routed", "generating", "done"] as const) {
      expect(compositionLockReason(p)).toMatch(/^composer\.locked\./);
    }
  });
});
