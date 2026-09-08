/**
 * sim-raising — 品类叙事包（养成模拟 / Raising Sim）
 *
 * 养成模拟 = 涌现叙事型。叙事由「养成对象的成长曲线 + 结局分歧」涌现：
 * 玩家以日复一日的安排雕琢一个生命，属性与事件累积成独一无二的人生轨迹
 * （美少女梦工厂 / 公主连接 一脉）。
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
# 养成模拟 世界观原型（"承载一段成长的舞台"）
- 世界 = 一个适合"慢慢长大"的温柔舞台：学园、王国、剧团、冒险公会皆可
- 时间是核心叙事轴：以"周/月/年"为刻度，成长在时间流逝中可被丈量
- 多元出路：学业、武艺、艺术、社交、冒险——不同的培养方向通往不同的人生
- 属性即命运的伏笔：体力/智力/魅力/品德的此消彼长，悄然决定未来的分岔
- 社会期待与个人意志的张力：世界对养成对象有预设期望，而成长可顺从或叛逆
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温柔细腻 + 时光流逝的淡淡感伤，像一本被悉心填写的成长日记
- 开局确立"养成对象的起点境遇"与一个朦胧的人生愿景，作为情感锚点
- 让季节/节日/年龄节点成为天然的叙事节拍器
- 把抽象属性翻译成可感知的成长瞬间（第一次登台、第一次远行）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁写成静态背景；世界须随养成对象的成长阶段而变化（孩童→少年→成人）
- 须明确多条结局走向的"种子条件"，让培养方向真实通往不同结局
- 至少铺设 2 个随时间推进必然到来的"成长节点"（升学/成人礼/抉择关口）
- 不预设单一理想结局；世界须尊重平凡结局与非典型出路的价值
`.trim();

const CHARACTER_ARCHETYPE = `
# 养成模拟 角色原型（被悉心培育的生命 + 陪伴者）
- 养成对象：故事绝对中心，有先天气质 + 后天可塑性，成长曲线随玩家安排分化
- 玩家 = 监护人/导师视角：以日程安排"间接"雕琢对象的人生，少直接行动
- 陪伴角色群：同窗、对手、暗恋者、师长，在成长路上投下友情/竞争/情愫的支线
- 命运转折人物：带来契机或考验的关键角色，可能扭转养成对象的人生走向
`.trim();

const CHARACTER_CONSTRAINTS = `
- 养成对象须有"先天气质"作为基线，避免成长后变成毫无个性的属性容器
- 成长须可见可感：属性变化要反映到对象的言行、外貌与态度上
- 陪伴角色的关系须随培养路线动态演化，而非固定脚本
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 养成模拟 涌现事件池（分类配比）
- 成长事件（约 30%）：训练突破、瓶颈受挫、天赋觉醒、能力倒退——刻画成长曲线
- 关系事件（约 24%）：友情升温、暗恋萌芽、对手交锋、师徒情深——情感支线
- 抉择事件（约 18%）：升学/就业/比赛/告白的关口——直接拨动结局分歧的扳机
- 日常事件（约 16%）：节日、打工、生病、远足——积累生活质感与小确幸
- 命运事件（约 12%）：意外、家变、贵人相助、命运邀约——投下改变轨迹的变量
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取养成对象的属性/年龄/关系状态，让每一次成长都个性化
- 结局分歧须由"属性阈值 + 关键抉择 + 关系积累"共同决定，杜绝单一数值通吃
- 成长须有曲线：瓶颈、倒退、厚积薄发，避免线性平滑的无趣上升
- 每个抉择须改写对象状态与结局倾向，后果在后续阶段持续累积
- 不同培养路线须有相称的精彩结局，平凡出路也应被温柔对待
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 成长日记体：以温柔笔触记录养成对象的每一次蜕变与心境
- 描述对象的变化与处境，把"如何安排"的决定权留给玩家
- 善用时光流逝的对照："去年还够不到的书架，今年她踮脚就能拿到了。"
- 抉择关口给真实的人生重量，结局收束带"目送一个生命远行"的余韵
`.trim();

export const SIM_RAISING_SKILL: NarrativeSkill = {
  genreCode: "sim-raising",
  tier: "tier2",
  matchKeywords: ["养成", "美少女梦工厂", "公主连接", "养成模拟", "raising sim", "育成"],
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
        style_guide: "养成模拟角色塑造：养成对象是绝对中心，先天气质 + 后天可塑，成长可见可感；玩家以监护者视角间接雕琢人生。",
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

registerSkill(SIM_RAISING_SKILL);
