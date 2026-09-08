/**
 * `applyRunTransition`（键权层方案 M4）：终态跃迁的单一写入口。
 *
 * 收敛前最容易漏的一步是"改了内存 status，却忘了顺手 finalize `_run_manifest.json`"——
 * `/regenerate` 就是这样：fork 出来的新条目 `_run_manifest.json` 永远停在最后一次
 * 增量帧的 agent 状态。这里直接测这一个函数，不经过完整的 LLM 管线：
 * 给定一个已建好 manifest 的 `RunState`，跃迁一次，两份文件都要同时收尾到位。
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  applyRunTransition,
  initRunManifest,
  type RunState,
} from "../server.js";
import type { NarrativeContext } from "../../types/index.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "run-transition-test-entry";
const ENTRY_DIR = path.join(OUTPUT_DIR, ENTRY_KEY);

afterEach(() => {
  fs.rmSync(ENTRY_DIR, { recursive: true, force: true });
});

function seedState(): RunState {
  const state: RunState = {
    id: "run-1",
    status: "running",
    progress: [],
    streamBuffer: [],
    startedAt: new Date().toISOString(),
    outputDir: ENTRY_DIR,
    entryKey: ENTRY_KEY,
    pipelineSteps: ["outline_batch", "structure_check"],
  };
  fs.mkdirSync(ENTRY_DIR, { recursive: true });
  initRunManifest(state, state.pipelineSteps!, {});
  return state;
}

function readManifestJson(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ENTRY_DIR, "manifest.json"), "utf-8"));
}

function readRunManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ENTRY_DIR, "_run_manifest.json"), "utf-8"));
}

describe("applyRunTransition", () => {
  it("completed：两份文件同步收尾，未跑完的步置 skipped（动态裁剪）", () => {
    const state = seedState();
    applyRunTransition(state, { type: "completed", result: {} as NarrativeContext });

    expect(state.status).toBe("completed");
    expect(readManifestJson().status).toBe("completed");
    const rm = readRunManifest();
    expect(rm.status).toBe("completed");
    const agents = rm.agents as Array<{ agentId: string; lifecycle: { status: string } }>;
    // 两步都还是 pending（没人跑过），收尾成 completed 时按"动态裁剪"语义置 skipped。
    for (const a of agents) expect(a.lifecycle.status).toBe("skipped");
  });

  it("failed：running 的那一步标 failed，其余保持 pending 供 resume 续跑", () => {
    const state = seedState();
    state.manifest!.agents[0].lifecycle = { status: "running", updatedAt: new Date().toISOString() };
    applyRunTransition(state, { type: "failed", error: "boom" });

    expect(state.status).toBe("failed");
    expect(state.error).toBe("boom");
    expect(readManifestJson().status).toBe("failed");
    const rm = readRunManifest();
    expect(rm.status).toBe("failed");
    const agents = rm.agents as Array<{ agentId: string; lifecycle: { status: string; error?: string } }>;
    expect(agents[0].lifecycle.status).toBe("failed");
    expect(agents[0].lifecycle.error).toBe("boom");
    expect(agents[1].lifecycle.status).toBe("pending");
  });

  it("cancelled：内存态与磁盘态都落成 failed，但旗标区分「取消」而非「跑挂了」", () => {
    const state = seedState();
    state.manifest!.agents[0].lifecycle = { status: "running", updatedAt: new Date().toISOString() };
    applyRunTransition(state, { type: "cancelled" });

    expect(state.status).toBe("failed");
    expect(state.cancelled).toBe(true);
    expect(state.error).toBe("用户取消生成");
    // manifest.json 上要能分辨"取消"与"真失败"——否则界面会把用户按的暂停显示成红色失败。
    expect(readManifestJson().cancelled).toBe(true);
    expect(readRunManifest().status).toBe("failed");
  });

  it("completed 时把 result 写进内存态，供 saveRunToFile 等下游读取", () => {
    const state = seedState();
    const result = { user_input: "hi" } as unknown as NarrativeContext;
    applyRunTransition(state, { type: "completed", result });
    expect(state.result).toBe(result);
  });
});
