import { describe, it, expect } from "vitest";
import { composeSystemPrompt, type PromptComposer } from "../runtime/prompt-composer.js";
import type { NarrativeContext } from "../../types/index.js";

// ── RPG / 层级树管线消费 step 的 composer ──
import { WORLDVIEW_COMPOSER } from "../steps/worldview-construction.js";
import { CHARACTER_ENRICHMENT_COMPOSER } from "../steps/character-enrichment.js";
import {
  STORY_FRAMEWORK_PLAN_COMPOSER,
  STORY_FRAMEWORK_FILL_COMPOSER,
} from "../steps/story-framework.js";
import { OUTLINE_PLAN_COMPOSER, OUTLINE_FILL_COMPOSER } from "../steps/outline-batch.js";
import { DETAIL_PLAN_COMPOSER, DETAIL_FILL_COMPOSER } from "../steps/detailed-outline-batch.js";
import { PLOT_GENERATION_COMPOSER } from "../steps/plot-generation.js";
import { SCRIPT_GENERATION_COMPOSER } from "../steps/script-generation.js";
import { SCENE_PLAN_COMPOSER } from "../steps/scene-plan.js";
import { SCRIPT_SCENE_SKELETON_COMPOSER, SCRIPT_SCENE_EXPAND_COMPOSER } from "../steps/script-scene-generation.js";
import { QUEST_GENERATION_COMPOSER } from "../steps/quest-generation.js";
import { LORE_GENERATION_COMPOSER } from "../steps/lore-generation.js";
import { NARRATIVE_CARD_COMPOSER } from "../steps/narrative-card.js";
import { ITEM_DATABASE_COMPOSER } from "../steps/item-database.js";

// C1（2026-08）已封存原「VN / 互动影游管线消费 step 的 composer」5 项
// （vn_outline_acts / vn_beats / vn_branched_beats / vn_screenplay / vn_storyboard）：
// 随 tpl-vn-v2 一并搬进 `_archive/vn-v2/`，不再是任何活跑管线的生产真值，
// 移出本文件的 golden 快照集合。历史快照仍可在 git 历史中查证。

/**
 * P0 生产真值验收（路线图地基）。
 *
 * 目的：把"每个消费算子的生成 step，其 system prompt 真实产出"冻结成 golden 快照，
 * 作为 P1（统一骨架/消除双引擎/文本迁 .md）重构期间的安全网——
 * 任何**意外**改变生产提示词都会让快照失败；**有意**变更则需显式更新快照。
 *
 * 同时强约束 §7.2b 骨架段序（客观真相→三视角算子→关系→账本），
 * 保证 IP DNA 注入始终是骨架内一等插槽、而非末尾 append。
 *
 * 注：通过手工写入 ctx._operator_injection_sections 模拟 prepareInjection 之后的状态
 * （确定性、无 LLM/IO），与生产路径 composeSystemPrompt 完全一致地消费这些分段。
 */

const INJECTED_SECTIONS = {
  objective_truth: "## 客观真相（IP 叙事内核切片，须忠实遵守）\n- 主题：救赎与代价\n- 核心冲突：自由意志 vs 宿命",
  operators:
    "## IP DNA 算子注入（三视角同台·一步法 §7.2b）\n下面提供本节点应消费的【作者 / 读者·玩家 / 角色】三视角算子。",
  relations: "## 关系网络（KAG，须在生成中保持一致）\n艾琳 -盟友- 卡尔；卡尔 -宿敌- 影主",
  ledger: "## 长记忆账本（续写改写一致性约束）\n设定：魔法以血为代价；事实：艾琳左臂有契约纹",
} as const;

/** 模拟 prepareInjection 之后、注入已落到 ctx 的状态（按 composer.stepId 键入）。 */
function ctxWithInjection(stepId: string): NarrativeContext {
  return {
    _operator_injection_sections: { [stepId]: { ...INJECTED_SECTIONS } },
  } as unknown as NarrativeContext;
}

