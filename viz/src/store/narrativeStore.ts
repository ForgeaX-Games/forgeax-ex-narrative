import { create } from "zustand";
import type {
  TierId,
  ModeId,
  PipelineProgress,
  NarrativeContext,
  StepStatus,
  TierModeInfo,
  AnnounceStepGroup,
} from "../types";
import { PIPELINE_STEPS } from "../types";
import { sendToHost } from "../lib/bridge";
import type { UploadedItem } from "../lib/uploads";
import type { EntryStatus, DraftState } from "../utils/stepDisplay";
import { computePhase, isCompositionEditable, type NarrativePhase } from "./phase";
import { runControls } from "./runState";
import { laneSourceDir } from "./laneAddress";
import { t as tGlobal, tStepLabel } from "../i18n";
import {
  composerUploads,
  computeAnchoredPipelines,
  findCatalogItem,
  instantiateComposerNode,
  ENTRY_CATALOG_ID,
  type ComposerCatalogItem,
  type ComposerNodeData,
  type ComposerEdgeData,
  type AnchoredPipeline,
} from "../composer/composerCatalog";

export { computePhase };
export type { NarrativePhase };

export type ViewMode = "text" | "graph";

/**
 * 叙事上传的三个入口：直接输入 / 标签选择 / 文件上传。
 * 它们只长在节点视图的输入节点里——没有独立的上传面板。
 */
export type InputTab = "text" | "tags" | "file";

/**
 * 创作空间顶栏三段——它现在是纯粹的工具栏：
 * 叙事策划专家组（按品类预制的多 agent 管线）/ 叙事单品助手团队（二十席基础 agent）/
 * 自定义专属团队（用户投喂作品蒸馏出的私有助手）。
 *
 * 上传与路由不在这里，也不在任何悬空面板里：需求由节点视图的输入节点写，
 * 或由外侧平台对话栏说；路由缺项交给后端推断。视图切换与缩放归底栏。
 */
export type NavTab = "experts" | "units" | "custom";

/** 左栏两块：任务管理（每次对话开启的生成）与项目管理（用户自建的资产库）。 */
export type LeftSection = "tasks" | "projects";

/**
 * 左栏被点开的那一份产物——右侧两个视图都跟着它走。
 *
 * 文本模式直接把这份文件的正文铺出来，节点模式则把画面挪到产它的那个节点上。
 * 两种模式看的是同一份后端数据，所以选中态只有一个，放在 store 里跨 iframe 同步。
 */
export interface FocusedFile {
  /** 产物所属的任务条目键，取内容时要用。 */
  taskKey: string;
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  name: string;
}

/**
 * 路由选择草稿：创作空间顶栏「叙事路由 / 叙事工具」写的就是这一份。
 *
 * 与 activeConfig 的分工：activeConfig 是**某个条目**的启动快照，切条目/取消选中会被清空；
 * 这份是**当前正在配的**参数，属于 UI 配置，和 tier/mode 一样跨条目存活。
 *
 * 全量放 store（而非组件本地 useState）是布局重构的硬要求：路由 UI 在中栏 iframe，
 * 执行启动的 NarrativeRuntimeProvider 在左栏 iframe，两者只能靠 BroadcastChannel 同步的 store 通信。
 */
export interface RoutingDraft {
  /** 叙事全量（planning，走游戏品类专家）/ 叙事单品（narrative，走单品助手）。 */
  routeGroup: "planning" | "narrative";
  /** 叙事层级选择；"auto" = 交给后端检测。层级已降级为品类只读属性，这里仅作品类筛选用。 */
  tierChoice: TierId | "auto";
  /** 叙事单品路由。 */
  narrativeRoute: ModeId;
  genreCode: string | null;
  /** 叙事体量档位 1-5。 */
  complexity: number;
  /** 用户是否手改过体量（改过就不再按层级套默认值）。 */
  complexityTouched: boolean;
  storyType: string | null;
  storyTheme: string | null;
}

/**
 * 需求输入原料草稿：直接输入 / 标签选择 / 文件上传三个入口共写这一份。
 * 同样因为编辑面板在中栏、落盘执行在左栏而必须放 store。
 */
export interface InputDraft {
  userInput: string;
  tagSelections: Record<string, string>;
  tagCustomTexts: Record<string, string>;
  uploadedFiles: UploadedItem[];
}

/** IP DNA 异步任务（重需求路径）的前端镜像。 */
export interface IpDnaJobState {
  jobId: string;
  status: import("../hooks/useNarrativeStream").IpDnaJobStatus["status"];
  stage?: string;
  progress?: number;
  message?: string;
  error?: string;
  result?: import("../hooks/useNarrativeStream").IpDnaJobStatus["result"];
}

/**
 * 跨 pane 命令信道的动作集。
 *
 * 中栏底部的操作条和输入面板只写命令槽，真正执行落在 owner（左栏/独立）那一侧的
 * NarrativeRuntimeProvider —— 否则两个 iframe 各跑一遍 startRun / saveEntry 会重复落盘。
 */
export type NarrativeCommandKind =
  | "start"
  | "cancel"
  | "resume"
  | "regenerate"
  | "confirmInput"
  | "saveEntry";

export interface NarrativeCommand {
  kind: NarrativeCommandKind;
  /** 单调递增序号：owner 侧据此去重，避免同一条命令被重复消费。 */
  nonce: number;
}

export interface EditDraft {
  content?: unknown;
  userInput?: string;
  editing?: boolean;
  saved?: boolean;
}

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  message?: string;
  data?: unknown;
  /**
   * 后端声明这一条只是运行横幅（管线配置那类），不对应任何 agent。
   * 画布据此不为它画节点；进度条与运行日志照旧使用。
   */
  isMeta?: boolean;
  /** status === "skipped" 时后端给的原因（缺哪些字段 / 该先跑哪几席 / 一句话提示）。 */
  skipInfo?: PipelineProgress["skipInfo"];
}

/**
 * Phase-2 M8：一条管线的运行 lane。
 * 同条目多管线并发时每条各有 runId 与 SSE 流，进度互不覆盖。
 */
export interface PipelineRunLane {
  pipelineId: string;
  runId: string;
  /** 该管线落盘目录（主管线 = 条目名；次管线 = `<key>/pipelines/<pipelineId>`）。 */
  sourceDir: string;
  /** 主管线走 runningRunId 主轨；次管线由 useSecondaryPipelineStreams 独立消费。 */
  primary: boolean;
  status: "running" | "completed" | "failed";
  /** 本轨已完成的 step id（按到达序）。 */
  completedSteps: string[];
  /** 本轨当前正在跑的 step id。 */
  runningStepId: string | null;
  /** 本轨失败时停在哪一步（失败帧不带 stepId，取失败瞬间的 runningStepId）。 */
  failedStepId?: string | null;
  error?: string;
}

/**
 * Run lifecycle modes — 决定 pipeline_steps_announce 帧的渲染策略：
 *  - "start"  / "resume"：渐进式渲染（节点按 step_start/step_done 增量出现）
 *                         announce 帧只缓存 pipelineOrder（备总步数/导航用），不预填节点
 *  - "fork"           ：预填全量节点（已完成 + 受影响），便于用户一眼看出"哪些保留 / 哪些重跑"
 */
export type RunMode = "start" | "resume" | "fork" | null;

/**
 * 分叉待决的改动类型（§状态机核心）：
 *  - "input"   改了原料（INPUT）——原料在「确认」时冻结，改动须重点「确认」铸新条目并全量重跑。
 *  - "routing" 改了路由（ROUTING）——路由在「开始生成」时提交，改动点「开始生成」铸新条目、复用预处理/IP DNA。
 *  - null      无待决分叉。
 */
export type ForkKind = "input" | "routing" | null;

/**
 * Phase 2: 当前查看 entry 的"启动管线快照"。
 * 来自 `/api/narrative/history/:key/load` 返回的字段（Phase 1 后端补齐）。
 *
 * 用途：让 INPUT 文本框 / ROUTING 品类 chip / 复杂度选项 / PIPELINE STATUS 节点序
 * 全部以 store 为唯一权威源，避免散落在 TierModeSelector 本地 useState 时
 * 切 entry 易漏恢复（§4.② §4.③ 直接根因 V8 / V9）。
 *
 * 字段全部可选 —— 旧 entry 缺字段时 fallback 到本地 useState（双写过渡期）。
 */
export interface ActiveConfig {
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  tier?: TierId | null;
  mode?: ModeId | null;
  /** 叙事体量档位（1-5）；UI 上叫「叙事体量」，字段名沿用 complexity。 */
  complexity?: number;
  genreCode?: string | null;
  /** 三轴路由（PRD v1.4 §3.2.2）：叙事类型 / 叙事题材；结构由后端综合推导后回填。 */
  storyType?: string | null;
  storyTheme?: string | null;
  narrativeStructure?: string | null;
  /** Phase 1 持久化的"权威步骤序"，给 PipelineStatus 在非 running 时也能展示完整管线 */
  pipelineOrder?: string[];
  routingMode?: "auto" | "semi" | "manual";
  /**
   * 外部挂载（narrative:attach-run，由 Kotone 启动管线触发）时打的时间戳令牌。
   * 仅用于触发 TierModeSelector 把 tier/mode/genre/userInput 回填到本地选择器；
   * 手动启动/编辑流程从不设置它，故不会干扰用户正在进行的编辑。
   */
  hydrateToken?: number;
}

interface NarrativeState {
  // ---- Active branch (currently viewed entry) ----
  activeEntryKey: string | null;
  /**
   * 当前查看条目的**产物目录**（相对 `output/`）。主管线等于 activeEntryKey，
   * 次管线是 `<entryKey>/pipelines/<pipelineId>`。
   *
   * 与 activeEntryKey 分开存，是因为两者职责不同：条目锚点用来认「这是哪个任务」
   * （历史列表、fork、配置还原），产物目录用来寻址「文件在哪」。主管线下两者恰好
   * 相等，历史上因此一直混用同一个字段，次管线一出现就错（见 docs/contracts.md §1.3）。
   * 为 null 时读侧退回 activeEntryKey。
   */
  activeSourceDir: string | null;
  activeEntryStatus: EntryStatus;
  /**
   * 这个条目有没有断点可续（后端 history 的 `canResume` = 有 `_checkpoint.json` 且不在跑）。
   *
   * 与 `activeEntryStatus` 分开存，因为 `interrupted` 有两种：有断点的（界面上说的
   * "暂停"，主键给续跑）与没断点的（第一步就挂了，只能重开）。混成一个，界面就会对后者
   * 给出一个必然 404 的"断点续传"键。派生规则见 store/runState.ts。
   */
  activeCanResume: boolean;
  activeSteps: StepState[];
  activeResult: NarrativeContext | null;
  /** Phase 2: 当前查看 entry 的启动管线快照（用于 UI 恢复 INPUT/ROUTING/PIPELINE STATUS） */
  activeConfig: ActiveConfig | null;

  // ---- Running context (background pipeline) ----
  runningEntryKey: string | null;
  /** 运行中管线的产物目录（同 activeSourceDir 的语义，针对后台那条轨）。 */
  runningSourceDir: string | null;
  runningRunId: string | null;
  runningProgress: StepState[];
  /** 后端 announce 帧下发的完整管线步骤序列；用于已知总步数但未渲染节点时的进度指示 */
  pipelineOrder: string[];
  /**
   * 步骤的专家归属（announce 帧下发）。画布用它把同属一条席位管线的步骤收进
   * 一个可展开的专家容器；空数组表示无归属信息，退回一排同级节点。
   */
  stepGroups: AnnounceStepGroup[];
  /** 当前运行采用哪种渲染策略（决定 announce 帧是否预填节点） */
  runMode: RunMode;
  /**
   * IP 半自动预览运行轨（§5.1）。与 runningRunId 解耦的独立旁路：
   * IP 处理走 job 轮询而非 SSE，故不能复用 runningRunId（否则 useNarrativeStream 会对
   * 不存在的 /stream/:id 开 EventSource 触发 404 重连风暴，并撞 handleStart 并发守卫）。
   * 非空时，中间预览（useOrderedSteps / TextViewPanel / NarrativeCanvas）把当前 entry 视为
   * "运行中"，读取 runningProgress + pipelineOrder，使 IP 各步带 data 实时投影到文本/节点模式。
   */
  ipPreviewRunId: string | null;
  /**
   * IP 运行磁盘键（`<时间戳>_<标题>` = ingest 返回的 run_id）。与 ipPreviewRunId（合成预览轨 id）
   * 不同：它是真实落盘运行键，供「按环节浏览文件」按 key 读取 input/ 与 output/ 两侧文件。
   * 历史回看时改用 activeEntryKey（=目录名=同一 key），故仅需在半自动预览期间持有此值。
   */
  ipRunKey: string | null;

