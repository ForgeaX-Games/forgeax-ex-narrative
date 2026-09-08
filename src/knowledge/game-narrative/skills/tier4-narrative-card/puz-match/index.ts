/**
 * puz-match — 微叙事型品类叙事包（消除/三消）
 *
 * tier4 微叙事：管线固定为单步 narrative_card（preset tpl-narrative-card），
 * 无需 narrativeSteps；此处仅为 narrative_card 注入品类专属文风/约束。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

export const PUZ_MATCH_SKILL: NarrativeSkill = {
  genreCode: "puz-match",
  tier: "tier4",
  matchKeywords: ["消除", "三消", "消消乐", "candy crush", "梦幻花园"],
  stepSkills: {
    narrative_card: {
      slots: {
        style_guide: `
# 三消叙事卡风格
- 叙事仅作"关卡包装糖衣"：用一个轻松目标（帮邻居布置花园 / 修复小店）串联关卡
- 主角与 NPC 形象可爱、零门槛，一句话能记住
- 每隔 N 关推进一小步剧情，奖励感来自"看到家园一点点变好"
`.trim(),
        constraints: `
- 严禁复杂世界观/沉重冲突；情绪基调始终轻松治愈
- 单卡文案 < 60 字，能在加载间隙读完
- 不依赖玩家记忆前情，任何关卡进入都能秒懂当前目标
`.trim(),
      },
    },
  },
};

registerSkill(PUZ_MATCH_SKILL);
