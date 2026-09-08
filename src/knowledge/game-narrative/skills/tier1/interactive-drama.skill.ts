/**
 * Interactive Drama / 互动影游 (adv-interactive) — tpl-vn-v2 专属管线 skill
 *
 * 关键差异（相对于其他 VN 家族）：
 *   1. 使用 tpl-vn-v2 专属管线（E1+E2+G 9 步独立实现）
 *   2. 不再借用 tpl-vn 的 branch_tree / dialogue_script / cinematic_storyboard 旧 step
 *   3. skill 仅在借用的通用 step（worldview / preference_analysis）上做风格注入
 *      9 个 vn-v2 专属 step 的核心约束已经写进各自 system prompt，skill 可在 vn_* 槽位补充品类微调
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const ID_WORLDVIEW = `
# 互动影游世界观（写实可拍摄）
- 写实尺度：地点、时代、人物身份必须能落到实拍 / 实景渲染
- 紧凑窗口：故事发生在 72 小时 / 一周末 / 单个城市等明确时空
- 所有重要场景必须可拍摄 / 可调度 NPC（不要写魔法 / 大型奇观）
- 列出"地点清单"：每个关键地点都要有摄制可行性
`.trim();

const ID_BRANCH_DIRECTION = `
# 互动影游剧情树设计倾向（仅作为风格补充，硬约束在 vn_branched_beats 系统提示中）
- 偏好"网状收束"：多个分支可在中段汇流于同一关键场（merge_back）
- 蝴蝶效应：一个早期选择可在 3-5 个情节点后才显现后果
- 至少标识 1-2 名"可死亡角色"，并写入 ending 触发条件
- 主结局矩阵建议覆盖 H/B/O 三类，但具体数量按剧情需求来定
`.trim();

const ID_SCREENPLAY = `
# 互动影游剧本对白风格
- 短台词为主，5-12 字/句，留出表演空间
- 关键场景穿插"无对白镜头"（特写 / 慢动作）
- 玩家选项呈现时建议带"心跳压力"提示（限时 X 秒）
- 对白的情绪基调贴合"紧张-松弛-紧张"节奏
`.trim();

const ID_STORYBOARD = `
# 互动影游分镜风格
- 偏好电影化运镜：长镜头与精准切镜交错，避免抖动手持过度使用
- 决策 QTE 镜头务必让玩家看清动作（中/近景，静止或轻推）
- 同场反复出现的同一动作可通过 reuse_from 复用，节省视觉资源
`.trim();

export const INTERACTIVE_DRAMA_SKILL: NarrativeSkill = {
  genreCode: "adv-interactive",
  tier: "tier1",
  matchKeywords: [
    "互动影游", "互动电影", "互动剧", "FMV", "QTE",
    "Detroit", "Heavy Rain", "暴雨", "底特律", "隐形守护者",
  ],
  // tpl-vn-v2 已内置 9 步全量管线，无需 enableSteps 启用额外环节
  // Stage C：默认短剧 1 幕；用户在 INPUT 写 "5 幕长剧" 等关键词时仍可被 user_input 覆盖
  defaultActs: 1,
  stepSkills: {
    // 借用的通用 step（仅风格注入）
    worldview: { slots: { worldview_archetype: ID_WORLDVIEW } },
    // tpl-vn-v2 专属 step（slot 名与各 step 内容文本无依赖，作为可选补丁）
    vn_branched_beats: { slots: { style_guide: ID_BRANCH_DIRECTION } },
    vn_screenplay: { slots: { style_guide: ID_SCREENPLAY } },
    vn_storyboard: { slots: { style_guide: ID_STORYBOARD } },
  },
};

registerSkill(INTERACTIVE_DRAMA_SKILL);
