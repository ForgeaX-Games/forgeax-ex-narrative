/**
 * blueprint/assembler.ts — Blueprint 组装器
 *
 * 在配置时（pipeline 启动前）一次性完成管线蓝图的组装：
 *   1. 确定步骤序列（复用现有 Planner 选步逻辑）
 *   2. 对每个步骤解析 AgentDef
 *   3. 加载并注入 Skill 到 system prompt
 *   4. 构建不可变 PipelineBlueprint
 *
 * 向后兼容：
 *   尚未注册 AgentDef 的步骤，从 STEP_REGISTRY 的 StepDescriptor 自动桥接。
 *   已注册 AgentDef 的步骤，优先使用 AgentDef 路径。
 */
import type {
  PipelineBlueprint,
  StepBlueprint,
  AgentDef,
  ResolvedPrompts,
} from "./types.js";
import type { ModeId, TierId, NarrativeContext } from "../../types/index.js";
import type { PipelineTemplateId } from "../routing/templates.js";
import { resolveSeatStepGroups } from "../routing/narrative-pipelines.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import { getAgentDef, hasAgentDef } from "./agent-def-registry.js";
import { PromptResolver } from "./prompt-resolver.js";
import { getStepSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import { getModeConfig } from "../routing/modes.js";
import { DEFAULT_COMPLEXITY_TIER, normalizedComplexity } from "../runtime/layer-threshold-config.js";

export interface AssemblerInput {
  genreCode: string;
  mode: ModeId;
  tier: TierId;
  /** 叙事体量档位（1-5 整数枚举，与 COMPLEXITY_NODE_BUDGET 同一口径），不是 0-1 归一值。 */
  complexity?: number;
  /** 直接提供步骤序列（跳过选步）；用于 resume/rerun */
  overrideSteps?: string[];
  /** 用于向后兼容的 ctx 快照（PromptComposer 桥接路径需要） */
  ctx?: NarrativeContext;
}

/**
 * 组装管线蓝图。
 *
 * @param input  组装所需的全部参数
 * @returns 不可变的 PipelineBlueprint
 */
export function assembleBlueprint(input: AssemblerInput): PipelineBlueprint {
  const { genreCode, mode, tier, complexity = DEFAULT_COMPLEXITY_TIER } = input;

  // ────── Step 1: 确定步骤序列 ──────

  let stepIds: string[];
  let parallelGroups: number[][] = [];
  let pipelineTemplate: PipelineTemplateId | "needs-driven" = "needs-driven";
  let plannerMeta: { selectedSteps: string[]; skippedByThreshold: string[] } | undefined;

  if (input.overrideSteps) {
    stepIds = input.overrideSteps;
  } else {
    const modeConfig = getModeConfig(mode);

    if (modeConfig && modeConfig.steps.length > 0 && !modeConfig.isDynamic) {
      stepIds = flattenStepGroups(modeConfig.steps);
      parallelGroups = extractParallelGroupIndices(modeConfig.steps);
      pipelineTemplate = modeConfig.pipeline_template ?? "needs-driven";
    } else {
      // 动态模式的步序与 run() / /plan 同源：品类 + 层级 → 四条席位管线之一。
      // blueprint 是 run() 的平行执行路径，两边各算一份步序迟早会分叉。
      const genreEntry = findGenreByCode(genreCode);
      const seat = resolveSeatStepGroups(genreCode, tier);
      const designPrefix =
        modeConfig?.isDynamic && modeConfig.steps.length > 0
          ? flattenStepGroups(modeConfig.steps)
          : [];
      stepIds = [...designPrefix, ...seat.stepGroups.filter((id) => !designPrefix.includes(id))];
      parallelGroups = [];
      pipelineTemplate = genreEntry?.pipelineTemplate ?? "needs-driven";
      plannerMeta = { selectedSteps: [...stepIds], skippedByThreshold: [] };
    }
  }

  // ────── Step 2: 为每个步骤组装 StepBlueprint ──────

  const steps: StepBlueprint[] = stepIds.map((stepId, index) => {
    return buildStepBlueprint(stepId, index, genreCode, complexity, input.ctx);
  });

  // ────── Step 3: 构建最终 Blueprint ──────

  return {
    id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    genreCode,
    mode,
    tier,
    complexity,
    pipelineTemplate,
    steps,
    parallelGroups,
    createdAt: new Date().toISOString(),
    plannerMetadata: plannerMeta,
  };
}

// ════════════════════════════════════════════════════════
// 内部辅助
// ════════════════════════════════════════════════════════

function buildStepBlueprint(
  stepId: string,
  index: number,
  genreCode: string,
  complexity: number,
  ctx?: NarrativeContext,
): StepBlueprint {
  const agentDef = resolveAgentDef(stepId);
  const skill = getStepSkill(genreCode, stepId);
  let resolvedPrompts: ResolvedPrompts;

  // 内联 PromptComposer 是生产提示词的事实源，优先于 .md 模板。
  //
  // 顺序不能反：自从席位实现按配置表批量注册 AgentDef 之后，「注册过 AgentDef」
  // 不再意味着「提示词已迁到 agent-templates/」——那批 .md 多数已归档，
  // loadTemplate 找不到文件会返回空串。先看 composer 才不会把有提示词的 step
  // 解析成空提示词。
  const stepDesc = STEP_REGISTRY.get(stepId);
  if (stepDesc?.composer && ctx) {
    resolvedPrompts = PromptResolver.resolveFromComposer(stepDesc.composer, ctx);
  } else if (hasAgentDef(stepId)) {
    resolvedPrompts = PromptResolver.resolveFromTemplate(agentDef.prompts, skill, genreCode);
  } else {
    resolvedPrompts = {
      systemPrompt: "",
      userPromptTemplate: "",
    };
  }

  const baseConfig = agentDef.structure.type === "single-turn"
    ? agentDef.structure.config
    : { temperature: 0.7, responseFormat: "json" as const, retryCount: 3, streaming: false };

  return {
    stepId,
    index,
    agentDef,
    resolvedPrompts,
    executionParams: {
      temperature: scaleTemperature(
        ("temperature" in baseConfig ? baseConfig.temperature : undefined) ?? 0.7,
        complexity,
      ),
      retryCount: ("retryCount" in baseConfig ? baseConfig.retryCount : undefined) ?? 3,
      streaming: ("streaming" in baseConfig ? baseConfig.streaming : undefined) ?? false,
      responseFormat: ("responseFormat" in baseConfig ? baseConfig.responseFormat : undefined) ?? "json",
    },
  };
}

/**
 * 从 AgentDef 注册表或 StepDescriptor 桥接获取 AgentDef。
 */
function resolveAgentDef(stepId: string): AgentDef {
  const registered = getAgentDef(stepId);
  if (registered) return registered;

  const stepDesc = STEP_REGISTRY.get(stepId);
  if (!stepDesc) {
    throw new Error(`Step '${stepId}' not found in AgentDef registry or StepDescriptor registry`);
  }

  return bridgeStepDescriptorToAgentDef(stepDesc);
}

/**
 * 桥接层：将旧 StepDescriptor 转换为 AgentDef。
 * 过渡期使用，使未迁移的 step 也能参与 Blueprint 流程。
 */
function bridgeStepDescriptorToAgentDef(
  desc: import("../core/step-registry.js").StepDescriptor,
): AgentDef {
  return {
    id: desc.id,
    name: desc.name,
    structure: {
      type: "single-turn",
      config: {
        temperature: desc.temperature ?? 0.7,
        responseFormat: desc.responseFormat ?? "json",
        retryCount: 3,
        streaming: false,
      },
    },
    prompts: {
      templateId: desc.id,
      skillSlots: desc.composer?.skillSlots ?? [],
    },
    io: {
      requiredInputs: [],
      outputField: desc.outputFields[0] ?? desc.id,
      derivedFields: desc.derivedFields,
    },
    dependencies: desc.dependsOn,
    needsThreshold: desc.needsThreshold,
    needsDesignContext: desc.needsDesignContext,
    extractOutputKey: desc.extractOutputKey,
    supportsNodeFilter: desc.supportsNodeFilter,
    supportsSubEmit: desc.supportsSubEmit,
  };
}

/**
 * 根据体量档位微调 temperature。
 * 档位高 → temperature 略低（更保守）；档位低 → 略高（更创意）。
 *
 * 入参是 1-5 档位，本函数内部换算成 0-1 才能用 —— 从前这里直接拿档位当 0-1 算，
 * 标准档（3）算出 base-0.5，实际把所有中高体量的 temperature 打到了地板。
 */
function scaleTemperature(base: number, complexity: number): number {
  const adjustment = (0.5 - normalizedComplexity(complexity)) * 0.2;
  return Math.max(0, Math.min(1.5, base + adjustment));
}

/**
 * 将 (string | string[])[] 展平为有序 string[]。
 */
function flattenStepGroups(groups: (string | string[])[]): string[] {
  const result: string[] = [];
  for (const g of groups) {
    if (Array.isArray(g)) {
      result.push(...g);
    } else {
      result.push(g);
    }
  }
  return result;
}

/**
 * 从 stepGroups 提取并行组的索引信息。
 */
function extractParallelGroupIndices(groups: (string | string[])[]): number[][] {
  const parallelGroups: number[][] = [];
  let currentIndex = 0;
  for (const g of groups) {
    if (Array.isArray(g)) {
      const indices = g.map((_, i) => currentIndex + i);
      parallelGroups.push(indices);
      currentIndex += g.length;
    } else {
      currentIndex++;
    }
  }
  return parallelGroups;
}
