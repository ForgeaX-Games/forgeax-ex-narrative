/**
 * G5：定稿引用接入生成侧起跑 ctx（resolveAgentEntryBinding → applyConfirmedAssetOverrides）。
 *
 * 场景：作者确认了世界观第 1 版为定稿，随后又编辑了一次（ctx/平铺文件已是第 2 版），
 * 此时下游单席重跑（或续跑）应当读到"作者钉住的那一版"，而不是"最新但未经确认的草稿"——
 * 否则 `_entry.json.assets[]` 只是一张摆设的确认表，定了稿也没有下游会用（计划里点名的缺口）。
 *
 * 三条断言对应三层覆盖优先级（confirmed 覆盖旧 ctx，caller 覆盖 confirmed）：
 *   ① 无确认记录：走老行为，seededCtx 直接是 checkpoint 里的最新内容
 *   ② 有确认记录且钉了历史版本：seededCtx 换成该历史版本的内容，不是当前 ctx 里的最新草稿
 *   ③ 调用方这次显式传了该字段：仍以调用方为准，确认表不能覆盖"这次就是要改它"的意图
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentEntryBinding } from "../server.js";
import { snapshotVersion } from "../version-store.js";
import type { NarrativeContext } from "../../types/index.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "g5-confirmed-binding-test-entry";
const ENTRY_DIR = path.join(OUTPUT_DIR, ENTRY_KEY);

function seedEntry(opts: {
  assets?: Array<{ path: string; version?: number }>;
  liveWorldview: unknown;
}): void {
  fs.mkdirSync(ENTRY_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ENTRY_DIR, "_entry.json"),
    JSON.stringify({ key: ENTRY_KEY, userInput: "测试用条目", assets: opts.assets ?? [] }),
  );
  // 镜像 rewriteStepArtifacts 的效果：平铺文件与 checkpoint ctx 同步，"跟随最新"才有意义可测。
  fs.writeFileSync(path.join(ENTRY_DIR, "04_世界观.json"), JSON.stringify(opts.liveWorldview));
  fs.writeFileSync(
    path.join(ENTRY_DIR, "_checkpoint.json"),
    JSON.stringify({
      runId: "seed-run",
      startedAt: new Date().toISOString(),
      lastCompletedStep: "worldview",
      completedSteps: ["worldview"],
      savedAt: new Date().toISOString(),
      ctx: { user_input: "测试用条目", worldview_structure: opts.liveWorldview },
      userInput: "测试用条目",
    }),
  );
}

afterEach(() => {
  fs.rmSync(ENTRY_DIR, { recursive: true, force: true });
});

describe("G5：resolveAgentEntryBinding 叠加确认表覆盖", () => {
  it("无确认记录：seededCtx 就是 checkpoint 里的最新内容（老行为不变）", () => {
    seedEntry({ liveWorldview: { title: "改过一次" } });
    const binding = resolveAgentEntryBinding(ENTRY_KEY, {} as NarrativeContext);
    expect((binding.seededCtx as Record<string, unknown>).worldview_structure).toEqual({
      title: "改过一次",
    });
  });

  it("确认表钉住历史版本：seededCtx 换成那一版内容，而不是当前更新的草稿", () => {
    // 版本 1 = 初稿（快照），"当前"（平铺文件/checkpoint ctx）已经是改过一次。
    snapshotVersion(ENTRY_DIR, "04_世界观.json", { title: "初稿世界观" });
    seedEntry({
      assets: [{ path: "output/04_世界观.json", version: 1 }],
      liveWorldview: { title: "改过一次" },
    });
    const binding = resolveAgentEntryBinding(ENTRY_KEY, {} as NarrativeContext);
    expect((binding.seededCtx as Record<string, unknown>).worldview_structure).toEqual({
      title: "初稿世界观",
    });
  });

  it("调用方这次显式传了该字段：仍以调用方为准，确认表不覆盖显式意图", () => {
    snapshotVersion(ENTRY_DIR, "04_世界观.json", { title: "初稿世界观" });
    seedEntry({
      assets: [{ path: "output/04_世界观.json", version: 1 }],
      liveWorldview: { title: "改过一次" },
    });
    const callerCtx = { worldview_structure: { title: "这次显式要改成这样" } } as unknown as NarrativeContext;
    const binding = resolveAgentEntryBinding(ENTRY_KEY, callerCtx);
    expect((binding.seededCtx as Record<string, unknown>).worldview_structure).toEqual({
      title: "这次显式要改成这样",
    });
  });

  it("确认表跟随最新（无 version）：与不确认时读到的内容一致", () => {
    seedEntry({
      assets: [{ path: "output/04_世界观.json" }],
      liveWorldview: { title: "改过一次" },
    });
    const binding = resolveAgentEntryBinding(ENTRY_KEY, {} as NarrativeContext);
    expect((binding.seededCtx as Record<string, unknown>).worldview_structure).toEqual({
      title: "改过一次",
    });
  });
});
