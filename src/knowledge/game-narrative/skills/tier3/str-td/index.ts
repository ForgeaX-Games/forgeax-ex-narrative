/**
 * str-td — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 塔防 = 叙事偏轻（10-25%）。链：[世界观 → 角色 → 道具]
 *   叙事做"守护战役包装"：守家园/王国、入侵敌潮、防御塔拟人，轻幽默或史诗守城。
 *   代表作：王国保卫战 / 保卫萝卜 / 植物大战僵尸 / Bloons TD。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 塔防世界观原型（守护家园的防线战役）
- 核心母题是"守护"：家园/王国/最后据点面临一波波入侵者的冲击
- 世界以"关卡地图"为单位：每张地图是一条必守的进军路线，地形即战术
- 敌人以"敌潮"形态登场：成群、有节奏、越来越强，每波都是一次防线考验
- 战役推进串联世界：从边境哨站打到王城决战，地图越深、入侵越凶
- 基调可双线：史诗悲壮的守城，或轻松搞怪的萌系保卫战
`.trim();

const WORLDVIEW_STYLE = `
- 语调：可史诗守城的悲壮，也可轻幽默的萌系保家，随题材切换
- 用一句"威胁简报"定调每关（敌潮来源、目标、必守的理由）
- 世界观服务于"层层设防"：地形、路线、要塞本身就是叙事看点
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 守护动机要清晰：玩家始终明白"在守什么、为何不能失守"
- 敌潮设定与关卡机制一致（叙事里的强敌在波次里也要可信）
- 世界观点到为止，不抢"布防—迎敌"的核心节奏
`.trim();

const CHARACTER_ARCHETYPE = `
# 塔防角色原型（守护者与拟人防御塔）
- 角色双层：统筹全局的指挥官/守护者英雄，与拟人化的防御塔单位群像
- 防御塔可拟人化赋予性格：稳重的炮塔、毒舌的法师塔、莽撞的近战兵
- 英雄单位作为可移动的叙事焦点，带一句信念与招牌技
- 入侵方首领可符号化（贪婪魔王、虫群女王、捣蛋反派），给守城一个对手
`.trim();

const CHARACTER_STYLE = `
塔防角色塑造：守护者英雄用一句信念立人，防御塔用拟人化性格 + 招牌一句台词记住。
史诗题材庄重豪迈，萌系题材俏皮搞怪，台词短促、服务于迎敌情绪。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 拟人化防御塔须辨识度优先，避免性格雷同的"换皮塔"
- 角色性格要与其战场功能呼应（毒塔毒舌、重炮憨直）
- 情感点到即止，绝不拖慢布防与迎击的爽快节奏
`.trim();

const ITEM_DATABASE_STYLE = `
# 塔防道具（防御塔/陷阱/升级物）
- 核心是防御塔家族 + 陷阱 + 升级物：箭塔、炮塔、法术塔、减速陷阱、增益符文
- 每件单位一句"功能 + 性格风味"：射程/伤害定位 + 一点拟人化口吻
- 升级线讲究"成长感"：从简陋木塔进化到华丽要塞，视觉与威力同步跃升
- 陷阱与道具强调战术配合：减速 + 范围杀，构成可读的连锁防线
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 每件防御塔/陷阱功能定位一句话说清，避免数值堆砌
- 拟人化风味为辅，绝不盖过其战术功能的清晰度
- 升级物的"成长感"要可感知，外观与威力提升保持一致
`.trim();

export const STR_TD_SKILL: NarrativeSkill = {
  genreCode: "str-td",
  tier: "tier3",
  matchKeywords: ["塔防", "tower defense", "王国保卫战", "保卫萝卜"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "item_database",        // ④ 防御塔/陷阱/升级物
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

registerSkill(STR_TD_SKILL);
