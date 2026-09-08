/**
 * fgt-traditional — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 传统格斗 = 叙事轻量（叙事占比 10-20%）。链：[世界观 → 角色]
 *   叙事服务于"世界格斗大赛 + 斗士群像 + 流派对决"的街机式爽感。
 *   代表作：街头霸王 / 铁拳 / 拳皇。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 传统格斗世界观原型（世界格斗大赛的擂台舞台）
- 核心骨架：一场全球性格斗大赛（世界武斗会 / 铁拳大赛 / KOF），把各国斗士汇于同一擂台
- 大赛背后常有暗线：财阀、邪恶组织、宿命家族纷争作为大赛的真正幕后
- 世界以"斗士来源地"组织：各国街头、道馆、军营、地下擂台，地点即角色出身名片
- 流派对立是天然戏剧：空手道 vs 拳击 vs 摔跤 vs 暗杀拳，门派即立场
- 历届大赛构成传承底色：上一代恩怨延续到新一代，冠军头衔即叙事锚点
`.trim();

const WORLDVIEW_STYLE = `
- 语调：热血、街机感、略带漫画式夸张；点到即止，把舞台让给对战
- 用一段"大赛公告 / 邀请函"开场定调（谁主办、赌注是什么、强敌云集）
- 世界观为"擂台对决"提供合理性：为何这些斗士非打不可
- 设定服务于角色登场，避免喧宾夺主的厚重世界史
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 大赛设定须一两段交代清楚，严禁冗长前史拖慢进入对战
- 幕后黑手可有，但不抢角色风头；世界观是斗士群像的背景板
- 各斗士出身地/流派须可辨识，为流派对决提供天然张力
`.trim();

const CHARACTER_ARCHETYPE = `
# 传统格斗角色原型（街机式斗士档案）
- 核心是"斗士群像"：十数名可选角色，各有国籍、流派、招式与性格标签
- 每名斗士三件套：标志性流派/必杀技、一句出场或胜利台词、参赛动机（复仇/证明/守护）
- 性格高度符号化（孤高剑客、热血空手家、傲慢财阀、神秘忍者），便于群像记忆
- 宿敌与传承是灵魂：师徒、世仇、血亲对决（如父子/兄弟同台），制造专属对战张力
- 角色档案街机化：身高体重、出身、喜好、绝招名，像格斗卡牌一样信息浓缩
`.trim();

const CHARACTER_STYLE = `
传统格斗角色塑造：用最少笔墨立住最鲜明的剪影——一种流派、一句台词、一个参赛理由即可定义一名斗士。
台词要适合出场/胜利时喊出口，金句感与气场优先于细腻心理。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 斗士须辨识度优先：流派/造型/口头禅各异，避免性格雷同
- 宿敌/传承关系要在对战中兑现（特定组合有专属对话或胜利演出）
- 不深挖复杂内心戏拖慢节奏；动机一句话讲清即可
`.trim();

export const FGT_TRADITIONAL_SKILL: NarrativeSkill = {
  genreCode: "fgt-traditional",
  tier: "tier3",
  matchKeywords: ["格斗", "街霸", "铁拳", "拳皇"],
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

registerSkill(FGT_TRADITIONAL_SKILL);
