/**
 * agent-contract.ts — Phase-1 M0/M1 SSOT
 *
 * Agent = 「带类型的函数结构体」：
 *   agent(inputs, ctx, config) → outputs + lifecycle 跃迁
 *
 * 声明五件事：
 *   1. type（4 原型）—— 能力开关，决定连接方式与运行方式
 *   2. 数据契约（I/O）—— 数据如何进出一个 agent
 *   3. 连接能力 —— 由 type 派生，画布活连接合法性据此校验
 *   4. 运行方式 —— 绑定到执行原语 Runner
 *   5. 配置 + 生命周期 —— 聚合进 RunManifest
 *
 * 本文件是契约字段定义 + 需求验证矩阵；实现侧逐步把
 * StepDescriptor / AgentDef / universal-agent 收敛到此。
 */
import type {
  AgentDef,
  AgentStructure,
  AgentStructureType,
  CompositeConfig,
  ConsumesIpDnaSpec,
} from "../blueprint/types.js";

export type { CompositeConfig };

// ════════════════════════════════════════════════════════
// 一、4 原型（架构分类 · 面向用户/画布）
// ════════════════════════════════════════════════════════

/** 架构分类：声明即激发框架对应的连接/组合/嵌套能力。 */
export type AgentPrototype = "atomic" | "serial" | "parallel" | "nested";

/** 执行原语（与 AgentStructureType 对齐，含 composite）。 */
export type AgentExecutionPrimitive = AgentStructureType;

/**
 * 4 原型 → 可绑定的执行原语。
 *
 * parallel 下两个原语覆盖同一原型的两种子形态：chunked 是片间互不依赖
 * （quest_generation），wave 是片间有拓扑依赖、要传滑动窗口摘要
 * （plot_generation、script_generation）——对画布连接能力/嵌套判定而言
 * 两者等价（都是"同层可并发的多 agent"），差别只在片间是否传数据。
 */
export const PROTOTYPE_PRIMITIVES: Record<AgentPrototype, readonly AgentExecutionPrimitive[]> = {
  atomic: ["single-turn", "deterministic"],
  serial: ["sequence"],
  parallel: ["chunked", "wave"],
  nested: ["composite", "conditional"],
} as const;

/** 执行原语 → 默认架构原型（桥接旧 AgentDef.structure.type）。 */
export function prototypeFromStructure(type: AgentExecutionPrimitive): AgentPrototype {
  switch (type) {
    case "single-turn":
    case "deterministic":
      return "atomic";
    case "sequence":
      return "serial";
    case "chunked":
    case "wave":
      return "parallel";
    case "composite":
    case "conditional":
      return "nested";
  }
}

// ════════════════════════════════════════════════════════
// 二、连接能力（由 type 派生）
// ════════════════════════════════════════════════════════

export interface ConnectionCapabilities {
  /** 可作为串行边的一环（有入/出把手）。 */
  canSerialEdge: boolean;
  /** 可加入并行组（同层并发）。 */
  canParallelGroup: boolean;
  /** 可作为 nested 父节点，内嵌子图。 */
  canNestChildren: boolean;
  /** 可作为 conditional 分支目标。 */
  canBeBranchTarget: boolean;
  /** 可作为管线开始节点（input 锚点；无左把手）。 */
  canBeStart: boolean;
  /** 可作为管线末端节点（无右把手）。 */
  canBeEnd: boolean;
}

/** 由原型派生默认连接能力；角色层（input/expert…）可再收窄。 */
export function connectionCapabilitiesOf(prototype: AgentPrototype): ConnectionCapabilities {
  switch (prototype) {
    case "atomic":
      return {
        canSerialEdge: true,
        canParallelGroup: true,
        canNestChildren: false,
        canBeBranchTarget: true,
        canBeStart: false,
        canBeEnd: true,
      };
    case "serial":
      return {
        canSerialEdge: true,
        canParallelGroup: false,
        canNestChildren: false,
        canBeBranchTarget: true,
        canBeStart: false,
        canBeEnd: true,
      };
    case "parallel":
      return {
        canSerialEdge: true,
        canParallelGroup: true,
        canNestChildren: false,
        canBeBranchTarget: true,
        canBeStart: false,
        canBeEnd: true,
      };
    case "nested":
      return {
        canSerialEdge: true,
        canParallelGroup: true,
        canNestChildren: true,
        canBeBranchTarget: true,
        canBeStart: false,
        canBeEnd: true,
      };
  }
}

// ════════════════════════════════════════════════════════
// 三、生命周期（每 agent 持久状态）
// ════════════════════════════════════════════════════════

export type AgentLifecycle =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "failed";

