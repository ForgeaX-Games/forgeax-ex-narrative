/**
 * puz-physics — 品类叙事包（物理解谜 / Physics Puzzle）
 *
 * 轻叙事（5-15%）：轻松诙谐的物理沙盒，可爱呆萌主角，
 *   低对白、靠肢体喜剧与物理意外讲故事。
 *   代表作：人类一败涂地 / 糖豆人 / 割绳子。
 *
 * 链：[世界观 → 角色]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 物理解谜世界观原型（欢乐的物理游乐场）
- 母题是"软乎乎的世界"：一切都遵循夸张而可爱的物理法则，跌倒、弹飞、垮塌都是乐趣
- 世界是一座主题游乐场：奇趣关卡像一道道脑洞道具题，氛围明亮、色彩糖果化
- 叙事极轻：一个简单可爱的小目标（回家、吃到糖、闯过障碍）就足以串起全程
- 意外即叙事：物理系统制造的滑稽失败与神奇成功，本身就是最好笑的"剧情"
- 关卡即段子：每关是一个独立的小情景喜剧，靠机关与环境制造笑点
`.trim();

const WORLDVIEW_STYLE = `
- 语调：轻松、诙谐、温暖治愈；不严肃、不说教，主打陪伴式欢乐
- 几乎无文字叙事：靠场景设计、物理意外与角色动作自然产生笑点
- 世界观服务于"折腾"：要让玩家乐于失败，每次翻车都笑出声
- 视觉上鲜艳呆萌，营造无压力、人人可玩的派对氛围
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 绝不沉重严肃：基调永远轻快可爱，杜绝复杂世界观与黑暗主题
- 叙事须极简：一个看得懂的小目标即可，不堆砌设定与对白
- 世界须放大物理乐趣，禁止削弱"软体翻车"式的滑稽手感
- 笑料靠环境与动作产生，而非文本笑话
`.trim();

const CHARACTER_ARCHETYPE = `
# 物理解谜角色原型（呆萌软乎乎的小主角）
- 主角：软体/圆滚滚的可爱小人，动作笨拙摇晃，天生自带喜感
- 几乎无台词：靠夸张的肢体语言、表情与翻车反应传达情绪，肢体喜剧大于对白
- 性格简单讨喜：天真、执着、爱瞎折腾，让玩家一眼就想抱抱它
- 多人即角色：派对场景里一群小人互相绊倒推挤，群体闹剧就是最大的角色魅力
- 形象高度可爱化、易模仿，便于成为表情包式的记忆符号
`.trim();

const CHARACTER_STYLE = `
物理解谜角色塑造：用呆萌外形 + 笨拙的肢体喜剧立住一个让人会心一笑的小主角。
不靠台词靠动作——一次摇摇晃晃的攀爬、一记狼狈的摔倒，就胜过千言万语。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角必须呆萌讨喜、辨识度高，形象简单到能一眼记住
- 情绪表达靠肢体与表情，严禁依赖大段对白
- 性格保持单纯欢乐，杜绝复杂内心戏拖慢轻松节奏
- 角色服务于"看它翻车很好笑"的喜剧内核，强化可爱与滑稽
`.trim();

export const PUZ_PHYSICS_SKILL: NarrativeSkill = {
  genreCode: "puz-physics",
  tier: "tier3",
  matchKeywords: ["物理解谜", "人类一败涂地", "割绳子"],
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

registerSkill(PUZ_PHYSICS_SKILL);
