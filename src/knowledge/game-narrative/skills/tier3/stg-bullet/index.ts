/**
 * stg-bullet — 品类叙事包（弹幕射击 / STG）
 *
 * 轻叙事型（5-15%）：剧情极简、角色魅力极强。
 *   东方 Project 式弹幕美学：异变即叙事钩子，关底 boss 高度人格化，
 *   符卡名是浓缩的叙事意象。代表作：东方 Project / 雷电 / 斑鸠。
 *
 * 链：[世界观 → 角色]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 弹幕射击世界观原型（异想天开的幻想乡）
- 母题是"异变"：某种打破日常的怪事（红雾蔽日、春不至、月色异常）成为整段冒险的引子
- 世界轻设定、重氛围：东方幻想乡式的妖怪与人类共存秘境，或科幻战机突入的敌阵纵深
- 关卡即一段"溯源之旅"：玩家一路向异变源头推进，每一关是一处风景与一个守关者
- 设定服务于关底对决：每个 boss 镇守一方天地，其身份即解释了此处弹幕风格的由来
`.trim();

const WORLDVIEW_STYLE = `
- 语调：空灵、奇谭、带和风/幻想志怪味；点到为止，留白胜于交代
- 用关卡推进暗示"越深入越接近真相"，无需冗长过场，景物变化即叙事
- 异变要有诗意的怪诞感，而非严肃灾难；轻盈、唯美、略带幽默
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界观必须轻：一两句话讲清这次"异变"是什么即可，绝不堆砌长篇设定
- 叙事不得拖慢弹幕节奏；故事散落在关卡之间，主体永远是弹幕对决
- 幻想氛围统一，避免硬核写实化破坏奇谭基调
`.trim();

const CHARACTER_ARCHETYPE = `
# 弹幕射击角色原型（人格化的关底群像）
- 灵魂在 boss：每个关底都是一名性格鲜明的妖怪/角色，弹幕风格即其人格外化
- 三件套：一个标志性身份（管月之兔、地狱火焰使）、一组主题符卡名、一句傲娇/慵懒/狂气的台词
- 主角组小而精：少数可选自机角色，各有性格与战斗信条，靠魅力而非剧情立住
- 对决前的几句斗嘴即角色塑造：调侃、宣战、惺惺相惜，轻松又有记忆点
`.trim();

const CHARACTER_STYLE = `
弹幕角色塑造：用一组华丽的符卡名 + 几句对决台词，瞬间立住一个鲜活又怪诞的灵魂。
角色魅力大于剧情厚度——让玩家因为喜欢这个 boss，而记住整段异变。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每个 boss 必须人格鲜明、辨识度极高，符卡名要有诗意且呼应其身份
- 对话简短机敏，绝不长篇说教；斗嘴服务于氛围而非交代世界观
- 主角与 boss 多为"亦敌亦友"的轻冲突，避免沉重的善恶对立
`.trim();

export const STG_BULLET_SKILL: NarrativeSkill = {
  genreCode: "stg-bullet",
  tier: "tier3",
  matchKeywords: ["弹幕", "stg", "东方", "雷电"],
  narrativeSteps: ["worldview", "character_enrichment"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: CHARACTER_STYLE,
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
  },
};

registerSkill(STG_BULLET_SKILL);
