/**
 * M8 — 多管线产物目录布局。
 * sourceDir 从「只能是条目名」扩到「条目名 + pipelines/<pipelineId>」，
 * 因此校验必须逐段做，否则 `/resume` 的 dir 参数会成为目录穿越入口。
 */
import { describe, it, expect } from "vitest";
import {
  entryKeyOfRunDir,
  isSafeRunDir,
  parseRunDirName,
  resolveRunPlacement,
  runDirName,
} from "../run-layout.js";

describe("M8 run 目录布局", () => {
  it("主管线不下沉子目录（既有读侧路径不变）", () => {
    expect(runDirName("20260730_1200")).toBe("20260730_1200");
  });

  it("次管线落 pipelines/<pipelineId>/", () => {
    expect(runDirName("20260730_1200", "pipe-abc123")).toBe(
      "20260730_1200/pipelines/pipe-abc123",
    );
  });

  it("两种形态都能解析回条目与管线", () => {
    expect(parseRunDirName("k1")).toEqual({ entryKey: "k1" });
    expect(parseRunDirName("k1/pipelines/p9")).toEqual({
      entryKey: "k1",
      pipelineId: "p9",
    });
    expect(entryKeyOfRunDir("k1/pipelines/p9")).toBe("k1");
  });

  it("拒绝目录穿越与任意嵌套", () => {
    for (const bad of [
      "..",
      "../secret",
      "k1/../../etc",
      "k1/pipelines/../..",
      "k1/other/p9",
      "k1/pipelines/p9/deeper",
      "/abs/path",
      "k1/pipelines/",
      "",
      "k 1",
    ]) {
      expect(isSafeRunDir(bad), `should reject: ${bad}`).toBe(false);
      expect(parseRunDirName(bad)).toBeNull();
    }
  });

  it("接受安全的条目名字符集", () => {
    expect(isSafeRunDir("2026-07-30_12.00_abc")).toBe(true);
    expect(isSafeRunDir("2026-07-30/pipelines/pipe-a_1.2")).toBe(true);
  });
});

/**
 * 泳道身份与落盘位置的解耦（docs/contracts.md §1.4 第 1 条）。
 *
 * 这组断言守的是一个真实回归：主管线曾为了「不下沉子目录」而不传 pipelineId，
 * 于是运行期 manifest 现铸新 id，与 `_entry.json` 的计划期 id 不等 ——
 * 实测 7 个有计划期 id 的运行目录 7/7 复现。
 */
describe("泳道身份 vs 落盘位置", () => {
  it("主管线保留身份但不下沉子目录", () => {
    const p = resolveRunPlacement({
      entryKey: "draft-1",
      pipelineId: "pipe-abc",
      primary: true,
    });
    expect(p.runDir).toBe("draft-1");
    // 关键：身份没被吞掉 —— manifest 因此不会现铸第二个 id。
    expect(p.laneId).toBe("pipe-abc");
    expect(p.primary).toBe(true);
  });

  it("次管线身份与目录同源", () => {
    const p = resolveRunPlacement({
      entryKey: "draft-1",
      pipelineId: "pipe-abc",
      primary: false,
    });
    expect(p.runDir).toBe("draft-1/pipelines/pipe-abc");
    expect(p.laneId).toBe("pipe-abc");
    expect(parseRunDirName(p.runDir)?.pipelineId).toBe(p.laneId);
  });

  it("缺省即主管线（单管线 /start 无需关心本字段）", () => {
    const p = resolveRunPlacement({ entryKey: "draft-1" });
    expect(p).toEqual({ runDir: "draft-1", laneId: undefined, primary: true });
  });

  it("同一 entryKey 下各泳道目录互不覆盖", () => {
    const dirs = ["pipe-a", "pipe-b"].map(
      (id) => resolveRunPlacement({ entryKey: "k", pipelineId: id, primary: false }).runDir,
    );
    expect(new Set(dirs).size).toBe(2);
    // 次管线都回溯到同一条目。
    expect(dirs.map((d) => entryKeyOfRunDir(d))).toEqual(["k", "k"]);
  });
});
