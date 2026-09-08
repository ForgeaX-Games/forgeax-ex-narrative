/**
 * rhy-pure — 微叙事型品类叙事包（纯节奏）
 *
 * tier4 微叙事：单步 narrative_card。叙事极弱，仅服务于曲目/角色的氛围点缀。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

export const RHY_PURE_SKILL: NarrativeSkill = {
  genreCode: "rhy-pure",
  tier: "tier4",
  matchKeywords: ["纯节奏", "osu", "太鼓达人", "节奏天国"],
  stepSkills: {
    narrative_card: {
      slots: {
        style_guide: `
# 纯节奏叙事卡风格
- 叙事 = 曲目的情绪标签 + 一句意象化导语（为每首曲子写"一句话氛围"）
- 可选的吉祥物/DJ 形象作为陪伴者，台词短促、有节奏感
- 用"通关曲库 = 一段心情旅程"的方式给玩家轻量收集叙事
`.trim(),
        constraints: `
- 不写完整剧情，只写曲目意象与情绪；严禁打断演奏节奏
- 单卡文案极短（< 40 字），可在选曲界面一眼读完
- 文风随曲风走（电子/和风/古典各有腔调），不强行统一
`.trim(),
      },
    },
  },
};

registerSkill(RHY_PURE_SKILL);
