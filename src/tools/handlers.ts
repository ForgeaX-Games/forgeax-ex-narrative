/**
 * narrative `entry.backend` for ToolRegistry.
 *
 * Each handler bridges to the narrative-studio Express API running on
 * localhost:${NARRATIVE_PORT}. The Express server (src/api/server.ts) owns
 * the pipeline lifecycle; this file is a thin RPC adapter so the ForgeaX
 * ToolRegistry can dispatch `narrative:*` tool calls from AI / chat / CLI.
 *
 * Pattern mirrors character/server/tool-handlers.ts:
 *   ToolRegistry → tools["narrative:start-pipeline"](args, ctx)
 *                → HTTP fetch to :8900
 *                → return structured result
 *
 * Sandbox contract: handlers MUST use ctx.env for secrets / port config
 * and ctx.projectRoot for project root — NOT ctx.cwd, which the host sets to
 * the plugin's own install directory (`entry.extensionDir`, see
 * `packages/orchestrator/src/tools/registry.ts`), not the user's project.
 * Never read process.env directly.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, relative, extname, basename } from 'node:path';
// type-only：编译后消失，不给工具层引入 entry-store 的运行时依赖。
import type { IntakeSource } from '../api/entry-store.js';

interface ToolCtx {
  caller: { kind: string; id?: string };
  toolId: string;
  env?: Record<string, string | undefined>;
  /** 插件安装目录（forgeax-extension.json 所在），不是用户项目根——`toWireFiles`
   *  的路径穿越校验用这个。历史上 `narrative:export-result` 把它错当项目根用；
   *  用户数据落盘请用下面的 `projectRoot`。真实字段名对齐宿主
   *  `packages/orchestrator/src/tools/registry.ts` 的 ToolHandler ctx。 */
  cwd?: string;
  /** 用户数据根：`<projectRoot>/.forgeax/games/<slug>/...` 所在，宿主从
   *  path-manager 注入。宿主没接入（如独立进程直调）时缺省。 */
  projectRoot?: string;
  /** 当前调用绑定的 game slug，宿主注入；宿主没接入时缺省。 */
  game?: string;
}

/** 摄入类工具收的一份原料：内联正文，或（聊天附件那一路）一个工程内路径。 */
interface IncomingFileArg {
  fileName?: string;
  content?: string;
  contentBase64?: string;
  encoding?: "utf8" | "base64-docx";
  fileType?: string;
  role?: string;
  /**
   * 工程内相对路径（也接受工程内的绝对路径）。
   *
   * 这是「平台对话里的附件」进叙事的那条路：用户在 chat 里丢一份 docx，agent 拿到的是
   * 一个路径而不是正文——docx 是二进制，agent 读不出正文也做不了 base64。所以由本层
   * 按扩展名读盘并转成后端要的形态。
   */
  path?: string;
}

const TEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.json', '.csv']);
const DOCX_EXTS = new Set(['.doc', '.docx']);

const MIME_BY_EXT: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.zip': 'application/zip',
};

/** 后端 `/ip-dna/*` 的 snake_case 文件形态。 */
interface WireFile {
  file_name?: string;
  content?: string;
  content_base64?: string;
  encoding?: "utf8" | "base64-docx";
  file_type?: string;
  role?: string;
}

/**
 * 把工具参数里的原料统一成后端要的形态：内联的原样透传，带 `path` 的读盘。
 *
 * 读盘限制在 `ctx.projectRoot` 之内（用户项目根，不是插件安装目录 `ctx.cwd`——
 * 聊天附件落在项目里，不会落进插件自己的安装目录）—— 工具参数由 agent 生成，
 * 把任意路径直接交给 fs 等于让一句话就能读走 `~/.ssh/id_rsa`。越界与
 * `projectRoot` 缺失都直接抛错，不静默跳过：少一份原料的摄入会跑完并给出一个
 * 看着正常、实际缺章的结果。
 */
