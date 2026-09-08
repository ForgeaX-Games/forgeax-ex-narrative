/**
 * sim-creature — 品类叙事包（宠物 / 生物模拟 / Creature Sim）
 *
 * 宠物 / 生物模拟 = 涌现叙事型（宠物羁绊 + 图鉴 Lore）。叙事由"养育互动 + 生物图鉴的世界观"
 * 涌现：没有人类主线，故事来自玩家与生物的羁绊累积，以及一部活的生态图鉴
 * （宠物养成 / 数码宝贝 一脉）。
 *
 * 低角色密度（生物为主、少人类群像）→ 仅 worldview + plot_generation。
 *
 * C3（2026-08）已封存：emergent_event 作为品类特化 step 被吸收进通用
 * plot_generation；本包对涌现事件池的分类配比 / 触发平衡 / 文风内容
 * 现通过 stepSkills.plot_generation 的 constraints / style_guide 两个槽位注入。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 宠物/生物模拟 世界观原型（"一部活着的生态图鉴"）
- 世界 = 一座物种丰饶的生态秘境：森林、湿地、火山、数字空间皆可栖息独特生物
- 图鉴 Lore 是叙事骨架：每种生物有习性、进化谱系、栖息地传说，构成可收集的世界知识
- 进化与羁绊：生物随养育/环境/羁绊深度而成长、进化乃至分支为不同形态
- 生态食物链与共生：物种间有捕食、共栖、竞争关系，世界自成一套生命循环
- 人与生物的边界温柔：玩家是观察者/伙伴/驯育者，而非世界的中心
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温暖治愈 + 博物学的好奇，像一本边养育边填写的生态图鉴
- 开局给出"生态秘境的诱惑"与第一只生物的相遇，建立羁绊锚点
- 把每种生物写成有习性与脾气的"小生命"，而非数值卡片
- 用图鉴线索（栖息地传说/进化之谜）激发收集与探索欲
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把生物写成纯属性图标；每种须有习性、脾气与图鉴 Lore
- 世界须呈现生态关系网（捕食/共生/竞争），让物种彼此关联
- 进化/成长须由"养育 + 环境 + 羁绊"共同驱动，并预留分支形态
- 以生物与羁绊为叙事中心，克制人类角色戏份，保持低角色密度
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 宠物/生物模拟 涌现事件池（分类配比）
- 羁绊事件（约 30%）：亲密度提升、撒娇/闹脾气、患难相守、回应呼唤——养育者与生物的情感
- 成长/进化事件（约 26%）：进化分支、习性觉醒、形态变异、能力开花——成长曲线的高光
- 图鉴/发现事件（约 22%）：新物种邂逅、栖息地探秘、稀有变种、图鉴 Lore 揭晓——收集的奖励
- 生态事件（约 14%）：季节迁徙、捕食与共生、种群繁衍——让世界生态显得鲜活
- 意外事件（约 8%）：生病、走失、野生威胁、意外馈赠——为养育注入起伏
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取"生物习性/亲密度/成长阶段/栖息环境"，让每只生物的故事独一无二
- 进化分支须由养育方式与羁绊深度决定，体现"你怎么待它，它就长成什么样"
- 图鉴揭晓须随探索与互动渐次解锁，维持"越了解越着迷"的收集节奏
- 每个互动/抉择须改写羁绊与成长状态，后果在生物的言行形态上可见
- 起伏须温柔可控：意外有惊无险，避免让治愈基调被残酷打断
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 图鉴札记体：以博物学者兼养育者的温柔笔触，记录生物的习性与点滴成长
- 描述生物的反应与变化，把"如何照料"的决定留给玩家
- 善用拟生态的细节："它今天第一次主动把尾巴卷上你的手腕，图鉴上说这是信任的征兆。"
- 进化/图鉴揭晓给一句惊喜与温情交织的注脚，深化羁绊
`.trim();

export const SIM_CREATURE_SKILL: NarrativeSkill = {
  genreCode: "sim-creature",
  tier: "tier3",
  matchKeywords: ["宠物", "数码宝贝", "生物模拟", "creature sim", "Digimon", "宠物模拟", "图鉴"],
  // 低角色密度（生物为主）：仅世界观 + 涌现事件（吸收进通用 plot_generation）
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

registerSkill(SIM_CREATURE_SKILL);
