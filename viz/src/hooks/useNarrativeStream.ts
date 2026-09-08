import { useEffect, useRef, useCallback } from "react";
import { useNarrativeStore } from "../store/narrativeStore";
import type {
  PipelineProgress,
  RunStartResponse,
  RunResultResponse,
  NarrativeContext,
  TierId,
  ModeId,
  TierModeInfo,
} from "../types";

export const API_BASE = "";

/** Fetch available tiers and modes from the API */
export async function fetchModes(): Promise<TierModeInfo[]> {
  const res = await fetch(`${API_BASE}/api/narrative/modes`);
  if (!res.ok) throw new Error(`Failed to fetch modes: ${res.status}`);
  return res.json();
}

/**
 * A1-4 / A2-1: 品类目录类型（与后端 GET /api/narrative/genres 对齐）。
 * 仅暴露 UI 需要的字段；needs 矩阵预留给后续灰显方案 B 使用。
 */
export interface GenreInfo {
  code: string;
  name: string;
  tier: TierId;
  narrative_ratio: string;
  narrative_type: string;
  /** @deprecated 旧 step 模板（tpl-*）；四期起该品类实际跑的是 narrative_pipeline。 */
  pipeline_template: string;
  /** 该品类实际会跑的席位管线 id（如 pl-film-game）。 */
  narrative_pipeline?: string;
  /** 席位管线名（如「叙事管线（分镜）」）。 */
  narrative_pipeline_name?: string;
  /** 专家显示名（与顶栏「{品类}专家」同一构词，由后端给以免两处漂）。 */
  expert_name?: string;
  needs: Record<string, 0 | 1 | 2 | 3>;
  keywords: string[];
}

export interface GenreCategoryGroup {
  category: string;
  label: string;
  genres: GenreInfo[];
}

/** A1-4: 拉取按 15 大类分组的品类目录。 */
export async function fetchGenres(locale?: string): Promise<GenreCategoryGroup[]> {
  const loc = locale === "en" ? "en" : "zh";
  const res = await fetch(`${API_BASE}/api/narrative/genres?locale=${loc}`);
  if (!res.ok) throw new Error(`Failed to fetch genres: ${res.status}`);
  const body = (await res.json()) as { categories: GenreCategoryGroup[] };
  return body.categories ?? [];
}

/**
 * 三轴词表（与后端 GET /api/narrative/axes 对齐）。
 * 词表只有后端一份，前端不再抄写，避免两处各改一半。
 */
export interface AxisOption {
  code: string;
  name: string;
  nameEn?: string;
  summary?: string;
  traits?: string;
}

export interface NarrativeAxesCatalog {
  types: AxisOption[];
  themes: AxisOption[];
  structures: AxisOption[];
}

export async function fetchNarrativeAxes(): Promise<NarrativeAxesCatalog> {
  const res = await fetch(`${API_BASE}/api/narrative/axes`);
  if (!res.ok) throw new Error(`Failed to fetch axes: ${res.status}`);
  const body = (await res.json()) as Partial<NarrativeAxesCatalog>;
  return { types: body.types ?? [], themes: body.themes ?? [], structures: body.structures ?? [] };
}

/** @deprecated A1: derived from (tier, mode, genre_code) instead. Kept as type alias for migration. */
export type RoutingMode = "auto" | "semi" | "manual";

/**
 * 上传剧本载荷。
 * - .txt：浏览器 file.text() → 直接走 content（utf8 字符串）
 * - .docx：浏览器 file.arrayBuffer() → base64 → 走 content_base64，由 backend mammoth 解析（M1.8）
 */
export interface UploadedScriptPayload {
  content?: string;
  content_base64?: string;
  encoding?: "utf8" | "base64-docx";
  file_name?: string;
  size?: number;
  mime?: string;
}

