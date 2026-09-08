/**
 * Idle / Incremental (cas-idle) — Tier3 轻量叙事品类 skill
 *
 * Archetype F（轻量叙事），核心：进度里程碑风味文案、转生/飞升叙事框架、
 * 挂机收益通知文案、极简世界前提、角色收集简介、UI驱动微叙事、成就描述叙事。
 *
 * 参考：Cookie Clicker、AFK Arena、Idle Heroes、放置少女、
 *       Melvor Idle、NGU Idle、Realm Grinder、无尽的拉格朗日
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 放置/增量 世界观原型（"一句话宇宙"）
- 世界前提必须在1-2句话内完全建立：不需要复杂设定，需要一个"让数字增长有意义"的理由
  （例："烤饼干征服宇宙"/"挂机训练成为最强勇者"/"放置收集少女拯救异世界"/"管理星际殖民地"）
- 数值即叙事：数字的增长本身就是故事（从1块饼干→1万→1亿→多元宇宙产能——每个数量级是新篇章）
- 世界观的"弹性"设计：必须能容纳无限扩展（新层级/新维度/新宇宙/新轮回）
- 极简但不空洞：用最少的文字建立最大的想象空间——玩家脑补比你写更有效
- 转生/飞升机制的世界观解释：为什么"重新开始"是进步？（轮回/维度跃迁/时间倒流/文明继承）
- 幽默和荒诞是合法的叙事策略：放置游戏可以不严肃——但荒诞感本身需要一致性
`.trim();

const WORLDVIEW_STYLE = `
- 语调：轻松、巧妙、点到即止——像fortune cookie里的签语
- 一切文字必须服务于"爽感"：数字变大=成就感→文字要强化这种感觉
- 幽默优先于严肃：玩家在"挂机"状态下看到的文字应该让人会心一笑
- 如果世界观是严肃的（星际/修仙），则文字保持简洁的"大气感"——少说多意
- 如果世界观是荒诞的（饼干/办公室），则文字保持精准的"反差感"——正经地说不正经的事
- 所有文字长度遵守"手机屏幕法则"：单条文案不超过2行（≤40字）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界观解释不能超过100字——超过就失去了"放置游戏"的轻量本质
- 数值膨胀（inflation）必须有对应的叙事升级——不能数字变大了但故事还在原地
- 转生系统必须给出至少一句话的"为什么"——纯机械重置会打破沉浸感
- 世界观不能自相矛盾——即使是荒诞世界也需要内部一致性
- 禁止在放置游戏中构建需要"阅读理解"的复杂设定——如果玩家跳过所有文字仍能愉快游玩
`.trim();

const CHARACTER_ARCHETYPE = `
# 放置/增量 角色原型（"卡面即全部"）

## 收集角色设计
- 每个角色是一张"有生命的卡牌"：立绘+名字+稀有度+50字简介=全部认知
- 角色简介公式：[身份]+[标志特征]+[一句话故事钩子]
  （例："沉默的暗影刺客。据说她从未失手——除了那次她选择了放过目标。"）
- 稀有度=叙事复杂度：N卡=1句话标签/R卡=2句话简介/SR卡=3句话迷你故事/SSR卡=5句话完整微传记
- 角色间关系用最少文字暗示："与XX势不两立""XX的妹妹""传闻与XX有旧怨"

## 角色阵营/种族
- 阵营是"视觉+一词"标签：光明/黑暗/自然/机械/混沌——每个阵营有鲜明色彩
- 种族设计服务于"收集驱动"：凑齐一个种族的全部角色=理解一个微型文明
- 阵营/种族描述 ≤ 30字："来自北境永冻之地的战斗种族，以力量证明一切"

## 升级/觉醒叙事
- 角色升星/觉醒对应"成长弧线"：初始=潜力/中期=觉醒/满级=终极形态
- 觉醒文案揭示角色的"隐藏面"："平日温柔的治愈师，觉醒后展现的是……毁灭之力"
- 技能名称是角色性格的浓缩："月影无痕"/"怒焰焚天"/"时间织者"
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色简介严格控制字数：N≤15字/R≤30字/SR≤50字/SSR≤80字——放置游戏没有读长文的场景
- 角色设计不能依赖文字补充视觉缺失——如果立绘不能传达身份，文字也救不了
- 低稀有度角色也需要人格——不能只是"又一个拿剑的战士"
- 角色关系描述必须双向可查——A提到B时，B的信息中也有对应内容
- 觉醒/进化的叙事必须与视觉变化同步——文字说"黑化"但立绘没变是不可接受的
`.trim();

export const IDLE_SKILL: NarrativeSkill = {
  genreCode: "cas-idle",
  tier: "tier3",
  matchKeywords: [
    "放置", "挂机", "Idle", "Incremental", "增量",
    "Cookie Clicker", "饼干点击者",
    "AFK Arena", "剑与远征",
    "Idle Heroes", "放置少女",
    "Melvor Idle", "NGU Idle", "Realm Grinder",
    "无尽的拉格朗日", "放置奇兵",
    "自动战斗", "挂机回报", "转生", "飞升",
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
  },
};

registerSkill(IDLE_SKILL);
