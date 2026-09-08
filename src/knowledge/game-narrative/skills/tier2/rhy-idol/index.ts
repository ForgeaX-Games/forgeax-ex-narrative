/**
 * rhy-idol — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 偶像/乐团音游 = 叙事中等。精简链：[世界观 → 角色 → 故事框架]
 *   偶像养成 + 团队羁绊 + 演出/活动剧情；叙事承托角色魅力与陪伴感。
 *   代表作：BanG Dream! / 世界计划 / 偶像大师 / LoveLive。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 偶像音游世界观原型（青春舞台的日常）
- 世界尺度贴近现实校园/都市：练习室、Live House、文化祭、街头舞台
- 以"团体"为单位组织世界：多支偶像/乐团各有风格、人设与代表色
- 时间围绕"演出与活动"循环：日常练习 → 准备演出 → 登台 → 复盘成长
- 设定弱奇幻、强生活感：梦想、汗水、伙伴、挫折与重新站起是主母题
- 世界对每支团体都给出"出道动机"与"目标舞台"（武道馆 / 全国大赛 / 顶点演出）
`.trim();

const WORLDVIEW_STYLE = `
- 语调：青春、热血又细腻，带闪光的日常感
- 用"季节 + 活动"组织时间线（夏日 Live、文化祭、跨年演出）
- 多团体并存时，各团风格要鲜明区隔（清纯 / 摇滚 / 华丽 / 元气）
- 强调"舞台是梦想的具象"：每次登台都是一次情感兑现
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 冲突保持青春系尺度：误会、瓶颈、分歧，最终都能靠羁绊化解，不写黑暗向
- 世界观要给每支团体一个"为何组团"的初心，作为活动剧情的情感源
- 演出/活动须可独立成篇，便于持续更新的活动剧情扩展
`.trim();

const CHARACTER_ARCHETYPE = `
# 偶像音游角色原型（养成 + 群像羁绊）
- 角色以"团体成员"群像呈现：每团 4-6 人，分担队长/门面/担当等定位
- 每名成员三件套：鲜明人设标签、个人梦想/烦恼、与队友的羁绊关系
- 成长是核心：从生涩到成熟、从个人到团队，是养成线的情感曲线
- 角色间的"羁绊"是叙事引擎：友情、竞争、和解、互相扶持
`.trim();

const CHARACTER_STYLE = `
偶像音游角色塑造：每个成员都要"可被偏爱"——清晰的萌点、真实的烦恼、与他人的化学反应。
日常对白生活化、轻松，演出/关键时刻则给真挚的成长独白。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 群像须均衡：避免单一主角独大，每个成员都要有高光与个人剧情份额
- 羁绊关系要在活动剧情中持续兑现（成员间的小故事推动情感升温）
- 角色成长必须可见：人设可保持，但心境与团队默契随剧情递进
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 偶像音游故事框架（主线养成 + 活动剧情双轨）
推荐 L0 框架按"养成主线 + 活动单元"铺设：
- 主线：组团 → 初次登台 → 遭遇瓶颈/分歧 → 突破 → 站上目标舞台
- 活动剧情：以节日/演出/团体合作为单元，短小独立，主打羁绊与日常萌点
- 单段节拍：日常起因 → 排练中的小冲突 → 演出前的情绪转折 → 登台高光 → 成长落点
- 演出场景是情感高潮锚点：把累积的羁绊在舞台上一次释放
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 活动剧情须可脱离主线独立阅读，便于长期运营持续更新
- 每段剧情都要落到一次"演出/成长瞬间"，避免日常堆砌而无情感兑现
- 团队羁绊是叙事红线：每个故事至少推进一对成员关系或团队整体默契
`.trim();

export const RHY_IDOL_SKILL: NarrativeSkill = {
  genreCode: "rhy-idol",
  tier: "tier2",
  matchKeywords: ["偶像音游", "偶像", "乐团音游", "bang dream", "邦邦", "世界计划", "プロセカ", "偶像大师", "lovelive", "养成"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "story_framework",      // ④ L0（养成主线 + 活动剧情）
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

registerSkill(RHY_IDOL_SKILL);
