/**
 * IP DNA 端到端编排器 —— 蓝图 §5「端到端流程」的可运行装配。
 *
 * 串起：Phase0 归档 → Phase1 标准化/层级 → 单元切片 → Phase2 scoped 提取 →
 *       由下至上聚合 → Phase2b 改编指令（默认全量/series）→ A→B 映射 →
 *       既有生成管线（pipeline.run）→ 落盘 output/<时间戳>_<故事名>/。
 *
 * 设计：
 *   - 全程同一 story_timestamp 作主键（§6.0），input/ 与 output/ 同名关联。
 *   - 提取 / 生成均以"接缝(seam)"形式可注入：默认用 LLM；无 key 时用确定性兜底（heuristic），
 *     保证离线 dry-run 也能跑通整条链路（不抛错）。
 *   - 落盘断点：saveIpDna 写 _extraction_output；生成结果写 output run 目录。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { LLMClient } from "../pipeline/runtime/llm-client.js";
import { NarrativePipeline } from "../pipeline/core/pipeline.js";
import type { NarrativeContext, PipelineConfig, TierId, ModeId, PipelineProgress } from "../types/index.js";
import type {
  NarrativeIpDna,
  HierarchyNode,
  NarrativeTemplate,
  NarrativeOperator,
  AdaptationDirective,
  AdaptationScope,
  AdaptationStatus,
  AdaptationDimensions,
  GameMode,
  GameUnitPlan,
  IpSide,
  IpMediaType,
  StoryTimestamp,
  UserAssetManifest,
  LayeredOperators,
} from "../types/narrative-ip-dna.js";
import { archiveAndBuildManifest, type IncomingFile, inferMediaType, modalityOf } from "./phase0-foundation.js";
import { transcribeMediaFiles, type VideoFrameSampler, type VideoTranscriber } from "./phase1-multimodal.js";
import { decodeGb18030, expandArchives, expandPdfs, compressMediaToDir, isArchive, type ArchiveExtractor, type MediaCompressor, type PdfPageSplitter } from "./phase0-compress.js";
import {
  buildLightHierarchy,
  buildHierarchyFromSegments,
  segmentsFromTexts,
  segmentsHaveStructure,
  sliceUnitTexts,
  sliceSubtreeText,
  assessVolume,
  countOversizedUnits,
  planDecomposition,
  applyDecompositionClosure,
  guessLevelsFromHierarchy,
  collectLeafIds,
  type VolumeAssessment,
  type DecompositionClosureResult,
} from "./phase1-understanding.js";
import { cropByScope, buildAdaptationDirective } from "./phase2b-adapt.js";
import { filterNoiseNodes, type NoiseFilterResult } from "./noise-filter.js";
import {
  extractUnitTemplate,
  heuristicExtractUnit,
  aggregateTemplates,
  aggregateSubtreeTemplates,
  aggregateSubtreeTemplatesRecursive,
  synthesizeParentTemplateFields,
  analyzeHierarchy,
  buildGenerationInput,
  assessExtractionQuality,
  extractParentOperators,
  collectLayeredOperators,
  flattenLayeredOperators,
} from "./phase2-extract.js";
import type { QualityCheck } from "./job.js";
import { saveIpDna, outputRunDir, processingDir, saveOperatorSolution, extractionOutputDir, saveNodeProcessingMarkdown, saveManifest, loadManifest, loadFullIpDna, saveHierarchyIndexOnly, loadStandardizedText, loadHierarchyIndex, loadHierarchyIndexByRun, saveAdaptationDirective, saveIpDnaRunManifest, packageDir } from "./filesystem.js";
import { buildCorpusRetriever, equipAndConsume } from "./phase3-rag.js";
import { resolveVnActCount, mapGameUnitToPipeline, buildUnitActMap, representativeGenreForFamily, familyFromTargetOutput, buildSeriesEndingDirective, type PipelineFamily, type GameUnitPipelinePlan } from "./phase2c-gen-adapt.js";
import { buildKagFromTemplate, renderRelationInjection } from "./phase3b-kag.js";
import { buildLedgerFromTemplate, appendLedger, saveLedger, loadLedger, mergeLedger, harvestLedgerFromGenerated, type LongMemoryLedger } from "./phase5-polish.js";
import { hydrateContextFromSeed, type GenerationSeed } from "./generation-seed.js";
import { setQueryEmbedder } from "./injection/operator-injection.js";
import type { QueryEmbedder } from "./phase3-vector.js";
import type { OperatorSolution } from "../types/narrative-ip-dna.js";

// ─────────────────────────────────────────────────────────────────
// 接缝类型
// ─────────────────────────────────────────────────────────────────

/** 单元提取接缝：原地填 node.template / node.operators / node.metadata。 */
export type UnitExtractor = (node: HierarchyNode, unitText: string) => Promise<void> | void;

/**
 * 生成接缝：消费生成输入 + A→B 种子契约，返回最终 ctx。
 * seed 为类型化契约（T4，推荐）；seedCtx 为其水合结果（向后兼容/自定义 runner）。
 */
export type GenerationRunner = (args: {
  userInput: string;
  uploadedScript?: NarrativeContext["uploaded_script"];
  seed: GenerationSeed;
  seedCtx: NarrativeContext;
}) => Promise<NarrativeContext>;

export interface IpDnaProgress {
  phase: "phase0" | "phase1" | "phase2_extract" | "quality" | "phase2b_adapt" | "mapping" | "generation" | "done";
  message: string;
  /** 0..1 */
  ratio?: number;
}

export interface IpDnaOrchestratorOptions {
  /** 摄入文件（runIngest 必需）；阶段二 runExtractAndGenerate 从磁盘复读层级树，不需要 files。 */
  files?: IncomingFile[];
  title?: string;
  story_timestamp?: StoryTimestamp;
  side?: IpSide;
  /** 进程根（测试用，落盘到此目录下 input/ output/）。 */
  cwd?: string;

  // 改编参数（无对话功能时走默认：全量 + series；有对话产物时由前端精确选填）
  scope?: AdaptationScope;
  mode?: GameMode;
  targetUnits?: number;
  targetComplexity?: number;
  /** 用户精确选填的游戏单元规划（§4.4 第②步），提供则覆盖默认切分。 */
  gameUnitPlan?: GameUnitPlan;
  /** 用户精确选填的改编维度（§4.4 第③步：叙事层级数 + 模板字段），提供则覆盖默认全维度模板。 */
  dimensions?: Partial<AdaptationDimensions>;
  /** 作者自定义改编补充说明（§5.1 自由文本）：合并进 directive.adaptation_notes 并追加进下游 userInput；空＝忠实转化。 */
  adaptationNotes?: string;

