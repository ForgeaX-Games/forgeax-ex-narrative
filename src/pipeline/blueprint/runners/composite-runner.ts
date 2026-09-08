/**
 * composite-runner.ts — nested 子 DAG 执行器（Phase-1 M1）
 *
 * 专家 = 工程师组合：按 children + edges 拓扑排序执行；
 * parallelGroups 内 Promise.allSettled 并发。
 */
import type {
  AgentRunner,
  AgentRunnerCallbacks,
  StepBlueprint,
  CompositeConfig,
  AgentDef,
} from "../types.js";
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { planExecutionWaves } from "./composite-plan.js";

export { planExecutionWaves } from "./composite-plan.js";

export class CompositeRunner implements AgentRunner {
  readonly structureType = "composite" as const;

  async execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const config = step.agentDef.structure.config as CompositeConfig;
    const waves = planExecutionWaves(config);
    // Lazy import breaks cycle: runners/index.ts registers CompositeRunner at load time.
    const { executeAgent } = await import("../../core/agent-exec.js");

    const results: Array<{ agentId: string; output: unknown }> = [];
    let index = 0;

    for (const wave of waves) {
      const startIndex = index;
      index += wave.length;
      const settled = await Promise.allSettled(
        wave.map((id, i) =>
          this.runChild(executeAgent, id, startIndex + i, step, ctx, llm, callbacks),
        ),
      );
      for (let i = 0; i < wave.length; i++) {
        const r = settled[i]!;
        if (r.status === "rejected") {
          throw r.reason instanceof Error
            ? r.reason
            : new Error(String(r.reason));
        }
        results.push({ agentId: wave[i]!, output: r.value });
      }
    }

    return results;
  }

  /**
   * 执行单个子 agent。走 agent-exec 的合流路径，因此既支持已注册 AgentDef 的
   * 子 agent，也支持只有 StepDescriptor 的 legacy 子步（tpl-jrpg 的全部子步）。
   */
  private async runChild(
    executeAgent: typeof import("../../core/agent-exec.js").executeAgent,
    agentId: string,
    index: number,
    parent: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks: AgentRunnerCallbacks | undefined,
  ): Promise<unknown> {
    if (agentId === parent.agentDef.id) {
      throw new Error(`Composite agent '${agentId}' cannot nest itself`);
    }
    callbacks?.onProgress?.(agentId, `running nested agent ${agentId}`);
    const outcome = await executeAgent(agentId, ctx, llm, {
      index,
      callbacks,
      // 子步不继承父 composite 的提示词：legacy 子步自带 PromptComposer，
      // 有 AgentDef 的子步由其 Runner 自行解析。
      ancestors: [...(parent.nestAncestors ?? []), parent.agentDef.id],
    });
    return outcome.output;
  }
}

/** 注册用：从子 agent 列表构造最小 composite AgentDef。 */
export function makeCompositeAgentDef(
  id: string,
  name: string,
  config: CompositeConfig,
  extras: Partial<Omit<AgentDef, "id" | "name" | "structure" | "prototype">> = {},
): AgentDef {
  return {
    id,
    name,
    prototype: "nested",
    structure: { type: "composite", config },
    prompts: extras.prompts ?? { templateId: id, skillSlots: [] },
    io: extras.io ?? {
      requiredInputs: [],
      outputField: id,
    },
    dependencies: extras.dependencies ?? [],
    useNewRunner: extras.useNewRunner ?? true,
    validators: extras.validators,
    normalizer: extras.normalizer,
    extractOutputKey: extras.extractOutputKey,
    supportsNodeFilter: extras.supportsNodeFilter,
    supportsSubEmit: extras.supportsSubEmit,
    needsThreshold: extras.needsThreshold,
    needsDesignContext: extras.needsDesignContext,
  };
}