/** Start a new narrative generation run */
export async function startRun(
  userInput: string,
  opts: {
    tier?: TierId;
    mode?: ModeId;
    autoDetect?: boolean;
    model?: string;
    complexity?: number;
    routeGroup?: "planning" | "narrative";
    routingMode?: RoutingMode;
    genreCode?: string;
    /** 三轴路由（PRD v1.4 §3.2.2）；结构缺省由后端综合推导。 */
    storyType?: string | null;
    storyTheme?: string | null;
    narrativeStructure?: string | null;
    uploadedScript?: UploadedScriptPayload;
    /** UI locale for generated narrative content (en/zh). */
    locale?: string;
    /** §条目提前建立：复用首次输入确认时铸造的草稿键，使生成产物落回同一条目目录。 */
    entryKey?: string;
    /** G1：预演 /plan 铸出的 pipelineId，给了就沿用，避免 /start 运行期再现铸一个。 */
    pipelineId?: string;
  } = {},
): Promise<RunStartResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_input: userInput,
      tier: opts.tier,
      mode: opts.mode,
      auto_detect: opts.autoDetect,
      model: opts.model,
      complexity: opts.complexity,
      route_group: opts.routeGroup,
      routing_mode: opts.routingMode,
      genre_code: opts.genreCode,
      story_type: opts.storyType ?? undefined,
      story_theme: opts.storyTheme ?? undefined,
      narrative_structure: opts.narrativeStructure ?? undefined,
      uploaded_script: opts.uploadedScript,
      locale: opts.locale === "en" ? "en" : "zh",
      entry_key: opts.entryKey,
      pipeline_id: opts.pipelineId,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Start failed: ${res.status}`);
  }
  return res.json();
}

/** Phase-1：后端 resolved RunManifest（管线动态配置表）。 */
export interface ManifestAgentSlotDto {
  agentId: string;
  name: string;
  prototype: string;
  index: number;
  lifecycle: { status: string; updatedAt?: string; message?: string };
  outputField?: string;
  outputRef?: string;
}

export interface RunManifestDto {
  pipelineId: string;
  entryKey: string;
  status: string;
  config: Record<string, unknown>;
  agents: ManifestAgentSlotDto[];
  parallelGroups?: number[][];
  promptLibrary: "v1" | "v2";
  complete: boolean;
  incompletenessReason?: string;
  compositionGraph?: { startNodeId?: string };
  /**
   * 这条泳道的产物目录（相对 `output/`），由后端在启动时刻回写。
   * 主管线等于 entryKey，次管线是 `<entryKey>/pipelines/<pipelineId>`。
   * 只 plan 未 start 的泳道没有这个字段——它还没有产物。
   */
  sourceDir?: string;
  /** 是否主管线（产物落条目根、接主轨 SSE）。同上，启动后才有。 */
  primary?: boolean;
  /**
   * 这条步序是画布编排的还是预设路由的。
   * `composition` 时启动必须把 agents[] 原样回传给 `/entry/start`，否则后端会重新
   * 路由到预设管线——那正是"能编排、跑的却是别的"这个 bug 的来源。
   */
  stepSource?: "preset" | "composition";
}

export interface PlanPipelinesResponse {
  entryKey?: string;
  pipeline?: RunManifestDto;
  pipelines: RunManifestDto[];
  count: number;
}

/**
 * Phase-1 M2/M5：向后端 /plan 要 resolved 步序（禁止客户端重算）。
 * - 单管线：传 config
 * - 多管线画布：传 compositionNodes + compositionEdges（按开始节点切分）
 */
export async function planPipelines(body: {
  entryKey?: string;
  pipelineId?: string;
  config?: Record<string, unknown>;
  compositionGraph?: unknown;
  requestedSteps?: string[];
  compositionNodes?: unknown[];
  compositionEdges?: unknown[];
  requestedStepsByStart?: Record<string, string[]>;
  /** 按开始节点覆盖 config（每条管线有自己的 routing/expert 参数）。 */
  configByStart?: Record<string, Record<string, unknown>>;
  /** flat shortcuts also accepted by backend */
  tier?: TierId;
  mode?: ModeId;
  genreCode?: string;
  storyType?: string | null;
  storyTheme?: string | null;
  narrativeStructure?: string | null;
  complexity?: number;
  routeGroup?: "planning" | "narrative";
  locale?: string;
  pipelineTemplate?: string;
  userInput?: string;
  /** tpl-vn-v2：已上传剧本时后端把步序切到 E2（normalize + confirm）。 */
  hasUploadedScript?: boolean;
}): Promise<PlanPipelinesResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      genre_code: body.genreCode,
      story_type: body.storyType ?? undefined,
      story_theme: body.storyTheme ?? undefined,
      narrative_structure: body.narrativeStructure ?? undefined,
      route_group: body.routeGroup,
      pipeline_template: body.pipelineTemplate,
      user_input: body.userInput,
      locale: body.locale === "en" ? "en" : body.locale === "zh" ? "zh" : body.locale,
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `Plan failed: ${res.status}`);
  }
  return res.json();
}

export interface EntryStartLane {
  runId: string;
  pipelineId?: string;
  sourceDir: string;
  tier?: TierId;
  mode?: ModeId;
  /** 主管线（产物落 output/<key>/，历史与 fork 沿用它）。 */
  primary: boolean;
}

export interface EntryStartResponse {
  entryKey: string;
  runs: EntryStartLane[];
  skipped: Array<{ pipelineId?: string; reason: string; unrunnableSteps?: string[] }>;
  count: number;
}

/**
 * Phase-2 M8：条目级批量启动 —— 每条可运行管线各起一个 run（独立 SSE / manifest / checkpoint）。
 * 不完整的管线原样跳过并在 skipped 中回报原因，不阻塞其余管线。
 */
export async function startEntryPipelines(body: {
  entryKey: string;
  locale?: string;
  model?: string;
  pipelines: Array<{
    pipelineId?: string;
    complete?: boolean;
    incompletenessReason?: string;
    userInput?: string;
    tier?: TierId;
    mode?: ModeId;
    genreCode?: string | null;
    /** 三轴：类型/题材由需求入口给出，结构由后端推导（故此处不传）。 */
    storyType?: string | null;
    storyTheme?: string | null;
    complexity?: number;
    routeGroup?: "planning" | "narrative";
    autoDetect?: boolean;
    pipelineTemplate?: string;
    /** 自由编排：画布这条泳道的步序，原样回传给后端执行（缺省则后端按预设路由）。 */
    requestedSteps?: string[];
    /** 自定义专属团队 id（2.4）；逐泳道独立，后端只认 ready 的。 */
    teamId?: string;
    /** 勾选启用的默认关席位（打磨三席）：预置管线照跑，锚点席后多挂一道。 */
    activateSeats?: string[];
  }>;
}): Promise<EntryStartResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/entry/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry_key: body.entryKey,
      model: body.model,
      locale: body.locale === "en" ? "en" : "zh",
      pipelines: body.pipelines,
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `Entry start failed: ${res.status}`);
  }
  return res.json();
}

/** 单 agent 独立调用（Phase-1 M3）。 */
export async function runSingleAgent(
  agentId: string,
  opts: {
    userInput?: string;
    ctx?: Record<string, unknown>;
    inputs?: Record<string, unknown>;
    model?: string;
  } = {},
): Promise<{ agentId: string; outputField: string; output: unknown; ctx: unknown }> {
  const res = await fetch(`${API_BASE}/api/narrative/agent/${encodeURIComponent(agentId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_input: opts.userInput ?? "",
      ctx: opts.ctx,
      inputs: opts.inputs,
      model: opts.model,
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `Agent run failed: ${res.status}`);
  }
  return res.json();
}