/** 无 IP DNA 驱动的常规生成（基线）：占位应整块塌缩、无残留。 */
function emptyCtx(): NarrativeContext {
  return {} as unknown as NarrativeContext;
}

const CONSUMING_COMPOSERS: Array<[string, PromptComposer]> = [
  ["worldview", WORLDVIEW_COMPOSER],
  ["character_enrichment", CHARACTER_ENRICHMENT_COMPOSER],
  ["story_framework:plan", STORY_FRAMEWORK_PLAN_COMPOSER],
  ["story_framework:fill", STORY_FRAMEWORK_FILL_COMPOSER],
  ["outline_batch:plan", OUTLINE_PLAN_COMPOSER],
  ["outline_batch:fill", OUTLINE_FILL_COMPOSER],
  ["detailed_outline:plan", DETAIL_PLAN_COMPOSER],
  ["detailed_outline:fill", DETAIL_FILL_COMPOSER],
  ["plot_generation", PLOT_GENERATION_COMPOSER],
  ["script_generation", SCRIPT_GENERATION_COMPOSER],
  ["scene_plan", SCENE_PLAN_COMPOSER],
  ["script_scene_generation", SCRIPT_SCENE_SKELETON_COMPOSER],
  ["script_scene_generation:expand", SCRIPT_SCENE_EXPAND_COMPOSER],
  ["quest_generation", QUEST_GENERATION_COMPOSER],
  ["lore_generation", LORE_GENERATION_COMPOSER],
  ["narrative_card", NARRATIVE_CARD_COMPOSER],
  ["item_database", ITEM_DATABASE_COMPOSER],
];

describe("P0 生产真值 golden：消费 step 的 system prompt（注入态）", () => {
  for (const [label, composer] of CONSUMING_COMPOSERS) {
    it(`[${label}] 注入态 system prompt 冻结为 golden + §7.2b 段序`, () => {
      const sp = composeSystemPrompt(composer, ctxWithInjection(composer.stepId));

      // 无占位残留（slot / SKILL 占位都已渲染）。
      expect(sp).not.toContain("{{slot:");
      expect(sp).not.toContain("{{SKILL.");

      // §7.2b 段序：客观真相 → 三视角算子 → 关系 → 账本，均为骨架内一等段。
      const iTruth = sp.indexOf("客观真相");
      const iOps = sp.indexOf("三视角同台");
      const iRel = sp.indexOf("关系网络");
      const iLed = sp.indexOf("长记忆账本");
      expect(iTruth, `${label} 缺客观真相段`).toBeGreaterThanOrEqual(0);
      expect(iOps, `${label} 算子段未在客观真相之后`).toBeGreaterThan(iTruth);
      expect(iRel, `${label} 关系段未在算子之后`).toBeGreaterThan(iOps);
      expect(iLed, `${label} 账本段未在关系之后`).toBeGreaterThan(iRel);

      // 冻结全文：P1 重构若改变任何 step 的生产提示词，此处即失败。
      expect(sp).toMatchSnapshot();
    });

    it(`[${label}] 基线态（无注入）冻结为 golden + 塌缩干净`, () => {
      const sp = composeSystemPrompt(composer, emptyCtx());
      expect(sp).not.toContain("{{slot:");
      expect(sp).not.toContain("{{SKILL.");
      expect(sp).not.toContain("客观真相");
      // 空插槽塌缩，不留 3+ 连续换行。
      expect(sp).not.toMatch(/\n{3,}/);
      expect(sp).toMatchSnapshot();
    });
  }

  it("覆盖面不回退：消费 step golden 数量不少于 17", () => {
    // C1（2026-08）前基线是 22（含 5 个 tpl-vn-v2 专属 composer）；那 5 个已随
    // vn-v2 一并封存（不再是任何活跑管线的生产真值），门槛相应下调到 17——
    // 这是一次性、有登记的下调，不是往后允许静默减项。
    expect(CONSUMING_COMPOSERS.length).toBeGreaterThanOrEqual(17);
  });
});
