/**
 * runners/wave-runner.ts
 *
 * 波次执行器：拓扑分层 + 层内并行 + 层间滑动窗口摘要 + 单元级约束重试。
 *
 * 与 ChunkedRunner 的关键差别：ChunkedConfig 只能表达"怎么切 + 并发多少"，
 * 片与片之间互不相干；本执行器额外处理两件事——
 *   1. 层间数据流：后继单元的 user 段要看到前驱**实际生成内容**的摘要，
 *      而不只是静态的上游结构数据；
 *   2. 片内重试：单元输出未通过约束校验时，把问题清单拼回 user 段重新生成，
 *      重试耗尽仍不过则接受当前结果（约束是质量门，不是硬阻断）。
 *
 * 覆盖目标（框架层实现方案 M4）：plot_generation、script_generation ——
 * 两者都是"逐节点填充 + 拓扑分层 + 片间滑动窗口摘要 + 三重约束逐片重试"。
 *
 * 复用与新增：merger/chunkSink/validator/normalizer 与 ChunkedRunner 共用同一套
 * 注册表（形状一致：`{chunkId, output}`）；分层器/摘要器/约束校验器是本执行器
 * 独有的三个处理器（见 processor-registry.ts）。
 */
import type {
  AgentRunner,
  AgentRunnerCallbacks,
  StepBlueprint,
  WaveConfig,
  WaveChunkMeta,
} from "../types.js";
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { PromptResolver } from "../prompt-resolver.js";
import {
  getMerger,
  getValidator,
  getNormalizer,
  getChunkSink,
  getWaveLayerer,
  getWaveSummarizer,
  getWaveConstraintCheck,
  hasValidator,
  hasNormalizer,
  hasMerger,
  hasChunkSink,
  hasWaveLayerer,
  hasWaveSummarizer,
  hasWaveConstraintCheck,
} from "../processor-registry.js";

const DEFAULT_MAX_CONSTRAINT_RETRIES = 2;

export class WaveRunner implements AgentRunner {
  readonly structureType = "wave" as const;

  async execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const { resolvedPrompts, executionParams, agentDef } = step;
    const config = agentDef.structure.config as WaveConfig;

    const layererName = `${agentDef.id}_wave_layerer`;
    const mergerName = `${agentDef.id}_merger`;

    if (!hasWaveLayerer(layererName) || !hasMerger(mergerName)) {
      throw new Error(
        `WaveRunner requires registered layerer '${layererName}' and merger '${mergerName}' for step '${agentDef.id}'`,
      );
    }

    const layerer = getWaveLayerer(layererName);
    const merger = getMerger(mergerName);

    const summarizerName = `${agentDef.id}_wave_summarizer`;
    const summarizer = hasWaveSummarizer(summarizerName) ? getWaveSummarizer(summarizerName) : undefined;

    const constraintName = `${agentDef.id}_wave_constraint_check`;
    const constraintCheck = hasWaveConstraintCheck(constraintName)
      ? getWaveConstraintCheck(constraintName)
      : undefined;

    // 逐单元落地钩子是可选的：与 ChunkedRunner 同一把注册表（同为"每完成一个
    // 节点就写文件/记进度"的需求）。
    const sinkName = `${agentDef.id}_chunk_done`;
    const sink = hasChunkSink(sinkName) ? getChunkSink(sinkName) : undefined;

    const layers = layerer(ctx);
    const total = layers.reduce((n, layer) => n + layer.length, 0);

    const validatorFns = (agentDef.validators ?? [])
      .filter((name) => hasValidator(name))
      .map((name) => getValidator(name));

    const parseResult = validatorFns.length > 0
      ? (raw: string) => {
          for (const v of validatorFns) v(raw, ctx);
        }
      : undefined;

    const systemPrompt = PromptResolver.systemFor(resolvedPrompts, ctx, step.stepId);

    const llmConfig = config.llm ?? {
      temperature: executionParams.temperature,
      responseFormat: executionParams.responseFormat,
    };

    const maxRetries = config.maxConstraintRetries ?? DEFAULT_MAX_CONSTRAINT_RETRIES;

    const summaryMap = new Map<string, string>();
    let done = 0;

    const processUnit = async (unit: {
      unitId: string;
      data: Record<string, unknown>;
      prevIds: string[];
    }): Promise<{ chunkId: string; output: unknown }> => {
      callbacks?.onSubEmit?.(unit.unitId, done, total);

      const slidingSummary = unit.prevIds
        .map((id) => summaryMap.get(id))
        .filter((s): s is string => !!s)
        .join("\n---\n") || undefined;

      let constraintFeedback: string | undefined;
      let output: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const wave: WaveChunkMeta = { slidingSummary, constraintFeedback };
        const chunkCtx = { ...ctx, _chunk: { ...unit.data, _wave: wave } } as NarrativeContext;
        // 按本单元的 ctx 重新装配：user 段铺的是这一节点的材料 + 前驱摘要 + 修正反馈。
        const userPrompt = PromptResolver.userFor(resolvedPrompts, chunkCtx);

        const raw = await llm.callWithRetry(
          systemPrompt,
          userPrompt,
          {
            temperature: llmConfig.temperature,
            responseFormat: llmConfig.responseFormat,
          },
          parseResult,
          callbacks?.onStream,
        );

        output = llmConfig.responseFormat === "json" ? extractJSON(raw) : raw.trim();

        if (!constraintCheck) break;

        const issues = constraintCheck(output, ctx, unit);
        if (issues.length === 0) break;

        if (attempt < maxRetries) {
          constraintFeedback = issues.map((msg, i) => `${i + 1}. ${msg}`).join("\n");
        }
        // 重试耗尽：接受当前输出并继续——约束是质量门，不是硬阻断（legacy 同语义）。
      }

      // 先落地再报完成：报完成之后才写文件的话，中途取消会留下"显示已完成、
      // 磁盘上没东西"的节点。
      sink?.({ chunkId: unit.unitId, output }, ctx);
      done += 1;
      callbacks?.onSubEmit?.(unit.unitId, done, total);

      if (summarizer) summaryMap.set(unit.unitId, summarizer(output));

      return { chunkId: unit.unitId, output };
    };

    const results: Array<{ chunkId: string; output: unknown }> = [];

    for (const layer of layers) {
      if (config.concurrency === "serial") {
        for (const unit of layer) {
          results.push(await processUnit(unit));
        }
        continue;
      }

      const maxConcurrency = typeof config.concurrency === "number" ? config.concurrency : layer.length;
      for (let i = 0; i < layer.length; i += maxConcurrency) {
        const batch = layer.slice(i, i + maxConcurrency);
        const batchResults = await Promise.all(batch.map((unit) => processUnit(unit)));
        results.push(...batchResults);
      }
    }

    let merged = merger(results, ctx);

    if (agentDef.normalizer && hasNormalizer(agentDef.normalizer)) {
      merged = await getNormalizer(agentDef.normalizer)(merged, ctx);
    }

    return merged;
  }
}
