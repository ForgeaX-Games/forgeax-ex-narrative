/**
 * misc-pinball — 微叙事型品类叙事包（弹珠/弹球）
 *
 * tier4 微叙事：单步 narrative_card。叙事服务于桌面主题与任务模式包装。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

export const MISC_PINBALL_SKILL: NarrativeSkill = {
  genreCode: "misc-pinball",
  tier: "tier4",
  matchKeywords: ["弹珠", "弹球", "pinball"],
  stepSkills: {
    narrative_card: {
      slots: {
        style_guide: `
# 弹珠台叙事卡风格
- 叙事 = 弹珠台"主题宇宙"（海盗 / 太空 / 怪兽）+ 任务模式的小目标串联
- 用解说员/播报式口吻烘托连击与得分高潮（"MULTIBALL!"式的兴奋感）
- 每个台面任务（Mission）配一句主题化导语，奖励桌面叙事彩蛋
`.trim(),
        constraints: `
- 不写连续主线，叙事附着在台面主题与任务模式上
- 单卡文案 < 40 字，能在球落袋间隙读完
- 文风随台面主题切换，保持高能、明快、富节奏感
`.trim(),
      },
    },
  },
};

registerSkill(MISC_PINBALL_SKILL);
