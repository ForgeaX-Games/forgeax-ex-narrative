/**
 * Auto-battler / 自走棋 (str-autobattle) — E2 高频品类 skill
 *
 * Tier4 默认走 tpl-narrative-card：仅一步 narrative_card 生成。
 * 关键：弱叙事 + 强主题包装 + 棋子角色个性化包装。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const AUTOBATTLE_NARRATIVE_CARD = `
# 自走棋 / 自动战斗 叙事卡风味
- 不需要复杂世界观，只需要"主题统一的舞台"（异世界擂台 / 神明角斗场 / 棋盘宇宙）
- 重点是"棋子之间的趣味关系"（互相嘲讽 / 派系冲突 / 隐藏剧情）
- 必须输出 8-12 个棋子角色卡（短描述 + 一句招牌台词）
- 不写主线剧情，写"赛季背景设定"
- 输出节奏：一段 200 字赛季背景 + 棋子卡片矩阵 + 1 句宣传语
`.trim();

export const AUTOBATTLE_SKILL: NarrativeSkill = {
  genreCode: "str-autobattle",
  tier: "tier4",
  matchKeywords: ["自走棋", "Autobattle", "Auto Chess", "云顶之弈", "金铲铲", "TFT", "棋盘"],
  stepSkills: {
    narrative_card: { slots: { style_guide: AUTOBATTLE_NARRATIVE_CARD } },
  },
};

registerSkill(AUTOBATTLE_SKILL);
