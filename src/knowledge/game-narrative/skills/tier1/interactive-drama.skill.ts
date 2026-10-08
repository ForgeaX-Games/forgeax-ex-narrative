/**
 * Interactive Drama / 互动影游 (adv-interactive) —— 品类风格注入
 *
 * 这个品类是 IP 改编未指定品类时的缺省品类（`DEFAULT_ADAPTATION_GENRE`），所以它的
 * 注入点失配就是缺省路径失配。
 *
 * 三段风格文本从前挂在 `vn_branched_beats` / `vn_screenplay` / `vn_storyboard` 上。C1
 * （2026-08）统一管线后那三个 step 随 tpl-vn-v2 一并封存进 `pipeline/_archive/vn-v2/`，
 * 而 `getStepSkill` 按 step id 精确查表 —— 键对不上就静默返回空，三段内容在生产路径上
 * 一处也注入不到。现在挂在通用步序上：剧情树倾向归 `outline_batch`（树在结构层成形），
 * 对白风格归 `script_generation`（L4 剧本那一步）。
 *
 * 分镜那段没有归宿，删了：它讲的是决策 QTE 的镜头与 `reuse_from` 字段复用，两者都随
 * vn-v2 停用。留着只会让模型去产出一个没有消费者的东西。
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
# 互动影游剧情树设计倾向（仅作为风格补充，硬约束在结构层系统提示中）
- 偏好"网状收束"：多个分支可在中段汇流于同一关键场（merge）
- 蝴蝶效应：一个早期选择可在 3-5 个情节点后才显现后果
- 至少标识 1-2 名"可死亡角色"，并写入 ending 触发条件
- 主结局矩阵建议覆盖 good/bad/neutral 三类，但具体数量按剧情需求来定
`.trim();

const ID_SCREENPLAY = `
# 互动影游剧本对白风格
- 短台词为主，5-12 字/句，留出表演空间
- 关键场景穿插"无对白镜头"（特写 / 慢动作）
- 玩家选项呈现时建议带"心跳压力"提示（限时 X 秒）
- 对白的情绪基调贴合"紧张-松弛-紧张"节奏
`.trim();

export const INTERACTIVE_DRAMA_SKILL: NarrativeSkill = {
  genreCode: "adv-interactive",
  tier: "tier1",
  matchKeywords: [
    "互动影游", "互动电影", "互动剧", "FMV", "QTE",
    "Detroit", "Heavy Rain", "暴雨", "底特律", "隐形守护者",
  ],
  // 叙事规模：默认短剧 1 幕；用户在 INPUT 写 "5 幕长剧" 等关键词时仍可被覆盖。
  // 这里的"幕"是 initial_plan 的叙事规模，与三层剧情树无关（那一侧已无幕）。
  defaultActs: 1,
  stepSkills: {
    worldview: { slots: { worldview_archetype: ID_WORLDVIEW } },
    outline_batch: { slots: { style_guide: ID_BRANCH_DIRECTION } },
    script_generation: { slots: { style_guide: ID_SCREENPLAY } },
  },
};

registerSkill(INTERACTIVE_DRAMA_SKILL);
