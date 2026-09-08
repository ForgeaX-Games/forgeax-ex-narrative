/**
 * presets.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/planner/presets.ts`：把 9 个 buildXxxAutoSteps 的逻辑转成声明式数据，
 * Planner Step 1 据此按 pipelineTemplate 查表。随 `planner/` 整体搬入，理由见
 * `./README.md`。
 *
 * 本文件不再被任何活跃代码 import。
 */
import type { PresetConfig } from "./types.js";
import type { PipelineTemplateId } from "../../routing/templates.js";

// 与 templates.ts / modes.ts 的 tpl-vn-v2 规范链严格对齐（8 步）。
// 场/情节点解耦（§4.6c）：移除前置 vn_scenes 结构步；场号由 vn_branched_beats 末尾确定性导出。
// vn_state_ledger（G-01.5 世界状态账本）必须在 vn_branched_beats 与 vn_screenplay 之间，
// 否则 Planner 路径会漏掉账本步，导致剧本/分镜失去世界状态一致性约束。
const VN_V2_STEPS = [
  "vn_logline",
  "vn_outline_acts",
  "worldview",
  "vn_beats",
  "vn_branched_beats",
  "vn_state_ledger",
  "vn_screenplay",
  "vn_storyboard",
] as const;

/** JRPG / 历史 RPG 共用的 needs 可选步（tpl-jrpg / tpl-jrpg-v2 / tpl-rpg）。 */
const JRPG_OPTIONAL: PresetConfig = {
  baseSteps: [],
  optional: {
    worldview: { W: 1 },
    character_enrichment: { C: 2 },
    item_database: { I: 2 },
    story_framework: { S: 2 },
    outline_batch: { S: 2 },
    detailed_outline: { S: 3 },
    plot_generation: { S: 3 },
    script_generation: { D: 3 },
    quest_generation: { Q: 2 },
    scene_generation: { E: 2 },
  },
};

export const PIPELINE_PRESETS: Partial<Record<PipelineTemplateId, PresetConfig>> = {
  "tpl-jrpg": { ...JRPG_OPTIONAL },
  "tpl-jrpg-v2": { ...JRPG_OPTIONAL },
  "tpl-rpg": { ...JRPG_OPTIONAL },

  "tpl-narrative-card": {
    fixedSteps: ["narrative_card"],
    skipPreference: true,
  },

  "tpl-vn-v2": {
    fixedSteps: [...VN_V2_STEPS],
    skipPreference: true,
  },

  "tpl-vn": {
    baseSteps: ["branch_tree", "dialogue_script"],
    optional: {
      worldview: { W: 1 },
      character_enrichment: { C: 2 },
      cinematic_storyboard: { E: 2 },
    },
  },

  "tpl-open-world": {
    baseSteps: ["worldview", "region_design", "emergent_event"],
    optional: {
      character_enrichment: { C: 2 },
    },
  },

  "tpl-card-game": {
    baseSteps: ["worldview", "card_lore", "event_pool"],
    optional: {},
  },

  "tpl-emergent": {
    baseSteps: ["worldview", "emergent_event"],
    optional: {},
  },

  "tpl-fragmented": {
    baseSteps: ["worldview"],
    optional: {
      character_enrichment: { C: 1 },
      item_database: { I: 1 },
      scene_generation: { E: 1 },
    },
  },

  "tpl-light": {
    baseSteps: [],
    optional: {
      worldview: { W: 1 },
      character_enrichment: { C: 1 },
    },
  },
};

export function getPreset(template: PipelineTemplateId): PresetConfig | undefined {
  return PIPELINE_PRESETS[template];
}
