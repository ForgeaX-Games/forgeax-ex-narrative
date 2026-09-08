/**
 * fgt-anime — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 动漫格斗 = 叙事轻量（叙事占比 10-20%）。链：[世界观 → 角色]
 *   还原动漫原作、复刻名场面、粉丝向叙事：让玩家"亲手重演"漫画/动画里的对决。
 *   代表作：龙珠斗士Z / 火影忍者：究极风暴。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 动漫格斗世界观原型（忠于原作的还原舞台）
- 核心前提：高度还原原作世界（忍界/赛亚人宇宙/海贼世界），玩家熟悉度即叙事地基
- 剧情走"原作章节复刻"：以原作的关键战役/篇章为骨架，重走名场面
- 世界观无需重建：尊重原设定的力量体系、地理、势力，做"高保真还原"而非原创
- 名场面即叙事节点：经典对决、转折、燃点逐一复刻为可玩桥段
- 为粉丝服务：彩蛋、原作台词、原画分镜的致敬密度越高越好
`.trim();

const WORLDVIEW_STYLE = `
- 语调：忠实原作的热血/燃向，贴合该 IP 的既有调性
- 用"原作篇章导览"组织世界：以读者/观众熟悉的剧情节点串场
- 世界观服务于"重演名场面"，把篇幅留给必杀技演出与对决
- 尊重原作设定，改编点到为止，优先粉丝的情怀满足
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 须高度忠于原作设定，严禁与原作力量体系/世界观冲突的魔改
- 世界观以"还原 + 导览"为主，不重建无关原创设定
- 名场面复刻须精准，篇章顺序与原作呼应，避免逻辑错乱
`.trim();

const CHARACTER_ARCHETYPE = `
# 动漫格斗角色原型（原作角色的高保真还原）
- 核心是"还原原作角色"：性格、口癖、招式、立场必须贴合粉丝记忆
- 必杀技即演出灵魂：标志性招式（龟派气功/螺旋丸式）要有夸张过场与名台词
- 羁绊与名场面：师徒、宿敌、伙伴关系是原作情感核心，对战中复刻经典对白
- 角色形态/变身要尊重原作设定（超级形态、瞳术、爆发态），作为战力与演出爽点
- 背景借力原作：无需重写前史，唤起玩家已有的情感记忆即可
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色还原度优先：性格/招式/台词须忠于原作，禁止违和的二次创作
- 必杀技演出与名台词须精准复刻，承担粉丝情怀的核心兑现
- 羁绊/宿敌关系须在对战中以原作名场面方式呈现
- 变身/形态须遵循原作设定逻辑，不无中生有破坏体系
`.trim();

export const FGT_ANIME_SKILL: NarrativeSkill = {
  genreCode: "fgt-anime",
  tier: "tier3",
  matchKeywords: ["动漫格斗", "龙珠斗士z", "火影忍者"],
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
        style_guide: "动漫格斗角色塑造：高保真还原原作角色的性格/招式/台词，必杀技演出与名场面复刻是粉丝情怀核心，羁绊宿敌在对战中以原作方式呈现。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
  },
};

registerSkill(FGT_ANIME_SKILL);
