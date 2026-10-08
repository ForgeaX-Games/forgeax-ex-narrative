/**
 * seat-agents.ts —— 按配置表批量注册席位 agent
 *
 * 做的事只有一件：把 seat-spec.ts 声明的**形态**盖到实现上，让每个席位实现
 * 都有自己的 AgentDef，而不是一律走 bridgeStepDescriptor 的硬编码 single-turn。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么不逐个手写 AgentDef
 * ─────────────────────────────────────────────────────────────────
 * AgentDef 里绝大多数字段（io 契约、依赖边、LLM 参数、extractOutputKey）
 * StepDescriptor 已经有了，手写一遍等于把同一件事说两次，迟早漂移。
 * 所以这里从 StepDescriptor 派生全部可派生字段，配置表只提供它独有的那一项：
 * prototype。
 *
 * ─────────────────────────────────────────────────────────────────
 * 席位形态 → agent 形态的下沉规则
 * ─────────────────────────────────────────────────────────────────
 * 配置表的「agent 类型」描述的是**席位**。席位与实现不是一对一：
 *
 *   一席一实现  该实现独自承担席位职责 → 继承席位形态
 *               （角色档案席 parallel → character_enrichment 就是那个并行体）
 *   一席多实现  席位的形态由这几个实现**串起来**才成立，单个实现是其中一阶
 *               → 每个实现是 atomic，席位的串行性由 binding 的顺序表达
 *               （故事结构席 serial = outline_batch → detailed_outline）
 *
 * 不做这层下沉的话，outline_batch 会被标成 serial，而它自己只是一次调用——
 * 画布据 prototype 推连接能力，标错会让它显示成能嵌子节点。
 *
 * ─────────────────────────────────────────────────────────────────
 * useNewRunner 谁开谁不开
 * ─────────────────────────────────────────────────────────────────
 * 注册 AgentDef 与「交给新 runner 跑」是两件事。各 step 函数体内除了调 LLM 还做了
 * 落地工作（派生字段、修复、二次校验、分批），这些不搬进 runner 就不能切。
 * 所以默认仍走 step 函数；只有把那些逻辑提成命名 processor 并登记在
 * runner-migration.ts 的实现才翻 useNewRunner —— 那张表就是「已迁移」的唯一名单。
 */
import {
  ASSISTANT_SEATS,
  getSeatForAgent,
  resolveSeatAgents,
  resolveSeatPrimaryAgents,
  resolveSeatRequiredFields,
  type SeatBinding,
  type SeatRunPolicy,
  type SeatScope,
} from "../routing/assistant-seats.js";
import { blockingSeatIds } from "./input-provenance.js";
import { registerAgentDef, hasAgentDef } from "../blueprint/agent-def-registry.js";
import type { AgentDef, SingleTurnConfig } from "../blueprint/types.js";
import { getRunnerMigration } from "./runner-migration.js";
import type { AgentPrototype } from "./agent-contract.js";
import { executableStructureFor, getSeatSpec } from "../routing/seat-spec.js";
import {
  getStepRequiredInputs,
  STEP_REGISTRY,
  type StepDescriptor,
} from "./step-registry.js";

/**
 * 该实现在其席位里是否独自承担职责。
 *
 * 判据取该 agent 出现的所有 binding：只要有一条 binding 是多 agent 串成的，
 * 它就是某条席内 workflow 的一阶。
 */
function isSoleImplementation(agentId: string, bindings: readonly SeatBinding[]): boolean {
  const involved = bindings.filter((b) => b.agentIds.includes(agentId));
  return involved.length > 0 && involved.every((b) => b.agentIds.length === 1);
}

/** 该 agent 应声明的原型；不属于任何有规格的席位则返回 undefined。 */
export function seatAgentPrototype(agentId: string): AgentPrototype | undefined {
  const seat = getSeatForAgent(agentId);
  if (!seat) return undefined;
  const spec = getSeatSpec(seat.id);
  if (!spec) return undefined;
  return isSoleImplementation(agentId, seat.bindings) ? spec.prototype : "atomic";
}

