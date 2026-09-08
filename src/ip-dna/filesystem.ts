/**
 * 文件系统布局（Filesystem Layout）—— 蓝图 §6.1「媒体优先 input 目录」/ §14.2 D4-D5 的可执行实现。
 *
 * 输入侧 = 媒体优先（book_default）：媒体类型在最顶层、阶段其次、<run> 在叶子。
 *
 *   input/package/<run>/<archive>                            压缩包本体专门目录（原样保留）
 *   input/book/story_book/book_original/<run>/...            文字原始件（含解压成员，保留相对路径）
 *   input/book/story_book/book_processing/<run>/...          标准化（standardized.txt + <最小叙事单元>/content.md）
 *   input/book/story_book/book_extraction_output/<run>/      统一：_hierarchy.json + <node>/三件套 + 指令/确认/清单
 *   input/picture/story_picture/picture_{original,compress,processing,extraction_output}/<run>/
 *   input/video/story_video/video_{original,compress,processing,extraction_output}/<run>/
 *
 * 主媒体（primaryFamilyOf）：统一层级树/三件套/指令/清单/standardized.txt 落主媒体家族
 * （book/mixed→book、picture/comic→picture、video→video）；原始件按各自模态分家。
 * 读取侧无 media_type 时按 book→picture→video + legacy 兜底解析（resolveStageDir）。
 *
 *   output/<run>/                    （输出侧，生成产物；本次不迁移，保持原约定）
 *     ├─ <序号>_<名>.<ext> / game_unit_N.json
 *     ├─ 算子方案/<节点>_operator_solution.json
 *     └─ manifest.json / _long_memory_ledger.json
 *
 * <run> = <时间戳>_<故事名>，input 与 output 同名即关联同一完整故事（§6.0）。
 * 层级树支持按层分文件懒加载（§14.2 D4）：层级树本身是索引，三件套按节点目录存放。
 * legacy（run 优先 input/<run>/{_original,_processing,_extraction_output}）仅读取兜底，不再写入。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  NarrativeIpDna,
  HierarchyNode,
  NarrativeTemplate,
  NarrativeOperator,
  NodeMetadata,
  OperatorSolution,
  StoryTimestamp,
  UserAssetManifest,
  IpMediaType,
} from "../types/narrative-ip-dna.js";
import { NARRATIVE_IP_DNA_SCHEMA_VERSION, migrateIpDnaSchema } from "../types/narrative-ip-dna.js";

/** 三件套文件名（每层每文件夹必有）。 */
export const TRIAD_FILES = {
  template: "template.json",
  operators: "operators.json",
  metadata: "metadata.json",
} as const;

/** 层级树索引文件名（懒加载时只读这个，节点正文按需读）。 */
export const HIERARCHY_INDEX_FILE = "_hierarchy.json";

/** 用户资产参考清单文件名（§6.2，落在 input 运行目录根）。 */
export const USER_ASSET_MANIFEST_FILE = "user_asset_manifest.json";

