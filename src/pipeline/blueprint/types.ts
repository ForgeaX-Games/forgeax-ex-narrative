/**
 * blueprint/types.ts — Blueprint + Stateless Agent Framework 核心类型
 *
 * 两大职责分离：
 *   Blueprint  = "跑什么"（步骤序列、预解析提示词、品类配置）
 *   AgentDef   = "怎么跑"（结构类型、执行参数、I/O 契约）
 *
 * 所有类型纯数据，不含运行时函数引用（可序列化、可持久化）。
 */
import type { NeedsKey, NeedsScore, NeedsMatrix } from "../core/needs.js";
import type { ModeId, TierId } from "../../types/index.js";
import type { PipelineTemplateId } from "../routing/templates.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";

// ════════════════════════════════════════════════════════
// 一、Agent 结构类型（5 种可组合原语）
// ════════════════════════════════════════════════════════

export type AgentStructureType =
  | "single-turn"
  | "chunked"
  | "sequence"
  | "conditional"
  | "deterministic"
  /** nested 子 DAG：专家 = 工程师组合；Phase-1 M1 新增。 */
  | "composite"
  /**
   * 拓扑分层执行：同层并行、层间顺序，层间靠滑动窗口摘要传递前驱实际产出，
   * 单元级支持约束校验重试。覆盖 ChunkedConfig 表达不了的"逐节点填充 + 片间
   * 数据流 + 片内重试"（情节席、分镜席）；框架层实现方案 M1 新增。
   */
  | "wave";

export interface SingleTurnConfig {
  temperature?: number;
  responseFormat: "json" | "text";
  retryCount?: number;
  streaming?: boolean;
  /**
   * 起飞前处理器名称（注册在 PROCESSOR_REGISTRY）。在渲染提示词之前跑，两种用法：
   *   1. side effect 后继续：如百科娘先联网检索，把结果写进 ctx 私有键供 composer 读，
   *      返回值缺省即继续走正常的 LLM 调用；
   *   2. 短路跳过：如内容检查在没有送检材料时不该发请求，返回 `{ skip: true, result }`
   *      直接把 result 当最终产出，不调用 LLM、不跑 validators/normalizer。
   * 两者合一是因为跳过本身也需要先判断"有没有材料"这个 side effect 读取。
   */
  preflight?: string;
}

/** SingleTurnConfig.preflight 的返回形状；不跳过就返回 undefined（side effect 已生效于 ctx）。 */
export type PreflightResult = { skip: true; result: unknown };

export type PreflightFn = (
  ctx: NarrativeContext,
  llm: LLMClient,
) => Promise<PreflightResult | void>;

export interface ChunkedConfig {
  chunkStrategy: "by-act" | "by-scene" | "by-parent" | "by-batch" | "topological-wave";
  /** "serial" = 逐个串行；数字 = 最大并行度 */
  concurrency: "serial" | number;
  /** 分块专用 user prompt 模板 ID（覆盖主模板的 user prompt） */
  perChunkTemplateId?: string;
  mergeStrategy: "concat" | "deep-merge" | "custom";
  /** SingleTurn 层的 LLM 配置 */
  llm?: SingleTurnConfig;
}

/**
 * 拓扑层里的一个执行单元（对应剧情树/分镜树的一个节点）。
 *
 * 与 ChunkedConfig 分片的差别：多了 `prevIds`——层间要把前驱**实际生成内容**的
 * 滑动窗口摘要传给后继，split 阶段就必须交代清楚谁依赖谁，否则 runner 不知道
 * 该把哪几份摘要拼给哪个单元。
 */
export interface WaveUnit {
  /** 单元 ID（通常即 node_id），落地/摘要/进度上报都按它对齐。 */
  unitId: string;
  /** 装配 user prompt 用的单元数据，运行时经 `ctx._chunk` 传给 PromptComposer。 */
  data: Record<string, unknown>;
  /** 依赖的前驱单元 ID；取它们的摘要拼进本单元的 user 段。 */
  prevIds: string[];
}

