/**
 * run-manifest-runtime.ts — RunManifest 作为运行时事实源（Phase-2 M7）
 *
 * 一期的 RunManifest 只服务 `/plan` 预览；`/start` 与 `/resume` 仍靠
 * `_checkpoint.json` 的 `completedSteps` 线性前缀。本模块把 manifest 接进运行路径：
 *
 *   - `/start` 落盘 manifest，onStepComplete 逐 agent 跃迁 lifecycle
 *   - `/resume` 从 manifest（或旧 checkpoint 桥接）还原 lifecycle，逐 agent 判定跳过
 *   - `completedSteps` 降级为由 lifecycle 派生的兼容视图（读侧 43 处引用无需改动）
 */
import { randomUUID } from "node:crypto";
import {
  type AgentLifecycle,
  type AgentLifecycleRecord,
  shouldSkipByLifecycle,
} from "../core/agent-contract.js";
import {
  type ManifestAgentSlot,
  type PipelineRunStatus,
  type RunManifest,
  type RunManifestConfig,
  lifecycleFromCompletedSteps,
} from "../../types/run-manifest.js";
import { buildAgentSlots } from "./run-manifest-builder.js";

/** checkpoint 内的 agent 切片（比 ManifestAgentSlot 更薄，只存跃迁事实）。 */
export interface CheckpointAgentSlot {
  agentId: string;
  index: number;
  lifecycle: AgentLifecycleRecord;
}

export interface ManifestFromStepsInput {
  entryKey: string;
  stepIds: string[];
  config: RunManifestConfig;
  pipelineId?: string;
  runId?: string;
  status?: PipelineRunStatus;
  lifecycle?: Record<string, AgentLifecycle>;
}

/**
 * 由「权威步骤序」直接构造运行时 manifest。
 *
 * 不复用 buildRunManifest：运行时的步骤序来自 pipeline 自己 announce 的那一份
 * （含 design_auto 动态追加的叙事步），比重跑一次 planPipeline 更权威 ——
 * 尤其 auto 路由在 tier_router 之前还没有 genreCode，重算会planner 兜底到错品类。
 */
export function manifestFromStepIds(input: ManifestFromStepsInput): RunManifest {
  const now = new Date().toISOString();
  const pipelineId = input.pipelineId ?? `pipe-${randomUUID().slice(0, 8)}`;
  return {
    pipelineId,
    entryKey: input.entryKey,
    status: input.status ?? "running",
    config: input.config,
    agents: buildAgentSlots(input.stepIds, pipelineId, input.lifecycle),
    // 已退役字段，固定写 "v1"（A3：pipeline/_archive/jrpg/README.md 第四节）。
    promptLibrary: "v1",
    complete: true,
    createdAt: now,
    updatedAt: now,
    runId: input.runId,
  };
}

/**
 * 用最新的权威步骤序对齐 manifest.agents，保留已有 lifecycle。
 * pipeline 会二次 announce（design_auto 在 D4 后追加叙事步），此时需要扩表而非重置。
 */
export function syncManifestAgents(
  manifest: RunManifest,
  stepIds: string[],
): RunManifest {
  if (stepIds.length === 0) return manifest;
  const existing = new Map(manifest.agents.map((a) => [a.agentId, a.lifecycle]));
  const lifecycle: Record<string, AgentLifecycle> = {};
  for (const [id, rec] of existing) lifecycle[id] = rec.status;
  const synced = buildAgentSlots(stepIds, manifest.pipelineId, lifecycle);
  // 保留原 lifecycle 记录的时间戳/错误信息，而非仅 status。
  for (const slot of synced) {
    const prev = existing.get(slot.agentId);
    if (prev) slot.lifecycle = prev;
  }
  // announce 未覆盖但已有跃迁的 agent 不能丢（防御性：动态裁剪过的步）。
  for (const a of manifest.agents) {
    if (!synced.some((s) => s.agentId === a.agentId) && a.lifecycle.status !== "pending") {
      synced.push({ ...a, index: synced.length });
    }
  }
  manifest.agents = synced.map((a, i) => ({ ...a, index: i }));
  manifest.updatedAt = new Date().toISOString();
  return manifest;
}