async function toWireFiles(
  files: readonly IncomingFileArg[] | undefined,
  ctx: ToolCtx,
): Promise<WireFile[]> {
  const out: WireFile[] = [];
  for (const f of files ?? []) {
    if (!f?.path) {
      out.push({
        file_name: f?.fileName,
        content: f?.content,
        content_base64: f?.contentBase64,
        encoding: f?.encoding,
        file_type: f?.fileType,
        role: f?.role,
      });
      continue;
    }
    if (!ctx.projectRoot) {
      throw Object.assign(new Error(`cannot read "${f.path}": no project root in tool context`), {
        code: 'invalid_args',
      });
    }
    const root = resolve(ctx.projectRoot);
    const abs = isAbsolute(f.path) ? resolve(f.path) : resolve(root, f.path);
    const rel = relative(root, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw Object.assign(new Error(`path escapes the project root: ${f.path}`), {
        code: 'invalid_args',
      });
    }
    const ext = extname(abs).toLowerCase();
    const name = f.fileName ?? basename(abs);
    const fileType = f.fileType ?? MIME_BY_EXT[ext] ?? 'application/octet-stream';
    if (TEXT_EXTS.has(ext)) {
      out.push({ file_name: name, content: await readFile(abs, 'utf-8'), encoding: 'utf8', file_type: fileType, role: f.role });
    } else if (DOCX_EXTS.has(ext)) {
      // docx 由后端 mammoth 抽正文，所以这里只负责搬字节。
      out.push({ file_name: name, content_base64: (await readFile(abs)).toString('base64'), encoding: 'base64-docx', file_type: fileType, role: f.role });
    } else {
      out.push({ file_name: name, content_base64: (await readFile(abs)).toString('base64'), file_type: fileType, role: f.role });
    }
  }
  return out;
}

function getApiBase(ctx: ToolCtx): string {
  const port = ctx.env?.NARRATIVE_PORT ?? "8900";
  return `http://localhost:${port}/api/narrative`;
}

async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), {
      code: res.status === 409 ? "conflict" : "api_error",
      httpStatus: res.status,
    });
  }
  return body;
}

// ---------------------------------------------------------------------------

interface StartPipelineArgs {
  userInput: string;
  tier?: string;
  mode?: string;
  genreCode?: string;
  complexity?: number;
  routeGroup?: "planning" | "narrative";
  routingMode?: "auto" | "semi" | "manual";
  model?: string;
  /**
   * 三轴路由的前两轴（第三轴「叙事结构」由后端按类型+题材推导，不接受直填）。
   *
   * 节点入口一直有这两轴，chat 入口此前没有——于是同一句需求从 chat 起跑，
   * 类型与题材全靠 LLM 猜，跑出来与画布上选好轴的那次不是一回事，且无从解释。
   * 取值查 `narrative:list-axes`。
   */
  storyType?: string;
  storyTheme?: string;
  /**
   * 落到哪个条目下（`narrative:create-entry` 的返回键）。
   *
   * 不给就另铸一个时间戳目录，且不写 `_entry.json`——那样这次生成在左栏是一条
   * 没有参数、没有输入方式记录的孤条目。要与节点入口拿到同一套条目信息，
   * 先建条目再把键传进来。
   */
  entryKey?: string;
  /** 勾选启用的默认关席位（打磨三席：playability / deai / plot_refine）。 */
  activateSeats?: string[];
  /**
   * 自定义专属创作团队 id。
   *
   * 叙事侧 @ 一位团队成员时会把 `team=<id>` 写进插入文本，平台 agent 据此填这个参数。
   * 不填等于不带团队——后端不会去猜"用户刚才提到的那位"，也不会报错。
   */
  teamId?: string;
}

interface TeamIdArg {
  teamId: string;
}

/**
 * 建条目（`POST /api/narrative/entry` 的工具面）。
 *
 * chat 入口与节点入口此前拿到的不是同一套条目：节点入口在首次输入确认时就铸出
 * `_entry.json`（带 inputType / tags / 三轴），chat 入口直接开跑，条目目录里
 * 只有产物、没有配置。参数照 `EntryConfig` 的可写子集，字段名保持一致。
 */
