/**
 * sim-survival — 品类叙事包（生存建造 / Survival Building）
 *
 * 生存建造 = 涌现叙事型（环境威胁 + 据点演变）。叙事由"环境施压 → 据点应变"的循环涌现：
 * 没有主线，故事来自一处营地在风雪、野兽、敌袭中从茅棚成长为要塞的编年
 * （英灵神殿 / 腐蚀 一脉）。
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
# 生存建造 世界观原型（"敌意荒野中的据点编年"）
- 世界 = 一片充满敌意的荒野：严酷气候、危险生物群系、未知威胁环伺四周
- 环境是第一对手：饥饿、寒冷、疾病、黑夜本身就是持续施压的叙事引擎
- 据点是叙事坐标：从一堆篝火到围墙要塞，建造进度就是一部生存史
- 生物群系分区：每个区域有独特威胁与资源，深入即升级风险与回报
- 残酷而中立的世界：它不针对玩家，只是按自己的规则运转，凶险源于此
`.trim();

const WORLDVIEW_STYLE = `
- 语调：粗粝、坚韧，带荒野求生的凛冽与据点成型的成就感
- 开局确立"初降此地的脆弱处境"与四周环伺的威胁，预埋第一夜危机
- 用气候/昼夜/季节作为周期性威胁节拍器，制造生存张力
- 让据点的每一次升级都对应一段"抵御了什么"的微编年
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把环境写成静态背景；威胁须随时间/季节/深入度动态升级
- 据点须有可演变的成长轴（茅棚→营地→要塞），让建造承载叙事进度
- 至少铺设 2 类结构性环境威胁（极端气候/周期性兽潮）作为事件发火点
- 不预设结局；世界须为"苟存/扩张/征服险境"等多种生存路线供给空间
`.trim();

const CHARACTER_ARCHETYPE = `
# 生存建造 角色原型（荒野中的求生者与据点伙伴）
- 求生者（玩家化身）：由生存抉择定义性格——是谨慎的筑墙者还是激进的探险家
- 据点伙伴/幸存者：可招募的同伴，有专长与软肋，分担生存压力也带来摩擦
- 荒野"角色"：标志性的危险生物、Boss 级威胁，被赋予近乎人格的存在感
- 过客与遗骸：流浪商人、前人留下的营地废墟与日志，暗示这片荒野的残酷往事
`.trim();

const CHARACTER_CONSTRAINTS = `
- 求生者的"性格"由生存风格累积，禁止预设固定人设
- 据点伙伴须有专长与软肋，并在危机中触发可感知的互动或摩擦
- 危险生物须有行为逻辑与"存在感"，而非纯数值刷怪，让对抗有叙事重量
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 生存建造 涌现事件池（分类配比）
- 环境威胁事件（约 32%）：暴风雪、酷暑、瘟疫、毒雾——逼出资源与据点的应变取舍
- 据点演变事件（约 22%）：城墙落成、产线贯通、据点遭袭受损——回应建造进度
- 探索事件（约 20%）：发现新群系、遗迹宝藏、稀有资源点——引发深入险境的抉择
- 威胁来袭事件（约 16%）：兽潮、Boss 现身、敌对营地袭扰——据点防御的高潮
- 幸存者事件（约 10%）：同伴来投、伙伴负伤/牺牲、商队路过——荒野中的人情戏
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取"环境状态/据点等级/资源储备/探索深度"，杜绝凭空降临
- 环境威胁须有前兆信号（气压骤降/兽群异动），给玩家加固据点的窗口
- 威胁烈度须与据点成长同步升级，维持"建得越强、来犯越凶"的张力曲线
- 每个抉择须改写据点与荒野状态（防御/资源/区域安全），后果持续发酵
- 顺境给"深入诱惑"，逆境给"喘息机遇"，避免连续打击让据点崩盘
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 求生日志体：以幸存者刻下的编年口吻，记录每一次抵御与失去
- 描述荒野与据点的状态变化，把应对决策留给玩家
- 善用环境感官的压迫："第七夜，篝火快灭了，林子里的眼睛比昨天更近了。"
- 据点里程碑给一句"我们终于挺过来了"的粗粝慰藉，威胁事件留紧张余韵
`.trim();

export const SIM_SURVIVAL_SKILL: NarrativeSkill = {
  genreCode: "sim-survival",
  tier: "tier2",
  matchKeywords: ["生存建造", "英灵神殿", "腐蚀", "Valheim", "Rust", "生存", "建造"],
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
        style_guide: "生存建造角色塑造：求生者由生存风格定义性格，据点伙伴各有专长软肋；危险生物有行为逻辑与存在感，对抗带叙事重量。",
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

registerSkill(SIM_SURVIVAL_SKILL);