/** 文件名安全化（与 server.ts savePerNodeFiles 同款规则）。 */
export function safeName(raw: string): string {
  return String(raw).replace(/[/\\?%*:|"<>]/g, "_");
}

/** 输入/输出共用的"运行名"：<时间戳>_<故事名>。 */
export function runName(timestamp: StoryTimestamp, title: string): string {
  const safeTitle = safeName(title || "untitled");
  return `${timestamp}_${safeTitle}`;
}

export interface LayoutRoots {
  /** 进程根（默认 process.cwd()）。 */
  cwd?: string;
}

function resolveCwd(roots?: LayoutRoots): string {
  return roots?.cwd ?? process.cwd();
}

// ─────────────────────────────────────────────────────────────────
// 媒体优先布局（§6.1）：input/<媒体>/story_<媒体>/<媒体>_<阶段>/<run>/
// ─────────────────────────────────────────────────────────────────

/** 媒体家族键（落盘三大家族）。 */
export type MediaFamilyKey = "book" | "picture" | "video";

/** 输入模态（§2）；映射自 modalityOf 的 text/image/video。 */
export type InputModality = "text" | "image" | "video";

/** 模态 → 媒体家族（text→book、image→picture、video→video）。 */
export function familyOfModality(m: InputModality): MediaFamilyKey {
  return m === "image" ? "picture" : m === "video" ? "video" : "book";
}

/**
 * IpMediaType → 主媒体家族：统一层级树/三件套/指令/清单/standardized.txt 的落点（book_default）。
 * mixed/book→book（文字优先）、picture/comic→picture、video→video。
 */
export function primaryFamilyOf(media: IpMediaType): MediaFamilyKey {
  switch (media) {
    case "picture":
    case "comic":
      return "picture";
    case "video":
      return "video";
    default:
      return "book"; // book / mixed
  }
}

/**
 * 各媒体家族的目录布局（§6.1）：家族路径段 + 阶段目录前缀。
 * 阶段目录前缀统一用家族键（book/picture/video），不再带 story_ 冗余前缀，落点形如：
 *   input/book/story_book/book_{original,processing,extraction_output}/<run>/
 *   input/picture/story_picture/picture_{...}/<run>/
 *   input/video/story_video/video_{...}/<run>/
 */
const FAMILY_LAYOUT: Record<MediaFamilyKey, { family: readonly string[]; prefix: string }> = {
  book: { family: ["book", "story_book"], prefix: "book" },
  picture: { family: ["picture", "story_picture"], prefix: "picture" },
  video: { family: ["video", "story_video"], prefix: "video" },
};

const ALL_FAMILIES: readonly MediaFamilyKey[] = ["book", "picture", "video"];

type LayoutStage = "original" | "compress" | "processing" | "extraction_output";

/** 媒体优先某家族某阶段的运行目录：input/<媒体>/story_<媒体>/<前缀>_<阶段>/<run>/。 */
function familyStageDir(cwd: string, family: MediaFamilyKey, stage: LayoutStage, run: string): string {
  const { family: fam, prefix } = FAMILY_LAYOUT[family];
  return path.join(cwd, "input", ...fam, `${prefix}_${stage}`, run);
}

/** legacy（run 优先）阶段目录：input/<run>/{_original|_processing|_extraction_output|_processing/_compress}。 */
function legacyStageDir(cwd: string, stage: LayoutStage, run: string): string {
  switch (stage) {
    case "original":
      return path.join(cwd, "input", run, "_original");
    case "processing":
      return path.join(cwd, "input", run, "_processing");
    case "compress":
      return path.join(cwd, "input", run, "_processing", "_compress");
    case "extraction_output":
      return path.join(cwd, "input", run, "_extraction_output");
  }
}

/**
 * 读取侧家族解析：在 book→picture→video 各家族 + legacy 中，找首个「含 marker 文件」的某阶段运行目录。
 * 写入侧无 media 时（如 adaptation 落盘）亦可借此定位既有 extraction 目录；找不到由调用方兜底默认 book。
 */
function resolveStageDir(
  cwd: string,
  run: string,
  stage: LayoutStage,
  marker?: string,
): string | undefined {
  const hit = (d: string): boolean => (marker ? fs.existsSync(path.join(d, marker)) : fs.existsSync(d));
  for (const fam of ALL_FAMILIES) {
    const d = familyStageDir(cwd, fam, stage, run);
    if (hit(d)) return d;
  }
  const legacy = legacyStageDir(cwd, stage, run);
  if (hit(legacy)) return legacy;
  return undefined;
}

/** 写入侧定位既有 extraction 目录（按 _hierarchy.json 标记），找不到则默认 book 主媒体（创建）。 */
function resolveExtractionDirForWrite(cwd: string, run: string): string {
  return (
    resolveStageDir(cwd, run, "extraction_output", HIERARCHY_INDEX_FILE) ??
    familyStageDir(cwd, "book", "extraction_output", run)
  );
}

// ─────────────────────────────────────────────────────────────────
// 输入侧路径（媒体优先）
// ─────────────────────────────────────────────────────────────────

/** 压缩包本体专门目录：input/package/<run>/（原样保留，标准化时再解压分家）。 */
export function packageDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(resolveCwd(roots), "input", "package", runName(timestamp, title));
}

/** 某媒体家族的原始件目录：input/<媒体>/story_<媒体>/<前缀>_original/<run>/。 */
export function mediaOriginalDir(
  timestamp: StoryTimestamp,
  title: string,
  family: MediaFamilyKey,
  roots?: LayoutRoots,
): string {
  return familyStageDir(resolveCwd(roots), family, "original", runName(timestamp, title));
}

/** 某媒体家族的压缩目录（图片/视频）：<前缀>_compress/<run>/。 */
export function compressDir(
  timestamp: StoryTimestamp,
  title: string,
  family: MediaFamilyKey,
  roots?: LayoutRoots,
): string {
  return familyStageDir(resolveCwd(roots), family, "compress", runName(timestamp, title));
}

/** 主媒体标准化目录：<主媒体前缀>_processing/<run>/（standardized.txt + <node>/content.md）。 */
export function processingDir(
  timestamp: StoryTimestamp,
  title: string,
  media: IpMediaType,
  roots?: LayoutRoots,
): string {
  return familyStageDir(resolveCwd(roots), primaryFamilyOf(media), "processing", runName(timestamp, title));
}

/**
 * 某最小叙事单元的标准化处理目录：<processing>/…/<规范名>/（每单元一目录，存 content.md）。
 * 与提取(extraction)侧共用同一套「按 lineage 嵌套 + displayName 规范名」骨架（见 nodeRelSegments），
 * 使标准化与其后各阶段的文件夹结构完全一致、镜像作品层级树，便于审阅与断点续处理（§6.1）。
 */
export function nodeProcessingDir(
  timestamp: StoryTimestamp,
  title: string,
  media: IpMediaType,
  node: Pick<HierarchyNode, "id" | "displayName" | "title" | "lineage">,
  roots?: LayoutRoots,
): string {
  return path.join(processingDir(timestamp, title, media, roots), ...nodeRelSegments(node));
}

/**
 * 落盘单个节点的标准化正文为嵌套 markdown（<processing>/…/<节点>/content.md，§6.1）。
 * 标准化产物按层级树结构镜像存放（与提取三件套同构），便于审阅与断点续处理。
 */
export function saveNodeProcessingMarkdown(
  timestamp: StoryTimestamp,
  title: string,
  media: IpMediaType,
  node: Pick<HierarchyNode, "id" | "displayName" | "title" | "lineage">,
  content: string,
  roots?: LayoutRoots,
): string {
  const dir = nodeProcessingDir(timestamp, title, media, node, roots);
  fs.mkdirSync(dir, { recursive: true });
  const heading = node.displayName ?? node.title ?? node.id;
  const file = path.join(dir, "content.md");
  fs.writeFileSync(file, `# ${heading}\n\n${content}\n`, "utf-8");
  return file;
}

/** 主媒体提取产物目录：<主媒体前缀>_extraction_output/<run>/（统一层级树/三件套/指令/清单）。 */
export function extractionOutputDir(
  timestamp: StoryTimestamp,
  title: string,
  media: IpMediaType,
  roots?: LayoutRoots,
): string {
  return familyStageDir(resolveCwd(roots), primaryFamilyOf(media), "extraction_output", runName(timestamp, title));
}

/**
 * 节点在 extraction 目录下的「嵌套相对路径段」：按 lineage(root→自身，含自身) 的规范名
 * displayName 逐层拼（如 `《题目》/1_《第一卷》/1_《第一章》`），镜像作品的层级/二层结构，
 * 便于按文件夹浏览。无 lineage（旧数据/骨架）时回退单段 displayName/title，再兜底 nodeId。
 */
function nodeRelSegments(
  node: Pick<HierarchyNode, "id" | "displayName" | "title" | "lineage">,
): string[] {
  const seg = (raw: string | undefined, fallback: string): string =>
    safeName((raw ?? "").trim()).slice(0, 80) || safeName(fallback);
  if (node.lineage && node.lineage.length > 0) {
    return node.lineage.map((l) => seg(l.displayName, l.id));
  }
  return [seg(node.displayName ?? node.title, node.id)];
}

/**
 * 某层级节点的三件套目录（写入侧，按 media 定位主媒体 extraction）。
 * 目录按 lineage 嵌套 + displayName 规范名命名，与标准化(processing)阶段一致。
 */
export function nodeTriadDir(
  timestamp: StoryTimestamp,
  title: string,
  media: IpMediaType,
  node: Pick<HierarchyNode, "id" | "displayName" | "title" | "lineage">,
  roots?: LayoutRoots,
): string {
  return path.join(extractionOutputDir(timestamp, title, media, roots), ...nodeRelSegments(node));
}

// ─────────────────────────────────────────────────────────────────
// 输出侧路径（与 server.ts output 约定对齐）
// ─────────────────────────────────────────────────────────────────

export function outputRunDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(resolveCwd(roots), "output", runName(timestamp, title));
}

