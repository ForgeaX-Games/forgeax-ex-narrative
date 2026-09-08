import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  versionStem,
  nextVersionNumber,
  versionFileName,
  countVersionSnapshots,
  currentVersionNumber,
  snapshotVersion,
  readVersionSnapshot,
  readVersionOrigins,
  versionOriginFor,
  allVersionOrigins,
  isVersionFileName,
} from "../version-store.js";

describe("version-store: 纯解析（契约 §3.3 的 <stem>/<stem>_<n>.<ext> 约定）", () => {
  it("versionStem 拆解平铺相对路径", () => {
    expect(versionStem("04_世界观.json")).toEqual({ dir: "", stem: "04_世界观", ext: "json" });
  });

  it("versionStem 保留子目录部分", () => {
    expect(versionStem("sub/04_世界观.json")).toEqual({ dir: "sub", stem: "04_世界观", ext: "json" });
  });

  it("nextVersionNumber 空目录从 1 开始", () => {
    expect(nextVersionNumber([], "04_世界观", "json")).toBe(1);
  });

  it("nextVersionNumber 取最大号 + 1，不受无关文件干扰", () => {
    const names = ["04_世界观_1.json", "04_世界观_3.json", "04_世界观_2.json", "other.json"];
    expect(nextVersionNumber(names, "04_世界观", "json")).toBe(4);
  });

  it("versionFileName 与 nextVersionNumber 互为逆运算", () => {
    const name = versionFileName("04_世界观", "json", 2);
    expect(name).toBe("04_世界观_2.json");
    expect(nextVersionNumber([name], "04_世界观", "json")).toBe(3);
  });
});

describe("version-store: 落盘（snapshotVersion / readVersionSnapshot / currentVersionNumber）", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "version-store-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("没有任何快照时当前版本号为 1（那份平铺文件就是唯一版本）", () => {
    expect(countVersionSnapshots(tmp, "04_世界观.json")).toBe(0);
    expect(currentVersionNumber(tmp, "04_世界观.json")).toBe(1);
  });

  it("每次 snapshotVersion 编号紧接现有快照，读回内容一致", () => {
    const v1 = snapshotVersion(tmp, "04_世界观.json", { title: "初稿" });
    expect(v1).toBe(1);
    const v2 = snapshotVersion(tmp, "04_世界观.json", { title: "改过一次" });
    expect(v2).toBe(2);

    expect(readVersionSnapshot(tmp, "04_世界观.json", 1)).toEqual({ title: "初稿" });
    expect(readVersionSnapshot(tmp, "04_世界观.json", 2)).toEqual({ title: "改过一次" });
    // 两张快照之后，"当前"（第三次编辑前）版本号是 3——快照数(2) + 1。
    expect(currentVersionNumber(tmp, "04_世界观.json")).toBe(3);
  });

  it("落盘位置遵循 §3.3 约定：<主干目录>/<主干>_<n>.<ext>", () => {
    snapshotVersion(tmp, "04_世界观.json", { a: 1 });
    const expected = path.join(tmp, "04_世界观", "04_世界观_1.json");
    expect(fs.existsSync(expected)).toBe(true);
  });

  it("从未存过或该版本号不存在时 readVersionSnapshot 返回 undefined，不是抛错或空对象", () => {
    expect(readVersionSnapshot(tmp, "04_世界观.json", 1)).toBeUndefined();
    snapshotVersion(tmp, "04_世界观.json", { a: 1 });
    expect(readVersionSnapshot(tmp, "04_世界观.json", 99)).toBeUndefined();
  });

  it("字符串内容按原样存取（非 JSON 扩展名不解析）", () => {
    snapshotVersion(tmp, "00_偏好总结.md", "# 初稿\n主角是一位侦探");
    expect(readVersionSnapshot(tmp, "00_偏好总结.md", 1)).toBe("# 初稿\n主角是一位侦探");
  });
});

describe("version-store: 版本溯源（键权层方案 M2）", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "version-store-origin-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("不传 origin 时不落 sidecar，也不影响正常快照", () => {
    const v = snapshotVersion(tmp, "04_世界观.json", { a: 1 });
    expect(v).toBe(1);
    expect(readVersionOrigins(tmp, "04_世界观.json")).toEqual([]);
    expect(versionOriginFor(tmp, "04_世界观.json", 1)).toBeUndefined();
  });

  it("传了 origin 就登记进 sidecar，可按版本号查回", () => {
    snapshotVersion(tmp, "04_世界观.json", { a: 1 }, { kind: "manual_edit" });
    snapshotVersion(tmp, "04_世界观.json", { a: 2 }, { kind: "qa_repair", findingIds: ["f1", "f2"], repairKind: "content" });

    const origins = readVersionOrigins(tmp, "04_世界观.json");
    expect(origins).toHaveLength(2);
    expect(versionOriginFor(tmp, "04_世界观.json", 1)).toEqual({ kind: "manual_edit" });
    expect(versionOriginFor(tmp, "04_世界观.json", 2)).toEqual({
      kind: "qa_repair",
      findingIds: ["f1", "f2"],
      repairKind: "content",
    });
  });

  it("sidecar 文件名不干扰版本号计数（不会被误当成一次快照）", () => {
    snapshotVersion(tmp, "04_世界观.json", { a: 1 }, { kind: "manual_edit" });
    // 有 sidecar 之后，下一版仍应是 2，不是 3——sidecar 不匹配 <stem>_<n>.<ext> 的编号正则。
    const v2 = snapshotVersion(tmp, "04_世界观.json", { a: 2 }, { kind: "restore_original" });
    expect(v2).toBe(2);
  });

  it("isVersionFileName 认得 sidecar，防止被当成残留节点文件清掉", () => {
    expect(isVersionFileName("04_世界观.json", "04_世界观.versions.json")).toBe(true);
    expect(isVersionFileName("04_世界观.json", "04_世界观_1.json")).toBe(true);
    expect(isVersionFileName("04_世界观.json", "不相关.json")).toBe(false);
  });

  it("allVersionOrigins 递归收集整个 run 目录下所有主干的溯源，键与 files[] 扁平清单同形", () => {
    snapshotVersion(tmp, "04_世界观.json", { a: 1 }, { kind: "manual_edit" });
    snapshotVersion(tmp, "sub/07_故事大纲.json", { b: 1 }, { kind: "polish_seat", seatId: "deai_polish" });

    const all = allVersionOrigins(tmp);
    expect(all["04_世界观/04_世界观_1.json"]).toEqual({ kind: "manual_edit" });
    expect(all["sub/07_故事大纲/07_故事大纲_1.json"]).toEqual({ kind: "polish_seat", seatId: "deai_polish" });
  });

  it("allVersionOrigins 对没有任何快照的目录返回空对象，不抛错", () => {
    expect(allVersionOrigins(tmp)).toEqual({});
    expect(allVersionOrigins(path.join(tmp, "does-not-exist"))).toEqual({});
  });
});
