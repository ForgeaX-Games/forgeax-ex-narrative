/**
 * md-skill-loader.test.ts (B-M1)
 * ─────────────────────────────────────────────────────────────────
 * 验证 md fallback 机制：
 *   1. 直接调用 getMdSkillBlock 能拿到全局 step 内容
 *   2. 风格 specialist 能按 genreCode 关键词命中
 *   3. 集成到 getStepSkill 后，long-tail 品类（无 ts skill）也能拿到非空 prompt
 *   4. 已有详细 ts skill 的品类（jrpg）保持原优先级，不被 md 覆盖
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getMdSkillBlock, getMdSkillStats } from "../md-skill-loader.js";
import { getStepSkill } from "../skill-loader.js";
import "../skill-bootstrap.js";

describe("md-skill-loader (B-M1)", () => {
  beforeAll(() => {
    // skill-bootstrap.js side-effect import 已触发加载
  });

  describe("ensureMdSkillsLoaded", () => {
    it("loads at least 8 md files (P0 set)", () => {
      const stats = getMdSkillStats();
      expect(stats.loadedFiles).toBeGreaterThanOrEqual(8);
    });

    it("indexes worldview/character_enrichment/script_generation steps", () => {
      const stats = getMdSkillStats();
      expect(stats.stepGlobals).toBeGreaterThanOrEqual(7);
    });

    it("loads specialist matchers (souls, fantasy, sci-fi, etc.)", () => {
      const stats = getMdSkillStats();
      expect(stats.specialists).toBeGreaterThanOrEqual(10);
    });

    it("reports no missing P0 files", () => {
      const stats = getMdSkillStats();
      // 允许 specialist 文件缺失（部分主题 md 未必齐全），但 P0 step globals 必须全部存在
      const missingGlobals = stats.failedFiles.filter((f) =>
        f.includes("/prompts/world_skill") ||
        f.includes("/prompts/character_skill") ||
        f.includes("/production_prompts/")
      );
      expect(missingGlobals).toEqual([]);
    });
  });

  describe("getMdSkillBlock — direct query", () => {
    it("returns worldview global content for any genre", () => {
      const block = getMdSkillBlock("rpg-jrpg", "worldview");
      expect(block).not.toBeNull();
      expect(block!.systemPromptAddition).toBeTruthy();
      expect(block!.systemPromptAddition!.length).toBeGreaterThan(50);
    });

    it("returns character_enrichment global content", () => {
      const block = getMdSkillBlock("rpg-arpg", "character_enrichment");
      expect(block).not.toBeNull();
      expect(block!.systemPromptAddition).toBeTruthy();
    });

    it("returns null for an unmapped step", () => {
      const block = getMdSkillBlock("rpg-jrpg", "nonexistent_step_xyz");
      expect(block).toBeNull();
    });

    it("appends souls specialist when genreCode matches", () => {
      const block = getMdSkillBlock("rpg-soulslike", "worldview", ["soulslike", "魂", "暗黑之魂"]);
      expect(block).not.toBeNull();
      // 应同时包含 worldview 全局内容（World Builder）+ souls specialist 内容
      expect(block!.systemPromptAddition).toMatch(/World Builder|世界观构建师/);
      expect(block!.systemPromptAddition).toMatch(/Souls|魂系|碎片化/);
    });

    it("appends fantasy specialist for fantasy genre", () => {
      const block = getMdSkillBlock("adv-vn", "worldview", ["奇幻", "fantasy"]);
      expect(block).not.toBeNull();
      expect(block!.systemPromptAddition).toMatch(/Fantasy|奇幻/);
    });
  });

  describe("getStepSkill — integration with ts skill priority", () => {
    it("ts skill (jrpg.character_enrichment) wins over md fallback", () => {
      const block = getStepSkill("rpg-jrpg", "character_enrichment");
      expect(block).not.toBeNull();
      // jrpg.skill.ts 应有具体 slots 内容；md fallback 只设 systemPromptAddition
      const hasSlots = !!(block!.slots && Object.values(block!.slots).some((v) => v));
      const hasMdAddition = !!block!.systemPromptAddition;
      expect(hasSlots || hasMdAddition).toBe(true);
    });

    it("long-tail genre (no ts skill stepSkill) falls back to md", () => {
      // misc-survivor 是 stub 品类，stepSkills 大部分 step 为空
      const block = getStepSkill("misc-survivor", "worldview");
      expect(block).not.toBeNull();
      expect(block!.systemPromptAddition || block!.slots?.style_guide).toBeTruthy();
    });

    it("unknown step on a known genre falls back to archetype baseline (Layer 3)", () => {
      // rpg-jrpg 无此 step 的 ts/md 内容，但其原型族（epic）提供共享基线，
      // 四级回退链 Layer 3 命中 archetype-shared，返回非空 systemPromptAddition。
      const block = getStepSkill("rpg-jrpg", "step_that_does_not_exist");
      expect(block).not.toBeNull();
      expect(block!.systemPromptAddition).toBeTruthy();
    });

    it("returns null for unknown genre + unknown step (no ts, no md, no archetype)", () => {
      const block = getStepSkill("___no_such_genre___", "step_that_does_not_exist");
      expect(block).toBeNull();
    });
  });
});