/**
 * 单 agent 流式调用（Phase-2 M9）。
 *
 * composite 专家（tpl-jrpg 等）一次要跑十几分钟的子 DAG，同步调用只能让画布干等；
 * 这里拿到 runId 后由调用方挂 `GET /api/narrative/stream/:runId`，帧形状与管线 run
 * 一致（announce → running/completed → done），可直接复用同一套消费逻辑。
 */
export async function startSingleAgentStream(
  agentId: string,
  opts: {
    userInput?: string;
    ctx?: Record<string, unknown>;
    inputs?: Record<string, unknown>;
    model?: string;
  } = {},
): Promise<{ runId: string; agentId: string; streamUrl: string }> {
  const res = await fetch(`${API_BASE}/api/narrative/agent/${encodeURIComponent(agentId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stream: true,
      user_input: opts.userInput ?? "",
      ctx: opts.ctx,
      inputs: opts.inputs,
      model: opts.model,
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `Agent run failed: ${res.status}`);
  }
  return res.json();
}

/**
 * IP DNA 多模态摄入载荷（对齐后端 POST /api/narrative/ip-dna/start 的 files[]）。
 * - 文本：content（utf8 字符串）
 * - .docx：content_base64 + encoding="base64-docx"（后端 mammoth 解析）
 * - 二进制（图片/视频/音频/PDF/压缩包）：content_base64（不带 encoding，后端按 file_type 处理）
 */
export interface IpDnaFilePayload {
  file_name?: string;
  content?: string;
  content_base64?: string;
  encoding?: "utf8" | "base64-docx";
  file_type?: string;
  role?: string;
}

export interface IpDnaStartOptions {
  title?: string;
  tier?: TierId;
  generationMode?: ModeId;
  complexity?: number;
  /** 路由组（planning/narrative）：决定下游走策划全量还是叙事单品（§5.1 ROUTING 透传）。 */
  routeGroup?: string;
  /** 品类编码：scoped 生成喂 vn/rpg 管线的路由依据（§5.1/§L genreCode 透传）。 */
  genreCode?: string;
  /** 默认 true：跑完提取后继续跑生成管线（重需求端到端）。 */
  runGeneration?: boolean;
}

export interface IpDnaJobStartResponse {
  jobId: string;
  story_timestamp: string;
  status: string;
  /**
   * §图2：下游生成的 SSE run id（仅 generate 且 run_generation=true 时返回）。
   * 前端据此 startNewRun 挂载 SSE，在 ip_* 前驱步之后继续显示下游叙事节点与进度。
   */
  generationRunId?: string;
}

export interface IpDnaJobStatus {
  jobId: string;
  story_timestamp?: string;
  status: "pending" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled" | "degraded";
  current_stage?: string;
  progress?: number;
  message?: string;
  error?: string;
  result?: {
    story_timestamp?: string;
    run_id?: string;
    title?: string;
    media_type?: string;
    node_count?: number;
    /** ingest 阶段结果：层级树 + 默认裁剪/单元/维度 + 干扰过滤。 */
    hierarchy?: unknown[];
    volume?: unknown;
    decomposition?: unknown;
    noise_filtered?: string[];
    default_scope?: unknown;
    default_game_unit_plan?: unknown;
    default_dimensions?: unknown;
    awaiting?: string;
    /** D3 提取质量闸门（§14.2/§L）：层级连通 / 三件套齐全 / 核心要素 / 五大类算子覆盖。 */
    extraction_quality?: {
      passed: boolean;
      checks: Array<{ name: string; passed: boolean; detail?: string }>;
      warnings: string[];
    };
    game_units?: Array<{ index: number; generated?: boolean; output_dir?: string }>;
  };
}

/**
 * 重需求摄入（蓝图 §5）：上传多模态/压缩包/多文件 → IP DNA → 改编 → 生成。
 * 异步模式：立即返回 jobId，前端轮询 fetchIpDnaJob。
 */
export async function startIpDnaRun(
  files: IpDnaFilePayload[],
  opts: IpDnaStartOptions = {},
): Promise<IpDnaJobStartResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files,
      title: opts.title,
      tier: opts.tier,
      generation_mode: opts.generationMode,
      complexity: opts.complexity,
      route_group: opts.routeGroup,
      genre_code: opts.genreCode,
      run_generation: opts.runGeneration !== false,
      async: true,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `IP DNA start failed: ${res.status}`);
  }
  return res.json();
}

/** 轮询 IP DNA 异步任务进度（§11）。 */
export async function fetchIpDnaJob(jobId: string): Promise<IpDnaJobStatus> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/job/${jobId}`);
  if (!res.ok) throw new Error(`Failed to fetch IP DNA job: ${res.status}`);
  return res.json();
}