  // 接缝
  /** 提取用 LLM；提供则默认走 LLM 提取，否则确定性兜底。 */
  llm?: LLMClient;
  /** 视频抽帧接缝（§3.4 多模态）：提供则视频转写为叙事文本汇入主链（见 createFfmpegFrameSampler）。 */
  frameSampler?: VideoFrameSampler;
  /** 本地查询向量化器（§7.1）：提供则启用 RAG vector 通道（见 createHttpQueryEmbedder / resolveQueryEmbedder）。 */
  queryEmbedder?: QueryEmbedder;
  /** 视频语音转写接缝（ASR）。 */
  transcriber?: VideoTranscriber;
  /**
   * 延迟多模态转写（§状态机重构 / 成本可控）：为 true 时，标准化（runIngest）阶段**跳过**
   * 图片/视频的 LLM 转写，标准化仅做纯算法结构化（不产生 LLM 成本）。多模态转写整体推迟到
   * 「开始生成」（runExtractAndGenerate）阶段进行——大批量上传时避免标准化阶段的不可控 AI 成本。
   * 半自动 UI 的 ingest 端点默认置真；全自动一键 /ip-dna/start 保持即时转写（用户已选端到端）。
   */
  deferMultimodal?: boolean;
  /**
   * 仅打包落盘（§状态机 / IP「确认」即落盘 input/，零 LLM、零标准化）：为 true 时 runIngest 在
   * 归档原始资产 + 写 user_asset_manifest.json 后**立即短路返回**——不做多模态转写、不做媒体压缩、
   * 不做标准化文本合并、不建层级树（不写 _hierarchy.json）、不写 running 运行清单。用于用户点「确认」时
   * 把原料先固化到 input/<媒体>/<故事类型>/<时间戳_标题>/，标准化与提取整体推迟到「开始生成」。
   */
  packageOnly?: boolean;
  /** 压缩包解压接缝（zip 等，§6.1）；gz/tar/tgz 已原生支持。 */
  archiveExtractor?: ArchiveExtractor;
  /** PDF 拆页接缝（§6.1）：PDF → 逐页 jpg；缺省则 PDF 原样透传。 */
  pdfPageSplitter?: PdfPageSplitter;
  /** 媒体压缩接缝（图片→720p / 视频转码，§3.4）。 */
  mediaCompressor?: MediaCompressor;
  /** 覆盖提取实现。 */
  extractor?: UnitExtractor;
  /** 覆盖生成实现（默认 NarrativePipeline）。 */
  generate?: GenerationRunner;

  // 生成控制
  /** 管线家族（rpg=层级树管线 / vn=互动影游管线）；决定节点控制映射方式。默认 rpg。 */
  pipelineFamily?: PipelineFamily;
  /** 是否真正跑生成管线（默认 true；false 则只产出 IP DNA + 指令 + 生成输入）。 */
  runGeneration?: boolean;
  /** 超体量时是否执行拆解闭环（按标记边界拆块；§7.1）。默认 false：不拆，整篇处理。 */
  decompose?: boolean;
  /** 断点续传（§14.2）：存在已持久化 IP DNA checkpoint 时跳过重建+提取，懒加载三件套续跑。 */
  resume?: boolean;
  /** 是否为每个游戏单元装备三视角算子并一步消费（接 knowledge_base 语料，落算子方案）。默认 false。 */
  equipOperators?: boolean;
  /** 是否构建 KAG 关系网络并注入生成（确定性、零额外 LLM）。默认 true。 */
  injectRelations?: boolean;
  /** 实际生成的游戏单元数上限（默认全部）。 */
  maxGameUnits?: number;
  /** 透传给默认生成管线。 */
  pipelineConfig?: Partial<PipelineConfig>;
  tier?: TierId;
  generationMode?: ModeId;

  onProgress?: (e: IpDnaProgress) => void;
  /**
   * 下游生成管线（NarrativePipeline.run）的逐步进度钩子。提供则 defaultGenerationRunner 把它接到
   * 生成管线的 onProgress 上，使 IP 改编「开始生成」后下游叙事步骤（announce + 每步 progress）能被
   * server 桥接为正式 SSE run，前端逐节点显示、跑完收尾（否则下游在进程内静默跑，UI 只见 ip_* 前驱步）。
   */
  onGenerationProgress?: (p: PipelineProgress) => void;
}

export interface GameUnitResult {
  index: number;
  leafIds: string[];
  topTemplate: NarrativeTemplate;
  operatorPool: NarrativeOperator[];
  /** A→B 类型化交接契约（唯一事实源，T4）。 */
  seed: GenerationSeed;
  /** 已由 seed 水合的种子 ctx（= hydrateContextFromSeed(seed)）。 */
  seedContext: NarrativeContext;
  generationInput: { userInput: string; uploadedScript?: NarrativeContext["uploaded_script"] };
  /** runGeneration 时的最终生成结果。 */
  generated?: NarrativeContext;
  /** 输出落盘目录（runGeneration 时）。 */
  outputDir?: string;
  /** 三视角算子方案（equipOperators 时）。 */
  operatorSolution?: OperatorSolution;
  /** KAG 关系网络注入简报（injectRelations 时）。 */
  relationBrief?: string;
  /** Phase2c 管线适配计划（节点控制：RPG target_structure / VN 开放幕数）。 */
  pipelinePlan?: GameUnitPipelinePlan;
}

export interface IpDnaPipelineResult {
  story_timestamp: StoryTimestamp;
  title: string;
  manifest: UserAssetManifest;
  dna: NarrativeIpDna;
  directive: AdaptationDirective;
  gameUnits: GameUnitResult[];
  /** 长记忆一致性账本（接入生成/续写/改写侧，§10）。 */
  ledger: LongMemoryLedger;
  /** Phase2 提取质量评估（§14.2 D3）：结构完整性 + 三件套齐全 + 算子统计；非阻断，含告警。 */
  extractionQuality: QualityCheck;
}

// ─────────────────────────────────────────────────────────────────
// 阶段门契约（§5.1 半自动）：把端到端流程切成可独立调用、可落盘续跑的阶段。
//   runIngest            = Phase0 + 标准化(含干扰过滤) + Phase1 建树 + 落盘骨架层级树（停在确认门）
//   runExtractAndGenerate= Phase2b 改编指令 + Phase2 scoped 提取 + 聚合 + 映射 +（可选）生成
//   runIpDnaPipeline     = 全自动：runIngest → runExtractAndGenerate（向后兼容既有调用方/工具桥）
// ─────────────────────────────────────────────────────────────────

