/**
 * runners/chunked-runner.ts
 *
 * 分块执行器：将输入数据拆分为多个 chunk，对每个 chunk 执行 SingleTurn，
 * 合并所有 chunk 的输出为最终结果。
 *
 * 覆盖现有分块 step：
 *   - by-act: vn-branched-beats（按幕串行）
 *   - by-scene: vn-screenplay、vn-storyboard（按场串行）
 *   - by-parent: outline-batch fill phase
 *   - by-batch: quest-generation (每批 6 个)
 *   - topological-wave: plot-generation、script-generation（拓扑分层并行）
 *
 * 分块策略和合并策略通过 processor-registry 中注册的函数实现。
 */
import type {
  AgentRunner,
  AgentRunnerCallbacks,
  StepBlueprint,
  ChunkedConfig,
} from "../types.js";
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { PromptResolver } from "../prompt-resolver.js";
import {
  getSplitter,
  getMerger,
  getValidator,
  getNormalizer,
  getChunkSink,
  hasValidator,
  hasNormalizer,
  hasSplitter,
  hasMerger,
  hasChunkSink,
} from "../processor-registry.js";

export class ChunkedRunner implements AgentRunner {
  readonly structureType = "chunked" as const;

  async execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const { resolvedPrompts, executionParams, agentDef } = step;
    const config = agentDef.structure.config as ChunkedConfig;

    const splitterName = `${agentDef.id}_splitter`;
    const mergerName = `${agentDef.id}_merger`;

    if (!hasSplitter(splitterName) || !hasMerger(mergerName)) {
      throw new Error(
        `ChunkedRunner requires registered splitter '${splitterName}' and merger '${mergerName}' for step '${agentDef.id}'`,
      );
    }

    const splitter = getSplitter(splitterName);
    const merger = getMerger(mergerName);
    // 逐 chunk 落地钩子是可选的：只有需要"每个节点一完成就写文件/记进度"的 step 才登记。
    const sinkName = `${agentDef.id}_chunk_done`;
    const sink = hasChunkSink(sinkName) ? getChunkSink(sinkName) : undefined;

    const chunks = splitter(ctx);
    const total = chunks.length;

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

    const processChunk = async (
      chunk: { chunkId: string; data: Record<string, unknown> },
      idx: number,
    ): Promise<{ chunkId: string; output: unknown }> => {
      callbacks?.onSubEmit?.(chunk.chunkId, idx, total);

      const chunkCtx = { ...ctx, _chunk: chunk.data } as NarrativeContext;
      // 按本片的 ctx 重新装配：user 段铺的是这一片的材料。
      const userPrompt = PromptResolver.userFor(resolvedPrompts, chunkCtx);

      const onChunk = callbacks?.onStream;

      const raw = await llm.callWithRetry(
        systemPrompt,
        userPrompt,
        {
          temperature: llmConfig.temperature,
          responseFormat: llmConfig.responseFormat,
        },
        parseResult,
        onChunk,
      );

      let output: unknown;
      if (llmConfig.responseFormat === "json") {
        output = extractJSON(raw);
      } else {
        output = raw.trim();
      }

      // 先落地再报完成：报完成之后才写文件的话，中途取消会留下"显示已完成、
      // 磁盘上没东西"的节点。
      sink?.({ chunkId: chunk.chunkId, output }, ctx);
      callbacks?.onSubEmit?.(chunk.chunkId, idx + 1, total);
      return { chunkId: chunk.chunkId, output };
    };

    const results: Array<{ chunkId: string; output: unknown }> = [];

    if (config.concurrency === "serial") {
      for (let i = 0; i < chunks.length; i++) {
        results.push(await processChunk(chunks[i], i));
      }
    } else {
      const maxConcurrency = typeof config.concurrency === "number" ? config.concurrency : 6;
      for (let i = 0; i < chunks.length; i += maxConcurrency) {
        const batch = chunks.slice(i, i + maxConcurrency);
        const batchResults = await Promise.all(
          batch.map((chunk, batchIdx) => processChunk(chunk, i + batchIdx)),
        );
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
