/**
 * fgt-weapon — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 武器格斗 = 叙事中等（叙事占比 15-25%）。链：[世界观 → 角色 → 兵器图鉴]
 *   冷兵器对决，传说武器驱动剧情，武器即角色的延伸。
 *   代表作：灵魂能力（SoulCalibur）/ 荣耀战魂。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 武器格斗世界观原型（传说兵器牵动的乱世）
- 核心骨架：一件（或一组）传说武器作为剧情引擎（灵魂之剑/灵魂之刃式的魔剑与圣剑之争）
- 世界以"持械阵营"组织：骑士、武士、维京、海盗、忍者各据一方，文明碰撞
- 武器即命运：争夺、封印、净化传说兵器的旅途，把各国剑客串到同一时代洪流
- 历史感与传奇感并重：跨大陆的冷兵器时代，战乱、王朝、流派传承为底色
- 宿敌与执念：为复仇、为守护、为更强一剑而握刀，动机皆系于"刃"
`.trim();

const WORLDVIEW_STYLE = `
- 语调：庄重、史诗、带剑戟相交的肃杀与传奇腔
- 用一段"传说兵器的来历"开场定调（魔剑因何而生、为祸几何、谁在追寻）
- 世界观为"持械对决"提供合理性：不同文明的兵器与武道为何狭路相逢
- 史实可借鉴但服务戏剧张力，奇幻元素围绕兵器展开
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 传说兵器的设定须一两段讲清来历与影响，避免冗长世界史拖节奏
- 各阵营/文明须可辨识（兵器、武道、服饰各异），为对决提供天然张力
- 奇幻元素须围绕"武器"收束，不让世界观失焦于无关支线
`.trim();

const CHARACTER_ARCHETYPE = `
# 武器格斗角色原型（人剑合一的持械斗士）
- 核心是"剑客群像"：各国武者各持一类兵器（刀/剑/枪/斧/双节棍），武器定义战斗个性
- 武器即角色的延伸：性格与武器气质相呼应（重剑沉稳、双刀诡谲、长枪孤高）
- 每名斗士三件套：标志性兵器与流派、一句握刃信条、与传说兵器的瓜葛（追寻/守护/被诅咒）
- 阵营立场鲜明：骑士的荣誉、武士的道、维京的狂、忍者的隐，文明气质各异
- 宿敌建立在"刃"上：为同一把魔剑而战的对手，是天然的命运纠缠
`.trim();

const CHARACTER_STYLE = `
武器格斗角色塑造：以"人剑合一"立人——兵器的形态与气质即角色性格的外化。
信条台词要有武道庄重感，动机皆可回溯到那把刃。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色须与其兵器气质统一，避免性格与武器脱节
- 阵营/文明辨识度优先，避免武道流派雷同
- 宿敌/执念须落到"武器"上，在对决中兑现命运纠缠
`.trim();

const ITEM_DATABASE_STYLE = `
# 武器格斗兵器图鉴（传说武器 / 兵器档案）
- 核心是"传说兵器"：少量驱动剧情的命运之刃（魔剑/圣剑/王器），各有名号、来历与诅咒
- 普通兵器分类成谱：按刀/剑/枪/斧/拳套等门类，记录形制、流派与代表持有者
- 武器档案五要素：名号、外形特征、传说来历、附带的力量或代价、当前持有者
- 兵器与角色绑定：图鉴条目可呼应角色，体现"武器即角色延伸"
- 为版本扩充留口：新传说兵器/新武器门类可作为新内容轻量接入
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 传说兵器须数量克制且分量十足，每件都要有名号与来历，避免泛滥
- 兵器图鉴须服务剧情与角色辨识，不堆砌无叙事意义的数值条目
- 武器的力量须有代价或限制，避免无脑神器破坏戏剧张力
`.trim();

export const FGT_WEAPON_SKILL: NarrativeSkill = {
  genreCode: "fgt-weapon",
  tier: "tier3",
  matchKeywords: ["武器格斗", "灵魂能力", "荣耀战魂"],
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

registerSkill(FGT_WEAPON_SKILL);