/** 单 agent lifecycle 跃迁。agent 不在表内时按当前长度追加（动态追加步）。 */
export function markAgentLifecycle(
  manifest: RunManifest,
  agentId: string,
  status: AgentLifecycle,
  patch?: { message?: string; error?: string },
): RunManifest {
  const record: AgentLifecycleRecord = {
    status,
    updatedAt: new Date().toISOString(),
    ...(patch?.message ? { message: patch.message } : {}),
    ...(patch?.error ? { error: patch.error } : {}),
  };
  const slot = manifest.agents.find((a) => a.agentId === agentId);
  if (slot) {
    slot.lifecycle = record;
  } else {
    manifest.agents.push({
      agentId,
      name: agentId,
      prototype: "atomic",
      index: manifest.agents.length,
      lifecycle: record,
      outputRef: `${manifest.pipelineId}:${agentId}`,
    });
  }
  manifest.updatedAt = record.updatedAt!;
  return manifest;
}

export function lifecycleMapOf(
  agents: readonly ManifestAgentSlot[] | readonly CheckpointAgentSlot[],
): Record<string, AgentLifecycle> {
  const out: Record<string, AgentLifecycle> = {};
  for (const a of agents) out[a.agentId] = a.lifecycle.status;
  return out;
}

/** completedSteps 兼容视图：按 manifest 顺序取 completed 的 agent id。 */
export function completedStepsFromAgents(
  agents: readonly ManifestAgentSlot[] | readonly CheckpointAgentSlot[],
): string[] {
  return [...agents]
    .sort((a, b) => a.index - b.index)
    .filter((a) => a.lifecycle.status === "completed")
    .map((a) => a.agentId);
}

export interface LegacyCheckpointShape {
  agents?: CheckpointAgentSlot[];
  pipelineOrder?: string[];
  completedSteps?: string[];
  lastCompletedStep?: string;
}

/**
 * 从 checkpoint 还原 lifecycle。
 * 新格式直接读 `agents[].lifecycle`；旧格式用 lifecycleFromCompletedSteps 桥接补齐，
 * 因此 Phase-1 落盘的 `_checkpoint.json` 仍可续跑。
 */
export function lifecycleFromCheckpoint(
  cp: LegacyCheckpointShape,
): Record<string, AgentLifecycle> {
  if (cp.agents && cp.agents.length > 0) return lifecycleMapOf(cp.agents);
  const completed = cp.completedSteps ?? [];
  const ordered =
    cp.pipelineOrder && cp.pipelineOrder.length > 0 ? cp.pipelineOrder : completed;
  return lifecycleFromCompletedSteps(ordered, completed, cp.lastCompletedStep);
}

/**
 * 由「权威步骤序 + 已完成集合」构造 checkpoint agent 切片。
 * 未完成的一律 pending —— 落盘时不预判 skipped，跳过判定留给 resume。
 */
export function checkpointAgentsFrom(
  orderedStepIds: string[],
  completedSteps: readonly string[],
  previous?: readonly CheckpointAgentSlot[],
): CheckpointAgentSlot[] {
  const done = new Set(completedSteps);
  const prevById = new Map((previous ?? []).map((a) => [a.agentId, a.lifecycle]));
  const ordered = [...orderedStepIds];
  // 步骤序缺失/不完整时（旧版 announce 未覆盖），把已完成但未列入的补到尾部。
  for (const id of completedSteps) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  const now = new Date().toISOString();
  return ordered.map((agentId, index) => {
    if (done.has(agentId)) {
      const prev = prevById.get(agentId);
      return {
        agentId,
        index,
        lifecycle:
          prev?.status === "completed" ? prev : { status: "completed", updatedAt: now },
      };
    }
    const prev = prevById.get(agentId);
    return {
      agentId,
      index,
      lifecycle: prev && prev.status !== "completed" ? prev : { status: "pending" },
    };
  });
}

/** 逐 agent 跳过判定。未登记的 agent（动态追加步）一律执行。 */
export function shouldSkipAgent(
  lifecycle: Record<string, AgentLifecycle> | undefined,
  agentId: string,
): boolean {
  const status = lifecycle?.[agentId];
  if (!status) return false;
  return shouldSkipByLifecycle(status);
}
