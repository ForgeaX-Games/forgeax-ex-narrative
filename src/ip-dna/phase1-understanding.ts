/**
 * Phase 1 · 输入理解 / 标准化 —— 蓝图 §5 / §7.1。
 *
 * 移植重写 agentos 三提取管线（结构识别 / 层级化 / 标准化）的**确定性骨架**为 TS：
 *   ① 从标准化文本的结构标记构建"轻量层级树"（序号 / 标题 / 边界），不含三件套正文；
 *   ② 体量水准线判断：超阈值则按格式拆解，再标准化；
 *   ③ 无显式结构的散文走 LLM 结构推断（seam）。
 *
 * 设计取舍：标记驱动的层级识别是确定性、可单测的核心；LLM 仅在标记缺失时兜底。
 */

import type { LLMClient } from "../pipeline/runtime/llm-client.js";
import { parseJSON } from "../pipeline/runtime/llm-client.js";
import type {
  NarrativeIpDna,
  HierarchyNode,
  HierarchyLevelType,
  HierarchyStructureType,
  IpMediaType,
  StoryTimestamp,
} from "../types/narrative-ip-dna.js";
import { createEmptyIpDna } from "./filesystem.js";
import { SHORT_TEXT_THRESHOLD } from "./phase0-foundation.js";
import { loadIpDnaPrompt } from "./prompt-loader.js";
import { extractUnitNumber } from "./unit-identity.js";

/** 单条结构标记的识别结果。 */
export interface HierarchyMarker {
  levelType: HierarchyLevelType;
  /** 标题文本。 */
  title: string;
  /** 在原文中的字符偏移（用于切边界）。 */
  offset: number;
}

/**
 * 中文 / markdown 常见层级标记。
 * 卷/部/册/季 → part；章/回/幕 → chapter；节/话/集/场 → unit。
 * markdown #=part ##=chapter ###=unit（启发式，缺失层由父子归并补齐）。
 */
const CN_LEVEL_PATTERNS: Array<{ re: RegExp; levelType: HierarchyLevelType }> = [
  { re: /^\s*第[0-9零一二三四五六七八九十百千]+[卷部册季]\s*[:：]?.*$/, levelType: "part" },
  { re: /^\s*第[0-9零一二三四五六七八九十百千]+[章回幕]\s*[:：]?.*$/, levelType: "chapter" },
  { re: /^\s*第[0-9零一二三四五六七八九十百千]+[节话集场]\s*[:：]?.*$/, levelType: "unit" },
];

const MD_LEVEL_BY_DEPTH: Record<number, HierarchyLevelType> = {
  1: "part",
  2: "chapter",
  3: "unit",
};

/** 扫描文本，按行识别结构标记（确定性）。 */
export function detectHierarchyMarkers(text: string): HierarchyMarker[] {
  const markers: HierarchyMarker[] = [];
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const lineLen = line.length + 1; // +1 换行
    const trimmed = line.trim();

    const md = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (md) {
      const depth = md[1].length;
      markers.push({ levelType: MD_LEVEL_BY_DEPTH[depth] ?? "unit", title: md[2].trim(), offset });
      offset += lineLen;
      continue;
    }

    let matched = false;
    for (const { re, levelType } of CN_LEVEL_PATTERNS) {
      if (re.test(trimmed)) {
        markers.push({ levelType, title: trimmed, offset });
        matched = true;
        break;
      }
    }
    // 小数嵌套编号（如 "1.1 标题"/"1.1.1 标题"）：1 个点 → chapter，≥2 个点 → unit（§3.2 嵌套编号）。
    // 守卫：必须含 ≥1 个点、点号后接非数字标题、整行 ≤80 字，避免误吞列表项与小数正文。
    if (!matched) {
      const dec = trimmed.match(/^(\d+(?:\.\d+)+)[)）.、:：]?\s+(\S.{0,78})$/);
      if (dec) {
        const dots = (dec[1].match(/\./g) ?? []).length;
        markers.push({ levelType: dots >= 2 ? "unit" : "chapter", title: trimmed, offset });
      }
    }
    offset += lineLen;
  }
  return markers;
}

const LEVEL_DEPTH: Record<HierarchyLevelType, number> = {
  complete: 0,
  part: 1,
  chapter: 2,
  unit: 3,
};

export interface BuildHierarchyInput {
  story_timestamp: StoryTimestamp;
  title: string;
  media_type: IpMediaType;
  /** 标准化后的全文（用于标记扫描与边界切分）。 */
  text: string;
}

/**
 * 从结构标记构建轻量层级树（确定性核心）。
 * 标记不连续（如有节无章）时，按"就近父级"挂载，缺失中间层不强行补造（结构对齐而非命名对齐，§3.1）。
 */