export interface AgentLifecycleRecord {
  status: AgentLifecycle;
  /** ISO 时间；pending 时可缺省。 */
  updatedAt?: string;
  message?: string;
  error?: string;
}

export const TERMINAL_LIFECYCLES: ReadonlySet<AgentLifecycle> = new Set([
  "completed",
  "skipped",
  "failed",
]);

export function isTerminalLifecycle(s: AgentLifecycle): boolean {
  return TERMINAL_LIFECYCLES.has(s);
}

/** resume/skip：已完成或显式跳过则不再执行。 */
export function shouldSkipByLifecycle(s: AgentLifecycle): boolean {
  return s === "completed" || s === "skipped";
}

// ════════════════════════════════════════════════════════
// 四、数据契约（I/O）
// ════════════════════════════════════════════════════════

export interface AgentDataContract {
  requiredInputs: string[];
  optionalInputs?: string[];
  outputField: string;
  derivedFields?: string[];
  /** IP DNA 注入声明（层级 × 槽位）。 */
  consumesIpDna?: ConsumesIpDnaSpec;
}

// ════════════════════════════════════════════════════════
// 五、NarrativeAgent = 带类型的函数结构体（根抽象）
// ════════════════════════════════════════════════════════

/**
 * 统一 Agent 契约（纯数据，可序列化）。
 * 过渡期与 AgentDef 字段对齐；新增 prototype / lifecycle 默认值 / composite。
 */
export interface NarrativeAgent {
  id: string;
  name: string;
  /** 4 原型 —— 能力开关。 */
  prototype: AgentPrototype;
  /** 执行原语配置（含 composite）。 */
  structure: AgentStructure;
  /** 数据 I/O 契约。 */
  io: AgentDataContract;
  /** 提示词配置（模板 + skill 白名单）。 */
  prompts: {
    templateId: string;
    skillSlots: string[];
    /** V1 槽位化组装 | V2 精调整体调用。 */
    promptLibrary?: "v1" | "v2";
  };
  /** 前置依赖（同层 agent id）。 */
  dependencies: string[];
  /** 运行参数默认值。 */
  config?: {
    temperature?: number;
    retryCount?: number;
    responseFormat?: "json" | "text";
    streaming?: boolean;
    needsThreshold?: AgentDef["needsThreshold"];
    needsDesignContext?: boolean;
  };
  validators?: string[];
  normalizer?: string;
  extractOutputKey?: string;
  supportsNodeFilter?: boolean;
  supportsSubEmit?: boolean;
  /** true = 走新 Runner；false/缺省 = legacy step fn。 */
  useNewRunner?: boolean;
  /**
   * 画布角色分类（可选元数据；不影响执行）。
   * input/routing/expert/assistant/engineer
   */
  roleCategory?: "input" | "routing" | "expert" | "assistant" | "engineer";
  /**
   * 所属单品助手席位（编号 2.3.x，见 assistant-seats.ts）。
   * 执行层按 agent 走，展示与归档按席位走——同一席位在不同品类下
   * 落到不同 agent，前端据此把进度与产物归到同一个助手名下。
   */
  seatId?: string;
}

/** 从原型派生连接能力，并按 roleCategory 收窄。 */
export function resolveConnectionCapabilities(agent: NarrativeAgent): ConnectionCapabilities {
  const base = connectionCapabilitiesOf(agent.prototype);
  if (agent.roleCategory === "input") {
    return { ...base, canBeStart: true, canBeEnd: false };
  }
  if (agent.roleCategory === "expert" && agent.prototype === "nested") {
    return { ...base, canNestChildren: true };
  }
  return base;
}

/** AgentDef → NarrativeAgent（桥接；prototype 由 structure 推导）。 */
export function narrativeAgentFromDef(def: AgentDef): NarrativeAgent {
  const structureType = def.structure.type as AgentExecutionPrimitive;
  return {
    id: def.id,
    name: def.name,
    prototype: prototypeFromStructure(structureType),
    structure: def.structure,
    io: {
      requiredInputs: def.io.requiredInputs,
      optionalInputs: def.io.optionalInputs,
      outputField: def.io.outputField,
      derivedFields: def.io.derivedFields,
      consumesIpDna: def.io.consumesIpDna,
    },
    prompts: {
      templateId: def.prompts.templateId,
      skillSlots: def.prompts.skillSlots,
    },
    dependencies: def.dependencies,
    config: {
      needsThreshold: def.needsThreshold,
      needsDesignContext: def.needsDesignContext,
    },
    validators: def.validators,
    normalizer: def.normalizer,
    extractOutputKey: def.extractOutputKey,
    supportsNodeFilter: def.supportsNodeFilter,
    supportsSubEmit: def.supportsSubEmit,
    useNewRunner: def.useNewRunner,
  };
}

