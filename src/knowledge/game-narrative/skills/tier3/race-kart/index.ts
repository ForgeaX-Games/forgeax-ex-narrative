/**
 * race-kart — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 卡丁车/休闲竞速 = 叙事极轻（5-10%）。链：[世界观 → 角色 → 道具]
 *   叙事只做"欢乐包装"：卡通赛道、明星车手群像、道具混战，零压力搞怪。
 *   代表作：马里奥赛车 / 跑跑卡丁车 / Crash Team Racing。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 卡丁车世界观原型（欢乐卡通赛道乐园）
- 世界是一座色彩缤纷的赛车主题乐园：海滩、糖果城、火山、太空站皆可成赛道
- 没有死亡与战争，只有"谁先冲线"的友好竞速；翻车爆胎都是搞笑而非悲剧
- 赛道即舞台：弯道、跳台、捷径、机关陷阱本身就是叙事看点
- 锦标赛/杯赛结构串联世界：金杯银杯铜杯，一站接一站的环球巡回
`.trim();

const WORLDVIEW_STYLE = `
- 语调：欢乐、明快、卡通化，全程零压力
- 用一句话点亮每条赛道的主题风味（南国沙滩 / 甜品王国 / 霓虹夜街）
- 世界观服务于"轻松开黑"：人人能上手，看一眼就想冲
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 绝不沉重：无血腥、无生死，碰撞只换来搞笑翻滚
- 赛道主题要一眼辨识，避免雷同换皮
- 世界观点到为止，绝不抢竞速与道具混战的戏份
`.trim();

const CHARACTER_ARCHETYPE = `
# 卡丁车角色原型（明星车手群像）
- 核心是萌系/明星车手群像：每人一套配色、一台标志座驾、一句口头禅
- 性格高度符号化：呆萌主角、傲娇对手、搞怪反派、稳重老将，一眼区分
- 角色无需深度背景，靠造型 + 招牌动作 + 胜负表情立人设
- 宿敌关系停留在"赛道斗嘴"层面，欢乐拌嘴而非深仇
`.trim();

const CHARACTER_STYLE = `
卡丁车角色塑造：用最萌最夸张的剪影立人——一身配色、一台座驾、一句嘴炮即可记住。
台词短促搞笑（甩出香蕉皮时的得意、被导弹击中的哀嚎），全是赛道情绪。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 辨识度优先：每位车手要有"一眼认出"的造型记忆点
- 情绪外放、表演化，绝不写内心独白拖节奏
- 胜负皆欢乐：赢了得意、输了搞笑，不带真实挫败感
`.trim();

const ITEM_DATABASE_STYLE = `
# 卡丁车道具（竞速混战的灵魂）
- 道具是核心玩法担当：香蕉皮、龟壳/导弹、加速蘑菇、护盾、闪电（全场减速）
- 每个道具一句"使用即笑点"的描述：扔出去坑人、被击中翻滚的喜剧效果
- 道具强调"逆风翻盘"：落后者抽到强力道具，制造混战与逆转
- 命名俏皮、效果直观，看名字就懂怎么坑队友
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 道具必须搞笑无伤大雅：只让对手减速/打转，绝不血腥
- 平衡逆风机制：强道具偏向落后者，保证欢乐混战不崩盘
- 每件道具效果一句话说清，避免复杂数值堆砌
`.trim();

export const RACE_KART_SKILL: NarrativeSkill = {
  genreCode: "race-kart",
  tier: "tier3",
  matchKeywords: ["卡丁车", "马里奥赛车", "跑跑卡丁车"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "item_database",        // ④ 竞速道具
  ],
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
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
      },
    },
  },
};

registerSkill(RACE_KART_SKILL);
