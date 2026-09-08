/**
 * srv-craft — 品类叙事包（生存建造 / Survival Craft）
 *
 * 生存建造 = 涌现叙事型（环境威胁 + 据点演变）。区别于 sim-survival 的写实荒野，
 * srv-craft 更偏"诡谲求生 + 周期性末日浪潮"：在怪诞或末世的环境里采集合成、
 * 抵御理智流失与尸潮血月（饥荒 / 七日杀 一脉）。
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
# 生存建造 世界观原型（"诡谲末世里的求生据点"）
- 世界 = 一片怪诞或末世化的险境：暗黑童话荒野、丧尸横行的废土、被诅咒的孤岛
- 周期性的末日节律：黑夜/血月/尸潮按周期降临，把"日常采集"切成生与死的两半
- 双重压力：物理生存（饥饿/口渴/体温）+ 精神生存（理智/恐惧）双线告急
- 据点是叙事坐标：从一堆篝火到布满陷阱的堡垒，建造进度即一部抵御末世的编年
- 资源诡谲化：素材带超自然或末世色彩（暗影燃料、变异作物、辐射残骸）
`.trim();

const WORLDVIEW_STYLE = `
- 语调：诡谲、黑色幽默或末世冷峻，把求生写得既荒诞又紧张
- 开局确立"被抛入险境的窘迫"与即将到来的第一个末日周期（首个血月/长夜）
- 用黑夜/血月/尸潮的倒计时制造周期性的生死张力
- 让据点每一次加固都对应"挺过了哪一波"的求生编年
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把环境写成静态背景；威胁须随末日周期与时间动态升级
- 须明确"周期性灾潮"机制（血月/尸潮/长夜）作为核心叙事节拍
- 据点须有可演变的成长轴（篝火→营寨→堡垒），承载抵御编年
- 同时施加物理与精神双重压力，避免只剩单线数值消耗
`.trim();

const CHARACTER_ARCHETYPE = `
# 生存建造 角色原型（怪人求生者与据点同伴）
- 求生者（玩家化身）：往往是身怀怪癖或特长的边缘人，由生存抉择强化其古怪个性
- 同伴/幸存者：风格鲜明的求生伙伴，各带专长与神经质的小毛病，制造摩擦与笑料
- 末世"角色"：标志性的怪物头目、Boss 级尸潮首领，被赋予诡异的存在感
- 神秘存在：暗中观察的影子、谜样商人、低语的造物，为险境添加超自然悬念
`.trim();

const CHARACTER_CONSTRAINTS = `
- 求生者的怪癖/特长须真实影响生存玩法与事件反应，而非装饰设定
- 同伴须有专长与神经质软肋，在危机周期里触发可感知的互动
- 怪物/Boss 须有诡异行为逻辑与存在感，对抗带氛围与叙事重量
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 生存建造 涌现事件池（分类配比）
- 灾潮周期事件（约 30%）：血月降临、尸潮来袭、漫漫长夜、理智崩坏——核心生死节拍
- 环境威胁事件（约 22%）：极端天气、资源诡变、瘟疫毒雾、超自然异象——逼出应变取舍
- 据点演变事件（约 20%）：陷阱奏效、堡垒落成、防线被破——回应建造进度
- 探索事件（约 16%）：发现诡异遗迹、稀有素材、谜样地标——引发深入险境的抉择
- 幸存者事件（约 12%）：同伴来投、伙伴失踪/牺牲、商人现身——险境中的人情与怪谈
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取"末日周期阶段/据点等级/资源储备/理智值"，杜绝凭空降临
- 周期性灾潮须有明确倒计时与前兆，给玩家加固据点与备战的窗口
- 灾潮烈度须随天数/据点成长阶梯式升级，维持"越往后越凶险"的张力曲线
- 精神压力须与物理压力交织：黑夜与孤独应触发理智类事件，而非只扣血
- 每个抉择须改写据点与险境状态，后果持续发酵；灾后留喘息以防连环崩盘
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 怪谈求生日志体：以带黑色幽默或末世冷峻的口吻，记录每一次熬过灾潮的惊险
- 描述险境与据点的状态变化，把应对决策留给玩家
- 善用诡谲感官："血月升起时，连影子都开始往墙角缩——它们知道今晚不一样。"
- 据点里程碑给一句劫后余生的怪味慰藉，灾潮事件留紧张悬念
`.trim();

export const SRV_CRAFT_SKILL: NarrativeSkill = {
  genreCode: "srv-craft",
  tier: "tier2",
  matchKeywords: ["生存建造", "饥荒", "七日杀", "Don't Starve", "7 Days to Die", "末世生存", "采集合成"],
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
        style_guide: "生存建造角色塑造：求生者身怀怪癖特长、由抉择强化个性，同伴各带专长与神经质软肋；怪物 Boss 有诡异存在感。",
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

registerSkill(SRV_CRAFT_SKILL);
