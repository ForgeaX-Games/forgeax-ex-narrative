/**
 * templates.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/templates.ts` 里 `tpl-vn` 的模板定义。业务功能已由 C2 吸收进
 * 通用席位（详见 [`./README.md`](./README.md) 吸收台账），本文件只保留定义
 * 本体的原貌以便复核，不是又一处独立的吸收记录。
 *
 * 本文件不再被任何活跃代码 import。`PipelineTemplateId` 类型本身仍保留在
 * 活跃的 `../../templates.ts` 里（历史 checkpoint 读取键），`"tpl-vn"` 字面量
 * 继续可用。
 */
import { STEP_IDS as S } from "../../routing/modes.js";
import type { PipelineTemplateId } from "../../routing/templates.js";

interface ArchivedPipelineTemplate {
  id: PipelineTemplateId;
  label: string;
  description: string;
  steps: Array<string | string[]>;
  optionalSteps?: string[];
  tiers: Array<"tier1" | "tier2" | "tier3" | "tier4">;
}

const PREF = [S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS];
const BASE = [...PREF, S.INITIAL_PLAN, S.WORLDVIEW];

export const VN_V1_TEMPLATE: ArchivedPipelineTemplate = {
  id: "tpl-vn",
  label: "[已废弃] 视觉小说 / 互动影游 v1",
  description: "[历史兼容用] 旧版 VN 管线：偏好 → 初步方案 → 世界观 → 角色 → 分支树 → 对话脚本。新工程请使用 tpl-vn-v2。",
  tiers: ["tier2"],
  steps: [
    ...BASE,
    S.CHARACTER_ENRICHMENT,
    "branch_tree",
    "dialogue_script",
  ],
  optionalSteps: ["cinematic_storyboard"],
};