export function buildLightHierarchy(input: BuildHierarchyInput): NarrativeIpDna {
  const dna = createEmptyIpDna({
    story_id: input.story_timestamp,
    title: input.title,
    media_type: input.media_type,
  });
  const root = dna.nodes[dna.rootId];
  const markers = detectHierarchyMarkers(input.text);

  if (markers.length === 0) {
    // 无结构标记：整篇作为唯一最小单元挂在 root 下（短篇常见）。
    const unitId = "u1";
    dna.nodes[unitId] = {
      id: unitId,
      levelType: "unit",
      index: 1,
      title: input.title,
      parent: root.id,
      children: [],
      sourceRange: { start: 0, end: input.text.length },
    };
    root.children.push(unitId);
    return finalizeStructure(dna);
  }

  // 维护一个"层级深度 → 最近节点 id"的栈，遇到更浅/同级标记时回退。
  const lastByDepth = new Map<number, string>();
  lastByDepth.set(LEVEL_DEPTH.complete, root.id);
  const counters = new Map<string, number>(); // parentId → 子序号计数
  // 按文档顺序记录 {id, depth, offset}，用于回填 sourceRange。
  const ordered: Array<{ id: string; depth: number; offset: number }> = [];

  for (const m of markers) {
    const depth = LEVEL_DEPTH[m.levelType];
    // 父级 = 比当前浅的最近节点
    let parentId = root.id;
    for (let d = depth - 1; d >= 0; d--) {
      const cand = lastByDepth.get(d);
      if (cand) { parentId = cand; break; }
    }
    const seq = (counters.get(parentId) ?? 0) + 1;
    counters.set(parentId, seq);
    const id = `${m.levelType[0]}${Object.keys(dna.nodes).length}`;
    // 序号（§3.1）：优先用标记里写明的真实叙事序号（第八章→8），无则回退位置计数。
    const realNum = extractUnitNumber(m.title, input.media_type);
    const node: HierarchyNode = {
      id,
      levelType: m.levelType,
      index: realNum ?? seq,
      title: m.title,
      parent: parentId,
      children: [],
      sourceRange: { start: m.offset, end: input.text.length },
    };
    dna.nodes[id] = node;
    dna.nodes[parentId].children.push(id);
    ordered.push({ id, depth, offset: m.offset });
    lastByDepth.set(depth, id);
    // 清除更深层栈（新分支开始）
    for (let d = depth + 1; d <= LEVEL_DEPTH.unit; d++) lastByDepth.delete(d);
  }

  // 回填每个节点的 sourceRange.end：下一个"深度 ≤ 本节点深度"的标记 offset（否则到文末）。
  for (let i = 0; i < ordered.length; i++) {
    const cur = ordered[i];
    let end = input.text.length;
    for (let j = i + 1; j < ordered.length; j++) {
      if (ordered[j].depth <= cur.depth) { end = ordered[j].offset; break; }
    }
    dna.nodes[cur.id].sourceRange = { start: cur.offset, end };
  }

  annotateChildRanges(dna);
  return finalizeStructure(dna);
}

// ─────────────────────────────────────────────────────────────────
// 多文件/卷目录建树（§3.2）——保留文件与目录边界（迁移自 v6 文件结构感知，改造为 TS）
// ─────────────────────────────────────────────────────────────────

/** 单个文件段（解压后保留相对路径，offset 与 concat 全文对齐）。 */
export interface FileSegment {
  /** 文件相对路径（可含目录，如 "卷一/第03章.txt"）。 */
  path: string;
  /** 在 concat 全文中的起始字符偏移。 */
  offset: number;
  /** 该文件正文。 */
  text: string;
}

/**
 * 由文本项构建与 `concatTextFiles` 对齐的全文 + 文件段（同序、同 "\n\n" 分隔、同空过滤）。
 * 保证 segment.offset 可直接用于在返回的 fullText 上 slice，sourceRange 回链可信。
 */
export function segmentsFromTexts(
  items: Array<{ path: string; text: string }>,
): { segments: FileSegment[]; fullText: string } {
  const kept = items.filter((i) => i.text.trim().length > 0);
  const segments: FileSegment[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i].text;
    segments.push({ path: kept[i].path, offset, text: t });
    parts.push(t);
    offset += t.length + (i < kept.length - 1 ? 2 : 0); // join("\n\n")
  }
  return { segments, fullText: parts.join("\n\n") };
}

/** 从文件基名推断层级类型（卷/部→part，章/回→chapter，节/话→unit；否则 undefined）。 */
function levelFromName(name: string): HierarchyLevelType | undefined {
  for (const { re, levelType } of CN_LEVEL_PATTERNS) {
    if (re.test(name)) return levelType;
  }
  return undefined;
}

/** 拆出相对路径的目录段（不含文件名），过滤空段与 "." 。 */
function dirParts(p: string): string[] {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return [];
  return norm.slice(0, idx).split("/").map((s) => s.trim()).filter((s) => s && s !== ".");
}

