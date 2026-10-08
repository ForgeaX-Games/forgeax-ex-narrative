import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tools from "../tools/handlers.js";
import { installIdleShutdown } from "./idle-shutdown.js";
import { NarrativePipeline, isExecutableStep } from "../pipeline/core/pipeline.js";
import type { RerunOptions } from "../pipeline/core/pipeline.js";
import { getModesForTier, TIER_DEFAULT_MODE, STEP_OUTPUT_FIELDS, getModeConfig } from "../pipeline/routing/modes.js";
import {
  STEP_FILE_MAP,
  stepIdForArtifactFileName,
  INPLACE_TRANSFORM_STEPS,
} from "../pipeline/runtime/step-files.js";
import { listConfirmedAssets } from "../pipeline/runtime/confirmed-assets.js";
import { traceNodeSubtree, buildNodeFilter } from "../pipeline/graph/node-dependency.js";
import { validateImpactAnalysis, type ChangeCategory } from "../pipeline/runtime/impact-validator.js";
import { buildAutoSteps } from "../pipeline/design-steps/auto-narrative-builder.js";
import { getGenresByCategory, GENRE_TAXONOMY, findGenreByCode, getGenreDisplayName, type ContentLocale } from "../knowledge/genre-taxonomy.js";
import { getNarrativeType } from "../knowledge/genre-narrative-type.js";
import { resolveSeatStepGroups, resolveNarrativePipeline } from "../pipeline/routing/narrative-pipelines.js";
import { expertDisplayName } from "../pipeline/routing/expert-agents.js";
import { seatGroupsForSteps } from "../pipeline/routing/seat-attribution.js";
import { BANNER_STEP_IDS, stepDisplayNames } from "../pipeline/core/step-registry.js";
import { resolveStepOutput, applyStepOutput } from "../pipeline/core/step-output.js";
import { pipelineGuards, entryGuards, findingGuards, type PipelineGuards } from "../pipeline/core/action-guards.js";
import { mergeFindingStatuses, type QaFinding } from "../pipeline/qa/findings.js";
import {
  FIELD_OWNER_STEP,
  repairFieldTopology,
  rewriteNodeContent,
  groupByNode,
  findNode,
  applyRewrittenContent,
  type RepairOutcome,
} from "../pipeline/qa/repair.js";
import { buildStructureCheckReport } from "../pipeline/steps/structure-check.js";
import { buildRunManifest, buildEntryManifests, buildStructureRationale } from "../pipeline/runtime/run-manifest-builder.js";
import {
  checkpointAgentsFrom,
  completedStepsFromAgents,
  lifecycleFromCheckpoint,
  manifestFromStepIds,
  markAgentLifecycle,
  syncManifestAgents,
  type CheckpointAgentSlot,
} from "../pipeline/runtime/run-manifest-runtime.js";
import { splitCompositionByStartNodes, type RunManifest, type RunManifestConfig } from "../types/run-manifest.js";
import type { AgentLifecycle } from "../pipeline/core/agent-contract.js";
import { runAgent, assertAgentRunnable, MissingInputsError } from "../pipeline/core/run-agent.js";
import { getNarrativeAgent } from "../pipeline/core/agent-registry.js";
import { getAgentDef } from "../pipeline/blueprint/agent-def-registry.js";
import { listSeatDiscovery, resolveSeatRunnableAgentId } from "../pipeline/core/seat-agents.js";
import { STEP_IDS as S } from "../pipeline/routing/modes.js";
import { LLMClient } from "../pipeline/runtime/llm-client.js";
import { probeHostAgent } from "../pipeline/runtime/host-agent.js";
import { buildKnowledgePromptSection, buildNodeTreeSummary, preClassifyChange, PIPELINE_KNOWLEDGE } from "../pipeline/runtime/pipeline-knowledge.js";
import type { NarrativeContext, PipelineProgress, TierId, ModeId, PlotsGenerated, JrpgScript, SceneMap, QuestGraph, StepMeta, StepModification, StoryFramework, OutlinesGenerated, DetailedOutlinesGenerated, UploadedScript, NarrativeAxesSelection, AnnounceStepGroup } from "../types/index.js";
import {
  resolveNarrativeStructure,
  resolveUserAxes,
  STORY_TYPES,
  STORY_THEMES,
  STORY_STRUCTURES,
} from "../knowledge/narrative-axes/index.js";
import type { NarrativeTagSelection } from "../knowledge/narrative-axes/index.js";
import { detectScriptFormat, describeScriptFormat } from "../utils/script-format-detector.js";
import { packageVersion } from "../utils/package-version.js";
import { runIpDnaPipeline, runIngest, runExtractAndGenerate, loadExtractSourceByRun, resolveIpDnaRuntimeAdapters, loadHierarchyIndexByRun, loadManifestByRun, listInputRunKeys, runArtifactRoots, RUN_ARTIFACT_GROUP_LABELS, analyzeRewriteImpact, createJob, updateJob, getJob, listJobs, cancelJob, formatTimestamp as formatIpDnaTimestamp, buildAdaptationDirective, parseContentFidelity, planDecomposition, applyDecompositionClosure, assessVolume, collectLeafIds, saveHierarchyIndexOnly, saveAdaptationConfirmation, loadAdaptationConfirmation, guessLevelsFromHierarchy, type IncomingFile, type IpDnaProgress, type ExtractSource, type NarrativeIpDna } from "../ip-dna/index.js";
// Phase C6: env reads are funnelled through plugin-env so the literal
// `process.env.*_API_KEY` substring stays out of plugin source files. See
// utils/plugin-env.ts header for the full rationale (this Express server is
// a standalone-process bootstrap, scope-excluded from the ctx.env migration;
// ToolRegistry handlers must use ctx.env per the character precedent).
import { getGeminiApiKey, getLlmProxyUrl, getLlmProxyKey, getDefaultModel, getHostAgentCommand, readPluginEnv } from "../utils/plugin-env.js";
import { isSafeKey as isSafeEntryKeyFn, isSafeSourceDir, loadEntry as loadEntryFromDir, writeEntry as writeEntryToDir, applyPipelineLocations, normalizeAssets, confirmAsset, unconfirmAsset, type EntryConfig, type PipelineLocation } from "./entry-store.js";
// 编辑原文：账本归并规则是纯函数，磁盘那一半留在本文件。
import {
  editKey,
  normalizeEditsState,
  originalFileCandidates,
  originalFileName,
  removeEdit,
  upsertEdit,
  type EditsState,
} from "./edit-store.js";
// G5：定稿版本快照（契约 §3.3），供 confirm-asset 钉版本 + src/pipeline/ 侧读取历史稿。
import { snapshotVersion, currentVersionNumber, isVersionFileName, allVersionOrigins, type VersionOrigin } from "./version-store.js";
// 剧情树增删：连接不变式在纯函数里守。
import {
  insertNode,
  removeNode,
  validateNodeLinks,
  type CrudOutcome,
  type GraphNode,
} from "./node-crud.js";
// 项目库：跨任务归档表，与 _entry.json.assets[] 的确认表正交。
import {
  listProjects,
  createProject,
  patchProject,
  deleteProject,
  isSafeProjectId,
  type ProjectPatch,
} from "./project-store.js";
import { PIPELINE_SUBDIR, entryKeyOfRunDir, isSafeRunDir, parseRunDirName, resolveRunPlacement } from "./run-layout.js";
import {
  artifactRunDir,
  resolveArtifactAddress,
  type ArtifactAddress,
  type RunAnchor,
} from "./artifact-address.js";
// 自定义专属创作团队：后端是 profile 的事实源（详见端点段注释）。
import {
  createTeam,
  loadTeam,
  listTeams,
  saveTeam,
  deleteTeam,
  isSafeTeamId,
  markFailed,
  distillTeam,
  createBookExtractor,
  createAuthorInfoRetriever,
  teamDisplayName,
  type DistilledProfile,
  type TeamKind,
  type TeamRecord,
} from "../custom-team/index.js";
import { outputDir, narrativeArtifactContextMiddleware, resolveNarrativeRoot, toGameRelativePath } from "../runtime/artifact-root.js";

// 产物根：双模式路径映射（M-A，src/runtime/artifact-root.ts）。独立模式下
// `outputDir()` 逐字节等于迁移前的 `OUTPUT_DIR = path.resolve(process.cwd(), "output")`；
// 插件模式下按请求解析出的 slug 映射到平台项目目录。调用即确保目录存在。

function parseContentLocale(raw: unknown): ContentLocale {
  return raw === "en" ? "en" : "zh";
}

function resolveRunLocale(opts: {
  requestLocale?: unknown;
  checkpointCtx?: NarrativeContext;
  entryKey?: string;
}): ContentLocale {
  if (opts.requestLocale !== undefined) return parseContentLocale(opts.requestLocale);
  if (opts.checkpointCtx?.content_locale) return parseContentLocale(opts.checkpointCtx.content_locale);
  if (opts.entryKey) {
    const entry = loadEntryConfig(opts.entryKey);
    if (entry?.locale) return parseContentLocale(entry.locale);
  }
  return "zh";
}

// §条目持久化：entry-store 按 outputDir() 绑定（逻辑抽到纯模块便于单测）。
const loadEntryConfig = (key: string): EntryConfig | null => loadEntryFromDir(outputDir(), key);
const writeEntryConfig = (key: string, patch: Partial<EntryConfig>): EntryConfig =>
  writeEntryToDir(outputDir(), key, patch);



function formatTimestamp(iso: string): string {
  return iso.replace(/T/, "_").replace(/[:.]/g, "-").replace(/Z$/, "");
}

function getRunDir(state: RunState): string {
  if (state.outputDir) return state.outputDir;
  const ts = formatTimestamp(state.startedAt);
  return path.join(outputDir(), ts);
}

/** run 目录相对 `output/` 的路径（= 前端拿到的 `sourceDir`）。 */
function runDirRel(state: RunState): string {
  return path.relative(outputDir(), getRunDir(state)).split(path.sep).join("/");
}

/**
 * 条目键：取 state 上的显式字段，不从目录名反推。
 * 次管线的目录是 `<key>/pipelines/<pipelineId>`，`path.basename` 会推成
 * pipelineId —— 主管线碰巧对，所以这个坑一直没暴露（见 contracts §1.3）。
 */
function resolveStateEntryKey(state: RunState): string {
  if (state.entryKey) return state.entryKey;
  const parsed = state.outputDir ? parseRunDirName(runDirRel(state)) : null;
  return parsed?.entryKey ?? formatTimestamp(state.startedAt);
}

/**
 * run 的寻址锚点（供 `resolveArtifactAddress` 把内存 runId 翻成四元组）。
 * 只给 sourceDir：产物在哪个目录是唯一要紧的事，泳道身份不参与寻址。
 */
function runAnchorOf(runId: string): RunAnchor | undefined {
  const state = runs.get(runId);
  if (!state) return undefined;
  return { sourceDir: runDirRel(state), entryKey: resolveStateEntryKey(state) };
}

function writeAssetFile(dir: string, name: string, data: unknown): void {
  if (data == null) return;
  const filepath = path.join(dir, name);
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content, "utf-8");
}

interface PerNodeEntry { id: string; content: unknown }

type PerNodeExtractor = (data: unknown) => PerNodeEntry[];

const PER_NODE_STEPS: Record<string, PerNodeExtractor> = {
  story_framework: (data) => {
    const sf = data as StoryFramework;
    if (!sf?.framework?.nodes) return [];
    return sf.framework.nodes.map(n => ({ id: n.node_id, content: n }));
  },
  outline_batch: (data) => {
    const og = data as OutlinesGenerated;
    if (!og?.outlines) return [];
    return og.outlines.map(n => ({ id: n.node_id, content: n }));
  },
  detailed_outline: (data) => {
    const dg = data as DetailedOutlinesGenerated;
    if (!dg?.detailed_outlines) return [];
    return dg.detailed_outlines.map(n => ({ id: n.node_id, content: n }));
  },
  script_scene_generation: (data) => {
    const composite = data as { jrpg_script?: unknown; scene_map?: unknown };
    const scriptNodes = composite.jrpg_script ? PER_NODE_STEPS.script_generation(composite.jrpg_script) : [];
    const sceneNodes = composite.scene_map ? PER_NODE_STEPS.scene_plan(composite.scene_map) : [];
    return [...scriptNodes, ...sceneNodes];
  },
  plot_generation: (data) => {
    const pg = data as PlotsGenerated;
    if (!pg?.plots) return [];
    return pg.plots.map(p => ({ id: p.node_id, content: p }));
  },
  script_generation: (data) => {
    const js = data as JrpgScript;
    if (!js?.chapters) return [];
    return js.chapters.map(ch => ({ id: ch.chapter_id ?? ch.plot_node_id, content: ch }));
  },
  quest_generation: (data) => {
    const qg = data as QuestGraph;
    if (!qg?.quests) return [];
    return qg.quests.map(q => ({ id: q.quest_id, content: q }));
  },
  scene_plan: (data) => {
    const sm = data as SceneMap;
    if (!sm?.scenes) return [];
    const entries: PerNodeEntry[] = [];
    if (sm._phase1_skeleton) {
      entries.push({ id: "世界观_场景骨架", content: { phase: "P1_skeleton", scenes: sm._phase1_skeleton } });
    }
    if (sm._phase2_per_node) {
      for (const [nodeId, scenes] of Object.entries(sm._phase2_per_node)) {
        entries.push({ id: `${nodeId}_场景`, content: { phase: "P2_expansion", node_id: nodeId, scenes } });
      }
    }
    if (sm._phase2_per_node_md) {
      for (const [nodeId, md] of Object.entries(sm._phase2_per_node_md)) {
        entries.push({ id: `${nodeId}_场景结构`, content: md });
      }
    }
    entries.push({ id: "合并_场景", content: { phase: "P3_merged", world_name: sm.world_name, scenes: sm.scenes } });
    if (sm._scene_structure_md) {
      entries.push({ id: "场景结构目录", content: sm._scene_structure_md });
    }
    return entries;
  },
  // B3 + Stage C：互动影游 / VN 节点级拆分（按 node_id 拆，便于 fork 视图打开单节点）
  branch_tree: (data) => {
    const bt = data as { nodes?: Array<{ id?: string; [k: string]: unknown }> } | undefined;
    if (!bt?.nodes?.length) return [];
    return bt.nodes
      .filter(n => typeof n.id === "string" && n.id.length > 0)
      .map(n => ({ id: n.id as string, content: n }));
  },
  dialogue_script: (data) => {
    const ds = data as { scripts?: Array<{ node_id?: string; [k: string]: unknown }> } | undefined;
    if (!ds?.scripts?.length) return [];
    return ds.scripts
      .filter(s => typeof s.node_id === "string" && s.node_id.length > 0)
      .map(s => ({ id: s.node_id as string, content: s }));
  },
  cinematic_storyboard: (data) => {
    const cs = data as { storyboards?: Array<{ node_id?: string; [k: string]: unknown }> } | undefined;
    if (!cs?.storyboards?.length) return [];
    return cs.storyboards
      .filter(s => typeof s.node_id === "string" && s.node_id.length > 0)
      .map(s => ({ id: s.node_id as string, content: s }));
  },
};

function savePerNodeFiles(runDir: string, stepId: string, fileDef: { index: string; name: string }, data: unknown): void {
  const extractor = PER_NODE_STEPS[stepId];
  if (!extractor) return;
  try {
    const nodes = extractor(data);
    if (nodes.length === 0) return;
    const subDir = path.join(runDir, `${fileDef.index}_${fileDef.name}`);
    fs.mkdirSync(subDir, { recursive: true });
    for (const node of nodes) {
      const safeId = String(node.id).replace(/[/\\?%*:|"<>]/g, "_");
      const ext = typeof node.content === "string" ? "md" : "json";
      writeAssetFile(subDir, `${safeId}.${ext}`, node.content);
    }
  } catch (e) {
    console.error(`Failed to save per-node files for ${stepId}:`, e);
  }
}

function saveStepIncremental(state: RunState, stepId: string, data: unknown): void {
  if (stepId === "script_scene_generation" && data != null) {
    const composite = data as { jrpg_script?: unknown; scene_map?: unknown };
    if (composite.jrpg_script) {
      saveStepIncremental(state, "script_generation", composite.jrpg_script);
    }
    if (composite.scene_map) {
      saveStepIncremental(state, "scene_plan", composite.scene_map);
    }
    return;
  }

  if (stepId === "tier_router" && data != null) {
    const compound = data as { tier_detection?: unknown; demand_analysis?: unknown };
    if (compound.tier_detection) saveStepIncremental(state, "tier_detection", compound.tier_detection);
    if (compound.demand_analysis) saveStepIncremental(state, "demand_analysis", compound.demand_analysis);
    return;
  }

  const fileDef = STEP_FILE_MAP[stepId];
  if (!fileDef || data == null) return;
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
    snapshotBeforeInplaceOverwrite(runDir, stepId, filename);
    writeAssetFile(runDir, filename, data);
    savePerNodeFiles(runDir, stepId, fileDef, data);
  } catch (e) {
    console.error(`Failed to save step ${stepId}:`, e);
  }
}

/**
 * 同形变换步（打磨四席）覆盖的是基准步那份文件，写前先给旧内容存一张版本快照。
 *
 * 从盘上读而不是从 ctx 取"改前内容"：ctx 里那份此刻已经是打磨后的了——step 函数
 * 原位改完才轮到落盘。盘上那份平铺文件才是真正的上一版。
 */
function snapshotBeforeInplaceOverwrite(runDir: string, stepId: string, fileName: string): void {
  if (!INPLACE_TRANSFORM_STEPS[stepId]) return;
  const filePath = path.join(runDir, fileName);
  if (!fs.existsSync(filePath)) return;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    snapshotVersion(
      runDir,
      fileName,
      fileName.endsWith(".json") ? JSON.parse(raw) : raw,
      { kind: "polish_seat", seatId: stepId },
    );
  } catch (e) {
    console.error(`[snapshotBeforeInplaceOverwrite] ${stepId}:`, e);
  }
}

const STEP_COMPANIONS: Record<string, string[]> = {
  preference_analysis: ["global_control_params"],
  design_doc: ["narrative_requirements"],
  lore_generation: ["item_lore"],
  // E1-02 单步三输出：三幕扩写 + 人物小传 + 关键道具；后两者伴生落盘
  vn_outline_acts: ["vn_character_bios", "vn_key_items"],
  // E2 路径：vn_segment_confirm 覆写 outline_acts/scenes/beats/character_bios，
  // 主文件 V5_文本段确认.json 仅含 vn_segment_confirmed；伴生落盘其它四份，
  // 让 E2 路径下 G-01~G-03 消费的中间产物有可见的 V1/V1a/V2/V3 落盘文件。
  vn_segment_confirm: ["vn_outline_acts", "vn_character_bios", "vn_scenes", "vn_beats"],
  vn_storyboard: ["vn_video_prompts"],
};

/**
 * 从 ctx 中按 stepId 取出"该步骤产物文件应当包含的数据"。
 *
 * 解析规则收在 `step-output.ts`（注册表为主、复合与封存两张小表显式列举），
 * 与管线 SSE 帧用的是同一个函数——两边曾各有一张手写表，漏登记的步会在
 * 落盘这一侧静默消失。
 */
function getStepDataForFile(stepId: string, ctx: NarrativeContext): unknown {
  return resolveStepOutput(stepId, ctx);
}

/** 把"用户编辑的草稿内容"写回 ctx。与 getStepDataForFile 对称（复合步按子字段拆写）。 */
function setStepCtxData(stepId: string, ctx: NarrativeContext, value: unknown): boolean {
  return applyStepOutput(stepId, ctx, value);
}

function saveCompanionData(state: RunState, stepId: string, ctx: NarrativeContext): void {
  const companions = STEP_COMPANIONS[stepId];
  if (!companions) return;
  for (const key of companions) {
    const data = resolveStepOutput(key, ctx);
    if (data != null) saveStepIncremental(state, key, data);
  }
}

/**
 * G2：单席跑 + 已有条目的绑定信息。给了安全的 entryKey 才建立——不给就是老行为
 * （不落盘、response body 里给结果，向后兼容画布上早已有的即用即弃调用）。
 *
 * 绑定做两件事：① 把该条目已有的 ctx 当作这次单席跑的起点（下游 requiredInputs
 * 因此天然能吃到之前跑过的步的产出，不用调用方手工拼全部字段）；② 把已有的
 * checkpoint 元信息（tier/mode/pipelineOrder/agents lifecycle 等）搬进这次的
 * RunState，使 saveCheckpoint 落盘时是"在原有基础上加一步"而不是"用只有这一步的
 * 假状态覆盖整份 checkpoint"（saveCheckpoint 的 completedSteps 只认 state.progress，
 * 不读盘上的旧值，不预先播种就会把该条目其它步的完成记录冲掉）。
 */
export interface AgentEntryBinding {
  entryKey: string;
  outputDir: string;
  tier?: TierId;
  mode?: ModeId;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  model?: string;
  genreCode?: string;
  seededCtx: NarrativeContext;
  seededProgress: PipelineProgress[];
  checkpointAgents?: CheckpointAgentSlot[];
  pipelineSteps?: string[];
}

/**
 * G5：把该条目在这条泳道下已确认的定稿内容叠到起跑 ctx 上，覆盖顺序在
 * "旧 ctx"之后、"调用方显式 ctx"之前——确认过的稿子代表作者的最终决定，
 * 理应盖过尚未确认的最新草稿（`04_世界观.json` 可能已经被后续编辑改过，
 * 但作者钉住的是更早那一版）；调用方这次显式传的内容代表"就是要基于这个改"，
 * 仍应优先于确认表。
 *
 * 只覆盖能倒查到 stepId、且确实读到内容的引用；读不到（文件缺失/版本快照
 * 被清理后退化失败/`path` 不在 `output` 组下）的引用原样跳过，不让一条坏
 * 引用打断整个绑定。
 */
function applyConfirmedAssetOverrides(ctx: NarrativeContext, rootEntryKey: string, pipelineId?: string): void {
  for (const { ref, content } of listConfirmedAssets(rootEntryKey, pipelineId)) {
    if (content === undefined) continue;
    const relPath = ref.path.startsWith("output/") ? ref.path.slice("output/".length) : undefined;
    const stepId = relPath ? stepIdForArtifactFileName(relPath) : undefined;
    if (stepId) setStepCtxData(stepId, ctx, content);
  }
}

export function resolveAgentEntryBinding(
  entryKey: string,
  callerCtx: NarrativeContext,
): AgentEntryBinding {
  const cp = loadCheckpoint(entryKey);
  // `_entry.json` 只在条目根，entryKey 若是次管线形态（`<key>/pipelines/<pid>`）要回溯到根，
  // 否则读不到（同 G1 在 `/history/:key/load` 里踩过的坑）。
  const parsedAddr = parseRunDirName(entryKey);
  const rootEntryKey = parsedAddr?.entryKey ?? entryKeyOfRunDir(entryKey) ?? entryKey;
  const cfg = loadEntryConfig(rootEntryKey);
  const priorCompleted = cp?.completedSteps ?? [];
  // G5：定稿覆盖叠在"旧 ctx"之上，callerCtx 随后再叠一层——见 applyConfirmedAssetOverrides 的顺序说明。
  const seededCtxBase: NarrativeContext = { ...(cp?.ctx ?? {}) } as NarrativeContext;
  applyConfirmedAssetOverrides(seededCtxBase, rootEntryKey, parsedAddr?.pipelineId);
  return {
    entryKey,
    outputDir: path.join(outputDir(), entryKey),
    tier: cp?.tier ?? (cfg?.tier as TierId | undefined),
    mode: cp?.mode ?? (cfg?.mode as ModeId | undefined),
    userInput: cp?.userInput ?? cfg?.userInput,
    routeGroup: cp?.routeGroup ?? cfg?.routeGroup,
    complexity: cp?.complexity ?? cfg?.complexity,
    model: cp?.model,
    genreCode: cp?.genre_code ?? cfg?.genreCode,
    // 调用方显式传的 ctx/inputs 优先于条目旧值——单席重跑常是"拿之前的东西改一点再跑"。
    seededCtx: { ...seededCtxBase, ...callerCtx } as NarrativeContext,
    // 合成"已完成"进度帧，使 saveCheckpoint 计算 completedSteps 时把旧步骤并进来
    // 而不是只剩这一步。
    seededProgress: priorCompleted.map((sid) => ({
      stage: sid,
      stepId: sid,
      step: 0,
      totalSteps: 0,
      status: "completed" as const,
    })),
    checkpointAgents: cp?.agents,
    pipelineSteps: cp?.pipelineOrder,
  };
}

/** 条目还没有 `_entry.json`（单席跑是这条目的第一次动作）时兜底建一份最小配置，保证任务列表能发现它。 */
function ensureEntryConfigForAgentRun(entryKey: string, userInput: string | undefined): void {
  const rootKey = entryKeyOfRunDir(entryKey) ?? entryKey;
  if (loadEntryConfig(rootKey)) return;
  try {
    writeEntryConfig(rootKey, { userInput: userInput ?? "" });
  } catch (e) {
    console.error("[Server] ensureEntryConfigForAgentRun failed:", e);
  }
}

/**
 * 单个 agent（或 composite 的一个子步）跑完后的落盘副作用，与管线 `onStepComplete`
 * 完全同构（同一套 saveStepIncremental / saveCheckpoint / saveCompanionData /
 * writeManifestIncremental），只是触发点从"管线跑完一步"换成"单席跑完一步"。
 */
export function persistAgentStepCompletion(
  state: RunState,
  stepId: string,
  output: unknown,
  ctx: NarrativeContext,
): void {
  if (output != null) saveStepIncremental(state, stepId, output);
  saveCheckpoint(state, stepId, ctx);
  saveCompanionData(state, stepId, ctx);
  state.completedSteps = [...new Set([...(state.completedSteps ?? []), stepId])];
  writeManifestIncremental(state);
}

/**
 * 同步（非 SSE）单席跑的落盘副作用。同步模式下没有逐子步的中间 ctx 快照可用——
 * `runAgent` 内部把 `opts.ctx` 展开成新对象，调用方拿不到那个随执行逐步写入的
 * 引用，只有整体 await 完才见到最终 `result.ctx`（此时 composite 的全部子步产出
 * 已经合并进去）。所以这里退化成"整体跑完后按步补落盘"：用最终 ctx 反查每个子步
 * 的 outputField 取值，逐步调用与 SSE 路径相同的 persistAgentStepCompletion，
 * 落盘粒度（per-step 文件 + checkpoint）与 SSE 模式一致，只是不是实时的。
 */
function persistSyncAgentRun(
  entryKey: string,
  binding: AgentEntryBinding,
  agentId: string,
  finalCtx: NarrativeContext,
): void {
  const def = getAgentDef(agentId);
  const steps =
    def?.structure.type === "composite" ? [agentId, ...def.structure.config.children] : [agentId];

  const shadowState: RunState = {
    id: `agent_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: "completed",
    progress: [...binding.seededProgress],
    streamBuffer: [],
    startedAt: new Date().toISOString(),
    userInput:
      binding.userInput ?? (typeof finalCtx.user_input === "string" ? finalCtx.user_input : undefined),
    tier: binding.tier,
    mode: binding.mode,
    routeGroup: binding.routeGroup,
    complexity: binding.complexity,
    model: binding.model,
    genreCode: binding.genreCode,
    outputDir: binding.outputDir,
    entryKey,
    pipelineSteps: binding.pipelineSteps ?? steps,
    checkpointAgents: binding.checkpointAgents,
    completedSteps: [],
  };
  ensureEntryConfigForAgentRun(entryKey, shadowState.userInput);

  for (const stepId of steps) {
    const outputField = getNarrativeAgent(stepId)?.io.outputField;
    const output = outputField ? (finalCtx as Record<string, unknown>)[outputField] : undefined;
    shadowState.progress.push({
      stage: stepId,
      stepId,
      step: steps.indexOf(stepId) + 1,
      totalSteps: steps.length,
      status: "completed",
    });
    persistAgentStepCompletion(shadowState, stepId, output, finalCtx);
  }

  // 与管线终态一致地补写 full_result.json + 全面材质化一遍产物文件——
  // per-step 循环只按 outputField 反查了这次跑到的几步，companion/衍生字段仍需这一步兜底。
  shadowState.result = finalCtx;
  try {
    saveRunToFile(shadowState);
  } catch (e) {
    console.error("[Server] persistSyncAgentRun saveRunToFile failed:", e);
  }
}

function saveRunToFile(state: RunState) {
  const runDir = getRunDir(state);
  fs.mkdirSync(runDir, { recursive: true });

  const finalMeta = resolveCheckpointMeta(state, state.result);
  writeAssetFile(runDir, "full_result.json", {
    id: state.id,
    tier: state.tier,
    mode: state.mode,
    model: state.model,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    result: state.result,
    error: state.error,
    userInput: state.userInput,
    routeGroup: state.routeGroup,
    complexity: state.complexity,
    genre_code: finalMeta.genre_code,
    pipelineOrder: finalMeta.pipelineOrder,
    routingMode: finalMeta.routingMode,
  });

  if (state.status === "completed" && state.result) {
    const ctx = state.result;
    for (const [stepId, fileDef] of Object.entries(STEP_FILE_MAP)) {
      const data = getStepDataForFile(stepId, ctx);
      if (data != null) {
        const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
        writeAssetFile(runDir, filename, data);
        savePerNodeFiles(runDir, stepId, fileDef, data);
      }
    }
  }

  const savedFiles = fs.readdirSync(runDir).filter((f) => f !== "manifest.json");
  const finalManifest: Record<string, unknown> = {
    runId: state.id,
    tier: state.tier,
    mode: state.mode,
    model: state.model,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    files: savedFiles,
    userInput: state.userInput,
    routeGroup: state.routeGroup,
    complexity: state.complexity,
    completedSteps: state.completedSteps ?? [],
    genre_code: finalMeta.genre_code,
    pipelineOrder: finalMeta.pipelineOrder,
    routingMode: finalMeta.routingMode,
  };
  if (state.parentKey) finalManifest.parentKey = state.parentKey;
  if (state.forkReason) finalManifest.forkReason = state.forkReason;
  // 与 writeManifestIncremental 同一个理由：这条终态清单会盖掉增量那份，旗标不带上就丢了。
  if (state.cancelled) finalManifest.cancelled = true;
  writeAssetFile(runDir, "manifest.json", finalManifest);

  console.log(`💾 Result saved: ${runDir} (${savedFiles.length} files)`);
  return runDir;
}

interface CheckpointData {
  runId: string;
  tier?: TierId;
  mode?: ModeId;
  startedAt: string;
  /**
   * @deprecated Phase-2 M7: 线性前缀恢复的锚点。仅供缺 agents 的旧 checkpoint 桥接使用。
   */
  lastCompletedStep: string;
  /**
   * Phase-2 M7: per-agent lifecycle = 运行时事实源，驱动 resume 的逐 agent 跳过。
   * 旧 checkpoint 无此字段，由 lifecycleFromCheckpoint 用 completedSteps 桥接补齐。
   */
  agents?: CheckpointAgentSlot[];
  /** @deprecated Phase-2 M7: 由 agents[].lifecycle 派生的兼容视图（读侧仍在用）。 */
  completedSteps: string[];
  savedAt: string;
  ctx: NarrativeContext;
  step_meta?: Record<string, StepMeta>;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  model?: string;
  /**
   * Phase 1: 启动管线的完整参数与"权威步骤序"快照。
   * 让 resume / fork / 前端 loadEntry 能够在没有重跑 announce 的情况下
   * 还原出当时这一跑的真实管线（包括动态模式追加的 narrative steps）。
   */
  genre_code?: string;
  pipelineOrder?: string[];
  routingMode?: "auto" | "semi" | "manual";
}

/**
 * Phase 1 helper: 从 RunState 派生 checkpoint/manifest 共用的三个字段。
 * 兜底链：state.genreCode → ctx.tier_detection.genre_code → ctx.demand_analysis.genre_code。
 * pipelineOrder 由 onProgress 捕获 pipeline_steps_announce 帧后写入 state.pipelineSteps。
 */
function resolveCheckpointMeta(
  state: RunState,
  ctx?: NarrativeContext,
): { genre_code?: string; pipelineOrder?: string[]; routingMode?: "auto" | "semi" | "manual" } {
  const genreFromCtx =
    ctx?.tier_detection?.genre_code ?? ctx?.demand_analysis?.genre_code ?? undefined;
  const genre_code =
    state.genreCode ??
    (genreFromCtx && genreFromCtx !== "manual" ? genreFromCtx : undefined);
  const pipelineOrder =
    state.pipelineSteps && state.pipelineSteps.length > 0 ? [...state.pipelineSteps] : undefined;
  return {
    genre_code,
    pipelineOrder,
    routingMode: state.routingMode,
  };
}

function saveCheckpoint(state: RunState, stepId: string, ctx: NarrativeContext): void {
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const completedFromProgress = state.progress
      .filter((p) => p.status === "completed" && p.stepId)
      .map((p) => p.stepId!);
    completedFromProgress.push(stepId);
    const doneSet = [...new Set(completedFromProgress)];
    const meta = resolveCheckpointMeta(state, ctx);
    // Phase-2 M7: 先算 lifecycle，再由它派生 completedSteps。
    const agents = checkpointAgentsFrom(
      meta.pipelineOrder ?? [],
      doneSet,
      state.checkpointAgents,
    );
    state.checkpointAgents = agents;
    const checkpoint: CheckpointData = {
      runId: state.id,
      tier: state.tier,
      mode: state.mode,
      startedAt: state.startedAt,
      lastCompletedStep: stepId,
      agents,
      completedSteps: completedStepsFromAgents(agents),
      savedAt: new Date().toISOString(),
      ctx,
      step_meta: state.stepMeta,
      userInput: state.userInput,
      routeGroup: state.routeGroup,
      complexity: state.complexity,
      model: state.model,
      genre_code: meta.genre_code,
      pipelineOrder: meta.pipelineOrder,
      routingMode: meta.routingMode,
    };
    writeAssetFile(runDir, "_checkpoint.json", checkpoint);
  } catch (e) {
    console.error(`Failed to save checkpoint after ${stepId}:`, e);
  }
}

/**
 * 读某 run 目录的 checkpoint。`dir` 是 `sourceDir` 形态（`<key>` 或
 * `<key>/pipelines/<pipelineId>`），先过四元组反解再拼路径 —— 它来自请求体，
 * 不校验就 join 等于把 `../..` 也一并接受。
 */
function loadCheckpoint(dir: string): CheckpointData | null {
  if (!parseRunDirName(dir)) return null;
  const cpPath = path.join(outputDir(), dir, "_checkpoint.json");
  if (!fs.existsSync(cpPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cpPath, "utf-8"));
  } catch {
    return null;
  }
}

const app: Express = express();
// 上传剧本可能远大于 100kb（默认）：放宽到 5mb，覆盖中长篇剧本
app.use(express.json({ limit: "5mb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Forgeax-Slug");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});
// 双模式路径映射（M-A）：按请求头/查询参数/平台 active-game 磁盘 SSOT 解析 slug，
// 写入本请求的 AsyncLocalStorage 上下文；下游 outputDir()/resolveNarrativeRoot()
// 据此判定独立模式还是插件模式。平台没给这个进程注入项目根时零开销放行。
app.use(narrativeArtifactContextMiddleware);

const PORT = parseInt(readPluginEnv("NARRATIVE_PORT") ?? "8900", 10);

// 被扩展 spawn 出来的服务是孤儿进程（一次性 CLI 起完就退，没人回收它）。
// 扩展启动时注入 NARRATIVE_IDLE_TIMEOUT_MS，服务据此自行退出；Studio 托管时
// 不注入，这里得到 0 就整个关掉，行为与今天完全一致。
if (!process.env.VITEST) {
  installIdleShutdown(app, {
    timeoutMs: parseInt(readPluginEnv("NARRATIVE_IDLE_TIMEOUT_MS") ?? "0", 10) || 0,
    busy: () => hasRunningPipeline(),
  });
}

const LLM_PROXY_URL = getLlmProxyUrl();
const LLM_PROXY_KEY = getLlmProxyKey();
const API_KEY = getGeminiApiKey();
const HOST_AGENT_CMD = getHostAgentCommand();

if (!LLM_PROXY_URL && !API_KEY && !HOST_AGENT_CMD && !process.env.VITEST) {
  // 测试环境（vitest）下允许缺 LLM 配置，使 server 模块可被单测 import（纯函数如 pickIpGenRunOutcome）。
  console.error("❌ LLM_PROXY_URL, GEMINI_API_KEY or a host-agent command is required");
  process.exit(1);
}

if (LLM_PROXY_URL && !LLM_PROXY_KEY) {
  console.error("❌ LITELLM_PROXY_KEY is required when LLM_PROXY_URL is set (LiteLLM proxy auth)");
  process.exit(1);
}

if (LLM_PROXY_URL) {
  console.log(`🔗 Using LLM proxy: ${LLM_PROXY_URL}`);
} else if (API_KEY) {
  console.log("🔑 Using direct Gemini API key");
} else if (HOST_AGENT_CMD) {
  // 说清楚代价：借宿主模型每次调用都要重付它的系统提示词，慢且贵。用户看到
  // 这一行就知道为什么比自带 key 慢，而不是以为服务卡住了。
  console.log(
    `🤝 Borrowing the host agent's model (${HOST_AGENT_CMD}) — ` +
      `no narrative key configured, so each call pays the host's prompt overhead`,
  );
}

/** 探针结论：借宿主模型这条路在本进程里到底通不通。undefined = 还没测。 */
let hostAgentBlocked: string | undefined;