interface CreateEntryArgs {
  key: string;
  inputType?: IntakeSource;
  userInput?: string;
  tags?: { selections?: Record<string, string>; customTexts?: Record<string, string> };
  routeGroup?: "planning" | "narrative";
  tier?: string;
  mode?: string;
  genreCode?: string;
  storyType?: string;
  storyTheme?: string;
  complexity?: number;
  locale?: "en" | "zh";
}

interface GetRunStatusArgs {
  runId: string;
  includeResult?: boolean;
}

interface ListRunsArgs {
  limit?: number;
}

interface ExportResultArgs {
  runId: string;
  slug?: string;
  targetDir?: string;
}

interface CancelRunArgs {
  runId: string;
}

interface RegenerateStepArgs {
  sourceDir: string;
  fromStepId: string;
  userInstructions?: string;
  stopAfterStep?: string;
  model?: string;
  skipSteps?: string[];
  nodeFilter?: Record<string, string[]>;
  editDrafts?: Record<string, { content?: unknown; userInput?: string }>;
}

/**
 * G3：单席执行。`seatId` 既可以是二十席里的席位 id（`req_list` / `worldview` / ...），
 * 也可以直接传 step id——后端 `POST /agent/:id/run` 自己会把席位 id 解析到真正
 * 可执行的 AgentDef（单步席解析到其 step，多步席解析到席位级 composite 外壳），
 * 这里不重复做这层判断。
 */
interface RunSeatArgs {
  seatId: string;
  userInput?: string;
  /** 补齐/覆盖 ctx 字段（如接上游席位产出）；不填则只有 userInput 作为起点。 */
  ctx?: Record<string, unknown>;
  /** 覆盖/追加输入字段，写入后再校验 requiredInputs。 */
  inputs?: Record<string, unknown>;
  model?: string;
  /**
   * 绑定到某条目并落盘（G2）。给了就把这次单席跑并入该条目的 checkpoint，
   * 产物可被后续管线消费；不给则只在响应体里回结果，不落盘（临时态）。
   */
  entryKey?: string;
}

interface RunIdArg {
  runId: string;
}

interface ReadFileArgs {
  runId: string;
  filePath: string;
}

interface DirArg {
  dir: string;
}

interface LoadHistoryArgs {
  key: string;
}

interface ResumePipelineArgs {
  dir: string;
  model?: string;
}

interface StaleStepsArgs {
  sourceDir: string;
  fromStepId: string;
}

interface AnalyzeImpactArgs {
  sourceDir: string;
  modifications: Array<{
    stepId: string;
    nodeId?: string;
    editedContent?: unknown;
    userInput?: string;
  }>;
}

interface SetReviewArgs {
  dir: string;
  stepId: string;
  status: "pending" | "approved" | "rejected";
  feedback?: string;
  regenerateRunId?: string;
}

/**
 * G4：改稿落盘。原稿先进 `_original/`（后端 save-step-edit 端点自己做），改后的内容
 * 覆盖 ctx 与产物文件，`_edits.json` 记一笔账 —— 与界面文本视图"保存"按钮走同一端点，
 * agent 改完不再是"说了但没写盘"。
 */
interface SaveStepEditArgs {
  sourceDir: string;
  stepId: string;
  nodeId?: string;
  /** 省略则只回读当前内容、不写盘（用于确认改前是什么样）。 */
  editedContent?: unknown;
  userInput?: string;
}

/** G4：把某一步（或某个节点）的内容还原为模型原稿，撤掉账本里那一条。没存过原稿则 404。 */
interface RestoreOriginalArgs {
  sourceDir: string;
  stepId: string;
  nodeId?: string;
}

/** 嵌套裁剪选择（§4.4 第①步对话产物）。 */
interface ScopeSelectionArg {
  nodeId: string;
  childRange?: [number, number];
  children?: ScopeSelectionArg[];
}