/** runIngest 产物：标准化完成、层级树骨架已落盘，等待裁剪范围确认（§5.1 确认门入口）。 */
export interface IngestResult {
  story_timestamp: StoryTimestamp;
  title: string;
  manifest: UserAssetManifest;
  /** 标准化全文（提取阶段切片所需；阶段门续跑时从 _processing/standardized.txt 复读）。 */
  fullText: string;
  media_type: NarrativeIpDna["media_type"];
  /** Phase1 层级树骨架（无三件套；已落盘 _hierarchy.json，可编辑、可审阅）。 */
  dna: NarrativeIpDna;
  /** 体量水准线评估（是否超线 + 建议拆解块数）。 */
  volume: VolumeAssessment;
  /** 拆解闭环结果（decompose 开启时；否则 iterations=0）。 */
  decomposition: DecompositionClosureResult;
  /** 干扰项过滤结果（被剔除的非正文节点）。 */
  noise: NoiseFilterResult;
  /** 默认改编指令（全量 scope + 默认体量切分），供 UI/agent 引导确认。 */
  defaultDirective: AdaptationDirective;
  /** resume 时 dna 已 hydrate 三件套 → 提取阶段跳过。 */
  hydrated: boolean;
}

/** 提取+生成阶段的输入来源（内存 ingest 直传 / 阶段门续跑从磁盘复读后构造）。 */
export interface ExtractSource {
  story_timestamp: StoryTimestamp;
  title: string;
  manifest: UserAssetManifest;
  fullText: string;
  media_type: NarrativeIpDna["media_type"];
  dna: NarrativeIpDna;
  /** dna 是否已 hydrate 三件套（resume）→ 跳过提取与聚合。 */
  hydrated: boolean;
}

/**
 * 阶段一：摄入 + 标准化 + 建树（§5 步骤 0→1→2）。
 * 跑到「确认裁剪范围」前停下：落盘骨架层级树 + 资产清单(standardized)，返回体量/拆解/默认指令。
 */
