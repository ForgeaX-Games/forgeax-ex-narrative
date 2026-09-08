import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  primaryFamilyOf,
  familyOfModality,
  mediaOriginalDir,
  processingDir,
  extractionOutputDir,
  packageDir,
  compressDir,
  saveHierarchyIndexOnly,
  loadHierarchyIndexByRun,
  loadManifestByRun,
  listInputRunKeys,
  createEmptyIpDna,
  runName,
} from "../filesystem.js";
import { expandArchives, createDefaultArchiveExtractor, finalizeArchiveMembers, isJunkArchiveEntry } from "../phase0-compress.js";
import { archiveAndBuildManifest, type IncomingFile } from "../phase0-foundation.js";
import { runIngest } from "../orchestrator.js";

/** 构造一个最小多成员 ZIP（stored 方法 0）。默认置 EFS（UTF-8 名）。 */
function buildZip(entries: { name: string; content?: string; utf8?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf-8");
    const data = Buffer.from(e.content ?? "", "utf-8");
    const flag = e.utf8 === false ? 0 : 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flag, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localBlock = Buffer.concat([local, nameBuf, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flag, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    locals.push(localBlock);
    offset += localBlock.length;
  }
  const localAll = Buffer.concat(locals);
  const centralAll = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralAll.length, 12);
  eocd.writeUInt32LE(localAll.length, 16);
  return Buffer.concat([localAll, centralAll, eocd]);
}

describe("媒体优先布局（§6.1）· 家族映射与路径", () => {
  it("primaryFamilyOf / familyOfModality 映射", () => {
    expect(primaryFamilyOf("book")).toBe("book");
    expect(primaryFamilyOf("mixed")).toBe("book");
    expect(primaryFamilyOf("picture")).toBe("picture");
    expect(primaryFamilyOf("comic")).toBe("picture");
    expect(primaryFamilyOf("video")).toBe("video");
    expect(familyOfModality("text")).toBe("book");
    expect(familyOfModality("image")).toBe("picture");
    expect(familyOfModality("video")).toBe("video");
  });

  it("各阶段路径形态符合 §6.1", () => {
    const ts = "2026-06-29_120000";
    const title = "蛊真人";
    const norm = (p: string): string => p.replace(/\\/g, "/");
    expect(norm(mediaOriginalDir(ts, title, "book"))).toContain(`book/story_book/book_original/${ts}_${title}`);
    expect(norm(processingDir(ts, title, "book"))).toContain(`book/story_book/book_processing/${ts}_${title}`);
    expect(norm(extractionOutputDir(ts, title, "book"))).toContain(`book/story_book/book_extraction_output/${ts}_${title}`);
    expect(norm(compressDir(ts, title, "picture"))).toContain(`picture/story_picture/picture_compress/${ts}_${title}`);
    expect(norm(packageDir(ts, title))).toContain(`input/package/${ts}_${title}`);
    // 混合模态统一落主媒体 book。
    expect(norm(extractionOutputDir(ts, title, "mixed"))).toContain("book/story_book/book_extraction_output");
  });
});

describe("媒体优先布局 · 混合模态分家落盘", () => {
  it("文本/图片/视频分别落 book/picture/video 各 *_original，manifest 路径为媒体优先相对路径", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-fam-"));
    const ts = "2026-06-29_130000";
    const title = "混合作品";
    const files: IncomingFile[] = [
      { fileName: "正文.txt", data: "正文。".repeat(20), fileType: "text/plain" },
      { fileName: "设定/角色.png", data: Buffer.from([1, 2, 3]), fileType: "image/png" },
    ];
    const r = archiveAndBuildManifest({ files, title, story_timestamp: ts, cwd });
    expect(r.manifest.media_type).toBe("mixed");
    expect(fs.existsSync(path.join(mediaOriginalDir(ts, title, "book", { cwd }), "正文.txt"))).toBe(true);
    // 图片保留相对子路径 设定/角色.png。
    expect(fs.existsSync(path.join(mediaOriginalDir(ts, title, "picture", { cwd }), "设定", "角色.png"))).toBe(true);
    const paths = r.manifest.source_files.map((s) => s.path.replace(/\\/g, "/"));
    expect(paths).toContain(`book/story_book/book_original/${ts}_${title}/正文.txt`);
    expect(paths).toContain(`picture/story_picture/picture_original/${ts}_${title}/设定/角色.png`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("媒体优先布局 · runId 家族解析 + legacy 兜底", () => {
  it("loadHierarchyIndexByRun 在主媒体家族命中", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-run-"));
    const ts = "2026-06-29_140000";
    const title = "蛊真人";
    const dna = createEmptyIpDna({ story_id: ts, title, media_type: "book" });
    saveHierarchyIndexOnly(dna, { cwd });
    const loaded = loadHierarchyIndexByRun(runName(ts, title), { cwd });
    expect(loaded?.story_id).toBe(ts);
    expect(loaded?.media_type).toBe("book");
    expect(listInputRunKeys({ cwd })).toContain(runName(ts, title));
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("loadHierarchyIndexByRun / loadManifestByRun 对 legacy（run 优先）布局兜底", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-legacy-"));
    const ts = "2026-06-29_150000";
    const title = "旧作品";
    const run = runName(ts, title);
    const legacyExtract = path.join(cwd, "input", run, "_extraction_output");
    fs.mkdirSync(legacyExtract, { recursive: true });
    const dna = createEmptyIpDna({ story_id: ts, title, media_type: "book" });
    fs.writeFileSync(path.join(legacyExtract, "_hierarchy.json"), JSON.stringify(dna), "utf-8");
    // legacy manifest 落在 run 根。
    fs.writeFileSync(
      path.join(cwd, "input", run, "user_asset_manifest.json"),
      JSON.stringify({ story_id: ts, title, media_type: "book", modality: ["text"], side: "story", source_files: [], processing_status: "archived", created_at: new Date().toISOString() }),
      "utf-8",
    );
    expect(loadHierarchyIndexByRun(run, { cwd })?.story_id).toBe(ts);
    expect(loadManifestByRun(run, { cwd })?.title).toBe(title);
    expect(listInputRunKeys({ cwd })).toContain(run);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("§状态机 · IP「确认」即落盘（packageOnly，零 LLM）", () => {
  it("runIngest(packageOnly) 只归档原料 + 写 manifest，不做标准化/建树（无 _processing / 无 _hierarchy.json）", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-pkg-"));
    const ts = "2026-06-29_170000";
    const title = "确认落盘作品";
    const files: IncomingFile[] = [
      { fileName: "正文.txt", data: "第一章 正文。".repeat(30), fileType: "text/plain" },
    ];
    const r = await runIngest({ files, title, story_timestamp: ts, cwd, packageOnly: true, deferMultimodal: true });

    expect(r.story_timestamp).toBe(ts);
    expect(r.title).toBe(title);
    // 原料已固化到 input/ 媒体优先目录。
    expect(fs.existsSync(path.join(mediaOriginalDir(ts, title, "book", { cwd }), "正文.txt"))).toBe(true);
    // manifest 已写。
    expect(loadManifestByRun(runName(ts, title), { cwd })?.title).toBe(title);
    // 标准化被推迟：无 _processing 目录、无 _extraction_output 的 _hierarchy.json。
    expect(fs.existsSync(processingDir(ts, title, "book", { cwd }))).toBe(false);
    expect(fs.existsSync(path.join(extractionOutputDir(ts, title, "book", { cwd }), "_hierarchy.json"))).toBe(false);
    // 未持久化层级树 → listInputRunKeys 不应因 packageOnly 而登记 _hierarchy 索引键。
    expect(loadHierarchyIndexByRun(runName(ts, title), { cwd })).toBeFalsy();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("解压标准化算法 · 垃圾过滤 / 自然序 / 相对路径", () => {
  it("isJunkArchiveEntry 识别 __MACOSX / .DS_Store / AppleDouble / 目录项", () => {
    expect(isJunkArchiveEntry("__MACOSX/foo/._bar.txt")).toBe(true);
    expect(isJunkArchiveEntry(".DS_Store")).toBe(true);
    expect(isJunkArchiveEntry("蛊真人/._第1话.txt")).toBe(true);
    expect(isJunkArchiveEntry("蛊真人/子卷/")).toBe(true);
    expect(isJunkArchiveEntry("蛊真人/第1话.txt")).toBe(false);
  });

  it("finalizeArchiveMembers 过滤垃圾 + 自然序（第2话 在 第10话 前）", () => {
    const members: IncomingFile[] = [
      { fileName: "蛊真人/第10话.txt", data: Buffer.from("十"), fileType: "txt" },
      { fileName: "__MACOSX/蛊真人/._第2话.txt", data: Buffer.from("x"), fileType: "txt" },
      { fileName: "蛊真人/第2话.txt", data: Buffer.from("二"), fileType: "txt" },
      { fileName: ".DS_Store", data: Buffer.from("y"), fileType: "bin" },
    ];
    const out = finalizeArchiveMembers(members).map((m) => m.fileName);
    expect(out).toEqual(["蛊真人/第2话.txt", "蛊真人/第10话.txt"]);
  });

  it("expandArchives（zip）解出成员→过滤+排序→归档保留相对子路径到 book 原始件", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-zip-"));
    const ts = "2026-06-29_160000";
    const title = "蛊真人";
    const zip = buildZip([
      { name: "蛊真人/第10话.txt", content: "第十话正文" },
      { name: "蛊真人/第2话.txt", content: "第二话正文" },
      { name: "__MACOSX/._x", content: "junk" },
      { name: ".DS_Store", content: "junk" },
    ]);
    const members = await expandArchives(
      [{ fileName: "蛊真人.zip", data: zip, fileType: "zip" }],
      createDefaultArchiveExtractor(),
    );
    const names = members.map((m) => m.fileName);
    expect(names).toEqual(["蛊真人/第2话.txt", "蛊真人/第10话.txt"]);
    // 归档保留相对子路径。
    archiveAndBuildManifest({ files: members, title, story_timestamp: ts, cwd });
    const base = mediaOriginalDir(ts, title, "book", { cwd });
    expect(fs.existsSync(path.join(base, "蛊真人", "第2话.txt"))).toBe(true);
    expect(fs.existsSync(path.join(base, "蛊真人", "第10话.txt"))).toBe(true);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