/**
 * StepDescriptor + 配置表 → AgentDef。
 *
 * structure 取 executableStructureFor 给的**今天真能跑的原语**，与 prototype
 * 的落差由 seat-spec 的落差登记表负责交代。非 single-turn 原语在这里显式抛错，
 * 因为它们各自需要自己的 config（分片策略、阶段列表），派生不出来——
 * 那一天到了，应该是有人在这里加分支，而不是让它悄悄拿到一份错配置。
 *
 * 已迁移到 runner 的实现（RUNNER_MIGRATIONS）额外带上它的 validator / normalizer /
 * 分片或确定性配置，并翻开 useNewRunner；其余仍走 legacy step 函数。
 *
 * structure_check 是一个具体例子：席位按 CSV 声明是「单agent」（single-turn），
 * 但实际实现无 LLM 调用、直接跑纯函数——migration.deterministic 存在时以它为准，
 * 这类"声明与实跑不符"由 seat-spec 的 SHAPE_DIVERGENCES 登记交代，不是这里的职责。
 */
export function buildSeatAgentDef(desc: StepDescriptor, seatId: string): AgentDef {
  const migration = getRunnerMigration(desc.id);
  const structureType = migration?.chunked
    ? "chunked"
    : migration?.deterministic
      ? "deterministic"
      : migration?.sequence
        ? "sequence"
        : migration?.wave
          ? "wave"
          : executableStructureFor(seatId, desc.id);
  if (
    structureType !== "single-turn"
    && !migration?.chunked
    && !migration?.deterministic
    && !migration?.sequence
    && !migration?.wave
  ) {
    throw new Error(
      `席位 ${seatId} 的可执行原语已升级为 ${structureType}，`
        + "但 buildSeatAgentDef 还只会派生 single-turn 配置——请在此补该原语的 config 派生",
    );
  }

  const llm: SingleTurnConfig = {
    temperature: desc.temperature ?? 0.7,
    responseFormat: desc.responseFormat ?? "json",
    retryCount: 3,
    streaming: false,
    ...migration?.llm,
  };

  return {
    id: desc.id,
    name: desc.name,
    prototype: seatAgentPrototype(desc.id),
    structure: migration?.chunked
      ? { type: "chunked", config: { ...migration.chunked, llm: migration.chunked.llm ?? llm } }
      : migration?.deterministic
        ? { type: "deterministic", config: migration.deterministic }
        : migration?.sequence
          ? { type: "sequence", config: migration.sequence }
          : migration?.wave
            ? { type: "wave", config: { ...migration.wave, llm: migration.wave.llm ?? llm } }
            : { type: "single-turn", config: llm },
    prompts: {
      // 生产提示词是各 step 内联的 PromptComposer，templateId 只作标识，
      // 不指向 agent-templates/ 下的文件（那批 .md 已归档）。
      templateId: desc.id,
      skillSlots: desc.composer?.skillSlots ?? [],
    },
    io: {
      requiredInputs: getStepRequiredInputs(desc.id),
      optionalInputs: desc.optionalInputs,
      outputField: desc.outputFields[0] ?? desc.id,
      derivedFields: desc.derivedFields,
    },
    dependencies: desc.dependsOn,
    needsThreshold: desc.needsThreshold,
    needsDesignContext: desc.needsDesignContext,
    validators: migration?.validators,
    normalizer: migration?.normalizer,
    extractOutputKey: desc.extractOutputKey,
    supportsNodeFilter: desc.supportsNodeFilter,
    supportsSubEmit: desc.supportsSubEmit,
    useNewRunner: migration !== undefined,
  };
}

/**
 * 把各席位的实现注册成 AgentDef。返回新注册的 agent id。
 *
 * 只认 binding 里的实现，不认 alsoOwns——后者是已被合并或没接进任何模板的
 * 老形态，给它们盖形态声明没有意义（它们不会被任何管线解析到）。
 *
 * 已有手写 AgentDef 的（叙事卡带 validator 与算子消费声明）跳过：
 * 手写的信息比派生的多，覆盖它就是倒退。
 */
