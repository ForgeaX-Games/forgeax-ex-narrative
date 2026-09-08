/**
 * Phase 0 · 压缩包解压 + 媒体压缩 —— 蓝图 §6.1 / §3.4。
 *
 * - 压缩包：原生支持 .gz（zlib）与 .tar / .tar.gz（内置最小 USTAR 解析，零依赖、确定性）；
 *   .zip 等其它格式通过 ArchiveExtractor 接缝交由外部库处理（缺失即原样透传，不抛错）。
 * - 媒体压缩：图片→720p / 视频转码属外部依赖（sharp/ffmpeg），以 MediaCompressor 接缝注入；
 *   缺失时原样透传（留接口）。压缩产物落 _processing/_compress（§6.1）。
 *
 * 设计：解压把压缩包成员展开为多个 IncomingFile，汇入既有 Phase0 归档 + Phase1 标准化主链。
 */

import * as zlib from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingFile } from "./phase0-foundation.js";
import { compressDir } from "./filesystem.js";
import type { StoryTimestamp } from "../types/narrative-ip-dna.js";

/** 压缩包接缝（zip/rar/7z 等需外部库）：buffer → 成员文件。 */
export type ArchiveExtractor = (file: IncomingFile) => Promise<IncomingFile[]>;

/** 媒体压缩接缝（图片→720p jpg / 视频转码），需 sharp/ffmpeg 等外部依赖。 */
export type MediaCompressor = (file: IncomingFile) => Promise<IncomingFile>;

/** PDF 拆页接缝（§6.1）：PDF → 逐页图片（需 poppler/pdfium 等外部 CLI）。 */
export type PdfPageSplitter = (file: IncomingFile) => Promise<IncomingFile[]>;

/** 是否为 PDF 文件。 */
export function isPdf(fileName: string, fileType?: string): boolean {
  return ext(fileName) === ".pdf" || (fileType ?? "").toLowerCase().includes("pdf");
}

/**
 * 展开文件集合中的 PDF 为逐页图片（§6.1 PDF 拆页）。非 PDF 原样保留；
 * 无 splitter 或拆页失败时透传原 PDF（留接口降级）。
 */
export async function expandPdfs(
  files: IncomingFile[],
  splitter?: PdfPageSplitter,
): Promise<IncomingFile[]> {
  if (!splitter) return files;
  const out: IncomingFile[] = [];
  for (const f of files) {
    if (isPdf(f.fileName, f.fileType)) {
      try {
        out.push(...(await splitter(f)));
      } catch {
        out.push(f);
      }
    } else {
      out.push(f);
    }
  }
  return out;
}

function ext(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

/** Node 类型里 TextDecoder 构造器不接受 gb18030 等 label；用 InstanceType 避免把值当类型用。 */
const LabelledTextDecoder = TextDecoder as unknown as new (
  label?: string,
) => InstanceType<typeof TextDecoder>;

/** Node's runtime accepts WHATWG encoding labels that its narrow type omits. */
export function decodeGb18030(bytes: Buffer): string {
  return new LabelledTextDecoder("gb18030").decode(bytes);
}

/**
 * 解码压缩包内成员文件名(中文兼容)。
 * Windows/GBK 打包的 zip/tar 常以 CP936(GBK) 字节存名且不置 UTF-8 标志,
 * 直接 toString("utf-8") 会得到 `�`。策略:EFS/UTF-8 标志位 → UTF-8;
 * 否则先 UTF-8 严格解码,失败再按 gb18030(GBK 超集)兜底。
 */
export function decodeArchiveName(bytes: Buffer, utf8Flag: boolean): string {
  if (utf8Flag) return bytes.toString("utf-8");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return decodeGb18030(bytes);
    } catch {
      return bytes.toString("utf-8");
    }
  }
}

/** 是否为本模块可识别的压缩包。 */
export function isArchive(fileName: string): boolean {
  const e = ext(fileName);
  const lower = fileName.toLowerCase();
  return e === ".gz" || e === ".tgz" || e === ".tar" || e === ".zip" || lower.endsWith(".tar.gz");
}

