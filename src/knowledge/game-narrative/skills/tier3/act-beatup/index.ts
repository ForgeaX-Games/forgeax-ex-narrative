/**
 * act-beatup — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * Beat'em Up（清版动作）= 叙事轻量（叙事占比 10-25%）。链：[世界观 → 角色 → 可拾取道具]
 *   横版过关、街头扫荡，简单复仇/拯救主线 + boss 关卡叙事 + 双人合作。
 *   代表作：怒之铁拳（Streets of Rage）/ 快打旋风。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 清版动作世界观原型（被恶势力笼罩的街头）
- 核心前提：一座被黑帮/犯罪组织控制的城市，主角挺身扫荡街头，一句话讲清动机
- 主线极简且经典：复仇（亲友被害）/ 拯救（绑架的同伴）/ 夺回（被占领的街区）
- 世界以"关卡街区"组织：街道、码头、地下街、敌方总部，地点即过关进度
- 反派金字塔：小喽啰 → 关底 boss → 幕后大佬，组织结构即叙事推进的阶梯
- 都市动作片质感：霓虹街头、废弃工厂、暴雨夜，B 级动作电影的爽快基调
`.trim();

const WORLDVIEW_STYLE = `
- 语调：硬派、热血、街头动作片式，简洁直给不拖泥带水
- 用一段"开场犯罪事件"点燃动机（谁出事了、为何上街），随即进入扫荡
- 世界观为"横版过关扫荡"服务：每个街区一个主题氛围，推进即叙事
- 把篇幅留给打斗与 boss 登场，剧情过场短而燃
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 主线须极简清晰（复仇/拯救/夺回其一），严禁复杂多线叙事拖慢节奏
- 关卡街区须主题鲜明且推进顺畅，地点即过关进度
- 反派组织须有清晰层级，为每关 boss 提供登场理由
`.trim();

const CHARACTER_ARCHETYPE = `
# 清版动作角色原型（街头扫荡的硬汉搭档）
- 核心是"可选主角搭档"：2-4 名风格各异的角色（力量型/速度型/均衡型），支持双人合作
- 每名主角三件套：鲜明造型与战斗风格、一句硬派口头禅、参战动机（前警察/格斗家/复仇者）
- 角色辨识靠剪影：体型、武器、招式手感差异化，让玩家一眼选出本命
- 反派群像功能化：每关 boss 一个鲜明记忆点（巨汉、双刀、火焰兵），登场即压迫感
- 双人合作的轻羁绊：搭档间几句插科打诨或并肩信念，点到为止增添街头义气
`.trim();

const CHARACTER_STYLE = `
清版动作角色塑造：用造型与战斗手感立住硬汉剪影——一种打法、一句狠话、一个上街理由即可。
台词要短而带街头气场，搭档间的义气点到为止，把张力交给拳脚。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角须以战斗风格与造型高辨识区隔（力量/速度/均衡），避免雷同
- 动机一句话讲清即可，不深挖复杂内心戏拖慢节奏
- 每关 boss 须有鲜明记忆点与登场理由，服务过关高潮
`.trim();

const ITEM_DATABASE_STYLE = `
# 清版动作道具图鉴（可拾取武器 / 道具）
- 可拾取武器：街头随手可捡的家伙（铁管、刀、棒球棍、空瓶），用法直觉、用完即弃
- 场景互动物：油桶、垃圾桶、霓虹招牌等可砸可踢的环境物件，增添扫荡爽感
- 回复与增益道具：路边的烤鸡/苹果回血、特殊道具临时强化，藏在木箱/油桶里
- 道具档案三要素：外形、效果（伤害/回血/增益）、获取方式（敌人掉落/场景拾取/破坏箱）
- 为关卡主题服务：不同街区出现契合氛围的道具（码头有鱼叉、工厂有扳手）
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 道具须直觉易懂、即拾即用，服务街头扫荡的爽快节奏
- 武器以"临时性"为主，避免复杂养成或永久装备系统
- 道具种类须契合关卡街区主题，增添过关辨识度而非堆砌
`.trim();

export const ACT_BEATUP_SKILL: NarrativeSkill = {
  genreCode: "act-beatup",
  tier: "tier3",
  matchKeywords: ["清版动作", "怒之铁拳"],
  narrativeSteps: ["worldview", "character_enrichment", "item_database"],
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

registerSkill(ACT_BEATUP_SKILL);