/** 取消 IP DNA 异步任务（§5.1 取消生产；与主管线 cancelRun 对齐统一 job 状态）。 */
export async function ipDnaCancel(jobId: string): Promise<{ jobId: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/job/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to cancel IP DNA job: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// IP 半自动阶段门 API 客户端（§5.1）：ingest → hierarchy →(decompose)→ confirm → extract/generate。
// 与平台 agent 工具 narrative:ip-dna-* 走同一组后端端点，行为等价（双通道）。
// ─────────────────────────────────────────────────────────────────

/** 层级节点摘要（前端展示/裁剪范围下拉用）。 */
export interface IpHierarchyNode {
  id: string;
  levelType: "complete" | "part" | "chapter" | "unit";
  index: number;
  /** 原始标题/文件名（溯源源串）。 */
  title: string;
  /** 对外展示规范名：`序号_《原始标题》`（root=`《题目》`），展示一律优先用它。 */
  displayName?: string;
  /** 根→自身的完整嵌套层级链（内部运行/定位用）。 */
  lineage?: Array<{ id: string; levelType: string; index: number; displayName: string }>;
  parent: string | null;
  children?: string[];
  childRange?: string;
}

/** 层级摘要：levels[0]=complete（根/完整作品），其后为 root 以下真实层级（按深度排序）。决定改编范围下拉列数与每列标题。 */
export interface IpLevelSummary {
  levelType: "complete" | "part" | "chapter" | "unit" | string;
  label: string;
  count: number;
}

/** ingest / hierarchy 共用的层级树 + 默认裁剪/单元/维度摘要。 */
export interface IpHierarchyResult {
  story_timestamp: string;
  run_id: string;
  title: string;
  media_type: string;
  node_count: number;
  /** 层级结构类型（single_file/single_layer/two_layer/three_layer，§3.2）。 */
  structure_type?: string;
  /** 逐层聚合次数 = root 以下层数。 */
  aggregation_times?: number;
  /** 层级摘要（levels[0]=complete 根 + 其后真实层级）；前端范围列数 = 根列(1) + 真实层级数。 */
  levels?: IpLevelSummary[];
  hierarchy: IpHierarchyNode[];
  volume?: { charCount: number; isShort: boolean; needsDecompose: boolean; suggestedChunks: number; thresholdBasis: string; oversizedUnitCount?: number };
  decomposition?: { iterations: number; splitUnits: number; residualOversize: boolean };
  noise_filtered?: string[];
  default_scope?: { full: boolean; selections?: unknown[] };
  default_game_unit_plan?: { mode: "single" | "series"; units: unknown[]; userSpecified?: boolean };
  default_dimensions?: unknown;
  confirmation?: Record<string, unknown>;
  awaiting?: string;
  jobId?: string;
  status?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((b as { error?: string }).error ?? `请求失败: ${res.status}`);
  }
  return res.json();
}

