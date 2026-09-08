/**
 * rhy-narrative — 品类叙事包（Phase 4F 轻量叙事型）
 *
 * 叙事音游 = 叙事中等。精简链：[世界观 → 角色 → 故事框架]
 *   音乐与剧情同构：节奏即情绪，关卡推进即叙事推进。
 *   代表作：Hi-Fi Rush / 节奏医生 / Sayonara Wild Hearts。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 叙事音游世界观原型（一切都踩在节拍上的世界）
- 世界本身"有节奏感"：环境、敌人、机关都随 BGM 律动，节拍是世界的物理法则
- 设定常带流行文化/赛博/卡通的高彩度风格，视觉与音乐风格高度统一
- 用"乐章/章节"组织世界推进：每个区域对应一首主题曲与一种情绪
- 世界冲突常被音乐化隐喻（噪音 vs 旋律、失控的节奏 vs 和谐的合奏）
- 关卡空间为音乐表演服务：场景转换、镜头运动都卡在鼓点上
`.trim();

const WORLDVIEW_STYLE = `
- 语调：明快、有律动感，叙事文字本身要带节奏与韵脚
- 每个区域用一首曲子定情绪（燃 / 萌 / 燃情 / 释然），世界观跟着曲风走
- 强调"音画同步"：描述场景时同时点出此刻的节拍与音色
- 冲突与情绪转折要与音乐段落（前奏 / 副歌 / 桥段 / 高潮）对齐
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界观每个要素都要能"被演奏"：无法转化为节奏体验的纯设定要砍掉
- 章节情绪曲线必须与曲目结构匹配（不能在副歌高潮处安排低落叙事）
- 视觉/音乐风格须全程统一，避免风格断层破坏沉浸的律动感
`.trim();

const CHARACTER_ARCHETYPE = `
# 叙事音游角色原型（自带主题曲的表演者）
- 主角充满活力、有强烈律动人格：动作、说话都像在打拍子
- 每个重要角色配一个"音乐主题/动机"：登场即响起其专属旋律或音色
- 反派/对手常是"节奏的破坏者"，与主角的对抗即音乐风格的对抗
- 角色情感转折通过曲风切换外化（从独奏到合奏 = 从孤独到伙伴）
`.trim();

const CHARACTER_STYLE = `
叙事音游角色塑造：让角色"有声音特征"——一段动机旋律、一种节奏型，比长篇背景更能立住角色。
对白轻快俏皮，情绪靠音乐承托，台词点到为止。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色情绪必须能被音乐表达，避免依赖大段静态独白
- 角色专属主题在关键战/关键场反复回响，强化记忆与情感锚点
- 不让角色塑造打断节奏体验；过场要短、要踩拍
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 叙事音游故事框架（乐章即叙事）
推荐 L0 框架按"曲目歌单"铺设：
- 把整条故事线切成若干乐章，每章 = 一首曲子 + 一段情绪 + 一个剧情节点
- 单章节拍：前奏（铺陈处境） → 主歌（推进冲突） → 副歌（情绪/战斗高潮） → 尾奏（落点/转场）
- 剧情推进与玩法推进严格同步：打通一首曲子 = 推进一段剧情
- 全局情绪曲线像一张专辑：起、承、转、合，最终曲为情感总爆发
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 叙事节点必须落在音乐结构的关键点上（副歌处给高潮，桥段处给转折）
- 故事篇幅服从音游节奏：用最少文字交代情境，把情绪交给音乐
- 高潮曲目须同时是玩法难度与情感强度的双高点
`.trim();

export const RHY_NARRATIVE_SKILL: NarrativeSkill = {
  genreCode: "rhy-narrative",
  tier: "tier2",
  matchKeywords: ["叙事音游", "hi-fi rush", "节奏医生", "rhythm doctor", "音乐叙事", "节奏动作", "sayonara wild hearts"],
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "story_framework",      // ④ L0（乐章歌单）
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

registerSkill(RHY_NARRATIVE_SKILL);
