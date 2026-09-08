/**
 * Gacha RPG (rpg-gacha) — Tier2 运营叙事品类 skill
 *
 * Archetype E（运营叙事），核心：角色收集叙事、赛季故事弧、
 * 角色个人章节、抽卡/召唤 Lore、活动故事。
 *
 * 参考：原神、崩坏：星穹铁道、FGO、明日方舟、蔚蓝档案、碧蓝航线
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# Gacha RPG 世界观原型（"万花筒宇宙"）
- 世界必须有"无限扩展性"——多区域/多维度/多时间线/多势力，可持续添加新内容
- 力量/元素体系是角色量产框架（7元素/8阵营/6职业 → 组合矩阵）
- 核心矛盾是"持续性危机"而非一次性冲突——不可被单个版本解决
- 组织/机构/学院作为角色归属框架（每个组织 = 一组角色的家）
- 世界表面乐观/多彩（商业友好），内层有深度和暗线（留住核心玩家）
- "旅行者/观察者"视角：主角是外来者或串联者，理由充分地与所有角色互动
`.trim();

const WORLDVIEW_STYLE = `
- 语调"轻入口、深出口"：初见时明快可亲，深入后有哲学/情感重量
- 世界设定文案需要"画面感"——每个地区有明确色调/氛围/音乐想象
- 用"旅行见闻"风格引入新区域（主角视角的第一印象）
- 势力介绍兼顾"概念吸引力"和"角色展示位"——让玩家想知道这个组织有谁
- 专有名词兼顾中二感和语义透明度（"虚空万象"比"XK-Ω机关"好）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把世界观写死——任何真相揭示都必须"开启新问题"
- 新区域/新势力加入时不能否定已有设定——只能"补充新侧面"
- 元素/阵营体系必须在第一版就设计完整框架——后续填充但不重构
- 主线推进速度：每版本只推进 10-15% 核心矛盾，留足续写空间
- 预埋至少 5 个"未来版本钩子"（未探索区域/未揭示角色/悬而未决的事件）
`.trim();

const CHARACTER_ARCHETYPE = `
# Gacha RPG 角色原型（"一见钟情"设计法）

角色三层金字塔：
1. 表层吸引（3 秒）：立绘/配色/标志性元素 → "我想要这个角色"
2. 人设确认（30 秒）：性格标签/代表台词/关系定位 → "我喜欢这个角色"
3. 深度绑定（30 分钟）：个人故事/成长弧/隐藏面 → "我理解这个角色"

角色必备要素：
- 一句话人设：20 字以内定调（"表面是懒猫实际是前战术大师"）
- 标志性口癖/动作/习惯：让玩家可以模仿/复读
- 内心反差：公开形象 vs 真实自我的落差（反差萌/反差痛）
- 至少 2 条关系线：与已有角色的确切关系（同事/宿敌/暗恋/师徒）
- 1 个情感创伤：个人故事的核心驱动力（失去/背叛/遗憾/孤独）
`.trim();

const CHARACTER_CONSTRAINTS = `
- 禁止两个同期上线角色有相似人设定位——差异化是第一原则
- 角色动机/创伤不能重复套路——每位必须有"只属于自己"的痛点
- 反差设计必须合理（不是为了反差而反差）——要能从角色经历中推导
- 角色强度(meta)不应影响叙事质量——冷门角色也值得精彩故事
- 角色个人线结局必须给予情感回报——但不关闭所有可能性（留续写空间）
`.trim();

const QUEST_GENERATION_STYLE = `
# Gacha RPG 任务/活动叙事

## 角色传记（Character Story）
标准 5 章结构：
- 第1章「邂逅」：角色日常展示 + 与主角的初次互动 → 建立第一印象
- 第2章「表面之下」：发现角色不为人知的侧面 → 好奇心钩子
- 第3章「过去的影子」：创伤/秘密揭示 → 情感连接
- 第4章「共同面对」：并肩解决问题 → 关系升温/信任建立
- 第5章「新的日常」：关系确认 + 角色微妙变化 → 情感回报

每章时长：3-5 分钟阅读，紧凑不拖沓。

## 赛季主线
- 每赛季（6-8周）有完整"起承转合"
- 聚焦 2-3 位当赛季 UP 角色的深度展示
- 结尾制造"下赛季悬念"——但本赛季故事必须有阶段性满足

## 活动故事
- 节日活动：轻松日常向，展示角色可爱/搞笑面（粉丝向）
- 剧情活动：推进世界观/角色关系的一次性故事（质量与主线齐平）
- 联动活动：联动角色有独立叙事框架，不破坏本世界观完整性

## 每日/支线
- 单次 < 2 分钟，世界观填充 + 角色日常
- 可以回应社区热门话题/梗（适度 meta）
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 角色传记禁止变成"设定资料集"——必须是"可体验的故事"而非"可阅读的资料"
- 赛季主线禁止让非 UP 角色抢戏——新角色展示优先级最高
- 活动故事不得与主线产生矛盾/时间线冲突
- 每章必须有"只在这一章才能看到的独特互动"——不能是流水线模板
- 角色传记最终章不能写成BE——运营游戏的角色叙事需要"向前看"
`.trim();

export const GACHA_RPG_SKILL: NarrativeSkill = {
  genreCode: "rpg-gacha",
  tier: "tier2",
  matchKeywords: [
    "Gacha", "抽卡", "二次元RPG", "手游RPG",
    "原神", "Genshin", "崩坏", "Star Rail", "星穹铁道",
    "FGO", "Fate/Grand Order", "明日方舟", "Arknights",
    "蔚蓝档案", "Blue Archive", "碧蓝航线",
    "角色收集", "赛季更新", "卡池",
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
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    quest_generation: {
      slots: {
        style_guide: QUEST_GENERATION_STYLE,
        constraints: QUEST_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(GACHA_RPG_SKILL);