/**
 * 单元完成后写进 `ctx._chunk._wave` 的框架态：滑动窗口摘要与约束修正反馈。
 * 与业务数据（`data`）分层放置，避免框架注入的键与业务字段同名冲突。
 */
export interface WaveChunkMeta {
  /** 前驱单元的滑动窗口摘要（已按 prevIds 拼接），无前驱或无 summarizer 时缺省。 */
  slidingSummary?: string;
  /** 上一次约束校验未通过时的问题清单（拼成文本），首次尝试缺省。 */
  constraintFeedback?: string;
}

export interface WaveConfig {
  /**
   * 层内并发上限。缺省 = 整层一次性并发（与 legacy plot/script 生成的
   * `Promise.all(layer.map(...))` 同量）；"serial" = 层内也逐个串行；
   * 数字 = 按该并发度分批跑完整层。
   */
  concurrency?: "serial" | number;
  /**
   * 单元内约束重试上限（不含首次尝试）。缺省 2，对齐 legacy 的
   * `MAX_CONSTRAINT_RETRIES`。重试耗尽仍不通过则接受当前结果并继续
   * （legacy 语义：约束是质量门不是硬阻断）。
   */
  maxConstraintRetries?: number;
  /** SingleTurn 层的 LLM 配置 */
  llm?: SingleTurnConfig;
}

export interface SequenceStage {
  type: "llm" | "deterministic";
  /** LLM 阶段的提示词模板 ID（指向 agent-templates/ 下的 .md） */
  templateId?: string;
  /**
   * LLM 阶段的 PromptComposer 名称（注册在 stage-composer-registry）。
   * 与 templateId 二选一：多阶段 step 迁移前身本就各阶段各有一份内联
   * PromptComposer（如 story_framework 的 plan/fill 两份），迁移时原样注册
   * 到这张表，不必先誊写成 .md 模板——那是另一条尚未走通的路径。
   * 两者都给时 composerId 优先。
   */
  composerId?: string;
  /** 确定性阶段的处理器名称（注册在 PROCESSOR_REGISTRY） */
  processor?: string;
  /** 条件表达式；为空表示无条件执行 */
  condition?: string;
  /** LLM 配置覆盖 */
  llm?: SingleTurnConfig;
  /**
   * LLM 阶段的验证器名称（注册在 PROCESSOR_REGISTRY 的 validators）。
   * 校验失败触发本阶段的 LLM 重试；与 AgentDef.validators 分工不同——
   * 后者是「整个 agent 只有一次 LLM 调用」时的验证列表，多阶段场景下
   * 每阶段的校验规则通常互不相同（plan 阶段查节点数组，fill 阶段查内容数组）。
   */
  validator?: string;
  /**
   * 本阶段解析后的输出写入 ctx 的私有键（如 "_sf_plan_raw"）。
   * 确定性阶段与靠后的 LLM 阶段只认 ctx，读不到本地变量里的上一阶段返回值——
   * 没有这个键，跨阶段传数据就无路可走（回到"在 step 函数体里传局部变量"的老路）。
   */
  outputKey?: string;
}

export interface SequenceConfig {
  stages: SequenceStage[];
}

export interface ConditionalConfig {
  /** 运行时条件表达式，如 "ctx.target_acts > 1" */
  condition: string;
  /** 条件为 true 时执行的 agent 定义引用 */
  ifTrue: string;
  /** 条件为 false 时执行的 agent 定义引用 */
  ifFalse: string;
}

export interface DeterministicConfig {
  processor: string;
}

/** nested 子 DAG：children + 依赖边 + 可选并行组。 */
export interface CompositeConfig {
  children: string[];
  edges?: Array<{ source: string; target: string }>;
  parallelGroups?: string[][];
}

export type AgentStructure =
  | { type: "single-turn"; config: SingleTurnConfig }
  | { type: "chunked"; config: ChunkedConfig }
  | { type: "sequence"; config: SequenceConfig }
  | { type: "conditional"; config: ConditionalConfig }
  | { type: "deterministic"; config: DeterministicConfig }
  | { type: "composite"; config: CompositeConfig }
  | { type: "wave"; config: WaveConfig };