/** 文件浏览分组（环节）键 → 中文标签，供「按环节看文件」UI 用。 */
export const RUN_ARTIFACT_GROUP_LABELS: Record<string, string> = {
  original: "原始件",
  processing: "标准化",
  extraction_output: "抽取产物",
  package: "压缩包",
  output: "生成产物",
};

/**
 * 某 run 的全部产物根目录（按环节分组）：输出（生产产物）+ 输入各阶段
 * （original/processing/extraction_output 跨家族 + legacy 兜底）+ package 压缩包本体。
 * 只返回真实存在的目录；run 即磁盘运行键（`<时间戳>_<标题>` 或生产侧时间戳）。
 * 用于让中间预览「按环节读取并展示 input/ 与 output/ 两侧文件」。
 */
export function runArtifactRoots(run: string, roots?: LayoutRoots): Array<{ group: string; dir: string }> {
  const cwd = resolveCwd(roots);
  const result: Array<{ group: string; dir: string }> = [];
  const pushIf = (group: string, dir: string): void => {
    if (fs.existsSync(dir) && !result.some((r) => r.dir === dir)) result.push({ group, dir });
  };
  // 输入各阶段（跨家族枚举 + legacy 兜底）。
  for (const stage of ["original", "processing", "extraction_output"] as LayoutStage[]) {
    for (const fam of ALL_FAMILIES) pushIf(stage, familyStageDir(cwd, fam, stage, run));
    pushIf(stage, legacyStageDir(cwd, stage, run));
  }
  // 压缩包本体。
  pushIf("package", path.join(cwd, "input", "package", run));
  // 输出（生产产物）。
  pushIf("output", path.join(cwd, "output", run));
  return result;
}

