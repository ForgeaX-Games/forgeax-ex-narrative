import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadEntry,
  writeEntry,
  isSafeKey,
  isSafeSourceDir,
  entryPath,
  applyPipelineLocations,
} from "../entry-store.js";

describe("entry-store: output/<key>/_entry.json 持久化", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entry-store-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("isSafeKey 拦截目录穿越/非法名", () => {
    expect(isSafeKey("2026-07-02_10-00-00-000")).toBe(true);
    expect(isSafeKey("a_b-c.d")).toBe(true);
    expect(isSafeKey("../evil")).toBe(false);
    expect(isSafeKey("a/b")).toBe(false);
    expect(isSafeKey("")).toBe(false);
    expect(isSafeKey(undefined)).toBe(false);
  });

  it("isSafeSourceDir 放行次管线的多段目录，但仍拦穿越", () => {
    // 次管线的产物在 <entryKey>/pipelines/<pipelineId> 下，天生带斜杠，
    // 拿 isSafeKey 校验会把所有次管线一并拒掉。
    expect(isSafeSourceDir("2026-07-02_10-00-00-000")).toBe(true);
    expect(isSafeSourceDir("2026-07-02_10-00-00-000/pipelines/pipe-57bfa42b")).toBe(true);
    expect(isSafeSourceDir("../evil")).toBe(false);
    expect(isSafeSourceDir("key/../../etc")).toBe(false);
    expect(isSafeSourceDir("/etc/passwd")).toBe(false);
    expect(isSafeSourceDir("key//pipelines")).toBe(false);
    expect(isSafeSourceDir("")).toBe(false);
    expect(isSafeSourceDir(undefined)).toBe(false);
  });

  it("writeEntry 首次写入创建目录并落 _entry.json", () => {
    const key = "2026-07-02_10-00-00-000";
    const cfg = writeEntry(tmp, key, { inputType: "authored", userInput: "hello", routeGroup: "planning" });
    expect(cfg.key).toBe(key);
    expect(cfg.userInput).toBe("hello");
    expect(cfg.createdAt).toBeTruthy();
    expect(cfg.updatedAt).toBeTruthy();
    expect(fs.existsSync(entryPath(tmp, key))).toBe(true);
  });

  it("loadEntry 读回一致；不存在返回 null", () => {
    const key = "2026-07-02_11-00-00-000";
    expect(loadEntry(tmp, key)).toBeNull();
    writeEntry(tmp, key, { userInput: "abc" });
    expect(loadEntry(tmp, key)?.userInput).toBe("abc");
  });

  it("writeEntry upsert 合并：保留 createdAt，undefined 不覆盖，新字段合并", () => {
    const key = "2026-07-02_12-00-00-000";
    const first = writeEntry(tmp, key, { userInput: "v1", routeGroup: "planning", tier: "tier1" });
    const createdAt = first.createdAt;
    const second = writeEntry(tmp, key, { routeGroup: "narrative", ipRunKey: "2026-07-02_12-00-00-000_书名" });
    expect(second.createdAt).toBe(createdAt); // 保留创建时间
    expect(second.userInput).toBe("v1"); // undefined 字段不覆盖
    expect(second.tier).toBe("tier1"); // 旧字段保留
    expect(second.routeGroup).toBe("narrative"); // 显式字段覆盖
    expect(second.ipRunKey).toBe("2026-07-02_12-00-00-000_书名"); // 新字段合并
  });

  it("writeEntry 拒绝非法 key", () => {
    expect(() => writeEntry(tmp, "../evil", { userInput: "x" })).toThrow();
  });
});

/**
 * 泳道 → 产物目录的落盘（contracts §一）。守的故障是"按下标推主次"：
 * 跳过一条不完整泳道后，第二条才是主管线，靠下标推会让读侧读错目录且不报错。
 */
describe("applyPipelineLocations: 泳道产物目录回写", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entry-lanes-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const planned = [
    { pipelineId: "pipe-a", entryKey: "draft-1" },
    { pipelineId: "pipe-b", entryKey: "draft-1" },
    { pipelineId: "pipe-c", entryKey: "draft-1" },
  ];

  it("按 pipelineId 匹配，主管线记条目根、次管线记子目录", () => {
    const merged = applyPipelineLocations(
      planned,
      new Map([
        ["pipe-a", { sourceDir: "draft-1", primary: true }],
        ["pipe-b", { sourceDir: "draft-1/pipelines/pipe-b", primary: false }],
      ]),
    ) as Array<Record<string, unknown>>;

    expect(merged[0]).toMatchObject({ sourceDir: "draft-1", primary: true });
    expect(merged[1]).toMatchObject({
      sourceDir: "draft-1/pipelines/pipe-b",
      primary: false,
    });
  });

  it("未启动的泳道原样保留：它还没有产物，也就没有目录可记", () => {
    const merged = applyPipelineLocations(
      planned,
      new Map([["pipe-a", { sourceDir: "draft-1", primary: true }]]),
    ) as Array<Record<string, unknown>>;

    expect(merged[2]).toEqual({ pipelineId: "pipe-c", entryKey: "draft-1" });
    expect(merged[2]!.sourceDir).toBeUndefined();
  });

  it("跳过首条时主管线是第二条 —— 结果由 pipelineId 决定，不由下标决定", () => {
    const merged = applyPipelineLocations(
      planned,
      new Map([
        ["pipe-b", { sourceDir: "draft-1", primary: true }],
        ["pipe-c", { sourceDir: "draft-1/pipelines/pipe-c", primary: false }],
      ]),
    ) as Array<Record<string, unknown>>;

    expect(merged[0]!.primary).toBeUndefined();
    expect(merged[1]).toMatchObject({ sourceDir: "draft-1", primary: true });
    expect(merged[2]).toMatchObject({ primary: false });
  });

  it("没有任何启动记录时原样返回（不改动快照）", () => {
    expect(applyPipelineLocations(planned, new Map())).toEqual(planned);
  });

  it("回写后能落盘并读回", () => {
    const key = "draft-writeback";
    writeEntry(tmp, key, { pipelines: planned });
    const merged = applyPipelineLocations(
      loadEntry(tmp, key)!.pipelines!,
      new Map([["pipe-b", { sourceDir: "draft-writeback/pipelines/pipe-b", primary: false }]]),
    );
    writeEntry(tmp, key, { pipelines: merged });
    const back = loadEntry(tmp, key)!.pipelines as Array<Record<string, unknown>>;
    expect(back[1]!.sourceDir).toBe("draft-writeback/pipelines/pipe-b");
  });
});
