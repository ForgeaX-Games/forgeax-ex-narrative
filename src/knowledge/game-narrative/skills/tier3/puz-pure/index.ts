/**
 * puz-pure — 品类叙事包（纯机制解谜 / Pure Puzzle）
 *
 * 极轻叙事（5-15%）：无明确角色与对白，靠极简留白世界观、
 *   环境隐喻与符号传达意境。叙事是氛围而非情节。
 *   代表作：见证者 The Witness / Opus Magnum / Baba Is You。
 *
 * 链：[世界观]（仅一个 step）
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 纯解谜世界观原型（留白的意境之境）
- 母题是"无人之境"：一座荒岛、一片抽象空间、一台古老机器，世界静默而自洽
- 没有角色与剧情，世界本身即谜题——规则就是叙事，理解机制即抵达"真相"
- 环境隐喻承载意义：景物、光影、几何符号暗示一种关于认知、秩序或存在的哲思
- 进度即顿悟：玩家在解谜中逐步领会世界的底层逻辑，叙事是一场"看见"的体验
- 极简留白美学：用空旷与沉默营造冥想氛围，少即是多，意境大于信息
`.trim();

const WORLDVIEW_STYLE = `
- 语调：静谧、抽象、富于哲思；冷静克制，靠氛围而非文字传达
- 几乎不用对白与文本：让符号、规则与环境自己说话，留白即邀请玩家思考
- 意境优先：营造"安静地领悟某种秩序"的体验，而非讲述一个故事
- 可埋隐喻层：表层是机制谜题，深层暗示关于感知、真理或自由意志的母题
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 绝不引入明确角色、对白或线性剧情，叙事只存在于氛围与符号中
- 严禁说教式文本：意义须靠玩家自行从环境与规则中体悟
- 世界须高度自洽：机制即世界法则，规则的一致性就是叙事的可信度
- 保持极简留白，杜绝信息堆砌破坏冥想式的纯净体验
`.trim();

export const PUZ_PURE_SKILL: NarrativeSkill = {
  genreCode: "puz-pure",
  tier: "tier3",
  matchKeywords: ["纯解谜", "见证者", "opus magnum"],
  narrativeSteps: ["worldview"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
  },
};

registerSkill(PUZ_PURE_SKILL);
