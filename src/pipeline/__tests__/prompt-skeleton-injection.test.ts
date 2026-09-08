import { describe, it, expect } from "vitest";
import { PLOT_GENERATION_COMPOSER } from "../steps/plot-generation.js";
import { QUEST_GENERATION_COMPOSER } from "../steps/quest-generation.js";
import { LORE_GENERATION_COMPOSER } from "../steps/lore-generation.js";
import { NARRATIVE_CARD_COMPOSER } from "../steps/narrative-card.js";
import { OUTLINE_PLAN_COMPOSER } from "../steps/outline-batch.js";
import { DETAIL_FILL_COMPOSER } from "../steps/detailed-outline-batch.js";
import { SCENE_PLAN_COMPOSER } from "../steps/scene-plan.js";
import { SCRIPT_SCENE_SKELETON_COMPOSER } from "../steps/script-scene-generation.js";
import { composeSystemPrompt, type PromptComposer } from "../runtime/prompt-composer.js";
import type { NarrativeContext } from "../../types/index.js";

/**
 * D-C 迁移验证：核心消费节点的 system prompt 通过 composeSystemPrompt 走"结构化插槽"
 * 而非"末尾 append"。模拟 prepareInjection 之后的 ctx 状态（已写入分段）。
 */
function makeCtx(withInjection: boolean): NarrativeContext {
  const ctx: Record<string, unknown> = {};
  if (withInjection) {
    ctx._operator_injection_sections = {
      plot_generation: {
        objective_truth: "## 客观真相（IP 叙事内核切片，须忠实遵守）\n- 主题：救赎与代价",
        operators: "## IP DNA 算子注入（三视角同台·一步法 §7.2b）\n作者/读者/角色三视角...",
        relations: "## 关系网络（KAG，须在生成中保持一致）\n艾琳 -盟友- 卡尔",
        ledger: "## 长记忆账本（续写改写一致性约束）\n设定：魔法以血为代价",
      },
    };
  }
  return ctx as unknown as NarrativeContext;
}

describe("prompt skeleton structured injection (D-C)", () => {
  it("places IP DNA sections as first-class slots in §7.2b order (truth→operators→relations→ledger)", () => {
    const sp = composeSystemPrompt(PLOT_GENERATION_COMPOSER, makeCtx(true));

    const iRole = sp.indexOf("叙事与游戏剧本设计师");
    const iTruth = sp.indexOf("客观真相");
    const iOps = sp.indexOf("三视角同台");
    const iRel = sp.indexOf("关系网络");
    const iLed = sp.indexOf("长记忆账本");

    // 身份在最前，IP DNA 段落紧随其后、且段序严格对齐 §7.2b。
    expect(iRole).toBeGreaterThanOrEqual(0);
    expect(iTruth).toBeGreaterThan(iRole);
    expect(iOps).toBeGreaterThan(iTruth);
    expect(iRel).toBeGreaterThan(iOps);
    expect(iLed).toBeGreaterThan(iRel);

    // step 自身的输出格式契约仍在（base 块），未被注入覆盖。
    expect(sp).toContain("输出格式");

    // 无占位残留。
    expect(sp).not.toContain("{{slot:");
    expect(sp).not.toContain("{{SKILL.");
  });

  it("collapses cleanly to baseline when no IP DNA injection (no residue, no blank-line bloat)", () => {
    const sp = composeSystemPrompt(PLOT_GENERATION_COMPOSER, makeCtx(false));
    expect(sp).not.toContain("{{slot:");
    expect(sp).not.toContain("客观真相");
    // 空插槽塌缩，不留 3+ 连续换行。
    expect(sp).not.toMatch(/\n{3,}/);
    // 身份与三重约束仍在（基线不被破坏）。
    expect(sp).toContain("叙事与游戏剧本设计师");
    expect(sp).toContain("三重约束");
  });
});

/**
 * 批1 h1 回归：为消费算子的其余 step 补挂结构化插槽后，
 * 每个 step 在有注入时都走结构化插槽（段序对齐 §7.2b、无占位残留），
 * 无注入时整块塌缩、基线不破坏。
 */
function makeCtxForStep(stepId: string, withInjection: boolean): NarrativeContext {
  const ctx: Record<string, unknown> = {};
  if (withInjection) {
    ctx._operator_injection_sections = {
      [stepId]: {
        objective_truth: "## 客观真相（IP 叙事内核切片，须忠实遵守）\n- 主题：救赎与代价",
        operators: "## IP DNA 算子注入（三视角同台·一步法 §7.2b）\n作者/读者/角色三视角...",
        relations: "## 关系网络（KAG，须在生成中保持一致）\n艾琳 -盟友- 卡尔",
        ledger: "## 长记忆账本（续写改写一致性约束）\n设定：魔法以血为代价",
      },
    };
  }
  return ctx as unknown as NarrativeContext;
}

describe("batch1 h1: structured injection covers remaining consuming steps", () => {
  const cases: Array<[string, PromptComposer]> = [
    ["quest_generation", QUEST_GENERATION_COMPOSER],
    ["lore_generation", LORE_GENERATION_COMPOSER],
    ["narrative_card", NARRATIVE_CARD_COMPOSER],
    ["outline_batch", OUTLINE_PLAN_COMPOSER],
    ["detailed_outline", DETAIL_FILL_COMPOSER],
    ["scene_plan", SCENE_PLAN_COMPOSER],
    ["script_scene_generation", SCRIPT_SCENE_SKELETON_COMPOSER],
  ];

  for (const [stepId, composer] of cases) {
    it(`[${stepId}] fills IP DNA slots in §7.2b order with no residue`, () => {
      const sp = composeSystemPrompt(composer, makeCtxForStep(stepId, true));
      const iTruth = sp.indexOf("客观真相");
      const iOps = sp.indexOf("三视角同台");
      const iRel = sp.indexOf("关系网络");
      const iLed = sp.indexOf("长记忆账本");
      expect(iTruth).toBeGreaterThanOrEqual(0);
      expect(iOps).toBeGreaterThan(iTruth);
      expect(iRel).toBeGreaterThan(iOps);
      expect(iLed).toBeGreaterThan(iRel);
      expect(sp).not.toContain("{{slot:");
      expect(sp).not.toContain("{{SKILL.");
    });

    it(`[${stepId}] collapses cleanly without injection`, () => {
      const sp = composeSystemPrompt(composer, makeCtxForStep(stepId, false));
      expect(sp).not.toContain("{{slot:");
      expect(sp).not.toContain("客观真相");
      expect(sp).not.toMatch(/\n{3,}/);
    });
  }
});
