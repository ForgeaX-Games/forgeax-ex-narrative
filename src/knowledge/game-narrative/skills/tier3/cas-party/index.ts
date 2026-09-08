/**
 * cas-party — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 派对游戏 = 叙事极轻（5-15%）。链：[世界观 → 角色]
 *   叙事做"欢乐情境包装"：多人合作/竞争小游戏合集，闹剧基调，强互动弱主线，
 *   合作品类可有温情双人剧情。代表作：胡闹厨房 / It Takes Two / Overcooked。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 派对世界观原型（欢乐情境的小游戏舞台）
- 世界是一组轻量情境拼盘：拥挤厨房、热带岛屿、太空船、糖果工厂任意切换
- 没有沉重主线，世界只为"一起玩闹"提供舞台：场景越混乱越好玩
- 玩法是多人小游戏合集：合作通关或捉对竞争，关卡即一个个搞笑情境
- 合作向品类（如 It Takes Two）可有一条温情主线：两人携手修复关系/闯过难关
`.trim();

const WORLDVIEW_STYLE = `
- 语调：欢乐、闹腾、合家欢，全程零压力的派对气氛
- 用一句话点亮每个情境的笑点（厨房手忙脚乱 / 太空失重乱飘）
- 合作温情向时，给主线一抹真挚暖意，但仍以欢乐为底
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 保持轻松闹剧基调，强互动弱主线，绝不堆复杂剧情
- 情境要利于多人同屏制造混乱与笑料
- 温情线只作点缀（合作向品类），不喧宾夺主盖过玩闹乐趣
`.trim();

const CHARACTER_ARCHETYPE = `
# 派对角色原型（搞怪玩家化身与双人搭档）
- 角色多为萌系/搞怪的可爱化身：造型夸张、表情丰富、动作滑稽
- 性格符号化、互补成趣：莽撞的、慢半拍的、爱抢戏的，凑一起就出笑料
- 合作向可设"双人搭档"：性格相反的两人在磕碰中互补、和解、并肩
- 角色靠肢体喜剧与即时反应立人设，无需厚重背景
`.trim();

const CHARACTER_STYLE = `
派对角色塑造：用夸张造型 + 搞笑反应立剪影，性格互补制造"凑一起就翻车"的喜剧。
合作向搭档可用"相反性格 + 一点真情"立双人关系，台词短促、即时、爆笑。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 辨识度优先：每个角色要有一眼区分的造型与搞笑标签
- 互动与肢体喜剧为主，少写内心独白拖节奏
- 合作温情仅作点缀，欢乐闹剧始终是角色的主基调
`.trim();

export const CAS_PARTY_SKILL: NarrativeSkill = {
  genreCode: "cas-party",
  tier: "tier3",
  matchKeywords: ["派对", "胡闹厨房", "it takes two"],
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

registerSkill(CAS_PARTY_SKILL);