  // ---- 顶层交互状态机信号（§状态机重构，phase 派生依赖） ----
  /**
   * 首次输入确认已发生（直接输入/标签选择/IP作品 任一「确定」）→ 条目已建立。
   * 与 activeEntryKey 一起构成"已进入 INPUT 阶段"的判据；生成完成/reset 后复位。
   */
  inputConfirmed: boolean;
  /** ROUTING 是否已显式选定叙事路由（从 TierModeSelector 上提，使 phase 完全可派生）。 */
  routingConfigured: boolean;
  /** IP DNA 下游生成 job 进行中（半自动重需求路径的"生成中"信号，与 runningRunId 并列驱动 phase=generating）。 */
  ipDnaGenerating: boolean;
  /**
   * 分叉待决（§状态机核心，泛化自 point2）：在**已独立条目**（确认后 config / 预处理 / 中断 / 完成）
   * 上改了 INPUT 或 ROUTING，代表一个新需求。预览仍停在旧条目，此标记只点亮相应提交键；
   * 真正的新条目在下一个提交动作（INPUT→「确认」/ ROUTING→「开始生成」）时才铸造。原条目全量保留。
   */
  pendingFork: boolean;
  /** 分叉待决的改动类型：input（改原料，「确认」提交，全量重跑）/ routing（改路由，「开始生成」提交，复用预处理）。 */
  pendingForkKind: ForkKind;

  // ---- 无限画布编排（composer 切片） ----
  /** 编排态自由拖拽的节点（与只读管线节点解耦，仅在"未生成"态可编辑）。 */
  composerNodes: ComposerNodeData[];
  /** 编排态自由连线（活连接）。 */
  composerEdges: ComposerEdgeData[];

  // ---- Phase-1 多管线条目（O 侧） ----
  /**
   * 当前条目下的多管线清单（RunManifest 子集）。
   * 旧条目为空 → UI 退化为单轨 pipelineOrder。
   */
  entryPipelines: import("../hooks/useNarrativeStream").RunManifestDto[];
  /** 当前聚焦管线；状态栏/文本视图默认展示该轨。 */
  activePipelineId: string | null;
  /** LIST 中哪些条目展开了多管线子行（本地 UI，不必持久化到每条）。 */
  listExpandedKeys: string[];
  /**
   * Phase-2 M8：每条管线各自的运行 lane（pipelineId → run 状态 + 该轨进度）。
   * 主管线同时也在 runningRunId 里（驱动 phase / 取消 / auto-attach 不变）；
   * 次管线只活在这里，由 useSecondaryPipelineStreams 各开一条 SSE 消费。
   */
  pipelineRuns: Record<string, PipelineRunLane>;

  // ---- Local drafts (bound to activeEntry) ----
  editDrafts: Record<string, EditDraft>;

  // ---- Config ----
  tier: TierId | null;
  mode: ModeId | null;
  autoDetect: boolean;
  availableModes: TierModeInfo[];

  // ---- UI state ----
  viewMode: ViewMode;
  /**
   * 需求输入入口（PRD v1.4 §5：直接输入 / 标签选择 / 文件上传）。
   * 提到 store 是因为顶栏「需求输入」tab 与左栏输入区要双向同步：
   * 任一处切入口，另一处立刻跟随，两边不各持一份 useState。
   */
  inputTab: InputTab;
  /** 左栏点开的那份产物；null = 右侧照常显示本次运行的产物。 */
  focusedFile: FocusedFile | null;
  /**
   * 顶栏当前展开的级联菜单；null 表示全收起。
   * 放 store 而非组件内，是为了让「点条目/选完品类就自动收起」这类跨组件动作可达。
   */
  openNavTab: NavTab | null;
  /** 左栏当前所在的那一块：任务管理还是项目管理。 */
  leftSection: LeftSection;
  /**
   * 左栏被双击"进入"的任务条目键。
   * 非空 = 从任务列表切到该任务内部（按类别铺开的产物）；单击选中条目不改这个值。
   */
  openedTaskKey: string | null;
  /** 项目管理里被打开的那个项目 id；非空 = 从项目列表切到项目内部。 */
  openedProjectId: string | null;
  routing: RoutingDraft;
  input: InputDraft;
  /**
   * ROUTING「确认保存」脏态。true=有未保存改动（按钮亮）；false=已落盘（按钮灰）。
   * 建立条目/任一 INPUT|ROUTING 参数变更时置 true；确认保存或开始生成（兜底落盘）后置 false。
   */
  entryDirty: boolean;
  ipDnaJob: IpDnaJobState | null;
  /** IpStageFlow 上报的「改编范围已确认、可以生成」。重需求路径的开始生成前置条件。 */
  ipCanGenerate: boolean;
  /** 启动/续跑/重生成正在提交（按钮转圈）。 */
  runtimeBusy: boolean;
  /** 输入/路由/启动链路的错误提示，左右两栏共用一处展示。 */
  runtimeError: string | null;
  /** 待 owner 执行的命令；执行后由 owner 清空。 */
  pendingCommand: NarrativeCommand | null;
  /**
   * 磁盘条目已变更的通知计数。
   *
   * 落盘动作（建条目 / 保存配置 / 取消 job）可能发生在任一 pane，而项目清单只由 owner 持有；
   * 改动方 bump 一下，owner 侧看到计数变化就重拉 /history，不必知道谁改的。
   */
  historyRevision: number;
  focusedStepId: string | null;
  focusedChildNodeId: string | null;
  expandedStepId: string | null;
  collapsedGraphIds: string[];
  /**
   * 人手把某个节点从布局标准位拖开的位移（存差值，不存绝对坐标）。
   *
   * 布局是纯函数，每来一帧进度就重算一次；只有把"人的意图"单独记下来，
   * 拖过的节点才不会在下一帧被算回原位。存差值而非绝对位，是因为新节点入场时
   * 整排会平移，差值仍然成立，绝对位会错。
   */
  nodeDrags: Record<string, { dx: number; dy: number }>;
  /**
   * 上面那批位移是在哪个条目上拖的。
   *
   * 位移只对它所属的那张图有意义，换了条目就该作废。这里记一个归属键、
   * 由读取方比对，而不是在每条"切条目"的路径上各清一次——切条目的入口有好几个
   * （loadEntry、selectEntry 的几条快路、草稿恢复），靠每处都记得清，
   * 漏一处就会看到上一条目的卡歪在这一条目的画布上。
   */
  nodeDragsEntryKey: string | null;
  /** STEP2 预演链路：左栏算好的"待生成"步骤序，写入 store 供右栏 PIPELINE STATUS 跨 iframe 读取（fresh-config 预览）。 */
  previewOrder: string[] | null;
  /** 当前预演是否为"自动"模式（planning + auto tier）；右栏据此显示"由 LLM 判定"提示。 */
  previewIsAuto: boolean;

  streamingChunks: Record<string, string>;
  streamPlayedSteps: string[];
  runStartedAt: number;
  liveCompletedSteps: string[];
  animatingStepId: string | null;
  animPlayedNodes: string[];

  // ---- Actions: config ----
  setConfig: (tier: TierId | null, mode: ModeId | null, autoDetect: boolean) => void;
  setInputTab: (tab: InputTab) => void;
  setFocusedFile: (file: FocusedFile | null) => void;
  setOpenNavTab: (tab: NavTab | null) => void;
  setLeftSection: (section: LeftSection) => void;
  openTask: (entryKey: string) => void;
  closeTask: () => void;
  openVaultProject: (projectId: string) => void;
  closeVaultProject: () => void;
  setRouting: (patch: Partial<RoutingDraft>) => void;
  setInput: (patch: Partial<InputDraft>) => void;
  setUploadedFiles: (next: UploadedItem[] | ((prev: UploadedItem[]) => UploadedItem[])) => void;
  setEntryDirty: (v: boolean) => void;
  setIpDnaJob: (next: IpDnaJobState | null | ((prev: IpDnaJobState | null) => IpDnaJobState | null)) => void;
  setIpCanGenerate: (v: boolean) => void;
  setRuntimeBusy: (v: boolean) => void;
  setRuntimeError: (msg: string | null) => void;
  /**
   * 统一的"用户改了 INPUT/ROUTING 配置"钩子。
   *
   * 状态机契约：配置 = 因 / 管线状态 = 果 / 历史条目 = 书签。
   *  1) 确认前（无独立条目）：纯内存自由编辑，无副作用。
   *  2) config 阶段（已确认输入、未投产）：改 INPUT 置 pendingFork(input) 重新点亮「确认」；
   *     改 ROUTING 只置脏态，由「确认保存」或「开始生成」提交。
   *  3) 已投产：任何改参都是新需求 → 懒 fork，真正铸新键发生在提交动作。
   *
   * 只在 onClick / onChange 里调；回填路径（loadEntry / hydrate）直接写草稿，不经这里。
   */
  notifyConfigChange: (kind: "input" | "routing") => void;
  /** §取消选中：把 INPUT/ROUTING 草稿清回初始默认。 */
  resetFormDraft: () => void;
  /** 中栏发起动作：只写命令槽，由 owner 侧 Provider 消费。 */
  requestCommand: (kind: NarrativeCommandKind) => void;
  /** owner 执行完后清槽（带 nonce 防止清掉后来的新命令）。 */
  clearCommand: (nonce: number) => void;
  /** 通知 owner：磁盘条目变了，重拉项目清单。 */
  bumpHistory: () => void;
  setAvailableModes: (modes: TierModeInfo[]) => void;

  // ---- Actions: 顶层状态机信号 ----
  /** ROUTING 选定/取消（TierModeSelector 上提到 store，供 phase 派生与跨 iframe 同步）。 */
  setRoutingConfigured: (v: boolean) => void;
  /** IP DNA 下游生成 job 起/止（半自动路径的"生成中"信号）。 */
  setIpDnaGenerating: (v: boolean) => void;
  /** 分叉待决置位/复位。传 kind 一并记录改动类型（默认 v=false 时清为 null）。 */
  setPendingFork: (v: boolean, kind?: ForkKind) => void;
  /**
   * 首次输入确认时建立"草稿条目"（§条目提前建立）：把 entryKey 锚定为当前条目，
   * 后续 INPUT/ROUTING/预处理/生成全部挂在该 key 下。status 保持 null（草稿=未生成）。
   * inputMeta 写入 activeConfig，供 LIST 虚拟条目展示与 hydrate。
   */
  beginDraftEntry: (entryKey: string, inputMeta?: Partial<ActiveConfig>) => void;

  // ---- Actions: run lifecycle ----
  /**
   * `sourceDir` 缺省即等于 entryKey（主管线的常态）。次管线必须显式传，
   * 否则文件读取会去条目根找一份不在那里的产物。
   */
  startNewRun: (runId: string, entryKey: string, tier?: TierId, mode?: ModeId, sourceDir?: string) => void;
  startFork: (runId: string, newEntryKey: string, sourceEntryKey: string, tier?: TierId, mode?: ModeId, preloadSteps?: StepState[]) => void;
  startResume: (runId: string, entryKey: string, tier?: TierId, mode?: ModeId) => void;
  /**
   * 启动 IP 半自动预览运行轨（§5.1）。order = IP 前驱步骤序（ip_input…ip_dna_extract，
   * 可含 ip_decompose），seed 为 pending 节点。之后 pushProgress 把各步推成 running/completed
   * 并携带可读正文 data，文本/节点模式据此同源渲染。
   */
  startIpPreviewRun: (runId: string, entryKey: string, order: string[]) => void;
  /** 设定 IP 运行磁盘键（ingest 返回 run_id 时回填），供文件浏览按 key 读取两侧文件。 */
  setIpRunKey: (key: string | null) => void;
  /** IP 预览结束（完成/失败）：清旁路，固化 pipelineOrder 到 activeConfig 以保持非运行态有序。 */
  finishIpPreview: (status?: "completed" | "interrupted") => void;
  pushProgress: (p: PipelineProgress) => void;
  completeRun: (result: NarrativeContext, newEntryKey?: string) => void;
  failRun: (error: string) => void;
  /** Update the running entry's key (e.g., when backend reveals the real directory name) */
  updateRunningEntryKey: (newKey: string) => void;
  cancelRun: () => void;

