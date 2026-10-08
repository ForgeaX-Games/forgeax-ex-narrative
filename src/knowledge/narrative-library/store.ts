/**
 * 叙事模板库与算子库（主表 4.2.1 / 4.2.2）—— 跨作品积累，不随单次运行蒸发。
 *
 * 要解决的事：算子与模板今天只活在某一次 IP 提炼的产物目录里。下一部作品从头再提炼
 * 一遍，哪怕提出来的是同一条"以物代言"，上一次的积累也一点用不上。主表给这两条的
 * 职责原文是「积累叙事模板 / 算子，提升**长期**的叙事能力」——长期这个词要求库在运行
 * 之间活着。
 *
 * ## 去重不是丢弃
 *
 * 同一条算子被不同作品独立提炼出来，是这条机制最有价值的信号：它说明这个手法不是
 * 某部作品的特有笔法，而是**通用**的。所以撞上已有指纹时不丢后来者，而是给它记一笔
 * 印证（`corroboration` 加一、来源追加）。检索时按印证数排序，越通用的越先被借用。
 *
 * 只做"撞了就跳过"的去重会把这个信号连同重复一起扔掉，库长成一个扁平的清单，
 * 哪条可靠无从判断。
 *
 * ## 指纹取什么
 *
 * 取语义字段，不取 `uid`。uid 每次提炼都新生成，拿它当键等于永不去重——库会随运行
 * 次数线性膨胀，而这正是"积累"与"堆积"的分界。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { NarrativeOperator, NarrativeTemplate } from "../../types/narrative-ip-dna.js";
import { resolveNarrativeRoot } from "../../runtime/artifact-root.js";

/** 库目录名。与产物目录平级：它不属于任何一次运行。 */
export const LIBRARY_DIR = "library";

export const LIBRARY_FILES = {
  operator: "operators.json",
  template: "templates.json",
} as const;

export type LibraryKind = keyof typeof LIBRARY_FILES;

/** 一条积累下来的库条目。 */
export interface LibraryEntry<T> {
  /** 内容指纹，去重键。 */
  fingerprint: string;
  payload: T;
  /**
   * 贡献过这一条的作品。同指纹重复入库时追加而不是覆盖 —— 它是"这条手法都在哪儿
   * 见过"的答案，也是作者判断要不要借用时唯一有用的依据。
   */
  sources: Array<{ storyId: string; title: string; nodeUid?: string }>;
  /**
   * 被几部**不同作品**独立提炼出来。
   *
   * 按作品计而不按次数计：同一部作品重跑三遍提炼不说明手法通用，只说明它跑了三遍。
   */
  corroboration: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LibrarySource {
  storyId: string;
  title: string;
  nodeUid?: string;
}

export interface LibraryRoots {
  /** 库所在的根目录；缺省跟着叙事产物根走（测试传临时目录）。 */
  cwd?: string;
}

function libraryPath(kind: LibraryKind, roots?: LibraryRoots): string {
  return path.join(roots?.cwd ?? resolveNarrativeRoot(), LIBRARY_DIR, LIBRARY_FILES[kind]);
}

/**
 * 稳定序列化：键按字典序排，好让"同一内容不同键序"算出同一个指纹。
 *
 * 不排序的话，两次提炼吐出同样的算子但 JSON 键顺序不同，指纹就不同 —— 去重会在
 * 一件它本该拦住的事上静默失手。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function digest(value: unknown): string {
  return crypto.createHash("sha1").update(stableStringify(value)).digest("hex").slice(0, 16);
}

/**
 * 算子的指纹取"它是什么手法"这几项：名字、定义、作用类型与作用元素。
 *
 * 不取 `usage_guide` / `example` / `knowledge_location`：同一条手法在不同作品里举的
 * 例子必然不同，把它们算进指纹，去重就永远不会命中，而那三项恰恰是最该合并保留的
 * ——它们是同一条手法的多份用法样本。
 */
export function operatorFingerprint(op: NarrativeOperator): string {
  return digest({
    name: op.name?.trim(),
    definition: op.definition?.trim(),
    type: op.adaptation?.type?.trim(),
    element: op.adaptation?.element?.trim(),
  });
}

/**
 * 模板的指纹取故事结构那一部分。
 *
 * 模板整份包含世界观、角色、核心元素，那些是作品的具体内容，跨作品一定不同；可复用
 * 的是它的**结构形制**（几幕、转折落在哪、分支怎么收）。拿整份做指纹，库里就是一堆
 * 永不重合的孤例，谈不上积累。
 */
export function templateFingerprint(tpl: NarrativeTemplate): string {
  return digest(tpl.story_structure ?? {});
}

function readEntries<T>(kind: LibraryKind, roots?: LibraryRoots): Array<LibraryEntry<T>> {
  const file = libraryPath(kind, roots);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<LibraryEntry<T>>) : [];
  } catch {
    // 库文件坏了不该让创作停下：当作空库继续，下一次入库会把它重写成合法的。
    return [];
  }
}

