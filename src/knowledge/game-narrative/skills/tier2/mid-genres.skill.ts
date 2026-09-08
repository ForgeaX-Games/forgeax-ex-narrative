/**
 * Tier2 mid-frequency genres (E3 batch) — concise skill stubs.
 *
 * C3（2026-08）已封存：str-4x 原挂在品类特化 step `emergent_event` 上的涌现事件
 * skill 已迁移到通用 `plot_generation`，形态差异交给 network/emergent/fragmented 结构卡表达。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

// 注：rpg-srpg 已迁移到 skills/tier2/rpg-srpg/ 品类叙事包（含 narrativeSteps）。
const SKILLS: NarrativeSkill[] = [
  {
    genreCode: "str-tbs",
    tier: "tier2",
    matchKeywords: ["回合制策略", "TBS", "文明", "全面战争", "XCOM"],
    stepSkills: {
      worldview: { slots: { worldview_archetype: "TBS 世界观：文明发展 / 多势力冲突 / 历史长河。重点是势力间的张力与玩家可介入空间。" } },
      story_framework: { slots: { style_guide: "TBS 框架：弱主线 + 强动态事件。每个回合提供一个剧情/外交机会。" } },
    },
  },
  {
    genreCode: "str-4x",
    tier: "tier2",
    matchKeywords: ["4X", "群星", "无尽空间", "旧世界", "Stellaris", "文明"],
    stepSkills: {
      worldview: { slots: { worldview_archetype: "4X 世界观：星系 / 大陆地图，多文明并起。允许诞生玩家不预期的事件链。" } },
      plot_generation: { slots: { style_guide: "4X 涌现事件：随机事件池要分类（自然灾害 / 外交奇遇 / 技术突破 / 神秘信号）；每事件含 3-5 选项。" } },
    },
  },
];

for (const s of SKILLS) registerSkill(s);

export const TIER2_MID_GENRES = SKILLS;
