/**
 * universal-agent/types.ts  (B-M2)
 * ─────────────────────────────────────────────────────────────────
 * "通用三件套" agent 框架的类型定义。
 *
 * 三件套：
 *   1. Plan    — 根据 needs 矩阵 + skill 决定本次跑哪些子能力
 *   2. Execute — 按计划逐个调用 capability，每个 capability 可独立 LLM 调用
 *   3. Eval    — 评估输出质量，决定是否重试/降级
 *
 * 接入路径：
 *   M2 提供骨架 + 评估器；M3-M5 将 7 个 stub 步骤迁移到这套接口。
 *   策划侧 (D0-D4) 不接入，保持现有 step 形态（D13-C 决定）。
 */

import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import type { StepSkillBlock } from "../../../knowledge/game-narrative/skill-types.js";

// needs 词表没跟着这套框架退役（品类表 / 步骤注册表 / agent 契约都还在读），
// 已拆去 core/needs.ts；这里只转出去，保持本文件封存前的导出面不变。
export type { NeedsKey, NeedsScore, NeedsMatrix } from "../../core/needs.js";
import type { NeedsKey, NeedsScore, NeedsMatrix } from "../../core/needs.js";

/**
 * 单个子能力（capability）的执行环境。
 * 由 runner 按 capability.id 注入。
 */
export interface CapabilityContext {
  /** ctx.demand_analysis.narrative_needs 的 9 维分数（缺省按 0 处理） */
  needs: Readonly<NeedsMatrix>;
  /** 当前品类 code（来自 ctx.tier_detection.genre_code，可能为空） */
  genreCode: string | null;
  /** 当前 step 的 skill block（ts skill ⊕ md fallback，已合并） */
  skill: StepSkillBlock | null;
  /** 当前 capability 的 id，便于内部日志/分支 */
  capabilityId: string;
}

/**
 * 子能力执行函数。
 * 失败可抛异常；返回值由 spec.aggregate 聚合。
 */
export type CapabilityExecutor = (
  ctx: NarrativeContext,
  llm: LLMClient,
  cap: CapabilityContext,
) => Promise<unknown>;

/**
 * 单个子能力定义。
 *
 * 启用条件（合取）：
 *   needsKeys 中任一维度的当前值 >= minNeed
 *   （minNeed 默认为 1；若 needsKeys 为空，则永远启用）
 */
export interface Capability {
  /** 该 capability 的稳定 ID（agent 内唯一） */
  id: string;
  /** 一句话描述（日志/调试用） */
  description: string;
  /**
   * 该能力依赖的 needs 维度。
   * 任一维度 >= minNeed 才启用；空数组表示无条件启用（"基础动作"）。
   */
  needsKeys: NeedsKey[];
  /** 启用阈值，默认 1（即 needs >= 1）。某些"重型"capability 可设为 2 或 3。 */
  minNeed?: NeedsScore;
  /** 执行函数 */
  execute: CapabilityExecutor;
}

/**
 * Capability 执行结果。
 */
export interface CapabilityResult {
  capabilityId: string;
  output: unknown;
  /** 执行耗时（毫秒），用于性能监控 */
  durationMs: number;
}

/**
 * 评估器规约。
 *
 * 简易版（M2）：
 *   - 调用一次 LLM，返回 score (0-1) 和 reasoning
 *   - score < minScore 时触发 retry（最多 maxRetries 次）
 *   - 接入 narrative-USC/skills/lab_prompts/evaluator_skill.md 作为 system prompt
 */
export interface EvaluatorSpec {
  /** 评估器系统提示（默认接 evaluator_skill.md） */
  systemPrompt?: string;
  /** 通过分数阈值，默认 0.6 */
  minScore?: number;
  /** 最大重试次数，默认 1（即 ≤2 次执行） */
  maxRetries?: number;
  /** 关闭评估（仅用于性能测试），默认 false */
  disabled?: boolean;
}

/**
 * 评估器输出。
 */
export interface EvaluatorVerdict {
  score: number;
  passed: boolean;
  reasoning: string;
  /** 评估失败时给 Executor 的修正建议（用于 retry 提示词） */
  improvementHint?: string;
}

/**
 * Universal Agent 规约。
 *
 * @typeParam TOutput  最终写入 ctx 的输出类型
 */
export interface UniversalAgentSpec<TOutput = unknown> {
  /** 对应的 step ID（用于 progress 上报、skill 查找） */
  stepId: string;
  /** Agent 名称（日志） */
  name: string;
  /** 写入 ctx 的字段名 */
  outputField: string;
  /** 子能力列表（顺序即默认执行顺序） */
  capabilities: Capability[];
  /**
   * 把所有 capability 的输出聚合为最终结果。
   * 当某个 capability 被 plan 阶段裁掉时，results 中不会出现该项。
   */
  aggregate: (
    results: CapabilityResult[],
    ctx: NarrativeContext,
  ) => TOutput;
  /** 评估器配置；不提供则跳过评估 */
  evaluator?: EvaluatorSpec;
  /**
   * 当所有 capability 都被 plan 裁掉时的占位输出。
   * 例：needs.S=0 的纯节奏游戏跑 narrative agent 时返回 minimal stub。
   */
  emptyFallback?: () => TOutput;
}

/**
 * Plan 阶段产物：被启用的 capability 清单 + 决策原因。
 * 暴露出来便于测试 / debug 输出。
 */
export interface AgentPlan {
  enabled: Capability[];
  skipped: Array<{ capability: Capability; reason: string }>;
  needs: Readonly<NeedsMatrix>;
  genreCode: string | null;
}
