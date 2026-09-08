/**
 * sim-colony — 品类叙事包（殖民模拟 / Colony Sim）
 *
 * 殖民模拟 = 涌现叙事型（"环世界味"）。叙事由「殖民者的小人物特质 + 心理崩溃事件」涌现：
 * 没有主线，故事来自一群带着性格、爱恨与心理阈值的殖民者，在资源匮乏与意外打击下
 * 相互扶持或彼此崩溃的群像编年（环世界 / 矮人要塞 / 缺氧 一脉）。
 *
 * 涌现叙事链（通用前驱之后）：世界观 → 角色丰满 → plot_generation（涌现事件生成）
 *
 * C3（2026-08）已封存：原品类特化 step `emergent_event` 吸收进通用 `plot_generation`，
 * 本品类的事件分类配比/触发平衡守则改为以 skill 形式挂载在 plot_generation 的
 * style_guide / constraints 槽位上，形态差异交给 network/emergent/fragmented 结构卡表达。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 殖民模拟 世界观原型（"边陲星球上的脆弱聚落"）
- 世界 = 一颗严酷而中立的边陲星球/地底世界：气候、毒雾、贫瘠土地决定生存难度
- 殖民地是叙事核心：从坠机幸存的三人小队，到自给自足的聚落，每一步都岌岌可危
- 资源链如履薄冰：食物、医药、温度、心情环环相扣，一次短缺即可引发连锁崩溃
- 威胁来自四面：海盗突袭、野兽暴走、机械入侵、寒潮与瘟疫，世界从不仁慈
- "讲故事 AI"式的张弛：世界像一位隐形叙事者，在平静与灾难间编排殖民地的命运
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷峻写实 + 黑色幽默，把生存的残酷与荒诞并置（环世界味）
- 开局确立"坠落此地的窘迫起点"与殖民者各自的来历裂痕
- 让资源链的脆弱平衡成为悬在头顶的剑，预埋第一场连锁危机
- 强调"世界不针对你，但也绝不照顾你"的中立残酷感
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把世界写成静态背景；资源/气候/威胁须动态联动，单点短缺可触发连锁
- 殖民地须有可演变的成长轴（窝棚→聚落→要塞），承载群像编年
- 至少铺设 2 类结构性威胁（外敌袭扰/极端环境）作为事件发火点
- 不预设结局；世界须容纳"苟存/扩张/逃离星球"等多种殖民走向
`.trim();

const CHARACTER_ARCHETYPE = `
# 殖民模拟 角色原型（带着特质与心理阈值的殖民者群像 · 环世界味）
- 殖民者群像：每人由"背景故事 + 特质组合 + 技能专长 + 心理阈值"定义，独一无二
- 特质即火种：暴躁、嗜血、抑郁、乐观、洁癖、夜猫子——直接改写行为与事件
- 关系网：殖民者间有恋人、世仇、亲属、宿怨，关系冷暖左右团队稳定
- 心理状态系统：心情由环境/事件累积，逼近阈值则触发崩溃（暴走/出走/纵火/绝食）
- 玩家 = 殖民地的隐形意志：以调度间接塑造众生，殖民者保有自己的脾气与底线
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每个殖民者须有"背景 + 特质 + 心理阈值"三件套，让行为可被预判也会意外失控
- 特质须真实驱动事件（嗜血者享受战斗、抑郁者更易崩溃），而非装饰标签
- 关系网须随共同经历动态演化（并肩患难升温、争抢资源反目）
- 心理崩溃须有累积前兆与可干预窗口，杜绝无征兆的突兀发疯
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 殖民模拟 涌现事件池（分类配比 · 环世界味）
- 心理崩溃事件（约 24%）：殖民者突破心理阈值后的暴走、纵火、出走、绝食、精神紧张——群像张力核心
- 生存危机事件（约 24%）：粮荒、瘟疫、寒潮、医药耗尽——逼出殖民地的残酷取舍
- 外部威胁事件（约 20%）：海盗突袭、野兽暴走、机械突袭、勒索通牒——据点防御的高潮
- 小人物事件（约 18%）：恋情、争吵、亲属来投、生离死别——殖民者之间的人情戏
- 机遇事件（约 14%）：商队、坠落舱、新殖民者、稀有资源——引发扩张与抉择
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则（环世界味）
- 事件须由"殖民者特质 + 心理状态 + 关系网 + 殖民地状态"共同触发，让每段故事独一无二
- 心理崩溃须呈"特质 × 压力"的因果：抑郁者在丧友后更易精神崩溃，暴躁者在拥挤中先爆发
- 崩溃须有累积前兆（心情持续走低）与干预窗口（安抚/隔离/改善环境），杜绝突兀发疯
- 灾难烈度须随殖民地成长升级，但保留"讲故事 AI"式的张弛：灾后给喘息，承平埋隐患
- 每个抉择须改写殖民者状态与关系网，后果跨多日持续发酵，可酿成连锁悲剧或转机
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风（环世界味）
- 殖民编年体：以冷峻又带黑色幽默的笔触，记录小人物在绝境中的挣扎与荒诞
- 聚焦个体特质投影："洁癖的医师拒绝在沾血的手术台工作，伤员在他犹豫时咽了气。"
- 描述发生了什么与殖民者的反应，把干预决策留给玩家，不替其做道德判断
- 心理崩溃事件写出人性的脆弱与可悲，重大事件给一句冷峻的编年注脚
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："坠机求生 / 殖民模拟 / 心理崩溃"
- 殖民者特质：医师"抑郁+和平主义"，猎手"嗜血+暴躁"，工程师"乐观+工作狂"
- 关系裂痕：医师与猎手是失散多年的兄弟，理念相左，旧怨未消
- 心理崩溃事件：寒潮断粮第九天，抑郁的医师突破阈值，深夜独自走入暴雪
- 连锁后果：猎手为寻兄违令出营，留守的工程师独木难支，殖民地陷入更深危机
`.trim();

export const SIM_COLONY_SKILL: NarrativeSkill = {
  genreCode: "sim-colony",
  tier: "tier2",
  matchKeywords: ["殖民模拟", "环世界", "矮人要塞", "rimworld", "缺氧", "RimWorld", "Dwarf Fortress", "殖民地"],
  narrativeSteps: ["worldview", "character_enrichment", "plot_generation"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
        examples: FEW_SHOT_EXAMPLES,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: "殖民模拟角色塑造（环世界味）：殖民者由背景 + 特质 + 心理阈值定义，特质驱动事件、心理逼近阈值则崩溃；玩家以调度间接塑造群像。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    plot_generation: {
      slots: {
        style_guide: EMERGENT_STYLE,
        constraints: `${EMERGENT_CATEGORY_RULES}\n\n${EMERGENT_BALANCE_RULES}`,
      },
    },
  },
};

registerSkill(SIM_COLONY_SKILL);