/** IP DNA 运行清单文件名（output/<runId>/manifest.json，与既有 narrative 运行清单同名同构）。 */
export const IP_DNA_RUN_MANIFEST_FILE = "manifest.json";

/**
 * 落盘「运行清单」到 output 运行目录（output/<runId>/manifest.json），使 IP DNA 运行
 * （半自动 / 全自动）能被 `GET /api/narrative/history` 列出（§5.1 历史可见性）。
 *
 * 此前 IP DNA 主链产物落在 input/<runId>，生成产物只写 game_unit_N.json，从不写运行清单，
 * 故 history（只扫 output 的 manifest.json）始终列不出，进程重启打断的运行更是无迹可寻。
 *
 * 与既有 narrative 运行清单字段同构（runId/status/startedAt/updatedAt/tier/mode…），
 * 增量浅合并、幂等覆盖；首写补 startedAt，每写刷新 updatedAt。中断（进程重启）后残留的
 * "running" 由 server 的 cleanupStaleRunningManifests 统一翻为 "interrupted"，从而可见。
 */
export function saveIpDnaRunManifest(
  timestamp: StoryTimestamp,
  title: string,
  patch: Record<string, unknown>,
  roots?: LayoutRoots,
): void {
  const dir = outputRunDir(timestamp, title, roots);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, IP_DNA_RUN_MANIFEST_FILE);
  const prev = readJson<Record<string, unknown>>(file) ?? {};
  const now = new Date().toISOString();
  const merged: Record<string, unknown> = {
    ...prev,
    kind: "ip-dna",
    runId: prev.runId ?? runName(timestamp, title),
    title,
    story_timestamp: timestamp,
    startedAt: prev.startedAt ?? now,
    ...patch,
    updatedAt: now,
  };
  writeJson(file, merged);
}