  // ---- Actions: branch switching ----
  loadEntry: (opts: {
    entryKey: string;
    tier: TierId | null;
    mode: ModeId | null;
    result: NarrativeContext;
    status?: string;
    /** 后端 history 的 `canResume`：有 `_checkpoint.json` 且不在跑。缺省按"没断点"处理。 */
    canResume?: boolean;
    steps?: StepState[];
    /**
     * Phase 2: entry 的启动管线快照。来自 /history/:key/load。
     * 缺失字段（旧 entry）时不会清掉，让 TierModeSelector 的本地 fallback 兜底。
     */
    config?: ActiveConfig;
    /**
     * 该条目的专家/席位嵌套结构（后端按品类 + 层级现算）。
     *
     * 没有它，历史回放的画布只能铺一排扁平卡片——跑的时候是三层嵌套、
     * 事后打开却看不出谁属于哪个专家。旧后端不给这个字段时按空处理，退回扁平。
     */
    stepGroups?: AnnounceStepGroup[];
  }) => void;
  /** Phase 2: 单独更新 activeConfig 部分字段（保留双写过渡期手动打补丁的能力）。 */
  setActiveConfig: (patch: Partial<ActiveConfig> | null) => void;

  /**
   * 退出 viewing-history，进入 fresh-config 态。
   *
   * 语义：历史条目（HISTORY）= 书签 / 配置（INPUT/ROUTING）= 因 / 管线（PIPELINE STATUS）= 果。
   * 三者一一对应但解耦。本 action 用于把 entry 书签解除，让 PIPELINE STATUS 不再展示
   * 历史快照而是基于当前配置的预览。
   *
   * 触发场景：
   *   1) 用户在 history 里再次点击当前选中的 entry（"再点取消选中"）
   *   2) 用户改了 INPUT/ROUTING 配置（自动解除 viewing 锁定）
   *
   * 清空：activeEntryKey/activeEntryStatus/activeSteps/activeResult/activeConfig
   *       editDrafts（draft 是 entry 维度的，离开 entry 自动失效）
   *       focusedStepId/expandedStepId/collapsedGraphIds（UI 局部状态）
   *       streamingChunks/streamPlayedSteps/animatingStepId（动画/流式状态）
   * 保留：tier/mode/userInput 等 UI 配置（用户可在 fresh 态继续编辑）
   *       runningRunId/runningEntryKey/runningProgress（独立 lane，SSE 仍在跑）
   *       pipelineOrder（仅当还有 running 时有意义；否则 PipelineStatus 会忽略它）
   */
  clearActiveEntry: () => void;
  /**
   * 显式取消选中当前条目（§状态机：LIST 再点同一条目）。与 clearActiveEntry 不同：
   * 强制清空，绕过 IP 预览守卫，连预览轨/ipRunKey/运行进度一并清掉，彻底回 idle 全新空白。
   */
  deselectEntry: () => void;
  /** 清上一条目的预览/运行上下文（建新条目前调，避免 pipeline 残留旧节点）。 */
  resetPreviewContext: () => void;

  // ---- Actions: drafts ----
  setEditDraft: (key: string, draft: Partial<EditDraft>) => void;
  clearEditDraft: (key: string) => void;
  clearAllDrafts: () => void;

  // ---- Actions: UI ----
  setViewMode: (mode: ViewMode) => void;
  /** STEP2 路由变化时，左栏把算好的预演链路推进 store（BroadcastChannel 同步给右栏 PIPELINE STATUS）。 */
  setPreviewOrder: (order: string[] | null, isAuto?: boolean) => void;
  setFocus: (stepId: string | null, childNodeId?: string | null) => void;
  appendStreamChunk: (stepId: string, chunk: string) => void;
  markStreamPlayed: (stepId: string) => void;
  markLiveCompleted: (stepId: string) => void;
  markAnimPlayed: (nodeId: string) => void;
  finishAnimation: (stepId?: string) => void;
  toggleGraphCollapse: (nodeId: string) => void;
  setCollapsedGraphIds: (ids: string[]) => void;
  /** 累加某节点被拖动的位移（父子节点都按各自坐标系的差值记）。 */
  nudgeNode: (nodeId: string, dx: number, dy: number) => void;
  /** 「复原」：丢掉所有人手位移，回到布局标准位。 */
  resetNodeDrags: () => void;

  reset: () => void;
  snapshot: () => string;
  restore: (json: string) => boolean;

  // ---- Actions: composer（无限画布编排） ----
  /** 拖入一个角色节点，返回新节点 id。 */
  addComposerNode: (item: ComposerCatalogItem, position: { x: number; y: number }) => string;
  /** 更新节点位置（拖动持久化）。 */
  moveComposerNode: (id: string, position: { x: number; y: number }) => void;
  /** 新建一条活连接（去重、禁自环）。 */
  connectComposer: (source: string, target: string) => void;
  /** 删除节点及其相连边。 */
  removeComposerNode: (id: string) => void;
  /** 删除单条边。 */
  removeComposerEdge: (id: string) => void;
  /** 打补丁式更新节点级配置。 */
  setComposerNodeConfig: (id: string, patch: Record<string, unknown>) => void;
  /** 清空编排画布。 */
  clearComposer: () => void;
  /** 按分层（左→右）布局算法重排全部节点位置（仅手动触发，不自动刷新）。 */
  relayoutComposer: () => void;

  /** 写入当前条目的多管线清单；可选同步 activePipelineId 与 previewOrder。 */
  setEntryPipelines: (
    pipelines: import("../hooks/useNarrativeStream").RunManifestDto[],
    activePipelineId?: string | null,
  ) => void;
  setActivePipelineId: (id: string | null) => void;
  /**
   * G1：切次管线泳道后，把该泳道自己的 checkpoint/full_result（由调用方经
   * `loadHistoryResult(sourceDir)` 取回）灌回中间区。`setActivePipelineId` 本身只换
   * 指针与产物目录，不读盘——不然中间区会在换目录的一瞬间读到上一条泳道的数据。
   * `forSourceDir` 做一次陈旧响应校验：切换很快时，晚到的旧泳道数据不应覆盖新泳道。
   */
  applyLaneResult: (
    forSourceDir: string,
    data: { result?: NarrativeContext; stepGroups?: AnnounceStepGroup[] },
  ) => void;
  /** Phase-2 M8：登记本次条目级批量启动的全部 lane。 */
  setPipelineRuns: (lanes: PipelineRunLane[]) => void;
  /** 单 lane 增量更新（SSE 帧驱动）。 */
  updatePipelineRun: (pipelineId: string, patch: Partial<PipelineRunLane>) => void;
  /** 记录某 lane 的 step 进度。 */
  markPipelineRunStep: (
    pipelineId: string,
    stepId: string,
    status: "running" | "completed",
  ) => void;
  toggleListExpanded: (entryKey: string) => void;
  /** 显式设置 LIST 多管线展开态（加载条目 / 编排落盘时用，避免 toggle 误收起）。 */
  setListExpanded: (entryKey: string, expanded: boolean) => void;

  // ---- Derived helpers ----
  hasDrafts: () => boolean;
  /** 以输入节点为锚点拆分出的可提交管线（孤立节点忽略）。 */
  getAnchoredPipelines: () => AnchoredPipeline[];
}

const STORAGE_KEY = "narrative-viz-snapshot";

const INITIAL_ROUTING: RoutingDraft = {
  routeGroup: "planning",
  tierChoice: "auto",
  narrativeRoute: "narrative_auto",
  genreCode: null,
  complexity: 2,
  complexityTouched: false,
  storyType: null,
  storyTheme: null,
};

const INITIAL_INPUT: InputDraft = {
  userInput: "",
  tagSelections: {},
  tagCustomTexts: {},
  uploadedFiles: [],
};

/**
 * id → ctx 字段的探测表（纯 result 恢复时靠它认出"这一步跑过了"）。
 *
 * label 一列只是**离线兜底**：这种恢复路径没有 SSE、也没有 announce，
 * 拿不到后端名字才用它。有后端名字的场合一律以后端为准（见 rebuildStepsFromResult）。
 */
const STEP_RESULT_MAP: Array<{ id: string; label: string; key: keyof NarrativeContext }> = [
  { id: "core_concept", label: "D0 核心概念", key: "core_concept" },
  { id: "system_architecture", label: "D1 系统架构", key: "system_architecture" },
  { id: "system_detail", label: "D2 玩法设计", key: "system_details" },
  { id: "value_framework", label: "D3 数值框架", key: "value_framework" },
  { id: "design_doc", label: "D4 策划案整合", key: "game_design_context" },
  // 需求清单席的两步实现。名字随架构走：这一席叫需求清单，不再用四期前的「偏好」说法。
  { id: "preference_summary", label: "需求提炼", key: "user_preference_summary" },
  { id: "preference_analysis", label: "需求分析", key: "user_preference_analysis" },
  // 合并步骤：用 initial_story_outline 作为存在性探针，rebuildStepsFromResult 会
  // 把它当作单个 initial_plan 节点恢复（label = "初步方案"）。data 字段在前端
  // 渲染时通过 result.initial_story_outline / core_settings / plot_synopsis 自取。
  { id: "initial_plan", label: "初步方案", key: "initial_story_outline" },
  { id: "worldview", label: "世界观构建", key: "worldview_structure" },
  { id: "story_framework", label: "故事框架", key: "story_framework" },
  { id: "outline_batch", label: "故事大纲", key: "outlines_generated" },
  { id: "detailed_outline", label: "故事细纲", key: "detailed_outlines_generated" },
  { id: "character_enrichment", label: "角色档案", key: "detailed_character_sheets" },
  { id: "item_database", label: "道具清单", key: "item_database" },
  { id: "plot_generation", label: "情节节点", key: "plots_generated" },
  { id: "script_generation", label: "剧本生成", key: "jrpg_script" },
  { id: "quest_generation", label: "任务生成", key: "quest_graph" },
  { id: "scene_plan", label: "场景生成", key: "scene_map" },
  { id: "narrative_card", label: "叙事卡", key: "narrative_card" },
  { id: "lore_generation", label: "Lore碎片", key: "lore_fragments" },
  // 质检席：报告即产物。少了这两条，从存档恢复时这两步会被当成"没跑过"。
  { id: "structure_check", label: "结构检查", key: "structure_check_report" },
  { id: "content_check", label: "内容检查", key: "content_check_report" },
  // B3 新模板步骤
  { id: "branch_tree", label: "分支树", key: "branch_tree" },
  { id: "dialogue_script", label: "对话脚本", key: "dialogue_script" },
  { id: "cinematic_storyboard", label: "影像分镜", key: "cinematic_storyboard" },
  { id: "region_design", label: "区域设计", key: "regions" },
  { id: "emergent_event", label: "涌现事件", key: "emergent_events" },
  { id: "card_lore", label: "卡牌Lore", key: "card_lore" },
  { id: "event_pool", label: "事件池", key: "event_pool" },
  // 互动影游 v2 专属管线（tpl-vn-v2）
  { id: "vn_logline", label: "E1-01 故事梗概", key: "vn_logline" },
  { id: "vn_outline_acts", label: "E1-02 三幕扩写", key: "vn_outline_acts" },
  { id: "vn_scenes", label: "E1-03 场搭建", key: "vn_scenes" },
  { id: "vn_beats", label: "E1-04 情节点", key: "vn_beats" },
  { id: "vn_script_normalize", label: "E2-01 剧本预处理", key: "vn_script_normalized" },
  { id: "vn_segment_confirm", label: "E2-02 文本段确认", key: "vn_segment_confirmed" },
  { id: "vn_branched_beats", label: "G-01 剧情树改造", key: "vn_branched_beats" },
  { id: "vn_screenplay", label: "G-02 剧本创作", key: "vn_screenplay" },
  { id: "vn_storyboard", label: "G-03 分镜设计", key: "vn_storyboard" },
];