/** 阶段门①：摄入 + 标准化（async=true 返回 jobId，轮询 fetchIpDnaJob 取层级树摘要）。 */
export async function ipDnaIngest(
  files: IpDnaFilePayload[],
  opts: { title?: string; decompose?: boolean; model?: string; async?: boolean; storyTimestamp?: string } = {},
): Promise<IpHierarchyResult> {
  return postJson<IpHierarchyResult>(`${API_BASE}/api/narrative/ip-dna/ingest`, {
    files,
    title: opts.title,
    decompose: opts.decompose,
    model: opts.model,
    async: opts.async,
    story_timestamp: opts.storyTimestamp,
  });
}

/**
 * §状态机 / IP「确认」即落盘（零 LLM）：把上传原料固化到 input/，写 manifest，不做标准化/建树/提取。
 * 返回 run_id（=<story_timestamp>_<title>），前端据此桥接到 output 条目的 _entry.json.ipRunKey。
 * storyTimestamp 传 output 条目键使 input/output 同键关联、重确认覆盖幂等。
 */
export async function ipDnaPackage(
  files: IpDnaFilePayload[],
  opts: { title?: string; storyTimestamp?: string } = {},
): Promise<{ story_timestamp: string; run_id: string; title: string }> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/package`, {
    files,
    title: opts.title,
    story_timestamp: opts.storyTimestamp,
  });
}

/** 只读层级树 + 默认裁剪/单元/维度 + 体量（供确认裁剪范围引导）。 */
export async function fetchIpHierarchy(runId: string): Promise<IpHierarchyResult> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/hierarchy`);
  if (!res.ok) throw new Error(`Failed to fetch hierarchy: ${res.status}`);
  return res.json();
}

/** 只读：按 runId 读取已落盘 IP DNA 层级树摘要（§6/§10，历史回放还原输入模块用）。 */
export interface IpDnaHierarchySummary {
  story_id: string;
  title: string;
  media_type: string;
  node_count: number;
  hierarchy: IpHierarchyNode[];
}
export async function fetchIpDnaHierarchy(runId: string): Promise<IpDnaHierarchySummary | null> {
  const res = await fetch(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch IP DNA hierarchy: ${res.status}`);
  return res.json();
}

/** 拆解（§5 步骤6-10）：超线时按标记/单元闭环拆解→再标准化→重写骨架层级树。 */
export async function ipDnaDecompose(runId: string): Promise<{ run_id: string; decomposed: boolean; chunk_count: number; closure: unknown; node_count: number; hierarchy: IpHierarchyNode[] }> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/decompose`, {});
}

/** ① 确认裁剪范围（§4.4 第①步）。 */
export async function ipDnaConfirmScope(
  runId: string,
  body: { scopeSelections?: unknown[]; scopeFull?: boolean; adaptationNotes?: string } = {},
): Promise<{ run_id: string; confirmation: Record<string, unknown>; awaiting: string }> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/confirm-scope`, {
    scope_selections: body.scopeSelections,
    scope_full: body.scopeFull,
    adaptation_notes: body.adaptationNotes,
  });
}

/** ② 确认游戏单元 + 改编维度（§4.4 第②③步）。 */
export async function ipDnaConfirmUnits(
  runId: string,
  body: { gameUnitPlan?: unknown; adaptationDimensions?: unknown; mode?: "single" | "series"; targetUnits?: number } = {},
): Promise<{ run_id: string; confirmation: Record<string, unknown>; awaiting: string }> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/confirm-units`, {
    game_unit_plan: body.gameUnitPlan,
    adaptation_dimensions: body.adaptationDimensions,
    mode: body.mode,
    target_units: body.targetUnits,
  });
}