/** NarrativeAgent → AgentDef（含 composite）。 */
export function agentDefFromNarrative(agent: NarrativeAgent): AgentDef {
  return {
    id: agent.id,
    name: agent.name,
    prototype: agent.prototype,
    structure: agent.structure,
    prompts: {
      templateId: agent.prompts.templateId,
      skillSlots: agent.prompts.skillSlots,
    },
    io: {
      requiredInputs: agent.io.requiredInputs,
      optionalInputs: agent.io.optionalInputs,
      outputField: agent.io.outputField,
      derivedFields: agent.io.derivedFields,
      consumesIpDna: agent.io.consumesIpDna,
    },
    dependencies: agent.dependencies,
    needsThreshold: agent.config?.needsThreshold,
    needsDesignContext: agent.config?.needsDesignContext,
    validators: agent.validators,
    normalizer: agent.normalizer,
    extractOutputKey: agent.extractOutputKey,
    supportsNodeFilter: agent.supportsNodeFilter,
    supportsSubEmit: agent.supportsSubEmit,
    useNewRunner: agent.useNewRunner,
  };
}

// ════════════════════════════════════════════════════════
// 七、需求 × 字段验证矩阵（M0 设计闸门）
// ════════════════════════════════════════════════════════

export type ContractField =
  | "prototype"
  | "io"
  | "connection"
  | "structure"
  | "lifecycle"
  | "prompts"
  | "consumesIpDna"
  | "compositionGraph"
  | "runManifest";

export interface RequirementMapping {
  /** 产品需求简述。 */
  requirement: string;
  /** 表达该需求所需的契约字段。 */
  fields: ContractField[];
  /** 是否已可在当前契约上完整表达。 */
  expressible: boolean;
  note?: string;
}

/**
 * 所有既有需求必须能在结构体字段上表达；
 * expressible=false 表示抽象不完备，须先补字段再编码。
 */
export const REQUIREMENT_FIELD_MATRIX: readonly RequirementMapping[] = [
  {
    requirement: "工程师（叙事单品）= atomic，单步 I/O，可独立调用",
    fields: ["prototype", "io", "structure"],
    expressible: true,
  },
  {
    requirement: "助手（叙事策略）= 可插拔 prompt 槽；可为 atomic 或 nested 子节点",
    fields: ["prototype", "prompts", "structure"],
    expressible: true,
  },
  {
    requirement: "专家（品类）= nested，body=工程师子 DAG（预制管线 tpl-xxx）",
    fields: ["prototype", "structure", "compositionGraph"],
    expressible: true,
    note: "composite.children + edges 表达子 DAG",
  },
  {
    requirement: "叙事单品 vs 叙事全量 = 连接方式差异，非两套代码",
    fields: ["connection", "prototype"],
    expressible: true,
  },
  {
    requirement: "串行 / 并行 / 嵌套 = type + 连接能力",
    fields: ["prototype", "connection", "structure"],
    expressible: true,
  },
  {
    requirement: "跳过 / 已完成 → lifecycle 驱动 resume/skip",
    fields: ["lifecycle", "runManifest"],
    expressible: true,
  },
  {
    requirement: "IP DNA 注入 = consumesIpDna（层级 × 字段）",
    fields: ["io", "consumesIpDna"],
    expressible: true,
  },
  {
    requirement: "无限画布活连接 = 连接能力校验 + RunManifest 锚定",
    fields: ["connection", "compositionGraph", "runManifest"],
    expressible: true,
  },
  {
    requirement: "断点续跑 / 单步重跑 = lifecycle + 单步调用入口",
    fields: ["lifecycle", "io", "runManifest"],
    expressible: true,
  },
  {
    requirement: "多管线条目：一条目=一组 manifest，按独立开始节点切分",
    fields: ["runManifest", "compositionGraph", "connection"],
    expressible: true,
    note: "EntryRecord.pipelines[]；canBeStart 识别开始节点",
  },
  {
    requirement: "前端 I 写配置 / O 读 lifecycle+产出；算法只在后端",
    fields: ["runManifest", "lifecycle", "io"],
    expressible: true,
  },
] as const;

/** M0 闸门：全部需求必须 expressible。 */
export function assertRequirementMatrixComplete(): void {
  const gaps = REQUIREMENT_FIELD_MATRIX.filter((r) => !r.expressible);
  if (gaps.length > 0) {
    throw new Error(
      `Agent contract incomplete; unexpressible requirements:\n` +
        gaps.map((g) => `  - ${g.requirement}`).join("\n"),
    );
  }
}