interface IpDnaStartArgs {
  files: IncomingFileArg[];
  title?: string;
  mode?: "single" | "series";
  /** §4.4 第①步：裁剪范围（嵌套选择）；缺省=全量。 */
  scopeSelections?: ScopeSelectionArg[];
  /** §4.4 第②步：用户精确选填的游戏单元规划；缺省=默认切分。 */
  gameUnitPlan?: unknown;
  /** §4.4 第③步：改编维度（叙事层级数 + 模板字段）；缺省=全维度模板。 */
  adaptationDimensions?: unknown;
  /** §5.1 自定义补充：作者改编意图自由文本；缺省=忠实转化。 */
  adaptationNotes?: string;
  targetUnits?: number;
  complexity?: number;
  runGeneration?: boolean;
  maxGameUnits?: number;
  tier?: string;
  generationMode?: string;
  /** ROUTING 透传（§5.1/§L）：路由组 + 品类编码，决定下游生成管线的品类。 */
  routeGroup?: "planning" | "narrative";
  genreCode?: string;
  model?: string;
}

interface IpDnaAnalyzeImpactArgs {
  runId: string;
  changedKeys: string[];
}

/** 阶段门 ① 摄入 + 标准化（停在确认裁剪范围前）。 */
interface IpDnaIngestArgs {
  files: IncomingFileArg[];
  title?: string;
  decompose?: boolean;
  model?: string;
  /** 异步：true 立即返回 jobId，轮询 ip-dna-get-job 取层级树摘要。 */
  async?: boolean;
  storyTimestamp?: string;
}

/** 阶段门 ③ 确认裁剪范围（§4.4 第①步）。 */
interface IpDnaConfirmScopeArgs {
  runId: string;
  scopeSelections?: ScopeSelectionArg[];
  scopeFull?: boolean;
  /** §5.1 自定义补充：作者改编意图自由文本；缺省=忠实转化。 */
  adaptationNotes?: string;
}

/** 阶段门 确认游戏单元 + 改编维度（§4.4 第②③步）。 */
interface IpDnaConfirmUnitsArgs {
  runId: string;
  gameUnitPlan?: unknown;
  adaptationDimensions?: unknown;
  mode?: "single" | "series";
  targetUnits?: number;
}

/** 阶段门 提取/生成（extract=仅 IP DNA；generate=提取+下游生成自动串跑）。 */
interface IpDnaExtractGenerateArgs {
  runId: string;
  tier?: string;
  generationMode?: string;
  complexity?: number;
  maxGameUnits?: number;
  equipOperators?: boolean;
  model?: string;
  async?: boolean;
}

interface JobIdArg {
  jobId: string;
}

/** read-file may return text/plain; cap payload so AI callers don't blow context. */
const READ_FILE_MAX_CHARS = 24000;

// ---------------------------------------------------------------------------