// ════════════════════════════════════════════════════════
// 二、Agent 定义（纯数据配置，无函数引用）
// ════════════════════════════════════════════════════════

/**
 * IP DNA 算子消费声明（§7 / §7.2b）。
 * 形状与 ip-dna/injection/slot-registry 的 StepSlotSpec 一致：
 * 当 AgentDef 声明本字段时，它即为该 step 算子消费的"单一事实源"，
 * 覆盖 OPERATOR_SLOT_REGISTRY 的默认值（registry 退化为默认提供器）。
 */
export interface ConsumesIpDnaSpec {
  /** 需要的三视角算子槽位名（顺序即注入顺序）。 */
  slots: string[];
  /** 消费的提取层（§3.2）；缺省 ["leaf"]；global 恒注入不必声明。 */
  layers?: import("../../types/narrative-ip-dna.js").ExtractionLayer[];
  /** 是否注入 KAG 关系网络子图（§8）。 */
  kag?: boolean;
  /** 是否注入长记忆账本一致性约束（§10）。 */
  ledger?: boolean;
  /** 检索 query 侧重提示。 */
  queryHint?: string;
}

export interface AgentIOContract {
  /** 必需的 ctx 字段（step 执行前断言存在） */
  requiredInputs: string[];
  /** 可选的 ctx 字段（存在时注入到 prompt，缺失不报错） */
  optionalInputs?: string[];
  /** 写入 ctx 的主字段名 */
  outputField: string;
  /** 派生字段（如 validation_result、player_name） */
  derivedFields?: string[];
  /**
   * IP DNA 算子消费声明（§7.2b）。声明后该 step 在 IP DNA 驱动时装备三视角算子
   * /KAG/账本，由统一注入服务读取本声明（消除与 slot-registry 的双重事实源）。
   */
  consumesIpDna?: ConsumesIpDnaSpec;
}

export interface AgentPromptConfig {
  /** 提示词模板 ID（指向 agent-templates/<templateId>.md） */
  templateId: string;
  /** Skill 白名单（空数组=拒绝所有 skill 注入） */
  skillSlots: string[];
}

export interface AgentDef {
  /** Step ID（与 STEP_IDS 对应，全局唯一） */
  id: string;
  /** 人类可读名称（前端显示用） */
  name: string;
  /**
   * 架构原型（4 类）。缺省时由 structure.type 推导（见 agent-contract.prototypeFromStructure）。
   * 声明即激发对应连接/嵌套能力。
   */
  prototype?: import("../core/agent-contract.js").AgentPrototype;
  /** 结构化执行类型 */
  structure: AgentStructure;
  /** 提示词配置 */
  prompts: AgentPromptConfig;
  /** I/O 契约 */
  io: AgentIOContract;
  /** 前置依赖（step ID 列表） */
  dependencies: string[];
  /** Planner needs 阈值 */
  needsThreshold?: Partial<Record<NeedsKey, number>>;
  /** 策划模式需要设计上下文 */
  needsDesignContext?: boolean;
  /**
   * 验证器名称列表（注册在 VALIDATOR_REGISTRY）。
   * 按顺序执行；任一抛错触发 LLM 重试。
   */
  validators?: string[];
  /**
   * 归一化处理器名称（注册在 PROCESSOR_REGISTRY）。
   * 在 LLM 输出通过验证后对结果执行归一化变换。
   */
  normalizer?: string;
  /** SSE 输出提取键（用于 extractStepOutput 映射） */
  extractOutputKey?: string;
  /** 是否支持节点级重跑 */
  supportsNodeFilter?: boolean;
  /** 是否支持 sub-emit 进度 */
  supportsSubEmit?: boolean;
  /**
   * 是否已完成迁移，可以走 AgentRunner 新路径。
   * false/undefined = 走旧 step 函数路径（向后兼容）。
   * true = 走新 Runner 路径（完整的 .md 模板 + 注册的 processors）。
   *
   * 过渡期使用：AgentDef 注册后默认走旧路径，直到模板和处理器迁移完成。
   */
  useNewRunner?: boolean;
}

