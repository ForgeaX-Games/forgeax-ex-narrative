import { describe, it, expect } from "vitest";
import { laneSourceDir, parseSourceDir } from "../viz/src/store/laneAddress.js";

/**
 * 前端产物寻址的纯函数单测（对应 docs/contracts.md §一 的四元组约定）。
 *
 * 守的是同一类故障：把泳道身份当目录名用。次管线的产物在 `<key>/pipelines/<pid>/`，
 * 主管线的落条目根，而"谁是主"只有启动时刻知道 —— 猜错不会报错，只会让文本视图
 * 安静地读到另一条泳道的文件。
 */

describe("parseSourceDir — 目录名反解", () => {
  it("主管线目录就是条目键", () => {
    expect(parseSourceDir("draft-1786430410247")).toEqual({
      entryKey: "draft-1786430410247",
    });
  });

  it("次管线目录反解出条目键与泳道", () => {
    expect(parseSourceDir("draft-1/pipelines/pipe-abc")).toEqual({
      entryKey: "draft-1",
      pipelineId: "pipe-abc",
    });
  });

  it("非法形态一律 null（含目录穿越与空值）", () => {
    expect(parseSourceDir("../../etc/passwd")).toBeNull();
    expect(parseSourceDir("draft-1/pipelines")).toBeNull();
    expect(parseSourceDir("draft-1/other/pipe-abc")).toBeNull();
    expect(parseSourceDir("draft-1/pipelines/..")).toBeNull();
    expect(parseSourceDir("")).toBeNull();
    expect(parseSourceDir(null)).toBeNull();
  });
});

describe("laneSourceDir — 泳道到产物目录", () => {
  const manifests = [
    { pipelineId: "pipe-main", sourceDir: "draft-1" },
    { pipelineId: "pipe-second", sourceDir: "draft-1/pipelines/pipe-second" },
    { pipelineId: "pipe-planned" },
  ];

  it("本轮启动响应优先于 manifest 快照", () => {
    const lanes = { "pipe-second": { sourceDir: "draft-2/pipelines/pipe-second" } };
    expect(laneSourceDir("pipe-second", lanes, manifests)).toBe(
      "draft-2/pipelines/pipe-second",
    );
  });

  it("没跑过这一轮时退回后端回写的 manifest 字段", () => {
    expect(laneSourceDir("pipe-second", {}, manifests)).toBe(
      "draft-1/pipelines/pipe-second",
    );
  });

  it("主管线报条目根，而不是 pipelines/<id> 子目录", () => {
    expect(laneSourceDir("pipe-main", {}, manifests)).toBe("draft-1");
  });

  it("只 plan 未 start 的泳道没有产物目录 → null（调用方落条目根，不拼一个不存在的路径）", () => {
    expect(laneSourceDir("pipe-planned", {}, manifests)).toBeNull();
    expect(laneSourceDir("pipe-unknown", {}, manifests)).toBeNull();
    expect(laneSourceDir(null, {}, manifests)).toBeNull();
  });
});