function asBuffer(data: Buffer | string): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data, "utf-8");
}

// ─────────────────────────────────────────────────────────────────
// 最小 USTAR 解析（零依赖）
// ─────────────────────────────────────────────────────────────────

/** 解析 tar 缓冲为成员文件列表（仅普通文件 typeflag '0'/'\0'）。 */
export function untar(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  const BLOCK = 512;
  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    // 全零块 = 结束。
    if (header.every((b) => b === 0)) break;
    const nameRaw = header.subarray(0, 100);
    const nameZero = nameRaw.indexOf(0);
    const name = decodeArchiveName(nameZero >= 0 ? nameRaw.subarray(0, nameZero) : nameRaw, false).trim();
    const sizeOctal = header.subarray(124, 136).toString("utf-8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const typeflag = String.fromCharCode(header[156]);
    offset += BLOCK;
    if ((typeflag === "0" || typeflag === "\0") && name) {
      out.push({ name, data: buf.subarray(offset, offset + size) });
    }
    // 数据按 512 对齐。
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

function fileTypeFromName(name: string): string {
  const e = ext(name).replace(".", "");
  return e || "bin";
}

// ─────────────────────────────────────────────────────────────────
// 零依赖 ZIP 解析（中央目录驱动；支持 stored/deflate）
// ─────────────────────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;

/**
 * 解析 ZIP 缓冲为成员文件（零依赖，走中央目录）。
 * 仅支持 stored(0) / deflate(8)；目录项与不支持的压缩方法跳过。失败成员跳过不抛错。
 */
export function unzip(buf: Buffer): Array<{ name: string; data: Buffer }> {
  // 从尾部定位 EOCD（End Of Central Directory）。
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const cdCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // 中央目录起始偏移

  const out: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < cdCount; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== CDFH_SIG) break;
    const flag = buf.readUInt16LE(ptr + 8); // 通用位标志;bit11(0x800)=文件名按 UTF-8(EFS)
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = decodeArchiveName(buf.subarray(ptr + 46, ptr + 46 + nameLen), (flag & 0x800) !== 0);
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // 目录项
    // 定位本地文件头实际数据起点（本地头的 name/extra 长度可能与中央目录不同）。
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      if (method === 0) {
        out.push({ name, data: Buffer.from(raw) });
      } else if (method === 8) {
        out.push({ name, data: zlib.inflateRawSync(raw) });
      }
    } catch {
      /* 单成员解压失败跳过 */
    }
  }
  return out;
}

/**
 * 默认压缩包解压接缝（§6.1）：零依赖处理 .zip（中央目录 + stored/deflate）。
 * gz/tar/tgz 已由 expandArchive 原生处理，此接缝补齐 zip，供 CLI/服务共用。
 */
export function createDefaultArchiveExtractor(): ArchiveExtractor {
  return async (file: IncomingFile): Promise<IncomingFile[]> => {
    const members = unzip(asBuffer(file.data));
    if (members.length === 0) return [file];
    return members.map((m) => ({ fileName: m.name, data: m.data, fileType: fileTypeFromName(m.name) }));
  };
}

/** 压缩包内应忽略的垃圾/元数据项（Mac/Windows 系统文件、目录项、AppleDouble 资源叉）。 */
export function isJunkArchiveEntry(name: string): boolean {
  if (!name || name.endsWith("/") || name.endsWith("\\")) return true; // 目录项
  if (name.includes("__MACOSX")) return true;
  const base = (name.split(/[/\\]/).pop() ?? name).trim();
  if (base === ".DS_Store" || base === "Thumbs.db" || base === "desktop.ini") return true;
  if (base.startsWith("._")) return true; // AppleDouble 资源叉
  return false;
}

/**
 * 过滤垃圾项 + 自然序排序（数字感知）：保证「第2话」在「第10话」前，
 * 层级序号 / sourceRange 顺序确定、可复跑（§5.0 解压标准化算法）。
 */
