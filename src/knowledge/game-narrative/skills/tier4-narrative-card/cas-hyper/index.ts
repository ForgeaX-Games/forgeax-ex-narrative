/**
 * cas-hyper — 微叙事型品类叙事包（超休闲）
 *
 * tier4 微叙事：单步 narrative_card。几乎无叙事，仅给极简动机与吉祥物人设。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

export const CAS_HYPER_SKILL: NarrativeSkill = {
  genreCode: "cas-hyper",
  tier: "tier4",
  matchKeywords: ["超休闲", "flappy bird", "跳一跳", "hyper casual"],
  stepSkills: {
    narrative_card: {
      slots: {
        style_guide: `
# 超休闲叙事卡风格
- 叙事压缩到极限：一个角色 + 一个"再来一次"的小目标即可
- 用幽默/反差制造记忆点（越简单越要有梗）
- 皮肤/角色解锁是唯一的"收集叙事"，每个皮肤配半句俏皮描述
`.trim(),
        constraints: `
- 0 学习成本：任何文案不得增加理解负担
- 单卡 < 30 字；优先表情/符号化表达
- 不设连续剧情，避免任何需要前置记忆的内容
`.trim(),
      },
    },
  },
};

registerSkill(CAS_HYPER_SKILL);
