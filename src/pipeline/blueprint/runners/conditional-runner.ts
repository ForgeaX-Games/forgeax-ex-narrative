/**
 * runners/conditional-runner.ts
 *
 * 条件路由执行器：根据运行时 ctx 条件选择不同的 Agent 定义执行。
 *
 * 覆盖现有自适应 step：
 *   - branch-tree: 短剧 vs 长剧（ctx.target_acts > 1）
 *   - dialogue-script: 单次 vs per-act
 *   - cinematic-storyboard: 单次 vs per-act
 */
import type {
  AgentRunner,
  AgentRunnerCallbacks,
  StepBlueprint,
  ConditionalConfig,
} from "../types.js";
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { getAgentDefOrThrow } from "../agent-def-registry.js";
import { getRunnerForStructure } from "./index.js";

export class ConditionalRunner implements AgentRunner {
  readonly structureType = "conditional" as const;

  async execute(
    step: StepBlueprint,
    ctx: NarrativeContext,
    llm: LLMClient,
    callbacks?: AgentRunnerCallbacks,
  ): Promise<unknown> {
    const config = step.agentDef.structure.config as ConditionalConfig;
    const conditionMet = evaluateCondition(config.condition, ctx);

    const targetDefId = conditionMet ? config.ifTrue : config.ifFalse;
    const targetDef = getAgentDefOrThrow(targetDefId);
    const runner = getRunnerForStructure(targetDef.structure.type);

    const delegateStep: StepBlueprint = {
      ...step,
      agentDef: targetDef,
    };

    return runner.execute(delegateStep, ctx, llm, callbacks);
  }
}

function evaluateCondition(condition: string, ctx: NarrativeContext): boolean {
  try {
    const parts = condition.split(/\s*(>|<|>=|<=|===|!==|==|!=)\s*/);
    if (parts.length === 3) {
      const [left, op, right] = parts;
      const leftVal = resolveValue(left.trim(), ctx);
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
    const val = resolveValue(condition, ctx);
    return !!val;
  } catch {
    return true;
  }
}

function resolveValue(path: string, ctx: NarrativeContext): unknown {
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