/**
 * 接活之前先确认借得到。
 *
 * 宿主的沙箱可能禁止本进程创建子进程，而借模型就是启动宿主的 CLI。不先问一句，
 * 这件事要等到用户第一次生成跑到一半才以 `spawn EPERM` 的形式冒出来——那个位置
 * 看起来像内容出了问题，其实是这台机器上这条路压根不通。
 */
async function checkHostAgent(): Promise<void> {
  if (!HOST_AGENT_CMD || process.env.VITEST) return;
  const failure = await probeHostAgent({ command: HOST_AGENT_CMD });
  if (!failure) return;
  hostAgentBlocked = failure.message;
  console.error(`⛔ ${failure.message}`);
}

interface RunState {
  id: string;
  status: "running" | "completed" | "failed";
  progress: PipelineProgress[];
  streamBuffer: PipelineProgress[];
  result?: NarrativeContext;
  error?: string;
  /**
   * 这次收尾是用户按的取消，不是跑挂了。
   *
   * 不给 status 加第四个值：那个联合被 manifest、SSE、history 三处消费，加一个值要改三处
   * 兼容。而"取消 vs 失败"只影响界面怎么说这一件事，一个旗标就够，落盘后由 history 翻成
   * `interrupted`。
   */
  cancelled?: boolean;
  startedAt: string;
  tier?: TierId;
  mode?: ModeId;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  /** @deprecated A1: derived from (tier, mode, genreCode). Stored for history/log only. */
  routingMode?: "auto" | "semi" | "manual";
  /** A2-2: explicit genre code from frontend (skips LLM detectGenre when present). */
  genreCode?: string;
  /** 三轴路由：类型/题材由前端选，结构在 launch 时综合推导后定稿。 */
  narrativeAxes?: NarrativeAxesSelection;
  /** 结构结论的来源：用户显式指定 / 三轴投票 / 三轴皆空。写进 manifest 供前端解释"为何是这个结构"。 */
  structureSource?: "explicit" | "vote" | "none";
  /** 结构推导的全过程（候选排序 / 各轴倾向 / 标签兜底命中），落 manifest 供 UI 展示。 */
  structureRationale?: RunManifestConfig["structureRationale"];
  model?: string;
  completedSteps?: string[];
  stepMeta?: Record<string, StepMeta>;
  outputDir?: string;
  parentKey?: string;
  forkReason?: string;
  /**
   * Phase 1: 本次运行的"权威步骤序"快照。由 onProgress 在收到
   * pipeline_steps_announce 帧时写入；动态模式追加 narrative steps 后
   * 二补帧也会刷新这里。saveCheckpoint / writeManifestIncremental 直接读。
   */
  pipelineSteps?: string[];
  /**
   * Phase-2 M7: 本次运行的 RunManifest = 运行时事实源。
   * `/start` 建表落盘，onStepComplete 逐 agent 跃迁 lifecycle 后重写 `_run_manifest.json`。
   */
  manifest?: RunManifest;
  /** checkpoint 的 agent lifecycle 切片（跨 saveCheckpoint 保留时间戳/错误）。 */
  checkpointAgents?: CheckpointAgentSlot[];
  /**
   * Phase-2 M8 多管线：本 run 归属的管线 id。
   * 置位表示这是条目下的次管线，产物落 `output/<entryKey>/pipelines/<pipelineId>/`。
   */
  pipelineId?: string;
  /** 所属条目 key（多管线并发时用于并发守卫按条目分组）。 */
  entryKey?: string;
  /**
   * Phase-2 M9：单 agent 的 SSE run。
   * G2 之前：临时态，恒真——不建产物目录、不落 manifest / checkpoint，只为把执行过程
   * （composite 的子 DAG 波次）经既有 stream 端点推给画布。
   * G2 之后：**只在调用方没给安全 entryKey 时才为真**。给了 entryKey，这次单席跑会
   * 绑定到该条目（`AgentEntryBinding`），产物落 `output/<entryKey>/`、并入该条目的
   * `_checkpoint.json`，使单席跑的结果能被后续的完整管线继续消费。
   */
  agentRun?: boolean;
}

const runs = new Map<string, RunState>();

/** 空闲自结的「别动我」信号。声明式函数，供上方 installIdleShutdown 提前引用。 */
function hasRunningPipeline(): boolean {
  for (const state of runs.values()) if (state.status === "running") return true;
  return false;
}

/**
 * Phase 1: 收到 pipeline_steps_announce 帧时刷新 state.pipelineSteps。
 * 同一次运行可能 emit 两次（启动时 + design_doc 完成后的二补帧），都以最新一帧为准。
 * 跳过空列表（auto 路由首帧未识别品类前会发空 steps）。
 */
function capturePipelineSteps(state: RunState, p: PipelineProgress): void {
  if (
    p.type === "pipeline_steps_announce" &&
    Array.isArray(p.steps) &&
    p.steps.length > 0
  ) {
    state.pipelineSteps = [...p.steps];
    // Phase-2 M7: 权威步骤序变了（含 design_auto 的二补帧）→ 对齐 manifest.agents。
    if (state.manifest) {
      syncManifestAgents(state.manifest, state.pipelineSteps);
      writeRunManifest(state);
    }
  }
}

/** RunManifest 落盘文件名。与旧 `manifest.json`（资产清单）区分。 */
const RUN_MANIFEST_FILE = "_run_manifest.json";

function loadRunManifest(dir: string): RunManifest | null {
  const p = path.join(outputDir(), dir, RUN_MANIFEST_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as RunManifest;
  } catch {
    return null;
  }
}

/**
 * Phase-2 M7: 把 state.manifest 落盘为该 run 的运行时事实源。
 * 每次 lifecycle 跃迁后调用；失败仅告警（manifest 是观测面，不阻塞生成）。
 */
function writeRunManifest(state: RunState): void {
  if (!state.manifest || state.agentRun) return;
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    writeAssetFile(runDir, RUN_MANIFEST_FILE, state.manifest);
  } catch (e) {
    console.error("Failed to write run manifest:", e);
  }
}

/** 建表：以 pipeline announce 的权威步骤序为准，缺省时留空待 announce 补齐。 */
function initRunManifest(
  state: RunState,
  stepIds: string[],
  opts: { locale?: ContentLocale; pipelineTemplate?: string; lifecycle?: Record<string, AgentLifecycle> } = {},
): void {
  // 条目键取 state 上的显式字段，不从 outputDir 反推：次管线的 outputDir 是
  // `<key>/pipelines/<pipelineId>`，basename 会推成 pipelineId（见 contracts §1.3）。
  const entryKey = resolveStateEntryKey(state);
  state.manifest = manifestFromStepIds({
    entryKey,
    runId: state.id,
    // 次管线沿用前端 /plan 给的 pipelineId，SSE 帧上的 lane 锚点才与前端 lane 同名。
    pipelineId: state.pipelineId,
    stepIds,
    lifecycle: opts.lifecycle,
    config: {
      // tier 是品类的只读派生属性（PRD v1.4 §3.2.2）：选定专家即选定品类，层级查表得到。
      // 客户端传来的 tier 只在没选专家（自动路由预览）时兜底。
      tier: (state.genreCode ? findGenreByCode(state.genreCode)?.tier : undefined) ?? state.tier ?? null,
      mode: state.mode ?? null,
      genreCode: state.genreCode ?? null,
      storyType: state.narrativeAxes?.storyType ?? null,
      storyTheme: state.narrativeAxes?.storyTheme ?? null,
      narrativeStructure: state.narrativeAxes?.structure ?? null,
      structureSource: state.structureSource ?? "none",
      structureRationale: state.structureRationale,
      complexity: state.complexity,
      routeGroup: state.routeGroup,
      locale: opts.locale,
      userInput: state.userInput,
      pipelineTemplate: opts.pipelineTemplate,
    },
  });
  writeRunManifest(state);
}

/**
 * 收束 manifest 的整体状态与残留 agent。
 * - completed：仍 pending/running 的 agent 视为动态裁剪掉，置 skipped
 * - failed：只把 running 的那一步置 failed；pending 保持 pending，
 *   resume 才能只重跑失败步及其后续（而非整链重跑）
 */
function finalizeRunManifest(
  state: RunState,
  status: "completed" | "failed",
  error?: string,
): void {
  if (!state.manifest) return;
  state.manifest.status = status;
  for (const slot of [...state.manifest.agents]) {
    const cur = slot.lifecycle.status;
    if (cur === "completed" || cur === "skipped" || cur === "failed") continue;
    if (status === "failed") {
      if (cur === "running") markAgentLifecycle(state.manifest, slot.agentId, "failed", { error });
    } else {
      markAgentLifecycle(state.manifest, slot.agentId, "skipped");
    }
  }
  writeRunManifest(state);
}

/**
 * lifecycle 跃迁 + 落盘。agent 未登记时自动追加（动态追加步）。
 * 状态未变则直接返回 —— running 帧会高频重复（sub-emit / 多节点进度），不能每帧写盘。
 */
function transitionAgent(
  state: RunState,
  agentId: string,
  status: AgentLifecycle,
  patch?: { message?: string; error?: string },
): void {
  if (!state.manifest) return;
  const cur = state.manifest.agents.find((a) => a.agentId === agentId);
  if (cur?.lifecycle.status === status && !patch) return;
  markAgentLifecycle(state.manifest, agentId, status, patch);
  writeRunManifest(state);
}

/**
 * 缺上游被跳过的步：manifest 里如实记 skipped，别混进 completed。
 *
 * 三条运行入口（首跑 / resume / 重新生成）共用，因为跳过原因与入口无关；
 * 记 skipped 而非 completed 让 resume 的 lifecycle 判定能看出这一步没产物。
 */
function noteSkippedStep(state: RunState, p: PipelineProgress): void {
  if (p.status !== "skipped" || !p.stepId) return;
  transitionAgent(state, p.stepId, "skipped", {
    message: p.skipInfo?.hint ?? p.message,
  });
}

function writeManifestIncremental(state: RunState): void {
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const existingFiles = fs.existsSync(runDir)
      ? fs.readdirSync(runDir).filter((f) => f !== "manifest.json")
      : [];
    const meta = resolveCheckpointMeta(state, state.result);
    const manifest: Record<string, unknown> = {
      runId: state.id,
      tier: state.tier,
      mode: state.mode,
      model: state.model,
      status: state.status,
      startedAt: state.startedAt,
      updatedAt: new Date().toISOString(),
      files: existingFiles,
      userInput: state.userInput,
      routeGroup: state.routeGroup,
      complexity: state.complexity,
      completedSteps: state.completedSteps ?? [],
      genre_code: meta.genre_code,
      pipelineOrder: meta.pipelineOrder,
      routingMode: meta.routingMode,
    };
    if (state.parentKey) manifest.parentKey = state.parentKey;
    if (state.forkReason) manifest.forkReason = state.forkReason;
    // 用户按的取消与真的跑挂了在磁盘上都是 status:"failed"（内存态就这三个值），
    // 但在界面上必须分开：前者是界面上的"暂停生成"，条目该显示可续跑，
    // 而不是给作者一个"失败"的红牌。
    if (state.cancelled) manifest.cancelled = true;
    writeAssetFile(runDir, "manifest.json", manifest);
  } catch (e) {
    console.error("Failed to write incremental manifest:", e);
  }
}

/**
 * 终态跃迁的单一写入口（键权层方案 M4）。
 *
 * 收敛之前：`/start`/`/resume`/`/regenerate`/`/cancel/:id` 各自手写
 * `state.status = ...` 再各自决定要不要调 `finalizeRunManifest`/`writeManifestIncremental`——
 * `/regenerate` 就漏了 `finalizeRunManifest`，fork 出来的新条目 `_run_manifest.json`
 * 永远停在最后一次增量帧的 agent 状态，不会收尾成 completed/failed。
 *
 * 收敛之后：内存 `RunState.status`、`manifest.json`（`writeManifestIncremental`）、
 * `_run_manifest.json`（`finalizeRunManifest`）三处永远在这一个函数里原子完成，
 * 调用方不必也不该记得"这次是不是也要 finalize 一下"。
 *
 * `saveRunToFile`（旧版扁平结果文件）不在这里——那是各调用点自己的错误信息更贴切
 * （"Failed to save resumed result" 之类），且不属于"运行状态"这件事本身。
 */
type RunTransitionEvent =
  | { type: "completed"; result: NarrativeContext }
  | { type: "failed"; error: string }
  | { type: "cancelled"; error?: string };

function applyRunTransition(state: RunState, event: RunTransitionEvent): void {
  if (event.type === "completed") {
    state.status = "completed";
    state.result = event.result;
    if (event.result.tier_detection) state.tier = event.result.tier_detection.tier;
    finalizeRunManifest(state, "completed");
  } else if (event.type === "failed") {
    state.status = "failed";
    state.error = event.error;
    finalizeRunManifest(state, "failed", event.error);
  } else {
    state.status = "failed";
    state.cancelled = true;
    state.error = event.error ?? "用户取消生成";
    finalizeRunManifest(state, "failed", state.error);
  }
  writeManifestIncremental(state);
}

/**
 * 谁在应答这个端口,不只是「有人在应答」。
 *
 * 这三个字段是给外壳做身份核对用的:端口上蹲着一个同样自称 narrative-studio、
 * 但版本不同、key 不同、项目根不同的实例,是完全可能的(WSL 的 localhost 转发就
 * 会把另一个系统里的旧服务映射到本机回环)。少了这些字段,外壳只能认"有人应答
 * 即是我起的",然后代理一个它没配过的服务,并照自己的配置去汇报凭据来源。
 */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "narrative-studio",
    version: packageVersion(),
    backend: LLM_PROXY_URL
      ? "proxy"
      : API_KEY
        ? "gemini"
        : HOST_AGENT_CMD
          ? hostAgentBlocked ? "host-agent-blocked" : "host-agent"
          : "none",
    ...(hostAgentBlocked ? { backendError: hostAgentBlocked } : {}),
    projectRoot: readPluginEnv("FORGEAX_PROJECT_ROOT") ?? null,
  });
});

/**
 * Generic tool dispatch for hosts that cannot load `tools` in-process the way
 * Studio does — a Codex extension CLI, for instance, is a short-lived process.
 * Routing through the same handler table keeps every host on one translation
 * of tool name and arguments instead of one adapter per host.
 */
app.post("/api/tools/:name", async (req, res) => {
  const name = String(req.params.name);
  const toolId = `narrative:${name}`;
  const handler = (tools as Record<string, unknown>)[toolId];
  if (typeof handler !== "function") {
    res.status(404).json({ error: `unknown_tool: ${toolId}` });
    return;
  }
  const { args = {}, projectRoot, gameSlug } = (req.body ?? {}) as {
    args?: Record<string, unknown>;
    projectRoot?: string;
    gameSlug?: string;
  };
  try {
    const value = await (handler as (a: unknown, c: unknown) => Promise<unknown>)(args, {
      caller: { kind: "extension" },
      toolId,
      env: { NARRATIVE_PORT: String(PORT) },
      cwd: path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../.."),
      projectRoot,
      gameSlug,
    });
    res.json({ ok: true, tool: toolId, value });
  } catch (e) {
    const error = e as Error & { code?: string };
    res.status(error.code === "conflict" ? 409 : 500).json({ ok: false, tool: toolId, error: error.message });
  }
});

/** 可用的 tier 和 mode 列表 */
app.get("/api/narrative/modes", (_req, res) => {
  const tiers: TierId[] = ["tier1", "tier2", "tier3", "tier4"];
  const result = tiers.map((tier) => ({
    tier,
    defaultMode: TIER_DEFAULT_MODE[tier],
    modes: getModesForTier(tier).map((m) => ({
      id: m.id,
      label: m.label,
      stepsCount: m.steps.length,
    })),
  }));
  res.json(result);
});

/**
 * A2-1: 品类目录 — 按 15 大类折叠分组返回所有品类。
 * 供前端 TierModeSelector 渲染二级品类面板使用。
 */
app.get("/api/narrative/genres", (req, res) => {
  try {
    const locale = parseContentLocale(req.query.locale);
    const grouped = getGenresByCategory(locale);
    const payload = {
      categories: grouped.map((bucket) => ({
        category: bucket.category,
        label: bucket.label,
        genres: bucket.genres.map((g) => {
          const pipeline = resolveNarrativePipeline(g.code, g.tier);
          return {
            code: g.code,
            name: getGenreDisplayName(g, locale),
            tier: g.tier,
            narrative_ratio: g.narrative_ratio,
            narrative_type: g.narrative_type,
            /** @deprecated 旧 step 模板；四期起路由目标是 narrative_pipeline。 */
            pipeline_template: g.pipelineTemplate,
            // 该品类真正会跑的席位管线。前端专家节点显示与单跑都认这一个，
            // 否则画布上写着 tpl-vn-v2、后端跑的却是 pl-film-game。
            narrative_pipeline: pipeline.id,
            narrative_pipeline_name: pipeline.name,
            expert_name: expertDisplayName(g.code, g.tier, locale),
            needs: g.needs,
            keywords: g.keywords.slice(0, 5),
          };
        }),
      })),
    };
    const totalGenres = payload.categories.reduce((s, c) => s + c.genres.length, 0);
    console.log(`[Server] /genres OK: ${payload.categories.length} categories, ${totalGenres} genres`);
    res.json(payload);
  } catch (e) {
    console.error("[Server] /genres failed:", (e as Error)?.stack ?? e);
    res.status(500).json({ error: (e as Error)?.message ?? "internal error" });
  }
});

/**
 * 三轴词表目录（PRD v1.4 §3.2.2）：叙事类型 / 叙事题材 / 叙事结构。
 * 前端叙事路由的级联菜单直接吃这份，避免在 viz 里再抄一份词表造成两处漂移。
 * structures 一并返回，供 UI 展示"综合出的结构是什么"，不是给用户直选的。
 */
app.get("/api/narrative/axes", (_req, res) => {
  try {
    res.json({
      types: STORY_TYPES.map((t) => ({
        code: t.code,
        name: t.name,
        nameEn: t.nameEn,
        summary: t.summary,
        traits: t.traits,
      })),
      themes: STORY_THEMES.map((t) => ({
        code: t.code,
        name: t.name,
        nameEn: t.nameEn,
        summary: t.summary,
        traits: t.traits,
      })),
      structures: STORY_STRUCTURES.map((s) => ({
        code: s.code,
        name: s.name,
        summary: s.summary,
      })),
    });
  } catch (e) {
    console.error("[Server] /axes failed:", (e as Error)?.stack ?? e);
    res.status(500).json({ error: (e as Error)?.message ?? "internal error" });
  }
});

/**
 * Tier→Complexity default mapping (used as fallback when routing_mode=manual omits complexity).
 * Aligned with the design doc:
 *   T1 → 丰富(4) / T2 → 标准(3) / T3 → 短篇(2) / T4 → 极简(1)
 *   Level 5 (史诗) is a user-active-upgrade option only, never auto-defaulted.
 */
const TIER_DEFAULT_COMPLEXITY: Record<TierId, number> = {
  tier1: 4,
  tier2: 3,
  tier3: 2,
  tier4: 1,
};

type RoutingMode = "auto" | "semi" | "manual";

/**
 * D5: legacy step-ID migration for old manifests / checkpoints.
 *
 *   - structure_validation_l1/l2/l3 → dropped (folded into outline_batch /
 *     detailed_outline / plot_generation respectively)
 *   - initial_outline / core_settings / plot_synopsis → merged into initial_plan
 *
 * The migration is idempotent: passing already-modern IDs returns them unchanged.
 * Order is preserved; duplicates from collapsing are de-duplicated.
 */
const LEGACY_STEP_ID_MAP: Record<string, string | null> = {
  structure_validation_l1: null,
  structure_validation_l2: null,
  structure_validation_l3: null,
  initial_outline: "initial_plan",
  core_settings: "initial_plan",
  plot_synopsis: "initial_plan",
};

function migrateLegacyCompletedSteps(steps: string[] | null | undefined): string[] {
  if (!steps?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of steps) {
    if (id in LEGACY_STEP_ID_MAP) {
      const replacement = LEGACY_STEP_ID_MAP[id];
      if (replacement && !seen.has(replacement)) {
        out.push(replacement);
        seen.add(replacement);
      }
      continue;
    }
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

/** D4: 仅用于 announce 帧，与 modes.ts 内的 DESIGN 常量保持同序。 */
const DESIGN_STEP_IDS_FOR_ANNOUNCE: string[] = [
  S.CORE_CONCEPT,
  S.SYSTEM_ARCHITECTURE,
  S.SYSTEM_DETAIL,
  S.VALUE_FRAMEWORK,
  S.DESIGN_DOC,
];

/**
 * D4 + V1: build the pipeline_steps_announce payload.
 * Returns the ordered step list and the pipeline_template used.
 *
 * @deprecated Blueprint 模式下由 assembleBlueprint() 替代。
 * 旧 run() 路径仍需此函数，待所有路径迁移到 runWithBlueprint 后移除。
 *
 * Cases:
 *  - narrative_auto / design_auto **with explicit genre_code** → 用品类预置 needs
 *    立即静态算出叙事步骤（design_auto 还会前置 D0-D4），让前端开始即看到完整步骤列表。
 *  - narrative_auto / design_auto **without genre_code** → return [] for steps.
 *    The frontend will continue to use its preview until progress arrives.
 *  - resolved mode → flatten ModeConfig.steps and return mode.pipeline_template.
 */
/**
 * 品类 + 层级 → 画布的专家/席位嵌套结构。
 *
 * 这是"谁在跑、由哪些席位组成"的唯一算法，start 的 announce 帧与历史回放共用它。
 * 分成两套算的话，同一条 run 在跑的时候是「互动叙事专家 > 需求清单助手」三层嵌套，
 * 事后打开就退化成一排扁平卡片——同一份产物在两个时刻长得不一样。
 */
function expertStepGroups(
  genreCode: string | undefined | null,
  tier: TierId | undefined,
): AnnounceStepGroup[] | undefined {
  if (!genreCode) return undefined;
  const entry = findGenreByCode(genreCode);
  if (!entry) return undefined;
  const seat = resolveSeatStepGroups(entry.code, tier ?? entry.tier);
  return [
    {
      id: seat.pipeline.id,
      label: expertDisplayName(entry.code, entry.tier),
      steps: seat.stepGroups,
      pipelineId: seat.pipeline.id,
      pipelineName: seat.pipeline.name,
      seats: seatGroupsForSteps(seat.stepGroups),
    },
  ];
}

function buildPipelineStepsAnnounce(
  state: RunState,
  resolvedMode: ModeId | undefined,
  tierHint: TierId | undefined,
): { steps: string[]; pipelineTemplate?: string; stepGroups?: AnnounceStepGroup[] } {
  const isDesignAuto = resolvedMode === ("design_auto" as ModeId);
  const isNarrativeAuto = resolvedMode === ("narrative_auto" as ModeId);

  // 元节点（开场白）：
  //   - pipeline_config：每次 pipeline 启动都会 emit 一次（status=completed），表示
  //     "本次 Tier=X / Mode=Y / 共 N 步" 的开场总览。固定置于 announce 列表第一位，
  //     避免它作为后到达事件被 defensive append 到节点末尾。
  //   - tier_router：仅自动路由（未显式指定 genre_code）会真正调用 LLM 识别品类，
  //     需要作为节点存在；手动指定品类时直接 fallback，不发节点。
  //
  // 注意：仅当本次 announce 本身有完整 step list（下面两个分支 return 的）才注入；
  // 否则保持原样（空 steps），让前端继续走本地预览 fallback。
  const META_HEAD: string[] = [...BANNER_STEP_IDS];
  const isAutoRouting = !state.genreCode;
  if (isAutoRouting) META_HEAD.unshift("tier_router");

  // 显式指定品类时，这一帧的步序必须与 pipeline.run() 将要跑的完全一致，
  // 否则画布先按本帧铺一套节点、几秒后又被 run() 的 announce 换掉一套。
  // 故同样走 resolveSeatStepGroups（事实源 = 叙事策划专家组 CSV）。
  if ((isDesignAuto || isNarrativeAuto) && state.genreCode) {
    try {
      const entry = findGenreByCode(state.genreCode);
      if (entry) {
        const seat = resolveSeatStepGroups(entry.code, tierHint ?? entry.tier);
        const seatSteps = seat.stepGroups;
        const steps = isDesignAuto
          ? [...DESIGN_STEP_IDS_FOR_ANNOUNCE, ...seatSteps.filter((id: string) => !DESIGN_STEP_IDS_FOR_ANNOUNCE.includes(id))]
          : seatSteps;
        if (process.env.NARRATIVE_AUTO_DEBUG === "1") {
          console.log(`[announce] seat pipeline=${seat.pipeline.id} genre=${state.genreCode}`);
          console.log(`[announce]   final steps=[${[...META_HEAD, ...steps].join(",")}]`);
        }
        return {
          steps: [...META_HEAD, ...steps],
          pipelineTemplate: entry.pipelineTemplate,
          stepGroups: expertStepGroups(entry.code, tierHint ?? entry.tier),
        };
      }
    } catch (e) {
      console.warn("[announce] Planner failed, falling back:", (e as Error).message);
      try {
        const entry = GENRE_TAXONOMY.find((g) => g.code === state.genreCode);
        if (entry) {
          /** @deprecated Legacy announce fallback. */
          const syntheticReq = {
            narrative_type: getNarrativeType(state.genreCode!),
            needs: entry.needs,
          } as Parameters<typeof buildAutoSteps>[0];
          const autoSteps = buildAutoSteps(syntheticReq, { genreCode: state.genreCode });
          const steps = isDesignAuto
            ? [...DESIGN_STEP_IDS_FOR_ANNOUNCE, ...autoSteps]
            : autoSteps;
          return { steps: [...META_HEAD, ...steps], pipelineTemplate: entry.pipelineTemplate };
        }
      } catch (e2) {
        console.warn("[announce] legacy fallback also failed:", (e2 as Error).message);
      }
    }
  }

  if (!resolvedMode || isNarrativeAuto || isDesignAuto) {
    return { steps: [], pipelineTemplate: undefined };
  }
  try {
    const cfg = getModeConfig(resolvedMode);
    const flat = cfg.steps.flatMap((s) => (Array.isArray(s) ? s : [s]));
    return { steps: [...META_HEAD, ...flat], pipelineTemplate: cfg.pipeline_template };
  } catch {
    void tierHint;
    return { steps: [], pipelineTemplate: undefined };
  }
}

app.post("/api/narrative/start", async (req, res) => {
  console.warn("[API] /start called at", new Date().toISOString());
  const {
    user_input, model, tier, mode, auto_detect, route_group, complexity,
    /** @deprecated A1: derive from (tier, mode, genre_code) instead. Kept for backward compat. */
    routing_mode,
    /** A2-2: explicit genre code (e.g. "rpg-jrpg"). When provided, skip LLM detectGenre. */
    genre_code,
    /** 三轴路由（PRD v1.4 §3.2.2）：叙事类型 / 叙事题材 / 叙事结构。 */
    story_type,
    story_theme,
    narrative_structure,
    /** 标签选择；类型/题材为空时由它兜底推导两轴。不传则从 `_entry.json` 读已落盘的那份。 */
    tags,
    // M-E 下闸（叙事工坊平台接入对齐）：`use_legacy_pipeline` / `use_blueprint` 两个
    // 开关曾经能从这个 HTTP 入参直接触达 `buildAutoSteps` 那条 @deprecated 冷路径
    // 与 `runWithBlueprint` 平行执行路径，界面从不传，但外部调用者显式传 true 即可
    // 跑出与席位管线不一致的步序。机制本身保留在 `launchNarrativeRun`/`pipeline.ts`
    // 内部（供未来内部调用方或测试按需使用），只是这个入口不再对外接收这两个字段。
    /** M1: 上传剧本（前端把 .txt/.docx 解析后的原文 + 文件元信息传过来）。
     *  - content        utf8 剧本原文（.txt 走这里；前端可以直接 file.text()）
     *  - content_base64 二进制 base64（仅当 encoding="base64-docx" 时；服务端用 mammoth 解析）
     *  - encoding       "utf8" | "base64-docx"；缺省按 "utf8"
     *  - file_name/size/mime  仅用于存档与 UI；server 端会跑 detectScriptFormat 补 format/char_count
     */
    uploaded_script,
    /**
     * §条目提前建立：前端在首次输入确认时铸造的稳定条目键（草稿键）。提供且格式安全时，
     * 本次运行复用该键作为落盘目录名（sourceDir），使 INPUT 阶段建立的条目与生成产物同锚一处，
     * 避免另铸时间戳造成"输入条目"与"生成条目"分裂。
     */
    entry_key,
    locale,
    /**
     * 自由编排的显式步序。画布把用户连出来的链原样传来，给了就以它为准，
     * 不再按 (tier, mode, genre_code) 路由到预置管线。与 /plan 的 requestedSteps 同名同义。
     */
    requested_steps,
    /**
     * 作者勾选启用的默认关席位 id（可选终点席与可挂载席）。
     *
     * 与 requested_steps 是两件事：那个是"我自己连了一整条链"，这个是"预置管线
     * 照跑，但多过一道打磨"。默认关的席位若只有前者这条路，勾一席就得手连整条链。
     */
    activate_seats,
    /** 本次生成带哪个自定义专属团队（2.4）。 */
    team_id,
    /**
     * G1：单管线也可能先调过 /plan 拿预演步序，此时 /plan 已铸出一个 pipelineId。
     * 给了就原样透传给 launchNarrativeRun，不允许 manifestFromStepIds 在运行期再现铸一个 ——
     * 否则计划期与运行期出现两个不同的 pipelineId（见 LaunchRunParams.pipelineId 的注释）。
     * 不给时行为不变：单管线本就不下沉子目录，缺省仍视为主管线。
     */
    pipeline_id,
  } = req.body as {
    user_input?: string;
    model?: string;
    tier?: TierId;
    mode?: ModeId;
    auto_detect?: boolean;
    route_group?: "planning" | "narrative";
    complexity?: number;
    routing_mode?: RoutingMode;
    genre_code?: string;
    story_type?: string;
    story_theme?: string;
    narrative_structure?: string;
    tags?: NarrativeTagSelection;
    entry_key?: string;
    locale?: ContentLocale;
    requested_steps?: string[];
    activate_seats?: string[];
    /** 自定义专属创作团队 id（2.4）；未 ready 的按没选处理。 */
    team_id?: string;
    uploaded_script?: {
      content?: string;
      content_base64?: string;
      encoding?: "utf8" | "base64-docx";
      file_name?: string;
      size?: number;
      mime?: string;
    };
    pipeline_id?: string;
  };

  if (!user_input?.trim()) {
    res.status(400).json({ error: "user_input is required" });
    return;
  }

  // M1: 解析上传剧本（在请求线程内同步完成；mammoth + 正则识别，毫秒至秒级）
  let parsedUploadedScript: UploadedScript | undefined;
  if (uploaded_script && (uploaded_script.content || uploaded_script.content_base64)) {
    let resolvedText = "";
    try {
      if (uploaded_script.encoding === "base64-docx" && uploaded_script.content_base64) {
        // M1.8: 服务端 .docx 解析（前端 ArrayBuffer → base64 → backend Buffer → mammoth → 纯文本）
        const buf = Buffer.from(uploaded_script.content_base64, "base64");
        // 动态 import 避免 cold-start 把 mammoth 拉进 bundle 的开销（仅在用户上传 .docx 时才加载）
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: buf });
        resolvedText = result.value ?? "";
        if (result.messages?.length) {
          console.log(`[Server] mammoth messages (${result.messages.length}): ${result.messages.slice(0, 3).map(m => m.message).join("; ")}`);
        }
      } else if (uploaded_script.content) {
        resolvedText = uploaded_script.content;
      }
    } catch (e) {
      console.warn(`[Server] uploaded_script parse failed: ${(e as Error).message}`);
    }

    if (resolvedText && resolvedText.trim().length > 0) {
      const detection = detectScriptFormat(resolvedText);
      parsedUploadedScript = {
        content: resolvedText,
        format: detection.format,
        char_count: detection.charCount,
        estimated_word_count: detection.estimatedWordCount,
        file_name: uploaded_script.file_name,
        size: uploaded_script.size,
        mime: uploaded_script.mime,
        description: describeScriptFormat(detection),
      };
      console.log(
        `[Server] uploaded_script parsed: format=${detection.format} ` +
        `chars=${detection.charCount} words=${detection.estimatedWordCount} ` +
        `file=${uploaded_script.file_name ?? "(no name)"} ` +
        `encoding=${uploaded_script.encoding ?? "utf8"}`,
      );
    }
  }

  const activeRunning = findConflictingRun(
    isSafeEntryKeyFn(entry_key) ? entry_key : undefined,
  );
  if (activeRunning) {
    res.status(409).json({ error: `已有运行中的管线 (${activeRunning.id})，请等待完成或取消后再试` });
    return;
  }

  const validTiers: TierId[] = ["tier1", "tier2", "tier3", "tier4"];
  if (tier && !validTiers.includes(tier)) {
    res.status(400).json({ error: `Invalid tier: ${tier}. Must be one of: ${validTiers.join(", ")}` });
    return;
  }

  const badSteps = unrunnableSteps(requested_steps);
  if (badSteps.length > 0) {
    res.status(422).json({
      error: `以下环节无法执行，请从画布上移除后重试: ${badSteps.join(", ")}`,
      unrunnableSteps: badSteps,
    });
    return;
  }

  const launched = launchNarrativeRun({
    userInput: user_input.trim(),
    model,
    tier,
    mode,
    autoDetect: auto_detect,
    routeGroup: route_group,
    complexity,
    routingMode: routing_mode,
    genreCode: genre_code,
    storyType: story_type,
    storyTheme: story_theme,
    narrativeStructure: narrative_structure,
    tags,
    entryKey: entry_key,
    locale,
    uploadedScript: parsedUploadedScript,
    requestedSteps: requested_steps,
    activateSeats: activate_seats,
    teamId: team_id,
    // primary 缺省 true：单管线路径本就不下沉子目录，透传 pipelineId 只固定身份，不改落点。
    pipelineId: pipeline_id,
  });

  res.json({
    id: launched.id,
    status: "running",
    message: "Pipeline started",
    tier: launched.tier,
    mode: launched.mode,
    // 条目锚点与产物地址分开给：单管线两者相等，但前端不该再靠这个巧合。
    entryKey: launched.entryKey,
    sourceDir: launched.sourceDir,
    pipelineId: launched.pipelineId,
  });
});

/**
 * 并发守卫（Phase-2 M8 放宽）：跨条目仍互斥，同条目内不同管线可并发。
 * 同条目同管线（含两者皆为单管线的 undefined）视为重复启动，仍拒绝。
 */
function findConflictingRun(
  entryKey?: string,
  pipelineId?: string,
): RunState | undefined {
  return [...runs.values()].find((r) => {
    if (r.status !== "running") return false;
    if (!entryKey || !r.entryKey) return true;
    if (r.entryKey !== entryKey) return true;
    return r.pipelineId === pipelineId;
  });
}

/**
 * 键权层用：**这一条泳道**本身是不是正在跑（区别于 `findConflictingRun` 的全局锁语义——
 * 那个是"能不能发起新跑"，这里是"能不能编辑这条泳道已经落盘的内容"，两件事的判据不同：
 * 编辑不消耗生成资源，不该被"别的条目正在跑"挡住，只该被"这条泳道自己正在跑"挡住
 * （否则编辑请求与正在写入的 checkpoint/产物文件竞态）。
 */
function isLaneRunning(entryKey: string, pipelineId?: string): boolean {
  return [...runs.values()].some(
    (r) => r.status === "running" && r.entryKey === entryKey && r.pipelineId === pipelineId,
  );
}

interface LaunchRunParams {
  userInput: string;
  model?: string;
  tier?: TierId;
  mode?: ModeId;
  autoDetect?: boolean;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  routingMode?: RoutingMode;
  genreCode?: string;
  /** 三轴路由（PRD v1.4 §3.2.2）；结构缺省由品类/类型/题材综合推导。 */
  storyType?: string;
  storyTheme?: string;
  narrativeStructure?: string;
  /**
   * 标签选择。类型/题材两轴为空时由标签兜底推导（deriveAxesFromTags），
   * 使「标签输入」这条路径也能参与结构投票，而不是只拼一句话进 userInput。
   * 缺省时从 `_entry.json` 读 —— 标签在确认输入时就落盘了，前端不必再传一遍。
   */
  tags?: NarrativeTagSelection;
  useLegacyPipeline?: boolean;
  useBlueprint?: boolean;
  entryKey?: string;
  locale?: unknown;
  uploadedScript?: UploadedScript;
  /**
   * 管线泳道身份。**与落盘位置解耦**：身份一律置位（manifest / SSE lane 都用它），
   * 落哪个目录由 `primary` 决定。
   *
   * 曾经这两件事挤在一个字段里——主管线为了「不下沉子目录」而不传 pipelineId，
   * 于是 `manifestFromStepIds` 只能现铸一个新的，`_entry.json` 的计划期 id 与
   * `_run_manifest.json` 的运行期 id 从此不等（实测 9 个运行目录 9/9 复现），
   * 前端拿计划期 id 当泳道键、SSE 帧带运行期 id，主管线的泳道永远对不上。
   */
  pipelineId?: string;
  /**
   * 是否主管线。主管线产物落 `output/<entryKey>/`（历史列表 / fork / 载入沿用既有
   * 路径），次管线落 `output/<entryKey>/pipelines/<pipelineId>/`。
   * 缺省视为主管线 —— 单管线的 `/start` 因此无需关心本字段。
   */
  primary?: boolean;
  /**
   * 自由编排的显式步序，来自画布。给了就以它为准，不再按 (tier, mode, genreCode) 路由。
   *
   * 补这个字段是为了消掉一处静默分歧：`/plan` 早就认 requestedSteps 并返回
   * `composition-driven` 的 manifest，而 `/start` 不认，于是用户在画布上编排完、
   * 看到的预览是自己的链、点开始生成跑的却是预置管线，且全程不报错。
   */
  requestedSteps?: string[];
  /** 作者勾选启用的默认关席位 id（可选终点席与可挂载席）。 */
  activateSeats?: string[];
  /**
   * 本次生成要带的自定义专属团队。
   *
   * 传 id 而不是 profile：profile 有几 KB 且是后端落盘的事实源，让前端回传等于
   * 允许客户端伪造一份没蒸馏过的团队。未 ready 的 id 按"没选团队"处理并记一行日志——
   * 蒸馏还在跑就不该阻断生成，但也不能拿半成品去注入。
   */
  teamId?: string;
}

