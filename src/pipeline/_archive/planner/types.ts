/**
 * types.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/planner/types.ts`。随 `planner/` 整体搬入，理由见 `./README.md`：
 * `planPipeline()` 全仓零生产调用点，四条席位管线（`resolveSeatStepGroups` /
 * `resolveModeStepGroups`）早已接管路由，`planPipeline` 是四期换架构前的
 * 按品类家族现算步序的实现，被取代后从未被摘掉引用。
 *
 * 本文件不再被任何活跃代码 import。
 */
import type { TierId } from "../../../types/index.js";
import type { NeedsKey, NeedsScore } from "../universal-agent/types.js";
import type { PipelineTemplateId } from "../../routing/templates.js";
import type { NarrativeType } from "../../../knowledge/genre-narrative-type.js";

export interface PlannerInput {
  genre_code: string;
  tier: TierId;
  needs: Partial<Record<NeedsKey, NeedsScore>>;
  narrative_type: NarrativeType;
  pipelineTemplate?: PipelineTemplateId;
}

export interface PlannerOutput {
  /** 有序步骤序列，string[] 表示并行组 */
  stepGroups: (string | string[])[];
  /** Planner 决策日志 */
  metadata: {
    resolvedTemplate: PipelineTemplateId | "needs-driven";
    selectedSteps: string[];
    parallelGroups: string[][];
    skippedByThreshold: string[];
  };
}

export interface PresetConfig {
  /** 固定步骤序列（不受 needs 影响） */
  fixedSteps?: string[];
  /** 基线步骤（必选） */
  baseSteps?: string[];
  /** 可选步骤（受 needs 阈值控制） */
  optional?: Record<string, Partial<Record<NeedsKey, number>>>;
  /** 跳过偏好三件套 */
  skipPreference?: boolean;
}
