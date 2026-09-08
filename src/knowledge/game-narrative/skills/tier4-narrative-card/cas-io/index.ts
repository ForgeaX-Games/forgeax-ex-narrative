/**
 * cas-io — 微叙事型品类叙事包（IO 游戏）
 *
 * tier4 微叙事：单步 narrative_card。叙事服务于多人竞技氛围与皮肤主题。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

export const CAS_IO_SKILL: NarrativeSkill = {
  genreCode: "cas-io",
  tier: "tier4",
  matchKeywords: ["io", "大作战", "agar", "slither", "贪吃蛇大作战"],
  stepSkills: {
    narrative_card: {
      slots: {
        style_guide: `
# IO 游戏叙事卡风格
- 叙事 = 竞技场主题 + 皮肤/外观的轻设定（你是谁、在抢什么）
- 营造"人人都是对手"的紧张感与逆袭爽感，鼓励再来一局
- 赛季/主题皮肤用一两句话给世界包装（如"末日食物链"主题）
`.trim(),
        constraints: `
- 不写线性剧情；所有内容服务于即时多人对抗氛围
- 单卡 < 40 字；强调即时反馈与排行榜情绪
- 保持中立可全球化，避免过度本地化梗
`.trim(),
      },
    },
  },
};

registerSkill(CAS_IO_SKILL);