/**
 * 老存档 / 旧 step ID → 当前 step ID 的迁移映射。
 * loadEntry / restore 时使用。
 *
 * INITIAL_PLAN 合并：原来三个独立步骤现在合并为 initial_plan，
 * 老存档加载时把这三个 ID 都迁移到 initial_plan，rebuildStepsFromResult
 * 再用存在性探针重建为单个节点。
 */
const STEP_ID_MIGRATION: Record<string, string> = {
  initial_story_outline: "initial_plan",
  initial_outline: "initial_plan",
  core_settings: "initial_plan",
  core_settings_extraction: "initial_plan",
  plot_synopsis: "initial_plan",
  worldview_construction: "worldview",
  detailed_outline_batch: "detailed_outline",
};

/**
 * 把任意（含老存档 / 合并前）step id 折叠到当前权威 id。
 * 所有"按 pipelineOrder 排序"的展示逻辑（节点模式 / 文本模式共用的 useOrderedSteps）
 * 都用它做归一，保证进度 id 必命中权威序，避免合并步骤（如 initial_plan）被当作
 * "序外节点"甩到最后一列。
 */
export function canonicalStepId(id: string): string {
  return STEP_ID_MIGRATION[id] ?? id;
}

/** 头部元节点（开场白），announce 整表替换时需保留，避免"出现又消失"。 */
const META_HEAD_IDS = ["tier_router", "pipeline_config"];

function rebuildStepsFromResult(result: NarrativeContext, existingSteps: StepState[]): StepState[] {
  const merged: StepState[] = [];
  const seen = new Set<string>();
  const mapEntryById = new Map(STEP_RESULT_MAP.map((e) => [e.id, e]));

  // Pass 1: 按 existingSteps 的传入顺序输出（权威序，来自 backend pipelineOrder/completedSteps），
  // 同时用 STEP_RESULT_MAP 把 ctx 里的 data 字段填进去。这样 vn entry 的步骤顺序不会被
  // 前端硬编码的 RPG-centric STEP_RESULT_MAP 顺序覆盖。
  for (const s of existingSteps) {
    if (seen.has(s.id)) continue;
    const entry = mapEntryById.get(s.id);
    const dataFromResult = entry ? result[entry.key] : undefined;
    if (dataFromResult != null) {
      merged.push({
        id: s.id,
        // 传入的 label 来自后端（manifest / SSE 回放）时以它为准；
        // 本地表只在没有后端名字时兜底，别拿旧常量把新名字盖回去。
        label: s.label && s.label !== s.id ? s.label : (entry?.label ?? s.label),
        status: "completed",
        message: tGlobal("msg.stepDone", { label: tStepLabel(s.id, entry?.label ?? s.label) }),
        data: dataFromResult,
      });
    } else {
      merged.push(s);
    }
    seen.add(s.id);
  }

  // Pass 2: STEP_RESULT_MAP 探测出的、但 existingSteps 里没有的 step
  // （场景：纯 result restore，没传 steps，需要从 ctx 探测出哪些 step 存在）。
  for (const entry of STEP_RESULT_MAP) {
    if (seen.has(entry.id)) continue;
    const data = result[entry.key];
    if (data == null) continue;
    merged.push({
      id: entry.id,
      label: entry.label,
      status: "completed",
      message: tGlobal("msg.stepDone", { label: tStepLabel(entry.id, entry.label) }),
      data,
    });
    seen.add(entry.id);
  }

  return merged;
}

function buildStepState(p: PipelineProgress): StepState {
  return {
    id: p.stepId ?? p.stage,
    // 后端 stage 就是 STEP_REGISTRY 里的显示名，直接用；前端不再翻译一遍中文步名。
    label: p.stage,
    status: p.status,
    message: p.message,
    data: p.data,
    isMeta: p.meta,
    skipInfo: p.skipInfo,
  };
}

function splitCompositeStep(
  p: PipelineProgress,
  steps: StepState[],
): StepState[] {
  const msg = p.message ?? "";
  const isScriptPhase = msg.includes("剧本");
  const isScenePhase = msg.includes("场景");
  // 复合步拆成两张卡时，两半的名字仍走 i18n / 静态步表，不在这里写死中文字面量：
  // 环节改名时这里若留着旧字面量，画布上就会冒出一个别处都没有的名字。
  const scriptLabel = tStepLabel("script_generation");
  const sceneLabel = tStepLabel("scene_plan");

  if (p.status === "completed") {
    const data = p.data as Record<string, unknown> | undefined;
    const scriptData = data?.jrpg_script ?? data;
    const sceneData = data?.scene_map ?? data;
    return upsertStep(
      upsertStep(steps, {
        id: "script_generation",
        label: scriptLabel,
        status: "completed",
        message: tGlobal("msg.stepDone", { label: scriptLabel }),
        data: scriptData,
      }),
      {
        id: "scene_plan",
        label: sceneLabel,
        status: "completed",
        message: tGlobal("msg.stepDone", { label: sceneLabel }),
        data: sceneData,
      },
    );
  }

  let result = steps;
  if (isScriptPhase || !isScenePhase) {
    result = upsertStep(result, {
      id: "script_generation",
      label: scriptLabel,
      status: "running",
      message: msg,
    });
    const existScene = result.find((s) => s.id === "scene_plan");
    if (!existScene) {
      result = upsertStep(result, {
        id: "scene_plan",
        label: sceneLabel,
        status: "pending",
      });
    }
  }
  if (isScenePhase) {
    result = upsertStep(result, {
      id: "scene_plan",
      label: sceneLabel,
      status: "running",
      message: msg,
    });
  }
  return result;
}

function upsertStep(steps: StepState[], step: StepState): StepState[] {
  const idx = steps.findIndex((s) => s.id === step.id);
  if (idx >= 0) {
    const copy = [...steps];
    copy[idx] = step;
    return copy;
  }
  return [...steps, step];
}

const VALIDATION_PARENT: Record<string, string> = {
  structure_validation_l1: "outline_batch",
  structure_validation_l2: "detailed_outline",
};

function mergeValidationIntoParent(
  p: PipelineProgress,
  steps: StepState[],
): StepState[] {
  const parentId = VALIDATION_PARENT[p.stepId ?? ""];
  if (!parentId) return steps;
  const idx = steps.findIndex((s) => s.id === parentId);
  if (idx < 0) return steps;
  const copy = [...steps];
  const parent = { ...copy[idx] };
  if (p.status === "running") {
    parent.message = p.message;
  } else if (p.status === "completed") {
    parent.message = tGlobal("msg.validationDone", { label: tStepLabel(parent.id, parent.label) });
  }
  copy[idx] = parent;
  return copy;
}

function resolveEntryStatus(status: string | undefined): EntryStatus {
  if (status === "completed") return "completed";
  if (status === "running") return "running";
  if (status === "interrupted" || status === "failed") return "interrupted";
  return null;
}

/**
 * 画布的开局：项目自带的那枚需求入口节点。
 *
 * 空画布不是"干净"，是"不知道从哪起手"——第一件事永远是说需求 + 选路由，
 * 那就该有一枚节点已经摆在那里等着填，而不是让用户先从目录里找出该拖哪一个。
 *
 * id 写死而非随机：左右两个 iframe 各自建 store 时都要落到同一枚节点上，
 * 否则 BroadcastChannel 同步完会留下两枚各自随机 id 的入口。
 */
const ENTRY_NODE_ID = "composer_entry_default";

/** 某条泳道的产物目录（相对 `output/`）；解析规则见 store/laneAddress.ts。 */
function resolveLaneSourceDir(
  state: Pick<NarrativeState, "pipelineRuns" | "entryPipelines">,
  pipelineId: string | null,
): string | null {
  return laneSourceDir(pipelineId, state.pipelineRuns, state.entryPipelines);
}

function seedComposerNodes(): ComposerNodeData[] {
  const item = findCatalogItem(ENTRY_CATALOG_ID);
  return item ? [instantiateComposerNode(item, { x: 96, y: 120 }, ENTRY_NODE_ID)] : [];
}