/** 取文件基名（去目录、去扩展名）。 */
function baseName(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const last = norm.slice(norm.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(0, dot) : last;
}

/**
 * 是否存在"目录/编号文件"结构（决定是否走多文件建树）：任一段含目录、或文件名命中卷/章/节模式。
 * 仅在此类输入下启用多文件建树（其余多文件场景沿用 concat 扫标记，零回归）。
 */
export function segmentsHaveStructure(segments: FileSegment[]): boolean {
  // 多文件 = 天然以"文件"为最小叙事单元边界（看结构不看名字，§3.1）：每个文件就是一个节。
  if (segments.length >= 2) return true;
  // 单文件：仅当路径含目录或文件名命中层级词时按文件边界建树；否则交由 buildLightHierarchy 扫内部标记。
  return segments.some((s) => {
    const norm = s.path.replace(/\\/g, "/");
    if (norm.includes("/")) return true;
    return levelFromName(baseName(s.path)) !== undefined;
  });
}

/** 目录名是否像真正的"部/卷/册/季"层（而非压缩包打包文件夹）。 */
const PART_DIR_RE = /第[0-9零一二三四五六七八九十百千]+[卷部册季]|^[上中下][卷部册]|^(?:卷|部|册|季)[0-9零一二三四五六七八九十]/;

/**
 * 计算所有文件共有的最外层目录前缀段数 —— 压缩包打包容器（含自我嵌套，如
 * `蛊真人_测试/蛊真人_测试/`）。逐层比对，所有文件同名才算共有 → 整体剥离，不计入叙事层级。
 */
function commonDirPrefixDepth(allDirSegs: string[][]): number {
  if (allDirSegs.length === 0) return 0;
  let depth = 0;
  for (;;) {
    const head = allDirSegs[0][depth];
    if (head === undefined) break;
    if (!allDirSegs.every((d) => d[depth] === head)) break;
    depth++;
  }
  return depth;
}

/**
 * 多文件 / 卷目录建树（§3.2 核心，"看结构不看名字" §3.1）——保留文件边界，但只把**真正的多卷结构**
 * 升级为 部/卷 层，其余打包/单链目录一律折叠；每个文件默认就是一个最小叙事单元(节)，
 * 仅"一文多节的大文件"（≥2 内层标记且体量 > MAX_UNIT_CHARS）才作为 chapter 容器内拆为 unit。
 *
 * 规则：
 *   ① 剥离所有文件共有的最外层包裹目录（压缩包容器，含自嵌套），不计入叙事层级；
 *   ② 余下目录：仅当目录名像 卷/部/册/季，或同一父级下存在 ≥2 个并列子目录（真多卷）时升级为 part；
 *      否则折叠（不建节点，文件直接挂到当前父级）；
 *   ③ 文件 → 默认 unit(节)；含 ≥2 内层标记且体量 > MAX_UNIT_CHARS 时才升 chapter 并内拆 unit。
 * sourceRange 用 segment.offset + 文件内局部偏移回填，可直接在 concat 全文上切片。
 */
export function buildHierarchyFromSegments(
  input: { story_timestamp: StoryTimestamp; title: string; media_type: IpMediaType },
  segments: FileSegment[],
): NarrativeIpDna {
  const dna = createEmptyIpDna({
    story_id: input.story_timestamp,
    title: input.title,
    media_type: input.media_type,
  });
  const root = dna.nodes[dna.rootId];
  const counters = new Map<string, number>(); // parentId → 子序号
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}${++seq}`;
  const childSeq = (parentId: string): number => {
    const n = (counters.get(parentId) ?? 0) + 1;
    counters.set(parentId, n);
    return n;
  };

  // ① 剥离共有最外层打包目录（含自嵌套）。
  const rawDirSegs = segments.map((s) => dirParts(s.path));
  const strip = commonDirPrefixDepth(rawDirSegs);
  const dirSegsList = rawDirSegs.map((d) => d.slice(strip));

  // ①b 真实叙事序号提取（§3.1：第八章→8，而非上传位置）+ 同目录同号去重（保留末次，剔除复制的重复同号单元）。
  //     移植 chapter_parsing._parse_chapters 的 chapter_dict 去重语义；号未识别者永不去重（回退位置计数）。
  const unitNums = segments.map((s) => extractUnitNumber(baseName(s.path), input.media_type));
  const lastByDirNum = new Map<string, number>();
  segments.forEach((_, i) => {
    const n = unitNums[i];
    if (n !== undefined) lastByDirNum.set(`${dirSegsList[i].join("/")}#${n}`, i);
  });
  const keepFile = (i: number): boolean => {
    const n = unitNums[i];
    if (n === undefined) return true; // 无可识别序号 → 保留（走位置计数）
    return lastByDirNum.get(`${dirSegsList[i].join("/")}#${n}`) === i; // 同目录同号仅留末次
  };

  // ② 预统计每个父级下并列子目录数，判定某层是否"真多卷" → 升级 part。
  const childDirs = new Map<string, Set<string>>();
  for (const segs of dirSegsList) {
    let acc = "";
    for (const part of segs) {
      const parent = acc;
      if (!childDirs.has(parent)) childDirs.set(parent, new Set());
      childDirs.get(parent)!.add(part);
      acc = acc ? `${acc}/${part}` : part;
    }
  }
  const keepAsPart = (parentAcc: string, name: string): boolean =>
    PART_DIR_RE.test(name) || (childDirs.get(parentAcc)?.size ?? 0) >= 2;

  const partByKey = new Map<string, string>(); // 累积目录路径 → part 节点 id

  for (let si = 0; si < segments.length; si++) {
    if (!keepFile(si)) {
      // P2：同号折叠告警——异标题同号被丢弃时提示（去重逻辑保留不改；便于用户察觉合法异章被误折叠）。
      const dn = unitNums[si];
      const keptIdx = dn !== undefined ? lastByDirNum.get(`${dirSegsList[si].join("/")}#${dn}`) : undefined;
      if (keptIdx !== undefined && keptIdx !== si) {
        const droppedTitle = baseName(segments[si].path);
        const keptTitle = baseName(segments[keptIdx].path);
        if (droppedTitle !== keptTitle) {
          console.warn(
            `[ip-dna] 同号折叠：丢弃「${droppedTitle}」保留「${keptTitle}」(序号 ${dn})——若二者为不同合法章节，请错开序号或分卷目录。`,
          );
        }
      }
      continue; // 同目录同号重复单元：仅保留末次出现。
    }
    const seg = segments[si];
    let parentId = root.id;
    let accFull = "";
    // 目录层 → 仅真多卷升级 part，其余折叠。
    for (const part of dirSegsList[si]) {
      const parentAcc = accFull;
      accFull = accFull ? `${accFull}/${part}` : part;
      if (!keepAsPart(parentAcc, part)) continue;
      let pid = partByKey.get(accFull);
      if (!pid) {
        pid = nextId("p");
        dna.nodes[pid] = {
          id: pid,
          levelType: "part",
          index: childSeq(parentId),
          title: part,
          parent: parentId,
          children: [],
        };
        dna.nodes[parentId].children.push(pid);
        partByKey.set(accFull, pid);
      }
      parentId = pid;
    }

    // ③ 文件节点：默认 unit(节)，看结构不看名字（文件名只决定标题）；
    //    仅"一文多节大文件"（≥2 内层标记且超单元水准线）才作 chapter 容器并内拆 unit。
    const base = baseName(seg.path) || `文件${si + 1}`;
    const innerMarkers = detectHierarchyMarkers(seg.text);
    const isContainer = innerMarkers.length >= 2 && seg.text.length > MAX_UNIT_CHARS;
    const fileLevel: HierarchyLevelType = isContainer ? "chapter" : "unit";
    const fileId = nextId(fileLevel[0]);
    // 序号（§3.1）：优先用文件名里写明的真实叙事序号（第八章→8），无则回退同父位置计数。
    const realNum = unitNums[si];
    dna.nodes[fileId] = {
      id: fileId,
      levelType: fileLevel,
      index: realNum ?? childSeq(parentId),
      title: base,
      parent: parentId,
      children: [],
      sourceRange: { start: seg.offset, end: seg.offset + seg.text.length },
    };
    dna.nodes[parentId].children.push(fileId);

    if (isContainer) {
      for (let i = 0; i < innerMarkers.length; i++) {
        const m = innerMarkers[i];
        const start = seg.offset + m.offset;
        const end = i + 1 < innerMarkers.length ? seg.offset + innerMarkers[i + 1].offset : seg.offset + seg.text.length;
        const uid = nextId("u");
        dna.nodes[uid] = {
          id: uid,
          levelType: "unit",
          index: childSeq(fileId),
          title: m.title,
          parent: fileId,
          children: [],
          sourceRange: { start, end },
        };
        dna.nodes[fileId].children.push(uid);
      }
    }
  }

  if (root.children.length === 0) {
    // 全空兜底：整体一个最小单元。
    dna.nodes["u1"] = { id: "u1", levelType: "unit", index: 1, title: input.title, parent: root.id, children: [] };
    root.children.push("u1");
  }

  annotateChildRanges(dna);
  return finalizeStructure(dna);
}

