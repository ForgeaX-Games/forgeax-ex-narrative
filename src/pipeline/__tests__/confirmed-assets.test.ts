/**
 * confirmed-assets.ts 单测（G5：src/pipeline/ 首次读 `_entry.json.assets[]`）。
 *
 * 覆盖：版本钉住 vs 跟随最新、钉住的快照缺失时的退化、泳道过滤、非 output 组与
 * 缺失条目的优雅退化。全部经真实文件系统（版本快照的落盘位置本身就是被测行为
 * 的一部分，纯内存 mock 测不出路径拼接是否遵循 §3.3 约定）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { snapshotVersion } from "../../api/version-store.js";
import { listConfirmedAssets, resolveConfirmedAssetContent } from "../runtime/confirmed-assets.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "pipeline-confirmed-assets-test-entry";
const ENTRY_DIR = path.join(OUTPUT_DIR, ENTRY_KEY);

beforeEach(() => {
  fs.mkdirSync(ENTRY_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(ENTRY_DIR, { recursive: true, force: true });
});

function writeEntryJson(assets: unknown[]): void {
  fs.writeFileSync(path.join(ENTRY_DIR, "_entry.json"), JSON.stringify({ key: ENTRY_KEY, assets }));
}

describe("resolveConfirmedAssetContent", () => {
  it("跟随最新（无 version）：读平铺文件当下内容", () => {
    fs.writeFileSync(path.join(ENTRY_DIR, "04_世界观.json"), JSON.stringify({ title: "当前稿" }));
    const result = resolveConfirmedAssetContent(ENTRY_KEY, { path: "output/04_世界观.json" });
    expect(result.content).toEqual({ title: "当前稿" });
    expect(result.resolvedVersion).toBe(1);
  });

  it("钉住早于当前版本的历史快照：读该快照，不是平铺文件", () => {
    snapshotVersion(ENTRY_DIR, "04_世界观.json", { title: "初稿" });
    fs.writeFileSync(path.join(ENTRY_DIR, "04_世界观.json"), JSON.stringify({ title: "改过一次" }));
    const result = resolveConfirmedAssetContent(ENTRY_KEY, { path: "output/04_世界观.json", version: 1 });
    expect(result.content).toEqual({ title: "初稿" });
    expect(result.resolvedVersion).toBe(1);
  });

  it("钉住的版本号缺失（快照被清理）：退化为跟随最新，而不是让整条引用读空", () => {
    fs.writeFileSync(path.join(ENTRY_DIR, "04_世界观.json"), JSON.stringify({ title: "当前稿" }));
    const result = resolveConfirmedAssetContent(ENTRY_KEY, { path: "output/04_世界观.json", version: 5 });
    expect(result.content).toEqual({ title: "当前稿" });
  });

  it("非 output 组或裸文件名之外的形态：内容为 undefined，不抛错", () => {
    const result = resolveConfirmedAssetContent(ENTRY_KEY, { path: "processing/foo.json" });
    expect(result.content).toBeUndefined();
  });

  it("引用的文件本就不存在：内容为 undefined", () => {
    const result = resolveConfirmedAssetContent(ENTRY_KEY, { path: "output/99_不存在.json" });
    expect(result.content).toBeUndefined();
  });
});

describe("listConfirmedAssets", () => {
  it("条目不存在：返回空数组，不抛错", () => {
    expect(listConfirmedAssets("no-such-entry-key")).toEqual([]);
  });

  it("没有 assets 字段：返回空数组", () => {
    fs.writeFileSync(path.join(ENTRY_DIR, "_entry.json"), JSON.stringify({ key: ENTRY_KEY }));
    expect(listConfirmedAssets(ENTRY_KEY)).toEqual([]);
  });

  it("按泳道严格过滤：主管线只取无 pipelineId 的确认记录", () => {
    fs.writeFileSync(path.join(ENTRY_DIR, "04_世界观.json"), JSON.stringify({ title: "主管线世界观" }));
    writeEntryJson([
      { path: "output/04_世界观.json" },
      { path: "output/04_世界观.json", pipelineId: "lane-b" },
    ]);
    const mainLane = listConfirmedAssets(ENTRY_KEY);
    expect(mainLane).toHaveLength(1);
    expect(mainLane[0]!.ref.pipelineId).toBeUndefined();

    const laneB = listConfirmedAssets(ENTRY_KEY, "lane-b");
    expect(laneB).toHaveLength(1);
    expect(laneB[0]!.ref.pipelineId).toBe("lane-b");
  });
});