export const useNarrativeStore = create<NarrativeState>((set, get) => ({
  // ---- Active branch ----
  activeEntryKey: null,
  activeSourceDir: null,
  activeEntryStatus: null,
  activeCanResume: false,
  activeSteps: [],
  activeResult: null,
  activeConfig: null,

  // ---- Running context ----
  runningEntryKey: null,
  runningSourceDir: null,
  runningRunId: null,
  runningProgress: [],
  pipelineOrder: [],
  stepGroups: [],
  runMode: null,
  ipPreviewRunId: null,
  ipRunKey: null,

  // ---- 顶层状态机信号 ----
  inputConfirmed: false,
  routingConfigured: false,
  ipDnaGenerating: false,
  pendingFork: false,
  pendingForkKind: null,

  // ---- Composer（无限画布编排） ----
  composerNodes: seedComposerNodes(),
  composerEdges: [],

  entryPipelines: [],
  activePipelineId: null,
  listExpandedKeys: [],
  pipelineRuns: {},

  // ---- Drafts ----
  editDrafts: {},

  // ---- Config ----
  tier: null,
  mode: null,
  autoDetect: true,
  availableModes: [],

  // ---- UI state ----
  viewMode: "graph",
  inputTab: "text",
  focusedFile: null,
  openNavTab: null,
  leftSection: "tasks",
  openedTaskKey: null,
  openedProjectId: null,
  routing: { ...INITIAL_ROUTING },
  input: { ...INITIAL_INPUT },
  entryDirty: false,
  ipDnaJob: null,
  ipCanGenerate: false,
  runtimeBusy: false,
  runtimeError: null,
  pendingCommand: null,
  historyRevision: 0,
  focusedStepId: null,
  focusedChildNodeId: null,
  expandedStepId: null,
  collapsedGraphIds: [],
  nodeDrags: {},
  nodeDragsEntryKey: null,
  previewOrder: null,
  previewIsAuto: false,

  streamingChunks: {},
  streamPlayedSteps: [],
  runStartedAt: 0,
  liveCompletedSteps: [],
  animatingStepId: null,
  animPlayedNodes: [],

  // ---- Actions: config ----
  setConfig: (tier, mode, autoDetect) => set({ tier, mode, autoDetect }),
  setAvailableModes: (modes) => set({ availableModes: modes }),

  // ---- Actions: 顶层状态机信号 ----
  setRoutingConfigured: (v) => set({ routingConfigured: v }),
  setPendingFork: (v, kind) => set({ pendingFork: v, pendingForkKind: v ? (kind ?? null) : null }),
  setIpDnaGenerating: (v) => set({ ipDnaGenerating: v }),
  beginDraftEntry: (entryKey, inputMeta) =>
    set((state) => ({
      activeEntryKey: entryKey,
      activeSourceDir: entryKey,
      activeEntryStatus: null,
      activeCanResume: false,
      inputConfirmed: true,
      activeConfig: { ...(state.activeConfig ?? {}), ...(inputMeta ?? {}) },
    })),

  // ---- Actions: run lifecycle ----
  startNewRun: (runId, entryKey, tier, mode, sourceDir) =>
    set((state) => {
      // §状态机重构 / 管线节点稳定：下游生成开始时**保留已有 ip_* 前驱步**（IP 预处理产物），
      // 而非整表清空——否则中间预览会出现 5→0→n 的节点跳变（前驱链闪没）。
      // 仅当继续同一条目（entryKey 对齐）时保留；换条目则清空。
      const keepIp =
        (state.activeEntryKey === entryKey || state.runningEntryKey === entryKey) &&
        state.runningProgress.filter((s) => s.id.startsWith("ip_"));
      const seededProgress = keepIp && keepIp.length > 0 ? keepIp : [];
      const seededOrder = seededProgress.map((s) => s.id);
      return {
        activeEntryKey: entryKey,
        activeSourceDir: sourceDir ?? entryKey,
        activeEntryStatus: "running",
        activeCanResume: false,
        activeSteps: seededProgress,
        activeResult: null,
        runningEntryKey: entryKey,
        runningSourceDir: sourceDir ?? entryKey,
        runningRunId: runId,
        ipPreviewRunId: null,
        ipDnaGenerating: false,
        pendingFork: false,
        runningProgress: seededProgress,
        pipelineOrder: seededOrder,
        stepGroups: [],
        runMode: "start",
        editDrafts: {},
        tier: tier ?? get().tier,
        mode: mode ?? get().mode,
        focusedStepId: null,
        focusedChildNodeId: null,
        expandedStepId: null,
        collapsedGraphIds: [],
        streamingChunks: {},
        streamPlayedSteps: [],
        runStartedAt: Date.now(),
        liveCompletedSteps: seededProgress.filter((s) => s.status === "completed").map((s) => s.id),
        animatingStepId: null,
        animPlayedNodes: [],
      };
    }),

  startFork: (runId, newEntryKey, _sourceEntryKey, tier, mode, preloadSteps) =>
    set({
      activeEntryKey: newEntryKey,
      // fork 铸的新键就是新条目根：fork 出来的永远是主管线。
      activeSourceDir: newEntryKey,
      activeEntryStatus: "running",
      activeCanResume: false,
      activeSteps: preloadSteps ?? [],
      activeResult: null,
      runningEntryKey: newEntryKey,
      runningRunId: runId,
      ipPreviewRunId: null,
      // fork：preloadSteps 已含「已完成 + 受影响」全量，runningProgress 同步预填，
      // 这样 announce 帧到达前 UI 就能显示"哪些步骤会保留 / 哪些会重跑"。
      runningProgress: preloadSteps ?? [],
      pipelineOrder: preloadSteps?.map((s) => s.id) ?? [],
      stepGroups: [],
      runMode: "fork",
      editDrafts: {},
      tier: tier ?? get().tier,
      mode: mode ?? get().mode,
      streamingChunks: {},
      streamPlayedSteps: [],
      runStartedAt: Date.now(),
      liveCompletedSteps: preloadSteps?.filter((s) => s.status === "completed").map((s) => s.id) ?? [],
      animatingStepId: null,
      animPlayedNodes: [],
    }),

  startResume: (runId, entryKey, tier, mode) =>
    set({
      activeEntryKey: entryKey,
      activeSourceDir: entryKey,
      activeEntryStatus: "running",
      activeCanResume: false,
      runningEntryKey: entryKey,
      runningSourceDir: entryKey,
      runningRunId: runId,
      // resume：只保留**真正已完成**的步骤；之前的 pending / running / failed 全部丢弃，
      // 这些状态由 backend 重发的 SSE 事件重新驱动，避免拖油手残留导致节点序乱
      // （旧实现 [...activeSteps] 会把上次失败时残留的 pending 节点塞进画布，
      //  叠加 SSE 时间序追加的新节点 → ui_copy 跑到 branch_tree 之前那种怪现象）。
      runningProgress: get().activeSteps.filter((s) => s.status === "completed"),
      pipelineOrder: [],
      stepGroups: [],
      runMode: "resume",
      streamingChunks: {},
      streamPlayedSteps: [],
      runStartedAt: Date.now(),
      liveCompletedSteps: get().activeSteps
        .filter((s) => s.status === "completed")
        .map((s) => s.id),
      animatingStepId: null,
      ipPreviewRunId: null,
    }),

  startIpPreviewRun: (runId, entryKey, order) =>
    set((state) => {
      const nextOrder = order.length > 0 ? order : state.pipelineOrder;
      // 已在同一 IP 预览轨：只补 order / runId，绝不清空已累积的 runningProgress（避免节点闪没）。
      if (
        state.ipPreviewRunId &&
        state.runningEntryKey === entryKey &&
        state.runningProgress.length > 0
      ) {
        return {
          ipPreviewRunId: runId || state.ipPreviewRunId,
          pipelineOrder: nextOrder,
        };
      }
      // 预览轨已收束但 activeSteps 仍持有 IP 前驱步：从 activeSteps 恢复，而非重开空白轨。
      const archivedIp = state.activeSteps.filter((s) => s.id.startsWith("ip_"));
      if (!state.ipPreviewRunId && archivedIp.length > 0) {
        const restoredOrder =
          nextOrder.length > 0
            ? nextOrder
            : (state.activeConfig?.pipelineOrder?.length ? state.activeConfig.pipelineOrder : nextOrder);
        return {
          activeEntryKey: entryKey,
          activeSourceDir: entryKey,
          activeEntryStatus: null,
          activeResult: null,
          runningEntryKey: entryKey,
          runningSourceDir: entryKey,
          runningRunId: null,
          ipPreviewRunId: runId,
          runningProgress: archivedIp,
          pipelineOrder: restoredOrder,
          runMode: "start",
          runStartedAt: Date.now(),
          liveCompletedSteps: archivedIp.filter((s) => s.status === "completed").map((s) => s.id),
        };
      }
      // 点6（逐步揭示）：不再把整条 IP 前驱链一次性 seed 成 pending，否则中间预览（文本/节点两模式）
      // 会"一下子全冒出来"。这里只把 order 存进 pipelineOrder 作为排序权威，runningProgress 留空，
      // 由后续 pushProgress 随每步确认增量加入节点——useOrderedSteps 取 order∩runningProgress，
      // 故节点跟随 IP 前置流程一步一步出现（含边逐段点亮）。
      return {
        activeEntryKey: entryKey,
        activeSourceDir: entryKey,
        activeEntryStatus: null,
        activeCanResume: false,
        activeSteps: [],
        activeResult: null,
        activeConfig: null,
        runningEntryKey: entryKey,
        runningSourceDir: entryKey,
        // runningRunId 故意保持 null：IP 走 job 轮询，不开 SSE，也不撞并发守卫。
        runningRunId: null,
        ipPreviewRunId: runId,
        runningProgress: [],
        pipelineOrder: nextOrder,
        runMode: "start",
        editDrafts: {},
        focusedStepId: null,
        focusedChildNodeId: null,
        expandedStepId: null,
        collapsedGraphIds: [],
        streamingChunks: {},
        streamPlayedSteps: [],
        runStartedAt: Date.now(),
        liveCompletedSteps: [],
        animatingStepId: null,
        animPlayedNodes: [],
      };
    }),

  setIpRunKey: (key) => set(() => ({ ipRunKey: key })),

  finishIpPreview: (status = "completed") =>
    set((state) => {
      if (!state.ipPreviewRunId) return {};
      // 固化顺序到 activeConfig：非运行态 useOrderedSteps 用 activeConfig.pipelineOrder 保序。
      const finalized = state.runningProgress.map((s) =>
        status === "interrupted" && s.status === "running"
          ? { ...s, status: "failed" as StepStatus }
          : s,
      );
      const entryKey = state.activeEntryKey ?? state.runningEntryKey;
      // 保留 activeEntryKey/runningEntryKey 对齐，使中间预览继续读到 finalized 步骤（节点不闪没）。
      // IP 预处理完成 ≠ 下游叙事生成完成：用 idle 而非 completed，避免误显示 DONE/GENERATING。
      return {
        ipPreviewRunId: null,
        runningEntryKey: entryKey,
        runMode: null,
        activeEntryStatus: status === "interrupted" ? "interrupted" : null,
        // IP 预处理没有叙事管线的断点，续跑无从下手：这里中断只能重新开始。
        activeCanResume: false,
        activeSteps: finalized,
        runningProgress: finalized,
        activeConfig: { ...(state.activeConfig ?? {}), pipelineOrder: state.pipelineOrder },
      };
    }),

  pushProgress: (p) =>
    set((state) => {
      // pipeline_steps_announce — runMode 决定这一帧是否预填节点：
      //  - fork：announce 列表代表"完整管线全景"，预填全量节点（缺的补 pending），
      //          配合 startFork 已塞好的 preloadSteps 一起呈现"哪些保留 / 哪些重跑"。
      //  - start：同样预填。渐进式渲染（只等 step_start 增量长节点）的代价是开跑那几十秒里
      //          画布上只有零星两张卡，专家容器要等第二步开始才够两个成员而"迟到"出现——
      //          用户看到的是"先跑了两步散节点，然后才蹦出专家"，与"选定专家跑他的管线"相反。
      //          announce 帧本就是后端给的完整步序，照它先把待跑节点铺满更贴事实。
      //  - resume：仍渐进。断点续跑的 announce 含已完成步，预填会把上次残留的 pending 一并塞回。
      //  - null（极端兜底，正常不会发生）：按旧逻辑全量预填，避免节点丢失。
      if (p.type === "pipeline_steps_announce") {
        // 空步序的 announce 帧照样要在这里吃掉。它是自动路由未定品类时的正常产物，
        // 若放它落到下面的通用分支，stepId ?? stage 会取到字符串 "announce"，
        // 画布上就会凭空长出一枚叫 announce 的节点——它不对应任何 agent。
        if (!Array.isArray(p.steps) || p.steps.length === 0) return {};
        // 头部元节点保留：design_auto 第二帧 announce（D4 后重规划）只发
        // ["pipeline_config", ...]，会把首帧的 tier_router（品类识别）挤掉，导致
        // 该节点"出现又消失"。这里把上一帧已有、本帧缺失的头部元节点补回最前。
        let nextOrder = p.steps;
        const prevOrder = state.pipelineOrder;
        const missingHead = META_HEAD_IDS.filter(
          (id) => prevOrder.includes(id) && !nextOrder.includes(id),
        );
        if (missingHead.length > 0) {
          nextOrder = [...missingHead, ...nextOrder];
        }
        // IP 前驱链保序（§6 LIST 双模块）：下游生成管线 announce 时不应挤掉已展示的 ip_* 节点，
        // 把上一帧已有、本帧缺失的 ip_ 步骤补回最前（保持 输入→处理→生成 的视觉先后）。
        const missingIp = prevOrder.filter(
          (id) => id.startsWith("ip_") && !nextOrder.includes(id),
        );
        if (missingIp.length > 0) {
          nextOrder = [...missingIp, ...nextOrder];
        }
        const patch: Partial<NarrativeState> = { pipelineOrder: nextOrder };
        // 专家归属：只认本帧里真的出现在步序中的步，且非空才覆盖 —— design_auto 的
        // 二补帧若某次没带分组，不该把首帧已画好的专家容器拆回一排同级节点。
        if (Array.isArray(p.stepGroups) && p.stepGroups.length > 0) {
          const inOrder = new Set(nextOrder);
          const groups = p.stepGroups
            .map((g) => ({ ...g, steps: g.steps.filter((id) => inOrder.has(id)) }))
            .filter((g) => g.steps.length > 0);
          if (groups.length > 0) patch.stepGroups = groups;
        }
        const isFork = state.runMode === "fork";
        const isStart = state.runMode === "start";
        const isLegacy = state.runMode === null;
        if (isFork || isStart || isLegacy) {
          const existingMap = new Map(state.runningProgress.map((s) => [s.id, s]));
          // 名字与"哪些是横幅"都来自本帧：后端 announce 已经把 STEP_REGISTRY 的显示名
          // 和 BANNER_STEP_IDS 一并带来了，前端不猜、也不用自己的中文步名表当真值。
          // 只有旧后端（不带这两个字段）才退回本地静态表。
          const announcedNames = p.stepNames ?? {};
          const metaIds = new Set(p.metaSteps ?? []);
          const announced: StepState[] = nextOrder.map((id) => existingMap.get(id) ?? {
            id,
            label: announcedNames[id] ?? PIPELINE_STEPS.find((ps) => ps.id === id)?.label ?? id,
            status: "pending" as const,
            isMeta: metaIds.has(id) || undefined,
          });
          for (const s of state.runningProgress) {
            if (!nextOrder.includes(s.id)) announced.push(s);
          }
          patch.runningProgress = announced;
          if (state.activeEntryKey === state.runningEntryKey) {
            patch.activeSteps = announced;
          }
        }
        return patch;
      }

      const stepKey = p.stepId ?? p.stage;

      if (stepKey in VALIDATION_PARENT) {
        const progress = mergeValidationIntoParent(p, state.runningProgress);
        const patch: Partial<NarrativeState> = { runningProgress: progress };
        if (state.activeEntryKey === state.runningEntryKey) {
          patch.activeSteps = progress;
        }
        return patch;
      }

      let progress: StepState[];

      if (stepKey === "script_scene_generation") {
        progress = splitCompositeStep(p, state.runningProgress);
      } else {
        const updated = buildStepState(p);
        const existing = state.runningProgress.findIndex((s) => s.id === stepKey);
        if (existing >= 0) {
          progress = [...state.runningProgress];
          progress[existing] = updated;
        } else {
          progress = [...state.runningProgress, updated];
        }
      }

      const patch: Partial<NarrativeState> = { runningProgress: progress };

      // Sync active view when viewing the running entry
      if (state.activeEntryKey === state.runningEntryKey) {
        patch.activeSteps = progress;
      }

      // Auto-focus on newly running/completed steps
      if (p.status === "completed" && stepKey && !state.liveCompletedSteps.includes(stepKey)) {
        patch.liveCompletedSteps = [...state.liveCompletedSteps, stepKey];
        patch.animatingStepId = stepKey;
        patch.expandedStepId = stepKey;
        patch.focusedStepId = stepKey;
      }

      const activeId = stepKey === "script_scene_generation"
        ? ((p.message ?? "").includes("场景") ? "scene_plan" : "script_generation")
        : (p.status === "running" ? stepKey : undefined);

      if (activeId && !state.animatingStepId) {
        patch.focusedStepId = activeId;
        patch.expandedStepId = activeId;
      }

      return patch;
    }),

  completeRun: (result, newEntryKey) =>
    set((state) => {
      const isViewing = state.activeEntryKey === state.runningEntryKey;
      const resolvedKey = newEntryKey ?? state.runningEntryKey;
      const steps = rebuildStepsFromResult(result, state.runningProgress);
      // 把运行期的权威步骤序固化到 activeConfig，让"已完成视图"也按权威序展示
      // （否则会退回 rebuildStepsFromResult 的固定序，合并步骤如 initial_plan 会错位到末尾）。
      const persistedConfig: ActiveConfig | null =
        isViewing && state.pipelineOrder.length > 0
          ? { ...(state.activeConfig ?? {}), pipelineOrder: state.pipelineOrder }
          : state.activeConfig;
      return {
        runningProgress: steps,
        runningRunId: null,
        ipPreviewRunId: null,
        ipDnaGenerating: false,
        runningEntryKey: null,
        runningSourceDir: null,
        runMode: null,
        activeEntryKey: isViewing ? resolvedKey : state.activeEntryKey,
        activeSourceDir: isViewing
          ? (state.runningSourceDir ?? resolvedKey)
          : state.activeSourceDir,
        activeSteps: isViewing ? steps : state.activeSteps,
        activeResult: isViewing ? result : state.activeResult,
        activeEntryStatus: isViewing ? "completed" : state.activeEntryStatus,
        // 跑完了就没有"续跑"这件事：断点还在磁盘上，但它已经指向终点。
        activeCanResume: isViewing ? false : state.activeCanResume,
        activeConfig: persistedConfig,
      };
    }),

  failRun: (error) =>
    set((state) => {
      const isViewing = state.activeEntryKey === state.runningEntryKey;
      const finalProgress = state.runningProgress.map((s) =>
        s.status === "running" ? { ...s, status: "failed" as StepStatus } : s,
      );
      return {
        runningProgress: finalProgress,
        runningRunId: null,
        ipPreviewRunId: null,
        ipDnaGenerating: false,
        runningEntryKey: null,
        runningSourceDir: null,
        runMode: null,
        activeSteps: isViewing ? finalProgress : state.activeSteps,
        activeEntryStatus: isViewing ? "interrupted" : state.activeEntryStatus,
        // 后端每完成一步就写一次 `_checkpoint.json`，所以"有没有完成过一步"就是
        // "有没有断点"。一步都没成的挂法没有断点，主键该给"重新开始"而不是必然 404 的续跑。
        activeCanResume: isViewing
          ? finalProgress.some((s) => s.status === "completed")
          : state.activeCanResume,
      };
    }),

  updateRunningEntryKey: (newKey) =>
    set((state) => {
      const wasViewing = state.activeEntryKey === state.runningEntryKey;
      return {
        runningEntryKey: newKey,
        // 换键即换条目根（重铸键只发生在主管线 fork），产物目录随之对齐。
        runningSourceDir: newKey,
        activeEntryKey: wasViewing ? newKey : state.activeEntryKey,
        activeSourceDir: wasViewing ? newKey : state.activeSourceDir,
      };
    }),

  cancelRun: () => {
    const state = get();
    if (state.runningRunId) {
      const isViewing = state.activeEntryKey === state.runningEntryKey;
      set({
        runningRunId: null,
        runningEntryKey: null,
        runMode: null,
        ipDnaGenerating: false,
        activeEntryStatus: isViewing ? "interrupted" : state.activeEntryStatus,
        // 取消 = 界面上的"暂停"，但只有跑完过至少一步才真有断点可续。
        activeCanResume: isViewing
          ? state.runningProgress.some((s) => s.status === "completed")
          : state.activeCanResume,
      });
    } else {
      // IP DNA 下游 job 取消（无 SSE runningRunId）：仅清生成信号，phase 回落 routed/input。
      set({ ipDnaGenerating: false });
    }
  },

  // ---- Actions: branch switching ----
  loadEntry: (opts) => {
    const steps = (opts.steps ?? []).map((s) => {
      const migrated = STEP_ID_MIGRATION[s.id];
      if (migrated) {
        const pDef = PIPELINE_STEPS.find((p) => p.id === migrated);
        return { ...s, id: migrated, label: pDef?.label ?? s.label };
      }
      return s;
    });
    const rebuilt = opts.result ? rebuildStepsFromResult(opts.result, steps) : steps;
    const finalSteps = rebuilt.length > 0 ? rebuilt : steps;

    // pipelineOrder 仅描述「正在跑」的 run 的管线。
    // 切到其它历史 entry 时必须清掉，否则 vn run 的 announce 会把 rpg entry 的节点排乱。
    // 若加载的恰好就是当前 running entry（断回看运行视图），保留 pipelineOrder。
    const currentRunningKey = get().runningEntryKey;
    const keepPipelineOrder = opts.entryKey === currentRunningKey;

    // Phase 2: 同步把 entry 的启动管线快照写入 activeConfig，让 INPUT/ROUTING/PIPELINE STATUS
    // 全部以 store 为权威源（TierModeSelector 通过 useEffect 监听做双写过渡）。
    // 注意：tier/mode 已显式传入，与 config 中的 tier/mode 保持一致；缺失字段保留为 undefined。
    const activeConfig: ActiveConfig | null = opts.config
      ? {
          ...opts.config,
          tier: opts.config.tier ?? opts.tier,
          mode: opts.config.mode ?? opts.mode,
        }
      : opts.tier || opts.mode
        ? { tier: opts.tier, mode: opts.mode }
        : null;

    set({
      activeEntryKey: opts.entryKey,
      // 载入历史条目看的是条目根产物；次管线由 entryPipelines 那条路各自寻址。
      activeSourceDir: opts.entryKey,
      activeEntryStatus: resolveEntryStatus(opts.status),
      activeCanResume: opts.canResume ?? false,
      activeSteps: finalSteps,
      activeResult: opts.result,
      activeConfig,
      tier: opts.tier,
      mode: opts.mode,
      editDrafts: {},
      // 加载历史条目 → 全新查看态：清完成态分叉待决（改配置才会重新置位）。
      pendingFork: false,
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      animatingStepId: null,
      // 切到其它 entry 时清 IP 预览旁路，避免历史条目被误判为"运行中"。
      ...(opts.entryKey === currentRunningKey ? {} : { ipPreviewRunId: null }),
      // pipelineOrder 是"正在跑"的东西，切条目必须清；stepGroups 描述的是这份产物
      // 由谁产出，随条目一起回放，所以用后端给的那份覆盖（没给才退回扁平）。
      ...(keepPipelineOrder
        ? {}
        : {
            pipelineOrder: [] as string[],
            stepGroups: opts.stepGroups ?? ([] as AnnounceStepGroup[]),
          }),
    });
  },

  setActiveConfig: (patch) =>
    set((state) => ({
      activeConfig: patch == null ? null : { ...(state.activeConfig ?? {}), ...patch },
    })),

  clearActiveEntry: () =>
    set((state) => {
      // §D3 保护 IP 预览轨：半自动预处理进行中（ipPreviewRunId 存在）时，不清 viewing 上下文，
      // 否则用户改 INPUT/ROUTING 触发的 clearActiveEntry 会把正在逐步生长的中间预览瞬间清空。
      if (state.ipPreviewRunId) return {};
      // 预处理已固化到 activeSteps / ipRunKey 时同样保护，避免 ROUTING 配置变更把节点清掉。
      if (state.ipRunKey) return {};
      if (state.activeSteps.some((s) => s.id.startsWith("ip_"))) return {};
      return {
        activeEntryKey: null,
        activeSourceDir: null,
        activeEntryStatus: null,
        activeCanResume: false,
        activeSteps: [],
        activeResult: null,
        activeConfig: null,
        entryPipelines: [],
        activePipelineId: null,
        pipelineRuns: {},
        editDrafts: {},
        // 离开条目 → 回落 fresh/idle：清输入确认标记（routingConfigured 保留，UI 选择仍在）。
        inputConfirmed: false,
        pendingFork: false,
        focusedStepId: null,
        focusedChildNodeId: null,
        expandedStepId: null,
        collapsedGraphIds: [],
        streamingChunks: {},
        streamPlayedSteps: [],
        animatingStepId: null,
      };
    }),

  // §状态机：显式取消选中——强制全清（不受 IP 预览守卫拦截），回 idle 全新空白。
  // 仅历史条目留在磁盘/LIST，前端不留任何选中/预览/运行残留。
  deselectEntry: () =>
    set({
      activeEntryKey: null,
      activeSourceDir: null,
      activeEntryStatus: null,
      activeCanResume: false,
      activeSteps: [],
      activeResult: null,
      activeConfig: null,
      entryPipelines: [],
      activePipelineId: null,
      pipelineRuns: {},
      inputConfirmed: false,
      pendingFork: false,
      pendingForkKind: null,
      ipPreviewRunId: null,
      ipRunKey: null,
      ipDnaGenerating: false,
      runningProgress: [],
      pipelineOrder: [],
      stepGroups: [],
      runMode: null,
      editDrafts: {},
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      animatingStepId: null,
    }),

  // §状态机：建新条目前清上一条目的预览/运行上下文，使 pipeline 干净切到新条目
  // （不动 activeEntryKey/inputConfirmed——紧接着的 beginDraftEntry 会设新键）。
  resetPreviewContext: () =>
    set({
      ipPreviewRunId: null,
      ipRunKey: null,
      ipDnaGenerating: false,
      runningProgress: [],
      pipelineOrder: [],
      stepGroups: [],
      activeSteps: [],
      activeResult: null,
      runMode: null,
      pendingFork: false,
      pendingForkKind: null,
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      animatingStepId: null,
    }),

  // ---- Actions: drafts ----
  setEditDraft: (key, draft) =>
    set((state) => ({
      editDrafts: {
        ...state.editDrafts,
        [key]: { ...state.editDrafts[key], ...draft },
      },
    })),

  clearEditDraft: (key) =>
    set((state) => {
      const drafts = { ...state.editDrafts };
      delete drafts[key];
      return { editDrafts: drafts };
    }),

  clearAllDrafts: () => set({ editDrafts: {} }),

  // ---- Actions: UI ----
  setViewMode: (mode) => set({ viewMode: mode }),
  setInputTab: (tab) => set({ inputTab: tab }),
  setFocusedFile: (file) => set({ focusedFile: file }),
  setOpenNavTab: (tab) => set((s) => ({ openNavTab: s.openNavTab === tab ? null : tab })),
  setLeftSection: (section) => set({ leftSection: section }),
  openTask: (entryKey) => set({ openedTaskKey: entryKey }),
  closeTask: () => set({ openedTaskKey: null }),
  openVaultProject: (projectId) => set({ openedProjectId: projectId }),
  closeVaultProject: () => set({ openedProjectId: null }),
  setRouting: (patch) => set((s) => ({ routing: { ...s.routing, ...patch } })),
  setInput: (patch) => set((s) => ({ input: { ...s.input, ...patch } })),
  setUploadedFiles: (next) =>
    set((s) => ({
      input: {
        ...s.input,
        uploadedFiles: typeof next === "function" ? next(s.input.uploadedFiles) : next,
      },
    })),
  setEntryDirty: (v) => set({ entryDirty: v }),
  setIpDnaJob: (next) =>
    set((s) => ({ ipDnaJob: typeof next === "function" ? next(s.ipDnaJob) : next })),
  setIpCanGenerate: (v) => set({ ipCanGenerate: v }),
  setRuntimeBusy: (v) => set({ runtimeBusy: v }),
  setRuntimeError: (msg) => set({ runtimeError: msg }),

  notifyConfigChange: (kind) => {
    const st = get();
    // 1) 确认前（无独立条目）：纯内存自由编辑，无副作用。
    if (!st.inputConfirmed || !st.activeEntryKey) return;

    const produced =
      st.activeEntryStatus === "running" ||
      st.activeEntryStatus === "interrupted" ||
      st.activeEntryStatus === "completed";

    if (!produced) {
      if (kind === "input") {
        // INPUT 在「确认」时已冻结 → 改原料 = fork（懒提交）：置 pendingFork(input) 重新点亮「确认」，
        // 预览仍锚旧条目；重点「确认」时铸新键（原 config 条目作为不可变原料快照保留）。
        set({ pendingFork: true, pendingForkKind: "input" });
      } else {
        set({ entryDirty: true });
      }
      return;
    }
    set({ pendingFork: true, pendingForkKind: kind });
  },

  resetFormDraft: () =>
    set({
      inputTab: "text",
      focusedFile: null,
      routing: { ...INITIAL_ROUTING },
      input: { ...INITIAL_INPUT },
      entryDirty: false,
      runtimeError: null,
    }),

  requestCommand: (kind) => set({ pendingCommand: { kind, nonce: Date.now() } }),
  clearCommand: (nonce) =>
    set((s) => (s.pendingCommand?.nonce === nonce ? { pendingCommand: null } : {})),
  bumpHistory: () => set((s) => ({ historyRevision: s.historyRevision + 1 })),

  setPreviewOrder: (order, isAuto = false) =>
    set((s) =>
      s.previewIsAuto === isAuto &&
      JSON.stringify(s.previewOrder) === JSON.stringify(order)
        ? s
        : { previewOrder: order, previewIsAuto: isAuto },
    ),

  setFocus: (stepId, childNodeId) => {
    const state = get();
    const collapsed = [...state.collapsedGraphIds];

    if (stepId && state.focusedStepId && state.focusedStepId !== stepId) {
      if (!collapsed.includes(state.focusedStepId)) {
        collapsed.push(state.focusedStepId);
      }
    }
    if (stepId) {
      const idx = collapsed.indexOf(stepId);
      if (idx >= 0) collapsed.splice(idx, 1);
    }

    const patch: Partial<NarrativeState> = {
      focusedStepId: stepId,
      focusedChildNodeId: childNodeId ?? null,
      expandedStepId: stepId,
      collapsedGraphIds: collapsed,
    };

    if (state.animatingStepId && state.animatingStepId !== stepId) {
      patch.animatingStepId = null;
      if (!state.streamPlayedSteps.includes(state.animatingStepId)) {
        patch.streamPlayedSteps = [...state.streamPlayedSteps, state.animatingStepId];
      }
    }

    set(patch);
  },

  appendStreamChunk: (stepId, text) =>
    set((state) => ({
      streamingChunks: {
        ...state.streamingChunks,
        [stepId]: text,
      },
    })),

  markStreamPlayed: (stepId) =>
    set((state) => ({
      streamPlayedSteps: state.streamPlayedSteps.includes(stepId)
        ? state.streamPlayedSteps
        : [...state.streamPlayedSteps, stepId],
    })),

  markLiveCompleted: (stepId) =>
    set((state) => ({
      liveCompletedSteps: state.liveCompletedSteps.includes(stepId)
        ? state.liveCompletedSteps
        : [...state.liveCompletedSteps, stepId],
    })),

  finishAnimation: (stepId) =>
    set((state) => {
      const target = stepId ?? state.animatingStepId;
      if (!target) return {};
      const played = state.streamPlayedSteps.includes(target)
        ? state.streamPlayedSteps
        : [...state.streamPlayedSteps, target];
      const patch: Partial<NarrativeState> = {
        animatingStepId: null,
        streamPlayedSteps: played,
      };
      const runningStepId = state.runningProgress.find((s) => s.status === "running")?.id;
      if (state.runningRunId && runningStepId && runningStepId !== target) {
        patch.expandedStepId = runningStepId;
        patch.focusedStepId = runningStepId;
      }
      return patch;
    }),

  markAnimPlayed: (nodeId) =>
    set((state) => ({
      animPlayedNodes: state.animPlayedNodes.includes(nodeId)
        ? state.animPlayedNodes
        : [...state.animPlayedNodes, nodeId],
    })),

  toggleGraphCollapse: (nodeId) =>
    set((state) => {
      const ids = [...state.collapsedGraphIds];
      const idx = ids.indexOf(nodeId);
      if (idx >= 0) ids.splice(idx, 1);
      else ids.push(nodeId);
      return { collapsedGraphIds: ids };
    }),

  setCollapsedGraphIds: (ids) => set({ collapsedGraphIds: ids }),

  nudgeNode: (nodeId, dx, dy) =>
    set((state) => {
      if (dx === 0 && dy === 0) return {};
      // 换了条目就从空的开始记，不继承上一张图的位移。
      const sameEntry = state.nodeDragsEntryKey === state.activeEntryKey;
      const base = sameEntry ? state.nodeDrags : {};
      const prev = base[nodeId];
      return {
        nodeDrags: {
          ...base,
          [nodeId]: { dx: (prev?.dx ?? 0) + dx, dy: (prev?.dy ?? 0) + dy },
        },
        nodeDragsEntryKey: state.activeEntryKey,
      };
    }),

  resetNodeDrags: () => set({ nodeDrags: {}, nodeDragsEntryKey: null }),

  reset: () =>
    set({
      activeEntryKey: null,
      activeSourceDir: null,
      activeEntryStatus: null,
      activeCanResume: false,
      activeSteps: [],
      activeResult: null,
      activeConfig: null,
      runningEntryKey: null,
      runningSourceDir: null,
      runningRunId: null,
      ipPreviewRunId: null,
      runningProgress: [],
      pipelineOrder: [],
      stepGroups: [],
      runMode: null,
      inputConfirmed: false,
      routingConfigured: false,
      ipDnaGenerating: false,
      pendingFork: false,
      composerNodes: seedComposerNodes(),
      composerEdges: [],
      entryPipelines: [],
      activePipelineId: null,
      listExpandedKeys: [],
      pipelineRuns: {},
      editDrafts: {},
      routing: { ...INITIAL_ROUTING },
      input: { ...INITIAL_INPUT },
      entryDirty: false,
      ipDnaJob: null,
      ipCanGenerate: false,
      runtimeBusy: false,
      runtimeError: null,
      pendingCommand: null,
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      animatingStepId: null,
      animPlayedNodes: [],
    }),

  snapshot: () => {
    const s = get();
    const data = {
      activeEntryKey: s.activeEntryKey,
      activeSourceDir: s.activeSourceDir,
      activeEntryStatus: s.activeEntryStatus,
      activeCanResume: s.activeCanResume,
      activeSteps: s.activeSteps,
      activeResult: s.activeResult,
      activeConfig: s.activeConfig,
      runningEntryKey: s.runningEntryKey,
      runningSourceDir: s.runningSourceDir,
      runningRunId: s.runningRunId,
      inputConfirmed: s.inputConfirmed,
      routingConfigured: s.routingConfigured,
      tier: s.tier,
      mode: s.mode,
      viewMode: s.viewMode,
      editDrafts: s.editDrafts,
      routing: s.routing,
      // uploadedFiles 带 base64 正文，可能是几十 MB，进 localStorage 必爆配额 → 只存文本三件套。
      input: { ...s.input, uploadedFiles: [] },
    };
    const json = JSON.stringify(data);
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch { /* quota exceeded */ }
    return json;
  },

  restore: (json: string) => {
    try {
      const data = JSON.parse(json);
      const steps: StepState[] = (data.activeSteps ?? data.steps ?? []).map((s: StepState) => {
        const migrated = STEP_ID_MIGRATION[s.id];
        if (migrated) {
          const pDef = PIPELINE_STEPS.find((p) => p.id === migrated);
          return { ...s, id: migrated, label: pDef?.label ?? s.label };
        }
        return s;
      });

      const result = data.activeResult ?? data.result ?? null;
      const rebuilt = result ? rebuildStepsFromResult(result, steps) : steps;
      const finalSteps = rebuilt.length > 0 ? rebuilt : steps;

      set({
        activeEntryKey: data.activeEntryKey ?? data.sourceDir ?? null,
        // 旧快照没有这个字段：退回 entryKey（旧快照只可能是主管线）。
        activeSourceDir:
          data.activeSourceDir ?? data.activeEntryKey ?? data.sourceDir ?? null,
        activeEntryStatus: data.activeEntryStatus ?? resolveEntryStatus(data.status),
        activeCanResume: data.activeCanResume ?? false,
        activeSteps: finalSteps,
        activeResult: result,
        activeConfig: data.activeConfig ?? null,
        runningEntryKey: data.runningEntryKey ?? null,
        runningRunId: data.runningRunId ?? null,
        inputConfirmed: data.inputConfirmed ?? false,
        routingConfigured: data.routingConfigured ?? false,
        tier: data.tier ?? null,
        mode: data.mode ?? null,
        viewMode: data.viewMode ?? "graph",
        editDrafts: data.editDrafts ?? {},
        routing: { ...INITIAL_ROUTING, ...(data.routing ?? {}) },
        input: { ...INITIAL_INPUT, ...(data.input ?? {}), uploadedFiles: [] },
      });
      return true;
    } catch {
      return false;
    }
  },

  // ---- Actions: composer（无限画布编排） ----
  addComposerNode: (item, position) => {
    if (!isCompositionEditable(computePhase(get()))) return "";
    const id = `composer_${item.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const node = instantiateComposerNode(item, position, id);
    set((state) => ({ composerNodes: [...state.composerNodes, node] }));
    return id;
  },

  // 挪位置不改"跑什么"，所以不受闸门管：跑起来之后仍然可以把图摆顺看清楚。
  moveComposerNode: (id, position) =>
    set((state) => ({
      composerNodes: state.composerNodes.map((n) => (n.id === id ? { ...n, position } : n)),
    })),

  connectComposer: (source, target) =>
    set((state) => {
      if (!isCompositionEditable(computePhase(state))) return {};
      if (source === target) return {};
      const exists = state.composerEdges.some((e) => e.source === source && e.target === target);
      if (exists) return {};
      const edge: ComposerEdgeData = { id: `ce_${source}__${target}`, source, target };
      return { composerEdges: [...state.composerEdges, edge] };
    }),

  removeComposerNode: (id) => {
    if (!isCompositionEditable(computePhase(get()))) return;
    // 节点删了，它暂存的上传正文也该走：留着就是一份没人能再看到、也没人会释放的内存。
    composerUploads.delete(id);
    set((state) => ({
      composerNodes: state.composerNodes.filter((n) => n.id !== id),
      composerEdges: state.composerEdges.filter((e) => e.source !== id && e.target !== id),
    }));
  },

  removeComposerEdge: (id) =>
    set((state) =>
      isCompositionEditable(computePhase(state))
        ? { composerEdges: state.composerEdges.filter((e) => e.id !== id) }
        : {},
    ),

  setComposerNodeConfig: (id, patch) =>
    set((state) => {
      if (!isCompositionEditable(computePhase(state))) return {};
      return {
        composerNodes: state.composerNodes.map((n) =>
          n.id === id ? { ...n, config: { ...n.config, ...patch } } : n,
        ),
      };
    }),

  // 清空是"把我编排的东西撤掉"，不是"连入口一起撤掉"——入口是项目自带的，清完还得在。
  clearComposer: () => {
    if (!isCompositionEditable(computePhase(get()))) return;
    composerUploads.clear();
    set({ composerNodes: seedComposerNodes(), composerEdges: [] });
  },

  setEntryPipelines: (pipelines, activePipelineId) => {
    const activeId =
      activePipelineId !== undefined
        ? activePipelineId
        : pipelines[0]?.pipelineId ?? null;
    const active = pipelines.find((p) => p.pipelineId === activeId) ?? pipelines[0];
    const order = active?.agents?.map((a) => a.agentId) ?? [];
    set((state) => ({
      entryPipelines: pipelines,
      activePipelineId: activeId,
      // 载入历史条目时聚焦泳道可能是次管线，产物在它自己的子目录下（见 resolveLaneSourceDir）。
      activeSourceDir:
        resolveLaneSourceDir({ pipelineRuns: state.pipelineRuns, entryPipelines: pipelines }, activeId)
        ?? state.activeSourceDir,
      previewOrder: order.length > 0 ? order : state.previewOrder,
      activeConfig: state.activeConfig
        ? { ...state.activeConfig, pipelineOrder: order.length > 0 ? order : state.activeConfig.pipelineOrder }
        : state.activeConfig,
    }));
  },

  setActivePipelineId: (id) =>
    set((state) => {
      const active = state.entryPipelines.find((p) => p.pipelineId === id);
      const order = active?.agents?.map((a) => a.agentId) ?? [];
      return {
        activePipelineId: id,
        // 切泳道就得换产物目录，否则文本视图仍读上一条泳道的文件：图换了、内容没换，
        // 而两者看不出不一致。目录优先取本轮 run 上报的，其次取 manifest 里后端回写的
        // （跨重启仍准），都没有就落条目根——那是主管线的产物位置。
        activeSourceDir:
          resolveLaneSourceDir(state, id) ?? state.activeEntryKey ?? state.activeSourceDir,
        previewOrder: order.length > 0 ? order : state.previewOrder,
        activeConfig: state.activeConfig
          ? { ...state.activeConfig, pipelineOrder: order.length > 0 ? order : state.activeConfig.pipelineOrder }
          : state.activeConfig,
      };
    }),

  applyLaneResult: (forSourceDir, data) =>
    set((state) => {
      // 陈旧响应校验：用户切换很快时，上一次 fetch 的响应可能晚于下一次切换才回来。
      if (state.activeSourceDir !== forSourceDir) return {};
      if (!data.result) return {};
      const steps = rebuildStepsFromResult(data.result, state.activeSteps);
      return {
        activeResult: data.result,
        activeSteps: steps.length > 0 ? steps : state.activeSteps,
        ...(data.stepGroups ? { stepGroups: data.stepGroups } : {}),
      };
    }),

  setPipelineRuns: (lanes) =>
    set(() => ({
      pipelineRuns: Object.fromEntries(lanes.map((l) => [l.pipelineId, l])),
    })),

  updatePipelineRun: (pipelineId, patch) =>
    set((state) => {
      const cur = state.pipelineRuns[pipelineId];
      if (!cur) return {};
      return { pipelineRuns: { ...state.pipelineRuns, [pipelineId]: { ...cur, ...patch } } };
    }),

  markPipelineRunStep: (pipelineId, stepId, status) =>
    set((state) => {
      const cur = state.pipelineRuns[pipelineId];
      if (!cur) return {};
      const completedSteps =
        status === "completed" && !cur.completedSteps.includes(stepId)
          ? [...cur.completedSteps, stepId]
          : cur.completedSteps;
      return {
        pipelineRuns: {
          ...state.pipelineRuns,
          [pipelineId]: {
            ...cur,
            completedSteps,
            runningStepId: status === "running" ? stepId : cur.runningStepId,
          },
        },
      };
    }),

  toggleListExpanded: (entryKey) =>
    set((state) => {
      const has = state.listExpandedKeys.includes(entryKey);
      return {
        listExpandedKeys: has
          ? state.listExpandedKeys.filter((k) => k !== entryKey)
          : [...state.listExpandedKeys, entryKey],
      };
    }),

  setListExpanded: (entryKey, expanded) =>
    set((state) => {
      const has = state.listExpandedKeys.includes(entryKey);
      if (expanded && !has) {
        return { listExpandedKeys: [...state.listExpandedKeys, entryKey] };
      }
      if (!expanded && has) {
        return {
          listExpandedKeys: state.listExpandedKeys.filter((k) => k !== entryKey),
        };
      }
      return {};
    }),

  relayoutComposer: () =>
    set((state) => {
      const nodes = state.composerNodes;
      if (nodes.length === 0) return {};
      const edges = state.composerEdges;
      // 与管线状态一致的左→右分层布局：沿边取最长路径作为层号，同层纵向堆叠。
      const NODE_W = 180;
      const NODE_H = 48;
      const H_GAP = 72;
      const V_GAP = 28;
      const INIT_X = 48;
      const INIT_Y = 48;

      const adj = new Map<string, string[]>();
      const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
      for (const e of edges) {
        if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
        adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
        indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      }
      const layer = new Map<string, number>();
      const deg = new Map(indeg);
      const queue = nodes.filter((n) => (deg.get(n.id) ?? 0) === 0).map((n) => n.id);
      for (const id of queue) layer.set(id, 0);
      const q = [...queue];
      while (q.length > 0) {
        const cur = q.shift()!;
        const cl = layer.get(cur) ?? 0;
        for (const nx of adj.get(cur) ?? []) {
          layer.set(nx, Math.max(layer.get(nx) ?? 0, cl + 1));
          const d = (deg.get(nx) ?? 0) - 1;
          deg.set(nx, d);
          if (d === 0) q.push(nx);
        }
      }
      // 环内/未定层节点兜底归到第 0 层。
      for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, 0);

      const perLayer = new Map<number, number>();
      const composerNodes = nodes.map((n) => {
        const l = layer.get(n.id) ?? 0;
        const row = perLayer.get(l) ?? 0;
        perLayer.set(l, row + 1);
        return {
          ...n,
          position: {
            x: INIT_X + l * (NODE_W + H_GAP),
            y: INIT_Y + row * (NODE_H + V_GAP),
          },
        };
      });
      return { composerNodes };
    }),

  hasDrafts: () => {
    const drafts = get().editDrafts;
    return Object.values(drafts).some((d) => d.saved);
  },

  getAnchoredPipelines: () => {
    const s = get();
    return computeAnchoredPipelines(s.composerNodes, s.composerEdges);
  },
}));

/**
 * 顶层 phase 的 React 订阅钩子（§状态机重构）。UI 组件（header/按钮/管线门控）用它取唯一 phase，
 * 底层依赖变化时自动重算。等价于 useNarrativeStore(computePhase) 但语义更清晰。
 */
export function useNarrativePhase(): NarrativePhase {
  return useNarrativeStore((s) => computePhase(s));
}

/** Attempt to restore from localStorage on load */
export function tryRestoreFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return useNarrativeStore.getState().restore(raw);
    }
  } catch { /* ignore */ }
  return false;
}

/* ================================================================
 * BroadcastChannel cross-iframe sync (split-surface embedding).
 *
 * When the viz app runs as two iframes (?pane=left + ?pane=center),
 * both have independent Zustand stores. This bridge keeps them in
 * sync by broadcasting a subset of state changes.
 *
 * Only the keys that matter for cross-pane coordination are synced;
 * transient animation / streaming state stays local.
 * ================================================================ */

const BC_CHANNEL_NAME = "forgeax-plugin.@forgeax-extension/narrative";

const SYNC_KEYS: Array<keyof NarrativeState> = [
  "activeEntryKey",
  "activeEntryStatus",
  // 中栏的两个键要靠它区分"可续跑"与"只能重开"，不同步过去就会各算一套。
  "activeCanResume",
  "activeSteps",
  "activeResult",
  "activeConfig",
  "runningEntryKey",
  "runningRunId",
  "ipPreviewRunId",
  "ipRunKey",
  "inputConfirmed",
  "routingConfigured",
  "ipDnaGenerating",
  "pendingFork",
  "pendingForkKind",
  "runningProgress",
  "pipelineOrder",
  "stepGroups",
  "previewOrder",
  "previewIsAuto",
  "runMode",
  "composerNodes",
  "composerEdges",
  "entryPipelines",
  "activePipelineId",
  "listExpandedKeys",
  "tier",
  "mode",
  "autoDetect",
  "viewMode",
  "inputTab",
  "focusedFile",
  "leftSection",
  "openedTaskKey",
  "openedProjectId",
  "routing",
  "input",
  "entryDirty",
  "ipDnaJob",
  "ipCanGenerate",
  "runtimeBusy",
  "runtimeError",
  "pendingCommand",
  "historyRevision",
  "focusedStepId",
  "focusedChildNodeId",
  "expandedStepId",
  "editDrafts",
];

let _bcSuppressIncoming = false;

try {
  const bc = new BroadcastChannel(BC_CHANNEL_NAME);

  useNarrativeStore.subscribe((state, prevState) => {
    if (_bcSuppressIncoming) return;
    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const k of SYNC_KEYS) {
      if (state[k] !== prevState[k]) {
        patch[k] = state[k];
        changed = true;
      }
    }
    if (changed) {
      bc.postMessage({ t: "sync", patch });
    }
  });

  bc.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as { t?: string; patch?: Record<string, unknown> };
    if (msg?.t !== "sync" || !msg.patch) return;
    _bcSuppressIncoming = true;
    try {
      useNarrativeStore.setState(msg.patch as Partial<NarrativeState>);
    } finally {
      _bcSuppressIncoming = false;
    }
  };
} catch {
  /* BroadcastChannel unavailable (e.g. non-browser env) — skip */
}

/* ================================================================
 * Surface snapshot push for AI DUAL-MODALITY.
 *
 * Pushes two surface snapshots to the host via postMessage whenever
 * the relevant state keys change:
 *   - narrative.control  (config + running state)
 *   - narrative.pipeline (steps + results + drafts)
 *
 * This is additive to the BroadcastChannel sync above; it targets
 * the host window (not sibling iframes) so the SurfaceRegistry /
 * ToolRegistry can serve snapshots to AI via bus.query().
 * ================================================================ */

const CONTROL_KEYS: Array<keyof NarrativeState> = [
  "tier", "mode", "autoDetect",
  "runningRunId", "runningEntryKey",
  "activeEntryKey", "activeEntryStatus", "activeCanResume",
  "editDrafts", "pendingFork",
];

const PIPELINE_KEYS: Array<keyof NarrativeState> = [
  "activeSteps", "activeEntryKey", "activeEntryStatus",
  "pipelineOrder", "stepGroups", "viewMode", "focusedStepId", "editDrafts",
];

useNarrativeStore.subscribe((state, prevState) => {
  let controlChanged = false;
  for (const k of CONTROL_KEYS) {
    if (state[k] !== prevState[k]) { controlChanged = true; break; }
  }
  if (controlChanged) {
    sendToHost({
      type: "narrative:surface-snapshot",
      payload: {
        surface: "narrative.control",
        snapshot: {
          tier: state.tier,
          mode: state.mode,
          autoDetect: state.autoDetect,
          runningRunId: state.runningRunId,
          runningEntryKey: state.runningEntryKey,
          activeEntryKey: state.activeEntryKey,
          activeEntryStatus: state.activeEntryStatus,
          // chat 侧的 agent 要能答"现在能不能续跑、该点哪个键"，所以把界面上那两个键的
          // 派生结论一起报出去，而不是让它照 activeEntryStatus 自己再推一遍（推法不一致就会
          // 出现 agent 说"已暂停可继续"而界面上续跑键是灰的）。
          ...runControls({
            activeEntryStatus: state.activeEntryStatus,
            activeCanResume: state.activeCanResume,
            generating: !!state.runningRunId || state.ipDnaGenerating,
            hasDrafts: Object.values(state.editDrafts).some((d) => d.saved),
            pendingFork: state.pendingFork,
          }),
        },
      },
    });
  }

  let pipelineChanged = false;
  for (const k of PIPELINE_KEYS) {
    if (state[k] !== prevState[k]) { pipelineChanged = true; break; }
  }
  if (pipelineChanged) {
    sendToHost({
      type: "narrative:surface-snapshot",
      payload: {
        surface: "narrative.pipeline",
        snapshot: {
          steps: state.activeSteps,
          activeEntryKey: state.activeEntryKey,
          activeEntryStatus: state.activeEntryStatus,
          pipelineOrder: state.pipelineOrder,
          viewMode: state.viewMode,
          focusedStepId: state.focusedStepId,
          editDrafts: state.editDrafts,
        },
      },
    });
  }
});