// ─────────────────────────────────────────────────────────────────
// 单元正文切片：供 Phase2 scoped 提取按最小单元喂正文
// ─────────────────────────────────────────────────────────────────

/** 收集所有叶子（最小单元）节点 id（文档顺序）。 */
export function collectLeafIds(dna: NarrativeIpDna): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    const node = dna.nodes[id];
    if (!node) return;
    if (node.children.length === 0) {
      if (id !== dna.rootId) out.push(id);
      return;
    }
    const sorted = [...node.children].sort((a, b) => dna.nodes[a].index - dna.nodes[b].index);
    for (const c of sorted) walk(c);
  };
  walk(dna.rootId);
  return out;
}

/**
 * 按 sourceRange 把标准化全文切成"叶子节点 id → 正文"映射（确定性）。
 * 没有 sourceRange 的节点回退为空串（由 LLM seam 另行处理）。
 */
export function sliceUnitTexts(dna: NarrativeIpDna, fullText: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of collectLeafIds(dna)) {
    const r = dna.nodes[id].sourceRange;
    map.set(id, r ? fullText.slice(r.start, r.end).trim() : "");
  }
  return map;
}

/** 取某节点（含其子树）覆盖的原文切片，用于改编范围内的忠实参考。 */
export function sliceSubtreeText(dna: NarrativeIpDna, nodeId: string, fullText: string): string {
  const node = dna.nodes[nodeId];
  if (!node) return "";
  if (node.sourceRange) return fullText.slice(node.sourceRange.start, node.sourceRange.end).trim();
  // 无范围则拼接叶子
  const leaves = collectLeafIds(dna).filter((id) => isDescendant(dna, id, nodeId));
  return leaves.map((id) => {
    const r = dna.nodes[id].sourceRange;
    return r ? fullText.slice(r.start, r.end) : "";
  }).join("\n").trim();
}