export async function runIngest(options: IpDnaOrchestratorOptions): Promise<IngestResult> {
  const emit = (e: IpDnaProgress): void => options.onProgress?.(e);
  if (options.queryEmbedder) setQueryEmbedder(options.queryEmbedder);

  // ── Phase 0：压缩包解压 → PDF 拆页 → 归档 + 资产清单 ──
  emit({ phase: "phase0", message: "解压压缩包并归档原始资产", ratio: 0 });
  const rawFiles = options.files ?? [];
  const unarchived = await expandArchives(rawFiles, options.archiveExtractor);
  const expandedFiles = await expandPdfs(unarchived, options.pdfPageSplitter);
  const phase0 = archiveAndBuildManifest({
    files: expandedFiles,
    title: options.title,
    story_timestamp: options.story_timestamp,
    side: options.side,
    cwd: options.cwd,
  });
  const { story_timestamp, title, manifest } = phase0;

  // 压缩包本体原样存「专门目录」input/package/<run>/（可追溯/复跑；成员已在上面分家落各媒体 *_original）。
  for (const f of rawFiles) {
    if (!isArchive(f.fileName)) continue;
    try {
      const dir = packageDir(story_timestamp, title, { cwd: options.cwd });
      fs.mkdirSync(dir, { recursive: true });
      const safe = f.fileName.replace(/[/\\?%*:|"<>]/g, "_");
      fs.writeFileSync(path.join(dir, safe), typeof f.data === "string" ? Buffer.from(f.data, "utf-8") : f.data);
    } catch {
      /* 压缩包本体落盘失败不阻断主链 */
    }
  }
  const ingestMedia = inferMediaType(expandedFiles);
  try { saveManifest(manifest, { cwd: options.cwd }); } catch { /* 落盘失败不阻断主链 */ }

  // §状态机 / IP「确认」即落盘：packageOnly 到此短路——原料已归档到 input/ 且 manifest 已写，
  // 不做压缩/标准化/建树/running 清单（全部推迟到「开始生成」）。返回最小合法 IngestResult（in-memory，不落 _hierarchy.json）。
  if (options.packageOnly) {
    emit({ phase: "phase0", message: "仅打包落盘（零 LLM）：原料已固化，标准化/提取推迟到生成阶段", ratio: 1 });
    const media_type = ingestMedia;
    const dna = buildLightHierarchy({ story_timestamp, title, media_type, text: "" });
    const volume = {
      ...assessVolume("", { mediaType: media_type, unitCount: collectLeafIds(dna).length }),
      oversizedUnitCount: 0,
    };
    return {
      story_timestamp, title, manifest, fullText: "", media_type, dna, volume,
      decomposition: { iterations: 0, splitUnits: 0, residualOversize: false },
      noise: { filtered: [], filteredTitles: [] },
      defaultDirective: buildAdaptationDirective(dna, {}),
      hydrated: false,
    };
  }

  // 历史可见性（§5.1）：标题已定即在 output 写 running 运行清单，使本次运行进入 history 列表；
  // 中途被进程重启打断时残留 running → 由 cleanupStaleRunningManifests 翻为 interrupted（仍可见）。
  try {
    saveIpDnaRunManifest(story_timestamp, title, {
      status: "running",
      ipDnaPhase: "phase1",
      tier: options.tier,
      mode: options.generationMode,
      userInput: title,
    }, { cwd: options.cwd });
  } catch { /* 落盘失败不阻断主链 */ }

  if (expandedFiles.some((f) => /^(image|video)\//.test(f.fileType))) {
    await compressMediaToDir(expandedFiles, story_timestamp, title, {
      compressor: options.mediaCompressor,
      cwd: options.cwd,
    });
  }

  // ── 标准化：合并文本模态正文 + 多模态转写 ──
  // 文本段保留文件/目录边界（§3.2 多文件建树），offset 与下面拼接的 textPart 对齐。
  const textItems = expandedFiles
    .filter((f) => modalityOf(f.fileType, f.fileName) === "text")
    .map((f) => ({ path: f.fileName, text: typeof f.data === "string" ? f.data : safeToText(f.data) }));
  const { segments: textSegments, fullText: textPart } = segmentsFromTexts(textItems);
  let mmText = "";
  // §状态机重构：deferMultimodal 时跳过多模态转写（标准化零 LLM 成本，转写推迟到生成阶段）。
  if (!options.deferMultimodal && (options.llm || options.frameSampler)) {
    const mm = await transcribeMediaFiles(expandedFiles, {
      llm: options.llm,
      frameSampler: options.frameSampler,
      transcriber: options.transcriber,
    });
    mmText = mm.combinedText;
  }
  const fullText = [textPart, mmText].filter((s) => s.trim().length > 0).join("\n\n");
  persistProcessingText(story_timestamp, title, ingestMedia, fullText, options.cwd);

  // ── 断点续传：resume 且存在持久化 IP DNA → 加载完整（含三件套），跳过重建。──
  const resumedDna = options.resume ? loadFullIpDna(story_timestamp, title, { cwd: options.cwd }) : undefined;
  const media_type = resumedDna?.media_type ?? ingestMedia;

  if (resumedDna) {
    emit({ phase: "phase1", message: "断点续传：加载已持久化 IP DNA（跳过重建/提取）", ratio: 0.5 });
    manifest.processing_status = "extracted";
    try { saveManifest(manifest, { cwd: options.cwd }); } catch { /* 落盘失败不阻断主链 */ }
    const volume = {
      ...assessVolume(fullText, { mediaType: media_type, unitCount: collectLeafIds(resumedDna).length }),
      oversizedUnitCount: countOversizedUnits(resumedDna),
    };
    return {
      story_timestamp, title, manifest, fullText, media_type, dna: resumedDna, volume,
      decomposition: { iterations: 0, splitUnits: 0, residualOversize: false },
      noise: { filtered: [], filteredTitles: [] },
      defaultDirective: buildAdaptationDirective(resumedDna, {}),
      hydrated: true,
    };
  }

  // ── Phase 1：层级树构建（全算法，去 LLM 结构推断）──
  emit({ phase: "phase1", message: "构建叙事层级树（标准化）", ratio: 0.08 });
  let dna: NarrativeIpDna;
  // 有多模态转写时（混合模态）走扫标记建统一树：textPart 标记 + mmText 模态层级标记同入一棵树（§3.4）。
  const hasMediaText = mmText.trim().length > 0;
  // 多文件/卷目录结构（纯文本）→ 保边界建多层树（§3.2）；
  // 其余（含无标记散文）统一走 buildLightHierarchy：有标记→扫标记建树，无标记→整篇单 unit，
  // 后续由 applyDecompositionClosure 按体量等分（"有什么拆什么、拆不出按体量切"，不再依赖 LLM）。
  if (!hasMediaText && textSegments.length > 0 && segmentsHaveStructure(textSegments)) {
    dna = buildHierarchyFromSegments({ story_timestamp, title, media_type }, textSegments);
    emit({ phase: "phase1", message: `多文件建树：结构=${dna.structureType}、聚合层数=${dna.aggregationTimes}`, ratio: 0.085 });
  } else {
    dna = buildLightHierarchy({ story_timestamp, title, media_type, text: fullText });
  }

  // ── 干扰项过滤（§1）：剔除非正文/干扰节点（引言/序/感言/附录/广告…），保留正文+特殊章节。──
  const noise = filterNoiseNodes(dna);
  if (noise.filtered.length > 0) {
    emit({ phase: "phase1", message: `干扰项过滤：剔除 ${noise.filtered.length} 个非正文节点（${noise.filteredTitles.slice(0, 5).join("、")}${noise.filteredTitles.length > 5 ? "…" : ""}）`, ratio: 0.09 });
  }

  // 多维体量水准线。
  const unitCount = collectLeafIds(dna).length;
  const volume = {
    ...assessVolume(fullText, { mediaType: media_type, unitCount }),
    oversizedUnitCount: countOversizedUnits(dna),
  };
  emit({
    phase: "phase1",
    message: `体量评估：${volume.thresholdBasis}${volume.needsDecompose ? `（超线，建议拆 ${volume.suggestedChunks} 块）` : ""}`,
    ratio: 0.1,
  });

  // 拆解闭环（默认不拆）。
  const decompositionPlan = planDecomposition(fullText, volume, options.decompose === true);
  if (decompositionPlan.decomposed) {
    emit({ phase: "phase1", message: `按标记边界拆解为 ${decompositionPlan.chunks.length} 块`, ratio: 0.1 });
  }
  const decomposition = applyDecompositionClosure(dna, fullText, options.decompose === true);
  if (decomposition.iterations > 0) {
    emit({
      phase: "phase1",
      message: `拆解闭环：${decomposition.iterations} 轮，新增 ${decomposition.splitUnits} 个子单元${decomposition.residualOversize ? "（仍有残留超线，按现状输出）" : ""}`,
      ratio: 0.1,
    });
  }

  // 资产清单更新 + 标准化嵌套 markdown 落盘。
  if (manifest.preliminary_structure) {
    manifest.preliminary_structure.guessed_levels = guessLevelsFromHierarchy(dna);
  }
  manifest.processing_status = "standardized";
  try { saveManifest(manifest, { cwd: options.cwd }); } catch { /* 落盘失败不阻断主链 */ }

  const ingestUnitTexts = sliceUnitTexts(dna, fullText);
  for (const [nodeId, text] of ingestUnitTexts) {
    if (!text.trim()) continue;
    try {
      saveNodeProcessingMarkdown(story_timestamp, title, media_type, dna.nodes[nodeId] ?? { id: nodeId, title: nodeId }, text, { cwd: options.cwd });
    } catch {
      /* 落盘失败不阻断主链 */
    }
  }

  // ── 落盘骨架层级树（§5.1 确认门）：供 UI/agent 审阅 + 确认裁剪范围，三件套留待 runExtract。──
  try { saveHierarchyIndexOnly(dna, { cwd: options.cwd }); } catch { /* 落盘失败不阻断主链 */ }

  return {
    story_timestamp, title, manifest, fullText, media_type, dna, volume, decomposition, noise,
    defaultDirective: buildAdaptationDirective(dna, {}),
    hydrated: false,
  };
}

/**
 * 从磁盘复读阶段门续跑所需来源（标准化全文 + 骨架层级树 + 资产清单）。
 * 阶段门 confirm → extract 跨 HTTP 调用时用：runIngest 已落盘，这里重建内存态。
 */
export function loadExtractSource(
  story_timestamp: StoryTimestamp,
  title: string,
  cwd?: string,
): ExtractSource | undefined {
  const dna = loadHierarchyIndex(story_timestamp, title, { cwd });
  if (!dna) return undefined;
  const fullText = loadStandardizedText(story_timestamp, title, { cwd }) ?? "";
  // 资产清单可缺失（容错）：用最小占位。
  const manifest: UserAssetManifest = loadManifest(story_timestamp, title, { cwd }) ?? {
    story_id: story_timestamp,
    title,
    media_type: dna.media_type,
    modality: ["text"],
    side: "story",
    source_files: [],
    processing_status: "standardized",
    created_at: new Date().toISOString(),
  };
  return { story_timestamp, title, manifest, fullText, media_type: dna.media_type, dna, hydrated: false };
}

/** 按 runId（=<时间戳>_<故事名>）复读阶段门续跑来源。 */
export function loadExtractSourceByRun(runId: string, cwd?: string): ExtractSource | undefined {
  const dna = loadHierarchyIndexByRun(runId, { cwd });
  if (!dna) return undefined;
  return loadExtractSource(dna.story_id, dna.title, cwd);
}

/**
 * 阶段二：改编指令 + scoped 提取 + 映射 +（可选）生成（§5 步骤 3→4→5）。
 * 由「开始生成」触发：改编范围已确认后，提取(=4 生成 scoped IP DNA)与下游生成在同一 run 内自动串跑。
 */
export async function runExtractAndGenerate(
  options: IpDnaOrchestratorOptions,
  source: ExtractSource,
): Promise<IpDnaPipelineResult> {
  const emit = (e: IpDnaProgress): void => options.onProgress?.(e);
  if (options.queryEmbedder) setQueryEmbedder(options.queryEmbedder);

  const { story_timestamp, title, manifest, fullText, media_type, dna } = source;
  const resumedDna = source.hydrated;

  // ── Phase 2b：改编指令先行（§5.1 第①②步）。──
  emit({ phase: "phase2b_adapt", message: "组装改编指令（范围/游戏单元/维度）", ratio: 0.5 });
  const directive = buildAdaptationDirective(dna, {
    scope: options.scope,
    mode: options.mode,
    targetUnits: options.targetUnits,
    targetComplexity: options.targetComplexity,
    gameUnitPlan: options.gameUnitPlan,
    dimensions: options.dimensions,
    adaptationNotes: options.adaptationNotes,
  });
  // 改编指令落盘（§4.4 续跑/审阅）。
  try { saveAdaptationDirective(directive, title, { cwd: options.cwd }); } catch { /* 落盘失败不阻断主链 */ }
  const cropped = cropByScope(dna, directive.adaptation_scope);
  const croppedIds = cropped.map((u) => u.id);

  // ── Phase 2：scoped 提取（§5.1 第③步）。──
  if (!resumedDna) {
    const extractor: UnitExtractor = options.extractor
      ?? (options.llm
        ? (node, text) => extractUnitTemplate(options.llm!, node, text)
        : (node, text) => heuristicExtractUnit(node, text));
    const unitTexts = sliceUnitTexts(dna, fullText);
    for (let i = 0; i < cropped.length; i++) {
      const node = cropped[i];
      emit({
        phase: "phase2_extract",
        message: `提取单元 ${i + 1}/${cropped.length}：${node.title}`,
        ratio: 0.1 + 0.4 * ((i + 1) / Math.max(1, cropped.length)),
      });
      await extractor(node, unitTexts.get(node.id) ?? "");
    }
    // 逐层递归聚合（§3.3）：有 LLM 时按规模做批压缩 + 后序合父三件套；否则确定性结构上卷。
    if (options.llm) {
      const analysis = analyzeHierarchy(dna);
      emit({ phase: "phase2_extract", message: `逐层聚合：规模=${analysis.scale}（${analysis.leafCount} 叶/批${analysis.batchSize}）`, ratio: 0.52 });
      await aggregateSubtreeTemplatesRecursive(dna, dna.rootId, { llm: options.llm, batchSize: analysis.batchSize });
    } else {
      aggregateSubtreeTemplates(dna, dna.rootId);
    }
  }

  // ── 提取质量评估（§14.2 D3）。──
  const extractionQuality = assessExtractionQuality(dna, croppedIds);
  emit({
    phase: "quality",
    message: extractionQuality.passed
      ? "提取质量校验通过"
      : `提取质量告警：${extractionQuality.warnings.join(" ") || "见 checks"}`,
    ratio: 0.5,
  });

  // ── 落盘 IP DNA（断点）──
  saveIpDna(dna, { cwd: options.cwd });
  manifest.processing_status = "extracted";
  try { saveManifest(manifest, { cwd: options.cwd }); } catch { /* 落盘失败不阻断主链 */ }

  // ── 为每个游戏单元：聚合 → A→B 映射 → 生成输入 ──

  const gameUnits: GameUnitResult[] = [];
  for (const unit of directive.game_unit_plan.units) {
    const startIdx = croppedIds.indexOf(unit.unitRange.start);
    const endIdx = croppedIds.indexOf(unit.unitRange.end);
    const leafIds =
      startIdx >= 0 && endIdx >= startIdx ? croppedIds.slice(startIdx, endIdx + 1) : [unit.unitRange.start];

    const leafTemplates = leafIds.map((id) => dna.nodes[id]?.template).filter((t): t is NarrativeTemplate => !!t);
    const topTemplate = leafTemplates.length > 0 ? aggregateTemplates(leafTemplates) : emptyTemplate();
    // P0-2（§5.1b / Bug E）：游戏单元顶层模板（喂生成）的世界观/核心要素做 LLM 综合，
    // 替换多叶朴素拼接的冗长流水账——直接决定下游 vn/rpg 生成 prompt 的内核质量。多叶且有 LLM 时才综合。
    if (leafTemplates.length > 1 && options.llm) {
      const synth = await synthesizeParentTemplateFields(options.llm, title, topTemplate);
      topTemplate.worldview = synth.worldview;
      topTemplate.core_elements = synth.core_elements;
    }
    // §3.2 顶层算子：对游戏单元聚合 template 按 complete 层维度提取（与叶子微观算子并列）。
    const topOperators = options.llm
      ? await extractParentOperators(
          options.llm,
          { id: `gu_${unit.index}_top`, title: `${title}·游戏单元${unit.index}`, levelType: "complete" },
          topTemplate,
        )
      : [];
    const operatorLayers = collectLayeredOperators(dna, leafIds, topOperators);
    const operatorPool = flattenLayeredOperators(operatorLayers);

    emit({ phase: "mapping", message: `映射游戏单元 ${unit.index}（${leafIds.length} 单元）`, ratio: 0.6 });

    // 构建该游戏单元的 scoped IP DNA 切片（§5.1 第③步）：合成根挂聚合 template + 分层算子整池，
    // 子节点为该单元的最小叙事单元，供生成期按层选池注入（§3.2 / §7.2b）。
    const scopedDna = buildScopedDna(dna, unit.index, leafIds, topTemplate, operatorPool, {
      story_id: story_timestamp,
      title,
      media_type,
    });

    // 长记忆账本（§10）：从本单元顶层 template 沉淀一致性约束，供生成期注入。
    const unitLedger = buildLedgerFromTemplate(story_timestamp, title, topTemplate);

    // 原文切片（忠实改编参考）：优先按叶单元切；为空则回退该单元叶范围合并区间，仍空则回退全文，
    // 确保 uploaded_script.content 永不为空（§B1，下游规划/情节点据此显式引用原文）。
    let sourceText = leafIds.map((id) => sliceSubtreeText(dna, id, fullText)).join("\n").trim();
    if (!sourceText) {
      const ranges = leafIds
        .map((id) => dna.nodes[id]?.sourceRange)
        .filter((r): r is { start: number; end: number } => !!r);
      if (ranges.length > 0) {
        const start = Math.min(...ranges.map((r) => r.start));
        const end = Math.max(...ranges.map((r) => r.end));
        sourceText = fullText.slice(start, end).trim();
      }
      if (!sourceText) sourceText = fullText.trim();
    }
    const generationInput = buildGenerationInput(topTemplate, { storyTitle: title, sourceText });

    // Phase2c（§4.6）：把游戏单元映射到生成管线节点控制——
    //   RPG → global_control_params.target_structure（层级节点数控制）；
    //   VN  → vn_target_act_count（开放幕数）。
    // P0-1（§4.4d 目标输出形态锁定）：family 优先显式参数 → target_output 反推 → 缺省 vn。
    // IP 改编旗舰场景 = 互动叙事(影游/VN)，不再默认漂移到 rpg（修"上传小说想做影游却跑成 JRPG"）。
    const family: PipelineFamily =
      options.pipelineFamily ??
      familyFromTargetOutput(directive.game_unit_plan.target_output) ??
      "vn";
    const pipelinePlan = mapGameUnitToPipeline(unit, directive.game_unit_plan.mode, {
      family,
      defaultComplexity: options.targetComplexity,
      unitCount: leafIds.length, // P1-1：VN 开放幕数 = 源单元数（章→幕锚定）。
    });

    // P1-1（§5.1b 章→幕锚定）：VN 家族构建"幕↔源最小叙事单元"映射，让每幕忠实对应源作章节、
    // 按其事件脉络密度展开，修"E2 自由重切丢原文 + per-unit 提取被浪费"。仅 VN 构建；RPG/普通 VN 无此字段。
    const unitActMap =
      family === "vn"
        ? buildUnitActMap(
            leafIds.map((id) => {
              const n = dna.nodes[id];
              const s = n?.template?.summary;
              return {
                id,
                title: n?.title ?? id,
                summary: s?.events ?? "",
                characters: s?.characters ?? [],
                scene: s?.scene ?? "",
              };
            }),
          )
        : undefined;

    // KAG 关系网络注入（§8）：构图 → 简报 → 追加到用户输入 + 落盘图谱。
    let relationBrief: string | undefined;
    if (options.injectRelations !== false) {
      const graph = buildKagFromTemplate(topTemplate);
      relationBrief = renderRelationInjection(graph) || undefined;
      if (graph.edgeCount > 0) {
        graph.saveJsonl(
          path.join(extractionOutputDir(story_timestamp, title, media_type, { cwd: options.cwd }), `_kag_game_unit_${unit.index}`),
        );
      }
    }
    // 作者改编补充说明（§5.1 / §C4）：非空则追加，交下游 AI 分析改哪些维度并定点替换；
    // 为空＝忠实把原 IP 转化为目标品类叙事（行为不变）。
    const notesBlock = directive.adaptation_notes?.trim()
      ? `## 作者改编补充说明（请据此判断改编哪些维度并定点替换，其余维度忠实于原作）\n${directive.adaptation_notes.trim()}`
      : "";
    // §4.6b 系列结局收束：系列每部注入"承接/收束结局 + 结局数量上限"约束，防结局爆炸、保跨部承接。
    const endingBlock = buildSeriesEndingDirective(
      directive.game_unit_plan.mode,
      unit.index,
      directive.game_unit_plan.units.length,
    );
    const finalUserInput = [generationInput.userInput, relationBrief, notesBlock, endingBlock]
      .filter((s): s is string => !!s && s.length > 0)
      .join("\n\n");
    generationInput.userInput = finalUserInput;

    // 构建 A→B 类型化交接契约（唯一事实源，T4），再由 hydrate 统一注入 ctx。
    const seed: GenerationSeed = {
      storyTitle: title,
      storyTimestamp: story_timestamp,
      topTemplate,
      scopedDna,
      operatorLayers,
      ledger: unitLedger,
      adaptationDirective: directive,
      assetManifest: manifest,
      userInput: finalUserInput,
      uploadedScript: generationInput.uploadedScript,
      complexity: pipelinePlan.complexity,
      family,
      targetStructure: family === "rpg" ? pipelinePlan.targetStructure : undefined,
      // 幕数与幕锚定映射一致（章→幕）：有 map 时以 map 幕数为准，否则回退管线派生。
      vnActCount: unitActMap?.acts.length ?? pipelinePlan.vnActCount ?? resolveVnActCount(unit.targetNodeCount ?? 25),
      unitToActMap: unitActMap,
      relationNetwork: relationBrief,
    };
    const seedContext = hydrateContextFromSeed(seed);

    gameUnits.push({
      index: unit.index,
      leafIds,
      topTemplate,
      operatorPool,
      seed,
      seedContext,
      generationInput,
      relationBrief,
      pipelinePlan,
    });
  }

  // ── 长记忆账本（§10）：从各游戏单元顶层 template 沉淀一致性约束，落盘供生成/续写/改写侧复用。──
  const ledger = buildLedgerFromTemplate(story_timestamp, title, gameUnits[0]?.topTemplate ?? emptyTemplate());
  for (let i = 1; i < gameUnits.length; i++) {
    const sub = buildLedgerFromTemplate(story_timestamp, title, gameUnits[i].topTemplate);
    for (const e of sub.entries) appendLedger(ledger, { ref: `gu${gameUnits[i].index}.${e.ref}`, kind: e.kind, content: e.content, location: e.location });
  }
  // 续跑加载（§10 h9）：并入既有账本历史条目（按 ref 去重），保证多次运行约束累积不丢。
  mergeLedger(ledger, loadLedger(story_timestamp, title, { cwd: options.cwd }));
  saveLedger(ledger, { cwd: options.cwd });

  // ── 三视角算子装备 + 一步消费（可选；接 knowledge_base 语料，落算子方案 §6.4/§7.2b）──
  if (options.equipOperators && options.llm) {
    const retriever = buildCorpusRetriever();
    for (const gu of gameUnits) {
      const task = gu.generationInput.userInput;
      const { solution } = await equipAndConsume({
        story_id: story_timestamp,
        storyTitle: title,
        node: `game_unit_${gu.index}`,
        task,
        query: [gu.topTemplate.core_elements.theme, gu.topTemplate.core_elements.core_conflict]
          .filter(Boolean)
          .join(" "),
        extracted: gu.operatorPool,
        retriever,
        llm: options.llm,
      });
      gu.operatorSolution = solution;
      saveOperatorSolution(solution, title, { cwd: options.cwd });
    }
  }

  // ── 生成（可选）──
  const runGen = options.runGeneration !== false;
  let generatedAnyUnit = false;
  if (runGen) {
    const limit = options.maxGameUnits ?? gameUnits.length;
    const runner = options.generate ?? defaultGenerationRunner(options);
    const isSeries = directive.game_unit_plan.mode === "series";
    for (let i = 0; i < Math.min(limit, gameUnits.length); i++) {
      const gu = gameUnits[i];
      emit({
        phase: "generation",
        message: `生成游戏单元 ${gu.index}/${gameUnits.length}`,
        ratio: 0.7 + 0.3 * ((i + 1) / Math.max(1, Math.min(limit, gameUnits.length))),
      });
      // §4.6b 跨部承接：系列第 2 部起，把已累积账本（含上一部生成产物的世界/角色/结局决策）
      // 喂给本部生成，让下一部真正续上一部（此前各部只用自身模板账本、互不相通）。
      if (isSeries && i > 0) {
        gu.seed = { ...gu.seed, ledger };
        (gu.seedContext as Record<string, unknown>)._long_memory_ledger = ledger;
      }
      gu.generated = await runner({
        userInput: gu.generationInput.userInput,
        uploadedScript: gu.generationInput.uploadedScript,
        seed: gu.seed,
        seedCtx: gu.seedContext,
      });
      gu.outputDir = persistGenerated(story_timestamp, title, gu, options.cwd);
      // 账本回写（§10 h9）：把本单元生成产物的世界/角色/分支决策沉淀回账本，供后续单元/续写复用。
      harvestLedgerFromGenerated(ledger, gu.generated, { unitRef: `gu${gu.index}` });
      // 改编状态推进（§4.4c / §15.3）：本单元已生成 → 把其最小叙事单元节点标记为"已生成"，
      // 并以 run 引用回链 output 目录，供分阶段续改与字段级改写影响面（§4.4c 续改 / §15 反向追溯）消费。
      markUnitGenerated(dna, gu.leafIds, gu.outputDir);
      generatedAnyUnit = true;
    }
    // 生成产物沉淀后再次落盘账本（含回写条目）。
    saveLedger(ledger, { cwd: options.cwd });
    // 改编状态变更后重新落盘 IP DNA（覆盖生成前的 "未改编" 快照）：
    // _hierarchy.json 内联保留 metadata，故 adaptation_status 推进得以持久化，激活改写影响面。
    if (generatedAnyUnit) {
      propagateAdaptationStatus(dna);
      saveIpDna(dna, { cwd: options.cwd });
    }
  }

  // 历史可见性（§5.1）：流程收尾即把 output 运行清单翻为 completed（含游戏单元/已生成计数）。
  try {
    saveIpDnaRunManifest(story_timestamp, title, {
      status: "completed",
      completedAt: new Date().toISOString(),
      ipDnaPhase: "done",
      gameUnitCount: gameUnits.length,
      generatedCount: gameUnits.filter((g) => g.generated).length,
      tier: options.tier,
      mode: options.generationMode,
    }, { cwd: options.cwd });
  } catch { /* 落盘失败不阻断主链 */ }

  emit({ phase: "done", message: "IP DNA 端到端流程完成", ratio: 1 });
  return { story_timestamp, title, manifest, dna, directive, gameUnits, ledger, extractionQuality };
}

/**
 * 全自动端到端编排（向后兼容既有调用方/工具桥）：runIngest → runExtractAndGenerate。
 * 半自动逐步确认请改用 runIngest + （确认后）runExtractAndGenerate（见 api/server.ts 阶段门端点）。
 */
export async function runIpDnaPipeline(options: IpDnaOrchestratorOptions): Promise<IpDnaPipelineResult> {
  const ingest = await runIngest(options);
  const source: ExtractSource = {
    story_timestamp: ingest.story_timestamp,
    title: ingest.title,
    manifest: ingest.manifest,
    fullText: ingest.fullText,
    media_type: ingest.media_type,
    dna: ingest.dna,
    hydrated: ingest.hydrated,
  };
  return runExtractAndGenerate(options, source);
}

// ─────────────────────────────────────────────────────────────────
// 默认生成接缝：既有 NarrativePipeline
// ─────────────────────────────────────────────────────────────────

/**
 * 由编排器选项 + 生成种子构建生成期 PipelineConfig（纯函数，可单测）。
 *
 * Phase 2c（§4.6）核心接缝：让改编选定的管线家族真正驱动生成模板链。
 * 否则生成默认 design_auto 模式下模板由 genre_code 解析，而编排器不带 genre_code
 * 会退化为 rpg-jrpg→tpl-rpg，使 vn 家族内容仍误跑 RPG 层级链。
 * 把 family 映射到规范代表品类（vn→adv-interactive→tpl-vn-v2），且不覆盖调用方显式指定。
 *
 * 注意：不含 resumeCtx（不可序列化、与运行时耦合），由调用方水合后并入。
 */
export function buildGenerationPipelineConfig(
  options: Pick<IpDnaOrchestratorOptions, "pipelineConfig" | "tier" | "generationMode">,
  family: PipelineFamily,
): PipelineConfig {
  const base: PipelineConfig = { ...(options.pipelineConfig ?? {}) };
  if (!base.genreCode) {
    const repGenre = representativeGenreForFamily(family);
    if (repGenre) base.genreCode = repGenre;
  }
  // P0-1（§4.4d）：VN 家族缺省 = 纯互动叙事 vn_full——未显式指定或仅为通用 design_auto 时锁定 vn_full
  // （不跑 D0-D4 策划文档）；显式 vn_full / design_vn_full 等 VN 模式则尊重不覆盖。修"IP 改编跑成 design_auto"。
  const resolvedMode = options.generationMode ?? base.mode;
  const mode =
    family === "vn" && (!resolvedMode || resolvedMode === "design_auto") ? "vn_full" : resolvedMode;
  return {
    ...base,
    tier: options.tier ?? base.tier,
    mode,
  };
}

function defaultGenerationRunner(options: IpDnaOrchestratorOptions): GenerationRunner {
  return async ({ userInput, uploadedScript, seed }) => {
    const pipeline = new NarrativePipeline({
      ...buildGenerationPipelineConfig(options, seed.family),
      // NarrativePipeline 从类型化种子契约显式水合 ctx（T4）。
      resumeCtx: hydrateContextFromSeed(seed),
      // 下游逐步进度桥接（§图2）：提供 onGenerationProgress 时把生成管线进度透出，
      // 供 server 注册为 SSE run，让前端在 ip_* 前驱步之后继续显示下游叙事节点。
      ...(options.onGenerationProgress ? { onProgress: options.onGenerationProgress } : {}),
    });
    return pipeline.run(userInput, uploadedScript ? { uploadedScript } : undefined);
  };
}

// ─────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────

function safeToText(buf: Buffer): string {
  // 仅对可解码为文本的内容生效；二进制（图像/视频）返回空串（留多模态接口）。
  const looksBinary = (text: string): boolean => {
    const ctrl = (text.match(/[\u0000-\u0008\u000e-\u001f]/g) ?? []).length;
    return ctrl > text.length * 0.01;
  };
  try {
    const utf8 = buf.toString("utf-8");
    // UTF-8 出现大量替换字符 → 多半是 GBK 正文被误读,回退 gb18030（GBK 超集）。
    const replacements = (utf8.match(/\uFFFD/g) ?? []).length;
    if (replacements > 0 && replacements > utf8.length * 0.002) {
      try {
        const gbk = decodeGb18030(buf);
        if (!looksBinary(gbk)) return gbk;
      } catch {
        /* gb18030 解码失败 → 沿用 utf-8 结果 */
      }
    }
    return looksBinary(utf8) ? "" : utf8;
  } catch {
    return "";
  }
}

function persistProcessingText(timestamp: StoryTimestamp, title: string, media: IpMediaType, text: string, cwd?: string): void {
  if (!text.trim()) return;
  const dir = processingDir(timestamp, title, media, { cwd });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "standardized.txt"), text, "utf-8");
}

/**
 * 改编状态推进（§4.4c）：把已生成游戏单元的最小叙事单元节点标记为 "已生成"，并回链 output run。
 * 字段级改写影响面（§15.3 / phase4-rewrite.analyzeRewriteImpact）只对"已改编/已生成"节点生效，
 * 故此推进是激活该能力的关键一环（缺它则影响面恒为空）。
 */
function markUnitGenerated(dna: NarrativeIpDna, leafIds: string[], outputDir?: string): void {
  const now = new Date().toISOString();
  for (const id of leafIds) {
    const node = dna.nodes[id];
    if (!node) continue;
    const meta = node.metadata ?? { processing_status: "extracted", adaptation_status: "未改编" };
    meta.adaptation_status = "已生成";
    meta.updated_at = now;
    if (outputDir) meta.related_runs = [...new Set([...(meta.related_runs ?? []), outputDir])];
    node.metadata = meta;
  }
}

/**
 * 聚合改编进度（§4.4c "顶层节点汇总子树改编进度"）：自底向上为含子节点的节点推导状态——
 * 子全 "已生成" → "已生成"；子有任一进入改编/生成 → "改编中"；否则维持原状。
 */
function propagateAdaptationStatus(dna: NarrativeIpDna): void {
  const visit = (id: string): AdaptationStatus => {
    const node = dna.nodes[id];
    if (!node) return "未改编";
    if (!node.children || node.children.length === 0) {
      return node.metadata?.adaptation_status ?? "未改编";
    }
    const childStatuses = node.children.map(visit);
    const allGenerated = childStatuses.length > 0 && childStatuses.every((s) => s === "已生成");
    const anyActive = childStatuses.some((s) => s === "已生成" || s === "已改编" || s === "改编中");
    const status: AdaptationStatus = allGenerated ? "已生成" : anyActive ? "改编中" : "未改编";
    const meta = node.metadata ?? { processing_status: "extracted", adaptation_status: "未改编" };
    meta.adaptation_status = status;
    node.metadata = meta;
    return status;
  };
  visit(dna.rootId);
}

function persistGenerated(
  timestamp: StoryTimestamp,
  title: string,
  gu: GameUnitResult,
  cwd?: string,
): string {
  const dir = outputRunDir(timestamp, title, { cwd });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `game_unit_${gu.index}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ index: gu.index, leafIds: gu.leafIds, result: gu.generated }, null, 2),
    "utf-8",
  );
  return dir;
}

/**
 * 构建某游戏单元的 scoped IP DNA 切片：
 *   - 合成一个 root 节点（complete 层），挂该单元的聚合 template + 去重算子池；
 *   - 子节点 = 该单元覆盖的最小叙事单元（携带各自三件套），保证算子/关系可被遍历消费；
 *   - 标 scoped_to_game_unit，供前端/落盘识别。
 */
function buildScopedDna(
  full: NarrativeIpDna,
  gameUnitIndex: number,
  leafIds: string[],
  topTemplate: NarrativeTemplate,
  operatorPool: NarrativeOperator[],
  meta: { story_id: StoryTimestamp; title: string; media_type: NarrativeIpDna["media_type"] },
): NarrativeIpDna {
  const rootId = `scoped_gu_${gameUnitIndex}`;
  const nodes: Record<string, HierarchyNode> = {};
  const childIds: string[] = [];
  for (const id of leafIds) {
    const src = full.nodes[id];
    if (!src) continue;
    nodes[id] = { ...src, parent: rootId };
    childIds.push(id);
  }
  nodes[rootId] = {
    id: rootId,
    levelType: "complete",
    index: 0,
    title: `${meta.title}·游戏单元${gameUnitIndex}`,
    parent: null,
    children: childIds,
    template: topTemplate,
    operators: operatorPool,
    metadata: {
      processing_status: "extracted",
      adaptation_status: "改编中",
      stats: { unit_count: childIds.length, operator_count: operatorPool.length },
      updated_at: new Date().toISOString(),
    },
  };
  return {
    schema_version: full.schema_version,
    story_id: meta.story_id,
    title: meta.title,
    media_type: meta.media_type,
    rootId,
    nodes,
    scoped_to_game_unit: gameUnitIndex,
  };
}

function dedupeOperators(ops: NarrativeOperator[]): NarrativeOperator[] {
  const map = new Map<string, NarrativeOperator>();
  for (const op of ops) if (op?.uid && !map.has(op.uid)) map.set(op.uid, op);
  return [...map.values()];
}

function emptyTemplate(): NarrativeTemplate {
  return {
    worldview: { setting: "", scene_structure: "", item_inventory: "" },
    characters: [],
    story_structure: { topology: { nodeCount: 0, startCount: 0, endCount: 0, pivotCount: 0, mergeCount: 0 } },
    core_elements: { subject: "", theme: "", core_conflict: "", literature_style: "", emotion_experience: "" },
    summary: { characters: [], scene: "", events: "" },
  };
}