/**
 * G3：把「席位 id」解析成一个当下真能跑的 AgentDef id。
 *
 * 三种情形：
 *   - 席位 id 自己就有 AgentDef（单步席恰好同名，或多步席已建席位级 composite
 *     外壳，如 structure / req_list）→ 直接就是那个 id；
 *   - 单步席但 step 命名与席位不同（如 outline 席实现是 story_framework）→
 *     解析到通用兜底绑定唯一的那个 agentId；
 *   - 多步席且尚未建 composite 外壳 → 无法安全代选其中一步当"这一席"，
 *     返回 undefined（调用方应回退到报错而不是猜一个）。
 *
 * 不处理作用域绑定（vn-v2 的上传剧本分支等）：平台工具面调用的是"通用这一席
 * 现在跑什么"，模板/模式专属实现仍只能用其原生 step id 调。
 */
export function resolveSeatRunnableAgentId(seatId: string, scope: SeatScope = {}): string | undefined {
  if (hasAgentDef(seatId)) return seatId;
  const agents = resolveSeatPrimaryAgents(seatId, scope);
  return agents.length === 1 ? agents[0] : undefined;
}

/** 供席位发现工具/端点用的单席描述。 */
export interface SeatDiscoveryEntry {
  id: string;
  featureId: string;
  name: string;
  kind: string;
  status: "active" | "planned";
  contentType: string | null;
  /**
   * 通用兜底绑定下，这一席今天能否被**解析**到一个可跑的实现。
   *
   * 注意这与"上游齐不齐"无关——那由 runPolicy 与 blockedBy 表达。两件事分开的原因是
   * 前端要区分"这一席还没实现"（不可解析）与"实现有但缺上游"（可解析、被挡住）。
   */
  canRunStandalone: boolean;
  /** 单独调用这一席时，实际会跑的 AgentDef id（可能是席位 id 本身，也可能是子 step id）。 */
  runnableAgentId?: string;
  /** 单独调用前应当已具备的 ctx 字段。independent 席为空或只含 user_input。 */
  requiredInputs: string[];
  /** 独立起跑能力；planned 席无此项。 */
  runPolicy?: SeatRunPolicy;
  /**
   * 挡住这一席的席位 id：requiredInputs 里每个字段反查其产出席位后去重。
   * 前端据此把入口灰置并提示"需先运行【X 助手】"，而不是让用户点下去吃 422。
   */
  blockedBy: string[];
}

/** 列出全部席位供平台代理/画布发现，标出哪些今天可被单独调用。 */
export function listSeatDiscovery(): SeatDiscoveryEntry[] {
  return ASSISTANT_SEATS.map((seat) => {
    const runnableAgentId = seat.status === "active" ? resolveSeatRunnableAgentId(seat.id) : undefined;
    const requiredInputs = runnableAgentId ? resolveSeatRequiredFields(seat.id) : [];
    return {
      id: seat.id,
      featureId: seat.featureId,
      name: seat.name,
      kind: seat.kind,
      status: seat.status,
      contentType: seat.contentType,
      canRunStandalone: runnableAgentId !== undefined,
      runnableAgentId,
      requiredInputs,
      runPolicy: seat.runPolicy,
      blockedBy: blockingSeatIds(requiredInputs),
    };
  });
}

export function registerSeatAgentDefs(): string[] {
  const registered: string[] = [];

  for (const seat of ASSISTANT_SEATS) {
    if (!getSeatSpec(seat.id)) continue;
    // 派生子步也要有自己的 AgentDef：它真的会跑，少了它就是一条裸 step——
    // 席位归属查不到、执行原语拿不到，而这两样都是新 runner 的入场条件。
    const owned = [...seat.bindings.flatMap((b) => b.agentIds), ...(seat.derivedAgents ?? [])];
    for (const agentId of owned) {
      if (hasAgentDef(agentId)) continue;
      const desc = STEP_REGISTRY.get(agentId);
      if (!desc) continue; // 绑定指向未注册 step，由 assistant-seats.test 报错

      registerAgentDef(buildSeatAgentDef(desc, seat.id));
      registered.push(agentId);
    }
  }

  return registered;
}