function isDescendant(dna: NarrativeIpDna, id: string, ancestorId: string): boolean {
  let cur: string | null = id;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = dna.nodes[cur]?.parent ?? null;
  }
  return false;
}

/** 给有子节点的节点标注 childRange（如 "第1-12节"）。 */
function annotateChildRanges(dna: NarrativeIpDna): void {
  for (const node of Object.values(dna.nodes)) {
    if (node.children.length === 0) continue;
    const childIdx = node.children.map((c) => dna.nodes[c].index);
    const min = Math.min(...childIdx);
    const max = Math.max(...childIdx);
    node.childRange = min === max ? `${min}` : `${min}-${max}`;
  }
}

// ─────────────────────────────────────────────────────────────────
// 结构类型 + 聚合次数（迁移自 v6 structure_type / aggregation_times，改造对齐四层抽象，§3.2/§3.3）
// ─────────────────────────────────────────────────────────────────

/** 树的最大深度（root=0，其直接子节点=1）。 */
export function treeMaxDepth(dna: NarrativeIpDna): number {
  let max = 0;
  const walk = (id: string, depth: number): void => {
    const node = dna.nodes[id];
    if (!node) return;
    if (id !== dna.rootId) max = Math.max(max, depth);
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(dna.rootId, 0);
  return max;
}

/**
 * 确定性判定层级结构类型（§3.2）：据树形深度 + 叶子数。
 * single_file（无结构整体一单元）/ single_layer（root→叶子一层）/ two_layer / three_layer。
 */
export function classifyStructureType(dna: NarrativeIpDna): HierarchyStructureType {
  const depth = treeMaxDepth(dna);
  const leaves = collectLeafIds(dna);
  if (leaves.length <= 1 && depth <= 1) return "single_file";
  if (depth <= 1) return "single_layer";
  if (depth === 2) return "two_layer";
  return "three_layer";
}

/**
 * 逐层聚合次数（§3.3）= 中间层数 = 树最大深度（最少 1）。
 * 驱动 Phase2 后序逐层聚合的轮数（single_layer=1、two_layer=2、three_layer=3）。
 */
export function computeAggregationTimes(dna: NarrativeIpDna): number {
  return Math.max(1, treeMaxDepth(dna));
}

/**
 * 锚定最小叙事单元的"对外展示名 + 完整嵌套链"（§3.1）——在每个建树出口单点计算，零遗漏。
 * - displayName：非根 = `序号_《原始标题》`（如 `1_《第一章》`）；root = `《题目》`。
 * - lineage：根→自身的完整嵌套层级链（内部运行/定位用）。
 */
function annotateDisplayAndLineage(dna: NarrativeIpDna): void {
  // ① 先算所有节点的 displayName（lineage 需要引用各祖先的 displayName）。
  for (const node of Object.values(dna.nodes)) {
    node.displayName =
      node.id === dna.rootId ? `《${node.title}》` : `${node.index}_《${node.title}》`;
  }
  // ② 沿 parent 链回填 root→自身的完整链。
  for (const node of Object.values(dna.nodes)) {
    const chain: NonNullable<HierarchyNode["lineage"]> = [];
    let cur: string | null = node.id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const anc: HierarchyNode | undefined = dna.nodes[cur];
      if (!anc) break;
      chain.unshift({ id: anc.id, levelType: anc.levelType, index: anc.index, displayName: anc.displayName ?? anc.title });
      cur = anc.parent;
    }
    node.lineage = chain;
  }
}

/** 落定结构元信息（在每个建树出口调用）：写入 structureType + aggregationTimes + 展示名/链。 */
function finalizeStructure(dna: NarrativeIpDna): NarrativeIpDna {
  sortChildrenByIndex(dna); // P2：children 按叙事序号排序，使 _hierarchy.json/前端展示为叙事序（喂料侧 collectLeafIds 本已排序）。
  dna.structureType = classifyStructureType(dna);
  dna.aggregationTimes = computeAggregationTimes(dna);
  annotateDisplayAndLineage(dna);
  return dna;
}