/** 算子方案目录（§6.4，外层已有时间戳，本目录不再带时间戳）。 */
export function operatorSolutionDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(outputRunDir(timestamp, title, roots), "算子方案");
}

// ─────────────────────────────────────────────────────────────────
// 落盘 / 读取（含懒加载）
// ─────────────────────────────────────────────────────────────────

function writeJson(filepath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

function readJson<T>(filepath: string): T | undefined {
  if (!fs.existsSync(filepath)) return undefined;
  return JSON.parse(fs.readFileSync(filepath, "utf-8")) as T;
}

/**
 * 落盘整棵 IP DNA：层级树写索引文件（剥离三件套正文），三件套各节点分目录写。
 * 这样上层只需读 `_hierarchy.json` 即可遍历结构，三件套按需懒加载（§14.2 D4）。
 */
export function saveIpDna(dna: NarrativeIpDna, roots?: LayoutRoots): void {
  const { story_id, title, media_type } = dna;
  const extractDir = extractionOutputDir(story_id, title, media_type, roots);
  fs.mkdirSync(extractDir, { recursive: true });

  // 索引：节点结构（剥离三件套正文，仅留是否存在的标记由文件系统体现）。
  const index: NarrativeIpDna = {
    ...dna,
    nodes: Object.fromEntries(
      Object.entries(dna.nodes).map(([id, node]) => [
        id,
        { ...node, template: undefined, operators: undefined, metadata: node.metadata },
      ]),
    ),
  };
  writeJson(path.join(extractDir, HIERARCHY_INDEX_FILE), index);

  // 三件套：每节点一个目录（按 lineage 嵌套 + displayName 命名）。
  for (const node of Object.values(dna.nodes)) {
    const dir = nodeTriadDir(story_id, title, media_type, node, roots);
    if (node.template !== undefined) writeJson(path.join(dir, TRIAD_FILES.template), node.template);
    if (node.operators !== undefined) writeJson(path.join(dir, TRIAD_FILES.operators), node.operators);
    if (node.metadata !== undefined) writeJson(path.join(dir, TRIAD_FILES.metadata), node.metadata);
  }
}

/** 标准化全文文件名（_processing/standardized.txt，阶段门续跑时复读）。 */
export const STANDARDIZED_TEXT_FILE = "standardized.txt";

/** 改编指令落盘文件名（_extraction_output/adaptation_directive.json，§4.4 续跑/审阅）。 */
export const ADAPTATION_DIRECTIVE_FILE = "adaptation_directive.json";

/** 改编确认态文件名（阶段门半自动：confirm-scope/confirm-units 增量回填，extract 消费）。 */
export const ADAPTATION_CONFIRMATION_FILE = "_adaptation_confirmation.json";

/**
 * 仅落盘层级树骨架索引（阶段门 §5.1）：标准化(Phase1)后还没提取三件套时，
 * 先把可编辑的层级树写到 _hierarchy.json，供 UI/agent 审阅与确认裁剪范围，
 * 不写三件套目录（便宜，覆盖整部）。后续 runExtract 会用 saveIpDna 覆盖为完整版。
 */
export function saveHierarchyIndexOnly(dna: NarrativeIpDna, roots?: LayoutRoots): void {
  const { story_id, title, media_type } = dna;
  const extractDir = extractionOutputDir(story_id, title, media_type, roots);
  fs.mkdirSync(extractDir, { recursive: true });
  const index: NarrativeIpDna = {
    ...dna,
    nodes: Object.fromEntries(
      Object.entries(dna.nodes).map(([id, node]) => [
        id,
        { ...node, template: undefined, operators: undefined, metadata: node.metadata },
      ]),
    ),
  };
  writeJson(path.join(extractDir, HIERARCHY_INDEX_FILE), index);
}

/** 读取标准化全文（<processing>/standardized.txt），阶段门续跑时重建提取所需正文。媒体家族 + legacy 兜底。 */
export function loadStandardizedText(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): string | undefined {
  const dir = resolveStageDir(resolveCwd(roots), runName(timestamp, title), "processing", STANDARDIZED_TEXT_FILE);
  if (!dir) return undefined;
  const file = path.join(dir, STANDARDIZED_TEXT_FILE);
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, "utf-8");
}