export const tools = {
  "narrative:start-pipeline": async (args: StartPipelineArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/start`, {
      method: "POST",
      body: JSON.stringify({
        user_input: args.userInput,
        tier: args.tier,
        mode: args.mode,
        genre_code: args.genreCode,
        complexity: args.complexity,
        route_group: args.routeGroup,
        routing_mode: args.routingMode,
        model: args.model,
        team_id: args.teamId,
        story_type: args.storyType,
        story_theme: args.storyTheme,
        entry_key: args.entryKey,
        activate_seats: args.activateSeats,
      }),
    });
  },

  /**
   * 建/改条目：与节点入口的「首次输入确认」同一个接口，同一份 `_entry.json`。
   *
   * 同 key 多次调用是合并而非覆盖（保留 createdAt），所以补一个字段不必重发全量。
   * 先建条目再 `start-pipeline` 带 entryKey，两个入口的条目才真的长一样。
   */
  "narrative:create-entry": async (args: CreateEntryArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/entry`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  },

  /** 三轴词表：填 start-pipeline 的 storyType / storyTheme 之前先查它，别猜 code。 */
  "narrative:list-axes": async (_args: Record<string, never>, ctx: ToolCtx) => {
    return await apiFetch(`${getApiBase(ctx)}/axes`);
  },

  /** 列出自定义专属团队（2.4）：agent 要先知道有哪些、哪些 ready，才能选一位带进生成。 */
  "narrative:list-teams": async (_args: Record<string, never>, ctx: ToolCtx) => {
    return await apiFetch(`${getApiBase(ctx)}/teams`);
  },

  "narrative:get-team": async (args: TeamIdArg, ctx: ToolCtx) => {
    return await apiFetch(`${getApiBase(ctx)}/teams/${encodeURIComponent(args.teamId)}`);
  },

  "narrative:get-run-status": async (args: GetRunStatusArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    const status = await apiFetch(`${base}/status/${args.runId}`);
    if (
      args.includeResult &&
      (status as { status: string }).status === "completed"
    ) {
      const result = await apiFetch(`${base}/result/${args.runId}`);
      return { ...(status as object), result };
    }
    return status;
  },

  "narrative:list-runs": async (_args: ListRunsArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/history`);
  },

  "narrative:export-result": async (args: ExportResultArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    // 目标是用户项目目录，不是插件安装目录——之前这里错用了 ctx.cwd（见 ToolCtx
    // 注释）。projectRoot 缺失（宿主未接入 / 独立进程直调）时退回 "."，与迁移前
    // 的行为一致，不炸独立场景。
    const slug = args.slug ?? ctx.game ?? "_default";
    const targetDir =
      args.targetDir ?? `${ctx.projectRoot ?? "."}/.forgeax/games/${slug}/narrative`;
    return await apiFetch(`${base}/export/${args.runId}`, {
      method: "POST",
      body: JSON.stringify({ target_dir: targetDir }),
    });
  },

  "narrative:cancel-run": async (args: CancelRunArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/cancel/${args.runId}`, {
      method: "POST",
    });
  },

  "narrative:regenerate-step": async (
    args: RegenerateStepArgs,
    ctx: ToolCtx,
  ) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        sourceDir: args.sourceDir,
        fromStepId: args.fromStepId,
        userInstructions: args.userInstructions,
        stopAfterStep: args.stopAfterStep,
        model: args.model,
        skipSteps: args.skipSteps,
        nodeFilter: args.nodeFilter,
        editDrafts: args.editDrafts,
      }),
    });
  },

  /**
   * G3：按席位 id 单独跑一个叙事单品助手，不遍历全管线。
   * 同步返回结果——单席跑通常几秒到几十秒，不像整条管线那样需要 SSE。
   */
  "narrative:run-seat": async (args: RunSeatArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/agent/${encodeURIComponent(args.seatId)}/run`, {
      method: "POST",
      body: JSON.stringify({
        ctx: args.ctx,
        user_input: args.userInput,
        inputs: args.inputs,
        model: args.model,
        entry_key: args.entryKey,
      }),
    });
  },

  // ── A. 能力发现 ──────────────────────────────────────────────────────────

  "narrative:list-genres": async (_args: Record<string, never>, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/genres`);
  },

  "narrative:list-modes": async (_args: Record<string, never>, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/modes`);
  },

  /** G3：席位发现——二十席的 id/名称/是否能被单独调用/单跑前还缺什么输入。 */
  "narrative:list-seats": async (_args: Record<string, never>, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/seats`);
  },

  // ── B. 读产出 ────────────────────────────────────────────────────────────

  "narrative:list-files": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/files/${encodeURIComponent(args.runId)}`);
  },

  /**
   * 确认状态表（3.1）：这个条目里哪些产物是作者定稿的。
   *
   * 下游生成该引用哪一份就看这张表 —— 不在表里的落盘文件都只是原料与中间产物。
   * 跨任务的归档组织是另一回事（项目库），不在这张表里。
   */
  "narrative:list-assets": async (
    args: { entryKey: string; pipelineId?: string },
    ctx: ToolCtx,
  ) => {
    const query = args.pipelineId ? `?pipelineId=${encodeURIComponent(args.pipelineId)}` : "";
    return await apiFetch(
      `${getApiBase(ctx)}/assets/${encodeURIComponent(args.entryKey)}${query}`,
    );
  },

  "narrative:confirm-asset": async (
    args: {
      entryKey: string;
      path: string;
      pipelineId?: string;
      version?: number;
      confirmed?: boolean;
    },
    ctx: ToolCtx,
  ) => {
    return await apiFetch(`${getApiBase(ctx)}/assets/${encodeURIComponent(args.entryKey)}`, {
      method: "POST",
      body: JSON.stringify({
        path: args.path,
        pipelineId: args.pipelineId,
        version: args.version,
        confirmed: args.confirmed !== false,
      }),
    });
  },

  "narrative:read-file": async (args: ReadFileArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    const segs = String(args.filePath)
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    const url = `${base}/file/${encodeURIComponent(args.runId)}/${segs}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      throw Object.assign(new Error(msg), { code: "api_error", httpStatus: res.status });
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype.includes("application/json")) {
      const data = await res.json();
      const text = JSON.stringify(data, null, 2);
      if (text.length > READ_FILE_MAX_CHARS) {
        return {
          runId: args.runId,
          filePath: args.filePath,
          truncated: true,
          content: `${text.slice(0, READ_FILE_MAX_CHARS)}\n…(truncated)`,
        };
      }
      return { runId: args.runId, filePath: args.filePath, truncated: false, content: data };
    }
    const text = await res.text();
    const truncated = text.length > READ_FILE_MAX_CHARS;
    return {
      runId: args.runId,
      filePath: args.filePath,
      truncated,
      content: truncated ? `${text.slice(0, READ_FILE_MAX_CHARS)}\n…(truncated)` : text,
    };
  },

  "narrative:get-story-tree": async (args: DirArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/story-tree/${encodeURIComponent(args.dir)}`);
  },

  "narrative:get-pipeline-nodes": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/pipeline-nodes/${encodeURIComponent(args.runId)}`);
  },

  // ── C. 历史 / 断点续跑 ────────────────────────────────────────────────────

  "narrative:load-history": async (args: LoadHistoryArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/history/${encodeURIComponent(args.key)}/load`);
  },

  "narrative:resume-pipeline": async (args: ResumePipelineArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/resume`, {
      method: "POST",
      body: JSON.stringify({ dir: args.dir, model: args.model }),
    });
  },

  // ── D. 编辑评估 ──────────────────────────────────────────────────────────

  "narrative:get-stale-steps": async (args: StaleStepsArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    const qs = new URLSearchParams({
      sourceDir: args.sourceDir,
      fromStepId: args.fromStepId,
    }).toString();
    return await apiFetch(`${base}/stale-steps?${qs}`);
  },

  "narrative:analyze-impact": async (args: AnalyzeImpactArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/analyze-impact`, {
      method: "POST",
      body: JSON.stringify({
        sourceDir: args.sourceDir,
        modifications: args.modifications,
      }),
    });
  },

  /**
   * G4：与界面文本视图"保存"同一落盘端点。改完接着调 narrative:analyze-impact +
   * narrative:regenerate-step，就是与界面等价的"改稿 → 影响面预览 → 确认重生成"路径。
   */
  "narrative:save-step-edit": async (args: SaveStepEditArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/save-step-edit`, {
      method: "POST",
      body: JSON.stringify({
        sourceDir: args.sourceDir,
        stepId: args.stepId,
        nodeId: args.nodeId,
        editedContent: args.editedContent,
        userInput: args.userInput,
      }),
    });
  },

  "narrative:restore-original": async (args: RestoreOriginalArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/restore-original`, {
      method: "POST",
      body: JSON.stringify({
        sourceDir: args.sourceDir,
        stepId: args.stepId,
        nodeId: args.nodeId,
      }),
    });
  },

  // ── E. 评审 ──────────────────────────────────────────────────────────────

  "narrative:get-review": async (args: DirArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/review/${encodeURIComponent(args.dir)}`);
  },

  "narrative:set-review": async (args: SetReviewArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/review/${encodeURIComponent(args.dir)}`, {
      method: "POST",
      body: JSON.stringify({
        stepId: args.stepId,
        status: args.status,
        feedback: args.feedback,
        regenerateRunId: args.regenerateRunId,
      }),
    });
  },

  // ── F. IP DNA 叙事操作系统（蓝图 §5/§10/§15）─────────────────────────────

  "narrative:ip-dna-start": async (args: IpDnaStartArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/start`, {
      method: "POST",
      body: JSON.stringify({
        files: await toWireFiles(args.files, ctx),
        title: args.title,
        mode: args.mode,
        scope_selections: args.scopeSelections,
        game_unit_plan: args.gameUnitPlan,
        adaptation_dimensions: args.adaptationDimensions,
        adaptation_notes: args.adaptationNotes,
        target_units: args.targetUnits,
        complexity: args.complexity,
        run_generation: args.runGeneration,
        max_game_units: args.maxGameUnits,
        tier: args.tier,
        generation_mode: args.generationMode,
        route_group: args.routeGroup,
        genre_code: args.genreCode,
        model: args.model,
      }),
    });
  },

  "narrative:get-ip-dna": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}`);
  },

  // ── F.2 IP 半自动阶段门（§5.1）：ingest → hierarchy → (decompose) → confirm → extract/generate ──

  "narrative:ip-dna-ingest": async (args: IpDnaIngestArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/ingest`, {
      method: "POST",
      body: JSON.stringify({
        files: await toWireFiles(args.files, ctx),
        title: args.title,
        decompose: args.decompose,
        model: args.model,
        async: args.async,
        story_timestamp: args.storyTimestamp,
      }),
    });
  },

  "narrative:ip-dna-get-hierarchy": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/hierarchy`);
  },

  "narrative:ip-dna-decompose": async (args: RunIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/decompose`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  "narrative:ip-dna-confirm-scope": async (args: IpDnaConfirmScopeArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/confirm-scope`, {
      method: "POST",
      body: JSON.stringify({ scope_selections: args.scopeSelections, scope_full: args.scopeFull, adaptation_notes: args.adaptationNotes }),
    });
  },

  "narrative:ip-dna-confirm-units": async (args: IpDnaConfirmUnitsArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/confirm-units`, {
      method: "POST",
      body: JSON.stringify({
        game_unit_plan: args.gameUnitPlan,
        adaptation_dimensions: args.adaptationDimensions,
        mode: args.mode,
        target_units: args.targetUnits,
      }),
    });
  },

  "narrative:ip-dna-extract": async (args: IpDnaExtractGenerateArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/extract`, {
      method: "POST",
      body: JSON.stringify({
        tier: args.tier,
        generation_mode: args.generationMode,
        complexity: args.complexity,
        max_game_units: args.maxGameUnits,
        equip_operators: args.equipOperators,
        model: args.model,
        async: args.async,
      }),
    });
  },

  "narrative:ip-dna-generate": async (args: IpDnaExtractGenerateArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/${encodeURIComponent(args.runId)}/generate`, {
      method: "POST",
      body: JSON.stringify({
        tier: args.tier,
        generation_mode: args.generationMode,
        complexity: args.complexity,
        max_game_units: args.maxGameUnits,
        equip_operators: args.equipOperators,
        model: args.model,
        async: args.async,
      }),
    });
  },

  "narrative:ip-dna-get-job": async (args: JobIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/job/${encodeURIComponent(args.jobId)}`);
  },

  // 取消生产（§5.1）：与前端 UI「取消生成」按钮能力对等（agent 也能取消 IP DNA 异步任务）。
  "narrative:ip-dna-cancel": async (args: JobIdArg, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/job/${encodeURIComponent(args.jobId)}/cancel`, {
      method: "POST",
    });
  },

  "narrative:ip-dna-analyze-impact": async (args: IpDnaAnalyzeImpactArgs, ctx: ToolCtx) => {
    const base = getApiBase(ctx);
    return await apiFetch(`${base}/ip-dna/analyze-impact`, {
      method: "POST",
      body: JSON.stringify({ runId: args.runId, changedKeys: args.changedKeys }),
    });
  },
};

export default tools;
