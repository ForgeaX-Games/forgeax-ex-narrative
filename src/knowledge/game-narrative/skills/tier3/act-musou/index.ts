/**
 * act-musou — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 无双动作 = 叙事中等。精简链：[世界观 → 角色 → 故事框架]
 *   叙事服务于"一骑当千"的爽感与武将群像，章节即战役。
 *   代表作：真·三国无双 / 战国无双 / Dynasty Warriors 系列。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 无双世界观原型（乱世群雄的战役舞台）
- 大历史背景：三国 / 战国 / 列国争霸，多势力割据是叙事天然骨架
- 世界以"战役地图"为单位组织：每张战场都有名（赤壁、官渡、长坂坡），地点即叙事节点
- 势力阵营清晰对立（魏蜀吴 / 织田武田等），玩家可在不同阵营视角重走历史
- 历史走向是宿命底色：玩家在已知结局里追求"如果由我来打会怎样"的爽感重演
- 民间演义味重于正史考据：英雄被神化、战场被传奇化
`.trim();

const WORLDVIEW_STYLE = `
- 语调：豪迈、激昂，带评书/演义式的传奇腔
- 每张战役开场用一段"战前态势"定调（谁攻谁守、胜负关键、名将登场）
- 世界观要为"一骑当千"提供合理性：乱世、士气、万军丛中取上将首级的传奇感
- 史实与演义混用时，优先服务戏剧张力而非考据精确
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 战役必须可独立成章：每个战场自带起因、转折、结局，不依赖玩家记住全部前史
- 不让世界观沦为人物列表；每个势力要有一句可感知的"为何而战"
- 历史改编可大胆，但同一作品内的势力关系与时间线须自洽
`.trim();

const CHARACTER_ARCHETYPE = `
# 无双角色原型（武将群像）
- 核心是"群像"而非单一主角：数十名可操作武将，各有招式与性格标签
- 每名武将三件套：标志性兵器/招式、一句口头禅式台词、与历史事件的绑定
- 性格高度符号化、易辨识（忠义、枭雄、猛将、智将、红颜），便于群像记忆
- 同一武将在不同阵营/作品里可有立场反差，制造"既生瑜何生亮"式的宿敌张力
`.trim();

const CHARACTER_STYLE = `
无双角色塑造：用最少笔墨立住最鲜明的剪影——一件兵器、一句名言、一场成名战即可定义一名武将。
台词要能在万军呐喊中喊得出口，金句感优先于细腻心理。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 武将必须辨识度优先：避免性格雷同，每人要有一个"一眼认出"的记忆点
- 宿敌/羁绊关系要在战役叙事中兑现（战场相遇时有专属对话）
- 不深挖复杂内心戏拖慢节奏；情感表达服务于战意与豪情
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 无双故事框架（战役章节制）
推荐 L0 框架按"战役链"铺设：
- 以阵营为主线，把历史进程切成数场关键战役，每战为一章
- 单章节拍：战前态势 → 出阵 → 战局逆转（援军/伏兵/单挑） → 决胜 → 战后过场
- 章与章之间用势力兴衰串联，提供"重走历史 / 改写历史"两种叙事满足
- 关键单挑（武将 vs 名将）作为章节高潮锚点
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 每章必须有一个"高光时刻"战役目标（守住/突破/斩将），让爽感落点明确
- 叙事过场要短、要燃，绝不打断动作节奏超过必要篇幅
- 多阵营视角并存时，同一历史事件在不同视角下的描述须互相呼应而非矛盾
`.trim();

export const ACT_MUSOU_SKILL: NarrativeSkill = {
  genreCode: "act-musou",
  tier: "tier3",
  matchKeywords: ["无双", "musou", "真三国无双", "dynasty warriors", "战国无双", "割草", "一骑当千", "武将"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "story_framework",      // ④ L0（战役章节）
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
    story_framework: {
      slots: {
        style_guide: STORY_FRAMEWORK_STYLE,
        constraints: STORY_FRAMEWORK_CONSTRAINTS,
      },
    },
  },
};

registerSkill(ACT_MUSOU_SKILL);
