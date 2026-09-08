/**
 * sim-sandbox — 品类叙事包（沙盒建造 / Sandbox Building）
 *
 * 沙盒建造 = 涌现叙事型（玩家叙事自由 + 系统留白）。叙事几乎不来自预设角色，
 * 而由玩家在一片可被改造的世界里"自己讲故事"：探索、挖掘、建造、自动化，
 * 系统只提供规则与留白（Minecraft / 我的世界 / 泰拉瑞亚 / 戴森球 一脉）。
 *
 * 低角色密度建造型 → 仅 worldview + plot_generation（无 character_enrichment）。
 *
 * C3（2026-08）已封存：emergent_event 作为品类特化 step 被吸收进通用
 * plot_generation；本包对涌现事件池的分类配比 / 触发平衡 / 文风内容
 * 现通过 stepSkills.plot_generation 的 constraints / style_guide 两个槽位注入。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 沙盒建造 世界观原型（"一片等待被书写的可塑天地"）
- 世界 = 近乎无限的可改造空间：方块/地层/星球皆可被挖掘、堆叠、重塑
- 程序生成的留白：地貌、矿脉、生物群系由规则随机生成，每个种子都是新世界
- 规则即叙事语言：物理、合成、电路、自动化构成玩家"造句"的语法
- 探索的纵深：从地表到地心、从单星到星系，越深越危险也越富饶
- 世界对玩家"中立"：它不讲故事，只提供可能性，故事由玩家的创造填满
`.trim();

const WORLDVIEW_STYLE = `
- 语调：开阔、自由、带探索的好奇心，把世界写成"邀请你来定义"的画布
- 开局给出"可能性的诱惑"而非剧情钩子：奇异地貌、未知深处、稀有资源的传闻
- 强调系统留白：描述世界规则与素材，把"做什么"完全交还玩家
- 用环境的层次与神秘感激发自发探索与建造欲
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁强加主线或预设目标；世界须保持"玩家叙事自由"的开放性
- 世界须由可组合的规则与素材构成，让创造与自动化有发挥空间
- 须提供探索纵深（地层/维度/星系）与对应的风险-回报梯度
- 留白优先：提供素材与规则，不替玩家定义"应该建造什么"
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 沙盒建造 涌现事件池（分类配比）
- 探索发现事件（约 34%）：罕见生物群系、地下遗迹、稀有矿脉、隐藏维度入口——奖励好奇
- 环境/系统事件（约 26%）：昼夜更替、季节、天灾、怪物来袭、资源枯竭——给世界节律
- 建造里程碑事件（约 22%）：首座庇护所、自动化产线贯通、巨型工程落成——回应玩家创造
- 探险危机事件（约 12%）：深层险境、迷路、补给耗尽——为探索注入紧张
- 世界变迁事件（约 6%）：地貌演化、生态扩张/退缩——让世界随时间显得"活着"
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取"玩家位置/探索进度/建造规模/世界状态"，而非纯随机
- 危险与回报须随探索纵深同步升级，让"越深越值得也越凶险"成立
- 里程碑事件须回应玩家的自发创造，肯定其叙事自主权，而非打断它
- 事件须改写局部世界状态（资源/地貌/生态），留下玩家可继续利用的痕迹
- 系统须克制：以留白和暗示替代说教，绝不替玩家设定目标
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 探索手札体：以开拓者随手记录的口吻，描绘所见所感的新奇与未知
- 只描述世界发生了什么，把意义与目标的赋予权完全交给玩家
- 善用感官与留白："洞穴深处传来不属于风的声响，再往下，光照不到了。"
- 里程碑事件给一句对玩家创造的低调致意，不喧宾夺主
`.trim();

export const SIM_SANDBOX_SKILL: NarrativeSkill = {
  genreCode: "sim-sandbox",
  tier: "tier3",
  matchKeywords: ["沙盒", "minecraft", "我的世界", "泰拉瑞亚", "戴森球", "sandbox", "Terraria", "Dyson Sphere"],
  // 低角色密度建造型：仅世界观 + 涌现事件（吸收进通用 plot_generation）
  narrativeSteps: ["worldview", "plot_generation"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
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

registerSkill(SIM_SANDBOX_SKILL);
