/**
 * runners/sequence-runner.ts
 *
 * 多阶段执行器：按顺序执行多个 stage（LLM 阶段或确定性处理阶段）。
 *
 * 覆盖现有多阶段 step：
 *   - story-framework: plan → repair → fill
 *   - outline-batch: plan → skeleton → batch-fill → gap
 *   - detailed-outline-batch: 同上模式
 *
 * 每个 stage 可以是：
 *   - LLM 调用（有自己的模板 ID）
 *   - 确定性处理器（注册在 PROCESSOR_REGISTRY）
 *   - 条件执行（condition 表达式为 true 才执行）
 */
import type {
  AgentRunner,
  AgentRunnerCallbacks,
  StepBlueprint,
  SequenceConfig,
  SequenceStage,
} from "../types.js";
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { PromptResolver } from "../prompt-resolver.js";
import { composeSystemPrompt, composeUserPrompt } from "../../runtime/prompt-composer.js";
import { getStageComposer, hasStageComposer } from "../stage-composer-registry.js";
import {
  getProcessor,
  hasProcessor,
  getValidator,
  hasValidator,
  getNormalizer,
  hasNormalizer,
} from "../processor-registry.js";

export class SequenceRunner implements AgentRunner {
  readonly structureType = "sequence" as const;

  async execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const { agentDef } = step;
    const config = agentDef.structure.config as SequenceConfig;

    let lastLlmOutput: unknown = undefined;

    for (let i = 0; i < config.stages.length; i++) {
      const stage = config.stages[i];

      if (stage.condition && !evaluateCondition(stage.condition, ctx)) {
        continue;
      }

      callbacks?.onProgress?.(agentDef.id, `Stage ${i + 1}/${config.stages.length}`);

      if (stage.type === "deterministic") {
        if (!stage.processor || !hasProcessor(stage.processor)) {
          throw new Error(
            `SequenceRunner: processor '${stage.processor}' not registered for step '${agentDef.id}' stage ${i}`,
          );
        }
        await getProcessor(stage.processor)(ctx);
      } else {
        lastLlmOutput = await this.executeLlmStage(
          stage,
          step,
          ctx,
          llm,
          callbacks,
        );
        if (stage.outputKey) {
          (ctx as Record<string, unknown>)[stage.outputKey] = lastLlmOutput;
        }
      }
    }

    if (agentDef.normalizer && hasNormalizer(agentDef.normalizer)) {
      return await getNormalizer(agentDef.normalizer)(lastLlmOutput, ctx);
    }

    return lastLlmOutput;
  }

  private async executeLlmStage(
    stage: SequenceStage,
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const { resolvedPrompts, executionParams } = step;

    let systemPrompt: string;
    let userPromptTemplate: string;
    // composer 终稿装配完成，不需要 PromptResolver 二次渲染 {{ctx.*}}；
    // 只有 templateId 那条路径产出的才是待渲染模板。
    let userIsFinal = false;

    if (stage.composerId && hasStageComposer(stage.composerId)) {
      const composer = getStageComposer(stage.composerId);
      systemPrompt = composeSystemPrompt(composer, ctx);
      userPromptTemplate = composeUserPrompt(composer, ctx);
      userIsFinal = true;
    } else if (stage.templateId) {
      const stagePrompts = PromptResolver.resolveFromTemplate(
        { templateId: stage.templateId, skillSlots: step.agentDef.prompts.skillSlots },
        null,
      );
      systemPrompt = PromptResolver.renderSystemPrompt(stagePrompts.systemPrompt, ctx, step.stepId);
      userPromptTemplate = stagePrompts.userPromptTemplate;
    } else {
      systemPrompt = PromptResolver.systemFor(resolvedPrompts, ctx, step.stepId);
      userPromptTemplate = resolvedPrompts.userPromptTemplate;
      userIsFinal = Boolean(resolvedPrompts.final);
    }

    const userPrompt = userIsFinal
      ? userPromptTemplate
      : PromptResolver.renderUserPrompt(userPromptTemplate, ctx);

    const llmConfig = stage.llm ?? {
      temperature: executionParams.temperature,
      responseFormat: executionParams.responseFormat,
    };

    const onChunk = (executionParams.streaming && callbacks?.onStream)
      ? callbacks.onStream
      : undefined;

    const validate = (stage.validator && hasValidator(stage.validator))
      ? (raw: string): void => getValidator(stage.validator!)(raw, ctx)
      : undefined;

    const raw = await llm.callWithRetry(
      systemPrompt,
      userPrompt,
      {
        temperature: llmConfig.temperature,
        responseFormat: llmConfig.responseFormat,
      },
      validate,
      onChunk,
    );

    if (llmConfig.responseFormat === "json") {
      return extractJSON(raw);
    }
    return raw.trim();
  }
}

function evaluateCondition(condition: string, ctx: NarrativeContext): boolean {
  try {
    const parts = condition.split(/\s*(>|<|>=|<=|===|!==|==|!=)\s*/);
    if (parts.length === 3) {
      const [left, op, right] = parts;
      const leftVal = resolveCtxValue(left.trim(), ctx);
      const rightVal = parseValue(right.trim());
      switch (op) {
        case ">": return Number(leftVal) > Number(rightVal);
        case "<": return Number(leftVal) < Number(rightVal);
        case ">=": return Number(leftVal) >= Number(rightVal);
        case "<=": return Number(leftVal) <= Number(rightVal);
        case "===":
        case "==": return leftVal === rightVal;
        case "!==":
        case "!=": return leftVal !== rightVal;
      }
    }
    const val = resolveCtxValue(condition, ctx);
    return !!val;
  } catch {
    return true;
  }
}

function resolveCtxValue(path: string, ctx: NarrativeContext): unknown {
  if (!path.startsWith("ctx.")) return path;
  const parts = path.slice(4).split(".");
  let current: unknown = ctx;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null" || val === "undefined") return undefined;
  const num = Number(val);
  if (!isNaN(num)) return num;
  return val.replace(/^["']|["']$/g, "");
}