export function finalizeArchiveMembers(members: IncomingFile[]): IncomingFile[] {
  return members
    .filter((m) => !isJunkArchiveEntry(m.fileName))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

/**
 * 展开单个压缩包为成员文件（gz/tar/tgz 原生；zip 等走 extractor 接缝）。
 * 无法识别或 extractor 缺失时返回原文件（透传，不抛错）。
 * 多成员结果统一过滤垃圾项 + 自然序排序；保留成员相对子路径供建树识别 部/卷/章。
 */
export async function expandArchive(
  file: IncomingFile,
  extractor?: ArchiveExtractor,
): Promise<IncomingFile[]> {
  const e = ext(file.fileName);
  const lower = file.fileName.toLowerCase();
  const buf = asBuffer(file.data);
  try {
    if (e === ".tar") {
      return finalizeArchiveMembers(untar(buf).map((m) => ({ fileName: m.name, data: m.data, fileType: fileTypeFromName(m.name) })));
    }
    if (e === ".tgz" || lower.endsWith(".tar.gz")) {
      return finalizeArchiveMembers(untar(zlib.gunzipSync(buf)).map((m) => ({ fileName: m.name, data: m.data, fileType: fileTypeFromName(m.name) })));
    }
    if (e === ".gz") {
      const inner = zlib.gunzipSync(buf);
      const innerName = file.fileName.replace(/\.gz$/i, "");
      return [{ fileName: innerName, data: inner, fileType: fileTypeFromName(innerName) }];
    }
    if (e === ".zip" && extractor) {
      return finalizeArchiveMembers(await extractor(file));
    }
  } catch {
    // 解压失败 → 透传原文件，避免中断。
    return [file];
  }
  if (extractor) {
    try {
      return finalizeArchiveMembers(await extractor(file));
    } catch {
      return [file];
    }
  }
  return [file];
}

/**
 * 展开输入文件集合中的所有压缩包（递归一层即可，避免深层嵌套循环）。
 * 非压缩包原样保留。
 */
export async function expandArchives(
  files: IncomingFile[],
  extractor?: ArchiveExtractor,
): Promise<IncomingFile[]> {
  const out: IncomingFile[] = [];
  for (const f of files) {
    if (isArchive(f.fileName)) {
      out.push(...(await expandArchive(f, extractor)));
    } else {
      out.push(f);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// 媒体压缩（接缝）+ 落盘 _compress
// ─────────────────────────────────────────────────────────────────

/**
 * 对图片/视频做压缩并落盘到 _processing/_compress（§6.1）。
 * 无 compressor 时原样落盘（留接口）。返回压缩后的文件集合（其它文件透传）。
 */
export async function compressMediaToDir(
  files: IncomingFile[],
  timestamp: StoryTimestamp,
  title: string,
  opts: { compressor?: MediaCompressor; cwd?: string } = {},
): Promise<IncomingFile[]> {
  const out: IncomingFile[] = [];
  for (const f of files) {
    const isImage = /^image\//.test(f.fileType) || [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext(f.fileName));
    const isVideo = /^video\//.test(f.fileType) || [".mp4", ".mov", ".webm", ".mkv"].includes(ext(f.fileName));
    if (!isImage && !isVideo) {
      out.push(f);
      continue;
    }
    let compressed = f;
    if (opts.compressor) {
      try {
        compressed = await opts.compressor(f);
      } catch {
        compressed = f;
      }
    }
    // 媒体优先：图片落 picture_compress、视频落 video_compress（§6.1）；保留成员相对子路径。
    const dir = compressDir(timestamp, title, isVideo ? "video" : "picture", { cwd: opts.cwd });
    const segments = compressed.fileName.split(/[/\\]+/).filter((s) => s && s !== "." && s !== "..");
    const abs = path.join(dir, ...(segments.length ? segments : [compressed.fileName]));
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, asBuffer(compressed.data));
    } catch {
      /* 落盘失败不阻断 */
    }
    out.push(compressed);
  }
  return out;
}
