/**
 * G2 数据连续性断言："单品 → 管线"。
 *
 * 场景：条目已经跑过管线的前半段（demand_analysis 已完成，落在 `_checkpoint.json`），
 * 此时作者在画布上单独重跑 design_doc 这一席，希望：
 *   ① 单席跑天然吃到 demand_analysis 的产出（不用手工拼 ctx）；
 *   ② 单席跑完把 design_doc 并入同一份 checkpoint，而不是另起炉灶或把
 *      demand_analysis 的完成记录冲掉——否则后续管线续跑会把 demand_analysis 重跑一遍。
 *
 * 这两条分别对应 resolveAgentEntryBinding（起点续接）与
 * persistAgentStepCompletion（终点并入）两个函数，是 launchAgentRun /
 * persistSyncAgentRun 共用的落盘骨架。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistAgentStepCompletion, resolveAgentEntryBinding } from "../server.js";
import type { NarrativeContext } from "../../types/index.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "g2-persist-test-entry";
const ENTRY_DIR = path.join(OUTPUT_DIR, ENTRY_KEY);

function seedExistingEntry(): void {
  fs.mkdirSync(ENTRY_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ENTRY_DIR, "_entry.json"),
    JSON.stringify({ key: ENTRY_KEY, userInput: "写一个赛博朋克故事", tier: "tier2", mode: "design_semi" }),
  );
  fs.writeFileSync(
    path.join(ENTRY_DIR, "_checkpoint.json"),
    JSON.stringify({
      runId: "prior-run",
      tier: "tier2",
      mode: "design_semi",
      startedAt: new Date().toISOString(),
      lastCompletedStep: "demand_analysis",
      completedSteps: ["demand_analysis"],
      savedAt: new Date().toISOString(),
      ctx: {
        user_input: "写一个赛博朋克故事",
        demand_analysis: { genre_code: "cyberpunk", summary: "既有需求分析产出" },
      },
      userInput: "写一个赛博朋克故事",
      genre_code: "cyberpunk",
      pipelineOrder: ["demand_analysis", "design_doc"],
    }),
  );
}

afterEach(() => {
  fs.rmSync(ENTRY_DIR, { recursive: true, force: true });
});

describe("G2：单席跑绑定既有条目（resolveAgentEntryBinding）", () => {
  it("续接起点：seededCtx 带上已完成步的产出，调用方字段可覆盖", () => {
    seedExistingEntry();
    const callerCtx = { extra_note: "作者补充" } as unknown as NarrativeContext;
    const binding = resolveAgentEntryBinding(ENTRY_KEY, callerCtx);

    expect((binding.seededCtx as Record<string, unknown>).demand_analysis).toEqual({
      genre_code: "cyberpunk",
      summary: "既有需求分析产出",
    });
    expect((binding.seededCtx as Record<string, unknown>).extra_note).toBe("作者补充");
    expect(binding.tier).toBe("tier2");
    expect(binding.mode).toBe("design_semi");
    expect(binding.genreCode).toBe("cyberpunk");
    expect(binding.pipelineSteps).toEqual(["demand_analysis", "design_doc"]);
    expect(binding.outputDir).toBe(ENTRY_DIR);
    // 已完成步合成为 progress 帧，供 saveCheckpoint 续接 completedSteps。
    expect(binding.seededProgress.map((p) => p.stepId)).toEqual(["demand_analysis"]);
  });

  it("条目不存在时优雅退化：不抛异常，返回空的续接起点", () => {
    const binding = resolveAgentEntryBinding("g2-persist-test-missing", {} as NarrativeContext);
    expect(binding.seededProgress).toEqual([]);
    expect(binding.tier).toBeUndefined();
    expect(binding.pipelineSteps).toBeUndefined();
  });
});

describe("G2：单席跑并入落盘（persistAgentStepCompletion）", () => {
  it("完成态并入同一份 checkpoint：旧步不丢、新步并入，而不是互相覆盖", () => {
    seedExistingEntry();
    const binding = resolveAgentEntryBinding(ENTRY_KEY, {} as NarrativeContext);

    const mergedCtx = {
      ...(binding.seededCtx as Record<string, unknown>),
      design_doc: { title: "赛博夜行者", logline: "..." },
    } as unknown as NarrativeContext;

    const state = {
      id: "agent_test_run",
      status: "running",
      progress: [...binding.seededProgress],
      streamBuffer: [],
      startedAt: new Date().toISOString(),
      tier: binding.tier,
      mode: binding.mode,
      userInput: binding.userInput,
      genreCode: binding.genreCode,
      outputDir: binding.outputDir,
      entryKey: ENTRY_KEY,
      pipelineSteps: binding.pipelineSteps,
      checkpointAgents: binding.checkpointAgents,
      completedSteps: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    persistAgentStepCompletion(state, "design_doc", mergedCtx.design_doc, mergedCtx);

    const cpOnDisk = JSON.parse(
      fs.readFileSync(path.join(ENTRY_DIR, "_checkpoint.json"), "utf-8"),
    ) as {
      completedSteps: string[];
      ctx: Record<string, unknown>;
      agents?: Array<{ agentId: string; lifecycle: { status: string } }>;
    };

    // 连续性断言核心：单席跑完，旧步（demand_analysis）与新步（design_doc）
    // 必须一起出现在同一份 checkpoint 里——任何一边缺席都说明单席跑没有真的
    // "并入"条目，而是另起了一份只含自己的假状态。
    expect(cpOnDisk.completedSteps.sort()).toEqual(["demand_analysis", "design_doc"]);
    expect(cpOnDisk.ctx.demand_analysis).toBeDefined();
    expect(cpOnDisk.ctx.design_doc).toEqual({ title: "赛博夜行者", logline: "..." });
    const byId = new Map((cpOnDisk.agents ?? []).map((a) => [a.agentId, a.lifecycle.status]));
    expect(byId.get("demand_analysis")).toBe("completed");
    expect(byId.get("design_doc")).toBe("completed");

    // 单步产物文件确实落到该条目目录下（可被后续管线 / 文本视图读到），
    // 而不是散落到别的临时目录。
    const files = fs.readdirSync(ENTRY_DIR);
    expect(files.some((f) => f.includes("策划案"))).toBe(true);
  });
});