// ════════════════════════════════════════════════════════
// 三、Blueprint（配置时组装的不可变管线描述）
// ════════════════════════════════════════════════════════

export interface ResolvedPrompts {
  /**
   * System prompt（已注入 skill slots，不依赖 ctx 的静态部分）。
   * 对于 template 文件中使用 {{ctx.*}} 的 system block，在运行时由 executor 二次渲染。
   */
  systemPrompt: string;
  /**
   * User prompt 模板（含 {{ctx.*}} 占位符）。
   * 运行时由 executor 填充 ctx 数据后生成最终 user prompt。
   */
  userPromptTemplate: string;
  /** 输出 JSON Schema（如有），用于结构化验证 */
  outputSchema?: Record<string, unknown>;
  /**
   * 提示词已经装配完毕，runner 不要再渲染一遍。
   *
   * 从 PromptComposer 解析出来的提示词就是最终文本：占位符已填、IP DNA 段已按骨架
   * 插槽注入。runner 再走一次 renderSystemPrompt 会**第二次**追加 IP DNA 片段
   * （那条路径判定"模板里没有 IP DNA 占位符"就 append，而占位符恰恰已经被消费掉了），
   * 于是同一段算子在提示词里出现两遍。空提示词不报错，重复注入同样不报错。
   */
  final?: boolean;
  /**
   * 装配出这份提示词的 composer 本体（从 composer 解析时带上）。
   *
   * 分片执行必须留着它：每个 chunk 的 user 段依赖的是**这一片**的数据
   * （情节节点、章节摘要……），而解析发生在分片之前，那时 `_chunk` 还不存在。
   * 没有它，ChunkedRunner 只能把同一份"第 0 片"的提示词发给每一片。
   */
  composer?: PromptComposer;
}

export interface StepBlueprint {
  /** 步骤 ID */
  stepId: string;
  /** 步骤在序列中的顺序号（从 0 开始） */
  index: number;
  /** 解析后的 agent 定义 */
  agentDef: AgentDef;
  /** 预解析的提示词（system 部分已注入 skill） */
  resolvedPrompts: ResolvedPrompts;
  /**
   * nested 展开链（不含本步），由 composite 逐层追加。
   * 仅用于子 DAG 环检测，普通管线步为 undefined。
   */
  nestAncestors?: readonly string[];
  /** 综合 complexity/genre 后的执行参数 */
  executionParams: {
    temperature: number;
    retryCount: number;
    streaming: boolean;
    responseFormat: "json" | "text";
  };
}

export interface PipelineBlueprint {
  /** 唯一 ID（可用于持久化引用） */
  id: string;
  /** 品类代码 */
  genreCode: string;
  /** 运行模式 */
  mode: ModeId;
  /** 品类层级 */
  tier: TierId;
  /** 复杂度（0-1） */
  complexity: number;
  /** 管线模板 ID（可能为 needs-driven 表示纯 needs 驱动） */
  pipelineTemplate: PipelineTemplateId | "needs-driven";
  /** 有序步骤蓝图列表 */
  steps: StepBlueprint[];
  /** 并行组标记（steps 中哪些索引构成并行组） */
  parallelGroups: number[][];
  /** 组装时间 */
  createdAt: string;
  /** Planner 决策元数据（调试用） */
  plannerMetadata?: {
    selectedSteps: string[];
    skippedByThreshold: string[];
  };
}

// ════════════════════════════════════════════════════════
// 四、AgentRunner（执行器接口）
// ════════════════════════════════════════════════════════

import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";

export interface AgentRunnerCallbacks {
  /** 步骤级进度上报 */
  onProgress?: (stepId: string, message: string) => void;
  /**
   * 单 agent 执行完成（Phase-2 M9）。由 agent-exec 在两条执行路径的收尾统一发出，
   * composite 子步也会各发一次 —— 单 agent 的 SSE 据此把子 DAG 波次转成 step 帧。
   */
  onAgentComplete?: (stepId: string, output: unknown) => void;
  /** LLM 流式输出 */
  onStream?: (chunk: string, accumulated: string) => void;
  /** 子节点进度 */
  onSubEmit?: (nodeId: string, done: number, total: number) => void;
}

