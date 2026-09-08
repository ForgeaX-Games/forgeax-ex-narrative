/**
 * spt-extreme — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 极限运动 = 叙事极轻（5-15%）。链：[世界观 → 角色 → 道具]
 *   叙事只做"街头潮流包装"：滑板文化、炫技街区、明星选手生涯，叛逆酷感。
 *   代表作：Tony Hawk's Pro Skater / SSX / Skate。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 极限运动世界观原型（街头潮流文化场域）
- 世界由真实/夸张化的街区与场地拼成：废弃工厂、学校、商场、半管、雪山赛道
- 没有剧情主线，"地点即舞台"：每个场景都是一块等待被刷分征服的炫技画布
- 文化底色是滑板/极限亚文化：涂鸦、街头音乐、潮牌、反主流的自由态度
- 以"生涯巡回"组织：从地下场地打到职业大赛，刷分、解锁场地、扬名街头
`.trim();

const WORLDVIEW_STYLE = `
- 语调：叛逆、酷、街头痞气，配朋克/嘻哈节奏感
- 用一句话点出每个街区的潮流气质（地下涩谷 / 落日海滨 / 雪山极速）
- 世界观服务于"炫技自由"：哪里都能 grind，哪里都能炸场
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 保持街头真实感与态度，避免说教式正能量
- 场景设计服务于动作线路（栏杆、斜坡、跳台），不堆无关设定
- 世界观点到即止，绝不抢炫技与刷分的戏份
`.trim();

const CHARACTER_ARCHETYPE = `
# 极限选手角色原型（明星选手 + 生涯崛起）
- 核心是个性鲜明的明星选手：一套潮装、一块定制板、一种招牌动作
- 性格符号化：街头老炮、天才新秀、特立独行的怪咖、商业巨星
- 生涯弧线极简：无名小子 → 街头扬名 → 职业赞助 → 极限传奇
- 同行间是"切磋较劲"的良性竞争，互相 respect 而非生死宿敌
`.trim();

const CHARACTER_STYLE = `
极限选手塑造：用潮流造型 + 招牌大招立剪影——一身行头、一个标志性翻转即定义此人。
台词带街头黑话与酷劲，简短自信，落地一个大招比千言万语更有人设。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 辨识度优先：每位选手要有专属造型与招牌动作记忆点
- 态度自信不油腻，少写内心戏，多用行动与场上表现说话
- 生涯叙事极简，绝不拖慢"上场刷分"的爽快节奏
`.trim();

const ITEM_DATABASE_STYLE = `
# 极限装备（板/装备/涂装）
- 核心是滑板/单板/轮滑等器材 + 个性化涂装与潮牌行头
- 每件装备一句"风格 + 手感"描述：板面图案的态度、轮子抓地、调校偏速度还是平衡
- 装备是自我表达的延伸：涂装、贴纸、配色就是选手的街头身份
- 升级方向偏"风格化与微操手感"，而非数值碾压
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 装备描述紧扣潮流态度与手感，避免冰冷参数堆砌
- 涂装/外观自由表达，但不喧宾夺主盖过动作玩法
- 每件装备一句话点清风格定位，简洁有态度
`.trim();

export const SPT_EXTREME_SKILL: NarrativeSkill = {
  genreCode: "spt-extreme",
  tier: "tier3",
  matchKeywords: ["极限运动", "tony hawk"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "item_database",        // ④ 装备/板/涂装
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

registerSkill(SPT_EXTREME_SKILL);