function writeEntries<T>(kind: LibraryKind, entries: Array<LibraryEntry<T>>, roots?: LibraryRoots): void {
  const file = libraryPath(kind, roots);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, "utf-8");
}

/**
 * 入库一批条目：新的落库，已有的记一笔印证。
 *
 * 返回这一趟各有多少条落到哪一边 —— 调用方据此报"新增 N 条、印证 M 条"，那是
 * 库在长大还是在打转的唯一可见指标。
 */
function accumulate<T>(
  kind: LibraryKind,
  items: readonly T[],
  fingerprintOf: (item: T) => string,
  source: LibrarySource,
  roots?: LibraryRoots,
): { added: number; corroborated: number } {
  if (items.length === 0) return { added: 0, corroborated: 0 };

  const entries = readEntries<T>(kind, roots);
  const index = new Map(entries.map((e) => [e.fingerprint, e]));
  const now = new Date().toISOString();
  let added = 0;
  let corroborated = 0;

  for (const item of items) {
    const fingerprint = fingerprintOf(item);
    const existing = index.get(fingerprint);
    if (!existing) {
      const entry: LibraryEntry<T> = {
        fingerprint,
        payload: item,
        sources: [source],
        corroboration: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      };
      entries.push(entry);
      index.set(fingerprint, entry);
      added += 1;
      continue;
    }
    existing.lastSeenAt = now;
    const knownStory = existing.sources.some((s) => s.storyId === source.storyId);
    existing.sources.push(source);
    // 同一部作品重复贡献不加印证：印证数要回答"几部作品独立得出同一结论"。
    if (!knownStory) {
      existing.corroboration += 1;
      corroborated += 1;
    }
  }

  writeEntries(kind, entries, roots);
  return { added, corroborated };
}

export function accumulateOperators(
  operators: readonly NarrativeOperator[],
  source: LibrarySource,
  roots?: LibraryRoots,
): { added: number; corroborated: number } {
  return accumulate("operator", operators, operatorFingerprint, source, roots);
}

export function accumulateTemplates(
  templates: readonly NarrativeTemplate[],
  source: LibrarySource,
  roots?: LibraryRoots,
): { added: number; corroborated: number } {
  return accumulate("template", templates, templateFingerprint, source, roots);
}

/**
 * 借用算子：按印证数降序。
 *
 * 排序键是"被几部作品印证过"而不是入库时间：库的价值随印证累积，而入库早晚只是
 * 谁先跑过一次提炼。`domain` 给了就只取那一域 —— 席位要的是与它那一段有关的手法，
 * 整库倒给它等于噪声。
 */
export function borrowOperators(
  opts: { domain?: string; limit?: number; roots?: LibraryRoots } = {},
): NarrativeOperator[] {
  const { domain, limit = 12, roots } = opts;
  return readEntries<NarrativeOperator>("operator", roots)
    .filter((e) => !domain || e.payload.knowledge_domain === domain)
    .sort((a, b) => b.corroboration - a.corroboration || (a.fingerprint < b.fingerprint ? -1 : 1))
    .slice(0, limit)
    .map((e) => e.payload);
}

/** 库里现在有多少条、被印证到什么程度。供面板与运行日志陈述"库在长大"。 */
export function libraryStats(roots?: LibraryRoots): Record<LibraryKind, { entries: number; multiSourced: number }> {
  const of = (kind: LibraryKind) => {
    const entries = readEntries<unknown>(kind, roots);
    return {
      entries: entries.length,
      multiSourced: entries.filter((e) => e.corroboration > 1).length,
    };
  };
  return { operator: of("operator"), template: of("template") };
}