/** 落盘改编指令（§4.4）：confirm-scope/units 后持久化，供 runExtract 续跑与审阅复用。 */
export function saveAdaptationDirective(
  directive: { story_id: StoryTimestamp },
  title: string,
  roots?: LayoutRoots,
): void {
  const dir = resolveExtractionDirForWrite(resolveCwd(roots), runName(directive.story_id, title));
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, ADAPTATION_DIRECTIVE_FILE), directive);
}

/** 只读改编指令（§4.4），无则 undefined。媒体家族 + legacy 兜底。 */
export function loadAdaptationDirective<T = unknown>(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): T | undefined {
  const dir = resolveStageDir(resolveCwd(roots), runName(timestamp, title), "extraction_output", ADAPTATION_DIRECTIVE_FILE);
  return dir ? readJson<T>(path.join(dir, ADAPTATION_DIRECTIVE_FILE)) : undefined;
}

/**
 * 增量保存改编确认态（阶段门半自动）：confirm-scope / confirm-units 分次回填，
 * extract/generate 一次性消费。与已有确认态浅合并（幂等覆盖同名字段）。
 */
export function saveAdaptationConfirmation(
  timestamp: StoryTimestamp,
  title: string,
  patch: Record<string, unknown>,
  roots?: LayoutRoots,
): Record<string, unknown> {
  const dir = resolveExtractionDirForWrite(resolveCwd(roots), runName(timestamp, title));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ADAPTATION_CONFIRMATION_FILE);
  const prev = readJson<Record<string, unknown>>(file) ?? {};
  const merged = { ...prev, ...patch };
  writeJson(file, merged);
  return merged;
}

/** 只读改编确认态（阶段门）。媒体家族 + legacy 兜底。 */
export function loadAdaptationConfirmation(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): Record<string, unknown> | undefined {
  const dir = resolveStageDir(resolveCwd(roots), runName(timestamp, title), "extraction_output", ADAPTATION_CONFIRMATION_FILE);
  return dir ? readJson<Record<string, unknown>>(path.join(dir, ADAPTATION_CONFIRMATION_FILE)) : undefined;
}

/**
 * 落盘《用户资产参考清单》(§6.2) 到主媒体 extraction_output 运行目录（user_asset_manifest.json）。
 * 随阶段更新 processing_status / guessed_levels 后复调即可覆盖（幂等）。
 */
export function saveManifest(manifest: UserAssetManifest, roots?: LayoutRoots): void {
  const dir = extractionOutputDir(manifest.story_id, manifest.title, manifest.media_type, roots);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, USER_ASSET_MANIFEST_FILE), manifest);
}

