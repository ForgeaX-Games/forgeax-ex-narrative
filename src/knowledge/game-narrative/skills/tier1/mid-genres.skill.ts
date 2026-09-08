/**
 * Tier1 mid-frequency genres (E3 batch) — concise skill stubs.
 *
 * These cover important but not "headline" genres. Each provides at least
 * one slot with a paragraph of style guidance so that the SKILL_REGISTRY
 * has explicit content to inject for these genres.
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

// 注：rpg-crpg / rpg-wuxia / act-linear 已迁移到 skills/tier1/<genre>/ 品类叙事包
// （含 narrativeSteps + 更丰富的专属 stepSkills），此处不再保留旧 stub。
const SKILLS: NarrativeSkill[] = [
  {
    genreCode: "adv-otome",
    tier: "tier1",
    matchKeywords: ["乙女", "恋与制作人", "光与夜之恋", "女性向", "古风乙女", "BL 乙女"],
    stepSkills: {
      worldview: { slots: { worldview_archetype: "乙女游戏世界观：日常 / 都市 / 校园 / 古风四种典型背景之一。世界观要轻量不喧宾夺主。" } },
      character_enrichment: { slots: { character_archetype: "乙女角色：4-6 名男主，性格分明（傲娇 / 温柔 / 病娇 / 神秘），各代表一种情感原型。" } },
      // C2（2026-08）已封存：branch_tree / dialogue_script 随 vn-v1 一并搬进
      // `pipeline/_archive/vn-v1/`，slot key 改挂到 outline_batch / plot_generation。
      // 此 stub 已被下方 adv-otome/index.ts 覆盖注册，仅作历史记录保留。
      outline_batch: { slots: { style_guide: "乙女分支：好感度 + 关键剧情选项；每位男主独立线 + 三结局（HE / NE / BE）。" } },
      plot_generation: { slots: { style_guide: "乙女对话：心动瞬间需要慢节奏 + 独白 + 情景音乐提示。配音版本须细腻。" } },
    },
  },
];

for (const s of SKILLS) registerSkill(s);

export const TIER1_MID_GENRES = SKILLS;