/** 取 ready 团队的 profile；draft/distilling/failed 一律当作没选（记日志，不抛错）。 */
function resolveTeamProfile(teamId?: string): DistilledProfile | undefined {
  if (!teamId) return undefined;
  const record = loadTeam(teamId);
  if (!record) {
    console.warn(`[Server] 专属团队不存在，本次生成不注入: ${teamId}`);
    return undefined;
  }
  if (record.status !== "ready" || !record.profile) {
    console.warn(`[Server] 专属团队尚未就绪(${record.status})，本次生成不注入: ${teamId}`);
    return undefined;
  }
  return record.profile;
}

/**
 * 自由编排步序的校验：挑出 run() 跑不起来的那些 step id。
 *
 * run() 里 `resolveStepId` 对没有执行函数的 id 返回 null，随后被 filter 静默丢掉。
 * 对预置管线这是对的（planned 席位本就该跳过），但对自由编排就是灾难：用户在画布上
 * 连了一个节点，它一声不响地消失，跑完还显示成功。所以这里在启动前挡下来，
 * 让调用方拿到 422 和具体是哪几个 id，而不是拿到一个少跑几步的"成功"。
 */
function unrunnableSteps(steps?: string[]): string[] {
  if (!steps || steps.length === 0) return [];
  return [...new Set(steps)].filter((id) => !isExecutableStep(id));
}

interface LaunchedRun {
  id: string;
  /**
   * 条目键。与 `sourceDir` 分开返回：主管线两者恰好相等，次管线不等，
   * 而调用方要靠前者锚定条目、靠后者寻址产物（见 contracts §1.3）。
   */
  entryKey: string;
  sourceDir: string;
  tier?: TierId;
  mode?: ModeId;
  pipelineId?: string;
}

/**
 * 启动一条管线并返回 runId + 落盘目录。
 * `/start`（单管线）与 `/entry/start`（多管线批量）共用，保证两条入口的
 * 路由归一、manifest 建表、checkpoint 落盘、SSE 帧序完全一致。
 */
function launchNarrativeRun(p: LaunchRunParams): LaunchedRun {
  const { tier, mode, genreCode: genre_code, entryKey: entry_key } = p;
  const auto_detect = p.autoDetect;
  const route_group = p.routeGroup;
  const use_blueprint = p.useBlueprint;
  const use_legacy_pipeline = p.useLegacyPipeline;
  const parsedUploadedScript = p.uploadedScript;
  const userInput = p.userInput;

  // ── Routing mode resolution (A1) ──────────────────────────────────────────
  // - auto:    no fields given, LLM detects tier+genre+complexity
  // - semi:    user gave some (e.g. tier) but not all, LLM fills the rest
  // - manual:  all dimensions specified, skip LLM tier detection entirely
  // If client did not send routing_mode, derive from auto_detect / tier presence
  const resolvedRoutingMode: RoutingMode =
    p.routingMode ??
    (auto_detect === false ? "manual" : (tier ? "semi" : "auto"));

  // Manual mode: complexity falls back to tier default when omitted (A2)
  let effectiveComplexity = p.complexity;
  if (resolvedRoutingMode === "manual" && tier && effectiveComplexity == null) {
    effectiveComplexity = TIER_DEFAULT_COMPLEXITY[tier];
    console.log(`[Server] manual routing: complexity not provided, using tier default ${effectiveComplexity}`);
  }
  // Phase 3.5: 移除 tier4 强制 complexity=1。
  // 用户最新拍板：除"自动"路由外，所有 tier 任何品类都可自由选 1-5 档复杂度。
  // 旧的强制覆盖会让用户在 tier4 下选了"短篇"也被悄悄改成"极简"，违反契约。

  let resolvedMode = mode;
  if (tier && resolvedMode) {
    const tierModes = getModesForTier(tier);
    if (!tierModes.some((m) => m.id === resolvedMode)) {
      resolvedMode = TIER_DEFAULT_MODE[tier] ?? resolvedMode;
      console.log(`⚠️ Mode '${mode}' not in tier '${tier}' available list, falling back to '${resolvedMode}'`);
    }
  } else if (tier && !resolvedMode) {
    resolvedMode = TIER_DEFAULT_MODE[tier];
  }

  const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resolvedModel = p.model ?? getDefaultModel();

  // §条目提前建立：复用前端草稿键作为落盘目录（仅接受安全的相对目录名，防路径穿越）。
  const isSafeEntryKey = isSafeEntryKeyFn(entry_key);
  // 身份（pipelineId）与位置（primary）分开：主管线也带身份，但不下沉子目录。
  const placement = isSafeEntryKey
    ? resolveRunPlacement({ entryKey: entry_key!, pipelineId: p.pipelineId, primary: p.primary })
    : undefined;
  const isPrimaryPipeline = placement?.primary ?? true;
  const runDir = placement?.runDir;
  const reuseOutputDir = runDir ? path.join(outputDir(), runDir) : undefined;

  // A2-2: explicit genre_code makes manual routing implicit (we have genre + tier when both provided)
  const hasExplicitGenre = typeof genre_code === "string" && genre_code.trim().length > 0;

  // 三轴路由：结构由品类/类型/题材综合推导，用户显式指定则短路（PRD v1.4 §3.2.2）。
  // 类型/题材先按「直选优先、标签兜底」定下来，再投票 —— 否则标签路径的条目
  // 两个轴恒为 null，投票退化成品类单轴。
  const entryTags = p.tags ?? (isSafeEntryKey ? loadEntryConfig(entry_key!)?.tags : undefined);
  const userAxes = resolveUserAxes({
    storyType: p.storyType,
    storyTheme: p.storyTheme,
    tags: entryTags,
  });
  const resolvedStructure = resolveNarrativeStructure({
    genreCode: hasExplicitGenre ? genre_code!.trim() : null,
    storyType: userAxes.storyType,
    storyTheme: userAxes.storyTheme,
    explicit: p.narrativeStructure,
  });
  const narrativeAxes: NarrativeAxesSelection = {
    genre: hasExplicitGenre ? genre_code!.trim() : null,
    storyType: userAxes.storyType,
    storyTheme: userAxes.storyTheme,
    structure: resolvedStructure.structure,
  };
  const state: RunState = {
    id,
    status: "running",
    progress: [],
    streamBuffer: [],
    startedAt: new Date().toISOString(),
    tier,
    mode: resolvedMode,
    userInput,
    routeGroup: route_group,
    complexity: effectiveComplexity,
    routingMode: resolvedRoutingMode,
    genreCode: hasExplicitGenre ? genre_code!.trim() : undefined,
    narrativeAxes,
    structureSource: resolvedStructure.source,
    structureRationale: buildStructureRationale(resolvedStructure, userAxes.derived),
    model: resolvedModel,
    outputDir: reuseOutputDir,
    pipelineId: p.pipelineId,
    entryKey: isSafeEntryKey ? entry_key : undefined,
  };
  runs.set(id, state);

  const contentLocale = parseContentLocale(p.locale);

  // §条目持久化（开始生成自动保存兜底）：把当次最终配置 upsert 回 output/<key>/_entry.json。
  // 即使用户没点 ROUTING「确认保存」，开始生成也会落盘一份，保证条目参数可还原。
  // 多管线时条目级配置由 /entry/start 统一写一次，各管线 run 不再互相覆盖。
  if (isSafeEntryKey && isPrimaryPipeline) {
    try {
      writeEntryConfig(entry_key!, {
        userInput: state.userInput,
        routeGroup: route_group,
        tier,
        mode: resolvedMode,
        genreCode: state.genreCode,
        storyType: narrativeAxes.storyType ?? undefined,
        storyTheme: narrativeAxes.storyTheme ?? undefined,
        // 条目只存**用户的覆盖**，不存推导结论。结论是三轴的派生值，落盘后会在
        // 下一次被当成 explicit 读回来短路投票 —— 用户改了类型或题材，结构却
        // 永远锁在第一次的结论上。结论要看哪一次跑成什么，去那次的 manifest 读。
        narrativeStructure:
          resolvedStructure.source === "explicit"
            ? (narrativeAxes.structure ?? undefined)
            : undefined,
        complexity: effectiveComplexity,
        locale: contentLocale,
      });
    } catch (e) {
      console.error("[Server] writeEntryConfig on start failed:", e);
    }
  }

  const pipeline = new NarrativePipeline({
    apiKey: API_KEY || undefined,
    proxyUrl: LLM_PROXY_URL || undefined,
    proxyApiKey: LLM_PROXY_KEY || undefined,
    model: resolvedModel,
    complexity: state.complexity,
    // 自由编排真执行：画布给的步序直达 run()，与 /plan 预览同一条链。
    requestedSteps: p.requestedSteps,
    // 勾选启用的默认关席位：预置管线照跑，只在锚点席后多挂这几席。
    activateSeats: p.activateSeats,
    // 专属团队（2.4）：profile 在这里就位，各席位的注入由 prepareInjection 逐步完成。
    customTeamProfile: resolveTeamProfile(p.teamId),
    onProgress: (p) => {
      if (p.type === "streaming") {
        state.streamBuffer.push(p);
      } else {
        state.progress.push(p);
      }
      capturePipelineSteps(state, p);
      if (p.type !== "streaming" && p.status === "running" && p.stepId) {
        transitionAgent(state, p.stepId, "running");
      }
      if (!state.tier && p.stepId === "tier_router" && p.status === "completed") {
        state.tier = p.message?.match(/tier[1-4]/)?.[0] as TierId | undefined;
      }
      if (p.status === "completed" && p.stepId && p.data != null) {
        saveStepIncremental(state, p.stepId, p.data);
      }
      noteSkippedStep(state, p);
    },
    onStepComplete: (stepId, ctx) => {
      transitionAgent(state, stepId, "completed");
      saveCheckpoint(state, stepId, ctx);
      saveCompanionData(state, stepId, ctx);
      if (!state.completedSteps) state.completedSteps = [];
      state.completedSteps.push(stepId);
      writeManifestIncremental(state);
    },
    tier,
    mode: resolvedMode,
    // A2-2: when frontend provides explicit genre_code, treat it as manual:
    // skip both tier detection AND genre detection. Otherwise:
    // - manual routing: skip LLM tier detection
    // - auto/semi: run LLM detection as before
    autoDetectTier: hasExplicitGenre ? false : (resolvedRoutingMode === "manual" ? false : (auto_detect !== false)),
    genreCode: hasExplicitGenre ? genre_code!.trim() : undefined,
    narrativeAxes,
    narrativeTags: entryTags,
    usePlanner: use_legacy_pipeline === true ? false : undefined,
    locale: contentLocale,
  });

  writeManifestIncremental(state);

  // ── D4: pipeline_steps_announce ──────────────────────────────────────────
  // Emit the planned step list as the very first SSE frame, so the frontend
  // can paint all step rows as "pending" without depending on hardcoded
  // route tables. We compute a best-effort step list from the resolved mode;
  // when running in narrative_auto mode we leave `steps` empty and let the
  // frontend keep its preview until concrete progress events arrive.
  let announcedTemplate: string | undefined;
  try {
    const announce = buildPipelineStepsAnnounce(state, resolvedMode, tier);
    announcedTemplate = announce.pipelineTemplate;
    // 空步序不发帧：它一个信息都不带（模板/品类此时同样为空），发出去只会让下游
    // 多一帧需要辨识的噪声。真正的步序由 pipeline.run() 的 announce 帧补上。
    if (announce.steps.length > 0) {
      state.progress.unshift({
        type: "pipeline_steps_announce",
        stage: "announce",
        step: 0,
        totalSteps: announce.steps.length,
        status: "pending",
        steps: announce.steps,
        stepNames: stepDisplayNames(announce.steps),
        metaSteps: [...BANNER_STEP_IDS],
        stepGroups: announce.stepGroups,
        pipelineTemplate: announce.pipelineTemplate,
        complexity: state.complexity,
        routingMode: state.routingMode,
        // A2-4: 显式品类时把 genre_code 带到 announce 帧，让前端知道走的是 manual 路由
        genreCode: state.genreCode,
      });
      // Phase 1: 同步刷新 state.pipelineSteps，让首次 saveCheckpoint / writeManifestIncremental
      // 就能带上 pipelineOrder（不必等下一次 onProgress）。
      state.pipelineSteps = [...announce.steps];
    }
  } catch (e) {
    console.warn("[Server] pipeline_steps_announce skipped:", (e as Error).message);
  }

  // Phase-2 M7: RunManifest 成为本次运行的事实源。步骤序取 announce 的那一份
  // （auto 路由首帧可能为空，届时由 capturePipelineSteps 的二补帧对齐）。
  initRunManifest(state, state.pipelineSteps ?? [], {
    locale: contentLocale,
    pipelineTemplate: announcedTemplate,
  });

  const injectCtxHelpers = (ctx: NarrativeContext) => {
    const ctxAny = ctx as Record<string, unknown>;
    if (!ctxAny._saveNode) {
      ctxAny._saveNode = (stepId: string, nodeId: string, data: unknown) =>
        saveNodeFile(state, stepId, nodeId, data);
    }
    if (!ctxAny._questCompletedNodes) {
      ctxAny._questCompletedNodes = new Set<string>();
    }
  };

  const origOnStep = pipeline["config"].onStepComplete;
  pipeline["config"].onStepComplete = (stepId: string, ctx: NarrativeContext) => {
    injectCtxHelpers(ctx);

    // 将前端选择的 complexity 合并到 global_control_params（优先于 LLM 输出）
    if (stepId === "preference_analysis" && state.complexity != null && ctx.global_control_params) {
      const uiComplexity = Math.round(Math.max(1, Math.min(5, state.complexity)));
      if (uiComplexity !== ctx.global_control_params.complexity) {
        console.log(`[Server] Override complexity: LLM=${ctx.global_control_params.complexity} → UI=${uiComplexity}`);
        ctx.global_control_params.complexity = uiComplexity;
      }
    }

    origOnStep?.(stepId, ctx);
  };

  const runOpts = parsedUploadedScript ? { uploadedScript: parsedUploadedScript } : undefined;
  const pipelinePromise = use_blueprint
    ? pipeline.runWithBlueprint(userInput, runOpts).then(({ ctx: result, blueprint }) => {
        applyRunTransition(state, { type: "completed", result });
        (state as unknown as Record<string, unknown>).blueprint = blueprint;
        try { saveRunToFile(state); } catch (e) { console.error("Failed to save result:", e); }
      })
    : pipeline.run(userInput, runOpts).then((result) => {
        applyRunTransition(state, { type: "completed", result });
        try { saveRunToFile(state); } catch (e) { console.error("Failed to save result:", e); }
      });

  pipelinePromise.catch((err) => {
      applyRunTransition(state, { type: "failed", error: (err as Error).message });
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save error:", e); }
    });

  // §条目提前建立：复用草稿键时 sourceDir = run 目录相对路径（多管线含 pipelines/<pid>），
  // 否则按启动时间戳。
  const sourceDir = runDir ?? formatTimestamp(state.startedAt);
  return {
    id,
    entryKey: resolveStateEntryKey(state),
    sourceDir,
    tier,
    mode: resolvedMode,
    pipelineId: p.pipelineId,
  };
}

/**
 * Phase-2 M8：条目级批量启动 —— 一条目下每条可运行管线各起一个 run。
 *
 * 每条管线独立 runId / SSE 流 / RunManifest / checkpoint；不完整的管线原样跳过
 * 并回报原因，不阻塞其余管线。首条可运行管线作为主管线落 `output/<key>/`
 * （历史列表 / fork / 载入沿用既有路径），其余落 `output/<key>/pipelines/<pipelineId>/`。
 */
app.post("/api/narrative/entry/start", (req, res) => {
  const body = req.body as {
    entry_key?: string;
    model?: string;
    locale?: ContentLocale;
    pipelines?: Array<{
      pipelineId?: string;
      complete?: boolean;
      incompletenessReason?: string;
      userInput?: string;
      tier?: TierId;
      mode?: ModeId;
      genreCode?: string | null;
      storyType?: string | null;
      storyTheme?: string | null;
      narrativeStructure?: string | null;
      /** 标签选择；类型/题材为空时兜底推导两轴。不传则由 launchNarrativeRun 从 `_entry.json` 读。 */
      tags?: NarrativeTagSelection;
      complexity?: number;
      routeGroup?: "planning" | "narrative";
      autoDetect?: boolean;
      pipelineTemplate?: string;
      /** 画布上这条泳道用户自己连的步序；给了就以它为准，与 /plan 的 requestedStepsByStart 同源。 */
      requestedSteps?: string[];
      /** 这条泳道勾选启用的默认关席位（逐泳道独立：一个条目里可以只给其中一条加打磨）。 */
      activateSeats?: string[];
      /** 这条泳道带哪个自定义专属团队（2.4）；逐泳道独立，因为一个条目里不同管线可以配不同团队。 */
      teamId?: string;
    }>;
  };

  const entryKey = body.entry_key;
  if (!isSafeEntryKeyFn(entryKey)) {
    res.status(400).json({ error: "entry_key is required and must be a safe directory name" });
    return;
  }
  const requested = body.pipelines ?? [];
  if (requested.length === 0) {
    res.status(400).json({ error: "pipelines is required (at least one pipeline)" });
    return;
  }

  const conflicting = findConflictingRun(entryKey);
  if (conflicting) {
    res.status(409).json({
      error: `已有运行中的管线 (${conflicting.id})，请等待完成或取消后再试`,
    });
    return;
  }

  const contentLocale = parseContentLocale(body.locale);
  // 自由编排里带跑不起来的环节，按既有口径当作该泳道不完整跳过并回报原因，
  // 不连坐其余泳道；静默丢步才是要消掉的那种失败。
  const runnable = requested.filter(
    (p) =>
      p.complete !== false &&
      !!p.userInput?.trim() &&
      unrunnableSteps(p.requestedSteps).length === 0,
  );
  const skipped = requested
    .filter((p) => !runnable.includes(p))
    .map((p) => {
      const bad = unrunnableSteps(p.requestedSteps);
      return {
        pipelineId: p.pipelineId,
        reason:
          p.complete === false
            ? (p.incompletenessReason ?? "incomplete")
            : !p.userInput?.trim()
              ? "missing_user_input"
              : `unrunnable_steps: ${bad.join(", ")}`,
        unrunnableSteps: bad.length > 0 ? bad : undefined,
      };
    });

  if (runnable.length === 0) {
    res.status(400).json({ error: "no runnable pipeline", skipped });
    return;
  }

  // 条目级配置只写一次（取主管线参数），避免各管线 run 互相覆盖 _entry.json。
  const primary = runnable[0]!;
  try {
    writeEntryConfig(entryKey, {
      userInput: primary.userInput,
      routeGroup: primary.routeGroup,
      tier: primary.tier,
      mode: primary.mode,
      genreCode: primary.genreCode ?? undefined,
      storyType: primary.storyType ?? undefined,
      storyTheme: primary.storyTheme ?? undefined,
      // 这个字段是**用户覆盖**的透传通道：调用方传了就是他显式点了某个结构。
      // 不要把 /plan 回的推导结论填进来 —— 那会在下一次被当成 explicit 读回去，
      // 把三轴投票永久短路（见 launchNarrativeRun 里的落盘注释）。
      narrativeStructure: primary.narrativeStructure ?? undefined,
      complexity: primary.complexity,
      locale: contentLocale,
    });
  } catch (e) {
    console.error("[Server] writeEntryConfig on entry/start failed:", e);
  }

  const launched = runnable.map((p, i) =>
    launchNarrativeRun({
      userInput: p.userInput!.trim(),
      model: body.model,
      tier: p.tier,
      mode: p.mode,
      autoDetect: p.autoDetect,
      routeGroup: p.routeGroup,
      complexity: p.complexity,
      genreCode: p.genreCode ?? undefined,
      storyType: p.storyType ?? undefined,
      storyTheme: p.storyTheme ?? undefined,
      narrativeStructure: p.narrativeStructure ?? undefined,
      tags: p.tags,
      entryKey,
      locale: body.locale,
      // 身份一律沿用 /plan 铸的 pipelineId（前端泳道键与 SSE 帧同源的唯一保证）；
      // 首条可运行管线为主管线，只是不下沉子目录。
      pipelineId: p.pipelineId,
      primary: i === 0,
      requestedSteps: p.requestedSteps,
      activateSeats: p.activateSeats,
      teamId: p.teamId,
    }),
  );

  /*
   * 把每条泳道的产物目录回写进 `_entry.json.pipelines[]`。
   *
   * 泳道与目录的对应关系只有启动时刻知道：主管线的产物落条目根、次管线落
   * `pipelines/<pipelineId>/`，而「谁是主」取决于哪几条真跑起来了（跳过的不占位）。
   * 不回写，重启后前端只能按下标猜主次——跳过一条就全错。
   */
  try {
    const dirByPipeline = new Map<string, PipelineLocation>();
    launched.forEach((r, i) => {
      const pid = runnable[i]!.pipelineId;
      if (pid) dirByPipeline.set(pid, { sourceDir: r.sourceDir, primary: i === 0 });
    });
    const existing = loadEntryConfig(entryKey);
    if (Array.isArray(existing?.pipelines) && dirByPipeline.size > 0) {
      writeEntryConfig(entryKey, {
        pipelines: applyPipelineLocations(existing!.pipelines!, dirByPipeline),
      });
    }
  } catch (e) {
    console.error("[Server] pipeline sourceDir writeback failed:", e);
  }

  res.json({
    entryKey,
    runs: launched.map((r, i) => ({
      runId: r.id,
      pipelineId: runnable[i]!.pipelineId,
      sourceDir: r.sourceDir,
      tier: r.tier,
      mode: r.mode,
      primary: i === 0,
    })),
    skipped,
    count: launched.length,
  });
});

app.post("/api/narrative/resume", async (req, res) => {
  const { dir, model, locale } = req.body as { dir?: string; model?: string; locale?: ContentLocale };
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required (run directory name)" });
    return;
  }
  // Phase-2 M8: 接受 `<key>` 与 `<key>/pipelines/<pipelineId>` 两种 run 目录，逐段校验防穿越。
  const resumeTarget = parseRunDirName(dir.trim());
  if (!resumeTarget) {
    res.status(400).json({ error: `invalid run directory: ${dir}` });
    return;
  }

  const activeRunning = findConflictingRun(resumeTarget.entryKey, resumeTarget.pipelineId);
  if (activeRunning) {
    res.status(409).json({ error: `已有运行中的管线 (${activeRunning.id})，请等待完成或取消后再试` });
    return;
  }

  const checkpoint = loadCheckpoint(dir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${dir}` });
    return;
  }

  const id = `resume_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resumeModel = model ?? checkpoint.model ?? getDefaultModel();

  // Resume writes to the SAME directory (not a new one)
  const state: RunState = {
    id,
    status: "running",
    progress: [],
    streamBuffer: [],
    startedAt: checkpoint.startedAt,
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    userInput: checkpoint.userInput ?? checkpoint.ctx.user_input,
    routeGroup: checkpoint.routeGroup,
    complexity: checkpoint.complexity ?? checkpoint.ctx.global_control_params?.complexity,
    model: resumeModel,
    outputDir: path.join(outputDir(), dir),
    completedSteps: [...(checkpoint.completedSteps ?? [])],
    // Phase 1: 从 checkpoint 恢复"权威步骤序"与启动参数。
    // 这些字段让 resume 写新 checkpoint 时不丢失原始管线快照；
    // 若是旧版 checkpoint 缺这些字段，fallback 到 ctx.tier_detection.genre_code。
    pipelineSteps:
      checkpoint.pipelineOrder && checkpoint.pipelineOrder.length > 0
        ? [...checkpoint.pipelineOrder]
        : undefined,
    genreCode:
      checkpoint.genre_code ??
      (checkpoint.ctx.tier_detection?.genre_code !== "manual"
        ? checkpoint.ctx.tier_detection?.genre_code
        : undefined) ??
      checkpoint.ctx.demand_analysis?.genre_code,
    routingMode: checkpoint.routingMode,
    // 三轴随 ctx 落盘，续跑照抄，manifest 才不会在第二段少掉路由结论。
    narrativeAxes: checkpoint.ctx.narrative_axes,
    checkpointAgents: checkpoint.agents,
    entryKey: resumeTarget.entryKey,
    pipelineId: resumeTarget.pipelineId,
  };
  runs.set(id, state);

  const resumeLocale = resolveRunLocale({
    requestLocale: locale,
    checkpointCtx: checkpoint.ctx,
    entryKey: dir,
  });

  // Phase-2 M7: lifecycle 是 resume 的事实源。新 checkpoint 直接读 agents[].lifecycle；
  // 一期落盘的旧 checkpoint 用 completedSteps + lastCompletedStep 桥接补齐。
  const resumeLifecycle = lifecycleFromCheckpoint(checkpoint);
  const resumeManifest = loadRunManifest(dir);
  if (resumeManifest) {
    resumeManifest.status = "running";
    resumeManifest.runId = id;
    for (const [agentId, status] of Object.entries(resumeLifecycle)) {
      markAgentLifecycle(resumeManifest, agentId, status);
    }
    state.manifest = resumeManifest;
    writeRunManifest(state);
  } else {
    // 旧条目无 `_run_manifest.json`：按 checkpoint 的权威步骤序补建，使续跑后也有事实源。
    initRunManifest(state, state.pipelineSteps ?? Object.keys(resumeLifecycle), {
      locale: resumeLocale,
      lifecycle: resumeLifecycle,
    });
  }

  const pipeline = new NarrativePipeline({
    apiKey: API_KEY || undefined,
    proxyUrl: LLM_PROXY_URL || undefined,
    proxyApiKey: LLM_PROXY_KEY || undefined,
    model: resumeModel,
    complexity: state.complexity,
    onProgress: (p) => {
      if (p.type === "streaming") {
        state.streamBuffer.push(p);
      } else {
        state.progress.push(p);
      }
      capturePipelineSteps(state, p);
      if (p.type !== "streaming" && p.status === "running" && p.stepId) {
        transitionAgent(state, p.stepId, "running");
      }
      if (p.status === "completed" && p.stepId && p.data != null) {
        saveStepIncremental(state, p.stepId, p.data);
      }
      noteSkippedStep(state, p);
    },
    onStepComplete: (stepId, ctx) => {
      transitionAgent(state, stepId, "completed");
      saveCheckpoint(state, stepId, ctx);
      saveCompanionData(state, stepId, ctx);
      if (!state.completedSteps) state.completedSteps = [];
      if (!state.completedSteps.includes(stepId)) state.completedSteps.push(stepId);
      writeManifestIncremental(state);
    },
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    autoDetectTier: false,
    resumeCtx: checkpoint.ctx,
    resumeAfterStep: checkpoint.lastCompletedStep,
    agentLifecycle: resumeLifecycle,
    locale: resumeLocale,
  });

  // Update manifest status to running (same directory)
  writeManifestIncremental(state);

  // Phase 1: resume 也要发一帧 pipeline_steps_announce，让前端 SSE 收到后立刻
  // 恢复 pipelineOrder（否则切到 resume 这一刻 PipelineStatus 短暂为空）。
  // 优先使用 checkpoint 持久化的 pipelineOrder（最权威，含动态追加的 narrative steps）；
  // 缺失时用 buildPipelineStepsAnnounce 静态推导。
  try {
    let resumeAnnounceSteps: string[] = state.pipelineSteps ?? [];
    let resumeAnnounceTemplate: string | undefined;
    if (resumeAnnounceSteps.length === 0) {
      console.warn(
        `[Resume] 旧版 checkpoint 缺少 pipelineOrder，回退静态推导。` +
        ` 若首跑为 design_auto 且动态追加了叙事步骤，resume 步骤序可能不完整。`,
      );
      const announce = buildPipelineStepsAnnounce(state, checkpoint.mode, checkpoint.tier);
      resumeAnnounceSteps = announce.steps;
      resumeAnnounceTemplate = announce.pipelineTemplate;
    } else {
      const entry = state.genreCode
        ? GENRE_TAXONOMY.find((g) => g.code === state.genreCode)
        : null;
      resumeAnnounceTemplate = entry?.pipelineTemplate;
    }
    if (resumeAnnounceSteps.length > 0) {
      state.progress.unshift({
        type: "pipeline_steps_announce",
        stage: "announce",
        step: 0,
        totalSteps: resumeAnnounceSteps.length,
        status: "pending",
        steps: resumeAnnounceSteps,
        stepNames: stepDisplayNames(resumeAnnounceSteps),
        metaSteps: [...BANNER_STEP_IDS],
        pipelineTemplate: resumeAnnounceTemplate,
        complexity: state.complexity,
        routingMode: state.routingMode,
        genreCode: state.genreCode,
      });
      state.pipelineSteps = [...resumeAnnounceSteps];
    }
  } catch (e) {
    console.warn("[Server] resume pipeline_steps_announce skipped:", (e as Error).message);
  }

  const injectResumeCtxHelpers = (ctx: NarrativeContext) => {
    const ctxAny = ctx as Record<string, unknown>;
    if (!ctxAny._saveNode) {
      ctxAny._saveNode = (stepId: string, nodeId: string, data: unknown) =>
        saveNodeFile(state, stepId, nodeId, data);
    }
    if (!ctxAny._questCompletedNodes) {
      ctxAny._questCompletedNodes = new Set<string>();
    }
  };

  const origResumeOnStep = pipeline["config"].onStepComplete;
  pipeline["config"].onStepComplete = (stepId: string, ctx: NarrativeContext) => {
    injectResumeCtxHelpers(ctx);
    origResumeOnStep?.(stepId, ctx);
  };

  pipeline
    .run(checkpoint.ctx.user_input ?? "")
    .then((result) => {
      applyRunTransition(state, { type: "completed", result });
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save resumed result:", e); }
    })
    .catch((err) => {
      applyRunTransition(state, { type: "failed", error: (err as Error).message });
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save resumed error:", e); }
    });

  res.json({
    id,
    status: "running",
    message: `Pipeline resumed from '${checkpoint.lastCompletedStep}'`,
    entryKey: dir,
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    lastCompletedStep: checkpoint.lastCompletedStep,
  });
});

