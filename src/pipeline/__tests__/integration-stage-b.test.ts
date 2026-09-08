/**
 * integration-stage-b.test.ts (B-INTEG)
 * ─────────────────────────────────────────────────────────────────
 * 阶段 B 端到端集成验收。覆盖：
 *
 *   ① [已随 C3 移除] 原「4 stub 全部走 universal-agent 包装、行为兼容」——
 *      region_design / emergent_event / card_lore / event_pool 四个 stub 已随
 *      四个品类特化能力于 C3（2026-08）封存进 `_archive/specialized/`，
 *      对应薄包装用例见 `_archive/specialized/__tests__/universal-narrative-specialized.test.ts`，
 *      此处不再覆盖（早前 branch_tree / dialogue_script / cinematic_storyboard
 *      三个已随 tpl-vn 于 C2 封存进 `_archive/vn-v1/`）。
 *   ③ D0-D4 策划 skill 注入率 100%（94 品类 × 5 step）
 *   ④ D1/D3 接入 system skill 摘要
 *   ⑤ RPG L0-L5 链路结构未被破坏（与 A 阶段保持一致）
 *   ⑥ 8 个 PipelineTemplate 各自正确路由（不互相串扰）
 */

import { describe, it, expect } from "vitest";
import "../../knowledge/game-narrative/skill-bootstrap.js";
import { GENRE_TAXONOMY } from "../../knowledge/genre-taxonomy.js";
import { loadSkill, getStepSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { buildAutoSteps } from "../design-steps/auto-narrative-builder.js";
import type { NarrativeRequirements } from "../../types/game-design.js";
import { buildArchitectureSkillSummary, buildValueSkillSummary } from "../../knowledge/game-design/system-skill-recommender.js";

const PLANNING_STEPS = ["core_concept", "system_architecture", "system_detail", "value_framework", "design_doc"] as const;

const FULL_NEEDS: Record<string, number> = { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3, U: 3, L: 3 };

function buildReq(
  needs: Record<string, number>,
  narrativeType: NarrativeRequirements["narrative_type"],
): NarrativeRequirements {
  return {
    needs,
    narrative_type: narrativeType,
    depth: "standard",
    available_modes: [],
  } as unknown as NarrativeRequirements;
}

function stepsForGenre(genreCode: string): string[] {
  const entry = GENRE_TAXONOMY.find((g) => g.code === genreCode);
  if (!entry) throw new Error(`unknown genre ${genreCode}`);
  return buildAutoSteps(buildReq(entry.needs, entry.narrative_type), { genreCode });
}

/** 用 FULL_NEEDS 跑 — 验证模板"全量"路径 */
function stepsForGenreFull(genreCode: string, narrativeType: NarrativeRequirements["narrative_type"] = "linear"): string[] {
  return buildAutoSteps(buildReq(FULL_NEEDS, narrativeType), { genreCode });
}

describe("B-INTEG ③ D0-D4 planning skill coverage 100%", () => {
  it("every genre has all 5 D0-D4 stepSkills", () => {
    const missing: Array<{ genre: string; step: string }> = [];
    for (const entry of GENRE_TAXONOMY) {
      const skill = loadSkill(entry.code);
      for (const step of PLANNING_STEPS) {
        if (!skill?.stepSkills[step]) missing.push({ genre: entry.code, step });
      }
    }
    expect(missing).toEqual([]);
  });

  it("rendered planning prompts differ across tiers (Tier1 vs Tier4)", () => {
    const tier1 = getStepSkill("rpg-jrpg", "design_doc");
    const tier4 = getStepSkill("puz-match", "design_doc");
    expect(tier1?.systemPromptAddition).toBeDefined();
    expect(tier4?.systemPromptAddition).toBeDefined();
    expect(tier1?.systemPromptAddition).not.toBe(tier4?.systemPromptAddition);
  });
});

describe("B-INTEG ④ D1/D3 system skill summaries", () => {
  it("D1 architecture summary differs across genres", () => {
    const rpg = buildArchitectureSkillSummary("rpg-jrpg");
    const puz = buildArchitectureSkillSummary("puz-match");
    expect(rpg.length).toBeGreaterThan(50);
    expect(puz).not.toBe(rpg);
  });

  it("D3 value summary is subset focus (combat/economy/growth)", () => {
    const text = buildValueSkillSummary("rpg-jrpg");
    expect(/战斗|装备|经济|成长|属性/.test(text)).toBe(true);
  });
});

describe("B-INTEG ⑤ RPG L0-L5 chain integrity (zero regression)", () => {
  // 这些品类的 pipelineTemplate 是 tpl-rpg，给 FULL_NEEDS 时必须返回完整 L0-L5
  const TPL_RPG_GENRES = [
    "rpg-jrpg",
    "rpg-crpg",
    "rpg-arpg",
    "rpg-mmorpg",
    "rpg-srpg",
    "rpg-gacha",
    "rpg-roguelike",
    "rpg-wuxia",
  ];

  it.each(TPL_RPG_GENRES)("%s with FULL_NEEDS produces full RPG L0-L5 chain", (code) => {
    const stepIds = stepsForGenreFull(code);
    expect(stepIds).toContain("story_framework");      // L0
    expect(stepIds).toContain("outline_batch");         // L1
    expect(stepIds).toContain("detailed_outline");      // L2
    expect(stepIds).toContain("plot_generation");       // L3
    expect(stepIds).toContain("script_generation");     // L4
    expect(stepIds).toContain("quest_generation");      // L5
  });

  it("rpg-srpg with default needs (D=2) gracefully drops L4 script (needs-driven)", () => {
    // 这是 needs 驱动的正确行为：低对话品类不强制跑 script_generation
    const ids = stepsForGenre("rpg-srpg");
    expect(ids).toContain("story_framework"); // L0 仍要
    expect(ids).not.toContain("script_generation"); // L4 跳过
  });
});

describe("B-INTEG ⑥ 8 pipeline templates routing differentiation", () => {
  // C2（2026-08）已封存：tpl-vn 原产出 branch_tree + dialogue_script 专属步骤，
  // 实现本体随 vn-v1 一并搬进 `_archive/vn-v1/`。生产路径全部走 planPipeline()
  // 的通用席位路由，buildAutoSteps 只在 use_legacy_pipeline=true 冷路径命中
  // tpl-vn，此时委托 buildClassicAutoSteps，与未声明专属模板的品类走同一条
  // 通用 L0-L5 链（不再产出已下线的 branch_tree/dialogue_script）。
  it("tpl-vn (legacy fallback) now routes through the generic classic chain", () => {
    const ids = stepsForGenreFull("adv-vn", "branching");
    expect(ids).not.toContain("branch_tree");
    expect(ids).not.toContain("dialogue_script");
    expect(ids).toContain("story_framework");
    expect(ids).toContain("script_generation");
  });

  // C3（2026-08）已封存：card_lore / event_pool 原本是本模板专属 step，现已吸收
  // 进通用 lore_generation / plot_generation（实现本体搬进 `_archive/specialized/`）。
  it("tpl-card-game produces lore_generation + plot_generation (not script_generation)", () => {
    const ids = stepsForGenreFull("card-ccg");
    expect(ids).toContain("lore_generation");
    expect(ids).toContain("plot_generation");
    expect(ids).not.toContain("script_generation");
  });

  it("tpl-narrative-card (Tier4) produces only narrative_card", () => {
    const ids = stepsForGenreFull("puz-match", "minimal");
    expect(ids).toContain("narrative_card");
    // Tier4 不跑 RPG 主链
    expect(ids).not.toContain("story_framework");
    expect(ids).not.toContain("script_generation");
  });

  // C3（2026-08）已封存：region_design / emergent_event 原本是本模板专属 step，
  // 现已吸收进通用 lore_generation / plot_generation（实现本体搬进 `_archive/specialized/`）。
  it("tpl-open-world produces lore_generation + plot_generation (open-world specific path)", () => {
    const ids = stepsForGenreFull("rpg-open-world");
    expect(ids).toContain("lore_generation");
    expect(ids).toContain("plot_generation");
    // open-world 不走经典 L0-L5，专走 lore/plot 驱动的开放世界路径
    expect(ids).not.toContain("story_framework");
  });
});