/** P2：每个节点 children 按 index（叙事序号）升序——修 _hierarchy.json 展示乱序（物理上传/拼接序）。 */
function sortChildrenByIndex(dna: NarrativeIpDna): void {
  for (const node of Object.values(dna.nodes)) {
    if (node.children.length > 1) {
      node.children.sort((a, b) => (dna.nodes[a]?.index ?? 0) - (dna.nodes[b]?.index ?? 0));
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// 体量水准线判断 + 拆解决策
// ─────────────────────────────────────────────────────────────────

export interface VolumeAssessment {
  charCount: number;
  isShort: boolean;
  /**
   * 整部体量超"单游戏单元水准线"（单元数 + 体量双维）。语义＝"这部够大、应切成多个游戏单元(系列)"，
   * 是游戏单元规划的默认依据，**不代表存在无法处理的超大文件**（勿据此弹"拆解"问题）。
   */
  needsDecompose: boolean;
  /** 建议拆解块数（按阈值整除向上取整）。 */
  suggestedChunks: number;
  /** 命中的水准线说明（可读，含命中维度）。 */
  thresholdBasis: string;
  /**
   * 真·超大最小单元（叶子）数量：单个叶子正文 > MAX_UNIT_CHARS，提取/生成会失真，需"再标准化/拆解"。
   * 这才是"发现超大文件，是否进一步拆解"问题的唯一触发依据（=0 时该问题不出现）。
   */
  oversizedUnitCount: number;
}

/**
 * 统计层级树中"真·超大最小单元"数量 —— 判断对象是【最小叙事单元(叶子=节/话/集/情节点)】本身，
 * 不是整部作品、也不是单张图/单个物理文件（§3.1/§5.0）：单个叶子的 sourceRange 跨度 > maxUnitChars。
 *
 * 媒体量纲：文字按字数（此处实现）；漫画按"话内页数"、视频按时长 —— 蓝图标注较难/留接口，
 * 标准化阶段图片/视频叶子无 sourceRange、恒计 0（不弹"再标准化"，符合 §5.0）。
 * 与 needsDecompose（整部体量、系列化判断）正交——已切成众多小章节的长篇此值为 0（70 话小说不误报）。
 */
export function countOversizedUnits(dna: NarrativeIpDna, maxUnitChars = MAX_UNIT_CHARS): number {
  return collectLeafIds(dna).filter((id) => {
    const r = dna.nodes[id]?.sourceRange;
    return !!r && r.end - r.start > maxUnitChars;
  }).length;
}

/** 单次处理体量上限（字符）；无媒体维度信息时的字数兜底水准线（§7.1）。 */
export const DECOMPOSE_THRESHOLD = 80_000;

/**
 * 多维体量水准线（§7.1）——按媒体类型用不同维度判定"是否大到需拆解/多游戏单元化"：
 *   - 小说(book)：最小单元数 > 25 且 字数 > 25k；
 *   - 漫画(picture)：话数 > 25 且 页数 > 500；
 *   - 视频(video)：时长 > 5h；
 *   - 其它/未知：字数 > 80k 兜底。
 */
export const VOLUME_THRESHOLDS = {
  novelUnits: 25,
  novelChars: 25_000,
  comicUnits: 25,
  comicPages: 500,
  videoSeconds: 5 * 3600,
  fallbackChars: DECOMPOSE_THRESHOLD,
} as const;

/** 多维体量评估的辅助维度（缺省维度按 0 处理，回退字数兜底线）。 */
export interface VolumeAssessmentInput {
  mediaType?: IpMediaType;
  /** 最小单元数（节/话/集）——通常取层级树叶子数。 */
  unitCount?: number;
  /** 漫画页数。 */
  pageCount?: number;
  /** 视频总时长（秒）。 */
  durationSec?: number;
}

/**
 * 多维体量水准线评估（§7.1）。提供媒体维度时按对应水准线判定，否则回退字数兜底线。
 * 替代旧的单一 80k 字阈值；调用方按 media_type 传入 unitCount/pageCount/durationSec。
 */
export function assessVolume(text: string, input: VolumeAssessmentInput = {}): VolumeAssessment {
  const charCount = text.length;
  const { mediaType, unitCount = 0, pageCount = 0, durationSec = 0 } = input;
  const T = VOLUME_THRESHOLDS;

  let needsDecompose: boolean;
  let thresholdBasis: string;
  switch (mediaType) {
    case "book":
      needsDecompose = unitCount > T.novelUnits && charCount > T.novelChars;
      thresholdBasis = `小说水准线(单元>${T.novelUnits} 且 字数>${T.novelChars})：单元=${unitCount}、字数=${charCount}`;
      break;
    case "picture":
      needsDecompose = unitCount > T.comicUnits && pageCount > T.comicPages;
      thresholdBasis = `漫画水准线(话>${T.comicUnits} 且 页>${T.comicPages})：话=${unitCount}、页=${pageCount}`;
      break;
    case "video":
      needsDecompose = durationSec > T.videoSeconds;
      thresholdBasis = `视频水准线(时长>${T.videoSeconds}s)：时长=${durationSec}s`;
      break;
    default:
      needsDecompose = charCount > T.fallbackChars;
      thresholdBasis = `字数兜底水准线(>${T.fallbackChars})：字数=${charCount}`;
  }

  return {
    charCount,
    isShort: charCount > 0 && charCount < SHORT_TEXT_THRESHOLD,
    needsDecompose,
    suggestedChunks: needsDecompose ? Math.max(2, Math.ceil(charCount / DECOMPOSE_THRESHOLD)) : 1,
    thresholdBasis,
    oversizedUnitCount: 0, // 无层级树信息时占位；编排器据 dna 用 countOversizedUnits 回填真值
  };
}

/**
 * 按层级标记边界把超体量文本拆成块（格式相关拆解；优先在 part/chapter 边界切）。
 * 返回每块 {title, text}，供 Phase2 scoped 提取分块处理。
 */
export function decomposeByMarkers(text: string, maxCharsPerChunk = DECOMPOSE_THRESHOLD): Array<{ title: string; text: string }> {
  const markers = detectHierarchyMarkers(text);
  // 仅按 part / chapter 边界切（硬/软区间），避免把最小单元打散。
  const cutPoints = markers.filter((m) => m.levelType === "part" || m.levelType === "chapter");
  if (cutPoints.length === 0) {
    return chunkByLength(text, maxCharsPerChunk).map((t, i) => ({ title: `块${i + 1}`, text: t }));
  }
  const chunks: Array<{ title: string; text: string }> = [];
  for (let i = 0; i < cutPoints.length; i++) {
    const start = cutPoints[i].offset;
    const end = i + 1 < cutPoints.length ? cutPoints[i + 1].offset : text.length;
    chunks.push({ title: cutPoints[i].title, text: text.slice(start, end) });
  }
  return chunks;
}

function chunkByLength(text: string, maxLen: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) out.push(text.slice(i, i + maxLen));
  return out;
}

/** 拆解计划（确定性决策产物）。 */
export interface DecompositionPlan {
  /** 是否真正拆成多块（超体量 + 允许拆解 + 拆出 >1 块）。 */
  decomposed: boolean;
  /** 拆解后的块（未拆解时为整篇单块）。 */
  chunks: Array<{ title: string; text: string }>;
}

/**
 * 拆解闭环决策（确定性）：超体量且 enabled 时按标记边界拆块（有目录走 decomposeByMarkers），
 * 否则整篇单块。默认 enabled=false → 不拆（保持轻量层级树整篇处理）。
 */
export function planDecomposition(
  fullText: string,
  volume: VolumeAssessment,
  enabled: boolean,
): DecompositionPlan {
  if (!enabled || !volume.needsDecompose) {
    return { decomposed: false, chunks: [{ title: "整篇", text: fullText }] };
  }
  const chunks = decomposeByMarkers(fullText);
  return { decomposed: chunks.length > 1, chunks };
}

/** 单个最小叙事单元的字符上限（拆解闭环用）：超此则进一步切分，避免巨型不可处理单元（§5.0）。 */
export const MAX_UNIT_CHARS = 12_000;

/** 拆解闭环结果。 */
export interface DecompositionClosureResult {
  /** 实际执行的迭代轮次（0 = 无超线单元，未触发）。 */
  iterations: number;
  /** 本次闭环新拆出的子单元总数。 */
  splitUnits: number;
  /** 闭环结束后是否仍有超线单元（达三次上限仍未拆净，按现状输出，§5.0）。 */
  residualOversize: boolean;
}

/**
 * 拆解闭环再标准化（§5.0 流程图 9→10→1）——把已建层级树中"超线的最小叙事单元"按体量
 * 进一步切成子单元（再标准化），反复直至无超线单元或达 maxIterations（三次上限防死循环）。
 *
 * 与 planDecomposition 的分工：planDecomposition 在"文件级"按 part/chapter 标记决定是否拆块；
 * 本函数在"单元级"补齐闭环——即便标记切完后仍有巨型叶子（如某章 5 万字、或无标记散文整篇成一节），
 * 也会被切成可独立提取的子单元，喂给 Phase2 scoped 提取，避免单元过大导致提取/生成失真。
 *
 * 确定性、原地修改 dna：超线叶子升级为 chapter，其下挂等分的 unit 子节点（按 sourceRange 等分）。
 */
export function applyDecompositionClosure(
  dna: NarrativeIpDna,
  fullText: string,
  enabled: boolean,
  maxIterations = 3,
  maxUnitChars = MAX_UNIT_CHARS,
): DecompositionClosureResult {
  if (!enabled) return { iterations: 0, splitUnits: 0, residualOversize: false };

  let iterations = 0;
  let splitUnits = 0;

  while (iterations < maxIterations) {
    const oversized = collectLeafIds(dna).filter((id) => {
      const r = dna.nodes[id]?.sourceRange;
      return !!r && r.end - r.start > maxUnitChars;
    });
    if (oversized.length === 0) break;
    iterations++;

    for (const leafId of oversized) {
      const leaf = dna.nodes[leafId];
      const r = leaf.sourceRange!;
      const span = r.end - r.start;
      const parts = Math.max(2, Math.ceil(span / maxUnitChars));
      const step = Math.ceil(span / parts);
      // 叶子升级为 chapter，原 sourceRange 保留（覆盖整段，供子树切片）。
      leaf.levelType = leaf.levelType === "unit" ? "chapter" : leaf.levelType;
      for (let i = 0; i < parts; i++) {
        const start = r.start + i * step;
        const end = i === parts - 1 ? r.end : Math.min(r.end, r.start + (i + 1) * step);
        if (start >= end) continue;
        const childId = `${leafId}_d${i + 1}`;
        dna.nodes[childId] = {
          id: childId,
          levelType: "unit",
          index: i + 1,
          title: `${leaf.title}·${i + 1}`,
          parent: leafId,
          children: [],
          sourceRange: { start, end },
        };
        leaf.children.push(childId);
        splitUnits++;
      }
    }
  }

  // 仍有超线单元（达上限）→ 标记残留，按现状输出（§5.0 三次拆不完直接输出现状）。
  const residualOversize = collectLeafIds(dna).some((id) => {
    const r = dna.nodes[id]?.sourceRange;
    return !!r && r.end - r.start > maxUnitChars;
  });
  return { iterations, splitUnits, residualOversize };
}

/**
 * 无目录散文的 LLM 结构推断 + 再标准化（带三次上限防死循环，§7.1）：
 * 反复调用 inferStructureWithLLM 直到拆出 >1 个最小单元或达上限，避免把超长散文当作单一单元。
 */
export async function inferStructureWithRetry(
  llm: LLMClient,
  input: BuildHierarchyInput,
  maxIterations = 3,
): Promise<{ dna: NarrativeIpDna; iterations: number }> {
  let dna = await inferStructureWithLLM(llm, input);
  let iterations = 1;
  while (collectLeafIds(dna).length <= 1 && iterations < maxIterations) {
    dna = await inferStructureWithLLM(llm, input);
    iterations++;
  }
  return { dna, iterations };
}

/** 由层级树推断已识别的层级类型清单（guessed_levels，文档顺序去重，排除 complete 根）。 */
export function guessLevelsFromHierarchy(dna: NarrativeIpDna): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const node of Object.values(dna.nodes)) {
    if (node.levelType === "complete") continue;
    if (!seen.has(node.levelType)) {
      seen.add(node.levelType);
      order.push(node.levelType);
    }
  }
  // 按层级深度排序，保证 part→chapter→unit 稳定顺序。
  return order.sort((a, b) => LEVEL_DEPTH[a as HierarchyLevelType] - LEVEL_DEPTH[b as HierarchyLevelType]);
}

