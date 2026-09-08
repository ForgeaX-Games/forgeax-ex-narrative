/**
 * version-store.ts — 定稿版本快照（契约 docs/contracts.md §3.3）。
 *
 * 约定（前端 `groupVersions` 已按此读，这里补上落盘那一侧）：
 *
 *   output/<key>/04_世界观/04_世界观_1.json   ← 初稿
 *   output/<key>/04_世界观/04_世界观_2.json   ← 改过一次
 *
 * 只认「主干名开文件夹、版本在内按 `_n` 编号」这一种形态；不产出、也不理会
 * 平铺的 `xxx_1.json`（分批产物就长这样，认了会把批次误当版本历史）。
 *
 * 语义：编号文件夹里的是**历史**快照，"当前"版本永远是那份不带编号、
 * 与旧流程同名的平铺文件（如 `04_世界观.json`，由 `rewriteStepArtifacts` 维护）。
 * 所以"当前版本号" = 已有快照数 + 1 —— 快照只在内容即将被覆盖前补一张，
 * 从不需要为"当前"这份本身再存一次。
 *
 * 纯字符串/数组运算与 fs 操作分层：前半段可脱离磁盘单测，后半段只负责落盘。
 */
import fs from "node:fs";
import path from "node:path";

/**
 * 版本溯源（键权层方案 M2）：这一版是因为什么产生的。
 *
 * 只回答"为什么"，不改变"在哪"——落盘位置与 `_n.ext` 命名照旧，origin 另记进
 * 同目录下的 `<stem>.versions.json` sidecar。sidecar 不存在（历史 `output/` 目录、
 * 或调用方没传 origin）时按"无溯源"兼容读取，不是异常。
 */
export type VersionOrigin =
  | { kind: "manual_edit"; editor?: string }
  | { kind: "qa_repair"; findingIds: string[]; repairKind: "topology" | "content" | "mixed" }
  | { kind: "polish_seat"; seatId: string }
  | { kind: "restore_original" };

export interface VersionIndexEntry {
  version: number;
  createdAt: string;
  origin: VersionOrigin;
  /**
   * 该版本落盘的确切文件名（`<stem>_<n>.<ext>`）。存下来是为了让"给整个 run 目录
   * 批量列 origin"这类读侧（前端一次性拉某个条目所有版本的溯源）不必反推 ext——
   * 沿用 `snapshotVersion` 写入那一刻已经算好的文件名，不再猜。
   */
  fileName: string;
}

export interface VersionStem {
  /** relPath 里文件名之前的目录部分（可能为空串）。 */
  dir: string;
  /** 文件名去掉扩展名的主干，也是版本文件夹名。 */
  stem: string;
  /** 不含点的扩展名。 */
  ext: string;
}

/** 拆解 `<相对路径>`（如 `04_世界观.json` 或 `sub/04_世界观.json`）为目录/主干/扩展名。 */
export function versionStem(relPath: string): VersionStem {
  const norm = relPath.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  const dir = slash >= 0 ? norm.slice(0, slash) : "";
  const fileName = slash >= 0 ? norm.slice(slash + 1) : norm;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot + 1) : "";
  return { dir, stem, ext };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function versionFileRe(stem: string, ext: string): RegExp {
  const extPart = ext ? `\\.${escapeRegExp(ext)}` : "";
  return new RegExp(`^${escapeRegExp(stem)}_(\\d+)${extPart}$`);
}

/** 版本文件名：`<stem>_<n>.<ext>`。 */
export function versionFileName(stem: string, ext: string, n: number): string {
  return ext ? `${stem}_${n}.${ext}` : `${stem}_${n}`;
}

