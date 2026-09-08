/**
 * templates.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/templates.ts` 里四个品类特化模板的定义（`tpl-open-world` /
 * `tpl-card-game` / `tpl-fragmented` / `tpl-emergent`）。业务功能已由 C3 吸收进
 * 通用 `lore_generation` / `plot_generation`（详见 [`./README.md`](./README.md)
 * 吸收台账），本文件只保留定义本体的原貌以便复核，不是又一处独立的吸收记录。
 *
 * 本文件不再被任何活跃代码 import。`PipelineTemplateId` 类型本身仍保留在
 * 活跃的 `../../templates.ts` 里（历史 checkpoint 读取键），四个 id 字面量
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

export const SPECIALIZED_TEMPLATES: Record<
  "tpl-open-world" | "tpl-card-game" | "tpl-fragmented" | "tpl-emergent",
  ArchivedPipelineTemplate
> = {
  "tpl-open-world": {
    id: "tpl-open-world",
    label: "开放世界 RPG",
    description: "开放世界：偏好 → 初步方案 → 世界观 → 区域设计 → 角色 → 涌现事件（Lore 由通用叙事 agent 内嵌产出）",
    tiers: ["tier1"],
    steps: [
      ...BASE,
      "region_design",    // B3 stub
      S.CHARACTER_ENRICHMENT,
      "emergent_event",   // B3 stub
      // Lore (L) 已由通用叙事 agent 在区域/角色/事件中内嵌产出，不再驱动独立 step
    ],
  },

  "tpl-card-game": {
    id: "tpl-card-game",
    label: "卡牌游戏叙事",
    description: "CCG / Card Narrative：偏好 → 初步方案 → 世界观 → 卡牌 Lore → 事件池",
    tiers: ["tier2", "tier3"],
    steps: [
      ...BASE,
      "card_lore",        // B3 stub
      "event_pool",       // B3 stub
    ],
  },

  "tpl-fragmented": {
    id: "tpl-fragmented",
    label: "碎片化叙事",
    description: "Souls-like / Metroidvania：偏好 → 初步方案 → 世界观 → 角色 → 道具 → 场景（Lore 由通用叙事 agent 内嵌产出）",
    tiers: ["tier1", "tier2", "tier3"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      S.ITEM_DATABASE,           // 物品/碎片/笔记承载 Lore 的载体
      // Lore (L) 已由通用叙事 agent 在 item_database 中内嵌产出，不再驱动独立 step
      S.SCENE_PLAN,
    ],
  },

  "tpl-emergent": {
    id: "tpl-emergent",
    label: "涌现性叙事",
    description: "4X / 沙盒：偏好 → 初步方案 → 世界观 → 事件模板",
    tiers: ["tier2", "tier3"],
    steps: [
      ...BASE,
      "emergent_event",   // 复用同一 step
    ],
  },
};
