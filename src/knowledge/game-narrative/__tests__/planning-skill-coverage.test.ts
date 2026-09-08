/**
 * planning-skill-coverage.test.ts (B-M6 / D13-A)
 * ─────────────────────────────────────────────────────────────────
 * 验证 long-tail-genres 的 augment 机制：
 *   - 94 品类全部至少有 D0-D4 五个策划 step 的 stepSkill
 *   - 手写 7 个高频品类的现有 stepSkills 没有被覆盖
 *   - buildSkillSystemPrompt 能拿到非空的 systemPromptAddition
 */

import { describe, it, expect } from "vitest";
import "../skill-bootstrap.js";
import { GENRE_TAXONOMY } from "../../genre-taxonomy.js";
import { loadSkill, getStepSkill, renderStepSkillForSystemPrompt } from "../skill-loader.js";

const PLANNING_STEPS = ["core_concept", "system_architecture", "system_detail", "value_framework", "design_doc"] as const;

describe("D13-A planning skill coverage (94 genres × 5 D-steps)", () => {
  it("every genre in GENRE_TAXONOMY has all 5 D0-D4 stepSkills registered", () => {
    const missing: Array<{ genre: string; step: string }> = [];
    for (const entry of GENRE_TAXONOMY) {
      const skill = loadSkill(entry.code);
      expect(skill, `genre ${entry.code} must have a registered NarrativeSkill`).not.toBeNull();
      for (const step of PLANNING_STEPS) {
        if (!skill?.stepSkills[step]) {
          missing.push({ genre: entry.code, step });
        }
      }
    }
    expect(missing, `${missing.length} (genre, step) pairs missing D0-D4 stepSkill`).toEqual([]);
  });

  it("planning stepSkill renders to non-empty system prompt addition", () => {
    // pick 5 representative genres across tiers/categories
    const samples = ["rpg-jrpg", "adv-vn", "card-ccg", "rpg-roguelike", "puz-match"];
    for (const code of samples) {
      const block = getStepSkill(code, "core_concept");
      expect(block, `${code}/core_concept block must exist`).not.toBeNull();
      const text = renderStepSkillForSystemPrompt(block);
      expect(text.length, `${code}/core_concept rendered text must be non-empty`).toBeGreaterThan(50);
      expect(text).toContain(code);
    }
  });

  it("hand-written narrative stepSkills are NOT overwritten by augment", () => {
    // rpg-jrpg has hand-written worldview/character/story_framework/script_generation
    // these slots must remain after planning augment (not be overwritten with stub summary)
    const jrpg = loadSkill("rpg-jrpg");
    expect(jrpg).not.toBeNull();
    const wv = jrpg?.stepSkills.worldview;
    expect(wv?.slots?.worldview_archetype, "worldview_archetype must remain hand-written").toMatch(/JRPG/);
    expect(wv?.slots?.style_guide, "style_guide must remain hand-written, not stub summary").toMatch(/12 槽位|私人化|地理|神话|恢弘/);
  });

  it("each tier produces differentiated D0 narrative emphasis", () => {
    // Tier1 重叙事品类应该说"剧情体验"; Tier4 极轻叙事品类应该说"玩法机制"
    const tier1Heavy = renderStepSkillForSystemPrompt(getStepSkill("rpg-crpg", "core_concept"));
    const tier4Light = renderStepSkillForSystemPrompt(getStepSkill("puz-match", "core_concept"));
    expect(tier1Heavy).toMatch(/剧情体验|叙事 hook/);
    // Tier4 三消 narrative_ratio 极低，应当是"玩法机制"
    expect(tier4Light).toMatch(/玩法机制|玩法乐趣|玩法循环/);
  });
});
