/**
 * Roguelike (rpg-roguelike) — E2 高频品类 skill
 *
 * Tier2，适配 tpl-fragmented 或 tpl-emergent。
 * 关键：每局开始的随机性 + 跨局元叙事（永久解锁、记忆碎片）。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const ROGUE_WORLDVIEW = `
# Roguelike 世界观
- 循环 / 重启叙事是核心：世界本身知道你在循环（地狱 / 时间监狱 / 无限轮回）
- 每次入局存在轻微差异：随机词条 / 房间布局 / 遭遇 NPC
- 叙事 hub 是关键：玩家在 hub 解锁元剧情，单局只是"出击"
`.trim();

const ROGUE_CHARACTERS = `
# Roguelike 角色
- 玩家角色 = 反复出战的核心，不一定是单一身份（可切换 / 多角色）
- Hub NPC 系列：每位 NPC 在玩家"死了 N 次"后逐步打开私事线
- 敌人精英化：每个敌人有名字 / 台词 / 死亡反馈
`.trim();

const ROGUE_FRAGMENTED_LORE = `
# Roguelike Lore 碎片化叙事
- Lore 必须以"小卡片 / 一句话物品描述 / 死亡笔记"方式投递
- 每条 Lore < 80 字，最多 3 句
- 同一主题分散到 10-20 条碎片中，逐步拼图
- 重大转折通过累积 N 条 Lore 触发，不放在主线节点上
`.trim();

const ROGUE_SCENE = `
# Roguelike 场景生成
- 场景 = 节拍单位：休息间 / 战斗间 / Boss 间 / 商店 / 事件
- 必须给出"可重复使用的描述模板"，让随机生成的房间也有叙事色彩
- 不同章节区域 = 不同视觉 / 氛围 / Lore 主题
`.trim();

export const ROGUELIKE_SKILL: NarrativeSkill = {
  genreCode: "rpg-roguelike",
  tier: "tier2",
  matchKeywords: ["Roguelike", "肉鸽", "随机生成", "Hades", "杀戮尖塔", "以撒", "暴雨", "死亡循环"],
  stepSkills: {
    worldview: { slots: { worldview_archetype: ROGUE_WORLDVIEW } },
    character_enrichment: { slots: { character_archetype: ROGUE_CHARACTERS } },
    lore_generation: { slots: { style_guide: ROGUE_FRAGMENTED_LORE } },
    scene_plan: { slots: { style_guide: ROGUE_SCENE } },
  },
};

registerSkill(ROGUELIKE_SKILL);
