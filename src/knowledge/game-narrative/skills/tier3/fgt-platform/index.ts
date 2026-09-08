/**
 * fgt-platform — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 平台格斗 = 叙事极轻（叙事占比 5-15%）。链：[世界观 → 角色]
 *   弱剧情、强角色辨识度：跨 IP 明星欢乐乱斗，叙事只是混战的搞笑借口。
 *   代表作：任天堂大乱斗 / Brawlhalla。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 平台格斗世界观原型（"凑一桌乱斗"的欢乐借口）
- 核心前提：一个能让无关角色同台的轻框架（玩具世界 / 英灵殿 / 召唤大乱斗），一句话够用
- 世界观是"舞台拼盘"：每个场景致敬一个 IP 或主题，地图即彩蛋集合
- 不追求逻辑自洽：跨次元、跨 IP 混战本身就是卖点，越欢乐越荒诞越好
- 冲突无需深意："谁是最强"的擂台争霸 / 一场永不停歇的派对就足够
- 为版本扩充留口：新角色、新地图随时空降，无需剧情承接
`.trim();

const WORLDVIEW_STYLE = `
- 语调：欢乐、轻松、自嘲式幽默，满是梗与玩家会心一笑的彩蛋
- 世界观一两句带过，把注意力全交给角色登场与混战名场面
- 鼓励打破第四面墙、玩 meta 梗，致敬被乱斗的各路 IP
- 一切服务"开打即乐"，禁止严肃厚重的设定铺垫
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界观须极简，一两句交代清楚为何能同台即可
- 严禁强行逻辑自洽：荒诞混搭是特色，不是 bug
- 场景与设定须服务彩蛋密度与欢乐基调，不承担线性剧情
`.trim();

const CHARACTER_ARCHETYPE = `
# 平台格斗角色原型（高辨识度的明星阵容）
- 角色是绝对核心：辨识度 > 一切，造型/招牌动作/口头梗一眼认出
- 每个角色保留原作灵魂：还原其标志性技能、姿态、口癖，让粉丝会心一笑
- 角色梗与彩蛋驱动：胜利演出、嘲讽动作、登场台词都塞满致敬与玩笑
- 关系靠"梗"而非剧情：跨 IP 角色的反差同框本身就是笑点（萌物 vs 硬汉）
- 背景一句话即可：身份标签到位，深度交给玩家对原作的记忆
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色须以辨识度与还原度为先，禁止背离原作灵魂的魔改
- 背景须极简，靠造型/招牌动作/口头梗立人，杜绝长篇前史
- 角色互动以梗和彩蛋为主，不编织严肃关系网
- 涉及跨 IP 时尊重各角色调性，混搭欢乐但不违和到出戏
`.trim();

export const FGT_PLATFORM_SKILL: NarrativeSkill = {
  genreCode: "fgt-platform",
  tier: "tier3",
  matchKeywords: ["平台格斗", "大乱斗", "brawlhalla"],
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
        style_guide: "平台格斗角色塑造：辨识度压倒一切，靠造型/招牌动作/口头梗一眼认出，保留原作灵魂，互动以梗和彩蛋为主，背景一句话够用。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
  },
};

registerSkill(FGT_PLATFORM_SKILL);
