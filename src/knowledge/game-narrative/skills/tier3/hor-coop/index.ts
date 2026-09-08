/**
 * hor-coop — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 多人恐怖 = 叙事为点缀。精简链：[世界观 → 场景]
 *   最少剧情、最大氛围：任务简报交代目标，恐怖由环境与协作压力涌现。
 *   代表作：Phasmophobia(恐鬼症) / GTFO / Lethal Company。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 多人恐怖世界观原型（一份冷冰冰的任务委托）
- 世界观以"任务委托方"框定：神秘公司/机构派遣小队进入危险地点执行作业
- 地点是恐怖的载体：废弃医院、地堡、感染设施、闹鬼宅邸——空间即敌人
- 叙事极简：背景只需交代"你们是谁、为何进来、要带什么出去、有什么在里面"
- 威胁来源保持神秘：不全盘解释怪物/鬼魂的来历，未知本身就是恐惧
- 世界对小队冷漠：没有救援、没有保障，只有合同、报酬与"活着回来"的目标
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷峻、克制、信息匮乏感——像一份被刻意删减的简报
- 用环境碎片叙事（残留笔记、警告标语、前一队的尸体）暗示前史，不正面铺陈
- 强调"未知与孤立"：通讯不畅、地图陌生、规则要靠试错摸索
- 留白优先：解释得越少，玩家脑补的恐惧越大
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严控剧情体量：背景交代不超过一段简报，把篇幅让给氛围与玩法
- 不把怪物/鬼魂的来历讲透，保留核心未知以维持长期恐惧
- 世界观要服务多人协作压力（信息不对称、分工依赖、通讯受限）
`.trim();

const SCENE_GENERATION_STYLE = `
# 多人恐怖场景写作守则（任务简报 + 环境恐怖）
- 每个场景=一次"出勤"：开场给一段简短任务简报（地点、目标、已知风险）
- 用环境塑造恐惧：声音设计（脚步、低吼、寂静）、光照（手电锥形/全黑）、空间（狭窄走廊/未知拐角）
- 制造协作恐怖：把关键信息/道具分散，迫使队员分头行动又彼此依赖
- 节奏靠"安全—探索—遭遇—撤离"的张弛循环驱动，而非剧情转折
- 恐惧高潮来自涌现事件（怪物现身、队友失联、撤离倒计时），不靠脚本演出
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 最少剧情、最大氛围：场景不写长对白与人物弧光，只写处境、威胁与空间
- 简报必须明确目标与失败代价，但绝不剧透场景内的具体威胁
- 恐怖体验须可在多人协作中放大（分离、误判、沟通失效带来的紧张）
- 避免固定脚本式吓人；优先设计"会因玩家行为不同而变化"的环境威胁
`.trim();

export const HOR_COOP_SKILL: NarrativeSkill = {
  genreCode: "hor-coop",
  tier: "tier3",
  matchKeywords: ["多人恐怖", "恐鬼症", "phasmophobia", "gtfo", "联机恐怖", "合作恐怖", "lethal company"],
  narrativeSteps: [
    "worldview",          // ②
    "scene_plan",   // ⑦ 场景（任务简报 + 环境恐怖）
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
        constraints: SCENE_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(HOR_COOP_SKILL);