/** ③ 生成 scoped IP DNA（仅提取，run_generation=false）。async=true 走 job。 */
export async function ipDnaExtract(
  runId: string,
  opts: { pipelineFamily?: "rpg" | "vn"; tier?: TierId; generationMode?: ModeId; complexity?: number; maxGameUnits?: number; equipOperators?: boolean; model?: string; async?: boolean } = {},
): Promise<IpDnaJobStartResponse | IpDnaJobStatus["result"]> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/extract`, {
    pipeline_family: opts.pipelineFamily,
    tier: opts.tier,
    generation_mode: opts.generationMode,
    complexity: opts.complexity,
    max_game_units: opts.maxGameUnits,
    equip_operators: opts.equipOperators,
    model: opts.model,
    async: opts.async,
  });
}

/** 开始生成（§5 步骤4→5）：提取 + 下游生成自动串跑。async=true 走 job。 */
export async function ipDnaGenerate(
  runId: string,
  opts: { pipelineFamily?: "rpg" | "vn"; genreCode?: string; tier?: TierId; generationMode?: ModeId; complexity?: number; maxGameUnits?: number; equipOperators?: boolean; model?: string; async?: boolean } = {},
): Promise<IpDnaJobStartResponse | IpDnaJobStatus["result"]> {
  return postJson(`${API_BASE}/api/narrative/ip-dna/${encodeURIComponent(runId)}/generate`, {
    pipeline_family: opts.pipelineFamily,
    genre_code: opts.genreCode,
    tier: opts.tier,
    generation_mode: opts.generationMode,
    complexity: opts.complexity,
    max_game_units: opts.maxGameUnits,
    equip_operators: opts.equipOperators,
    model: opts.model,
    async: opts.async,
  });
}

/** Fetch final result */
export async function fetchResult(runId: string): Promise<RunResultResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/result/${runId}`);
  if (!res.ok) throw new Error(`Failed to fetch result: ${res.status}`);
  return res.json();
}

/** Fetch current run status (for resume) */
export async function fetchStatus(runId: string) {
  const res = await fetch(`${API_BASE}/api/narrative/status/${runId}`);
  if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
  return res.json();
}

/** 某 run 的「环节文件分组」（input 各阶段 + output），后端按真实落盘目录返回。 */
export interface RunFileGroup {
  group: string;
  label: string;
  files: string[];
}

/** 列出某 run 跨 input/output 两侧的全部文件（按环节分组）。失败/空则返回 []。 */
export async function fetchRunFiles(runId: string): Promise<RunFileGroup[]> {
  try {
    const res = await fetch(`${API_BASE}/api/narrative/files/${encodeURIComponent(runId)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { groups?: RunFileGroup[] };
    return data.groups ?? [];
  } catch {
    return [];
  }
}

/** 键权层 M2：一张版本快照是因为什么产生的。与后端 `version-store.ts` 的 `VersionOrigin` 同构。 */
export interface VersionOrigin {
  kind: "manual_edit" | "qa_repair" | "polish_seat" | "restore_original";
  editor?: string;
  findingIds?: string[];
  repairKind?: "topology" | "content" | "mixed";
  seatId?: string;
}

/**
 * 某 run 下所有版本快照的溯源，键与 `fetchRunFiles` 返回的文件路径同形
 * （`<group>/<相对路径>`），供 `TaskFiles` 按 `LibraryFile.path` 直接查表。
 * 失败/空则返回 `{}`——没有溯源不是错误，是"这版没登记来源"（历史快照、测试数据）。
 */
export async function fetchVersionOrigins(runId: string): Promise<Record<string, VersionOrigin>> {
  try {
    const res = await fetch(`${API_BASE}/api/narrative/version-origins/${encodeURIComponent(runId)}`);
    if (!res.ok) return {};
    const data = (await res.json()) as { origins?: Record<string, VersionOrigin> };
    return data.origins ?? {};
  } catch {
    return {};
  }
}

/**
 * 读取某 run 下单个文件内容（路径形如 `<group>/<相对路径>`）。
 * json 文件返回美化字符串，其余按纯文本；失败返回 null。
 */
export async function fetchRunFileContent(runId: string, groupedPath: string): Promise<string | null> {
  try {
    const encoded = groupedPath.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${API_BASE}/api/narrative/file/${encodeURIComponent(runId)}/${encoded}`);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) return JSON.stringify(await res.json(), null, 2);
    return await res.text();
  } catch {
    return null;
  }
}

export interface HistoryEntry {
  key: string;
  type: "dir" | "file";
  id: string | null;
  tier?: TierId;
  mode?: ModeId;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  fileCount?: number;
  hasCheckpoint: boolean;
  hasEdits?: boolean;
  lastCompletedStep: string | null;
  completedSteps: string[] | null;
  canResume: boolean;
  canLoad: boolean;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  parentKey?: string;
  forkReason?: string;
  /** 条目卡第二行（需求输入 / 文件上传）与第三行（叙事路由）用；由 /history 投影。 */
  genreCode?: string;
  inputType?: string;
  uploadedFileNames?: string[];
  storyType?: string;
  storyTheme?: string;
  narrativeStructure?: string;
  /** 运行类型标记（"ip-dna" = IP 摄入/改编运行）。 */
  kind?: string;
  /**
   * IP 改编下游生成的可 stream run id（ipgen_<story_timestamp>_<rand>）。
   * 仅当该 IP 条目正处于下游生成阶段时后端才回填；前端据此 attach /stream 直播中间预览。
   */
  generationRunId?: string;
  /** Phase-1：该条目下管线数量（来自 _entry.json.pipelines）。 */
  pipelineCount?: number;
}