/** 在一批既有文件名里找该主干用过的最大版本号；空目录时下一个从 1 开始。 */
export function nextVersionNumber(existingFileNames: readonly string[], stem: string, ext: string): number {
  const re = versionFileRe(stem, ext);
  let max = 0;
  for (const name of existingFileNames) {
    const m = re.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * 这个文件名是不是该主干的版本快照（含溯源 sidecar）。
 *
 * 版本目录与单节点产物目录是同一个 `<stem>/` —— 谁清理那个目录，都得先问这一句，
 * 否则会把历史快照（或 M2 新增的 `<stem>.versions.json` 溯源索引）当成
 * "已删除节点留下的残文件"顺手删掉。
 */
export function isVersionFileName(relPath: string, fileName: string): boolean {
  const { stem, ext } = versionStem(relPath);
  if (fileName === versionIndexFileName(stem)) return true;
  return versionFileRe(stem, ext).test(fileName);
}

/** 数某主干已有多少张历史快照（不含"当前"那份平铺文件）。 */
export function countVersionSnapshots(runDir: string, relPath: string): number {
  const { dir, stem, ext } = versionStem(relPath);
  const stemDir = path.join(runDir, dir, stem);
  if (!fs.existsSync(stemDir)) return 0;
  const re = versionFileRe(stem, ext);
  return fs.readdirSync(stemDir).filter((f) => re.test(f)).length;
}

/** 当前版本号 = 已有快照数 + 1（"当前"就是那份平铺文件，从未单独编号）。 */
export function currentVersionNumber(runDir: string, relPath: string): number {
  return countVersionSnapshots(runDir, relPath) + 1;
}

function versionIndexFileName(stem: string): string {
  return `${stem}.versions.json`;
}

/** 读某主干的版本溯源索引；sidecar 不存在或损坏时返回空数组（=按无溯源兼容读取）。 */
function loadVersionIndex(stemDir: string, stem: string): VersionIndexEntry[] {
  const p = path.join(stemDir, versionIndexFileName(stem));
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(raw) ? (raw as VersionIndexEntry[]) : [];
  } catch {
    return [];
  }
}

function saveVersionIndex(stemDir: string, stem: string, entries: VersionIndexEntry[]): void {
  fs.writeFileSync(path.join(stemDir, versionIndexFileName(stem)), JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * 把即将被覆盖的旧内容存进版本目录，编号紧接现有快照，返回写入的版本号。
 *
 * **调用时机是不变式**：必须在新内容真正覆盖平铺文件之前调用——顺序颠倒的话，
 * 读到的就已经是"新"内容，等于给同一份东西存了两次快照，而真正的旧版本永久丢失。
 *
 * `origin` 缺省表示调用方不关心溯源（如测试）——sidecar 索引不会为这次快照追加条目，
 * 读侧按"这个版本号没有 origin"处理，而不是报错。
 */
export function snapshotVersion(
  runDir: string,
  relPath: string,
  content: unknown,
  origin?: VersionOrigin,
): number {
  const { dir, stem, ext } = versionStem(relPath);
  const stemDir = path.join(runDir, dir, stem);
  fs.mkdirSync(stemDir, { recursive: true });
  const existing = fs.readdirSync(stemDir);
  const n = nextVersionNumber(existing, stem, ext);
  const fileName = versionFileName(stem, ext, n);
  const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(path.join(stemDir, fileName), body, "utf-8");
  if (origin) {
    const index = loadVersionIndex(stemDir, stem);
    index.push({ version: n, createdAt: new Date().toISOString(), origin, fileName });
    saveVersionIndex(stemDir, stem, index);
  }
  return n;
}

/** 某主干每个版本号对应的溯源（没有 sidecar 或某版本号没登记时该项缺席）。 */
export function readVersionOrigins(runDir: string, relPath: string): VersionIndexEntry[] {
  const { dir, stem } = versionStem(relPath);
  return loadVersionIndex(path.join(runDir, dir, stem), stem);
}

/** 单个版本号的溯源；不存在时返回 `undefined`。 */
export function versionOriginFor(runDir: string, relPath: string, version: number): VersionOrigin | undefined {
  return readVersionOrigins(runDir, relPath).find((e) => e.version === version)?.origin;
}

/**
 * 递归收集某 run 目录下**所有**主干的版本溯源，键是该版本文件相对 `runDir` 的路径
 * （与 `GET /files/:runId` 扁平清单同形），供前端一次性拉全条目版本历史的来源标注，
 * 不必逐个主干分别请求。
 */
export function allVersionOrigins(runDir: string): Record<string, VersionOrigin> {
  const out: Record<string, VersionOrigin> = {};
  const walk = (subDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(runDir, subDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = subDir ? `${subDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".versions.json")) continue;
      let index: VersionIndexEntry[];
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(runDir, rel), "utf-8"));
        index = Array.isArray(raw) ? (raw as VersionIndexEntry[]) : [];
      } catch {
        continue;
      }
      // sidecar 与它记录的版本文件同住一个 stem 目录（subDir 已经是 `<...>/<stem>`），
      // 键直接拼 subDir + fileName，不再重复拼一层 stem。
      for (const e of index) {
        if (!e.fileName) continue;
        out[`${subDir}/${e.fileName}`] = e.origin;
      }
    }
  };
  walk("");
  return out;
}

/** 读一份钉住的历史快照；从未存过或该版本号不存在则返回 `undefined`（不是 404 也不是空对象）。 */
export function readVersionSnapshot(runDir: string, relPath: string, version: number): unknown | undefined {
  const { dir, stem, ext } = versionStem(relPath);
  const filePath = path.join(runDir, dir, stem, versionFileName(stem, ext, version));
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  if (ext === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
