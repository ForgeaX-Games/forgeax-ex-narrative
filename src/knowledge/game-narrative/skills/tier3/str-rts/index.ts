/**
 * str-rts — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 即时策略 = 叙事中等。精简链：[世界观 → 角色 → 故事框架]
 *   叙事以"战役任务简报"形态嵌入关卡，指挥官口吻、双阵营视角。
 *   代表作：星际争霸 / 帝国时代 / 红色警戒 / 命令与征服。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# RTS 世界观原型（多阵营对抗的战争沙盘）
- 三方/多方势力鼎立结构：每个阵营有独立科技树、单位风格与意识形态（如人族/虫族/神族）
- 世界处于全面战争状态：资源争夺、战线推进、据点攻防是叙事天然驱动力
- 用"战区/星区/编年史"组织世界：地图即战场，每张地图对应一次战役任务
- 阵营间存在不可调和的根本矛盾（生存、信仰、资源、统治权）
- 设定为高烈度冲突提供合理性：科技代差、种族特性、战争机器的运转逻辑
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷峻、军事化，带战争编年史的厚重感
- 用阵营宣传口吻分别陈述各方"正义"，让玩家在不同战役里切换立场认同
- 世界观服务于战术多样性：不同阵营的单位/科技差异本身就是叙事差异
- 多写战略态势（战线、补给、威胁评估），少写私人化抒情
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 各阵营必须势均力敌且立场自洽，不预设唯一"绝对正义方"
- 世界观要能拆解为一连串可独立游玩的战役任务，避免强线性绑死
- 科技/单位设定与叙事描述须一致（叙事里的强兵在机制上也要可信）
`.trim();

const CHARACTER_ARCHETYPE = `
# RTS 角色原型（指挥官与阵营领袖）
- 玩家化身常是"指挥官/将军"：通过任务简报接收命令，是战役的执行者视角
- 各阵营领袖性格符号化：铁腕统帅、狂热信徒、冷酷战略家、悲情英雄
- 关键角色多通过"简报室对话 + 战役过场"露面，而非长篇个人线
- 阵营叙事切换时，上一战役的"敌人"可能成为下一战役玩家操控的领袖
`.trim();

const CHARACTER_STYLE = `
RTS 角色塑造：角色主要在任务简报与过场中出场，用简短有力的指挥口吻和战略判断立人设。
台词要像军令与战报，干练、有压迫感，少私人情绪、多使命驱动。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色塑造服从战役节奏：简报段落精炼，绝不拖慢进入战场的速度
- 多阵营领袖须各具辨识度，避免"换皮指挥官"
- 角色的战略决策要能在关卡目标中体现（说要奇袭，关卡就给奇袭路线）
`.trim();

const STORY_FRAMEWORK_STYLE = `
# RTS 故事框架（战役任务简报式）
推荐 L0 框架按"战役 → 任务链"铺设：
- 以阵营为单元划分战役（Campaign），每个战役是一条独立故事线
- 单任务节拍：任务简报（战略背景+目标） → 战场过场（开局态势） → 战斗 → 战后简报（战果+剧情推进）
- 双/多阵营视角：同一场战争从不同阵营各打一遍，互为镜像补全全貌
- 用"指挥官口吻"贯穿：玩家始终是被赋予任务、向上级复命的执行者
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 每个任务必须有清晰的战略目标与失败条件，叙事不能模糊关卡指令
- 简报式叙事要短：背景交代服务于"为什么打这一仗"，不堆砌世界设定
- 跨阵营战役线的同一事件须前后呼应（A 阵营的胜利 = B 阵营战役里的败因）
`.trim();

export const STR_RTS_SKILL: NarrativeSkill = {
  genreCode: "str-rts",
  tier: "tier3",
  matchKeywords: ["rts", "即时策略", "星际争霸", "帝国时代", "红警", "红色警戒", "命令与征服", "魔兽争霸"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "story_framework",      // ④ L0（战役任务链）
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

registerSkill(STR_RTS_SKILL);