/**
 * §条目持久化：条目配置（与后端 output/<key>/_entry.json 对齐）。
 * 一次用户需求的全部参数（INPUT + ROUTING）落盘于此，使任何阶段点击都能还原。
 * IP 作品用 ipRunKey 桥接到 input 媒体目录（<时间戳>_<标题>）。
 */
export interface EntryConfig {
  key?: string;
  inputType?: "text" | "tags" | "works";
  userInput?: string;
  tags?: { selections?: Record<string, string>; customTexts?: Record<string, string> };
  uploadedFileNames?: string[];
  routeGroup?: "planning" | "narrative";
  tier?: TierId;
  mode?: ModeId;
  genreCode?: string;
  /** 三轴路由（PRD v1.4 §3.2.2）；structure 由后端综合后回写，前端一般只读。 */
  storyType?: string;
  storyTheme?: string;
  narrativeStructure?: string;
  complexity?: number;
  locale?: "en" | "zh";
  ipRunKey?: string;
  parentKey?: string;
  /** Phase-1 多管线：一组 RunManifestDto。 */
  pipelines?: RunManifestDto[];
  activePipelineId?: string;
  listExpanded?: boolean;
  /** 资产库：作者确认的产物，元素为 `<group>/<相对路径>`。 */
  assets?: string[];
  compositionNodes?: unknown[];
  compositionEdges?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

/** §条目持久化：upsert 条目参数（首次输入确认建条目 + ROUTING「确认保存」都调它）。 */
export async function saveEntry(key: string, patch: Partial<EntryConfig>): Promise<void> {
  await postJson(`${API_BASE}/api/narrative/entry`, { key, ...patch }).catch(() => {});
}

/** Cancel a running pipeline */
export async function cancelRun(runId: string): Promise<void> {
  await fetch(`${API_BASE}/api/narrative/cancel/${runId}`, { method: "POST" }).catch(() => {});
}

/** Fetch run history with checkpoint information */
export async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await fetch(`${API_BASE}/api/narrative/history`);
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
  return res.json();
}

/** Load a historical run's full result（未生成的条目额外带 entry 配置，result 为 null）。 */
export async function loadHistoryResult(
  key: string,
): Promise<RunResultResponse & { entry?: EntryConfig }> {
  const res = await fetch(`${API_BASE}/api/narrative/history/${encodeURIComponent(key)}/load`);
  if (!res.ok) throw new Error(`Failed to load history: ${res.status}`);
  return res.json();
}

/** Resume a run from a saved checkpoint */
export async function resumeRun(
  dir: string,
  opts: { model?: string; locale?: string } = {},
): Promise<RunStartResponse & { entryKey?: string }> {
  const res = await fetch(`${API_BASE}/api/narrative/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dir,
      model: opts.model,
      locale: opts.locale === "en" ? "en" : opts.locale === "zh" ? "zh" : undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Resume failed: ${res.status}`);
  }
  return res.json();
}

export interface RegenerateResponse {
  id: string;
  status: string;
  message: string;
  sourceDir: string;
  newEntryKey?: string;
  fromStepId: string;
  staleSteps: string[];
  tier?: string;
  mode?: string;
  parentKey?: string;
}

/** Regenerate (fork) from a specific step with optional editDrafts */
export async function regenerateStep(
  sourceDir: string,
  fromStepId: string,
  opts: {
    userInstructions?: string;
    stopAfterStep?: string;
    patchedContext?: Record<string, unknown>;
    model?: string;
    skipSteps?: string[];
    nodeFilter?: Record<string, string[]>;
    editDrafts?: Record<string, { content?: unknown; userInput?: string }>;
    locale?: string;
  } = {},
): Promise<RegenerateResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceDir,
      fromStepId,
      userInstructions: opts.userInstructions,
      stopAfterStep: opts.stopAfterStep,
      patchedContext: opts.patchedContext,
      model: opts.model,
      skipSteps: opts.skipSteps,
      nodeFilter: opts.nodeFilter,
      editDrafts: opts.editDrafts,
      locale: opts.locale === "en" ? "en" : opts.locale === "zh" ? "zh" : undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Regenerate failed: ${res.status}`);
  }
  return res.json();
}

export interface ImpactAnalysisResponse {
  affectedSteps: string[];
  canSkip: string[];
  reasoning: string;
  mode?: string;
  pipelineOrder?: string[];
  fallback?: boolean;
  nodeImpacts?: Array<{ stepId: string; nodeIds: string[] }> | null;
}

/** Analyze impact of user edits via LLM diff analysis */
export async function analyzeImpact(
  sourceDir: string,
  modifications: Array<{
    stepId: string;
    nodeId?: string;
    editedContent?: unknown;
    userInput?: string;
  }>,
): Promise<ImpactAnalysisResponse> {
  const res = await fetch(`${API_BASE}/api/narrative/analyze-impact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceDir, modifications }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Impact analysis failed: ${res.status}`);
  }
  return res.json();
}

/** Fetch saved edits for a run directory */
export async function fetchEdits(dir: string): Promise<{
  edits: Array<{
    stepId: string;
    nodeId?: string;
    editedContent?: unknown;
    userInput?: string;
    originalContent?: unknown;
    savedAt: string;
  }>;
  updatedAt: string;
}> {
  const res = await fetch(`${API_BASE}/api/narrative/edits/${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error(`Failed to fetch edits: ${res.status}`);
  return res.json();
}