// ── Regenerate (Fork): create a new entry from source, apply edits, re-run ──
app.post("/api/narrative/regenerate", async (req, res) => {
  console.warn("[API] /regenerate called at", new Date().toISOString());
  const {
    sourceDir, fromStepId, userInstructions, stopAfterStep,
    patchedContext, model, skipSteps, nodeFilter,
    editDrafts, locale,
  } = req.body as {
    sourceDir?: string;
    fromStepId?: string;
    userInstructions?: string;
    stopAfterStep?: string;
    patchedContext?: Record<string, unknown>;
    model?: string;
    skipSteps?: string[];
    nodeFilter?: Record<string, string[]>;
    editDrafts?: Record<string, { content?: unknown; userInput?: string }>;
    locale?: ContentLocale;
  };

  if (!sourceDir?.trim()) {
    res.status(400).json({ error: "sourceDir is required (original run directory name)" });
    return;
  }
  if (!fromStepId?.trim()) {
    res.status(400).json({ error: "fromStepId is required (step to re-run from)" });
    return;
  }

  // 按条目+泳道范围校验，与 /start、/resume 对齐（此前这里裸查全局 running，
  // 单节点重生成会被完全无关的另一个条目挡住——键权层调研 R1 定案的修复项）。
  const regenTarget = parseRunDirName(sourceDir.trim());
  const activeRunning = findConflictingRun(regenTarget?.entryKey, regenTarget?.pipelineId);
  if (activeRunning) {
    res.status(409).json({ error: `已有运行中的管线 (${activeRunning.id})，请等待完成或取消后再试` });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const id = `regen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resolvedModel = model ?? checkpoint.model ?? getDefaultModel();

  // Build fork reason from editDrafts summary
  const forkParts: string[] = [];
  if (editDrafts) {
    for (const [stepId, draft] of Object.entries(editDrafts)) {
      if (draft.userInput) forkParts.push(`${stepId}: ${draft.userInput.slice(0, 60)}`);
      else if (draft.content != null) forkParts.push(`${stepId}: 内容编辑`);
    }
  }
  if (userInstructions) forkParts.push(userInstructions.slice(0, 80));
  const forkReason = forkParts.join("; ") || `从 ${fromStepId} 重新生成`;

  const state: RunState = {
    id,
    status: "running",
    progress: [],
    streamBuffer: [],
    startedAt: new Date().toISOString(),
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    userInput: checkpoint.userInput ?? checkpoint.ctx.user_input,
    routeGroup: checkpoint.routeGroup,
    complexity: checkpoint.complexity ?? checkpoint.ctx.global_control_params?.complexity,
    model: resolvedModel,
    parentKey: sourceDir,
    forkReason,
    // Phase 1: 从 source checkpoint 继承"权威步骤序"与启动参数。
    pipelineSteps:
      checkpoint.pipelineOrder && checkpoint.pipelineOrder.length > 0
        ? [...checkpoint.pipelineOrder]
        : undefined,
    genreCode:
      checkpoint.genre_code ??
      (checkpoint.ctx.tier_detection?.genre_code !== "manual"
        ? checkpoint.ctx.tier_detection?.genre_code
        : undefined) ??
      checkpoint.ctx.demand_analysis?.genre_code,
    routingMode: checkpoint.routingMode,
  };
  runs.set(id, state);

  // Apply editDrafts to a copy of the ctx
  const ctx = { ...checkpoint.ctx };
  const stepMeta: Record<string, StepMeta> = { ...(checkpoint.step_meta ?? {}) };

  if (editDrafts) {
    for (const [stepId, draft] of Object.entries(editDrafts)) {
      const [baseStep, nodeId] = stepId.includes("::") ? stepId.split("::") : [stepId, undefined];
      const original = resolveStepContent(ctx, baseStep, nodeId);

      if (draft.content != null) {
        if (nodeId) {
          patchCtxNodeContent(ctx, baseStep, nodeId, draft.content);
        } else {
          // 合并步骤（initial_plan）需要拆分写入三个子字段，避免聚合对象误覆盖单字段
          setStepCtxData(baseStep, ctx, draft.content);
        }
      }

      const metaKey = nodeId ? `${baseStep}::${nodeId}` : baseStep;
      const meta: StepMeta = stepMeta[metaKey] ?? { needsRegen: true, modifications: [], version: 0 };
      meta.needsRegen = true;
      meta.modifications.push({
        original,
        edited: draft.content ?? undefined,
        userInstructions: draft.userInput?.trim() || undefined,
        modifiedAt: new Date().toISOString(),
      });
      meta.version++;
      stepMeta[metaKey] = meta;
    }
  }

  state.stepMeta = stepMeta;

  // Pre-populate completedSteps from source (steps before fromStepId)
  if (checkpoint.completedSteps) {
    const fromIdx = checkpoint.completedSteps.indexOf(fromStepId);
    if (fromIdx > 0) {
      state.completedSteps = checkpoint.completedSteps.slice(0, fromIdx);
    }
  }

  const regenLocale = resolveRunLocale({
    requestLocale: locale,
    checkpointCtx: checkpoint.ctx,
    entryKey: sourceDir,
  });

  // M4：fork 出来的新条目此前从不建 `_run_manifest.json`（没调 initRunManifest），
  // 即使后来给 then/catch 补了 finalizeRunManifest 也无 manifest 可收尾。
  // 按"权威步骤序 + 已完成前缀"补建，pre-fork 完成的步直接标 completed，
  // 与 /resume 从旧 checkpoint 桥接 lifecycle 是同一套逻辑（lifecycleFromCheckpoint）。
  initRunManifest(state, state.pipelineSteps ?? checkpoint.pipelineOrder ?? [], {
    locale: regenLocale,
    lifecycle: lifecycleFromCheckpoint({
      completedSteps: state.completedSteps ?? [],
      pipelineOrder: state.pipelineSteps ?? checkpoint.pipelineOrder,
    }),
  });

  const pipeline = new NarrativePipeline({
    apiKey: API_KEY || undefined,
    proxyUrl: LLM_PROXY_URL || undefined,
    proxyApiKey: LLM_PROXY_KEY || undefined,
    model: resolvedModel,
    complexity: state.complexity,
    onProgress: (p) => {
      if (p.type === "streaming") {
        state.streamBuffer.push(p);
      } else {
        state.progress.push(p);
      }
      capturePipelineSteps(state, p);
      if (p.type !== "streaming" && p.status === "running" && p.stepId) {
        transitionAgent(state, p.stepId, "running");
      }
      if (p.status === "completed" && p.stepId && p.data != null) {
        saveStepIncremental(state, p.stepId, p.data);
      }
      noteSkippedStep(state, p);
    },
    onStepComplete: (stepId, ctx) => {
      transitionAgent(state, stepId, "completed");
      saveCheckpoint(state, stepId, ctx);
      saveCompanionData(state, stepId, ctx);
      if (!state.completedSteps) state.completedSteps = [];
      state.completedSteps.push(stepId);
      writeManifestIncremental(state);
    },
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    autoDetectTier: false,
    locale: regenLocale,
  });

  // Write initial manifest + checkpoint for the fork
  writeManifestIncremental(state);
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const initMeta = resolveCheckpointMeta(state, ctx);
    const initCheckpoint: CheckpointData = {
      runId: id,
      tier: checkpoint.tier,
      mode: checkpoint.mode,
      startedAt: state.startedAt,
      lastCompletedStep: checkpoint.lastCompletedStep,
      completedSteps: state.completedSteps ?? [],
      savedAt: new Date().toISOString(),
      ctx,
      step_meta: stepMeta,
      userInput: state.userInput,
      routeGroup: state.routeGroup,
      complexity: state.complexity,
      model: resolvedModel,
      genre_code: initMeta.genre_code,
      pipelineOrder: initMeta.pipelineOrder,
      routingMode: initMeta.routingMode,
    };
    writeAssetFile(runDir, "_checkpoint.json", initCheckpoint);

    // Copy pre-fork step files so interrupted forks still have loadable data
    for (const sid of (state.completedSteps ?? [])) {
      const fileDef = STEP_FILE_MAP[sid];
      if (!fileDef) continue;
      const data = getStepDataForFile(sid, ctx);
      if (data != null) {
        const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
        writeAssetFile(runDir, filename, data);
        savePerNodeFiles(runDir, sid, fileDef, data);
      }
    }
  } catch (e) {
    console.error("Failed to write initial fork data:", e);
  }

  const injectRegenCtxHelpers = (ctx: NarrativeContext) => {
    const ctxAny = ctx as Record<string, unknown>;
    if (!ctxAny._saveNode) {
      ctxAny._saveNode = (stepId: string, nodeId: string, data: unknown) =>
        saveNodeFile(state, stepId, nodeId, data);
    }
    if (!ctxAny._questCompletedNodes) {
      ctxAny._questCompletedNodes = new Set<string>();
    }
  };

  const origRegenOnStep = pipeline["config"].onStepComplete;
  pipeline["config"].onStepComplete = (stepId: string, ctx: NarrativeContext) => {
    injectRegenCtxHelpers(ctx);
    origRegenOnStep?.(stepId, ctx);
  };

  // Phase 1: regenerate 也发首帧 announce，让前端 fork 模式能预填全量节点 +
  // 同步 pipelineOrder（与 startFork 的 preloadSteps 互补）。
  try {
    let regenAnnounceSteps: string[] = state.pipelineSteps ?? [];
    let regenAnnounceTemplate: string | undefined;
    if (regenAnnounceSteps.length === 0) {
      const announce = buildPipelineStepsAnnounce(state, checkpoint.mode, checkpoint.tier);
      regenAnnounceSteps = announce.steps;
      regenAnnounceTemplate = announce.pipelineTemplate;
    } else {
      const entry = state.genreCode
        ? GENRE_TAXONOMY.find((g) => g.code === state.genreCode)
        : null;
      regenAnnounceTemplate = entry?.pipelineTemplate;
    }
    if (regenAnnounceSteps.length > 0) {
      state.progress.unshift({
        type: "pipeline_steps_announce",
        stage: "announce",
        step: 0,
        totalSteps: regenAnnounceSteps.length,
        status: "pending",
        steps: regenAnnounceSteps,
        stepNames: stepDisplayNames(regenAnnounceSteps),
        metaSteps: [...BANNER_STEP_IDS],
        pipelineTemplate: regenAnnounceTemplate,
        complexity: state.complexity,
        routingMode: state.routingMode,
        genreCode: state.genreCode,
      });
      state.pipelineSteps = [...regenAnnounceSteps];
      // 这里是直接塞进 state.progress 的手写帧，不经过 onProgress/capturePipelineSteps，
      // 所以 manifest 不会跟着自动对齐——补一次显式同步，避免 fromStepId 之后的步
      // 在 `_run_manifest.json` 里对不上真正要跑的步骤序。
      if (state.manifest) {
        syncManifestAgents(state.manifest, state.pipelineSteps);
        writeRunManifest(state);
      }
    }
  } catch (e) {
    console.warn("[Server] regenerate pipeline_steps_announce skipped:", (e as Error).message);
  }

  const rerunOpts: RerunOptions = {};
  if (userInstructions?.trim()) rerunOpts.userInstructions = userInstructions.trim();
  if (stopAfterStep?.trim()) rerunOpts.stopAfterStep = stopAfterStep.trim();
  if (patchedContext && Object.keys(patchedContext).length > 0) {
    rerunOpts.patchedFields = patchedContext as Partial<NarrativeContext>;
  }
  if (skipSteps?.length) rerunOpts.skipSteps = skipSteps;
  if (nodeFilter && Object.keys(nodeFilter).length > 0) rerunOpts.nodeFilter = nodeFilter;
  rerunOpts.stepMeta = stepMeta;

  const staleSteps = pipeline.getStaleSteps(fromStepId, checkpoint.mode ?? "design_auto", ctx);

  // Derive the new entry key from the output directory name
  const newEntryKey = path.basename(getRunDir(state));

  pipeline
    .rerunFromStep(ctx, fromStepId, rerunOpts)
    .then((result) => {
      // 此前这条路径漏了 finalizeRunManifest：fork 出来的新条目 `_run_manifest.json`
      // 永远停在最后一次增量帧的状态，收不了尾（M4 修复，见 applyRunTransition 注释）。
      applyRunTransition(state, { type: "completed", result });
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save regenerated result:", e); }
    })
    .catch((err) => {
      applyRunTransition(state, { type: "failed", error: (err as Error).message });
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save regeneration error:", e); }
    });

  res.json({
    id,
    status: "running",
    message: `Fork from '${sourceDir}', regenerating from step '${fromStepId}'`,
    sourceDir,
    newEntryKey,
    fromStepId,
    staleSteps,
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    parentKey: sourceDir,
  });
});

// ── Stale steps preview (no execution, just returns which steps would be affected) ──
app.get("/api/narrative/stale-steps", (req, res) => {
  const { sourceDir, fromStepId } = req.query as { sourceDir?: string; fromStepId?: string };
  if (!sourceDir?.trim() || !fromStepId?.trim()) {
    res.status(400).json({ error: "sourceDir and fromStepId are required as query params" });
    return;
  }
  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }
  const mode = checkpoint.mode ?? "design_auto";
  const pipeline = new NarrativePipeline({});
  const staleSteps = pipeline.getStaleSteps(fromStepId, mode, checkpoint.ctx);
  const staleFields = staleSteps.flatMap(s => STEP_OUTPUT_FIELDS[s] ?? []);
  res.json({ fromStepId, mode, staleSteps, staleFields });
});

// ── Review state persistence ──

interface ReviewEntry {
  stepId: string;
  status: "pending" | "approved" | "rejected";
  feedback?: string;
  reviewedAt?: string;
  regenerateRunId?: string;
}

interface ReviewState {
  entries: ReviewEntry[];
  updatedAt: string;
}

// ── Edit history persistence (_edits.json + _original/) ──
// 账本的归并规则在 edit-store.ts（纯函数，可单测）；这里只做磁盘那一半。

const ORIGINAL_SUBDIR = "_original";

function loadEditsState(dir: string): EditsState {
  const editsPath = path.join(outputDir(), dir, "_edits.json");
  if (fs.existsSync(editsPath)) {
    try {
      return normalizeEditsState(JSON.parse(fs.readFileSync(editsPath, "utf-8")));
    } catch { /* corrupt file */ }
  }
  return normalizeEditsState(null);
}

function saveEditsState(dir: string, state: EditsState): void {
  const dirPath = path.join(outputDir(), dir);
  fs.mkdirSync(dirPath, { recursive: true });
  writeAssetFile(dirPath, "_edits.json", state);
}

/**
 * 存模型原稿。**首次编辑才写**：第二次编辑时"改前"已经是上一次编辑的结果，
 * 覆盖进去会让"还原原文"还原到一个中间稿。
 */
function saveOriginalContent(dir: string, stepId: string, nodeId: string | undefined, content: unknown): void {
  const origDir = path.join(outputDir(), dir, ORIGINAL_SUBDIR);
  fs.mkdirSync(origDir, { recursive: true });
  if (loadOriginalContent(dir, stepId, nodeId) != null) return;
  writeAssetFile(origDir, originalFileName(stepId, nodeId, content), content);
}

function loadOriginalContent(dir: string, stepId: string, nodeId?: string): unknown | null {
  const origDir = path.join(outputDir(), dir, ORIGINAL_SUBDIR);
  for (const name of originalFileCandidates(stepId, nodeId)) {
    const origPath = path.join(origDir, name);
    if (!fs.existsSync(origPath)) continue;
    try {
      const raw = fs.readFileSync(origPath, "utf-8");
      return name.endsWith(".json") ? JSON.parse(raw) : raw;
    } catch { /* corrupt file */ }
  }
  return null;
}

/** 丢掉原稿（还原之后它就没有意义了，留着只会让下次编辑误以为"已经存过原稿"）。 */
function dropOriginalContent(dir: string, stepId: string, nodeId?: string): void {
  const origDir = path.join(outputDir(), dir, ORIGINAL_SUBDIR);
  for (const name of originalFileCandidates(stepId, nodeId)) {
    const p = path.join(origDir, name);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* best effort */ }
  }
}

/**
 * 剧情树四层的节点数组在 ctx 里各自挂在哪（增删用）。
 *
 * 与 `PER_NODE_STEPS` 的分工：那个是读（拆成单节点文件），这个是写（拿到数组本体改结构）。
 * 只列这四层 —— 它们共用 `node_id + prev_node + next_node` 一套连接词汇。任务图
 * (`quest_graph`) 另有 `prerequisites` / `main_quest_chain` 等索引，同一套增删逻辑套上去
 * 会留下对不上的索引，所以它不在这张表里，端点会明确拒绝而不是凑合着改。
 */
const TREE_NODE_ARRAYS: Record<string, (ctx: NarrativeContext) => GraphNode[] | null> = {
  story_framework: (ctx) => (ctx.story_framework?.framework?.nodes as GraphNode[] | undefined) ?? null,
  outline_batch: (ctx) =>
    ((ctx as unknown as { outlines_generated?: { outlines?: GraphNode[] } }).outlines_generated?.outlines) ?? null,
  detailed_outline: (ctx) =>
    ((ctx as unknown as { detailed_outlines_generated?: { detailed_outlines?: GraphNode[] } })
      .detailed_outlines_generated?.detailed_outlines) ?? null,
  plot_generation: (ctx) =>
    ((ctx as unknown as { plots_generated?: { plots?: GraphNode[] } }).plots_generated?.plots) ?? null,
};

/** 把改完的数组装回 ctx 原处。 */
function setTreeNodes(ctx: NarrativeContext, stepId: string, nodes: GraphNode[]): boolean {
  const rec = ctx as unknown as Record<string, Record<string, unknown> | undefined>;
  if (stepId === "story_framework") {
    const sf = rec.story_framework as { framework?: { nodes?: unknown } } | undefined;
    if (!sf?.framework) return false;
    sf.framework.nodes = nodes;
    // 动态结构另存了一份同样的节点表，不同步会让下游按哪份走取决于它先读哪个字段。
    const dyn = (sf as { dynamic_structure?: { framework_nodes?: unknown } }).dynamic_structure;
    if (dyn?.framework_nodes) dyn.framework_nodes = nodes;
    return true;
  }
  if (stepId === "outline_batch") {
    if (!rec.outlines_generated) return false;
    rec.outlines_generated.outlines = nodes;
    return true;
  }
  if (stepId === "detailed_outline") {
    if (!rec.detailed_outlines_generated) return false;
    rec.detailed_outlines_generated.detailed_outlines = nodes;
    return true;
  }
  if (stepId === "plot_generation") {
    if (!rec.plots_generated) return false;
    rec.plots_generated.plots = nodes;
    return true;
  }
  return false;
}

/**
 * 与 ctx 脱钩的一份快照。
 *
 * 读 ctx 的那几个 helper（`getStepDataForFile` / `resolveStepContent`）返回的是 ctx 里的
 * 对象本身，不是副本。改前的内容要留着当原稿与账本里的 `originalContent`，
 * 而 ctx 紧接着就被改了 —— 拿引用当"改前"，两者会在同一次请求里变成同一份东西。
 */
function snapshot<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 把改动后的 ctx 写回断点。编辑要能活过刷新，靠的就是这一步（`/history/:key/load` 以 checkpoint 为先）。 */
function persistCheckpointCtx(dir: string, checkpoint: CheckpointData): void {
  const dirPath = path.join(outputDir(), dir);
  fs.mkdirSync(dirPath, { recursive: true });
  writeAssetFile(dirPath, "_checkpoint.json", checkpoint);
}

/**
 * 按改动后的 ctx 重写某一步的产物文件（整步那份 + 该步的全部单节点文件）。
 *
 * 与 `saveStepIncremental` 是同一件事，区别只在这里按目录名找路径、按 ctx 取数据 ——
 * 编辑发生在一次跑结束之后，那个 `RunState` 早从内存里清掉了。取数据走
 * `getStepDataForFile` 而非直接读 ctx 字段，`initial_plan` 那种三段聚合成一份文件的
 * 情形才不会写出个半成品。
 */
function rewriteStepArtifacts(dir: string, stepId: string, ctx: NarrativeContext): void {
  const fileDef = STEP_FILE_MAP[stepId];
  const stepData = getStepDataForFile(stepId, ctx);
  if (!fileDef || stepData == null) return;
  try {
    const runDir = path.join(outputDir(), dir);
    fs.mkdirSync(runDir, { recursive: true });
    writeAssetFile(runDir, `${fileDef.index}_${fileDef.name}.${fileDef.ext}`, stepData);
    savePerNodeFiles(runDir, stepId, fileDef, stepData);
    pruneStaleNodeFiles(runDir, stepId, fileDef, stepData);
  } catch (e) {
    console.error(`[rewriteStepArtifacts] ${dir}/${stepId}:`, e);
  }
}

/** 某一步整份产物的平铺相对路径（`rewriteStepArtifacts` 落盘用的同一个名字）；无映射返回 undefined。 */
function stepArtifactRelPath(stepId: string): string | undefined {
  const fileDef = STEP_FILE_MAP[stepId];
  return fileDef ? `${fileDef.index}_${fileDef.name}.${fileDef.ext}` : undefined;
}

/**
 * G5：在覆盖前把该步"整份"当前内容存一张版本快照（契约 §3.3）。
 *
 * 必须传"整份"而不是被编辑的那个节点——历史快照要能完整还原当时的平铺文件，
 * 只存一个节点的话，往后按版本号读回来的会是个残缺对象。调用方要在
 * `applyContentToCtx` 改动 ctx **之前**取好这份整份内容，否则快照存的就是新内容。
 */
/** 返回写入的版本号（M3 用来给 qa/apply 修复成功的 finding 标 fixedInVersion）；跳过/失败时 undefined。 */
function snapshotStepArtifactVersion(
  dir: string,
  stepId: string,
  wholeStepDataBeforeChange: unknown,
  origin?: VersionOrigin,
): number | undefined {
  if (wholeStepDataBeforeChange == null) return undefined;
  const relPath = stepArtifactRelPath(stepId);
  if (!relPath) return undefined;
  try {
    return snapshotVersion(path.join(outputDir(), dir), relPath, wholeStepDataBeforeChange, origin);
  } catch (e) {
    console.error(`[snapshotStepArtifactVersion] ${dir}/${stepId}:`, e);
    return undefined;
  }
}

/**
 * 清掉已经不存在的节点留下的单节点文件。
 *
 * `savePerNodeFiles` 只写不删 —— 生成期不需要删（节点只会长出来）。但用户删掉一个节点后，
 * 那份旧文件会继续躺在目录里，于是文件浏览、导出、下游读盘都还能看到一个"已删除"的节点。
 */
function pruneStaleNodeFiles(
  runDir: string,
  stepId: string,
  fileDef: { index: string; name: string },
  stepData: unknown,
): void {
  const extractor = PER_NODE_STEPS[stepId];
  if (!extractor) return;
  const subDir = path.join(runDir, `${fileDef.index}_${fileDef.name}`);
  if (!fs.existsSync(subDir)) return;
  const relPath = stepArtifactRelPath(stepId);
  const live = new Set(
    extractor(stepData).map((n) => String(n.id).replace(/[/\\?%*:|"<>]/g, "_")),
  );
  for (const f of fs.readdirSync(subDir)) {
    // 版本快照住在同一个目录里，它不是"某个节点的文件"，更不是残留——
    // 不认这一条的话，每次重写产物都会把历史版本清空，回退就无从谈起。
    if (relPath && isVersionFileName(relPath, f)) continue;
    const base = f.replace(/\.(json|md)$/, "");
    if (!live.has(base)) {
      try { fs.unlinkSync(path.join(subDir, f)); } catch { /* best effort */ }
    }
  }
}

/** 把内容写回 ctx：节点级走 `patchCtxNodeContent`，整步级走 `setStepCtxData`（含 initial_plan 拆段）。 */
function applyContentToCtx(
  ctx: NarrativeContext,
  stepId: string,
  nodeId: string | undefined,
  content: unknown,
): boolean {
  return nodeId
    ? patchCtxNodeContent(ctx, stepId, nodeId, content)
    : setStepCtxData(stepId, ctx, content);
}

function resolveStepContent(ctx: NarrativeContext, stepId: string, nodeId?: string): unknown | null {
  const stepData = resolveStepOutput(stepId, ctx);
  if (stepData == null) return null;
  if (!nodeId) return stepData;

  const extractor = PER_NODE_STEPS[stepId];
  if (!extractor) return stepData;
  const nodes = extractor(stepData);
  const match = nodes.find(n => n.id === nodeId);
  return match?.content ?? null;
}

function patchCtxNodeContent(ctx: NarrativeContext, stepId: string, nodeId: string, editedContent: unknown): boolean {
  const stepData = resolveStepOutput(stepId, ctx) as Record<string, unknown> | undefined;
  if (!stepData) return false;

  if (stepId === "story_framework") {
    const sf = stepData as unknown as StoryFramework;
    const idx = sf.framework?.nodes?.findIndex(n => n.node_id === nodeId);
    if (idx != null && idx >= 0 && sf.framework?.nodes) {
      sf.framework.nodes[idx] = editedContent as typeof sf.framework.nodes[0];
      return true;
    }
  } else if (stepId === "outline_batch") {
    const og = stepData as unknown as OutlinesGenerated;
    const idx = og.outlines?.findIndex(n => n.node_id === nodeId);
    if (idx != null && idx >= 0 && og.outlines) {
      og.outlines[idx] = editedContent as typeof og.outlines[0];
      return true;
    }
  } else if (stepId === "detailed_outline") {
    const dg = stepData as unknown as DetailedOutlinesGenerated;
    const idx = dg.detailed_outlines?.findIndex(n => n.node_id === nodeId);
    if (idx != null && idx >= 0 && dg.detailed_outlines) {
      dg.detailed_outlines[idx] = editedContent as typeof dg.detailed_outlines[0];
      return true;
    }
  } else if (stepId === "plot_generation") {
    const pg = stepData as unknown as PlotsGenerated;
    const idx = pg.plots?.findIndex(p => p.node_id === nodeId);
    if (idx != null && idx >= 0 && pg.plots) {
      pg.plots[idx] = editedContent as typeof pg.plots[0];
      return true;
    }
  } else if (stepId === "script_generation") {
    const js = stepData as unknown as JrpgScript;
    const idx = js.chapters?.findIndex(ch => (ch.chapter_id ?? ch.plot_node_id) === nodeId);
    if (idx != null && idx >= 0 && js.chapters) {
      js.chapters[idx] = editedContent as typeof js.chapters[0];
      return true;
    }
  } else if (stepId === "quest_generation") {
    const qg = stepData as unknown as QuestGraph;
    const idx = qg.quests?.findIndex(q => q.quest_id === nodeId);
    if (idx != null && idx >= 0 && qg.quests) {
      qg.quests[idx] = editedContent as typeof qg.quests[0];
      return true;
    }
  } else if (stepId === "scene_plan") {
    const sm = stepData as unknown as SceneMap;
    if (sm._phase2_per_node && nodeId in sm._phase2_per_node) {
      (sm._phase2_per_node as Record<string, unknown>)[nodeId] = editedContent;
      return true;
    }
  }
  return false;
}

/**
 * 保存一次正文编辑。
 *
 * 双份落盘：原稿进 `_original/`（只第一次写），改后的内容覆盖 ctx 与产物文件，
 * `_edits.json` 记一笔账。不带 `editedContent` 时退化为只读 —— 前端进编辑框前
 * 要先问一句"现在这份是什么"，那一问也走这个端点。
 */
app.post("/api/narrative/save-step-edit", (req, res) => {
  const { sourceDir, stepId, nodeId, editedContent, userInput } = req.body as {
    sourceDir?: string;
    stepId?: string;
    nodeId?: string;
    editedContent?: unknown;
    userInput?: string;
  };

  if (!sourceDir?.trim() || !stepId?.trim()) {
    res.status(400).json({ error: "sourceDir and stepId are required" });
    return;
  }
  // 这个端点会往 sourceDir 里写三处文件，穿越就是往 output 外面写，必须先拦。
  if (!isSafeSourceDir(sourceDir)) {
    res.status(400).json({ error: `非法 sourceDir: ${sourceDir}` });
    return;
  }

  // 键权层：这条泳道自己正在跑的话，编辑请求会跟正在写入的 checkpoint 竞态，先拦。
  // entryStatus 这里只需要"running / 非 running"两值即可判出 canEdit，不必算出
  // parseDirEntry 那套完整 effectiveStatus（那个开销大得多，且此处不需要 completed
  // 与 interrupted 的区分）。
  const editTarget = parseRunDirName(sourceDir);
  if (editTarget) {
    const guards = entryGuards({
      entryStatus: isLaneRunning(editTarget.entryKey, editTarget.pipelineId) ? "running" : "interrupted",
      hasConflictingRun: false,
    });
    if (!guards.canEdit) {
      res.status(409).json({ error: "该管线正在生成中，暂不能编辑；生成结束或取消后再试" });
      return;
    }
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  // 同样要脱钩：这份"改前"既要写进 `_original/`，又要记进账本的 originalContent，
  // 而它俩之间 ctx 已经被改过了。
  const currentContent = snapshot(resolveStepContent(checkpoint.ctx, stepId, nodeId));

  if (editedContent === undefined) {
    res.json({ ok: true, stepId, nodeId, originalContent: currentContent, persisted: false });
    return;
  }

  // 原稿先落盘再改 ctx：顺序颠倒的话，写 ctx 成功而写原稿失败就再也还原不回去了。
  saveOriginalContent(sourceDir, stepId, nodeId, currentContent);
  // G5：版本快照要存"整份"（`_original/` 存的可能只是这一个节点），且必须在 ctx
  // 被下面这行改动之前取——`getStepDataForFile` 读的是活的 ctx 引用。
  snapshotStepArtifactVersion(
    sourceDir,
    stepId,
    snapshot(getStepDataForFile(stepId, checkpoint.ctx)),
    { kind: "manual_edit" },
  );

  if (!applyContentToCtx(checkpoint.ctx, stepId, nodeId, editedContent)) {
    res.status(400).json({
      error: nodeId
        ? `Cannot patch node ${nodeId} of ${stepId} (unknown node or step not node-addressable)`
        : `Cannot patch step ${stepId} (unknown step)`,
    });
    return;
  }

  persistCheckpointCtx(sourceDir, checkpoint);
  rewriteStepArtifacts(sourceDir, stepId, checkpoint.ctx);
  saveEditsState(
    sourceDir,
    upsertEdit(loadEditsState(sourceDir), {
      stepId,
      nodeId,
      editedContent,
      userInput,
      originalContent: currentContent,
    }),
  );

  res.json({ ok: true, stepId, nodeId, originalContent: currentContent, persisted: true });
});

/**
 * 剧情树增删。
 *
 * 改与查早就有（`save-step-edit` + 文本视图的节点表），缺的是增删 —— 而增删不是数组
 * push/splice：连接是双向名单，动一个节点要同时动它上下游的名单，否则留下孤儿或悬空边。
 * 那套不变式在 node-crud.ts 里（纯函数），这里只负责取数组、落盘、记账。
 *
 * 与"重新生成"的分工：这里是**结构**改动（多一个节点、少一个节点），内容仍是空的/原样；
 * 想让模型把新节点的内容填出来，接着对它做单节点重 roll。
 */
app.post("/api/narrative/tree-node", (req, res) => {
  const { sourceDir, stepId, op, nodeId, node, prev, next } = req.body as {
    sourceDir?: string;
    stepId?: string;
    op?: "add" | "delete";
    nodeId?: string;
    node?: GraphNode;
    prev?: string[];
    next?: string[];
  };

  if (!sourceDir?.trim() || !stepId?.trim() || (op !== "add" && op !== "delete")) {
    res.status(400).json({ error: "sourceDir, stepId and op(add|delete) are required" });
    return;
  }
  if (!isSafeSourceDir(sourceDir)) {
    res.status(400).json({ error: `非法 sourceDir: ${sourceDir}` });
    return;
  }

  // 键权层：树增删同样是往 checkpoint 写，正在跑的泳道自己不能同时被手工改结构。
  const treeEditTarget = parseRunDirName(sourceDir);
  if (treeEditTarget) {
    const guards = entryGuards({
      entryStatus: isLaneRunning(treeEditTarget.entryKey, treeEditTarget.pipelineId) ? "running" : "interrupted",
      hasConflictingRun: false,
    });
    if (!guards.canEdit) {
      res.status(409).json({ error: "该管线正在生成中，暂不能增删节点；生成结束或取消后再试" });
      return;
    }
  }

  const accessor = TREE_NODE_ARRAYS[stepId];
  if (!accessor) {
    res.status(400).json({
      error: `${stepId} 不是剧情树层级（可增删的是 ${Object.keys(TREE_NODE_ARRAYS).join(" / ")}）。`
        + "任务图用的是另一套连接与索引，请走重新生成而不是手工增删。",
    });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const nodes = accessor(checkpoint.ctx);
  if (!nodes) {
    res.status(404).json({ error: `${stepId} 还没有产物，无法增删节点` });
    return;
  }

  let outcome: CrudOutcome;
  try {
    outcome = op === "add"
      ? insertNode(nodes, { node: node as GraphNode, prev, next })
      : removeNode(nodes, String(nodeId ?? ""));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  // 不变式破了就不落盘：宁可让这一次操作失败，也不要留一棵连接对不上的树 ——
  // 后者要到很远的下游步骤才暴露，而那时已经看不出是这次手工编辑造成的。
  //
  // 但只拦**这次改出来的**问题。模型的产物本来就可能带单向边（connection-repair
  // 存在就是为这个），拿全量校验当闸门会变成：用户删了第 7 个节点，却因为第 30 个节点
  // 原本就有的一条单向边被拒，还得读一屏与他无关的报错。
  const problemsBefore = new Set(validateNodeLinks(nodes));
  const introduced = validateNodeLinks(outcome.nodes).filter((p) => !problemsBefore.has(p));
  if (introduced.length) {
    res.status(409).json({ error: "改完之后连接不成立，未写入", problems: introduced });
    return;
  }

  // 深拷一份再改 ctx。`getStepDataForFile` 返回的是 ctx 里那个对象**本身**，
  // 而下一行就把它改了 —— 不拷的话存进 `_original/` 的"原稿"其实是改完的那份，
  // 「还原原文」会还原成当前内容，看起来像没反应。
  const before = snapshot(getStepDataForFile(stepId, checkpoint.ctx));
  if (!setTreeNodes(checkpoint.ctx, stepId, outcome.nodes)) {
    res.status(400).json({ error: `无法写回 ${stepId} 的节点数组` });
    return;
  }

  saveOriginalContent(sourceDir, stepId, undefined, before);
  persistCheckpointCtx(sourceDir, checkpoint);
  rewriteStepArtifacts(sourceDir, stepId, checkpoint.ctx);
  saveEditsState(
    sourceDir,
    upsertEdit(loadEditsState(sourceDir), {
      stepId,
      editedContent: getStepDataForFile(stepId, checkpoint.ctx),
      userInput: op === "add" ? `新增节点 ${node?.node_id ?? ""}` : `删除节点 ${nodeId ?? ""}`,
      originalContent: before,
    }),
  );

  // 原本就带的连接问题也说一声：不拦这次操作，但用户该知道这棵树自己有旧伤，
  // 否则他会把后面某一步的怪结果归到刚才这次增删上。
  const warnings = problemsBefore.size
    ? [...outcome.warnings, `这一层原本就有 ${problemsBefore.size} 处连接不一致（非本次操作造成）`]
    : outcome.warnings;

  // 删掉的节点那份单节点文件由 rewriteStepArtifacts 里的 pruneStaleNodeFiles 一并清掉，
  // 不清的话文本视图仍能翻到一个已经不在树上的节点。

  res.json({ ok: true, stepId, op, nodes: outcome.nodes, warnings });
});

// ── Get edits for a run directory ──

app.get("/api/narrative/edits/:dir", (req, res) => {
  const dir = req.params.dir;
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required" });
    return;
  }
  const edits = loadEditsState(dir);
  res.json(edits);
});

/**
 * 还原原文：把 `_original/` 里那份模型原稿写回 ctx 与产物文件，并撤掉账本里那一条。
 *
 * 没有原稿就 404 而不是假装成功 —— 这里此前返回 `{ok:true}` 却什么都不做，
 * 用户点了"还原"、界面说好了、内容一动没动，是最难自查的一种失败。
 */
app.post("/api/narrative/restore-original", (req, res) => {
  const { sourceDir, stepId, nodeId } = req.body as {
    sourceDir?: string;
    stepId?: string;
    nodeId?: string;
  };

  if (!sourceDir?.trim() || !stepId?.trim()) {
    res.status(400).json({ error: "sourceDir and stepId are required" });
    return;
  }
  if (!isSafeSourceDir(sourceDir)) {
    res.status(400).json({ error: `非法 sourceDir: ${sourceDir}` });
    return;
  }

  const original = loadOriginalContent(sourceDir, stepId, nodeId);
  if (original == null) {
    res.status(404).json({ error: `No original kept for ${editKey(stepId, nodeId)} in ${sourceDir}` });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  // G5：还原也会覆盖平铺文件的当前内容——把"被还原掉的那一稿"存一张快照，
  // 否则用户还原之后就再也无法把定稿引用钉回那个刚被丢弃的版本。同样必须在
  // applyContentToCtx 改动 ctx 之前取整份内容。
  snapshotStepArtifactVersion(
    sourceDir,
    stepId,
    snapshot(getStepDataForFile(stepId, checkpoint.ctx)),
    { kind: "restore_original" },
  );

  if (!applyContentToCtx(checkpoint.ctx, stepId, nodeId, original)) {
    res.status(400).json({ error: `Cannot restore ${editKey(stepId, nodeId)} (unknown step or node)` });
    return;
  }

  persistCheckpointCtx(sourceDir, checkpoint);
  rewriteStepArtifacts(sourceDir, stepId, checkpoint.ctx);
  saveEditsState(sourceDir, removeEdit(loadEditsState(sourceDir), stepId, nodeId));
  dropOriginalContent(sourceDir, stepId, nodeId);

  res.json({ ok: true, stepId, nodeId, restoredContent: original });
});

// ── 检查到修复：按勾选的 finding 定点修 ──

/** 检查报告里那条 id 对应的问题；找不到就是前端拿的是过期报告。 */
function pickFindings(report: unknown, findingIds: readonly string[]): QaFinding[] {
  const findings = (report as { findings?: unknown })?.findings;
  if (!Array.isArray(findings)) return [];
  const wanted = new Set(findingIds);
  return (findings as QaFinding[]).filter((f) => wanted.has(f.id));
}

/**
 * 修完之后刷新报告（M3：标记不删除，见 qa/findings.ts 顶部关于 status 的注释）。
 *
 * 结构检查是确定性的，直接按修完的 ctx 重算一份——这是真实的修复后状态，比
 * 手工摘掉几条诚实得多（修一处断边可能连带解决或暴露另一处）；重算之后用
 * `mergeFindingStatuses` 把这次 apply 打的 fixed 标记连同旧报告里此前已经
 * fixed/dismissed 的一并带过去，同 id 不会在复检里"复活"成待处理。
 * 内容检查要再烧一次 LLM 才能重算，所以只把这次成功修复的条目标 fixed，
 * 其余原样保留，由用户决定要不要再跑一遍完整复检。
 */
function refreshCheckReport(
  stepId: string,
  ctx: NarrativeContext,
  appliedIds: readonly string[],
  fixedVersionByFindingId: ReadonlyMap<string, number>,
  failedDetailByFindingId: ReadonlyMap<string, string>,
): void {
  const raw = ctx as Record<string, unknown>;
  const done = new Set(appliedIds);
  const markFixed = (f: QaFinding): QaFinding => {
    if (done.has(f.id)) return { ...f, status: "fixed", fixedInVersion: fixedVersionByFindingId.get(f.id) };
    const lastError = failedDetailByFindingId.get(f.id);
    // 失败保持 open——只是多一句"为什么没成功"，不能因为尝试过就冒充已处理。
    return lastError ? { ...f, status: "open", lastError } : f;
  };

  if (stepId === "structure_check") {
    const prior = (raw.structure_check_report as { findings?: QaFinding[] } | undefined)?.findings ?? [];
    const rebuilt = buildStructureCheckReport(ctx);
    // 顺序：先继承旧状态（含更早几轮的 fixed/dismissed），再把这一次新修的打上 fixed——
    // 这次成功修的一定要覆盖"继承来的旧状态"，不能被旧的 open 状态盖回去。
    rebuilt.findings = mergeFindingStatuses(prior, rebuilt.findings).map(markFixed);
    raw.structure_check_report = rebuilt;
    return;
  }
  const report = raw.content_check_report as
    | { findings?: QaFinding[]; verdict?: string; summary?: string }
    | undefined;
  if (!report?.findings) return;
  const findings = report.findings.map(markFixed);
  const pending = findings.filter((f) => (f.status ?? "open") === "open");
  const errors = pending.filter((f) => f.severity === "error").length;
  raw.content_check_report = {
    ...report,
    findings,
    verdict: errors > 0 ? "fail" : pending.length > 0 ? "warn" : "pass",
    summary: `已修 ${done.size} 项；剩余硬问题 ${errors} 项、待关注 ${pending.length - errors} 项（复检请重跑内容检查席）`,
  };
}

/**
 * 按勾选的问题条目执行修复（契约 §检查到修复）。
 *
 * 回写一律原地留版本：先给要改的那一步存一张版本快照，再改 ctx、重写产物文件。
 * 不新开任务条目——修复是"这一份的下一版"，不是另一件作品。
 */
app.post("/api/narrative/qa/apply", async (req, res) => {
  const { sourceDir, stepId, findingIds, model } = req.body as {
    sourceDir?: string;
    stepId?: string;
    findingIds?: string[];
    model?: string;
  };

  if (!sourceDir?.trim() || !stepId?.trim() || !Array.isArray(findingIds) || findingIds.length === 0) {
    res.status(400).json({ error: "sourceDir、stepId 与非空 findingIds 都是必填" });
    return;
  }
  if (!isSafeSourceDir(sourceDir)) {
    res.status(400).json({ error: `非法 sourceDir: ${sourceDir}` });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const report = resolveStepOutput(stepId, checkpoint.ctx);
  if (report == null) {
    res.status(404).json({ error: `${stepId} 还没有报告可修` });
    return;
  }

  const picked = pickFindings(report, findingIds);
  if (picked.length === 0) {
    res.status(404).json({ error: "findingIds 在当前报告里一个都找不到——报告可能已过期，请先刷新" });
    return;
  }

  const outcomes: RepairOutcome[] = [];
  const applied: string[] = [];
  // 每层/每步只在第一次改动前存一张快照：一次修多条不该留出一串中间版本。
  const snapshotted = new Set<string>();
  const touchedSteps = new Set<string>();

  // M2 版本溯源：先按 ownerStep 归总这次会落到它身上的 findingIds/修法，snapshotOnce
  // 真正落盘那一刻（第一次调用）才知道完整归总——拓扑与内容两个循环都可能命中同一步。
  const findingsByStep = new Map<string, { ids: string[]; kinds: Set<"topology" | "content"> }>();
  const ownerStepOfFinding = new Map<string, string>();
  for (const f of picked) {
    if (!f.repairKind || !f.targetField || !FIELD_OWNER_STEP[f.targetField]) continue;
    const ownerStep = FIELD_OWNER_STEP[f.targetField];
    ownerStepOfFinding.set(f.id, ownerStep);
    const entry = findingsByStep.get(ownerStep) ?? { ids: [], kinds: new Set<"topology" | "content">() };
    entry.ids.push(f.id);
    entry.kinds.add(f.repairKind);
    findingsByStep.set(ownerStep, entry);
  }
  // M3：qa/apply 修复成功的 finding 要标 fixedInVersion——记每个 ownerStep 这次落到的版本号。
  const versionByStep = new Map<string, number>();

  const snapshotOnce = (ownerStep: string): void => {
    if (snapshotted.has(ownerStep)) return;
    snapshotted.add(ownerStep);
    const info = findingsByStep.get(ownerStep);
    const kinds = info ? [...info.kinds] : [];
    const repairKind: "topology" | "content" | "mixed" =
      kinds.length === 2 ? "mixed" : kinds[0] ?? "topology";
    const version = snapshotStepArtifactVersion(
      sourceDir,
      ownerStep,
      snapshot(getStepDataForFile(ownerStep, checkpoint.ctx)),
      { kind: "qa_repair", findingIds: info?.ids ?? [], repairKind },
    );
    // snapshotStepArtifactVersion 返回的是刚归档的"改前那份"的编号 n；改完之后
    // 写回去的"当前"内容逻辑版本号是 n+1（下次再被取代时才会真正落成 `_${n+1}` 文件，
    // 但号码从这一刻起就定了——finding 的 fixedInVersion 记的是这个）。
    if (version != null) versionByStep.set(ownerStep, version + 1);
  };

  // 先把修不了的挑出来说清楚。用户勾了却什么都没发生是最难自查的一种失败。
  for (const f of picked) {
    if (!findingGuards({ status: f.status, repairKind: f.repairKind }).canApplyFix) {
      outcomes.push({ findingId: f.id, status: "skipped", detail: "这条问题只报不修，需要回到对应席位调整" });
    } else if (!f.targetField || !FIELD_OWNER_STEP[f.targetField]) {
      outcomes.push({ findingId: f.id, status: "skipped", detail: `不认识的修复目标：${f.targetField ?? "(未给)"}` });
    }
  }

  // ── 拓扑：按层各修一次。同一层上勾了几条，连接修复也只需跑一遍。
  const topologyFields = new Set(
    picked
      .filter((f) => f.repairKind === "topology" && f.targetField && FIELD_OWNER_STEP[f.targetField])
      .map((f) => f.targetField!),
  );
  for (const field of topologyFields) {
    const ownerStep = FIELD_OWNER_STEP[field];
    const fieldFindings = picked.filter((f) => f.repairKind === "topology" && f.targetField === field);
    snapshotOnce(ownerStep);
    const result = repairFieldTopology(checkpoint.ctx, field);
    if (!result) {
      for (const f of fieldFindings) {
        outcomes.push({ findingId: f.id, status: "failed", detail: `${field} 里读不到节点数组` });
      }
      continue;
    }
    touchedSteps.add(ownerStep);
    const detail = result.changed
      ? `连接修复：硬错误 ${result.before} → ${result.after}`
      : "连接修复跑过了，但图没有可改之处——这条要回到结构席处理";
    for (const f of fieldFindings) {
      outcomes.push({ findingId: f.id, status: result.changed ? "applied" : "failed", detail });
      if (result.changed) applied.push(f.id);
    }
  }

  // ── 内容：按节点各改一次。同一节点上的几处问题一起交给模型，分开改会互相覆盖。
  const contentFindings = picked.filter(
    (f) => f.repairKind === "content" && f.targetField && FIELD_OWNER_STEP[f.targetField],
  );
  if (contentFindings.length > 0) {
    // 到真要发请求那一刻才建客户端：勾了几条却一个节点都没命中时，不该因为
    // 环境里没配 key 就把整个请求变成 500。
    let llm: LLMClient | undefined;
    const getLlm = (): LLMClient =>
      (llm ??= new LLMClient({
        apiKey: API_KEY || undefined,
        proxyUrl: LLM_PROXY_URL || undefined,
        proxyApiKey: LLM_PROXY_KEY || undefined,
        defaultModel: model ?? checkpoint.model ?? getDefaultModel(),
      }));

    for (const [nodeId, group] of groupByNode(contentFindings)) {
      const field = group[0].targetField!;
      const ownerStep = FIELD_OWNER_STEP[field];
      const node = findNode(checkpoint.ctx, field, nodeId);
      if (!node) {
        for (const f of group) {
          outcomes.push({ findingId: f.id, status: "failed", detail: `${field} 里找不到节点 ${nodeId}` });
        }
        continue;
      }
      snapshotOnce(ownerStep);
      try {
        const { content, changes } = await rewriteNodeContent(getLlm(), node, group);
        applyRewrittenContent(checkpoint.ctx, field, nodeId, content, changes);
        touchedSteps.add(ownerStep);
        const detail = changes.length > 0 ? changes.join("；") : "已定点重写";
        for (const f of group) {
          outcomes.push({ findingId: f.id, status: "applied", detail });
          applied.push(f.id);
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        for (const f of group) outcomes.push({ findingId: f.id, status: "failed", detail });
      }
    }
  }

  const failedDetailByFindingId = new Map<string, string>();
  for (const o of outcomes) {
    if (o.status === "failed") failedDetailByFindingId.set(o.findingId, o.detail);
  }
  if (applied.length > 0 || failedDetailByFindingId.size > 0) {
    const fixedVersionByFindingId = new Map<string, number>();
    for (const id of applied) {
      const ownerStep = ownerStepOfFinding.get(id);
      const version = ownerStep ? versionByStep.get(ownerStep) : undefined;
      if (version != null) fixedVersionByFindingId.set(id, version);
    }
    refreshCheckReport(stepId, checkpoint.ctx, applied, fixedVersionByFindingId, failedDetailByFindingId);
    touchedSteps.add(stepId);
  }

  persistCheckpointCtx(sourceDir, checkpoint);
  for (const step of touchedSteps) rewriteStepArtifacts(sourceDir, step, checkpoint.ctx);

  res.json({
    ok: true,
    stepId,
    applied: applied.length,
    outcomes,
    report: resolveStepOutput(stepId, checkpoint.ctx),
  });
});

/**
 * 忽略：把勾选的 finding 标 `dismissed`，不碰任何内容/产物文件（键权层方案 M3）。
 *
 * 与 `/qa/apply` 的分工：那边是"系统帮我改"，这里是"我看过了，不用管"——两者都是
 * 终态处置，唯一区别是要不要动 ctx 数据。不新建版本快照：内容压根没变，钉一张
 * 一模一样的快照只会制造噪音。
 */
app.post("/api/narrative/qa/dismiss", (req, res) => {
  const { sourceDir, stepId, findingIds } = req.body as {
    sourceDir?: string;
    stepId?: string;
    findingIds?: string[];
  };

  if (!sourceDir?.trim() || !stepId?.trim() || !Array.isArray(findingIds) || findingIds.length === 0) {
    res.status(400).json({ error: "sourceDir、stepId 与非空 findingIds 都是必填" });
    return;
  }
  if (!isSafeSourceDir(sourceDir)) {
    res.status(400).json({ error: `非法 sourceDir: ${sourceDir}` });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const raw = checkpoint.ctx as Record<string, unknown>;
  const reportKey = stepId === "structure_check" ? "structure_check_report" : "content_check_report";
  const report = raw[reportKey] as { findings?: QaFinding[] } | undefined;
  if (!report?.findings) {
    res.status(404).json({ error: `${stepId} 还没有报告可忽略` });
    return;
  }

  const wanted = new Set(findingIds);
  let dismissed = 0;
  report.findings = report.findings.map((f) => {
    if (!wanted.has(f.id)) return f;
    if (!findingGuards({ status: f.status, repairKind: f.repairKind }).canDismiss) return f;
    dismissed++;
    return { ...f, status: "dismissed" };
  });

  persistCheckpointCtx(sourceDir, checkpoint);
  rewriteStepArtifacts(sourceDir, stepId, checkpoint.ctx);

  res.json({ ok: true, stepId, dismissed, report: resolveStepOutput(stepId, checkpoint.ctx) });
});

// ── Analyze impact: diff + LLM analysis → affected steps ──

function generateTextDiff(original: unknown, modified: unknown): string {
  const origStr = typeof original === "string" ? original : JSON.stringify(original, null, 2);
  const modStr = typeof modified === "string" ? modified : JSON.stringify(modified, null, 2);
  if (origStr === modStr) return "(no changes)";

  const origLines = origStr.split("\n");
  const modLines = modStr.split("\n");
  const diff: string[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    const ol = origLines[i];
    const ml = modLines[i];
    if (ol === ml) continue;
    if (ol != null && ml == null) diff.push(`- ${ol}`);
    else if (ol == null && ml != null) diff.push(`+ ${ml}`);
    else if (ol !== ml) { diff.push(`- ${ol}`); diff.push(`+ ${ml}`); }
  }
  return diff.slice(0, 200).join("\n") + (diff.length > 200 ? "\n...(truncated)" : "");
}

/**
 * 动态步序解析（M-E：修影响面分析 / DAG 描述与真实执行的步序漂移）。
 *
 * `getModeConfig(mode).steps` 只是静态骨架，动态品类还要补齐运行时才展开的步骤。
 * 此前这里唯一的展开手段是已标 `@deprecated` 的 `buildAutoSteps`——它与真正跑起来
 * 时用的 `resolveSeatStepGroups`（席位管线，与 `previewAnnounce` 的品类分支同一份
 * 事实源）不是同一份步序来源，会导致"影响面分析说会重跑 A、B"而实际重跑的是 A、C。
 *
 * 修法：`demand_analysis.genre_code` 能解出品类时优先走 `resolveSeatStepGroups`
 * （与真实执行同源）；解不出（旧数据 / 非品类路由）才退回调用方传入的 legacy
 * `buildAutoSteps` 兜底——不砍掉兜底本身，断供比给错步序更糟。
 */
function resolveDynamicAutoSteps(ctx: NarrativeContext | undefined, legacyFallback: () => string[]): string[] {
  const genreCode = ctx?.demand_analysis?.genre_code;
  if (genreCode) {
    try {
      const entry = findGenreByCode(genreCode);
      if (entry) return resolveSeatStepGroups(entry.code, entry.tier).stepGroups;
    } catch (e) {
      console.warn("[dynamic-steps] seat step resolution failed, falling back to legacy:", (e as Error).message);
    }
  }
  return legacyFallback();
}

function buildStepDAGDescription(mode: ModeId, ctx?: NarrativeContext): string {
  try {
    const config = getModeConfig(mode);
    const entries = [...config.steps];
    if (config.isDynamic && ctx) {
      const autoOpts = { genreCode: ctx.demand_analysis?.genre_code };
      const legacyFallback = (): string[] => {
        if (ctx.narrative_requirements) return buildAutoSteps(ctx.narrative_requirements, autoOpts);
        if (ctx.demand_analysis) {
          const syntheticReq = {
            needs: (ctx.demand_analysis as unknown as Record<string, unknown>).narrative_needs,
          } as import("../types/game-design.js").NarrativeRequirements;
          return buildAutoSteps(syntheticReq, autoOpts);
        }
        return [];
      };
      if (ctx.narrative_requirements || ctx.demand_analysis) {
        const autoSteps = resolveDynamicAutoSteps(ctx, legacyFallback);
        const existing = new Set(entries.flatMap(e => Array.isArray(e) ? e : [e]));
        for (const s of autoSteps) {
          if (!existing.has(s)) entries.push(s);
        }
      }
    }
    const lines: string[] = [];
    let order = 1;
    for (const entry of entries) {
      if (Array.isArray(entry)) {
        lines.push(`${order}. [并行] ${entry.join(", ")}`);
      } else {
        lines.push(`${order}. ${entry}`);
      }
      order++;
    }
    return lines.join("\n");
  } catch {
    return "(mode config not available)";
  }
}

app.post("/api/narrative/analyze-impact", async (req, res) => {
  const { sourceDir, modifications } = req.body as {
    sourceDir?: string;
    modifications?: Array<{
      stepId: string;
      nodeId?: string;
      editedContent?: unknown;
      userInput?: string;
    }>;
  };

  if (!sourceDir?.trim()) {
    res.status(400).json({ error: "sourceDir is required" });
    return;
  }
  if (!modifications?.length) {
    res.status(400).json({ error: "modifications array is required" });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const mode = checkpoint.mode ?? "full";
  const dagDescription = buildStepDAGDescription(mode, checkpoint.ctx);

  // ── Build diff sections ──
  const diffSections: string[] = [];
  const stepMetaMap = checkpoint.step_meta ?? {};

  for (const mod of modifications) {
    const metaKey = mod.nodeId ? `${mod.stepId}::${mod.nodeId}` : mod.stepId;
    const matchingKeys = mod.nodeId
      ? [metaKey]
      : Object.keys(stepMetaMap).filter(k => k === mod.stepId || k.startsWith(`${mod.stepId}::`));

    if (matchingKeys.length === 0) matchingKeys.push(metaKey);

    for (const mk of matchingKeys) {
      const meta = stepMetaMap[mk];
      const latest = meta?.modifications?.[meta.modifications.length - 1];

      const nodeIdFromKey = mk.includes("::") ? mk.split("::")[1] : mod.nodeId;
      const original = latest?.original
        ?? loadOriginalContent(sourceDir, mod.stepId, nodeIdFromKey)
        ?? resolveStepContent(checkpoint.ctx, mod.stepId, nodeIdFromKey);
      const modified = latest?.edited
        ?? mod.editedContent
        ?? resolveStepContent(checkpoint.ctx, mod.stepId, nodeIdFromKey);

      const diff = generateTextDiff(original, modified);
      const header = nodeIdFromKey
        ? `步骤: ${mod.stepId}, 节点: ${nodeIdFromKey}`
        : `步骤: ${mod.stepId}`;
      const userFeedback = (latest?.userInstructions || mod.userInput)
        ? `\n用户反馈: ${latest?.userInstructions ?? mod.userInput}`
        : "";
      diffSections.push(`### ${header}${userFeedback}\n\`\`\`diff\n${diff}\n\`\`\``);
    }
  }

  // ── Resolve pipeline steps ──
  const allSteps: string[] = [];
  try {
    const config = getModeConfig(mode);
    for (const entry of config.steps) {
      if (Array.isArray(entry)) allSteps.push(...entry);
      else allSteps.push(entry);
    }
    if (config.isDynamic && checkpoint.ctx) {
      const autoOpts = { genreCode: checkpoint.ctx.demand_analysis?.genre_code };
      const legacyFallback = (): string[] => {
        if (checkpoint.ctx!.narrative_requirements) return buildAutoSteps(checkpoint.ctx!.narrative_requirements, autoOpts);
        if (checkpoint.ctx!.demand_analysis) {
          const syntheticReq = {
            needs: (checkpoint.ctx!.demand_analysis as unknown as Record<string, unknown>).narrative_needs,
          } as import("../types/game-design.js").NarrativeRequirements;
          return buildAutoSteps(syntheticReq, autoOpts);
        }
        return [];
      };
      if (checkpoint.ctx.narrative_requirements || checkpoint.ctx.demand_analysis) {
        // M-E：与真实执行同源——genre_code 能解出品类时走 resolveSeatStepGroups，
        // 不能才退回 legacy buildAutoSteps（见 resolveDynamicAutoSteps 顶部注释）。
        const autoSteps = resolveDynamicAutoSteps(checkpoint.ctx, legacyFallback);
        const existing = new Set(allSteps);
        for (const s of autoSteps) {
          if (!existing.has(s)) allSteps.push(s);
        }
      }
    }
  } catch { /* fallback below */ }

  const modifiedStepIds = [...new Set(modifications.map(m => m.stepId))];
  const completedSteps = checkpoint.completedSteps ?? [];
  const downstreamSteps = allSteps.filter(s => {
    const sIdx = allSteps.indexOf(s);
    return modifiedStepIds.some(ms => allSteps.indexOf(ms) <= sIdx);
  });

  // ── Static node-level subtree impacts ──
  const modifiedNodeIds = modifications
    .filter(m => m.nodeId)
    .map(m => ({ stepId: m.stepId, nodeId: m.nodeId! }));
  const staticNodeImpacts: Array<{ stepId: string; nodeIds: string[] }> = [];
  if (modifiedNodeIds.length > 0) {
    const byStep = new Map<string, string[]>();
    for (const m of modifiedNodeIds) {
      const arr = byStep.get(m.stepId) ?? [];
      arr.push(m.nodeId);
      byStep.set(m.stepId, arr);
    }
    for (const [stepId, nodeIds] of byStep) {
      const impacts = traceNodeSubtree(stepId, nodeIds, checkpoint.ctx);
      for (const imp of impacts) {
        if (imp.affectedNodeIds.length > 0) {
          staticNodeImpacts.push({ stepId: imp.stepId, nodeIds: imp.affectedNodeIds });
        }
      }
    }
  }

  // ── Pre-classify changes (heuristic, per-modification diff) ──
  const changeClassifications = modifications.map((m, idx) => ({
    stepId: m.stepId,
    nodeId: m.nodeId,
    classification: preClassifyChange(m.stepId, m.userInput, diffSections[idx] ?? ""),
  }));
  // Aggregate: structural wins over content over cosmetic
  const categoryPriority = { structural: 2, content: 1, cosmetic: 0 } as const;
  const dominantCategory = changeClassifications.reduce(
    (best, c) => categoryPriority[c.classification.category] > categoryPriority[best] ? c.classification.category : best,
    "cosmetic" as keyof typeof categoryPriority,
  );
  const dominantClassification = changeClassifications.find(c => c.classification.category === dominantCategory)
    ?? changeClassifications[0];

  // ── Build knowledge-enriched prompt (only steps relevant to this analysis) ──
  // Include: modified steps + first 5 downstream + their declared inputs (upstream context)
  const relevantKbSteps = [...new Set([
    ...modifiedStepIds,
    ...downstreamSteps.slice(0, 5),
    ...modifiedStepIds.flatMap(id => PIPELINE_KNOWLEDGE[id]?.inputs ?? []),
  ])];
  const knowledgeSection = buildKnowledgePromptSection(relevantKbSteps, false);
  const nodeTreeSection = buildNodeTreeSummary(checkpoint.ctx);

  const systemPrompt = `你是叙事内容管线的【影响面分析 Agent】。你的任务是精确判断用户修改的影响范围，并制定最优重跑计划。

# 你的专业知识

${knowledgeSection}

# 当前管线状态

管线步骤序列（模式: ${mode}）:
${dagDescription}

已完成步骤: ${completedSteps.join(", ")}
被修改步骤: ${modifiedStepIds.join(", ")}

${nodeTreeSection}

# 变更预分类

系统预判断此变更为【${dominantCategory === "structural" ? "结构性变更" : dominantCategory === "cosmetic" ? "格式性变更" : "内容性变更"}】（置信度: ${dominantClassification?.classification.confidence.toFixed(2) ?? "N/A"}）
信号: ${dominantClassification?.classification.signals.join("; ") ?? "无"}

请验证或纠正此预判断。

# 分析规则

1. **被修改步骤本身需要重跑** — 用户可能只编辑了部分内容或提供了新需求指令
2. **验证步骤跟随父步骤** — structure_validation_* 总是跟随其父步骤重跑
3. **格式性变更可跳过下游** — 仅措辞/格式微调且无额外需求 → 下游不受影响
4. **内容性变更影响直接下游** — 修改了具体信息 → 依赖该信息的直接下游步骤重跑
5. **结构性变更需要上游回溯** — 改变了"故事讲什么"→ 必须从最早受影响的上游开始重构
6. **节点级精确性** — 如果修改的是某个具体节点，分析其子树（通过 parent_id 追踪）是否足够，还是影响同层其他节点
7. **跨步骤引用追踪** — 如果修改涉及角色名/道具名/场景名，追踪所有引用该名称的下游步骤
8. **并行步骤独立** — 并行步骤之间互不影响，除非有显式数据依赖（参考依赖图）
9. **判断实质影响** — 区分"改了标签/名称"（不影响内容逻辑）和"改了实质内容"（影响下游生成质量）

# 回溯判断标准

- 改变"讲什么"（结局/主线/角色命运/新增主要情节/删除核心元素）→ 回溯到 story_framework 或更早
- 改变"怎么讲"（措辞/细节/对话风格/格式）→ 只影响当前步骤及直接下游
- 改变"全局设定"（世界观规则/时代/核心循环）→ 回溯到 worldview/core_settings

# 输出格式

请返回 JSON:
{
  "changeCategory": "structural" | "content" | "cosmetic",
  "affectedSteps": ["需要重新生成的步骤ID列表（可含上游步骤）"],
  "canSkip": ["确定可以跳过的步骤ID列表"],
  "nodeLevel": true/false,
  "nodeImpacts": [{"stepId": "xxx", "nodeIds": ["affected_node_ids"]}] | null,
  "rerunFrom": "建议从哪个步骤开始重跑",
  "reasoning": "详细解释分析逻辑：变更类型判断→传播路径→最终决策",
  "confidence": 0.0-1.0
}`;

  const userPrompt = `# 用户修改内容

${diffSections.join("\n\n")}

# 静态子树追踪结果（基于 parent_id）

${staticNodeImpacts.length > 0
    ? staticNodeImpacts.map(imp => `${imp.stepId}: 受影响节点 [${imp.nodeIds.join(", ")}]`).join("\n")
    : "无节点级修改或无节点追踪结果"
  }

# 可能受影响的下游步骤（基于 DAG 顺序）

${downstreamSteps.join(", ")}

请基于你的管线知识，分析实际影响面。注意：静态追踪只考虑了 parent_id 结构关系，你需要额外考虑内容引用关系（如角色名出现在多个步骤中）。`;

  try {
    const llm = new LLMClient({
      apiKey: API_KEY || undefined,
      proxyUrl: LLM_PROXY_URL || undefined,
      proxyApiKey: LLM_PROXY_KEY || undefined,
      defaultModel: getDefaultModel(),
    });

    console.warn("[analyze-impact] changeCategory:", dominantCategory, "confidence:", dominantClassification?.classification.confidence);
    console.warn("[analyze-impact] modifications:", JSON.stringify(modifications.map(m => ({ stepId: m.stepId, nodeId: m.nodeId, userInput: m.userInput?.slice(0, 80) }))));

    const raw = await llm.call(systemPrompt, userPrompt, {
      temperature: 0.1,
      responseFormat: "json",
    });

    console.warn("[analyze-impact] LLM raw response:", raw.slice(0, 600));

    let analysis: {
      changeCategory?: string;
      affectedSteps: string[];
      canSkip: string[];
      reasoning: string;
      nodeLevel?: boolean;
      nodeImpacts?: Array<{ stepId: string; nodeIds: string[] }> | null;
      rerunFrom?: string;
      confidence?: number;
    };
    try {
      analysis = JSON.parse(raw);
    } catch {
      analysis = {
        affectedSteps: downstreamSteps,
        canSkip: [],
        reasoning: "LLM 返回格式解析失败，降级为全量下游重跑",
      };
    }

    console.warn("[analyze-impact] result:", {
      category: analysis.changeCategory,
      affected: analysis.affectedSteps,
      rerunFrom: analysis.rerunFrom,
      reasoning: analysis.reasoning?.slice(0, 200),
    });

    // Gap D：结构化校验 — 限制 LLM 上游回溯不超过合理边界
    // 1) cosmetic 不允许回溯；2) content 允许回溯 1 层；3) structural 允许回溯到叙事根
    // 4) modifications 必须在 affectedSteps 中；5) canSkip 不能与 mod / affected 冲突
    // 注：若 LLM 没给 nodeImpacts，回退到 staticNodeImpacts；validateImpactAnalysis 内部
    //     会再过滤一次，确保 nodeImpacts.stepId 都落在 safeAffected 里。
    const mergedNodeImpactsRaw = analysis.nodeImpacts ?? (staticNodeImpacts.length > 0 ? staticNodeImpacts : null);
    const validated = validateImpactAnalysis(
      { ...analysis, nodeImpacts: mergedNodeImpactsRaw },
      modifiedStepIds,
      dominantCategory as ChangeCategory,
      allSteps,
      analysis.changeCategory,
    );
    if (validated.warnings.length > 0) {
      console.warn("[analyze-impact] validation warnings:");
      for (const w of validated.warnings) console.warn("  -", w);
    }
    const useNodeLevel = analysis.nodeLevel !== false && validated.nodeImpacts != null;

    res.json({
      affectedSteps: validated.affectedSteps,
      canSkip: validated.canSkip,
      reasoning: analysis.reasoning,
      changeCategory: analysis.changeCategory ?? dominantCategory,
      rerunFrom: analysis.rerunFrom ?? (validated.affectedSteps.length > 0 ? validated.affectedSteps[0] : undefined),
      confidence: analysis.confidence,
      mode,
      pipelineOrder: allSteps,
      modifications: modifications.map(m => ({ stepId: m.stepId, nodeId: m.nodeId })),
      nodeImpacts: useNodeLevel ? validated.nodeImpacts : null,
      // 透出校验诊断信息，便于前端 / 调试时看到 LLM 越界
      validationWarnings: validated.warnings,
      earliestAllowedStep: validated.earliestAllowedStep,
    });
  } catch (err) {
    console.error("[analyze-impact] LLM analysis failed, falling back to DAG:", err);
    res.json({
      affectedSteps: downstreamSteps,
      canSkip: [],
      reasoning: `LLM分析失败(${(err as Error).message})，降级为静态DAG下游全量重跑`,
      changeCategory: dominantCategory,
      rerunFrom: downstreamSteps[0],
      mode,
      pipelineOrder: allSteps,
      fallback: true,
      nodeImpacts: staticNodeImpacts.length > 0 ? staticNodeImpacts : null,
    });
  }
});

