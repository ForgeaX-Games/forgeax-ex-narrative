/**
 * runners/single-turn-runner.ts
 *
 * 最基础的 Agent 执行器：一次 LLM 调用 + 可选验证/重试 + 可选归一化。
 *
 * 覆盖现有 18 个单次调用 step（worldview、character-enrichment、vn-logline 等）
 * 以及流式单次调用 step（preference-summary、initial-story-outline）。
 *
 * 执行流程：
 *   1. 渲染 user prompt（填充 {{ctx.*}} 占位符）
 *   2. 渲染 system prompt（填充 {{ctx.*}}，如有）
 *   3. 调用 LLM（callWithRetry / callStreamFull）
 *   4. 执行 validators（抛错触发 LLM 自动重试）
 *   5. 解析 JSON（如果 responseFormat=json）
 *   6. 执行 normalizer（如有）
 *   7. 返回结果
 */
import type {
  AgentRunner,
  AgentRunnerCallbacks,
  StepBlueprint,
  SingleTurnConfig,
} from "../types.js";
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { PromptResolver } from "../prompt-resolver.js";
import {
  getValidator,
  getNormalizer,
  hasValidator,
  hasNormalizer,
  getPreflight,
  hasPreflight,
} from "../processor-registry.js";

export class SingleTurnRunner implements AgentRunner {
  readonly structureType = "single-turn" as const;

  async execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const { resolvedPrompts, executionParams, agentDef } = step;

    const structureConfig = agentDef.structure.type === "single-turn"
      ? (agentDef.structure.config as SingleTurnConfig)
      : undefined;
    if (structureConfig?.preflight && hasPreflight(structureConfig.preflight)) {
      const pre = await getPreflight(structureConfig.preflight)(ctx, llm);
      if (pre?.skip) return pre.result;
    }

    const systemPrompt = PromptResolver.systemFor(resolvedPrompts, ctx, step.stepId);
    const userPrompt = resolvedPrompts.final
      ? resolvedPrompts.userPromptTemplate
      : PromptResolver.renderUserPrompt(resolvedPrompts.userPromptTemplate, ctx);

    const validatorFns = (agentDef.validators ?? [])
      .filter((name) => hasValidator(name))
      .map((name) => getValidator(name));

    const parseResult = validatorFns.length > 0
      ? (raw: string) => {
          for (const v of validatorFns) v(raw, ctx);
        }
      : undefined;

    const onChunk = (executionParams.streaming && callbacks?.onStream)
      ? callbacks.onStream
      : undefined;

    const raw = await llm.callWithRetry(
      systemPrompt,
      userPrompt,
      {
        temperature: executionParams.temperature,
        responseFormat: executionParams.responseFormat,
      },
      parseResult,
      onChunk,
    );

    let result: unknown;
    if (executionParams.responseFormat === "json") {
      result = extractJSON(raw);
    } else {
      result = raw.trim();
    }

    if (agentDef.normalizer && hasNormalizer(agentDef.normalizer)) {
      result = await getNormalizer(agentDef.normalizer)(result, ctx);
    }

    return result;
  }
}
