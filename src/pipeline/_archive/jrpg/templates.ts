/**
 * templates.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/templates.ts` 的 `JRPG_PIPELINE_STEPS` 常量与三个 RPG 模板定义
 * （`tpl-jrpg` / `tpl-jrpg-v2` / `tpl-rpg`）。A3 已判定三者步序与提示词逐字
 * 相同、零条 `SeatBinding` 特化实现、无独立吸收去处——本文件只是把这份早已
 * 确认的事实固化成代码快照，不代表本轮又发现了新差异。查证过程见
 * [`./README.md`](./README.md) 第三节。`JRPG_PIPELINE_STEPS` 本身已在 A3 冻结为
 * `README.md` 第一、二节的 L0-L5 参考基线文档快照，此处的代码副本与文档
 * 快照互为印证，不是两份独立事实源。
 *
 * 本文件不再被任何活跃代码 import。`PipelineTemplateId` 类型本身仍保留在
 * 活跃的 `../../templates.ts` 里（历史 checkpoint 读取键），三个 id 字面量
 * 继续可用；`expert-agents.test.ts` 里唯一引用 `JRPG_PIPELINE_STEPS` 的用例已
 * 随 D1 迁到 `./__tests__/expert-agents-jrpg-legacy.test.ts`。
 */
import { STEP_IDS as S } from "../../routing/modes.js";
import type { PipelineTemplateId } from "../../routing/templates.js";

interface ArchivedPipelineTemplate {
  id: PipelineTemplateId;
  label: string;
  description: string;
  /** 步骤序列（与 ModeConfig.steps 同构，支持嵌套数组表示并行组） */
  steps: Array<string | string[]>;
  /** 可选的扩展步骤：默认关闭，可被 skill md frontmatter 的 enableSteps 启用 */
  optionalSteps?: string[];
  /** 该模板适配的 tier 范围（用于 UI 显示与校验） */
  tiers: Array<"tier1" | "tier2" | "tier3" | "tier4">;
}

const PREF = [S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS];
const BASE = [...PREF, S.INITIAL_PLAN, S.WORLDVIEW];
const ENTITIES = [S.CHARACTER_ENRICHMENT, S.ITEM_DATABASE];

/** JRPG 全量步序（新架构 tpl-jrpg 与归档 tpl-jrpg-v2/tpl-rpg 共享；差异只在已退役的提示词库版本字段）。 */
export const JRPG_PIPELINE_STEPS: Array<string | string[]> = [
  ...BASE,
  ...ENTITIES,
  S.STORY_FRAMEWORK,
  S.OUTLINE_BATCH,
  S.DETAILED_OUTLINE,
  S.PLOT_GENERATION,
  S.SCRIPT_GENERATION,
  [S.QUEST_GENERATION, S.SCENE_PLAN],
];

export const JRPG_TEMPLATES: Record<"tpl-jrpg" | "tpl-jrpg-v2" | "tpl-rpg", ArchivedPipelineTemplate> = {
  "tpl-jrpg": {
    id: "tpl-jrpg",
    label: "tpl-jrpg",
    description:
      "新架构 JRPG 预制管线（V1）：由单品工程师组合而成的工作流；提示词从三轴槽位库按需组装。",
    tiers: ["tier1"],
    steps: [...JRPG_PIPELINE_STEPS],
  },

  "tpl-jrpg-v2": {
    id: "tpl-jrpg-v2",
    label: "tpl-jrpg-v2",
    description:
      "归档精调 JRPG/RPG 管线（V2）：原 tpl-rpg 整体提示词；legacy 与对照基线保留可跑。",
    tiers: ["tier1"],
    steps: [...JRPG_PIPELINE_STEPS],
  },

  "tpl-rpg": {
    id: "tpl-rpg",
    label: "tpl-jrpg-v2",
    description:
      "[DEPRECATED alias → tpl-jrpg-v2] 历史 checkpoint / genre 映射兼容；新代码请用 tpl-jrpg 或 tpl-jrpg-v2。",
    tiers: ["tier1"],
    steps: [...JRPG_PIPELINE_STEPS],
  },
};
