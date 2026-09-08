/**
 * srv-creative — 品类叙事包（创意沙盒 / Creative Sandbox & UGC）
 *
 * 创意沙盒 = 涌现叙事型（用户生成内容框架）。叙事不来自官方剧本，而由"玩家即作者"的
 * UGC 生态涌现：平台只提供创作工具、社交规则与展示舞台，故事由海量用户共建
 * （Roblox 一脉）。
 *
 * 低角色密度（平台框架、无固定主角）→ 仅 worldview + plot_generation。
 *
 * C3（2026-08）已封存：emergent_event 作为品类特化 step 被吸收进通用
 * plot_generation；本包对涌现事件池的分类配比 / 触发平衡 / 文风内容
 * 现通过 stepSkills.plot_generation 的 constraints / style_guide 两个槽位注入。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 创意沙盒 世界观原型（"玩家即作者的元宇宙平台"）
- 世界 = 一座承载无数子世界的创作平台：每个房间/体验都是某位用户搭建的小宇宙
- UGC 是叙事本体：官方不写故事，而是提供工具、模板、规则，让用户成为创作者
- 双重身份循环：玩家既是体验的"游客"，也随时可切换为搭建世界的"作者"
- 社交即引擎：好友、社群、热门榜、虚拟经济，让创作在传播与协作中获得生命
- 元素可组合：积木式资产 + 脚本逻辑 + 共享素材库，构成"创作语法"的留白系统
`.trim();

const WORLDVIEW_STYLE = `
- 语调：明快、包容、激发创造欲，把平台写成"一切皆可被你创造"的乐园
- 强调框架而非内容：描述创作工具、社交规则与展示舞台，把"做什么"交还用户
- 用热门体验、协作搭建、虚拟经济的活力，营造"人人都是作者"的生态氛围
- 突出可组合性与留白：提供语法与素材，不预设任何一种"正确玩法"
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁强加单一官方主线；世界须保持 UGC 的开放性与玩家创作自由
- 须以"工具 + 规则 + 舞台"三件套为框架核心，让创作与分享有发挥空间
- 须呈现社交/经济/传播机制，让用户内容在生态中流动而非孤立存在
- 内容由用户共建：平台只定义可能性边界与安全规则，不替用户定义体验
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 创意沙盒 涌现事件池（分类配比）
- 创作里程碑事件（约 30%）：首个作品发布、登上热门、获得点赞/打赏——回应用户的创造
- 社交/社群事件（约 26%）：好友共建、组队联机、社群活动、协作开发——社交引擎的戏剧
- 体验发现事件（约 22%）：新热门体验上线、隐藏佳作、跨界联动——游客探索的奖励
- 经济/成长事件（约 12%）：虚拟货币流转、限定道具、创作者收益——平台经济的脉动
- 平台事件（约 10%）：节日活动、版本更新、规则变动、热点潮流——重塑整片生态
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取"用户身份（游客/作者）/创作进度/社交关系/热度状态"，而非纯随机
- 须同时服务"创作者成就感"与"游客探索乐趣"两条线，避免偏废一方
- 里程碑事件须肯定用户的自主创造，而非用官方叙事盖过 UGC
- 经济与传播类事件须沿社交关系网与热度榜传导，体现"生态在运转"
- 每个事件须改写用户在平台的状态（作品热度/社交圈/资产），留下可继续经营的痕迹
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 平台动态体：以社区通知 / 创作者后台 / 好友消息的轻快口吻播报生态脉动
- 描述平台与社群发生了什么，把"创作什么、体验什么"的决定权交给用户
- 善用社交语境的活力："你昨晚搭的小岛，今早被三个陌生人收藏了——他们留言问能不能联机。"
- 里程碑事件给一句对用户创造的真诚鼓励，激发持续共建，绝不喧宾夺主
`.trim();

export const SRV_CREATIVE_SKILL: NarrativeSkill = {
  genreCode: "srv-creative",
  tier: "tier3",
  matchKeywords: ["创意沙盒", "roblox", "Roblox", "UGC", "用户生成内容", "创作平台"],
  // 低角色密度（平台框架、无固定主角）：仅世界观 + 涌现事件（吸收进通用 plot_generation）
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

registerSkill(SRV_CREATIVE_SKILL);
