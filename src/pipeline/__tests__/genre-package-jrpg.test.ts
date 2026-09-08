/**
 * Phase 3 标杆验证：rpg-jrpg 品类叙事包端到端闭环。
 *  1. skill.narrativeSteps 声明七单品链（Planner 分支已随 D1 封存，
 *     见 `_archive/planner/__tests__/genre-package-jrpg-planner.test.ts`）
 *  2. PromptResolver 双层注入：定位品类专属 prompts/worldview.md（覆盖通用骨架）
 */
import { describe, it, expect } from "vitest";
import "../../knowledge/game-narrative/skill-bootstrap.js";
import { loadSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { getStepSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { PromptResolver } from "../blueprint/prompt-resolver.js";

describe("Phase 3: rpg-jrpg 品类叙事包闭环", () => {
  it("skill 声明 narrativeSteps（七单品链 ②-⑦）", () => {
    const skill = loadSkill("rpg-jrpg");
    expect(skill?.narrativeSteps).toBeDefined();
    expect(skill!.narrativeSteps!).toContain("worldview");
    expect(skill!.narrativeSteps!).toContain("script_generation");
    // 末尾并行组：任务 ∥ 场景
    const last = skill!.narrativeSteps![skill!.narrativeSteps!.length - 1];
    expect(Array.isArray(last)).toBe(true);
    expect(last).toEqual(["quest_generation", "scene_plan"]);
  });

  it("PromptResolver 双层注入：加载 rpg-jrpg 专属 worldview prompt", () => {
    const skill = getStepSkill("rpg-jrpg", "worldview");
    const resolved = PromptResolver.resolveFromTemplate(
      { templateId: "worldview", skillSlots: ["worldview_archetype", "style_guide", "constraints", "examples"] },
      skill,
      "rpg-jrpg",
    );
    // 品类专属骨架特征（仅 JRPG 专属 prompt 含"故乡"锚点要求）
    expect(resolved.systemPrompt).toContain("故乡");
    expect(resolved.systemPrompt).toContain("英雄之旅");
    // SKILL 槽位已填充（worldview_archetype 内容注入）
    expect(resolved.systemPrompt).toContain("元素属性体系");
  });

  it("无专属 prompt 的 step 回退通用骨架（character_enrichment）", () => {
    const skill = getStepSkill("rpg-jrpg", "character_enrichment");
    const resolved = PromptResolver.resolveFromTemplate(
      { templateId: "character_enrichment", skillSlots: ["character_archetype", "style_guide", "constraints"] },
      skill,
      "rpg-jrpg",
    );
    // 通用骨架标题
    expect(resolved.systemPrompt).toContain("角色塑造专家");
    // 品类 slot 注入（character_archetype）
    expect(resolved.systemPrompt).toContain("同伴 = 家人");
  });
});