// ── Story tree: dynamic node structure query ──

interface StoryTreeNode {
  id: string;
  name: string;
  parentId?: string;
  stepId: string;
  layer: number;
}

interface StoryTreeLayer {
  stepId: string;
  layer: number;
  nodes: StoryTreeNode[];
}

app.get("/api/narrative/story-tree/:dir", (req, res) => {
  const dir = req.params.dir;
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required" });
    return;
  }

  const checkpoint = loadCheckpoint(dir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${dir}` });
    return;
  }

  const ctx = checkpoint.ctx;
  const layers: StoryTreeLayer[] = [];

  // L0: story_framework
  const fwNodes = ctx.story_framework?.framework?.nodes ?? [];
  if (fwNodes.length > 0) {
    layers.push({
      stepId: "story_framework",
      layer: 0,
      nodes: fwNodes.map(n => ({
        id: n.node_id,
        name: n.name ?? n.node_id,
        stepId: "story_framework",
        layer: 0,
      })),
    });
  }

  // L1: outline_batch
  const outlines = ctx.outlines_generated?.outlines ?? [];
  if (outlines.length > 0) {
    layers.push({
      stepId: "outline_batch",
      layer: 1,
      nodes: outlines.map(n => ({
        id: n.node_id,
        name: n.name ?? n.node_id,
        parentId: n.parent_id,
        stepId: "outline_batch",
        layer: 1,
      })),
    });
  }

  // L2: detailed_outline
  const detailed = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  if (detailed.length > 0) {
    layers.push({
      stepId: "detailed_outline",
      layer: 2,
      nodes: detailed.map((n) => ({
        id: n.node_id,
        name: (n as unknown as Record<string, unknown>).name as string ?? n.node_id,
        parentId: n.parent_id,
        stepId: "detailed_outline",
        layer: 2,
      })),
    });
  }

  // L3: plot_generation
  const plots = ctx.plots_generated?.plots ?? [];
  if (plots.length > 0) {
    layers.push({
      stepId: "plot_generation",
      layer: 3,
      nodes: plots.map(n => ({
        id: n.node_id,
        name: n.node_id,
        parentId: n.parent_id,
        stepId: "plot_generation",
        layer: 3,
      })),
    });
  }

  // L4: script_generation
  const chapters = ctx.jrpg_script?.chapters ?? [];
  if (chapters.length > 0) {
    layers.push({
      stepId: "script_generation",
      layer: 4,
      nodes: chapters.map(c => ({
        id: c.plot_node_id ?? c.node_id,
        name: c.chapter_id ?? c.node_id,
        parentId: c.plot_node_id ?? c.node_id,
        stepId: "script_generation",
        layer: 4,
      })),
    });
  }

  // L5: quest_generation
  const quests = ctx.quest_graph?.quests ?? [];
  if (quests.length > 0) {
    layers.push({
      stepId: "quest_generation",
      layer: 5,
      nodes: quests.map(q => ({
        id: q.quest_id,
        name: q.quest_id,
        parentId: q.story_node_id,
        stepId: "quest_generation",
        layer: 5,
      })),
    });
  }

  // L6: scene_plan
  const sceneMap = ctx.scene_map as Record<string, unknown> | undefined;
  const p2 = sceneMap?._phase2_per_node as Record<string, unknown> | undefined;
  if (p2) {
    layers.push({
      stepId: "scene_plan",
      layer: 6,
      nodes: Object.keys(p2).map(k => ({
        id: k,
        name: k,
        stepId: "scene_plan",
        layer: 6,
      })),
    });
  }

  res.json({
    dir,
    completedSteps: checkpoint.completedSteps ?? [],
    layers,
  });
});

function loadReviewState(dir: string): ReviewState {
  const reviewPath = path.join(outputDir(), dir, "_review.json");
  if (fs.existsSync(reviewPath)) {
    try {
      return JSON.parse(fs.readFileSync(reviewPath, "utf-8"));
    } catch { /* corrupt file */ }
  }
  return { entries: [], updatedAt: new Date().toISOString() };
}

function saveReviewState(dir: string, state: ReviewState): void {
  const dirPath = path.join(outputDir(), dir);
  fs.mkdirSync(dirPath, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeAssetFile(dirPath, "_review.json", state);
}

app.get("/api/narrative/review/:dir", (req, res) => {
  const dir = req.params.dir;
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required" });
    return;
  }
  const review = loadReviewState(dir);
  res.json(review);
});

app.post("/api/narrative/review/:dir", (req, res) => {
  const dir = req.params.dir;
  const { stepId, status: reviewStatus, feedback, regenerateRunId } = req.body as {
    stepId?: string;
    status?: "pending" | "approved" | "rejected";
    feedback?: string;
    regenerateRunId?: string;
  };

  if (!dir?.trim() || !stepId?.trim() || !reviewStatus) {
    res.status(400).json({ error: "dir, stepId, and status are required" });
    return;
  }

  const review = loadReviewState(dir);
  const existing = review.entries.findIndex((e) => e.stepId === stepId);
  const entry: ReviewEntry = {
    stepId,
    status: reviewStatus,
    feedback: feedback?.trim() || undefined,
    reviewedAt: new Date().toISOString(),
    regenerateRunId,
  };

  if (existing >= 0) {
    review.entries[existing] = entry;
  } else {
    review.entries.push(entry);
  }

  saveReviewState(dir, review);
  res.json({ ok: true, entry, review });
});

app.post("/api/narrative/cancel/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (state.status !== "running") {
    res.json({ id: state.id, status: state.status, message: "Not running" });
    return;
  }
  // 断点不在这里写：每完成一步就已经落过一次 `_checkpoint.json`，取消只是不再往下跑。
  // 所以"能不能续跑"取决于跑到过第几步，而不是取消这个动作本身。
  // 此前这里只手写 writeManifestIncremental，不调 finalizeRunManifest——
  // `_run_manifest.json` 里被取消那一步会永远停在 running，收不了尾（M4 一并修复）。
  applyRunTransition(state, { type: "cancelled" });
  try { saveRunToFile(state); } catch (e) { console.error("Failed to save cancelled run:", e); }
  res.json({ id: state.id, status: "cancelled", message: "Run cancelled" });
});

app.get("/api/narrative/status/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  // 键权层：跑挂了/被取消时，能否续跑取决于有没有落过断点，不是 status 本身能回答的；
  // 查一次同目录的 checkpoint（每步完成即已落盘，这里只读不写）。
  const canResumeThisRun = state.status === "failed" && !!loadCheckpoint(runDirRel(state));
  res.json({
    id: state.id,
    status: state.status,
    progress: state.progress,
    error: state.error,
    startedAt: state.startedAt,
    tier: state.tier,
    mode: state.mode,
    // Phase-2 M8: 多管线分流锚点 —— 前端据此把本流的进度归到对应 lane。
    entryKey: state.entryKey,
    pipelineId: state.manifest?.pipelineId ?? state.pipelineId,
    sourceDir: state.outputDir
      ? path.relative(outputDir(), state.outputDir).split(path.sep).join("/")
      : undefined,
    // 键权层：chat 侧无画布也能拿到与画布同源的两键亮灭判断（键权层调研 R1）。
    controls: historyControls(state.status, canResumeThisRun, false),
  });
});

app.get("/api/narrative/result/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (state.status === "running") {
    res.json({ id: state.id, status: "running", message: "Still running" });
    return;
  }
  const entryKey = resolveStateEntryKey(state);
  res.json({
    id: state.id,
    status: state.status,
    result: state.result,
    error: state.error,
    // G1 派生项 #4：这里历史上把 entryKey 错标成 sourceDir——次管线上两者不等，
    // 名字对不上实际语义。真正的产物目录另给一个字段，字段名不再混用。
    entryKey,
    sourceDir: runDirRel(state),
  });
});

const IGNORED_DIRS = new Set(["assets", "node_modules"]);

interface HistoryItem {
  key: string;
  type: "dir" | "file";
  id: string | null;
  tier?: string;
  mode?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  fileCount?: number;
  hasCheckpoint: boolean;
  hasEdits: boolean;
  lastCompletedStep: string | null;
  completedSteps: string[] | null;
  canResume: boolean;
  canLoad: boolean;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  parentKey?: string;
  forkReason?: string;
  /**
   * 条目卡第二、三行要的料。
   *
   * 第二行报「需求输入 / 文件上传」，第三行报「叙事路由」。userInput + routeGroup + tier + mode
   * 只够说一半：上传型条目的正文是文件而非文字，而路由自三轴换轴后由品类与类型/题材/结构定调。
   * 这些字段本来都已落在 manifest 或 _entry.json 里，只是没投影出来，前端只能显示半张脸。
   */
  genreCode?: string;
  inputType?: string;
  uploadedFileNames?: string[];
  storyType?: string;
  storyTheme?: string;
  narrativeStructure?: string;
  /** 运行类型标记（"ip-dna" = IP DNA 摄入/改编运行；缺省为普通叙事/策划运行）。 */
  kind?: string;
  /**
   * IP 改编下游生成的「内存 SSE run」id（ipgen_<story_timestamp>_<rand>）。
   * generate 时新建的 ipgen run 不落 outputDir、也不进磁盘条目，重载/换会话后前端无从得知其 id
   * → 中间管线空。此处按目录时间戳前缀反查暴露，供前端 attach 后经 /stream 直播下游进度。
   */
  generationRunId?: string;
  /** Phase-1：_entry.json.pipelines 长度（多管线条目）。 */
  pipelineCount?: number;
  /**
   * 键权层：与画布 `runControls()` 同构的两键亮灭 + 衍生 guard，chat 与画布读同一份计算，
   * 不必再依赖画布广播的 postMessage 快照（键权层调研 R1）。
   */
  controls?: PipelineGuards;
  /**
   * `manifest.json` 的 cancelled 旗标透传（M-B 平台状态语言对齐）。此前只在内部
   * 拿它去把 `status` 折成 interrupted，没投影出来——界面分不出"用户主动取消"
   * 与"真的跑挂了"。不新增落盘字段，只是把已经在读的旗标暴露出来。
   */
  cancelled?: boolean;
  /**
   * IP DNA 半自动阶段门（§4.4①）：job 已经跑完标准化、停在"确认裁剪范围"这一步，
   * 等用户/agent 回填才能继续——这与"还在标准化/建树"是两种要看的东西，此前都被
   * `status="config"` 一起吞掉了。只对 IP DNA 条目有意义，普通叙事条目恒为 false。
   */
  awaitingConfirmation?: boolean;
  /**
   * 平台统一状态语言投影（未开始/可执行/执行中/等待确认/已完成/执行失败/已取消）。
   * 纯派生，不新增落盘状态——「可执行」「等待确认」在我们自己的模型里本就是
   * `status` + `cancelled` + `canResume` + `controls` + IP job 阶段门的派生量，
   * 这里只是把派生结果显式命名，对齐平台语言。计算见 `derivePlatformStatus`。
   */
  platformStatus?: PlatformRunState;
}

/**
 * 平台统一状态语言的七个值（M-B）。派生自既有字段，不是第二套事实源：
 * `docs/contracts.md` §2 的落盘态只有 config/running/completed/interrupted/failed，
 * 这里只做只读投影，任何一步都不写盘、不影响 `status`/`controls` 的既有计算。
 */
type PlatformRunState =
  | "not_started"
  | "executable"
  | "running"
  | "awaiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * `status`（+ cancelled / canResume / controls / IP 阶段门）→ 平台七态。
 *
 * 「可执行」不是新枚举：`config` 态下若 controls 已判定有主键动作可点（用户已经把
 * 输入/路由配完），就是"可执行"；`interrupted` 态下若 `canResume` 为真也算"可执行"
 * （断点续传）。「等待确认」只在 IP DNA 阶段门场景成立，由调用方显式传入，不从
 * `status` 反推——status="config" 同时覆盖"真的没配完"和"停在确认门"两种情况，
 * 反推会把二者混淆（正是 M-B 要修的那个信息损失）。
 */
function derivePlatformStatus(args: {
  status: string | undefined;
  cancelled?: boolean;
  canResume: boolean;
  controls?: PipelineGuards;
  awaitingConfirmation?: boolean;
}): PlatformRunState {
  const { status, cancelled, canResume, controls, awaitingConfirmation } = args;
  if (awaitingConfirmation) return "awaiting_confirmation";
  if (cancelled) return "cancelled";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "config") {
    return controls?.primary && controls.primary !== "none" ? "executable" : "not_started";
  }
  if (status === "interrupted") return canResume ? "executable" : "failed";
  return "not_started";
}

/** `effectiveStatus` 等历史列表用的松散字符串 → 键权层的四值枚举。 */
function toGuardEntryStatus(
  status: string | undefined,
): "running" | "completed" | "interrupted" | null {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "interrupted" || status === "failed") return "interrupted";
  return null;
}

/** `parseDirEntry` 三个分支共用：由已算出的 status/canResume/hasEdits 派生 controls。 */
function historyControls(status: string | undefined, canResume: boolean, hasEdits: boolean): PipelineGuards {
  return pipelineGuards({
    entryStatus: toGuardEntryStatus(status),
    canResume,
    generating: false,
    // 列表粒度没有"当前编辑会话"的草稿态；`_edits.json` 存在是最接近的落盘信号，
    // 用它顶替 —— 有已保存的编辑记录，主键该说"重新生成"而非"续跑"。
    hasDrafts: hasEdits,
    pendingFork: false,
  });
}

/** IP DNA 输入侧资产清单（媒体优先：主媒体 extraction_output；legacy 兜底），用于无 output 清单时回填历史。 */
function loadIpDnaInputManifest(key: string): { story_id?: string; title?: string; media_type?: string; processing_status?: string; created_at?: string } | undefined {
  try {
    return loadManifestByRun(key);
  } catch {
    return undefined;
  }
}

/** output 运行目录是否已落生成产物（game_unit_*.json）。 */
function outputHasGameUnits(dir: string): boolean {
  try {
    return fs.readdirSync(path.join(outputDir(), dir)).some((f) => /^game_unit_.*\.json$/.test(f));
  } catch {
    return false;
  }
}

/**
 * 读取 IP 多单元产物中最低序号单元的完整 NarrativeContext。
 *
 * IP 改编 run 不落 full_result.json / _checkpoint.json —— 整条下游产物打包在 game_unit_N.json.result
 * 里（N 从 1 起）。此前 /history/:key/load 找不到结果，回落到 _entry.json 分支返回 result:null + 仅 IP
 * 前驱步，故中间管线只见 5 个 IP 预处理步、缺失全部下游叙事步骤。此处取序号最小的单元作可展示 ctx。
 */
function loadGameUnitCtx(dir: string): NarrativeContext | null {
  try {
    const files = fs
      .readdirSync(path.join(outputDir(), dir))
      .filter((f) => /^game_unit_.*\.json$/.test(f))
      .sort();
    if (files.length === 0) return null;
    const raw = JSON.parse(fs.readFileSync(path.join(outputDir(), dir, files[0]), "utf-8"));
    const ctx = (raw?.result ?? raw) as NarrativeContext;
    return ctx && typeof ctx === "object" ? ctx : null;
  } catch {
    return null;
  }
}

/**
 * 下游叙事步骤的规范展示序（按管线实际执行顺序）。用于 IP 多单元产物加载时重建中间管线——
 * 这些 run 无 checkpoint / manifest.pipelineOrder 可依，只能按此规范序过滤出「产物字段确已落入 ctx」的步骤。
 */
const DOWNSTREAM_STEP_ORDER = [
  "preference_summary", "preference_analysis", "initial_plan",
  "core_concept", "system_architecture", "system_detail", "value_framework", "design_doc",
  "worldview", "character_enrichment", "item_database", "story_framework",
  "outline_batch", "detailed_outline", "plot_generation", "script_generation",
  "scene_plan", "quest_generation", "script_scene_generation",
  "vn_logline", "vn_script_normalize", "vn_segment_confirm", "vn_outline_acts",
  "vn_scenes", "vn_beats", "vn_branched_beats", "vn_state_ledger",
  "vn_screenplay", "vn_storyboard",
  "narrative_card", "lore_generation",
];

/** 从已落盘的 ctx 反推「哪些下游步骤实际产出」（其 STEP_OUTPUT_FIELDS 任一字段非空即视为已完成）。 */
function deriveCompletedStepsFromCtx(ctx: NarrativeContext): string[] {
  const rec = ctx as unknown as Record<string, unknown>;
  const present = (v: unknown): boolean =>
    v != null &&
    (Array.isArray(v) ? v.length > 0 : typeof v === "object" ? Object.keys(v as object).length > 0 : true);
  return DOWNSTREAM_STEP_ORDER.filter((sid) => {
    const fields = STEP_OUTPUT_FIELDS[sid];
    return !!fields && fields.some((f) => present(rec[f]));
  });
}

/**
 * 该 key 是否存在 IP DNA 输入侧资产（用于历史可见性兜底，§5.1）：
 * user_asset_manifest.json（摄入即写）或 _extraction_output/_hierarchy.json（标准化后写）。
 * 半自动 ingest 不写 output 运行清单，故仅凭输入侧资产也要能在 LIST 列出中断的运行。
 */
function loadIpInputDescriptor(
  key: string,
): { story_id?: string; title?: string; media_type?: string; created_at?: string; hasHierarchy: boolean } | undefined {
  const uam = loadIpDnaInputManifest(key);
  let hier: { story_id?: string; title?: string; media_type?: string } | undefined;
  try { hier = loadHierarchyIndexByRun(key) as typeof hier; } catch { hier = undefined; }
  if (!uam && !hier) return undefined;
  return {
    story_id: uam?.story_id ?? hier?.story_id,
    title: uam?.title ?? hier?.title,
    media_type: uam?.media_type ?? hier?.media_type,
    created_at: uam?.created_at,
    hasHierarchy: !!hier,
  };
}

/** 由 IP 输入侧描述符构造一条 ip-dna 历史条目（output 无运行清单时的兜底）。 */
/**
 * 半自动 IP 预处理阶段（摄入 / 标准化 / 停在裁剪确认门）——这些**不是"生成中"**。
 * 「生成中」只指开始生成之后的下游生成 job（stage ∉ 此集且 status=running）。
 */
const IP_PREPROCESS_STAGES = new Set(["pending", "phase0", "phase1", "standardized", "awaiting_confirmation"]);

/**
 * 归类某 output/input key 关联的活跃 IP job（§状态机：预处理 ≠ 生成中）：
 *  - "generating"    下游生成进行中（status=running 且 stage 非预处理阶段）→ LIST 显示「生成中」
 *  - "preprocessing" 半自动预处理中 / 暂停在确认门（awaiting_confirmation，或 running 且 stage 属预处理阶段）→ 显示「待生成」，绝不「生成中」
 *  - null            无活跃 job
 */
/**
 * 关联「IP 改编下游生成」的内存 SSE run（ipgen_<story_timestamp>_<rand>）。
 *
 * 根因：POST /ip-dna/:runId/generate(async) 会为下游叙事管线新建一条 ipgen run 存入 runs Map，
 * 但它既不设 outputDir（parseDirEntry 的 activeRun 匹配不上）也不进 /history 磁盘条目，其随机 id 仅在
 * 那一次响应里返回一次。前端一旦重载/换会话（如嵌入 Studio）就丢了这个 id，无法再 attach /stream，
 * 中间管线遂长期空白。此处按目录时间戳前缀反查活跃 ipgen run，把 id 暴露到 history 供前端重连。
 */
function findIpGenerationRun(key: string): RunState | undefined {
  const ts = key.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}/)?.[0];
  if (!ts) return undefined;
  const prefix = `ipgen_${ts}_`;
  return [...runs.values()].find((r) => r.status === "running" && r.id.startsWith(prefix));
}

/**
 * 该 key 关联的活跃 IP job 是否正停在「确认裁剪范围」这道阶段门（§4.4①，M-B）。
 *
 * 与 `classifyActiveIpJob` 的粗粒度 "preprocessing" 分开报——否则"还在标准化/建树"
 * 与"已经跑完、停下等你确认"会被同一个 `status="config"` 一起吞掉，界面拿不到
 * "等待确认"这个平台语言态该对应哪个动作。只读投影，不改变 `classifyActiveIpJob`
 * 既有的优先级契约与返回值。
 */
function activeIpJobAwaitingConfirmation(key: string): boolean {
  for (const j of listJobs()) {
    if (!j.story_timestamp || !key.startsWith(j.story_timestamp)) continue;
    if (j.status === "awaiting_confirmation") return true;
  }
  return false;
}

function classifyActiveIpJob(key: string): "generating" | "preprocessing" | null {
  let cls: "generating" | "preprocessing" | null = null;
  for (const j of listJobs()) {
    if (!j.story_timestamp || !key.startsWith(j.story_timestamp)) continue;
    if (j.status === "running" && !IP_PREPROCESS_STAGES.has(j.stage ?? "")) return "generating"; // 生成态优先
    if (j.status === "awaiting_confirmation" || (j.status === "running" && IP_PREPROCESS_STAGES.has(j.stage ?? ""))) {
      cls = "preprocessing";
    }
  }
  return cls;
}

function buildIpDnaHistoryItem(
  key: string,
  desc: NonNullable<ReturnType<typeof loadIpInputDescriptor>>,
  jobClass: "generating" | "preprocessing" | null,
  hasEdits: boolean,
): HistoryItem {
  const generationRunId = findIpGenerationRun(key)?.id;
  const hasUnits = outputHasGameUnits(key);
  // 预处理中/暂停在确认门 → 待生成（config），不是「生成中」，也不是「中断」。
  const status = jobClass === "generating" ? "running"
    : jobClass === "preprocessing" ? "config"
    : hasUnits ? "completed" : "interrupted";
  const hasFullResult = fs.existsSync(path.join(outputDir(), key, "full_result.json"));
  // M-B：preprocessing 这个粗分类同时覆盖"还在标准化"和"已停下等确认"，界面区分
  // 这两者要靠单独查一次 job 阶段（只在 preprocessing 时才查，其余分类不必付这个开销）。
  const awaitingConfirmation = jobClass === "preprocessing" ? activeIpJobAwaitingConfirmation(key) : false;
  const controls = historyControls(status, false, hasEdits);
  return {
    key,
    type: "dir",
    id: desc.story_id ?? null,
    status,
    startedAt: desc.created_at,
    fileCount: undefined,
    hasCheckpoint: false,
    hasEdits,
    lastCompletedStep: null,
    completedSteps: null,
    canResume: false,
    // 有层级树即可被 IP 回放（§6 历史还原输入模块）或加载已生成产物（含 game_unit_*.json 多单元产物）。
    canLoad: hasFullResult || desc.hasHierarchy || outputHasGameUnits(key),
    userInput: desc.title,
    kind: "ip-dna",
    generationRunId,
    controls,
    awaitingConfirmation,
    platformStatus: derivePlatformStatus({ status, canResume: false, controls, awaitingConfirmation }),
  };
}

function parseFilenameEntry(filename: string): HistoryItem | null {
  const match = filename.match(/^(.+?)_(tier\d|auto)_(.+)\.json$/);
  if (!match) return null;
  const [, ts, tierPart, modePart] = match;
  const filePath = path.join(outputDir(), filename);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const status = raw.status ?? "completed";
    return {
      key: filename,
      type: "file",
      id: raw.id ?? null,
      tier: raw.tier ?? tierPart,
      mode: raw.mode ?? modePart,
      status,
      startedAt: raw.startedAt ?? ts.replace(/T/, " ").replace(/-/g, ":"),
      completedAt: raw.completedAt,
      fileCount: undefined,
      hasCheckpoint: false,
      hasEdits: false,
      lastCompletedStep: null,
      completedSteps: null,
      canResume: false,
      canLoad: !!raw.result,
      userInput: raw.userInput ?? raw.result?.user_input,
      routeGroup: raw.routeGroup,
      complexity: raw.complexity,
      cancelled: !!raw.cancelled,
      platformStatus: derivePlatformStatus({ status, cancelled: raw.cancelled, canResume: false }),
    };
  } catch {
    return null;
  }
}

function dirHasEdits(dir: string): boolean {
  const checkpoint = loadCheckpoint(dir);
  if (checkpoint?.step_meta) {
    if (Object.values(checkpoint.step_meta).some(m => m.modifications.length > 0)) return true;
  }
  const editsPath = path.join(outputDir(), dir, "_edits.json");
  if (!fs.existsSync(editsPath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(editsPath, "utf-8"));
    return Array.isArray(data.edits) && data.edits.length > 0;
  } catch { return false; }
}

/** `resolveHistoryStatus` 的输入：把决策树要看的四类事实先归到一处，方便单测逐条断言。 */
interface HistoryStatusSources {
  /** 该条目/该泳道当前绑定的内存态 run（不存在则 undefined）——优先级最高，进程还活着就信它。 */
  activeRunStatus?: "running" | "completed" | "failed";
  /** IP DNA 后台 job 分类；叙事条目/次泳道恒为 null。 */
  ipJobClass: "generating" | "preprocessing" | null;
  /** `manifest.json` 落盘的原始 status 字段。 */
  diskStatus: string;
  /** `manifest.json` 的 cancelled 旗标——用户主动取消 vs 真的跑挂了，界面措辞不同。 */
  cancelled?: boolean;
}

/**
 * 条目/泳道状态判定的优先级决策树（键权层方案 M5）。
 *
 * 优先级：内存活跃态 > IP 生成中/预处理中 > 磁盘残留 running（进程重启后的僵尸态，
 * 没人再更新它，只能推断"中断了"）> 用户主动取消旗标 > 磁盘原始值。
 *
 * 此前这五条分支就地写在 `parseDirEntry` 的 if/else 里，读代码顺序才能确认优先级关系；
 * 抽成显式输入输出的纯函数后，每条分支能单独断言，改动优先级也不必再通读整个函数。
 */
function resolveHistoryStatus(sources: HistoryStatusSources): string {
  if (sources.activeRunStatus) return sources.activeRunStatus;
  if (sources.ipJobClass === "generating") return "running";
  if (sources.ipJobClass === "preprocessing") return "config"; // 停在确认门，非生成中
  if (sources.diskStatus === "running") return "interrupted";
  if (sources.cancelled) return "interrupted";
  return sources.diskStatus;
}

/**
 * 条目级多泳道状态聚合（键权层方案 M5）。
 *
 * 此前条目列表只看主管线 `manifest.json`：主管线早就 completed，用户正在某条次管线
 * （`pipelines/<pipelineId>/`）上重新生成时，列表却显示"已完成"，键权判断跟着全错。
 *
 * 规则很朴素——任一泳道 running 就是条目在动；全部 completed 才算真完成；
 * 其余情况（有的 completed 有的 failed/interrupted，没有一条在跑）算 interrupted，
 * 因为"完全成功"以外的组合都需要作者回来看一眼，不该被"多数泳道成功"糊弄过去。
 */
function aggregateLaneStatuses(statuses: readonly string[]): string {
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.length > 0 && statuses.every((s) => s === "completed")) return "completed";
  return "interrupted";
}

/**
 * 扫 `output/<dir>/pipelines/<pipelineId>/manifest.json` 取各次泳道的状态。
 * 次泳道还没跑过（无 manifest）不计入聚合——不能把"从未开始"算成"中断"。
 */
function subPipelineLaneStatuses(dir: string): string[] {
  const subRoot = path.join(outputDir(), dir, PIPELINE_SUBDIR);
  if (!fs.existsSync(subRoot)) return [];
  let subIds: string[];
  try {
    subIds = fs
      .readdirSync(subRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const statuses: string[] = [];
  for (const pipelineId of subIds) {
    let raw: { status?: string; cancelled?: boolean };
    try {
      raw = JSON.parse(fs.readFileSync(path.join(subRoot, pipelineId, "manifest.json"), "utf-8"));
    } catch {
      continue;
    }
    const laneRun = [...runs.values()].find((r) => r.entryKey === dir && r.pipelineId === pipelineId);
    statuses.push(
      resolveHistoryStatus({
        activeRunStatus: laneRun?.status,
        ipJobClass: null,
        diskStatus: raw.status ?? "unknown",
        cancelled: raw.cancelled,
      }),
    );
  }
  return statuses;
}

function parseDirEntry(dir: string): HistoryItem {
  const manifestPath = path.join(outputDir(), dir, "manifest.json");
  const checkpoint = loadCheckpoint(dir);
  const hasFullResult = fs.existsSync(path.join(outputDir(), dir, "full_result.json"));
  const hasEdits = dirHasEdits(dir);

  const activeRun = [...runs.values()].find((r) => {
    if (r.outputDir) return path.basename(r.outputDir) === dir;
    return formatTimestamp(r.startedAt) === dir;
  });

  // IP DNA 运行不进 runs Map，其活跃态由进程内 job 注册表反映（重启即清）。
  // §状态机：区分「生成中」（下游生成）与「预处理中/暂停确认门」（待生成），后者不显示生成中。
  const ipJobClass = classifyActiveIpJob(dir);
  // IP 改编下游生成的可 stream run id（供前端重连中间预览，见 findIpGenerationRun）。
  const ipGenerationRunId = findIpGenerationRun(dir)?.id;

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    let effectiveStatus = resolveHistoryStatus({
      activeRunStatus: activeRun?.status,
      ipJobClass,
      diskStatus: raw.status,
      cancelled: raw.cancelled,
    });
    // M5：主管线之外还有次泳道在跑/中断时，条目级状态不能只看主管线——
    // 否则主管线早完成、用户正在某条次管线上重新生成，列表会误报"已完成"。
    const laneStatuses = subPipelineLaneStatuses(dir);
    if (laneStatuses.length > 0) {
      effectiveStatus = aggregateLaneStatuses([effectiveStatus, ...laneStatuses]);
    }
    const entryForPipes = loadEntryConfig(dir);
    const pipeCount = Array.isArray(entryForPipes?.pipelines)
      ? entryForPipes!.pipelines!.length
      : undefined;
    const canResumeMain = !!checkpoint && effectiveStatus !== "completed" && effectiveStatus !== "running";
    const controlsMain = historyControls(effectiveStatus, canResumeMain, hasEdits);
    return {
      key: dir,
      type: "dir",
      id: raw.runId ?? activeRun?.id ?? null,
      tier: raw.tier,
      mode: raw.mode,
      status: effectiveStatus,
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      fileCount: raw.files?.length ?? 0,
      hasCheckpoint: !!checkpoint,
      hasEdits,
      lastCompletedStep: checkpoint?.lastCompletedStep ?? null,
      completedSteps: migrateLegacyCompletedSteps(checkpoint?.completedSteps ?? raw.completedSteps ?? null),
      canResume: canResumeMain,
      canLoad: hasFullResult || !!checkpoint || outputHasGameUnits(dir),
      userInput: raw.userInput ?? activeRun?.userInput,
      routeGroup: raw.routeGroup ?? activeRun?.routeGroup,
      complexity: raw.complexity ?? activeRun?.complexity,
      parentKey: raw.parentKey ?? undefined,
      forkReason: raw.forkReason ?? undefined,
      genreCode: raw.genre_code ?? activeRun?.genreCode ?? entryForPipes?.genreCode,
      inputType: entryForPipes?.inputType,
      uploadedFileNames: entryForPipes?.uploadedFileNames,
      storyType: raw.storyType ?? entryForPipes?.storyType,
      storyTheme: raw.storyTheme ?? entryForPipes?.storyTheme,
      narrativeStructure: raw.narrativeStructure ?? entryForPipes?.narrativeStructure,
      kind: raw.kind ?? undefined,
      generationRunId: ipGenerationRunId,
      pipelineCount: pipeCount,
      controls: controlsMain,
      cancelled: !!raw.cancelled,
      platformStatus: derivePlatformStatus({
        status: effectiveStatus,
        cancelled: raw.cancelled,
        canResume: canResumeMain,
        controls: controlsMain,
      }),
    };
  } catch {
    // §条目持久化：无 output 运行清单但有 _entry.json（未生成的条目）→ 返回 status="config" 项，
    // canLoad=true 使点击可还原 INPUT/ROUTING。放在 IP 回填之前：文本/标签条目无 IP 输入描述符。
    const entryCfg = loadEntryConfig(dir);
    if (entryCfg) {
      const status = activeRun ? activeRun.status : ipJobClass === "generating" ? "running" : "config";
      const pipeCount = Array.isArray(entryCfg.pipelines) ? entryCfg.pipelines.length : undefined;
      const controlsCfg = historyControls(status, false, hasEdits);
      const awaitingConfirmationCfg = ipJobClass === "preprocessing" ? activeIpJobAwaitingConfirmation(dir) : false;
      return {
        key: dir,
        type: "dir",
        id: null,
        tier: entryCfg.tier,
        mode: entryCfg.mode,
        status,
        startedAt: entryCfg.createdAt,
        fileCount: entryCfg.uploadedFileNames?.length ?? 0,
        hasCheckpoint: false,
        hasEdits,
        lastCompletedStep: null,
        completedSteps: null,
        canResume: false,
        canLoad: true,
        userInput: entryCfg.userInput,
        routeGroup: entryCfg.routeGroup as HistoryItem["routeGroup"],
        complexity: entryCfg.complexity,
        parentKey: entryCfg.parentKey,
        genreCode: entryCfg.genreCode,
        inputType: entryCfg.inputType,
        uploadedFileNames: entryCfg.uploadedFileNames,
        storyType: entryCfg.storyType,
        storyTheme: entryCfg.storyTheme,
        narrativeStructure: entryCfg.narrativeStructure,
        kind: entryCfg.ipRunKey ? "ip-dna" : undefined,
        generationRunId: ipGenerationRunId,
        pipelineCount: pipeCount,
        controls: controlsCfg,
        awaitingConfirmation: awaitingConfirmationCfg,
        platformStatus: derivePlatformStatus({
          status,
          canResume: false,
          controls: controlsCfg,
          awaitingConfirmation: awaitingConfirmationCfg,
        }),
      };
    }
    // 无 output 运行清单：先尝试用 IP DNA 输入侧资产回填（user_asset_manifest.json 或 _hierarchy.json）。
    // 否则它们会因 catch 落到 "unknown"。状态：进行中 job→running；已落生成产物→completed；否则→interrupted。
    const ipDesc = loadIpInputDescriptor(dir);
    if (ipDesc) {
      return buildIpDnaHistoryItem(dir, ipDesc, ipJobClass, hasEdits);
    }
    const effectiveStatus = activeRun ? activeRun.status
      : checkpoint ? "interrupted" : "unknown";
    const canResumeFallback = !!checkpoint && effectiveStatus !== "running";
    const controlsFallback = historyControls(effectiveStatus, canResumeFallback, hasEdits);
    return {
      key: dir,
      type: "dir",
      id: activeRun?.id ?? (checkpoint as any)?.runId ?? null,
      tier: activeRun?.tier ?? (checkpoint as any)?.tier,
      mode: activeRun?.mode ?? (checkpoint as any)?.mode,
      status: effectiveStatus,
      startedAt: activeRun?.startedAt ?? (checkpoint as any)?.startedAt,
      hasCheckpoint: !!checkpoint,
      hasEdits,
      lastCompletedStep: checkpoint?.lastCompletedStep ?? null,
      completedSteps: migrateLegacyCompletedSteps(checkpoint?.completedSteps ?? activeRun?.completedSteps ?? null),
      canResume: canResumeFallback,
      canLoad: hasFullResult || !!checkpoint,
      userInput: activeRun?.userInput ?? (checkpoint as any)?.userInput,
      routeGroup: activeRun?.routeGroup ?? (checkpoint as any)?.routeGroup,
      complexity: activeRun?.complexity ?? (checkpoint as any)?.complexity,
      parentKey: activeRun?.parentKey,
      forkReason: activeRun?.forkReason,
      generationRunId: ipGenerationRunId,
      controls: controlsFallback,
      platformStatus: derivePlatformStatus({
        status: effectiveStatus,
        canResume: canResumeFallback,
        controls: controlsFallback,
      }),
    };
  }
}

/**
 * §条目持久化：upsert 条目参数到 output/<key>/_entry.json。
 * 首次输入确认（建立条目）与 ROUTING「确认保存」都调它；开始生成时 /start 也会回写（兜底）。
 * 合并语义：同 key 多次 POST 合并、保留 createdAt。
 */
app.post("/api/narrative/entry", (req, res) => {
  const body = (req.body ?? {}) as Partial<EntryConfig>;
  const key = body.key;
  if (!isSafeEntryKeyFn(key)) {
    res.status(400).json({ error: "invalid entry key（需为安全的相对目录名）" });
    return;
  }
  try {
    const entry = writeEntryConfig(key, body);
    res.json({ key, status: "config", entry });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** 列出本地保存的历史记录（扫描子目录 + 平铺 JSON 文件） */
app.get("/api/narrative/history", (_req, res) => {
  try {
    const all = fs.readdirSync(outputDir(), { withFileTypes: true });
    const items: HistoryItem[] = [];

    const outputKeys = new Set<string>();
    // §条目持久化桥接：收集 output/<key>/_entry.json 里指向 IP 媒体目录的 ipRunKey，
    // 使输入侧 IP 运行（键=<时间戳>_<标题>）与其 output 条目（键=<时间戳>）去重——只留 output 那条。
    const linkedIpRunKeys = new Set<string>();
    // §桥接去重（前缀）：有 _entry.json 的 output 条目键。输入侧 IP 运行键恒为 <条目键>_<标题>，
    // 故即使 ipRunKey 尚未回写（预处理阶段 / 自动模式存的是纯时间戳），也可按前缀吸附去重。
    const entryDirKeys: string[] = [];
    for (const entry of all) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        outputKeys.add(entry.name);
        const cfg = loadEntryConfig(entry.name);
        if (cfg) entryDirKeys.push(entry.name);
        if (cfg?.ipRunKey) linkedIpRunKeys.add(cfg.ipRunKey);
        items.push(parseDirEntry(entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const item = parseFilenameEntry(entry.name);
        if (item) items.push(item);
      }
    }

    // 输入侧 IP 运行兜底（§5.1 历史可见性）：半自动 ingest 不写 output 运行清单，
    // 摄入后即中断的运行只在 input/<key> 留痕（user_asset_manifest.json / _hierarchy.json）。
    // 扫 INPUT_DIR，把无 output 对应项的 IP 运行也列入 LIST（中断仍可见、可回放）。
    try {
      // 媒体优先布局：运行键在 input/<媒体>/story_<媒体>/*_<阶段>/<run> 下，需跨家族枚举（+legacy 兜底）。
      for (const key of listInputRunKeys()) {
        if (outputKeys.has(key)) continue; // output 侧已覆盖
        if (linkedIpRunKeys.has(key)) continue; // 已有 output 条目经 ipRunKey 桥接覆盖（去重）
        // 前缀吸附：输入运行键 = <条目键>_<标题>，被同名 output 条目（含 _entry.json）覆盖即去重，
        // 不依赖 ipRunKey 何时落盘，修"同一 IP 请求裂成两条"。
        if (entryDirKeys.some((ek) => key === ek || key.startsWith(`${ek}_`))) continue;
        const desc = loadIpInputDescriptor(key);
        if (!desc) continue;
        const jobClass = classifyActiveIpJob(key);
        items.push(buildIpDnaHistoryItem(key, desc, jobClass, dirHasEdits(key)));
      }
    } catch { /* input 目录不存在则跳过 */ }

    // §去重（output × output）：IP 生成的产出/运行目录键恒为 <条目键>_<标题>，而「确认」时建的
    // _entry.json 配置占位目录键为 <条目键>（裸时间戳）。二者是**同一请求**的两个 output 目录，需合并。
    // 判据用 id 而非 status：占位目录无运行清单 → id=null（即使被活跃 job 蹭成 running 也无 id）；
    // 真实产出/运行目录带 id。若存在 <条目键>_* 且**带 id** 的产出运行，则丢弃裸占位项，
    // 使"同一 IP 请求"在 LIST 只呈现一条（修"条目不唯一/分歧"）。
    // 文本/标签运行的产出目录键即 <条目键>（不追加标题、且自身带 id），不会被裁剪。
    const dedupedItems = items.filter((it) => {
      if (it.id) return true; // 有真实运行产出的目录，权威保留
      const supersededByRun = items.some((o) => !!o.id && o.key.startsWith(`${it.key}_`));
      return !supersededByRun;
    });

    dedupedItems.sort((a, b) => {
      const ka = a.startedAt ?? a.key;
      const kb = b.startedAt ?? b.key;
      return kb.localeCompare(ka);
    });

    res.json(dedupedItems);
  } catch {
    res.json([]);
  }
});

/**
 * IP 前驱步骤序（与前端 IpStageFlow/TierModeSelector 的 ip_* step id 对齐，§6 SSOT）。
 * 历史回放时若该 output run 关联 IP DNA 输入，则把这段拼到生成链头部，
 * 使顶栏与中间预览同源消费的 pipelineOrder 含完整 IP 段（动态 C 序号由前端按出现顺序赋予）。
 */
const IP_PREDECESSOR_STEP_IDS = ["ip_input", "ip_standardize", "ip_volume", "ip_adapt_plan", "ip_dna_extract"];

/** 该 output key 是否关联 IP DNA 输入（input/<key>/_extraction_output/_hierarchy.json 存在）。 */
function withIpPredecessorOrder(key: string, order: string[] | undefined): string[] | undefined {
  let hasIp = false;
  try { hasIp = !!loadHierarchyIndexByRun(key); } catch { hasIp = false; }
  if (!hasIp) return order;
  const base = order ?? [];
  if (base.some((s) => s.startsWith("ip_"))) return base; // 已含 IP 段则不重复拼接
  return [...IP_PREDECESSOR_STEP_IDS, ...base.filter((s) => !IP_PREDECESSOR_STEP_IDS.includes(s))];
}

/** 加载历史记录的完整结果（支持目录和平铺 JSON） */
app.get("/api/narrative/history/:key/load", (req, res) => {
  const key = req.params.key;

  if (key.endsWith(".json")) {
    const filePath = path.join(outputDir(), key);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      res.json({
        id: raw.id ?? key,
        tier: raw.tier,
        mode: raw.mode,
        status: raw.status ?? "completed",
        result: raw.result ?? null,
        userInput: raw.userInput ?? raw.result?.user_input,
        routeGroup: raw.routeGroup,
        complexity: raw.complexity,
        // Phase 1: 把启动管线的完整参数与权威步骤序透传给前端。
        genre_code:
          raw.genre_code ??
          (raw.result?.tier_detection?.genre_code !== "manual"
            ? raw.result?.tier_detection?.genre_code
            : undefined) ??
          raw.result?.demand_analysis?.genre_code,
        pipelineOrder: withIpPredecessorOrder(key.replace(/\.json$/, ""), raw.pipelineOrder),
        routingMode: raw.routingMode,
      });
    } catch {
      res.status(500).json({ error: "Failed to parse file" });
    }
    return;
  }

  const dirPath = path.join(outputDir(), key);
  const fullResultPath = path.join(dirPath, "full_result.json");
  const checkpoint = loadCheckpoint(key);
  // G1：key 可以是 `<entryKey>` 或次管线的 `<entryKey>/pipelines/<pipelineId>`——两种形态都要能
  // 单独加载该泳道自己的 checkpoint/manifest/full_result（上面三行已经用 key 原样在做），但
  // `_entry.json` 只在条目根，次管线目录下没有，须回溯到条目根才能读到（否则次管线切换后
  // entry 字段总是空，前端拿不到条目级 routing 配置）。
  const entryRootKey = entryKeyOfRunDir(key) ?? key;

  const manifestPath = path.join(dirPath, "manifest.json");
  let manifest: Record<string, unknown> = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch { /* no manifest */ }

  // Strip output fields for steps that did not actually complete.
  // This ensures "后端有什么就展示什么" — only truly completed data is returned.
  // Must handle overlapping field mappings (e.g. script_scene_generation shares
  // fields with script_generation / scene_plan).
  const stripIncompleteFields = (
    ctx: NarrativeContext,
    runStatus: string | undefined,
    completedSteps: string[] | null,
  ): NarrativeContext => {
    if (runStatus === "completed" || !completedSteps?.length) return ctx;
    const clean = { ...ctx } as Record<string, unknown>;
    // D5: migrate legacy step IDs before computing protected fields
    const migrated = migrateLegacyCompletedSteps(completedSteps);
    const doneSet = new Set(migrated);
    const protectedFields = new Set<string>();
    for (const sid of migrated) {
      const f = STEP_OUTPUT_FIELDS[sid];
      if (f) for (const field of f) protectedFields.add(field);
    }
    for (const [stepId, fields] of Object.entries(STEP_OUTPUT_FIELDS)) {
      if (!doneSet.has(stepId)) {
        for (const field of fields) {
          if (!protectedFields.has(field)) delete clean[field];
        }
      }
    }
    return clean as NarrativeContext;
  };

  if (fs.existsSync(fullResultPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(fullResultPath, "utf-8"));
      if (data.result) {
        const rawCtx = (checkpoint && checkpoint.ctx) ? checkpoint.ctx : data.result;
        const completedStepsRaw = checkpoint?.completedSteps
          ?? (manifest.completedSteps as string[] | undefined)
          ?? null;
        const completedSteps = migrateLegacyCompletedSteps(completedStepsRaw);
        data.result = stripIncompleteFields(rawCtx, data.status, completedSteps);
        data.completedSteps = completedSteps;
        data.stepMeta = checkpoint?.step_meta ?? null;
        // Phase 1: 把 checkpoint / manifest 持久化的启动管线快照透传给前端。
        // 来源优先级：checkpoint > manifest > full_result raw > ctx 兜底。
        data.genre_code =
          checkpoint?.genre_code ??
          (manifest.genre_code as string | undefined) ??
          data.genre_code ??
          (rawCtx?.tier_detection?.genre_code !== "manual"
            ? rawCtx?.tier_detection?.genre_code
            : undefined) ??
          rawCtx?.demand_analysis?.genre_code;
        data.pipelineOrder = withIpPredecessorOrder(
          key,
          checkpoint?.pipelineOrder ??
            (manifest.pipelineOrder as string[] | undefined) ??
            data.pipelineOrder,
        );
        data.routingMode =
          checkpoint?.routingMode ??
          (manifest.routingMode as "auto" | "semi" | "manual" | undefined) ??
          data.routingMode;
        // 专家/席位嵌套随条目回放：结构由品类 + 层级现算，与 start 那帧同一个函数。
        data.stepGroups = expertStepGroups(
          data.genre_code as string | undefined,
          (checkpoint?.tier ?? (manifest.tier as TierId | undefined) ?? data.tier) as TierId | undefined,
        );
        // Phase-1：附带 _entry.json（多管线 pipelines / 画布拓扑），供 O 侧还原。
        const entryCfgFull = loadEntryConfig(entryRootKey);
        if (entryCfgFull) data.entry = entryCfgFull;
        res.json(data);
        return;
      }
    } catch { /* fall through to checkpoint */ }
  }

  if (checkpoint && checkpoint.ctx) {
    const runStatus = (manifest.status as string) === "completed" ? "completed" : "interrupted";
    const completedStepsRaw = checkpoint.completedSteps
      ?? (manifest.completedSteps as string[] | undefined)
      ?? null;
    const completedSteps = migrateLegacyCompletedSteps(completedStepsRaw);
    const entryCfgCp = loadEntryConfig(entryRootKey);
    res.json({
      id: checkpoint.runId ?? manifest.runId,
      tier: checkpoint.tier ?? manifest.tier,
      mode: checkpoint.mode ?? manifest.mode,
      status: runStatus,
      result: stripIncompleteFields(checkpoint.ctx, runStatus, completedSteps),
      completedSteps,
      userInput: checkpoint.userInput ?? manifest.userInput,
      routeGroup: checkpoint.routeGroup ?? manifest.routeGroup,
      complexity: checkpoint.complexity ?? manifest.complexity,
      stepMeta: checkpoint.step_meta ?? null,
      // Phase 1: 把 checkpoint 持久化的启动管线快照带回前端。
      genre_code:
        checkpoint.genre_code ??
        (manifest.genre_code as string | undefined) ??
        (checkpoint.ctx.tier_detection?.genre_code !== "manual"
          ? checkpoint.ctx.tier_detection?.genre_code
          : undefined) ??
        checkpoint.ctx.demand_analysis?.genre_code,
      pipelineOrder: withIpPredecessorOrder(
        key,
        checkpoint.pipelineOrder ?? (manifest.pipelineOrder as string[] | undefined),
      ),
      routingMode:
        checkpoint.routingMode ??
        (manifest.routingMode as "auto" | "semi" | "manual" | undefined),
      stepGroups: expertStepGroups(
        checkpoint.genre_code
          ?? (manifest.genre_code as string | undefined)
          ?? checkpoint.ctx.tier_detection?.genre_code,
        (checkpoint.tier ?? (manifest.tier as TierId | undefined)) as TierId | undefined,
      ),
      entry: entryCfgCp ?? undefined,
    });
    return;
  }

  // IP 多单元产物加载：无 full_result.json / _checkpoint.json，但已落 game_unit_*.json →
  // 取序号最小的单元的 result 作可展示 ctx，并按规范序反推下游已完成步骤，重建中间管线。
  // 修复「IP run 跑完后中间只剩 5 个 IP 预处理步、下游叙事管线全不显示」。
  const gameUnitCtx = loadGameUnitCtx(key);
  if (gameUnitCtx) {
    const downstream = deriveCompletedStepsFromCtx(gameUnitCtx);
    const fullOrder = withIpPredecessorOrder(key, downstream) ?? downstream;
    const entryCfgGu = loadEntryConfig(entryRootKey);
    res.json({
      id: (manifest.runId as string) ?? key,
      tier: manifest.tier,
      mode: manifest.mode,
      status: "completed",
      result: gameUnitCtx,
      completedSteps: fullOrder,
      userInput: (manifest.userInput as string) ?? gameUnitCtx.user_input,
      complexity: manifest.complexity,
      genre_code:
        (manifest.genre_code as string | undefined) ??
        (gameUnitCtx.tier_detection?.genre_code !== "manual"
          ? gameUnitCtx.tier_detection?.genre_code
          : undefined) ??
        gameUnitCtx.demand_analysis?.genre_code,
      pipelineOrder: fullOrder,
      routingMode: manifest.routingMode as "auto" | "semi" | "manual" | undefined,
      entry: entryCfgGu ?? undefined,
    });
    return;
  }

  // §条目持久化：未生成的条目（只有 output/<key>/_entry.json，无结果/checkpoint）→
  // 返回 status="config" + entry 供前端还原 INPUT/ROUTING（result 为 null，走前端 config 分支）。
  const entryCfg = loadEntryConfig(entryRootKey);
  if (entryCfg) {
    res.json({
      id: key,
      tier: entryCfg.tier ?? null,
      mode: entryCfg.mode ?? null,
      status: "config",
      result: null,
      entry: entryCfg,
      userInput: entryCfg.userInput,
      routeGroup: entryCfg.routeGroup,
      complexity: entryCfg.complexity,
      genre_code: entryCfg.genreCode,
      // IP 作品条目：带 ipRunKey，前端据此调 fetchIpDnaHierarchy 回放 IP 步。
      pipelineOrder: entryCfg.ipRunKey ? withIpPredecessorOrder(entryCfg.ipRunKey, undefined) : undefined,
      routingMode: undefined,
    });
    return;
  }

  res.status(404).json({ error: "No loadable data found" });
});

/**
 * Phase-1 M2: config → resolved RunManifest（后端 Planner 真值）。
 * 前端「未运行」管线状态预览应读此接口，禁止客户端重算步序。
 * Body: { entryKey?, pipelineId?, config, compositionGraph?, requestedSteps? }
 *      或 { entryKey?, configs: PlanManifestRequest[] } 批量多管线。
 */
/**
 * Phase-1 M3: 单 agent 独立调用（不遍历全管线）。
 * Body: { ctx?, inputs?, user_input?, model? }
 * 返回 { agentId, outputField, output, ctx }；长任务可后续挂 SSE。
 */
/**
 * 登记一个单 agent 的 SSE run 并在后台执行，返回 runId。
 *
 * 帧形状与管线 run 完全一致（announce → running/completed → done），使前端能
 * 复用同一套消费逻辑；composite 的子步各占一帧，波次因此在画布上可见。
 * 校验（agent 存在 / requiredInputs）在返回前同步做完，失败即 4xx 而非流内报错。
 */
function launchAgentRun(p: {
  agentId: string;
  ctx: NarrativeContext;
  inputs?: Record<string, unknown>;
  llm: LLMClient;
  /** G2：给了安全的 entryKey，这次单席跑就绑定到该条目并落盘（见 AgentEntryBinding）。 */
  entryKey?: string;
}): string {
  const isPersisted = isSafeRunDir(p.entryKey);
  const binding = isPersisted ? resolveAgentEntryBinding(p.entryKey!, p.ctx) : undefined;
  const ctx = assertAgentRunnable(p.agentId, binding?.seededCtx ?? p.ctx, p.inputs);
  const runId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agent = getNarrativeAgent(p.agentId);
  const def = getAgentDef(p.agentId);
  // composite：把子步一并 announce，画布可先铺出全部待跑节点。
  const announced =
    def?.structure.type === "composite"
      ? [p.agentId, ...def.structure.config.children]
      : [p.agentId];

  const state: RunState = {
    id: runId,
    status: "running",
    progress: [
      {
        type: "pipeline_steps_announce",
        stage: "announce",
        step: 0,
        totalSteps: announced.length,
        status: "pending",
        steps: announced,
        stepNames: stepDisplayNames(announced),
      },
      // 把该条目已完成的步先合成"已完成"帧塞进 progress，saveCheckpoint 才不会
      // 把它们从落盘的 completedSteps 里挤掉（它只认这次 run 的 progress，不读盘）。
      ...(binding?.seededProgress ?? []),
    ],
    streamBuffer: [],
    startedAt: new Date().toISOString(),
    userInput: binding?.userInput ?? (typeof ctx.user_input === "string" ? ctx.user_input : undefined),
    tier: binding?.tier,
    mode: binding?.mode,
    routeGroup: binding?.routeGroup,
    complexity: binding?.complexity,
    model: binding?.model,
    genreCode: binding?.genreCode,
    outputDir: binding?.outputDir,
    entryKey: isPersisted ? p.entryKey : undefined,
    pipelineSteps: binding?.pipelineSteps ?? announced,
    checkpointAgents: binding?.checkpointAgents,
    // 未绑定条目时维持老语义：临时态，不落盘。
    agentRun: !isPersisted,
  };
  runs.set(runId, state);
  if (isPersisted) ensureEntryConfigForAgentRun(p.entryKey!, state.userInput);

  const push = (
    stepId: string,
    status: "running" | "completed",
    extra: { message?: string; data?: unknown } = {},
  ) => {
    state.progress.push({
      stage: getNarrativeAgent(stepId)?.name ?? stepId,
      stepId,
      step: Math.max(1, announced.indexOf(stepId) + 1),
      totalSteps: announced.length,
      status,
      ...extra,
    });
    if (isPersisted && status === "completed") {
      persistAgentStepCompletion(state, stepId, extra.data, ctx);
    }
  };

  runAgent({
    agentId: p.agentId,
    ctx,
    inputs: p.inputs,
    llm: p.llm,
    onAgentProgress: (id, message) => push(id, "running", { message }),
    onAgentComplete: (id, output) => push(id, "completed", { data: output }),
  })
    .then((result) => {
      state.status = "completed";
      state.result = result.ctx;
      state.completedSteps = state.progress
        .filter((f) => f.status === "completed" && f.stepId)
        .map((f) => f.stepId!);
      if (isPersisted) {
        try {
          saveRunToFile(state);
        } catch (e) {
          console.error("[Server] launchAgentRun saveRunToFile failed:", e);
        }
      }
    })
    .catch((err: unknown) => {
      state.status = "failed";
      state.error = err instanceof Error ? err.message : String(err);
      state.progress.push({
        stage: agent?.name ?? p.agentId,
        stepId: p.agentId,
        step: announced.length,
        totalSteps: announced.length,
        status: "failed",
        message: state.error,
      });
    });

  return runId;
}

/**
 * 单 agent 执行。默认同步返回结果；`stream: true` 时改为登记一个 run 并立刻返回
 * runId，过程经既有 `GET /api/narrative/stream/:id` 推送（Phase-2 M9）。
 *
 * composite 专家（tpl-jrpg 这类）一跑就是十几分钟的子 DAG，同步模式下画布上只能干等
 * 一个 pending 的请求；SSE 模式下每个子步各出一帧 running/completed，与管线运行同构，
 * 前端可直接复用同一套 SSE 消费逻辑。
 *
 * G3：`:id` 既可以是 step id（老调用方式不变），也可以是席位 id——平台代理与前端
 * 只该知道二十个席位号，不该关心某席今天具体落在哪个/哪几个 step 上。
 * `resolveSeatRunnableAgentId` 把席位 id 解析到真正可执行的 AgentDef id 后再往下走；
 * 解析不出来（未知 id，或多步席尚无 composite 外壳）时原样透传，保留原有的
 * "NarrativeAgent not registered" 404 行为，不新增一种未知失败模式。
 */
/**
 * 单席调用失败的统一出口。
 *
 * 起跑闸门拦下的（requires-upstream 席缺上游）回 422 并带结构化的 missingInputs /
 * blockedBy，前端据此提示"需先运行【X 助手】"并灰置入口，不必解析 message 字符串。
 * 其余错误照旧 400。
 */
function respondAgentRunError(res: express.Response, agentId: string, err: unknown): void {
  if (err instanceof MissingInputsError) {
    res.status(422).json({
      error: err.message,
      agentId,
      missingInputs: err.fields,
      blockedBy: err.blockedBy,
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  // 闸门错误也可能经其它包装路径冒出来（如 launchAgentRun 内部再抛）：
  // 前缀判定作为兜底保留，避免这类调用从 422 掉回 400。
  const status = message.includes("missing required inputs") ? 422 : 400;
  res.status(status).json({ error: message, agentId });
}

/**
 * G3：席位发现。返回全表席位及其可单跑性，供平台代理与画布查询"有哪些助手、
 * 今天哪些能被单独调用、调用前还缺什么输入"，不必各自硬编码席位到 step 的映射。
 */
app.get("/api/narrative/seats", (_req, res) => {
  res.json({ seats: listSeatDiscovery() });
});

app.post("/api/narrative/agent/:id/run", async (req, res) => {
  const requestedId = req.params.id;
  const agentId = resolveSeatRunnableAgentId(requestedId) ?? requestedId;
  const body = req.body ?? {};
  const makeLlm = () =>
    new LLMClient({
      apiKey: getGeminiApiKey() || undefined,
      proxyUrl: getLlmProxyUrl() || undefined,
      proxyApiKey: getLlmProxyKey() || undefined,
      defaultModel: body.model ?? getDefaultModel(),
    });
  const baseCtx = (body.ctx ?? {
    user_input: body.user_input ?? body.userInput ?? "",
  }) as NarrativeContext;

  // G2：entry_key 给了就绑定落盘；不给维持老的"临时态，只回 response body"行为。
  const entryKeyReq: unknown = body.entry_key ?? body.entryKey;
  const persist = isSafeRunDir(entryKeyReq);
  const boundEntryKey = persist ? (entryKeyReq as string) : undefined;

  if (body.stream === true || body.stream === "true") {
    try {
      const runId = launchAgentRun({
        agentId,
        ctx: baseCtx,
        inputs: body.inputs,
        llm: makeLlm(),
        entryKey: boundEntryKey,
      });
      res.status(202).json({
        runId,
        agentId,
        // G3：requestedId 与 agentId 不同表示调用方传的是席位 id，实际跑的是解析出的 step/composite id。
        requestedId: requestedId !== agentId ? requestedId : undefined,
        streamUrl: `/api/narrative/stream/${runId}`,
        entryKey: boundEntryKey,
      });
    } catch (err) {
      respondAgentRunError(res, agentId, err);
    }
    return;
  }

  try {
    const binding = boundEntryKey ? resolveAgentEntryBinding(boundEntryKey, baseCtx) : undefined;
    const result = await runAgent({
      agentId,
      ctx: binding?.seededCtx ?? baseCtx,
      inputs: body.inputs,
      llm: makeLlm(),
    });
    if (boundEntryKey && binding) {
      persistSyncAgentRun(boundEntryKey, binding, agentId, result.ctx);
      res.json({
        ...result,
        requestedId: requestedId !== agentId ? requestedId : undefined,
        entryKey: boundEntryKey,
        sourceDir: boundEntryKey,
      });
      return;
    }
    res.json({ ...result, requestedId: requestedId !== agentId ? requestedId : undefined });
  } catch (err) {
    respondAgentRunError(res, agentId, err);
  }
});

app.post("/api/narrative/plan", (req, res) => {
  try {
    const body = req.body ?? {};

    // 多管线：画布 nodes/edges → 按开始节点切分
    if (body.compositionNodes && body.compositionEdges) {
      const graphs = splitCompositionByStartNodes(
        body.compositionNodes,
        body.compositionEdges,
      );
      const manifests = buildEntryManifests(
        body.entryKey ?? `draft-${Date.now()}`,
        graphs,
        body.config ?? {},
        body.requestedStepsByStart,
        body.configByStart,
        body.hasUploadedScript ?? body.has_uploaded_script,
      );
      res.json({
        entryKey: manifests[0]?.entryKey,
        pipelines: manifests,
        count: manifests.length,
      });
      return;
    }

    if (Array.isArray(body.configs)) {
      const pipelines = body.configs.map((c: Parameters<typeof buildRunManifest>[0]) =>
        buildRunManifest(c),
      );
      res.json({ pipelines, count: pipelines.length });
      return;
    }

    const manifest = buildRunManifest({
      entryKey: body.entryKey,
      pipelineId: body.pipelineId,
      config: body.config ?? {
        tier: body.tier,
        mode: body.mode,
        genreCode: body.genre_code ?? body.genreCode,
        storyType: body.story_type ?? body.storyType,
        storyTheme: body.story_theme ?? body.storyTheme,
        tags: body.tags,
        narrativeStructure: body.narrative_structure ?? body.narrativeStructure,
        complexity: body.complexity,
        routeGroup: body.route_group ?? body.routeGroup,
        locale: body.locale,
        autoDetect: body.auto_detect ?? body.autoDetect,
        pipelineTemplate: body.pipeline_template ?? body.pipelineTemplate,
        userInput: body.user_input ?? body.userInput,
        ipRunKey: body.ip_run_key ?? body.ipRunKey,
      },
      compositionGraph: body.compositionGraph,
      requestedSteps: body.requestedSteps,
      hasUploadedScript: body.hasUploadedScript ?? body.has_uploaded_script,
    });
    res.json({ pipeline: manifest, pipelines: [manifest], count: 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

/**
 * Returns narrative pipeline state as standard Narrative Runtime PipelineState.nodes.
 * This endpoint is consumed by the platform's pipeline status mechanism.
 */
app.get("/api/narrative/pipeline-nodes/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const statusMap = new Map(
    state.progress.map((p) => [p.stepId ?? p.stage, p.status])
  );

  const nodes = state.progress
    .filter((p, i, arr) => {
      const sid = p.stepId ?? p.stage;
      return arr.findIndex((x) => (x.stepId ?? x.stage) === sid) === i;
    })
    .map((p) => {
      const stepId = p.stepId ?? p.stage;
      const latest = statusMap.get(stepId) ?? "pending";
      const wbStatus =
        latest === "completed" ? "done" :
        latest === "running" ? "ai_producing" :
        latest === "failed" ? "needs_rework" : "not_started";
      return {
        id: `narrative:${stepId}`,
        pipelineId: "narrative",
        entityId: "main_story",
        phaseId: stepId,
        status: wbStatus,
        agentSessionId: state.id,
      };
    });

  res.json({
    pipelineId: "narrative",
    runId: state.id,
    runStatus: state.status,
    tier: state.tier,
    mode: state.mode,
    nodes,
  });
});

/**
 * Export narrative results as structured project assets.
 * Writes to a specified directory or returns the asset manifest.
 * This endpoint is used by the agent/platform to persist narrative
 * outputs into the project's `assets/narrative/` directory.
 */
app.post("/api/narrative/export/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (state.status !== "completed" || !state.result) {
    res.status(400).json({ error: "Run not completed" });
    return;
  }

  const { target_dir } = req.body as { target_dir?: string };
  const exportDir = target_dir
    ? path.resolve(target_dir, "assets/narrative")
    : getRunDir(state);
  fs.mkdirSync(exportDir, { recursive: true });

  const ctx = state.result;
  const files: string[] = [];

  for (const [stepId, fileDef] of Object.entries(STEP_FILE_MAP)) {
    const data = getStepDataForFile(stepId, ctx);
    if (data != null) {
      const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
      writeAssetFile(exportDir, filename, data);
      files.push(filename);
    }
  }

  writeAssetFile(exportDir, "manifest.json", {
    runId: state.id,
    tier: state.tier,
    mode: state.mode,
    exportedAt: new Date().toISOString(),
    files,
  });

  console.log(`📦 Exported ${files.length} assets to ${exportDir}`);
  res.json({ exported: files.length, dir: exportDir, files });
});

// ---------------------------------------------------------------------------
// Per-node atomic file saving (used by pipeline steps via ctx._saveNode)
// ---------------------------------------------------------------------------

function saveNodeFile(
  state: RunState,
  stepId: string,
  nodeId: string,
  data: unknown,
): void {
  try {
    const fileDef = STEP_FILE_MAP[stepId];
    if (!fileDef) return;
    const runDir = getRunDir(state);
    const subDir = path.join(runDir, `${fileDef.index}_${fileDef.name}`);
    fs.mkdirSync(subDir, { recursive: true });
    const safeId = String(nodeId).replace(/[/\\?%*:|"<>]/g, "_");
    const ext = typeof data === "string" ? "md" : "json";
    writeAssetFile(subDir, `${safeId}.${ext}`, data);
  } catch (e) {
    console.error(`[saveNodeFile] ${stepId}/${nodeId}:`, e);
  }
}

// ---------------------------------------------------------------------------
// File listing and reading APIs (for frontend file-pool watcher)
// ---------------------------------------------------------------------------

function listRunFiles(runDir: string, prefix = ""): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(path.join(runDir, prefix), { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...listRunFiles(runDir, rel));
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  } catch { /* dir may not exist yet */ }
  return files;
}

/**
 * 四元组 → 产物根目录清单（按环节分组）。
 *
 * 输入侧各环节（原始件 / 标准化 / 抽取产物 / 压缩包）是**条目级**的：一个条目
 * 无论跑几条管线，投喂的原料只有一份，所以一律按 entryKey 取。只有生成产物
 * 那一组要落到具体管线目录。
 *
 * 次管线子目录不存在时退回条目根：调用方把主管线的泳道身份当子目录传进来时，
 * 与其回空清单不如给它条目根的产物（见 artifact-address.ts 的同名说明）。
 */
function artifactRootsForAddress(
  addr: ArtifactAddress,
): Array<{ group: string; dir: string }> {
  const roots = runArtifactRoots(addr.entryKey);
  if (!addr.pipelineId) return roots;
  const pipelineDir = path.join(outputDir(), artifactRunDir(addr));
  if (!fs.existsSync(pipelineDir)) return roots;
  return [
    ...roots.filter((r) => r.group !== "output"),
    { group: "output", dir: pipelineDir },
  ];
}

/**
 * 从请求解析产物地址。路径参数历史上叫 `:runId`，实收的却是磁盘键 —— 两种都认，
 * 但 runId 只在该 run 还活着时能翻译（内存态，重启即失效，故绝不作为持久地址）。
 */
function addressFromRequest(
  ref: string,
  query: Record<string, unknown> = {},
): ArtifactAddress | null {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const versionRaw = str(query.version);
  return resolveArtifactAddress({
    ref,
    pipelineId: str(query.pipelineId ?? query.pipeline_id),
    stepId: str(query.stepId ?? query.step_id),
    nodeId: str(query.nodeId ?? query.node_id),
    version: versionRaw ? Number.parseInt(versionRaw, 10) : undefined,
    lookupRun: runAnchorOf,
  });
}

/**
 * 列出某 run 跨「input 各环节 + output」两侧的全部文件（§5.1 每环节文件可见）。
 * 返回值：
 *   - `files`: `<group>/<相对路径>` 扁平清单（group ∈ original/processing/extraction_output/package/output）。
 *   - `groups`: 按环节分组（含中文 label + 文件相对路径），供「按环节浏览」直接渲染。
 * 兼容旧行为：纯 output run（无 input 痕迹）也照样以 `output/<rel>` 形式给出。
 */
app.get("/api/narrative/files/:runId", (req, res) => {
  const addr = addressFromRequest(req.params.runId, req.query as Record<string, unknown>);
  if (!addr) {
    res.status(400).json({ error: "Malformed artifact reference" });
    return;
  }
  const roots = artifactRootsForAddress(addr);
  if (roots.length === 0) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const files: string[] = [];
  const groups = roots.map((r) => {
    const rel = listRunFiles(r.dir);
    files.push(...rel.map((f) => `${r.group}/${f}`));
    return { group: r.group, label: RUN_ARTIFACT_GROUP_LABELS[r.group] ?? r.group, files: rel };
  });
  // 确认状态与清单同一次给出：分两次取必然出现"清单已刷新、勾选还是旧的"那一帧。
  // 只给这条泳道的：清单本身就是这条泳道的文件，混进别条泳道的勾选只会错标。
  const assets = normalizeAssets(loadEntryConfig(addr.entryKey)?.assets).filter(
    (a) => (a.pipelineId ?? undefined) === (addr.pipelineId ?? undefined),
  );
  res.json({ files, groups, assets });
});

/**
 * 把一份产物折成平台文件区（系统文件区）能定位的地址。
 *
 * 前端手里只有 `<group>/<相对路径>` 这种清单口径（见上面 `GET /files/:runId`），
 * 而 `group` 是环节标签、不是磁盘目录名，真实目录在 `artifactRootsForAddress()`
 * 里。加上双模式映射本身也只在后端（`src/runtime/artifact-root.ts`），所以折算
 * 必须留在这一侧：前端复刻这两张表必然漂移。
 *
 * 只在插件模式下有答案；独立模式没有「游戏根」这个概念，据实回 `standalone`，
 * 让前端把「定位」这个动作藏掉，而不是送一条文件区匹配不上的路径过去。
 */
app.get("/api/narrative/locate/:runId", (req, res) => {
  const addr = addressFromRequest(req.params.runId, req.query as Record<string, unknown>);
  if (!addr) {
    res.status(400).json({ error: "Malformed artifact reference" });
    return;
  }
  const rel = typeof req.query.path === "string" ? req.query.path.trim() : "";
  if (!rel) {
    res.status(400).json({ error: "Missing path" });
    return;
  }
  const slash = rel.indexOf("/");
  const group = slash < 0 ? rel : rel.slice(0, slash);
  const within = slash < 0 ? "" : rel.slice(slash + 1);
  const root = artifactRootsForAddress(addr).find((r) => r.group === group);
  if (!root || !within) {
    res.status(404).json({ ok: false, reason: "not-found" });
    return;
  }
  // 目录逃逸防护：`within` 来自查询串，解析后必须仍落在这一环节的根之内。
  const abs = path.resolve(root.dir, within);
  const rootAbs = path.resolve(root.dir);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    res.status(400).json({ ok: false, reason: "escapes-root" });
    return;
  }
  if (!fs.existsSync(abs)) {
    res.status(404).json({ ok: false, reason: "not-found" });
    return;
  }
  const gamePath = toGameRelativePath(abs);
  if (!gamePath) {
    res.json({ ok: false, reason: "standalone" });
    return;
  }
  res.json({ ok: true, gamePath, name: path.basename(abs) });
});

/**
 * M2 版本溯源：某 run 目录下所有主干、所有历史版本的"为什么产生这一版"，
 * 一次性给全（键与 `GET /files/:runId` 的 `files[]` 同形，前端按 `LibraryFile.path`
 * 直接查表），不必逐个主干分别请求。没有 sidecar（旧快照、调用方未传 origin）的
 * 版本号在返回体里缺席，前端按"无溯源"渲染，不当错误处理。
 */
app.get("/api/narrative/version-origins/:runId", (req, res) => {
  const addr = addressFromRequest(req.params.runId, req.query as Record<string, unknown>);
  if (!addr) {
    res.status(400).json({ error: "Malformed artifact reference" });
    return;
  }
  const roots = artifactRootsForAddress(addr);
  if (roots.length === 0) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const origins: Record<string, VersionOrigin> = {};
  for (const r of roots) {
    for (const [rel, origin] of Object.entries(allVersionOrigins(r.dir))) {
      origins[`${r.group}/${rel}`] = origin;
    }
  }
  res.json({ origins });
});

/**
 * 确认状态表（契约 docs/contracts.md §三）。
 *
 * 只管"这个条目里哪些产物是定稿"。跨任务归档是另一张表（`/projects`），两者不同步 ——
 * 一份产物可以已确认但没归档，也可以归档进多个项目。
 */
app.get("/api/narrative/assets/:key", (req, res) => {
  const key = String(req.params.key ?? "");
  if (!isSafeEntryKeyFn(key)) {
    res.status(400).json({ error: "invalid entry key" });
    return;
  }
  // 只要条目目录在就答得出来：早于 _entry.json 的历史条目一样能确认定稿
  // （writeEntry 是 upsert，缺的那份配置由第一次确认补上）。
  if (!fs.existsSync(path.join(outputDir(), key))) {
    res.status(404).json({ error: "entry not found" });
    return;
  }
  const all = normalizeAssets(loadEntryConfig(key)?.assets);
  // 不带 pipelineId 时给全条目的（下游生成要的是"这个条目里哪些是定稿"）；
  // 带了则只给那条泳道，供界面按当前泳道打勾。
  const lane = req.query.pipelineId ?? req.query.pipeline_id;
  const pipelineId = typeof lane === "string" && lane.trim() ? lane.trim() : undefined;
  const assets = pipelineId ? all.filter((a) => a.pipelineId === pipelineId) : all;
  res.json({ entryKey: key, pipelineId, assets });
});

/**
 * G5：某份确认路径「当下」的版本号 —— 已有历史快照数 + 1（见 version-store.ts）。
 *
 * `assetPath` 是 `<group>/<相对路径>` 形态（与 `GET /files/:key` 同形）；按 group 找到
 * 对应的落盘根目录（主管线 vs. 该 pipelineId 的次管线用的是不同目录，见
 * `artifactRootsForAddress`），再用 group 之后的那段相对路径去查快照数。
 * group 未命中（比如 path 写错、或那条泳道压根没落过盘）时返回 `undefined`——
 * 调用方（confirm 端点）据此判断钉不了版本，而不是悄悄钉成 1。
 */
function resolveCurrentAssetVersion(
  entryKey: string,
  pipelineId: string | undefined,
  assetPath: string,
): number | undefined {
  const slash = assetPath.indexOf("/");
  if (slash < 0) return undefined;
  const group = assetPath.slice(0, slash);
  const relPath = assetPath.slice(slash + 1);
  if (!relPath) return undefined;
  const roots = artifactRootsForAddress({ entryKey, pipelineId });
  const root = roots.find((r) => r.group === group);
  if (!root) return undefined;
  return currentVersionNumber(root.dir, relPath);
}

app.post("/api/narrative/assets/:key", (req, res) => {
  const key = String(req.params.key ?? "");
  const body = req.body as {
    path?: string;
    pipelineId?: string;
    version?: number;
    /**
     * 就地读一次"现在是第几版"再钉住，而不是要调用方自己先查再传 version——
     * 两步之间若正好有一次编辑落盘，客户端传来的版本号就已经过期，会钉错一版。
     * 与显式 `version` 互斥：给了 `pinCurrent` 时以它为准，`version` 被忽略。
     */
    pinCurrent?: boolean;
    confirmed?: boolean;
  };
  if (!isSafeEntryKeyFn(key)) {
    res.status(400).json({ error: "invalid entry key" });
    return;
  }
  const target = body.path?.trim();
  if (!target) {
    res.status(400).json({ error: "path is required (`<group>/<相对路径>`)" });
    return;
  }
  if (!fs.existsSync(path.join(outputDir(), key))) {
    res.status(404).json({ error: "entry not found" });
    return;
  }
  const existing = loadEntryConfig(key)?.assets;
  // 泳道缺省 = 主管线；次管线的同名产物靠它与主管线分开。
  const pipelineId = body.pipelineId?.trim() || undefined;
  const version = body.pinCurrent ? resolveCurrentAssetVersion(key, pipelineId, target) : body.version;
  // confirmed 缺省视为确认：这个端点存在的理由就是确认，撤销要显式说。
  const assets =
    body.confirmed === false
      ? unconfirmAsset(existing, { path: target, pipelineId })
      : confirmAsset(existing, { path: target, pipelineId, version });
  try {
    writeEntryConfig(key, { assets });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
    return;
  }
  res.json({ entryKey: key, assets });
});

// ── 项目库：跨任务归档表（另一张正交的表，见 project-store.ts 头注） ──────────

app.get("/api/narrative/projects", (_req, res) => {
  res.json({ projects: listProjects() });
});

app.post("/api/narrative/projects", (req, res) => {
  const body = req.body as { title?: string; tags?: string[] };
  const title = body.title?.trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  res.json({ project: createProject({ title, tags: body.tags ?? [] }) });
});

app.patch("/api/narrative/projects/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isSafeProjectId(id)) {
    res.status(400).json({ error: "invalid project id" });
    return;
  }
  const body = req.body as ProjectPatch;
  const project = patchProject(id, body);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json({ project });
});

app.delete("/api/narrative/projects/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isSafeProjectId(id)) {
    res.status(400).json({ error: "invalid project id" });
    return;
  }
  res.json({ deleted: deleteProject(id) });
});

app.get("/api/narrative/file/:runId/{*filePath}", (req, res) => {
  const addr = addressFromRequest(req.params.runId, req.query as Record<string, unknown>);
  if (!addr) {
    res.status(400).json({ error: "Malformed artifact reference" });
    return;
  }
  const rawPath = (req.params as unknown as Record<string, unknown>).filePath;
  const relRaw = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath ?? "");

  const roots = artifactRootsForAddress(addr);
  // 首段为环节分组键 → 映射到对应根目录；否则回退 output（兼容历史的 output 相对路径）。
  const firstSeg = relRaw.split("/")[0];
  const matched = roots.find((r) => r.group === firstSeg);
  const baseDir =
    matched?.dir ??
    roots.find((r) => r.group === "output")?.dir ??
    path.join(outputDir(), artifactRunDir(addr));
  const relPath = matched ? relRaw.slice(firstSeg.length + 1) : relRaw;

  const fullPath = path.resolve(baseDir, relPath);
  if (fullPath !== baseDir && !fullPath.startsWith(baseDir + path.sep)) {
    res.status(403).json({ error: "Path traversal denied" });
    return;
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    if (fullPath.endsWith(".json")) {
      res.json(JSON.parse(content));
    } else {
      res.type("text/plain").send(content);
    }
  } catch {
    res.status(500).json({ error: "Failed to read file" });
  }
});

app.get("/api/narrative/stream/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let lastIndex = 0;
  let lastStreamIndex = 0;
  let heartbeatCounter = 0;
  const HEARTBEAT_EVERY = 30; // every 15s (30 * 500ms)

  // Phase-2 M8: 每帧带上管线锚点，前端多 lane 据此分流（同条目多管线各开一条 SSE）。
  const lane = {
    entryKey: state.entryKey,
    pipelineId: state.manifest?.pipelineId ?? state.pipelineId,
  };
  const writeFrame = (frame: unknown) => {
    res.write(`data: ${JSON.stringify({ ...lane, ...(frame as object) })}\n\n`);
  };

  const interval = setInterval(() => {
    while (lastIndex < state.progress.length) {
      writeFrame(state.progress[lastIndex]);
      lastIndex++;
      heartbeatCounter = 0;
    }
    while (lastStreamIndex < state.streamBuffer.length) {
      writeFrame(state.streamBuffer[lastStreamIndex]);
      lastStreamIndex++;
      heartbeatCounter = 0;
    }
    if (state.status !== "running") {
      writeFrame({ type: "done", status: state.status, error: state.error });
      clearInterval(interval);
      res.end();
      return;
    }
    heartbeatCounter++;
    if (heartbeatCounter >= HEARTBEAT_EVERY) {
      res.write(`: keepalive\n\n`);
      heartbeatCounter = 0;
    }
  }, 500);

  req.on("close", () => clearInterval(interval));
});

const MAX_RUN_AGE_MS = 30 * 60 * 1000;
const MAX_RUNNING_AGE_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of runs) {
    const age = now - new Date(state.startedAt).getTime();
    if (state.status !== "running" && age > MAX_RUN_AGE_MS) {
      runs.delete(id);
    } else if (state.status === "running" && age > MAX_RUNNING_AGE_MS) {
      state.status = "failed";
      state.error = "Pipeline timed out (exceeded 1 hour)";
    }
  }
}, 60_000);

function cleanupStaleRunningManifests(): void {
  // 这里只读不写，所以不能用 outputDir()——它调用即建目录，`existsSync` 因此
  // 永远为真，等于先把要找的东西造出来再说它在。这跑在 listen 回调里、早于任何
  // 请求，插件模式下还没有 slug，于是每次启动都在用户的工程根留一个空 output/。
  const root = path.join(resolveNarrativeRoot(), "output");
  if (!fs.existsSync(root)) return;
  let patched = 0;
  for (const dir of fs.readdirSync(root)) {
    const manifestPath = path.join(root, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (raw.status === "running") {
        raw.status = "interrupted";
        raw.completedAt = raw.updatedAt ?? new Date().toISOString();
        fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2));
        patched++;
      }
    } catch { /* ignore corrupted manifests */ }
  }
  if (patched > 0) {
    console.log(`🔧 Cleaned up ${patched} stale 'running' manifest(s) → 'interrupted'`);
  }
}

/**
 * IP DNA 端到端入口（蓝图 §5）：上传/指定文件 → 标准化 → IP DNA → 改编指令 → A→B 映射 →（可选）生成。
 * 同步返回（提取+映射通常秒级；run_generation=true 时会跑生成管线，可能较久）。
 *
 * 入参（JSON）：
 *   files: [{ file_name, content?, content_base64?, encoding?, file_type?, role? }]
 *   title?, mode?("single"|"series"), scope_full?(默认 true), target_units?,
 *   run_generation?(默认 false), max_game_units?, tier?, generation_mode?, complexity?, model?
 */
app.post("/api/narrative/ip-dna/start", async (req, res) => {
  const body = req.body as {
    files?: Array<{
      file_name?: string;
      content?: string;
      content_base64?: string;
      encoding?: "utf8" | "base64-docx";
      file_type?: string;
      role?: string;
    }>;
    title?: string;
    mode?: "single" | "series";
    scope_full?: boolean;
    /** 嵌套裁剪选择（§4.4 第①步对话产物）：提供则按精确选择裁剪，覆盖 scope_full。 */
    scope_selections?: import("../ip-dna/index.js").AdaptationScopeSelection[];
    /** 用户精确选填的游戏单元规划（§4.4 第②步对话产物）：提供则覆盖默认切分。 */
    game_unit_plan?: import("../ip-dna/index.js").GameUnitPlan;
    /** 用户精确选填的改编维度（§4.4 第③步对话产物）：提供则覆盖默认全维度模板。 */
    adaptation_dimensions?: Partial<import("../ip-dna/index.js").AdaptationDimensions>;
    /** 作者自定义改编补充说明（§5.1 自由文本）：合并进 directive.adaptation_notes 并追加下游 userInput。 */
    adaptation_notes?: string;
    /** 原作在这次改编里算什么：faithful / balanced / bold / creative，缺省 balanced。 */
    content_fidelity?: string;
    target_units?: number;
    run_generation?: boolean;
    max_game_units?: number;
    tier?: TierId;
    generation_mode?: ModeId;
    /** 路由组（planning/narrative）：ROUTING 透传（§5.1），与主管线 start 对齐。 */
    route_group?: "planning" | "narrative";
    /** 品类编码（如 "rpg-jrpg"/"adv-interactive"）：scoped 生成的路由依据（§5.1/§L）。 */
    genre_code?: string;
    complexity?: number;
    model?: string;
    /** 超体量时执行拆解闭环（§5.0 9→10→1）。默认 false。 */
    decompose?: boolean;
    /** 断点续传（§14.2）：复用已持久化 IP DNA，跳过重建+提取。默认 false。 */
    resume?: boolean;
    /** 为每个游戏单元装备三视角算子并一步消费（§7.2b）。默认 false。 */
    equip_operators?: boolean;
    /** 构建 KAG 关系网络并注入生成（§8）。默认 true。 */
    inject_relations?: boolean;
    /** 异步执行（§11）：true 则立即返回 jobId，后台跑管线，前端轮询 /ip-dna/job/:jobId。 */
    async?: boolean;
    /** 指定完整故事时间戳（续跑/对齐 jobId 用）；不传则服务端生成。 */
    story_timestamp?: string;
  };

  if (!body.files?.length) {
    res.status(400).json({ error: "files is required（至少一个文件，含 content 或 content_base64）" });
    return;
  }

  // 解析入站文件为中性 IncomingFile（docx 走 mammoth）。
  const incoming: IncomingFile[] = [];
  for (const f of body.files) {
    let data: string | Buffer = "";
    try {
      if (f.encoding === "base64-docx" && f.content_base64) {
        const buf = Buffer.from(f.content_base64, "base64");
        const mammoth = await import("mammoth");
        data = (await mammoth.extractRawText({ buffer: buf })).value ?? "";
      } else if (f.content != null) {
        data = f.content;
      } else if (f.content_base64) {
        data = Buffer.from(f.content_base64, "base64");
      }
    } catch (e) {
      console.warn(`[Server] ip-dna file parse failed: ${(e as Error).message}`);
    }
    incoming.push({
      fileName: f.file_name ?? `file_${incoming.length + 1}.txt`,
      data,
      fileType: f.file_type ?? "text/plain",
      role: f.role,
    });
  }

  // LLM 接缝：有 key 才走 LLM 提取，否则 orchestrator 自动用确定性兜底。
  const llm = (API_KEY || LLM_PROXY_URL)
    ? new LLMClient({
        apiKey: API_KEY || undefined,
        proxyUrl: LLM_PROXY_URL || undefined,
        defaultModel: body.model ?? getDefaultModel(),
      })
    : undefined;

  // 嵌套裁剪：有 selections 走精确选择；否则默认全量（scope_full=false 也仅在无 selections 时回退默认）。
  const scope = body.scope_selections?.length
    ? { full: false, selections: body.scope_selections }
    : { full: true };
  // 固定 story_timestamp，使 jobId 与 input/output 落盘对齐（续跑/轮询一致）。
  const fixedTimestamp = body.story_timestamp ?? formatIpDnaTimestamp(new Date().toISOString());

  // ROUTING 透传（§5.1/§L）：显式 genre_code 锁定生成管线品类。
  // 这里曾据品类模板再派生一个 rpg/vn「管线家族」往下传 —— 那是把 117 个品类压成 2 个桶，
  // 而品类本身已经透传了；没选品类时由编排器的 DEFAULT_ADAPTATION_GENRE 兜底。
  const explicitGenre = typeof body.genre_code === "string" && body.genre_code.trim().length > 0
    ? body.genre_code.trim()
    : undefined;

  const buildOptions = (onProgress?: (e: IpDnaProgress) => void, runtime?: Awaited<ReturnType<typeof resolveIpDnaRuntimeAdapters>>) => ({
    files: incoming,
    title: body.title,
    story_timestamp: fixedTimestamp,
    mode: body.mode,
    scope,
    gameUnitPlan: body.game_unit_plan,
    dimensions: body.adaptation_dimensions,
    adaptationNotes: typeof body.adaptation_notes === "string" ? body.adaptation_notes : undefined,
    contentFidelity: parseContentFidelity(body.content_fidelity),
    targetUnits: body.target_units,
    targetComplexity: body.complexity,
    llm,
    queryEmbedder: runtime?.queryEmbedder,
    frameSampler: runtime?.frameSampler,
    transcriber: runtime?.transcriber,
    mediaCompressor: runtime?.mediaCompressor,
    archiveExtractor: runtime?.archiveExtractor,
    pdfPageSplitter: runtime?.pdfPageSplitter,
    runGeneration: body.run_generation === true,
    decompose: body.decompose === true,
    resume: body.resume === true,
    equipOperators: body.equip_operators === true,
    injectRelations: body.inject_relations,
    maxGameUnits: body.max_game_units,
    tier: body.tier,
    generationMode: body.generation_mode,
    pipelineConfig: {
      apiKey: API_KEY || undefined,
      proxyUrl: LLM_PROXY_URL || undefined,
      model: body.model ?? getDefaultModel(),
      complexity: body.complexity,
      // 显式品类锁定生成管线模板（buildGenerationPipelineConfig 仅在未设时才用 family 代表品类兜底）。
      ...(explicitGenre ? { genreCode: explicitGenre } : {}),
    },
    onProgress,
  });

  const summarize = (result: Awaited<ReturnType<typeof runIpDnaPipeline>>) => ({
    story_timestamp: result.story_timestamp,
    title: result.title,
    media_type: result.manifest.media_type,
    node_count: Object.keys(result.dna.nodes).length,
    directive: result.directive,
    // D3 提取质量闸门（§14.2）：层级连通/三件套齐全/核心要素/五大类算子覆盖统计。
    // 非阻断，随结果透出供平台/前端展示与告警。
    extraction_quality: result.extractionQuality,
    game_units: result.gameUnits.map((gu) => ({
      index: gu.index,
      leaf_ids: gu.leafIds,
      operator_count: gu.operatorPool.length,
      generation_input: gu.generationInput,
      output_dir: gu.outputDir ? path.basename(gu.outputDir) : undefined,
      generated: !!gu.generated,
    })),
  });

  // ── 异步契约（§11）：立即返回 jobId，后台跑管线并经 updateJob 回写 stage/progress。──
  if (body.async === true) {
    const job = createJob({ story_timestamp: fixedTimestamp, stage: "pending" });
    res.status(202).json({ jobId: job.jobId, story_timestamp: fixedTimestamp, status: job.status });
    void (async () => {
      try {
        updateJob(job.jobId, { status: "running", stage: "phase0" });
        const runtime = await resolveIpDnaRuntimeAdapters(process.env);
        const result = await runIpDnaPipeline(buildOptions((e) => {
          updateJob(job.jobId, {
            status: "running",
            stage: e.phase,
            progress: Math.round((e.ratio ?? 0) * 100),
            message: e.message,
          });
        }, runtime));
        updateJob(job.jobId, { status: "completed", stage: "done", progress: 100, result: summarize(result) });
      } catch (e) {
        console.error("[Server] ip-dna async pipeline failed:", e);
        updateJob(job.jobId, { status: "failed", error: (e as Error).message });
      }
    })();
    return;
  }

  // ── 同步模式（默认，向后兼容现有调用方/工具桥）。──
  try {
    // RAG 生产接通（批2 h3）：与 CLI 共用 helper 注入本地向量化查询器 + 视频抽帧器。
    // 有 e5 模型/HTTP 端点 → 开 RAG vector 通道；无 → 静默降级 scope+tag（corpus 仍可用）。
    const runtime = await resolveIpDnaRuntimeAdapters(process.env);
    const result = await runIpDnaPipeline(buildOptions(undefined, runtime));
    res.json(summarize(result));
  } catch (e) {
    console.error("[Server] ip-dna pipeline failed:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 阶段门端点（§5.1 半自动）：ingest → hierarchy → (decompose) → confirm-scope/units → extract/generate。
// 每个阶段独立调用、落盘续跑；与 /ip-dna/start（全自动）共存。前端按钮与平台 agent 工具共用。
// ─────────────────────────────────────────────────────────────────

/** 解析入站文件为中性 IncomingFile（docx 走 mammoth；base64 二进制透传）。 */
async function parseIpDnaIncoming(
  files: Array<{ file_name?: string; content?: string; content_base64?: string; encoding?: "utf8" | "base64-docx"; file_type?: string; role?: string }>,
): Promise<IncomingFile[]> {
  const incoming: IncomingFile[] = [];
  for (const f of files) {
    let data: string | Buffer = "";
    try {
      if (f.encoding === "base64-docx" && f.content_base64) {
        const buf = Buffer.from(f.content_base64, "base64");
        const mammoth = await import("mammoth");
        data = (await mammoth.extractRawText({ buffer: buf })).value ?? "";
      } else if (f.content != null) {
        data = f.content;
      } else if (f.content_base64) {
        data = Buffer.from(f.content_base64, "base64");
      }
    } catch (e) {
      console.warn(`[Server] ip-dna file parse failed: ${(e as Error).message}`);
    }
    incoming.push({
      fileName: f.file_name ?? `file_${incoming.length + 1}.txt`,
      data,
      fileType: f.file_type ?? "text/plain",
      role: f.role,
    });
  }
  return incoming;
}

/** 构建 IP DNA LLM 接缝（有 key/proxy 才启用，否则确定性兜底）。 */
function ipDnaLlm(model?: string): LLMClient | undefined {
  return (API_KEY || LLM_PROXY_URL)
    ? new LLMClient({ apiKey: API_KEY || undefined, proxyUrl: LLM_PROXY_URL || undefined, defaultModel: model ?? getDefaultModel() })
    : undefined;
}

/** 各媒体在"最小叙事单元"层的叫法（§3.1b：层级对齐、叫法按媒体取词）。 */
function unitWord(media: NarrativeIpDna["media_type"]): string {
  return media === "picture" ? "话" : media === "video" ? "集" : "节";
}

/**
 * 由层级树构建"真实层级"摘要（root 以下，按深度排序 part→chapter→unit）——
 * 前端据此决定改编范围下拉**列数**与每列标题（不再用物理树深度硬猜，§3.1「层级才是抽象」）。
 */
function buildLevelsSummary(dna: NarrativeIpDna): Array<{ levelType: string; label: string; count: number }> {
  const labelOf = (lt: string): string =>
    lt === "complete" ? "完整作品" : lt === "part" ? "部/卷" : lt === "chapter" ? "章" : lt === "unit" ? unitWord(dna.media_type) : lt;
  // 含根（§"根+真实层级"）：levels[0]=complete 供前端范围裁剪首列（只读"完整作品"），其后为真实层级。
  const levels = ["complete", ...guessLevelsFromHierarchy(dna)];
  return levels.map((lt) => ({
    levelType: lt,
    label: labelOf(lt),
    count: Object.values(dna.nodes).filter((n) => n.levelType === lt).length,
  }));
}

/** 把 IngestResult 摘要成给 UI/agent 的可读结构（层级树 + 体量 + 默认裁剪/单元 + 干扰过滤）。 */
function summarizeIngest(ingest: Awaited<ReturnType<typeof runIngest>>) {
  return {
    story_timestamp: ingest.story_timestamp,
    run_id: `${ingest.story_timestamp}_${ingest.title}`,
    title: ingest.title,
    media_type: ingest.media_type,
    node_count: Object.keys(ingest.dna.nodes).length,
    structure_type: ingest.dna.structureType,
    aggregation_times: ingest.dna.aggregationTimes,
    levels: buildLevelsSummary(ingest.dna),
    hierarchy: Object.values(ingest.dna.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, displayName: n.displayName, lineage: n.lineage, parent: n.parent, children: n.children, childRange: n.childRange,
    })),
    volume: ingest.volume,
    decomposition: ingest.decomposition,
    noise_filtered: ingest.noise.filteredTitles,
    default_scope: ingest.defaultDirective.adaptation_scope,
    default_game_unit_plan: ingest.defaultDirective.game_unit_plan,
    default_dimensions: ingest.defaultDirective.dimensions,
    awaiting: "confirm-scope",
  };
}

/**
 * 阶段一：摄入 + 标准化 + 建树（§5 步骤 0→1→2），停在确认门。
 * async=true 立即返回 jobId（status=awaiting_confirmation，result=层级树摘要）；否则同步返回摘要。
 */
app.post("/api/narrative/ip-dna/ingest", async (req, res) => {
  const body = req.body as {
    files?: Array<{ file_name?: string; content?: string; content_base64?: string; encoding?: "utf8" | "base64-docx"; file_type?: string; role?: string }>;
    title?: string;
    decompose?: boolean;
    model?: string;
    async?: boolean;
    story_timestamp?: string;
  };
  if (!body.files?.length) {
    res.status(400).json({ error: "files is required（至少一个文件，含 content 或 content_base64）" });
    return;
  }
  const incoming = await parseIpDnaIncoming(body.files);
  const llm = ipDnaLlm(body.model);
  const fixedTimestamp = body.story_timestamp ?? formatIpDnaTimestamp(new Date().toISOString());
  const buildIngestOptions = (onProgress?: (e: IpDnaProgress) => void, runtime?: Awaited<ReturnType<typeof resolveIpDnaRuntimeAdapters>>) => ({
    files: incoming,
    title: body.title,
    story_timestamp: fixedTimestamp,
    decompose: body.decompose === true,
    llm,
    queryEmbedder: runtime?.queryEmbedder,
    frameSampler: runtime?.frameSampler,
    transcriber: runtime?.transcriber,
    mediaCompressor: runtime?.mediaCompressor,
    archiveExtractor: runtime?.archiveExtractor,
    pdfPageSplitter: runtime?.pdfPageSplitter,
    // §状态机重构 / 成本可控：半自动 UI 的标准化阶段零 LLM——多模态转写推迟到「开始生成」。
    // 大批量上传时不在标准化就动用 AI 分析（避免不可控成本）；纯文本 IP 本就是纯算法建树。
    deferMultimodal: true,
    onProgress,
  });

  if (body.async === true) {
    const job = createJob({ story_timestamp: fixedTimestamp, stage: "pending" });
    res.status(202).json({ jobId: job.jobId, story_timestamp: fixedTimestamp, status: job.status });
    void (async () => {
      try {
        updateJob(job.jobId, { status: "running", stage: "phase0" });
        const runtime = await resolveIpDnaRuntimeAdapters(process.env);
        const ingest = await runIngest(buildIngestOptions((e) => {
          updateJob(job.jobId, { status: "running", stage: e.phase, progress: Math.round((e.ratio ?? 0) * 100), message: e.message });
        }, runtime));
        updateJob(job.jobId, { status: "awaiting_confirmation", stage: "standardized", progress: 40, message: "标准化完成，等待确认裁剪范围", result: summarizeIngest(ingest) });
      } catch (e) {
        console.error("[Server] ip-dna ingest failed:", e);
        updateJob(job.jobId, { status: "failed", error: (e as Error).message });
      }
    })();
    return;
  }

  try {
    const runtime = await resolveIpDnaRuntimeAdapters(process.env);
    const ingest = await runIngest(buildIngestOptions(undefined, runtime));
    res.json(summarizeIngest(ingest));
  } catch (e) {
    console.error("[Server] ip-dna ingest failed:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * §状态机 / IP「确认」即落盘（零 LLM）：把用户上传的原料先固化到 input/<媒体>/<故事类型>/<时间戳_标题>/，
 * 写 user_asset_manifest.json，**不做**标准化/建树/提取（推迟到「开始生成」）。同步返回 { story_timestamp, run_id, title }，
 * 前端据 run_id 桥接到 output 条目的 _entry.json.ipRunKey。复用传入的 entry_key 作 story_timestamp，使重确认同键覆盖幂等。
 */
app.post("/api/narrative/ip-dna/package", async (req, res) => {
  const body = req.body as {
    files?: Array<{ file_name?: string; content?: string; content_base64?: string; encoding?: "utf8" | "base64-docx"; file_type?: string; role?: string }>;
    title?: string;
    story_timestamp?: string;
  };
  if (!body.files?.length) {
    res.status(400).json({ error: "files is required（至少一个文件，含 content 或 content_base64）" });
    return;
  }
  const incoming = await parseIpDnaIncoming(body.files);
  const fixedTimestamp = body.story_timestamp ?? formatIpDnaTimestamp(new Date().toISOString());
  try {
    const runtime = await resolveIpDnaRuntimeAdapters(process.env);
    const ingest = await runIngest({
      files: incoming,
      title: body.title,
      story_timestamp: fixedTimestamp,
      archiveExtractor: runtime?.archiveExtractor,
      pdfPageSplitter: runtime?.pdfPageSplitter,
      // 零 LLM：仅打包落盘，标准化/多模态转写/提取整体推迟到「开始生成」。
      deferMultimodal: true,
      packageOnly: true,
    });
    res.json({
      story_timestamp: ingest.story_timestamp,
      run_id: `${ingest.story_timestamp}_${ingest.title}`,
      title: ingest.title,
    });
  } catch (e) {
    console.error("[Server] ip-dna package failed:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

/** 只读：层级树 + 默认裁剪/单元/维度 + 体量/拆解建议（供 UI/agent 引导确认裁剪范围）。 */
app.get("/api/narrative/ip-dna/:runId/hierarchy", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const directive = buildAdaptationDirective(source.dna, {});
  const volume = assessVolume(source.fullText, { mediaType: source.media_type, unitCount: collectLeafIds(source.dna).length });
  const confirmation = loadAdaptationConfirmation(source.story_timestamp, source.title) ?? {};
  res.json({
    story_timestamp: source.story_timestamp,
    run_id: req.params.runId,
    title: source.title,
    media_type: source.media_type,
    node_count: Object.keys(source.dna.nodes).length,
    structure_type: source.dna.structureType,
    aggregation_times: source.dna.aggregationTimes,
    levels: buildLevelsSummary(source.dna),
    hierarchy: Object.values(source.dna.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, displayName: n.displayName, lineage: n.lineage, parent: n.parent, children: n.children, childRange: n.childRange,
    })),
    volume,
    default_scope: directive.adaptation_scope,
    default_game_unit_plan: directive.game_unit_plan,
    default_dimensions: directive.dimensions,
    confirmation,
  });
});

/** 拆解（§5 步骤 6-10）：体量超线时按标记/单元闭环拆解 → 再标准化 → 重写骨架层级树。 */
app.post("/api/narrative/ip-dna/:runId/decompose", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const volume = assessVolume(source.fullText, { mediaType: source.media_type, unitCount: collectLeafIds(source.dna).length });
  const plan = planDecomposition(source.fullText, volume, true);
  const closure = applyDecompositionClosure(source.dna, source.fullText, true);
  try { saveHierarchyIndexOnly(source.dna, {}); } catch { /* 落盘失败不阻断 */ }
  res.json({
    run_id: req.params.runId,
    decomposed: plan.decomposed,
    chunk_count: plan.chunks.length,
    closure,
    node_count: Object.keys(source.dna.nodes).length,
    structure_type: source.dna.structureType,
    aggregation_times: source.dna.aggregationTimes,
    levels: buildLevelsSummary(source.dna),
    hierarchy: Object.values(source.dna.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, displayName: n.displayName, lineage: n.lineage, parent: n.parent, children: n.children, childRange: n.childRange,
    })),
  });
});

/** ① 确认裁剪范围（§4.4 第①步）：回填 scope_selections（嵌套层级选择），缺省=全量。 */
app.post("/api/narrative/ip-dna/:runId/confirm-scope", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const body = req.body as {
    scope_selections?: unknown[];
    scope_full?: boolean;
    adaptation_notes?: string;
    content_fidelity?: string;
  };
  const notes = typeof body.adaptation_notes === "string" ? body.adaptation_notes.trim() : "";
  const merged = saveAdaptationConfirmation(source.story_timestamp, source.title, {
    scope_selections: body.scope_selections ?? [],
    scope_full: body.scope_full ?? !(body.scope_selections && body.scope_selections.length > 0),
    ...(notes ? { adaptation_notes: notes } : {}),
  });
  res.json({ run_id: req.params.runId, confirmation: merged, awaiting: "confirm-units" });
});

/** ② 确认游戏单元 + 改编维度（§4.4 第②③步）：回填 game_unit_plan / adaptation_dimensions / mode。 */
app.post("/api/narrative/ip-dna/:runId/confirm-units", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const body = req.body as { game_unit_plan?: unknown; adaptation_dimensions?: unknown; mode?: "single" | "series"; target_units?: number; target_output?: import("../ip-dna/index.js").TargetOutput };
  const merged = saveAdaptationConfirmation(source.story_timestamp, source.title, {
    game_unit_plan: body.game_unit_plan,
    adaptation_dimensions: body.adaptation_dimensions,
    mode: body.mode,
    target_units: body.target_units,
    // P0-1（§4.4d）：持久化目标输出形态（品类/管线/模式/复杂度），extract/generate 消费为 family/mode 兜底。
    target_output: body.target_output,
  });
  res.json({ run_id: req.params.runId, confirmation: merged, awaiting: "extract|generate" });
});

/** 构建 extract/generate 阶段的编排选项（消费已确认态 + 生成控制）。 */
function buildStageExtractOptions(
  source: ExtractSource,
  body: { run_generation?: boolean; genre_code?: string; tier?: TierId; generation_mode?: ModeId; complexity?: number; model?: string; max_game_units?: number; equip_operators?: boolean; inject_relations?: boolean },
  onProgress?: (e: IpDnaProgress) => void,
  runtime?: Awaited<ReturnType<typeof resolveIpDnaRuntimeAdapters>>,
) {
  const c = loadAdaptationConfirmation(source.story_timestamp, source.title) ?? {};
  const targetOutput = c.target_output as import("../ip-dna/index.js").TargetOutput | undefined;
  const selections = (c.scope_selections as import("../ip-dna/index.js").AdaptationScopeSelection[] | undefined) ?? [];
  const scope = selections.length ? { full: false, selections } : { full: true };
  const llm = ipDnaLlm(body.model);
  // ROUTING/target_output 透传（§5.1/§L/§4.4d）：品类优先 body → 确认态 target_output；
  // 两处都没有时由编排器的 DEFAULT_ADAPTATION_GENRE 兜底。品类直接往下传，不再压成家族桶。
  const explicitGenre =
    (typeof body.genre_code === "string" && body.genre_code.trim().length > 0 ? body.genre_code.trim() : undefined) ??
    (typeof targetOutput?.genre_code === "string" && targetOutput.genre_code.trim().length > 0 ? targetOutput.genre_code.trim() : undefined);
  return {
    files: [] as IncomingFile[],
    title: source.title,
    story_timestamp: source.story_timestamp,
    mode: (c.mode as "single" | "series" | undefined),
    scope,
    gameUnitPlan: c.game_unit_plan as import("../ip-dna/index.js").GameUnitPlan | undefined,
    dimensions: c.adaptation_dimensions as Partial<import("../ip-dna/index.js").AdaptationDimensions> | undefined,
    adaptationNotes: c.adaptation_notes as string | undefined,
    contentFidelity: parseContentFidelity(c.content_fidelity),
    targetUnits: c.target_units as number | undefined,
    targetComplexity: body.complexity ?? targetOutput?.complexity,
    llm,
    queryEmbedder: runtime?.queryEmbedder,
    frameSampler: runtime?.frameSampler,
    transcriber: runtime?.transcriber,
    mediaCompressor: runtime?.mediaCompressor,
    archiveExtractor: runtime?.archiveExtractor,
    pdfPageSplitter: runtime?.pdfPageSplitter,
    runGeneration: body.run_generation === true,
    equipOperators: body.equip_operators === true,
    injectRelations: body.inject_relations,
    maxGameUnits: body.max_game_units,
    tier: body.tier,
    generationMode: body.generation_mode ?? (targetOutput?.generation_mode as ModeId | undefined),
    pipelineConfig: {
      apiKey: API_KEY || undefined,
      proxyUrl: LLM_PROXY_URL || undefined,
      model: body.model ?? getDefaultModel(),
      complexity: body.complexity ?? targetOutput?.complexity,
      // 显式品类锁定生成模板（buildGenerationPipelineConfig 仅在未设时才用 family 代表品类兜底）。
      ...(explicitGenre ? { genreCode: explicitGenre } : {}),
    },
    onProgress,
  };
}

const summarizeExtractGenerate = (result: Awaited<ReturnType<typeof runExtractAndGenerate>>) => ({
  story_timestamp: result.story_timestamp,
  title: result.title,
  media_type: result.manifest.media_type,
  node_count: Object.keys(result.dna.nodes).length,
  directive: result.directive,
  extraction_quality: result.extractionQuality,
  game_units: result.gameUnits.map((gu) => ({
    index: gu.index,
    leaf_ids: gu.leafIds,
    operator_count: gu.operatorPool.length,
    generation_input: gu.generationInput,
    output_dir: gu.outputDir ? path.basename(gu.outputDir) : undefined,
    generated: !!gu.generated,
  })),
});

/**
 * ipgen SSE run 完成收尾产物选取（C1）：取【末个已生成单元】的 generated 作为该 run 的 result
 * （与用户观看铺开的最后一棵叙事图一致），并取首个有 outputDir 的单元回填 output 目录。
 * 抽为纯函数便于单测——server 模块顶层会 app.listen，不宜整体拉起做 HTTP 测。
 */
export function pickIpGenRunOutcome(
  gameUnits: Awaited<ReturnType<typeof runExtractAndGenerate>>["gameUnits"],
): { result?: NarrativeContext; outputDir?: string } {
  const result = [...gameUnits].reverse().find((g) => g.generated)?.generated;
  const outputDir = gameUnits.find((g) => g.outputDir)?.outputDir;
  return { result, outputDir };
}

/** ③ 生成 scoped IP DNA（§5 步骤 4，run_generation=false）：仅提取，不跑下游生成。 */
app.post("/api/narrative/ip-dna/:runId/extract", async (req, res) => {
  await runStageExtractGenerate(req, res, false);
});

/** 开始生成（§5 步骤 4→5）：提取(=4 生成 scoped IP DNA) + 下游生成自动串跑，run_generation=true。 */
app.post("/api/narrative/ip-dna/:runId/generate", async (req, res) => {
  await runStageExtractGenerate(req, res, true);
});

/** extract/generate 共用执行体（async 走 job，同步直接返回摘要）。 */
async function runStageExtractGenerate(req: express.Request, res: express.Response, runGeneration: boolean): Promise<void> {
  const runId = String(req.params.runId);
  const source = loadExtractSourceByRun(runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${runId}（请先 ingest + confirm）` });
    return;
  }
  const body = { ...(req.body ?? {}), run_generation: runGeneration } as Parameters<typeof buildStageExtractOptions>[1];
  if ((req.body ?? {}).async === true) {
    const job = createJob({ story_timestamp: source.story_timestamp, stage: "phase2b_adapt" });
    // §图2：当本次会跑下游生成（runGeneration）时，为下游叙事管线注册一个正式 SSE run。
    // 前端拿到 generationRunId 后 startNewRun 挂载 SSE，即可在 ip_* 前驱步之后继续显示
    // 下游 pipeline_steps_announce 铺开的叙事节点与逐步进度，跑完由 done 帧收尾——
    // 此前下游 pipeline.run() 在进程内静默跑、无 SSE，UI 永远只见 ip_dna_extract 且卡在「生成中」。
    const genRunId = runGeneration
      ? `ipgen_${source.story_timestamp}_${Math.random().toString(36).slice(2, 8)}`
      : undefined;
    let genState: RunState | undefined;
    if (genRunId) {
      genState = {
        id: genRunId,
        status: "running",
        progress: [],
        streamBuffer: [],
        startedAt: new Date().toISOString(),
        tier: body.tier,
        mode: body.generation_mode,
      };
      runs.set(genRunId, genState);
    }
    res.status(202).json({ jobId: job.jobId, story_timestamp: source.story_timestamp, status: job.status, generationRunId: genRunId });
    void (async () => {
      try {
        updateJob(job.jobId, { status: "running", stage: "phase2b_adapt" });
        const runtime = await resolveIpDnaRuntimeAdapters(process.env);
        const baseOpts = buildStageExtractOptions(source, body, (e) => {
          updateJob(job.jobId, { status: "running", stage: e.phase, progress: Math.round((e.ratio ?? 0) * 100), message: e.message });
        }, runtime);
        const opts = genState
          ? {
              ...baseOpts,
              onGenerationProgress: (p: PipelineProgress) => {
                if (p.type === "streaming") genState!.streamBuffer.push(p);
                else genState!.progress.push(p);
                capturePipelineSteps(genState!, p);
              },
            }
          : baseOpts;
        const result = await runExtractAndGenerate(opts, source);
        updateJob(job.jobId, { status: "completed", stage: "done", progress: 100, result: summarizeExtractGenerate(result) });
        if (genState) {
          // §图2 / 多单元收尾：把末单元生成产物写入 ipgen run 的 result（与用户观看铺开的最后一棵叙事图一致），
          // 并回填 output 目录。此前只置 status 不写 result，前端 done 时 fetchResult 取不到 result → 误报
          // "Result unavailable" 卡「生成中」；多单元整体汇总仍由 job.result.game_units 在提取卡展示。
          const outcome = pickIpGenRunOutcome(result.gameUnits);
          if (outcome.result) genState.result = outcome.result;
          if (outcome.outputDir) genState.outputDir = outcome.outputDir;
          genState.status = "completed";
        }
      } catch (e) {
        console.error("[Server] ip-dna extract/generate failed:", e);
        updateJob(job.jobId, { status: "failed", error: (e as Error).message });
        if (genState) { genState.status = "failed"; genState.error = (e as Error).message; }
      }
    })();
    return;
  }
  try {
    const runtime = await resolveIpDnaRuntimeAdapters(process.env);
    const opts = buildStageExtractOptions(source, body, undefined, runtime);
    const result = await runExtractAndGenerate(opts, source);
    res.json(summarizeExtractGenerate(result));
  } catch (e) {
    console.error("[Server] ip-dna extract/generate failed:", e);
    res.status(500).json({ error: (e as Error).message });
  }
}

