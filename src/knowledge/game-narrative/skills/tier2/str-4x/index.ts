/**
 * str-4x — 品类叙事包（4X 策略 / eXplore-eXpand-eXploit-eXterminate）
 *
 * 4X 策略 = 涌现叙事型。叙事由「星际多文明 + 科技与外交奇遇」在探索-扩张的循环中涌现，
 * 弱主线、强动态银河事件（群星 / 无尽空间 / 旧世界 一脉）。
 *
 * 涌现叙事链（通用前驱之后）：世界观 → 角色丰满 → 剧情生成
 *
 * C3（2026-08）已封存：原品类特化的 emergent_event step 吸收进通用 plot_generation，
 * 事件分类配比/触发平衡守则改由 plot_generation 的 style_guide / constraints 槽位承载，
 * 形态差异交给 network/emergent/fragmented 三张结构卡区分。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 4X 策略 世界观原型（"未知银河的多文明拓荒"）
- 世界 = 待探索的星海：星系、虫洞、异常点、远古遗迹构成层层揭开的未知
- 多物种文明并存：每个种族有独特生物学/伦理观/政体，决定其扩张与外交风格
- 四循环驱动：探索(揭图) → 扩张(殖民) → 开发(经济科技) → 征服(战争外交)环环相扣
- 远古谜团：先驱者遗产、休眠造物主、星门网络——为中后期投下文明级威胁与机遇
- 银河格局动态演化：联邦、霸权、危机降临，势力版图随玩家与 AI 的角力重绘
`.trim();

const WORLDVIEW_STYLE = `
- 语调：科幻史诗 + 拓荒浪漫，兼顾银河尺度的宏大与初次接触的惊奇
- 开局聚焦"未知的诱惑"：留白的星图本身就是叙事钩子
- 用异常点/遗迹/信号作为"探索奖励叙事"，让每次揭图都可能掀开一段微故事
- 中后期须升格威胁尺度：从邻邦摩擦走向银河级危机（天灾舰队/AI 觉醒）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把银河写成静态背景板；星图须随探索与殖民动态生长
- 每个异星文明须有可感知的"伦理/政体标签"，影响其外交与战争逻辑
- 至少埋设 1 个银河级远古谜团，并预留分阶段揭露的事件接口
- 不预设单一胜利；须同时为征服/科技/外交/星门多路径供给空间
`.trim();

const CHARACTER_ARCHETYPE = `
# 4X 策略 角色原型（文明 = 物种人格 + 领袖意志）
- 异星领袖：以物种特质 + 政体倾向塑造，谈判桌上各有腔调与底线
- 玩家文明：由初始物种特性 + 玩家的伦理抉择(屠戮/同化/共荣)逐步定型
- 派系/政党：文明内部的政治力量，影响国策走向与内政事件
- 远古实体 / 觉醒帝国：超然于常规外交的"叙事级"角色，言行带神秘与压迫感
`.trim();

const CHARACTER_CONSTRAINTS = `
- 异星领袖的外交逻辑须根植于其物种伦理（排外/狂热/和平主义），可被玩家研判
- 玩家文明的"文明气质"由治理抉择累积，禁止预设道德立场
- 远古/觉醒实体须保持信息不对称的压迫感，不可降格为普通邻邦
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 4X 策略 涌现事件池（分类配比）
- 探索/奇遇事件（约 30%）：异常点研究、遗迹开启、星图秘闻——探索循环的叙事奖励
- 外交事件（约 22%）：联邦组建、附庸归化、最后通牒、星际谴责——多文明张力
- 科技/觉醒事件（约 18%）：危险科技抉择、AI 反叛、心灵飞升——科技路线的代价与机遇
- 危机/战争事件（约 18%）：银河天灾、虫群入侵、要塞陷落——升格的文明级威胁
- 内政事件（约 12%）：派系崛起、殖民地骚乱、伦理两难公投——文明内部的戏剧
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 探索事件须与"已揭图区域 + 科技水平"挂钩，制造"越探索越深"的节奏
- 银河级危机须有跨多回合的前兆铺垫，给玩家与 AI 共同应对的窗口
- 危险科技/觉醒抉择须呈现"高收益 vs 高风险"的真实赌注，后果不可逆
- 每个抉择须改写银河状态（外交态度/星图/科技树），并对各文明可见
- 弱势文明给"逆袭遗产"机遇，霸权文明承受"群起围攻"压力，维持多极张力
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 科幻档案口吻：以星际观测报告 / 文明编年的笔触陈述事件
- 描绘未知的惊奇与不安，给探索保留"看不透"的余味
- 异星视角发言带物种伦理的异质感，让外交事件有"非人"的张力
- 银河级事件给宇宙尺度的远景注脚，凸显文明的渺小与抉择的分量
`.trim();

export const STR_4X_SKILL: NarrativeSkill = {
  genreCode: "str-4x",
  tier: "tier2",
  matchKeywords: ["4x", "群星", "无尽空间", "旧世界", "Stellaris", "Endless Space", "星际策略"],
  narrativeSteps: ["worldview", "character_enrichment", "plot_generation"],
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
        style_guide: "4X 策略角色塑造：文明 = 物种人格 + 领袖意志，外交逻辑根植物种伦理；玩家文明由治理抉择定型气质。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    // C3：原 emergent_event（涌现事件池）吸收进通用 plot_generation
    plot_generation: {
      slots: {
        style_guide: EMERGENT_STYLE,
        constraints: `${EMERGENT_CATEGORY_RULES}\n\n${EMERGENT_BALANCE_RULES}`,
      },
    },
  },
};

registerSkill(STR_4X_SKILL);
