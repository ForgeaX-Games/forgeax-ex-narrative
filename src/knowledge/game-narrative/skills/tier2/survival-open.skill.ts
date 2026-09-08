/**
 * Survival Open-World (srv-open) — Tier2 涌现叙事品类 skill
 *
 * Archetype D（涌现叙事），核心：生存机制驱动故事、基地建设叙事、
 * 程序化遭遇、威胁递增、玩家行为生成独特叙事。
 *
 * 参考：Subnautica、The Forest、Valheim、Rust、Don't Starve、The Long Dark
 *
 * C3（2026-08）已封存：原品类特化的 emergent_event step 吸收进通用 plot_generation，
 * 生存事件模板与触发/文案约束改由 plot_generation 的 style_guide / constraints 槽位承载，
 * 形态差异交给 network/emergent/fragmented 三张结构卡区分。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 开放世界生存 世界观原型（"被遗弃的荒野"）
- 玩家是"闯入者/幸存者/坠落者"——不是这个世界的主人，而是被投放到陌生环境
- 世界有自己的生态循环——有没有玩家它都在运转（昼夜/天气/动物迁徙/植物生长）
- 隐含叙事层：这个地方"曾经有人"——前任探索者/原住民/失落文明的痕迹散落环境中
- 核心威胁不是反派而是"环境本身"——寒冷/饥饿/黑暗/深海/疾病/孤独
- 区域自然分层（安全→中等→危险→禁区），难度即叙事进度的隐喻
- 最终谜团：这个地方为什么是这样？前人为什么消失/失败？
`.trim();

const WORLDVIEW_STYLE = `
- 语调：孤独、克制、写实——像一本野外生存手记
- 世界描述避免主观情感渲染——用客观环境细节让玩家自己感受到"渺小"
- 区域介绍以"地理/气候/生态"为骨架，"前人遗迹/异常现象"为肉
- 生存规则必须与叙事结合：寒冷不只是数值，是"这片土地在拒绝外来者"
- 前人痕迹以渐进方式展开：先是工具，再是笔记，最后是尸骨和最终记录
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 禁止过度解释世界——玩家对世界的理解应该随探索半径扩大而增长
- 初始区域不能包含任何核心叙事信息——只有"生存的紧迫感"
- 世界生态必须自洽（食物链/天气系统/资源循环有逻辑）
- 前人遗迹的分布密度：初始区域稀疏，深入后密集——暗示前人也走过同样的路
`.trim();

const EMERGENT_EVENT_STYLE = `
# 生存事件模板（涌现叙事引擎）

## 事件触发逻辑
事件由世界状态 × 玩家状态 × 时间触发：
- 环境事件：暴风雪/洪水/地震/日食 → 打破当前平衡
- 生态事件：兽群迁徙/捕食者出现/资源枯竭 → 迫使玩家迁移
- 发现事件：找到前人营地/打开密封舱/解码记录器 → 推进核心谜团
- 入侵事件：其他幸存者/敌对势力/未知生物 → 社会性威胁

## 事件文案模板
每个事件需要：
1. 感知描述（玩家如何注意到）："天空变成了不自然的橙色"
2. 当下影响（对生存的威胁）："气温在下降，储备的燃料撑不了两天"
3. 隐含叙事（暗示更大图景）："这和第三份日志里描述的现象一模一样"

## 事件链设计
- 单事件 = 生存挑战
- 事件链 = 故事弧（3-5个关联事件构成一个叙事单元）
- 事件链的结尾给玩家一个"选择"（搬迁/对抗/适应）→ 不同选择开启不同后续

## 日志/记录发现
前人遗留的日志是核心叙事载体：
- 格式：日期+天气+简短记录（模拟真实笔记）
- 情绪弧：最初乐观 → 逐渐紧张 → 恐慌 → 最终条目中断
- 信息密度递增：前期描述生存细节，后期透露世界真相
- 单条日志 < 100 字，保持碎片化
`.trim();

const EMERGENT_EVENT_CONSTRAINTS = `
- 事件描述必须"感官优先"——玩家先感知到异常，再理解发生了什么
- 禁止事件文案直接告诉玩家"该做什么"——提供信息，不提供解法
- 环境事件的叙事包装不能脱离物理现实（暴风雪就是暴风雪，不是魔法）
- 前人日志禁止一次性解释所有真相——每份只给一个碎片
- 事件之间必须有"安静期"——不能让玩家应接不暇失去沉浸感
`.trim();

const SCENE_GENERATION_STYLE = `
# 生存场景生成（环境作为角色）
- 每个场景描述服务于两个目的：1)生存信息（资源/威胁/地形）2)氛围/叙事

场景类型：
- 自然荒野：强调感官体验（风声/光线/温度/气味）—— 让玩家"身临其境"
- 前人遗址：对比"当时"与"现在"——还能辨认出曾经的用途，但被时间和自然蚕食
- 危险区域：环境本身在"警告"——异常的安静/植物扭曲/动物避开
- 玩家基地周边：随时间变化——从荒芜变为有生命气息，反映玩家的努力

描写原则：
- 天气/光线/时间必须写入场景（同一地点白天和夜晚是完全不同的体验）
- 用动态细节代替静态描述（"风把沙吹进帐篷的缝隙"而非"这里很荒凉"）
- 远景暗示探索方向/危险等级（"远处山脊上有不自然的光"）
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 禁止浪漫化生存困境——寒冷就是要命的，不是"美丽的雪景"
- 前人遗址的描述必须给玩家"他们也到过这里"的共鸣感
- 场景中的资源/威胁信息不可用游戏术语——必须转化为感官描写
- 夜间场景必须传达"黑暗的重量"——视觉描写让位给听觉和触觉
`.trim();

export const SURVIVAL_OPEN_SKILL: NarrativeSkill = {
  genreCode: "srv-open",
  tier: "tier2",
  matchKeywords: [
    "生存", "Survival", "开放世界生存", "Open World Survival",
    "Subnautica", "深海迷航", "The Forest", "森林",
    "Valheim", "英灵神殿", "Don't Starve", "饥荒",
    "The Long Dark", "漫漫长夜", "Rust", "方舟",
    "基地建设", "荒野求生", "求生",
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
    // C3：原 emergent_event（涌现事件池）吸收进通用 plot_generation
    plot_generation: {
      slots: {
        style_guide: EMERGENT_EVENT_STYLE,
        constraints: EMERGENT_EVENT_CONSTRAINTS,
      },
    },
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
        constraints: SCENE_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(SURVIVAL_OPEN_SKILL);