/** 异步任务轮询（§11）：返回 status/progress/current_stage + 完成后的 result 摘要。 */
app.get("/api/narrative/ip-dna/job/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `未找到任务：${req.params.jobId}` });
    return;
  }
  res.json({
    jobId: job.jobId,
    story_timestamp: job.story_timestamp,
    status: job.status,
    current_stage: job.stage,
    progress: job.progress,
    message: job.message,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    result: job.status === "completed" || job.status === "awaiting_confirmation" ? job.result : undefined,
  });
});

/** 取消生产（§5.1）：标记任务 cancelled，前端/agent 轮询据此终止释放（协作式取消）。 */
app.post("/api/narrative/ip-dna/job/:jobId/cancel", (req, res) => {
  const job = cancelJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `未找到任务：${req.params.jobId}` });
    return;
  }
  res.json({ jobId: job.jobId, status: job.status });
});

/** 只读：按 runId 读取 IP DNA 层级树摘要（前端审阅/可视化，不可写，§10）。 */
app.get("/api/narrative/ip-dna/:runId", (req, res) => {
  const index = loadHierarchyIndexByRun(req.params.runId);
  if (!index) {
    res.status(404).json({ error: `未找到 IP DNA：${req.params.runId}（input/<runId>/_extraction_output/_hierarchy.json 不存在）` });
    return;
  }
  res.json({
    story_id: index.story_id,
    title: index.title,
    media_type: index.media_type,
    node_count: Object.keys(index.nodes).length,
    hierarchy: Object.values(index.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, parent: n.parent, childRange: n.childRange,
    })),
  });
});