// ─────────────────────────────────────────────────────────────────
// LLM 结构推断兜底（散文无显式标记时）
// ─────────────────────────────────────────────────────────────────

const STRUCTURE_INFER_SYSTEM = loadIpDnaPrompt(
  "structure-infer",
  `你是叙事结构分析助手。判断无显式标记文本的自然叙事层级并切分最小单元。仅输出 JSON：{"units":[{"index":1,"title":"...","summary":"..."}]}。不改写原文。`,
);

/** 散文 LLM 结构推断（seam）：标记缺失时调用，产出最小单元清单挂到 root。 */
export async function inferStructureWithLLM(
  llm: LLMClient,
  input: BuildHierarchyInput,
): Promise<NarrativeIpDna> {
  const dna = createEmptyIpDna({
    story_id: input.story_timestamp,
    title: input.title,
    media_type: input.media_type,
  });
  const root = dna.nodes[dna.rootId];
  const raw = await llm.callWithRetry(
    STRUCTURE_INFER_SYSTEM,
    input.text.slice(0, DECOMPOSE_THRESHOLD),
    { responseFormat: "json", temperature: 0.2 },
  );
  const parsed = parseJSON<{ units?: Array<{ index?: number; title?: string }> }>(raw);
  const units = parsed.units ?? [];
  units.forEach((u, i) => {
    const id = `u${i + 1}`;
    dna.nodes[id] = {
      id,
      levelType: "unit",
      index: u.index ?? i + 1,
      title: u.title ?? `单元${i + 1}`,
      parent: root.id,
      children: [],
    };
    root.children.push(id);
  });
  if (root.children.length === 0) {
    dna.nodes["u1"] = { id: "u1", levelType: "unit", index: 1, title: input.title, parent: root.id, children: [] };
    root.children.push("u1");
  }
  annotateChildRanges(dna);
  return finalizeStructure(dna);
}