/** 只读《用户资产参考清单》(§6.2)，按 runId 定位。媒体家族 + legacy 兜底。 */
export function loadManifestByRun(runId: string, roots?: LayoutRoots): UserAssetManifest | undefined {
  const cwd = resolveCwd(roots);
  const run = safeName(runId);
  const dir = resolveStageDir(cwd, run, "extraction_output", USER_ASSET_MANIFEST_FILE)
    // legacy manifest 旧版落在 input/<run>/ 根，不在 _extraction_output 下，单独兜底。
    ?? (fs.existsSync(path.join(cwd, "input", run, USER_ASSET_MANIFEST_FILE))
      ? path.join(cwd, "input", run)
      : undefined);
  return dir ? readJson<UserAssetManifest>(path.join(dir, USER_ASSET_MANIFEST_FILE)) : undefined;
}

/** 只读《用户资产参考清单》(§6.2)。媒体家族 + legacy 兜底。 */
export function loadManifest(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): UserAssetManifest | undefined {
  return loadManifestByRun(runName(timestamp, title), roots);
}

/** 媒体优先布局下的「输入根」目录名（非运行键）：扫描历史时需跳过这些容器目录。 */
export const INPUT_CONTAINER_DIRS: ReadonlySet<string> = new Set([
  "book", "picture", "video", "package", "text", "user_input",
]);

/**
 * 列举所有「IP 运行键」（=<时间戳>_<故事名>）：遍历三大媒体家族的 original/processing/extraction_output
 * 子目录 + legacy（input/<run>/_extraction_output 或根 manifest）收集去重。供 history 列出中断运行（§5.1）。
 */
export function listInputRunKeys(roots?: LayoutRoots): string[] {
  const cwd = resolveCwd(roots);
  const keys = new Set<string>();
  const addDirsIn = (p: string): void => {
    try {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) if (e.isDirectory()) keys.add(e.name);
    } catch {
      /* 目录不存在则跳过 */
    }
  };
  for (const fam of ALL_FAMILIES) {
    const { family, prefix } = FAMILY_LAYOUT[fam];
    const famRoot = path.join(cwd, "input", ...family);
    for (const stage of ["original", "processing", "extraction_output"] as const) {
      addDirsIn(path.join(famRoot, `${prefix}_${stage}`));
    }
  }
  // legacy（run 优先）：input/<run> 且含 _extraction_output / 根 manifest。
  try {
    for (const e of fs.readdirSync(path.join(cwd, "input"), { withFileTypes: true })) {
      if (!e.isDirectory() || INPUT_CONTAINER_DIRS.has(e.name)) continue;
      const runRoot = path.join(cwd, "input", e.name);
      if (fs.existsSync(path.join(runRoot, "_extraction_output")) || fs.existsSync(path.join(runRoot, USER_ASSET_MANIFEST_FILE))) {
        keys.add(e.name);
      }
    }
  } catch {
    /* input 不存在则跳过 */
  }
  return [...keys];
}

/** 只读层级树索引（按 runId=<时间戳>_<故事名> 直接定位，前端审阅用）。媒体家族 + legacy 兜底。 */
export function loadHierarchyIndexByRun(runId: string, roots?: LayoutRoots): NarrativeIpDna | undefined {
  const dir = resolveStageDir(resolveCwd(roots), safeName(runId), "extraction_output", HIERARCHY_INDEX_FILE);
  if (!dir) return undefined;
  const raw = readJson<NarrativeIpDna>(path.join(dir, HIERARCHY_INDEX_FILE));
  return raw ? migrateIpDnaSchema(raw) : undefined;
}

/** 只读层级树索引（懒加载入口，不加载三件套正文）。媒体家族 + legacy 兜底；加载即按需 schema 迁移（§14.2 D5）。 */
export function loadHierarchyIndex(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): NarrativeIpDna | undefined {
  return loadHierarchyIndexByRun(runName(timestamp, title), roots);
}