/**
 * Agent 执行器接口。
 * 每种 AgentStructureType 实现一个 Runner。
 */
export interface AgentRunner {
  readonly structureType: AgentStructureType;

  execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown>;
}

// ════════════════════════════════════════════════════════
// 五、Processor 注册表类型（业务逻辑函数引用）
// ════════════════════════════════════════════════════════

/**
 * 验证函数：检查 LLM 输出是否合法。
 * 抛出异常 → 触发 LLM 重试。
 */
export type ValidatorFn = (raw: string, ctx: NarrativeContext) => void;

/**
 * 归一化函数：将 LLM 原始输出变换为标准格式。
 * 返回处理后的数据（写入 ctx）。
 *
 * 允许返回 Promise：把 step 函数搬进 runner 时，收尾常带异步的图质检
 * （任务链去悬空边、剧情树补断点）。若这里只收同步返回值，那些 step 就只能
 * 留在 legacy 路径，或者在迁移时把质检悄悄丢掉 —— 后者产物会退化且不报错。
 */
export type NormalizerFn = (
  parsed: unknown,
  ctx: NarrativeContext,
) => unknown | Promise<unknown>;

/**
 * 单个 chunk 完成后的落地回调（ChunkedRunner 专用）。
 *
 * 逐节点填充那批 step 在每个节点产出后立刻做两件事：写单节点文件（前端节点视图
 * 靠它逐个亮起）、把 node_id 记进已完成集合（续跑据此跳过）。这两件事必须发生在
 * **每个 chunk 完成的那一刻**，合并阶段再做就晚了 —— 中途取消就什么都没落盘。
 */
export type ChunkSinkFn = (
  chunk: { chunkId: string; output: unknown },
  ctx: NarrativeContext,
) => void;

/**
 * 确定性处理器：无 LLM 调用的纯数据变换。
 * 用于 SequenceAgent 的确定性阶段和 DeterministicAgent。
 */
export type ProcessorFn = (ctx: NarrativeContext) => Promise<void> | void;

/**
 * 分块策略函数：将 ctx 中的数据拆分为多个 chunk。
 * 返回 chunk 数组，每个 chunk 附带渲染 user prompt 所需的数据。
 */
export type ChunkSplitterFn = (ctx: NarrativeContext) => Array<{
  chunkId: string;
  data: Record<string, unknown>;
}>;

/**
 * 分块合并函数：将多个 chunk 的 LLM 输出合并为最终结果。
 */
export type ChunkMergerFn = (
  chunks: Array<{ chunkId: string; output: unknown }>,
  ctx: NarrativeContext,
) => unknown;

/**
 * 分层函数（WaveRunner 专用）：把 ctx 中的图结构拆成拓扑层。
 * 同层互不依赖可并行，层间按数组顺序执行。
 */
export type WaveLayererFn = (ctx: NarrativeContext) => WaveUnit[][];

/**
 * 单元摘要函数：从该单元（已归一化）的输出提炼一段滑动窗口摘要，
 * 供依赖它的后继单元在 `ctx._chunk._wave.slidingSummary` 里读到。
 * 未登记等同"不传摘要"——层间顺序仍然生效，只是没有前驱内容提示。
 */
export type WaveSummarizerFn = (output: unknown) => string;

/**
 * 单元约束校验：返回非空数组即视为未通过，触发下一次重试（问题清单会拼进
 * `ctx._chunk._wave.constraintFeedback`）；未登记等同"不做约束校验"，每单元只跑一次。
 *
 * 第三参传本单元（`unit.data` 带的就是分层时塞进去的节点材料）：约束校验天生是
 * 逐节点的（边界/范围约束都相对"这一个节点该有的 cause/result/content"而言），
 * 只给全局 ctx 够不到——校验函数需要自己读 `unit.data` 取出当前节点的骨架字段。
 */
export type WaveConstraintCheckFn = (
  output: unknown,
  ctx: NarrativeContext,
  unit: WaveUnit,
) => string[];
