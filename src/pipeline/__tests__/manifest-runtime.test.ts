/**
 * M7 — RunManifest 作为运行时事实源。
 *
 * 一期这条路径零测试覆盖：resume 靠 `resumeAfterStep` 一路线性 skip，
 * `lifecycleFromCompletedSteps` / `shouldSkipByLifecycle` 写好却从未被调用。
 */
import { describe, it, expect } from "vitest";
import {
  checkpointAgentsFrom,
  completedStepsFromAgents,
  lifecycleFromCheckpoint,
  lifecycleMapOf,
  manifestFromStepIds,
  markAgentLifecycle,
  shouldSkipAgent,
  syncManifestAgents,
  type CheckpointAgentSlot,
} from "../runtime/run-manifest-runtime.js";

const ORDER = ["preference_summary", "preference_analysis", "initial_plan", "worldview"];

describe("M7 checkpoint lifecycle 桥接", () => {
  it("新格式直接读 agents[].lifecycle", () => {
    const agents: CheckpointAgentSlot[] = [
      { agentId: "a", index: 0, lifecycle: { status: "completed" } },
      { agentId: "b", index: 1, lifecycle: { status: "failed", error: "boom" } },
      { agentId: "c", index: 2, lifecycle: { status: "pending" } },
    ];
    expect(lifecycleFromCheckpoint({ agents })).toEqual({
      a: "completed",
      b: "failed",
      c: "pending",
    });
  });

  it("旧格式（无 agents）用 completedSteps + lastCompletedStep 桥接", () => {
    const lifecycle = lifecycleFromCheckpoint({
      pipelineOrder: ORDER,
      completedSteps: ["preference_summary", "initial_plan"],
      lastCompletedStep: "initial_plan",
    });
    expect(lifecycle).toEqual({
      preference_summary: "completed",
      // 跳过区间内未记录 → skipped（一期线性恢复的等价语义）
      preference_analysis: "skipped",
      initial_plan: "completed",
      worldview: "pending",
    });
  });

  it("旧格式缺 pipelineOrder 时退化用 completedSteps 顺序，不抛错", () => {
    const lifecycle = lifecycleFromCheckpoint({
      completedSteps: ["a", "b"],
      lastCompletedStep: "b",
    });
    expect(lifecycle).toEqual({ a: "completed", b: "completed" });
  });
});

describe("M7 completedSteps 降级为派生视图", () => {
  it("checkpointAgentsFrom 按权威步骤序建表，派生集合与已完成集合一致", () => {
    const done = ["initial_plan", "preference_summary"];
    const agents = checkpointAgentsFrom(ORDER, done);
    expect(agents.map((a) => a.agentId)).toEqual(ORDER);
    // 派生视图按管线序输出，而非 progress 到达序。
    expect(completedStepsFromAgents(agents)).toEqual([
      "preference_summary",
      "initial_plan",
    ]);
    expect(new Set(completedStepsFromAgents(agents))).toEqual(new Set(done));
  });

  it("步骤序缺失的已完成步补到尾部，不丢数据", () => {
    const agents = checkpointAgentsFrom(["a"], ["a", "dynamic_step"]);
    expect(completedStepsFromAgents(agents)).toEqual(["a", "dynamic_step"]);
  });

  it("跨次保存保留已完成步的时间戳", () => {
    const first = checkpointAgentsFrom(ORDER, ["preference_summary"]);
    const stamp = first[0]!.lifecycle.updatedAt;
    const second = checkpointAgentsFrom(ORDER, ["preference_summary", "preference_analysis"], first);
    expect(second[0]!.lifecycle.updatedAt).toBe(stamp);
    expect(second[1]!.lifecycle.status).toBe("completed");
  });
});

describe("M7 逐 agent 跳过（解锁非线性能力）", () => {
  it("跳过非连续的已完成步 —— 一期线性恢复会重跑它", () => {
    const lifecycle = lifecycleFromCheckpoint({
      pipelineOrder: ["a", "b", "c", "d"],
      // b 之后 d 也完成了（并行组：d 先完成、c 失败）
      completedSteps: ["a", "b", "d"],
      lastCompletedStep: "b",
    });
    expect(shouldSkipAgent(lifecycle, "a")).toBe(true);
    expect(shouldSkipAgent(lifecycle, "c")).toBe(false);
    expect(shouldSkipAgent(lifecycle, "d")).toBe(true);
  });

  it("只重跑失败步，已完成的前序不重跑", () => {
    const lifecycle = lifecycleFromCheckpoint({
      agents: [
        { agentId: "a", index: 0, lifecycle: { status: "completed" } },
        { agentId: "b", index: 1, lifecycle: { status: "failed" } },
        { agentId: "c", index: 2, lifecycle: { status: "pending" } },
      ],
    });
    expect(shouldSkipAgent(lifecycle, "a")).toBe(true);
    expect(shouldSkipAgent(lifecycle, "b")).toBe(false);
    expect(shouldSkipAgent(lifecycle, "c")).toBe(false);
  });

  it("未登记的 agent（动态追加步）一律执行", () => {
    expect(shouldSkipAgent({ a: "completed" }, "late_step")).toBe(false);
    expect(shouldSkipAgent(undefined, "anything")).toBe(false);
  });
});

describe("M7 运行时 manifest 建表与跃迁", () => {
  it("由权威步骤序建表，agents 有序且默认 pending", () => {
    const m = manifestFromStepIds({
      entryKey: "entry-x",
      runId: "run_1",
      stepIds: ORDER,
      config: { tier: "tier1", genreCode: "rpg-jrpg", pipelineTemplate: "tpl-jrpg" },
    });
    expect(m.status).toBe("running");
    expect(m.runId).toBe("run_1");
    expect(m.promptLibrary).toBe("v1");
    expect(m.agents.map((a) => a.agentId)).toEqual(ORDER);
    expect(m.agents.every((a) => a.lifecycle.status === "pending")).toBe(true);
    // slot 形状与 /plan 预览一致（名称已解析，非裸 id）。
    expect(m.agents[0]!.name).not.toBe("");
  });

  it("markAgentLifecycle 跃迁并追加未登记的动态步", () => {
    const m = manifestFromStepIds({
      entryKey: "e",
      stepIds: ["a", "b"],
      config: {},
    });
    markAgentLifecycle(m, "a", "completed");
    markAgentLifecycle(m, "late", "running");
    expect(lifecycleMapOf(m.agents)).toEqual({ a: "completed", b: "pending", late: "running" });
    expect(m.agents.at(-1)!.agentId).toBe("late");
  });

  it("二次 announce 扩表时保留既有 lifecycle", () => {
    const m = manifestFromStepIds({ entryKey: "e", stepIds: ["a", "b"], config: {} });
    markAgentLifecycle(m, "a", "completed");
    syncManifestAgents(m, ["a", "b", "c", "d"]);
    expect(m.agents.map((s) => s.agentId)).toEqual(["a", "b", "c", "d"]);
    expect(lifecycleMapOf(m.agents)).toEqual({
      a: "completed",
      b: "pending",
      c: "pending",
      d: "pending",
    });
    expect(m.agents.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it("二次 announce 裁掉的步若已有跃迁则保留在表尾", () => {
    const m = manifestFromStepIds({ entryKey: "e", stepIds: ["a", "dropped"], config: {} });
    markAgentLifecycle(m, "dropped", "completed");
    syncManifestAgents(m, ["a", "b"]);
    expect(m.agents.map((s) => s.agentId)).toEqual(["a", "b", "dropped"]);
    expect(lifecycleMapOf(m.agents).dropped).toBe("completed");
  });
});
