/**
 * index.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/planner/index.ts`：统一管线规划引擎 `planPipeline()`，替代 9 个
 * 分散的 buildXxxAutoSteps 函数，用统一的 needs 矩阵和 pipelineTemplate 预置
 * 方案驱动步骤选择（决策架构：pipelineTemplate 预置优先 → needs 通用规则兜底）。
 *
 * D1（2026-08）已确认孤儿：全仓零生产调用点。`pipeline.ts` 与 `api/server.ts`
 * 曾各留一条 `import { planPipeline } from "./planner/index.js"`，但函数体从未
 * 被调用——四条席位管线（`resolveSeatStepGroups` / `resolveModeStepGroups`）早已
 * 接管路由（见 `mode-routing.ts`），`planPipeline` 是四期换架构前"按品类家族现算
 * 步序"的实现，被取代后只是没人摘掉这条 import。两处 dead import 已随本次封存
 * 一并删除。`design-steps/auto-narrative-builder.ts` 里"@deprecated 使用
 * planPipeline() 替代"与"生产路径全部走 planPipeline()"的注释同属过时表述，
 * 已订正为指向实际生效的四条席位管线。
 *
 * 本文件不再被任何活跃代码 import。
 */
import type { PlannerInput, PlannerOutput } from "./types.js";
import { getPreset } from "./presets.js";
import { selectStepsByNeeds } from "./needs-rules.js";
import { topologicalSort } from "./dependency-graph.js";
import type { NeedsKey, NeedsScore } from "../universal-agent/types.js";
import { GENRE_TAXONOMY } from "../../../knowledge/genre-taxonomy.js";
import type { PipelineTemplateId } from "../../routing/templates.js";
import { loadSkill } from "../../../knowledge/game-narrative/skill-loader.js";

export type { PlannerInput, PlannerOutput } from "./types.js";

/** 通用叙事前驱（所有叙事单品共享，design_* 模式额外在最前拼接 D0-D4） */
const PREFERENCE_TRIO = ["preference_summary", "preference_analysis", "initial_plan"];

/**
 * 去重保序地展平 narrativeSteps，保留并行组结构。
 * 已出现在前驱中的步骤会被剔除（避免重复）。
 */
function mergePreludeAndNarrative(
  prelude: string[],
  narrativeSteps: Array<string | string[]>,
): (string | string[])[] {
  const seen = new Set<string>(prelude);
  const out: (string | string[])[] = [...prelude];
  for (const entry of narrativeSteps) {
    if (Array.isArray(entry)) {
      const group = entry.filter((id) => !seen.has(id));
      for (const id of group) seen.add(id);
      if (group.length === 1) out.push(group[0]);
      else if (group.length > 1) out.push(group);
    } else if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out;
}

function resolvePipelineTemplate(genreCode: string): PipelineTemplateId | undefined {
  const entry = GENRE_TAXONOMY.find((g) => g.code === genreCode);
  return entry?.pipelineTemplate;
}

function meetsThreshold(
  needs: Partial<Record<NeedsKey, NeedsScore>>,
  threshold: Partial<Record<NeedsKey, number>>,
): boolean {
  for (const [key, minScore] of Object.entries(threshold)) {
    if ((needs[key as NeedsKey] ?? 0) < minScore) return false;
  }
  return true;
}

/**
 * 管线规划主入口。
 *
 * @param input — 品类信息 + needs 矩阵
 * @returns 有序步骤序列（含并行组标记）+ 决策日志
 */
export function planPipeline(input: PlannerInput): PlannerOutput {
  const { genre_code, needs } = input;
  const template = input.pipelineTemplate ?? resolvePipelineTemplate(genre_code);

  let selectedSteps: string[];
  let resolvedTemplate: PipelineTemplateId | "needs-driven" = "needs-driven";
  const skippedByThreshold: string[] = [];

  // Step 0（最高优先级）：品类 skill 声明了专属叙事段 narrativeSteps。
  // 完整管线 = 通用前驱(PREFERENCE_TRIO) + skill.narrativeSteps（去重保序，保留并行组）。
  // narrativeSteps 是作者精心排序的链，直接返回，不经 topologicalSort 重排。
  const skill = loadSkill(genre_code);
  if (skill?.narrativeSteps && skill.narrativeSteps.length > 0) {
    const stepGroups = mergePreludeAndNarrative([...PREFERENCE_TRIO], skill.narrativeSteps);
    const flatSteps = stepGroups.flatMap((g) => (Array.isArray(g) ? g : [g]));
    return {
      stepGroups,
      metadata: {
        resolvedTemplate: template ?? "needs-driven",
        selectedSteps: flatSteps,
        parallelGroups: extractParallelGroups(stepGroups),
        skippedByThreshold: [],
      },
    };
  }

  // Step 1: 预置方案检查
  if (template) {
    const preset = getPreset(template);
    if (preset) {
      resolvedTemplate = template;

      if (preset.fixedSteps) {
        selectedSteps = [...preset.fixedSteps];
        // fixedSteps 是精心排序的串行链，直接作为 stepGroups 原样返回，
        // 不经 topologicalSort（否则会因 dependsOn 不完整而错误并行化）。
        return {
          stepGroups: [...selectedSteps],
          metadata: {
            resolvedTemplate,
            selectedSteps,
            parallelGroups: [],
            skippedByThreshold: [],
          },
        };
      }

      // 非固定方案：偏好三件套 + 基线 + 可选
      const steps: string[] = [];
      if (!preset.skipPreference) {
        steps.push(...PREFERENCE_TRIO);
      }

      if (preset.baseSteps) {
        steps.push(...preset.baseSteps);
      }

      // Step 3: 预置方案内的 needs 微调（带?标记的步骤）
      if (preset.optional) {
        for (const [stepId, threshold] of Object.entries(preset.optional)) {
          if (meetsThreshold(needs, threshold)) {
            if (!steps.includes(stepId)) {
              steps.push(stepId);
            }
          } else {
            skippedByThreshold.push(stepId);
          }
        }
      }

      selectedSteps = steps;
    } else {
      // 有 template 但无预置方案 → 走 Step 2
      selectedSteps = [...PREFERENCE_TRIO, ...selectStepsByNeeds(needs)];
    }
  } else {
    // Step 2: needs 通用规则（无模板的品类）
    selectedSteps = [...PREFERENCE_TRIO, ...selectStepsByNeeds(needs)];
  }

  const stepGroups = topologicalSort(selectedSteps);

  return {
    stepGroups,
    metadata: {
      resolvedTemplate,
      selectedSteps,
      parallelGroups: extractParallelGroups(stepGroups),
      skippedByThreshold,
    },
  };
}

function toStepGroups(steps: string[]): (string | string[])[] {
  return topologicalSort(steps);
}

function extractParallelGroups(stepGroups: (string | string[])[]): string[][] {
  return stepGroups.filter((g): g is string[] => Array.isArray(g));
}