/**
 * 按需加载单个节点的三件套（懒加载）。媒体家族 + legacy 兜底定位 extraction 目录。
 * 目录优先用新的嵌套 displayName 路径；旧数据（扁平 nodeId 目录）自动回退，保证向后兼容。
 */
export function loadNodeTriad(
  timestamp: StoryTimestamp,
  title: string,
  node: Pick<HierarchyNode, "id" | "displayName" | "title" | "lineage">,
  roots?: LayoutRoots,
): { template?: NarrativeTemplate; operators?: NarrativeOperator[]; metadata?: NodeMetadata } {
  const extractDir = resolveStageDir(resolveCwd(roots), runName(timestamp, title), "extraction_output", HIERARCHY_INDEX_FILE);
  if (!extractDir) return {};
  const nestedDir = path.join(extractDir, ...nodeRelSegments(node));
  const legacyDir = path.join(extractDir, safeName(node.id));
  const nestedHasTriad =
    fs.existsSync(path.join(nestedDir, TRIAD_FILES.template)) ||
    fs.existsSync(path.join(nestedDir, TRIAD_FILES.operators)) ||
    fs.existsSync(path.join(nestedDir, TRIAD_FILES.metadata));
  const dir = nestedHasTriad ? nestedDir : legacyDir;
  return {
    template: readJson<NarrativeTemplate>(path.join(dir, TRIAD_FILES.template)),
    operators: readJson<NarrativeOperator[]>(path.join(dir, TRIAD_FILES.operators)),
    metadata: readJson<NodeMetadata>(path.join(dir, TRIAD_FILES.metadata)),
  };
}

/**
 * 断点续传（§14.2）：加载层级索引并 hydrate 全部节点三件套回内存的完整 IP DNA。
 * 无持久化 checkpoint（_hierarchy.json 不存在）时返回 undefined。
 */
export function loadFullIpDna(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): NarrativeIpDna | undefined {
  const index = loadHierarchyIndex(timestamp, title, roots);
  if (!index) return undefined;
  const nodes: NarrativeIpDna["nodes"] = {};
  for (const id of Object.keys(index.nodes)) {
    const triad = loadNodeTriad(timestamp, title, index.nodes[id], roots);
    nodes[id] = { ...index.nodes[id], ...triad };
  }
  return { ...index, nodes };
}

/** 把索引节点连同其三件套完整加载回内存（hydrate 单节点）。 */
export function hydrateNode(
  index: NarrativeIpDna,
  nodeId: string,
  roots?: LayoutRoots,
): HierarchyNode | undefined {
  const node = index.nodes[nodeId];
  if (!node) return undefined;
  const triad = loadNodeTriad(index.story_id, index.title, node, roots);
  return { ...node, ...triad };
}

/** 落盘算子方案（§6.4）：每次消费算子写一个 JSON。 */
export function saveOperatorSolution(
  solution: OperatorSolution,
  title: string,
  roots?: LayoutRoots,
): string {
  const dir = operatorSolutionDir(solution.story_id, title, roots);
  const filename = `${safeName(solution.node)}_operator_solution.json`;
  writeJson(path.join(dir, filename), solution);
  return path.join(dir, filename);
}

/** 新建一棵空 IP DNA（顶层 complete 根节点）。 */
export function createEmptyIpDna(args: {
  story_id: StoryTimestamp;
  title: string;
  media_type: NarrativeIpDna["media_type"];
}): NarrativeIpDna {
  const rootId = "root";
  const root: HierarchyNode = {
    id: rootId,
    levelType: "complete",
    index: 0,
    title: args.title,
    parent: null,
    children: [],
  };
  return {
    schema_version: NARRATIVE_IP_DNA_SCHEMA_VERSION,
    story_id: args.story_id,
    title: args.title,
    media_type: args.media_type,
    rootId,
    nodes: { [rootId]: root },
  };
}
