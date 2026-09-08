/**
 * blueprint/agent-def-registry.ts
 *
 * Agent 定义注册表。存储所有 step 的 AgentDef 纯数据配置。
 *
 * 过渡期策略：
 *   - 有 AgentDef 注册的 step → 走新 Blueprint + Runner 路径
 *   - 未注册的 step → 走旧 StepDescriptor.fn 路径（向后兼容）
 *
 * AgentDef 不含任何函数引用，可序列化为 JSON/YAML。
 * 运行时行为（validator/normalizer/processor）通过名称引用 processor-registry。
 */
import type { AgentDef } from "./types.js";

const registry = new Map<string, AgentDef>();

export function registerAgentDef(def: AgentDef): void {
  registry.set(def.id, def);
}

export function getAgentDef(stepId: string): AgentDef | undefined {
  return registry.get(stepId);
}

export function hasAgentDef(stepId: string): boolean {
  return registry.has(stepId);
}

export function getAllAgentDefs(): AgentDef[] {
  return [...registry.values()];
}

export function getAgentDefOrThrow(stepId: string): AgentDef {
  const def = registry.get(stepId);
  if (!def) throw new Error(`AgentDef not registered: ${stepId}`);
  return def;
}

export const AGENT_DEF_REGISTRY = registry;
