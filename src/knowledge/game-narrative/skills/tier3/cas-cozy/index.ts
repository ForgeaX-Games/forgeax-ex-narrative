/**
 * cas-cozy — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 治愈系 = 叙事为点缀。精简链：[世界观 → 角色]
 *   叙事不承担冲突推进，只负责氛围托底与"小确幸"情绪闭环。
 *   代表作：Unpacking / A Short Hike / 短途旅行 / cozy 系独立作。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 治愈系世界观原型（一个"足够安全"的小世界）
- 空间尺度刻意收缩：一间出租屋 / 一座小岛 / 一条短途徒步路线，而非宏大大陆
- 世界设定里"没有恶意"：没有反派、没有末日、没有不可挽回的失去
- 时间是温柔的：四季更替、午后斜阳、一封慢慢寄到的信，节奏由生活事件而非战斗驱动
- 用日常物件承载记忆：搬家纸箱、旧照片、晾在阳台的衣物——物即是叙事
- 世界对玩家始终包容：迷路也会被指引，失败没有惩罚，只有"再来一次"的余地
`.trim();

const WORLDVIEW_STYLE = `
- 语调：松弛、温暖、不催促；像一个深呼吸而非一次冒险召唤
- 第一段就给玩家"可以安心待着"的信号（一处可反复回来的家 / 据点）
- 避免戏剧化的冲突钩子，改用"今天想做点什么"的开放式邀请
- 多写五感细节（光线、气味、温度、声响），少写世界观设定数值
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁引入死亡威胁、暴力、时间压迫或道德两难等紧张源
- 不设"必须拯救的危机"；世界的"问题"最多是"有点乱、有点孤单、有点没整理好"
- 任何冲突都必须可被一个温柔的小行动化解，不留创伤后遗
`.trim();

const CHARACTER_ARCHETYPE = `
# 治愈系角色原型（陪伴者，而非对手）
- 主角通常是"刚到一处新生活"的普通人：搬家、返乡、独居、慢下来的旅人
- 周边角色都是善意的：邻居、店主、偶遇的旅伴，每人给一点温度而不索取
- 角色"成长"不是变强，而是和解：与过去、与孤独、与某段未说出口的情绪
- 允许角色有淡淡的怅惘（搬离旧居、告别故人），但底色始终是被治愈
`.trim();

const CHARACTER_STYLE = `
治愈系角色塑造：每个角色都像一杯递到手边的热饮——出现是为了让玩家更松弛，而非制造目标压力。
对白短、真诚、留白多；用一句关心代替一段任务说明。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色不得有攻击性动机或欺骗反转；信任在治愈系里是默认前提
- 不强加"必须帮助某人完成大事"的负担式任务，互动应是邀请而非义务
- 角色的私人情绪可以淡淡流露，但不得演变为需要玩家承担的沉重责任
`.trim();

export const CAS_COZY_SKILL: NarrativeSkill = {
  genreCode: "cas-cozy",
  tier: "tier3",
  matchKeywords: ["治愈", "治愈系", "cozy", "unpacking", "短途旅行", "a short hike", "慢生活", "温馨", "解压"],
  // 轻量叙事型精简链：仅世界观 + 角色丰富，叙事为氛围点缀
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

registerSkill(CAS_COZY_SKILL);