// 改写影响面分析（§10/§15）：定点改动 → 沿 data-atlas 推导受影响下游 + 受影响输入层级节点。
// body: { runId: string, changedKeys: string[] }
app.post("/api/narrative/ip-dna/analyze-impact", (req, res) => {
  const { runId, changedKeys } = (req.body ?? {}) as { runId?: string; changedKeys?: string[] };
  if (!Array.isArray(changedKeys) || changedKeys.length === 0) {
    res.status(400).json({ error: "缺少 changedKeys（atlas 字段 key 数组，如 ['A.characters']）" });
    return;
  }
  const dna = runId ? loadHierarchyIndexByRun(runId) : undefined;
  const impact = analyzeRewriteImpact(changedKeys, dna);
  res.json({ runId: runId ?? null, ...impact });
});

// ─────────────────────────────────────────────────────────────────
// 自定义专属创作团队
//
// 事实源在后端（input/custom_teams/<id>.json），不在浏览器 localStorage：
// 蒸馏跑在后端、注入也发生在后端，profile 若只存在浏览器里，生成时读不到，
// 那这条链就是断的（前端 customTeams.ts 的注释此前正是这个状态）。
// ─────────────────────────────────────────────────────────────────

/** 团队记录出站形状：profile 只在 ready 时有值，前端据 status 决定能不能选它。 */
function summarizeTeam(record: TeamRecord) {
  return {
    id: record.id,
    kind: record.kind,
    source: record.source,
    displayName: teamDisplayName(record),
    books: record.books.map((b) => ({
      bookUid: b.bookUid,
      title: b.title,
      files: b.files,
      ipDnaRunId: b.ipDnaRunId ?? null,
    })),
    authorMaterials: record.authorMaterials,
    useEncyclopedia: record.useEncyclopedia,
    status: record.status,
    errorMessage: record.errorMessage ?? null,
    profile: record.profile ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * 按路径参数取团队；取不到就把响应写完并回 undefined。
 *
 * id 直接参与文件名，store 对非法 id 抛错以挡路径穿越；不在这里先判一次的话，
 * `GET /teams/..%2Fetc` 会走成 500 + 一整页 HTML 堆栈（把源码路径抖给调用方），
 * 而这本该是一条 400。
 */
function requireTeam(req: express.Request, res: express.Response): TeamRecord | undefined {
  const id = String(req.params.id ?? "");
  if (!isSafeTeamId(id)) {
    res.status(400).json({ error: `非法团队 id: ${id}` });
    return undefined;
  }
  const record = loadTeam(id);
  if (!record) {
    res.status(404).json({ error: `团队不存在: ${id}` });
    return undefined;
  }
  return record;
}

app.get("/api/narrative/teams", (_req, res) => {
  res.json({ teams: listTeams().map(summarizeTeam) });
});

app.get("/api/narrative/teams/:id", (req, res) => {
  const record = requireTeam(req, res);
  if (record) res.json(summarizeTeam(record));
});

/**
 * 建团队（status=draft）。
 *
 * books 是**用户显式声明**的书籍分组：`[{ title, files }]`。不接受"给一堆文件让后端猜
 * 哪些是同一本书"——`unit-identity` 只能解析单部作品内的章节序号，跨书归组它推不出来，
 * 猜错会把多本书的风格搅成一团且不报错（详见 custom-team/types.ts）。
 */
app.post("/api/narrative/teams", (req, res) => {
  const body = (req.body ?? {}) as {
    kind?: TeamKind;
    source?: string;
    books?: Array<{ title?: string; files?: string[] }>;
    author_materials?: string[];
    use_encyclopedia?: boolean;
  };
  if (body.kind !== "book_template" && body.kind !== "author_advisor") {
    res.status(400).json({ error: "kind 必须是 book_template 或 author_advisor" });
    return;
  }
  if (!body.source?.trim()) {
    res.status(400).json({ error: "source 必填（单本蒸馏填书名，全维度蒸馏填作者名）" });
    return;
  }
  const books = (body.books ?? [])
    .filter((b) => b.title?.trim())
    .map((b) => ({ title: b.title!.trim(), files: b.files ?? [] }));
  // 单本蒸馏至少要一本书；作者蒸馏可以先只登记作者资料，之后再加书。
  if (body.kind === "book_template" && books.length === 0) {
    res.status(400).json({ error: "单本蒸馏需要声明一本书（books[0].title）" });
    return;
  }
  try {
    const record = createTeam({
      kind: body.kind,
      source: body.source,
      books,
      authorMaterials: body.author_materials,
      useEncyclopedia: body.use_encyclopedia,
    });
    res.status(201).json(summarizeTeam(record));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete("/api/narrative/teams/:id", (req, res) => {
  if (!requireTeam(req, res)) return;
  deleteTeam(req.params.id);
  res.json({ id: req.params.id, deleted: true });
});

/**
 * 起蒸馏：收材料本体 → 复用 IP 提炼管线逐书提炼 → 蒸馏成 profile。
 *
 * 一律异步（202 + 轮询 GET /teams/:id）：一本书的提炼是几十次 LLM 调用起步，
 * 同步等待必然超时，而超时后用户看到的是失败、后台却还在跑。
 *
 * 请求体的 files 携带文件本体（与 ip-dna 端点同形），按 `book_title` 归到声明的分组下；
 * 不带 book_title 的按作者资料处理（2.4.2）。
 */
app.post("/api/narrative/teams/:id/distil", async (req, res) => {
  const record = requireTeam(req, res);
  if (!record) return;
  if (record.status === "distilling") {
    res.status(409).json({ error: "这个团队正在蒸馏中" });
    return;
  }
  const body = (req.body ?? {}) as {
    model?: string;
    files?: Array<{
      file_name?: string;
      content?: string;
      content_base64?: string;
      encoding?: "utf8" | "base64-docx";
      file_type?: string;
      role?: string;
      /** 这份材料归到哪本书；缺省视为作者本人资料。 */
      book_title?: string;
    }>;
  };

  const llm = ipDnaLlm(body.model);
  if (!llm) {
    res.status(503).json({ error: "没有可用的模型接缝（缺 API key 或代理），蒸馏无法进行" });
    return;
  }

  const incoming = await parseIpDnaIncoming(body.files ?? []);
  // 按用户声明的书名归组：分组是声明来的，这里只做归位，不做任何推测。
  const byBook = new Map<string, IncomingFile[]>();
  const authorFiles: IncomingFile[] = [];
  (body.files ?? []).forEach((raw, i) => {
    const file = incoming[i];
    if (!file) return;
    const title = raw.book_title?.trim();
    if (!title) {
      authorFiles.push(file);
      return;
    }
    const arr = byBook.get(title);
    if (arr) arr.push(file);
    else byBook.set(title, [file]);
  });

  const updated = saveTeam({
    ...record,
    // 本次带来的材料补进分组清单，让 draft 期登记的文件名与真收到的对齐。
    books: record.books.map((b) => {
      const files = byBook.get(b.title);
      if (!files) return b;
      return { ...b, files: [...new Set([...b.files, ...files.map((f) => f.fileName)])] };
    }),
    authorMaterials: [...new Set([...record.authorMaterials, ...authorFiles.map((f) => f.fileName)])],
  });

  res.status(202).json({ ...summarizeTeam(updated), status: "distilling" });

  void (async () => {
    try {
      await distillTeam(updated, {
        llm,
        extractBook: createBookExtractor({
          llm,
          provideFiles: (book) => byBook.get(book.title) ?? [],
        }),
        retrieveAuthorInfo: createAuthorInfoRetriever(llm),
        readAuthorMaterials: async () =>
          authorFiles
            .map((f) => `### ${f.fileName}\n${typeof f.data === "string" ? f.data : f.data.toString("utf8")}`)
            .join("\n\n"),
      });
    } catch (e) {
      // distillTeam 自己会落 failed；这里只兜住它本身抛出的意外。
      console.error("[Server] team distil failed:", e);
      markFailed(updated.id, (e as Error).message);
    }
  })();
});

/**
 * 独立模式下自己供界面。
 *
 * Studio 里界面是宿主挂的（清单 `entry: ./viz/dist/index.html`），这个 app 压根
 * 不存在；插件模式下没有宿主来挂，于是 `open` 给出的地址会 404 —— 服务活着、
 * 地址对着、点进去一片空白，这是最难自查的一种坏法。
 *
 * 放在所有 /api 路由之后：静态目录不该抢已注册的接口。兜底只回 index.html，
 * 让前端路由自己认路，但不接管 /api —— 那样会把接口打错的 404 变成一份 HTML。
 */
const vizDir = fileURLToPath(new URL("../../viz/dist/", import.meta.url));
if (fs.existsSync(path.join(vizDir, "index.html"))) {
  app.use(express.static(vizDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(vizDir, "index.html")));
}

// 测试环境（vitest）下不真正监听端口，使 server 模块可被单测 import（如 pickIpGenRunOutcome）。
// 探针先跑完再开始应答：先说「我好了」再去发现自己借不到模型，等于把第一个
// 提问的人推进那条不通的路。代价是启动多等一次进程启动的时间。
if (!process.env.VITEST) void checkHostAgent().then(() => app.listen(PORT, () => {
  cleanupStaleRunningManifests();
  console.log(`🚀 Narrative Studio API v${packageVersion()} running on http://localhost:${PORT}`);
  if (fs.existsSync(path.join(vizDir, "index.html"))) {
    console.log(`   UI:         GET  / (authoring interface)`);
  } else {
    // 说出来，否则 `open` 会递一个 404 的地址而没人知道为什么。
    console.log(`   UI:         not bundled — \`open\` will hand out an address that 404s`);
  }
  console.log(`   Health:     GET  /api/health`);
  console.log(`   Modes:      GET  /api/narrative/modes`);
  console.log(`   Start:      POST /api/narrative/start`);
  console.log(`   IP DNA:     POST /api/narrative/ip-dna/start`);
  console.log(`   IP DNA Job: GET  /api/narrative/ip-dna/job/:jobId`);
  console.log(`   Resume:     POST /api/narrative/resume`);
  console.log(`   Nodes:      GET  /api/narrative/pipeline-nodes/:id`);
  console.log(`   Export:     POST /api/narrative/export/:id`);
  console.log(`   History:    GET  /api/narrative/history`);
  console.log(`   Files:      GET  /api/narrative/files/:runId`);
  console.log(`   File:       GET  /api/narrative/file/:runId/:filePath(*)`);
}));

// 仅供单测直接验证键权层方案 M4（终态跃迁单一写入口），不作为 HTTP 契约的一部分。
export { applyRunTransition, finalizeRunManifest, initRunManifest, writeManifestIncremental };
export type { RunState, RunTransitionEvent };

// 仅供单测直接验证键权层方案 M5（历史状态判定决策树 + 多泳道聚合），不作为 HTTP 契约的一部分。
export { resolveHistoryStatus, aggregateLaneStatuses };

export { app };
