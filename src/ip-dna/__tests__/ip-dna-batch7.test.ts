import { describe, it, expect } from "vitest";
import * as zlib from "node:zlib";

import { unzip, createDefaultArchiveExtractor, isArchive } from "../phase0-compress.js";
import { createFfmpegMediaCompressor } from "../video-ffmpeg.js";
import { resolveIpDnaRuntimeAdapters } from "../runtime-adapters.js";
import type { IncomingFile } from "../phase0-foundation.js";

/** 构造一个最小 ZIP（deflate 方法 8，单成员），用于测试零依赖解析。 */
function buildDeflateZip(name: string, content: string): Buffer {
  const nameBuf = Buffer.from(name, "utf-8");
  const raw = Buffer.from(content, "utf-8");
  const comp = zlib.deflateRawSync(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8); // method=deflate
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localBlock = Buffer.concat([local, nameBuf, comp]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10); // method=deflate
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // local header offset
  const centralBlock = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); // entries this disk
  eocd.writeUInt16LE(1, 10); // entries total
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16); // central dir offset

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

describe("batch7: 零依赖 ZIP 解析", () => {
  it("unzip 解出 deflate 成员", () => {
    const zip = buildDeflateZip("hello.txt", "你好，世界");
    const members = unzip(zip);
    expect(members.length).toBe(1);
    expect(members[0].name).toBe("hello.txt");
    expect(members[0].data.toString("utf-8")).toBe("你好，世界");
  });

  it("createDefaultArchiveExtractor 展开 zip 成员文件", async () => {
    const extractor = createDefaultArchiveExtractor();
    const out = await extractor({ fileName: "a.zip", data: buildDeflateZip("note.md", "# 标题"), fileType: "zip" });
    expect(out.length).toBe(1);
    expect(out[0].fileName).toBe("note.md");
    const text = typeof out[0].data === "string" ? out[0].data : out[0].data.toString("utf-8");
    expect(text).toContain("标题");
  });

  it("非法 zip 透传原文件（不抛错）", async () => {
    const extractor = createDefaultArchiveExtractor();
    const file: IncomingFile = { fileName: "bad.zip", data: Buffer.from("not a zip"), fileType: "zip" };
    const out = await extractor(file);
    expect(out).toEqual([file]);
  });

  it("isArchive 识别 zip/tar/gz", () => {
    expect(isArchive("x.zip")).toBe(true);
    expect(isArchive("x.tar.gz")).toBe(true);
    expect(isArchive("x.txt")).toBe(false);
  });
});

describe("batch7: 媒体压缩器（透传降级）", () => {
  it("非媒体文件原样透传", async () => {
    const compressor = createFfmpegMediaCompressor();
    const file: IncomingFile = { fileName: "doc.txt", data: "正文", fileType: "text/plain" };
    expect(await compressor(file)).toEqual(file);
  });

  it("ffmpeg 不可用时图片透传（不抛错）", async () => {
    const compressor = createFfmpegMediaCompressor({ ffmpegPath: "/nonexistent/ffmpeg-xyz" });
    const file: IncomingFile = { fileName: "p.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), fileType: "image/png" };
    const out = await compressor(file);
    expect(out.fileName).toBe("p.png"); // 转码失败 → 原件
  });
});

describe("batch7: runtime adapters 暴露多模态边界适配器", () => {
  it("解析返回 frameSampler/mediaCompressor/archiveExtractor", async () => {
    const adapters = await resolveIpDnaRuntimeAdapters(process.env);
    expect(typeof adapters.frameSampler).toBe("function");
    expect(typeof adapters.mediaCompressor).toBe("function");
    expect(typeof adapters.archiveExtractor).toBe("function");
  });
});
