/**
 * Tier3 mid-frequency genres (E3 batch) — concise skill stubs.
 *
 * C3（2026-08）已封存：card_lore / event_pool 两个品类特化 step 吸收进通用
 * lore_generation / plot_generation；下方各品类的卡牌 Lore 风格与赛季事件池
 * 风格现直接挂在 stepSkills.lore_generation / stepSkills.plot_generation。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const SKILLS: NarrativeSkill[] = [
  {
    genreCode: "card-ccg",
    tier: "tier2",
    matchKeywords: ["CCG", "卡牌", "炉石传说", "万智牌", "影之诗", "符文之地", "游戏王"],
    stepSkills: {
      worldview: { slots: { worldview_archetype: "CCG 世界观：阵营 / 派系明确，每张卡牌都是世界的一个角色 / 物件 / 时刻。" } },
      lore_generation: { slots: { style_guide: "CCG 卡牌 Lore：每张卡 1-2 句 flavor text，长度 < 40 字。语调与卡牌阵营一致。" } },
      plot_generation: { slots: { style_guide: "CCG 赛季事件池：限时玩法 / 故事章节 / 阵营战。每个事件含 5-10 张限定卡 + 一段背景。" } },
    },
  },
  {
    genreCode: "card-narrative",
    tier: "tier2",
    matchKeywords: ["叙事卡牌", "Card Narrative", "杀戮尖塔", "Inscryption"],
    stepSkills: {
      worldview: { slots: { worldview_archetype: "叙事卡牌：单局 = 单段故事。世界规则透过卡牌机制呈现。" } },
      lore_generation: { slots: { style_guide: "叙事卡牌 Lore：卡牌即是叙事单元，每张卡牌捎带角色台词或场景描写。" } },
      plot_generation: { slots: { style_guide: "叙事卡牌事件：路线节点（休息 / 商店 / 精英 / Boss / 神秘事件）必须互相呼应主题。" } },
    },
  },
  // 注：act-2d-platformer 已迁移到 skills/tier2/act-2d-platformer/ 品类叙事包（含 narrativeSteps）。
  // 注：act-stealth 已迁移到 skills/tier2/act-stealth/ 品类叙事包（含 narrativeSteps）。
];

for (const s of SKILLS) registerSkill(s);

export const TIER3_MID_GENRES = SKILLS;
