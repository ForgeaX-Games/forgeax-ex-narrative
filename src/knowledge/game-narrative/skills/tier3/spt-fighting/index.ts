/**
 * spt-fighting — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 拳击/格斗体育 = 叙事偏轻（10-20%）。链：[世界观 → 角色]
 *   叙事做"洛奇式励志包装"：写实搏击、拳手生涯崛起、宿敌之路、冠军之巅。
 *   代表作：拳击之夜 / UFC / Punch-Out / Rocky 系列。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 搏击世界观原型（写实擂台与冠军之路）
- 世界是写实的职业搏击生态：地下拳馆、商业擂台、卫冕拳王、博彩与媒体
- 核心结构是"晋级阶梯"：从无名拳手打榜，一场场击败排名对手直至冠军挑战赛
- 训练房与擂台是两大舞台：汗水与孤独的备战，对决夜的聚光灯与呐喊
- 底色是写实而残酷的竞技：体重级别、伤病、状态起伏、职业生涯的有限窗口
`.trim();

const WORLDVIEW_STYLE = `
- 语调：硬朗、写实、热血励志，带洛奇式的草根逆袭感
- 用"赛前态势"定调每场对决（双方战绩、风格相克、看点与赌注）
- 世界观服务于"崛起爽感"：每一拳都是向冠军腰带更近一步
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 保持写实搏击质感，避免超能力化的夸张设定
- 训练与对决的因果要可信（练什么，擂台上就该见效）
- 世界观服务于拳手个人弧线，不堆无关宏大设定
`.trim();

const CHARACTER_ARCHETYPE = `
# 拳手角色原型（崛起者与宿敌）
- 主角是草根拳手：出身平凡、心怀冠军梦，靠苦练与意志一路向上
- 围绕主角的群像：严厉教练、并肩拳友、傲慢卫冕冠军、命中注定的宿敌
- 宿敌是叙事引擎：从被碾压到势均力敌，再到决战巅峰的多次交锋
- 性格立体但不冗长：一个动机（为何而战）+ 一段伤痛 + 一句信念即可立人
`.trim();

const CHARACTER_STYLE = `
拳手塑造：用"动机 + 伤痛 + 信念"三笔立人——为谁而战、背负什么、绝不倒下的那句话。
教练与宿敌的台词要短而有力，赛前对峙、赛后致敬都是人物高光。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角弧线要有可感的成长曲线：失败—苦练—再战—登顶
- 宿敌须值得尊敬，避免脸谱化纯恶反派，对决才有分量
- 情感服务于热血励志，点到为止，绝不拖慢训练与对决节奏
`.trim();

export const SPT_FIGHTING_SKILL: NarrativeSkill = {
  genreCode: "spt-fighting",
  tier: "tier3",
  matchKeywords: ["拳击", "ufc"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
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
  },
};

registerSkill(SPT_FIGHTING_SKILL);
