/**
 * runners/deterministic-runner.ts
 *
 * 纯确定性执行器：无 LLM 调用，直接运行注册的处理器函数。
 *
 * 覆盖现有确定性 step：
 *   - structure-validation（L1/L2/L3 图结构验证 + 自动修复）
 *   - video-prompt-assembly（从 storyboard 拼装视频 prompt）
 */
import type {
  AgentRunner,
  AgentRunnerCallbacks,
  StepBlueprint,
  DeterministicConfig,
} from "../types.js";
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { getProcessor } from "../processor-registry.js";

export class DeterministicRunner implements AgentRunner {
  readonly structureType = "deterministic" as const;

  async execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    _llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const config = step.agentDef.structure.config as DeterministicConfig;
    const processor = getProcessor(config.processor);

    callbacks?.onProgress?.(step.agentDef.id, "Running deterministic processor");

    await processor(ctx);

    const outputField = step.agentDef.io.outputField;
    return (ctx as Record<string, unknown>)[outputField];
  }
}