/**
 * Hook: connects to SSE stream for the active run and updates the store.
 * Auto-fetches result on completion.
 */
export function useNarrativeStream() {
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const pushProgress = useNarrativeStore((s) => s.pushProgress);
  const appendStreamChunk = useNarrativeStore((s) => s.appendStreamChunk);
  const completeRun = useNarrativeStore((s) => s.completeRun);
  const failRun = useNarrativeStore((s) => s.failRun);
  const esRef = useRef<EventSource | null>(null);

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!runningRunId) {
      cleanup();
      return;
    }

    const es = new EventSource(`${API_BASE}/api/narrative/stream/${runningRunId}`);
    esRef.current = es;

    es.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "done") {
          cleanup();
          if (data.status === "completed") {
            try {
              const result = await fetchResult(runningRunId);
              if (result.result) {
                completeRun(result.result, result.entryKey ?? undefined);
              } else {
                failRun("Result unavailable");
              }
            } catch {
              failRun("Failed to fetch result");
            }
          } else {
            failRun(data.error ?? "Pipeline failed");
          }

          useNarrativeStore.getState().snapshot();
          return;
        }

        if (data.type === "streaming" && data.stepId && (data.chunk || data.accumulated)) {
          let sid = data.stepId as string;
          if (sid === "script_scene_generation") {
            const msg = (data.accumulated ?? data.chunk ?? "") as string;
            sid = msg.includes("场景") ? "scene_plan" : "script_generation";
          }
          appendStreamChunk(sid, (data.accumulated ?? data.chunk) as string);
          return;
        }

        // D4: pipeline_steps_announce — forwarded as a regular progress frame.
        if (data.type === "pipeline_steps_announce" && Array.isArray(data.steps)) {
          pushProgress(data as PipelineProgress);
          return;
        }

        const progress = data as PipelineProgress;
        pushProgress(progress);
      } catch {
        // skip malformed events
      }
    };

    let reconnectAttempts = 0;
    const MAX_RECONNECT = 5;

    const scheduleReconnect = () => {
      if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts - 1), 15000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!useNarrativeStore.getState().runningRunId) return;
          const newEs = new EventSource(`${API_BASE}/api/narrative/stream/${runningRunId}`);
          esRef.current = newEs;
          newEs.onmessage = es.onmessage;
          newEs.onerror = es.onerror;
        }, delay);
      } else {
        failRun("Lost connection after multiple retries");
      }
    };

    es.onerror = () => {
      cleanup();
      const store = useNarrativeStore.getState();
      if (!store.runningRunId) return;

      fetchStatus(runningRunId).then(async (st) => {
        if (st.status === "completed") {
          try {
            const result = await fetchResult(runningRunId);
            if (result.result) {
              completeRun(result.result, result.entryKey ?? undefined);
            } else {
              failRun("Result unavailable");
            }
          } catch {
            failRun("Failed to fetch result on reconnect");
          }
        } else if (st.status === "failed") {
          failRun(st.error ?? "Unknown error");
        } else {
          scheduleReconnect();
        }
      }).catch(async () => {
        try {
          const history = await fetchHistory();
          const match = history.find((h) => h.id === runningRunId && h.canLoad);
          if (match) {
            const data = await loadHistoryResult(match.key);
            if (data.result) {
              completeRun(data.result, match.key);
              useNarrativeStore.getState().snapshot();
              return;
            }
          }
        } catch { /* history lookup failed */ }
        scheduleReconnect();
      });
    };

    return cleanup;
  }, [runningRunId, pushProgress, appendStreamChunk, completeRun, failRun, cleanup]);
}
