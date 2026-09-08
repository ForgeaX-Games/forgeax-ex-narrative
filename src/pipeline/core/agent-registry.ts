/**
 * agent-registry.ts — 统一 Agent 注册表门面（Phase-1 M1）
 *
 * SSOT 查询路径：
 *   1. AgentDef 注册表（纯数据 + structure）
 *   2. StepDescriptor 注册表（含 legacy fn）— 自动桥接为 NarrativeAgent
 *
 * 外部代码应优先经本门面查询，避免双事实源分叉。
 */
import {
  type NarrativeAgent,
  narrativeAgentFromDef,
  prototypeFromStructure,
  resolveConnectionCapabilities,
  type ConnectionCapabilities,
} from "./agent-contract.js";
import {
  getAgentDef,
  getAllAgentDefs,
  hasAgentDef,
  registerAgentDef,
} from "../blueprint/agent-def-registry.js";
import type { AgentDef } from "../blueprint/types.js";
import { getSeatForAgent } from "../routing/assistant-seats.js";
import {
  getStepRequiredInputs,
  STEP_REGISTRY,
  type StepDescriptor,
} from "./step-registry.js";

export function registerNarrativeAgent(agent: NarrativeAgent): void {
  const def: AgentDef = {
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
  registerAgentDef(def);
}

/**
 * 补上席位归属。
 *
 * narrativeAgentFromDef 只翻译 AgentDef 自己有的字段，而席位归属是另一层
 * 事实（assistant-seats 的绑定表）。不在这里补，注册过 AgentDef 的 agent 就会
 * 比桥接出来的少一份归属信息——前端按席位归并进度与产物会漏，
 * resolveConnectionCapabilities 也拿不到 roleCategory。
 */
function withSeatMetadata(agent: NarrativeAgent): NarrativeAgent {
  const seat = getSeatForAgent(agent.id);
  if (!seat) return agent;
  agent.seatId = seat.id;
  agent.roleCategory ??= "engineer";
  return agent;
}

function fromDef(def: AgentDef): NarrativeAgent {
  const agent = narrativeAgentFromDef(def);
  if (def.prototype) agent.prototype = def.prototype;
  return withSeatMetadata(agent);
}

export function getNarrativeAgent(id: string): NarrativeAgent | undefined {
  const def = getAgentDef(id);
  if (def) return fromDef(def);
  const desc = STEP_REGISTRY.get(id);
  if (!desc) return undefined;
  return bridgeStepDescriptor(desc);
}

export function getNarrativeAgentOrThrow(id: string): NarrativeAgent {
  const agent = getNarrativeAgent(id);
  if (!agent) throw new Error(`NarrativeAgent not registered: ${id}`);
  return agent;
}

export function hasNarrativeAgent(id: string): boolean {
  return hasAgentDef(id) || STEP_REGISTRY.has(id);
}

export function listNarrativeAgents(): NarrativeAgent[] {
  const seen = new Set<string>();
  const out: NarrativeAgent[] = [];
  for (const def of getAllAgentDefs()) {
    seen.add(def.id);
    out.push(fromDef(def));
  }
  for (const desc of STEP_REGISTRY.values()) {
    if (seen.has(desc.id)) continue;
    out.push(bridgeStepDescriptor(desc));
  }
  return out;
}

export function getAgentConnectionCapabilities(id: string): ConnectionCapabilities | undefined {
  const agent = getNarrativeAgent(id);
  if (!agent) return undefined;
  return resolveConnectionCapabilities(agent);
}

function bridgeStepDescriptor(desc: StepDescriptor): NarrativeAgent {
  return {
    id: desc.id,
    name: desc.name,
    prototype: prototypeFromStructure("single-turn"),
    structure: {
      type: "single-turn",
      config: {
        temperature: desc.temperature ?? 0.7,
        responseFormat: desc.responseFormat ?? "json",
        retryCount: 3,
        streaming: false,
      },
    },
    io: {
      requiredInputs: getStepRequiredInputs(desc.id),
      optionalInputs: desc.optionalInputs,
      outputField: desc.outputFields[0] ?? desc.id,
      derivedFields: desc.derivedFields,
    },
    prompts: {
      templateId: desc.id,
      skillSlots: desc.composer?.skillSlots ?? [],
    },
    dependencies: desc.dependsOn,
    config: {
      temperature: desc.temperature,
      responseFormat: desc.responseFormat,
      needsThreshold: desc.needsThreshold,
      needsDesignContext: desc.needsDesignContext,
    },
    extractOutputKey: desc.extractOutputKey,
    supportsNodeFilter: desc.supportsNodeFilter,
    supportsSubEmit: desc.supportsSubEmit,
    seatId: getSeatForAgent(desc.id)?.id,
    roleCategory: getSeatForAgent(desc.id) ? "engineer" : undefined,
  };
}
