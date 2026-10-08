import { describe, it, expect } from "vitest";
import { IP_DNA_SLOT_BLOCK, STRATEGY_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";
import { PROMPT_SLOT_ORDER } from "../prompt/skeleton.js";
import { STEP_TO_STRATEGY_STAGE } from "../prompt/strategy-slots.js";
import { PREFERENCE_SUMMARY_COMPOSER } from "../steps/user-preference-summary.js";
import { INITIAL_PLAN_COMPOSER } from "../steps/initial-plan.js";

import { WORLDVIEW_COMPOSER } from "../steps/worldview-construction.js";
import { CHARACTER_ENRICHMENT_COMPOSER } from "../steps/character-enrichment.js";
import {
  STORY_FRAMEWORK_PLAN_COMPOSER,
  STORY_FRAMEWORK_FILL_COMPOSER,
} from "../steps/story-framework.js";
import { OUTLINE_PLAN_COMPOSER, OUTLINE_FILL_COMPOSER, OUTLINE_GAP_COMPOSER } from "../steps/outline-batch.js";
import {
  DETAIL_PLAN_COMPOSER,
  DETAIL_FILL_COMPOSER,
  DETAIL_GAP_COMPOSER,
} from "../steps/detailed-outline-batch.js";
import { PLOT_GENERATION_COMPOSER } from "../steps/plot-generation.js";
import { SCRIPT_GENERATION_COMPOSER } from "../steps/script-generation.js";
import { SCENE_PLAN_COMPOSER } from "../steps/scene-plan.js";
import { SCRIPT_SCENE_SKELETON_COMPOSER } from "../steps/script-scene-generation.js";
import { QUEST_GENERATION_COMPOSER } from "../steps/quest-generation.js";
import { LORE_GENERATION_COMPOSER } from "../steps/lore-generation.js";
import { NARRATIVE_CARD_COMPOSER } from "../steps/narrative-card.js";
import { ITEM_DATABASE_COMPOSER } from "../steps/item-database.js";

// C1（2026-08）已封存原 6 个 tpl-vn-v2 专属 composer（vn_logline / vn_outline_acts /
// vn_beats / vn_branched_beats / vn_screenplay / vn_storyboard）：随实现一并搬进
// `_archive/vn-v2/`，不再吃三轴策略卡也不再受本骨架契约约束，移出下面各清单。

/**
 * P1.1 单一骨架契约（蓝图 §7.2b / skeleton.ts）。
 *
 * "段序集中化"的可执行形态：IP DNA 注入块（客观真相→三视角算子→关系→账本）
 * 是 **唯一的、集中定义的** `IP_DNA_SLOT_BLOCK` 常量；所有消费 step 必须：
 *   (1) 复用该集中常量，禁止手写自己的 IP DNA 段（杜绝段序/文案漂移）；
 *   (2) 把它放在骨架规定的位置——**身份/任务与叙事策略之后、素材与输出格式之前**。
 *
 * 四期确认内联块即唯一生产路径（md 库已吸收归档），本契约因此长期有效：
 * 未来新增 step 时，段序不会偏离 §7.2b 单一骨架。
 */

// 骨架中排在 IP DNA 段【之后】的插槽对应的 block 名（素材/约束/流程/输出）。
const POST_IPDNA_BLOCKS = new Set<string>([
  "examples",
  "constraints",
  "cot",
  "output",
  "output_format",
  "output_format_hint",
  "output_schema",
  "output_requirements",
]);

const CONSUMING_COMPOSERS: Array<[string, PromptComposer]> = [
  ["worldview", WORLDVIEW_COMPOSER],
  ["character_enrichment", CHARACTER_ENRICHMENT_COMPOSER],
  ["story_framework:plan", STORY_FRAMEWORK_PLAN_COMPOSER],
  ["story_framework:fill", STORY_FRAMEWORK_FILL_COMPOSER],
  ["outline_batch:plan", OUTLINE_PLAN_COMPOSER],
  ["outline_batch:fill", OUTLINE_FILL_COMPOSER],
  ["outline_batch:gap", OUTLINE_GAP_COMPOSER],
  ["detailed_outline:plan", DETAIL_PLAN_COMPOSER],
  ["detailed_outline:fill", DETAIL_FILL_COMPOSER],
  ["detailed_outline:gap", DETAIL_GAP_COMPOSER],
  ["plot_generation", PLOT_GENERATION_COMPOSER],
  ["script_generation", SCRIPT_GENERATION_COMPOSER],
  ["scene_plan", SCENE_PLAN_COMPOSER],
  ["script_scene_generation", SCRIPT_SCENE_SKELETON_COMPOSER],
  ["quest_generation", QUEST_GENERATION_COMPOSER],
  ["lore_generation", LORE_GENERATION_COMPOSER],
  ["narrative_card", NARRATIVE_CARD_COMPOSER],
  ["item_database", ITEM_DATABASE_COMPOSER],
];

/**
 * 吃策略卡的四**席**（PRD v1.4 §4.2.4）：需求清单 / 策划文档 / 故事大纲 / 故事结构。
 * 一席在 RPG 与影游下是不同 step，两边都要接上——否则三轴策略对该管线等于不生效。
 */
const STRATEGY_COMPOSERS: Array<[string, PromptComposer]> = [
  // 需求清单席
  ["preference_summary", PREFERENCE_SUMMARY_COMPOSER],
  // 策划文档席
  ["initial_plan", INITIAL_PLAN_COMPOSER],
  // 故事大纲席（宏观框架）
  ["story_framework:plan", STORY_FRAMEWORK_PLAN_COMPOSER],
  ["story_framework:fill", STORY_FRAMEWORK_FILL_COMPOSER],
  // 故事结构席（微观展开 + 剧情树）
  ["outline_batch:plan", OUTLINE_PLAN_COMPOSER],
  ["outline_batch:fill", OUTLINE_FILL_COMPOSER],
  ["outline_batch:gap", OUTLINE_GAP_COMPOSER],
  ["detailed_outline:plan", DETAIL_PLAN_COMPOSER],
  ["detailed_outline:fill", DETAIL_FILL_COMPOSER],
  ["detailed_outline:gap", DETAIL_GAP_COMPOSER],
];

describe("P1.1 单一骨架契约：IP DNA 段集中定义 + 段序合规", () => {
  it("skeleton.ts 段序与 PRD v1.4 八段一致（角色→任务→策略→IP DNA→约束→流程→素材→输出）", () => {
    const order = PROMPT_SLOT_ORDER;
    expect(order.indexOf("role")).toBe(0);
    expect(order.indexOf("task")).toBe(1);
    // ③ 叙事策略四子槽：品类→类型→题材→结构，且整体排在 IP DNA 之前
    expect(order.indexOf("strategy_genre")).toBeGreaterThan(order.indexOf("task"));
    expect(order.indexOf("strategy_type")).toBeGreaterThan(order.indexOf("strategy_genre"));
    expect(order.indexOf("strategy_theme")).toBeGreaterThan(order.indexOf("strategy_type"));
    expect(order.indexOf("strategy_structure")).toBeGreaterThan(order.indexOf("strategy_theme"));
    expect(order.indexOf("objective_truth")).toBeGreaterThan(order.indexOf("strategy_structure"));
    // ④ IP DNA 四子槽内部顺序不变
    expect(order.indexOf("operators")).toBeGreaterThan(order.indexOf("objective_truth"));
    expect(order.indexOf("relations")).toBeGreaterThan(order.indexOf("operators"));
    expect(order.indexOf("ledger")).toBeGreaterThan(order.indexOf("relations"));
    // ⑤⑥⑦⑧
    expect(order.indexOf("constraints")).toBeGreaterThan(order.indexOf("ledger"));
    expect(order.indexOf("cot")).toBeGreaterThan(order.indexOf("constraints"));
    expect(order.indexOf("material")).toBeGreaterThan(order.indexOf("cot"));
    expect(order.indexOf("output")).toBe(order.length - 1);
  });

  it("STRATEGY_SLOT_BLOCK 段序派生自骨架，不允许手写", () => {
    expect(STRATEGY_SLOT_BLOCK).toBe(
      "{{slot:strategy_genre}}\n\n{{slot:strategy_type}}\n\n{{slot:strategy_theme}}\n\n{{slot:strategy_structure}}",
    );
  });

  it("吃策略卡的环节恰好是四席，与 composer 接线一致", () => {
    expect(Object.keys(STEP_TO_STRATEGY_STAGE).sort()).toEqual([
      "detailed_outline",
      "initial_plan",
      "outline_batch",
      "preference_summary",
      "story_framework",
    ]);
    // 五个 step 收敛到四个环节，一个都不多
    expect(new Set(Object.values(STEP_TO_STRATEGY_STAGE))).toEqual(
      new Set(["demand", "design", "outline", "structure"]),
    );
    const wired = new Set(STRATEGY_COMPOSERS.map(([, c]) => c.stepId));
    expect([...wired].sort()).toEqual(Object.keys(STEP_TO_STRATEGY_STAGE).sort());
  });

  for (const [label, composer] of STRATEGY_COMPOSERS) {
    it(`[${label}] 复用集中的 STRATEGY_SLOT_BLOCK，且策略段在 IP DNA 之前`, () => {
      expect(composer.blocks?.strategy, `${label} 的 strategy 必须 === STRATEGY_SLOT_BLOCK`).toBe(
        STRATEGY_SLOT_BLOCK,
      );
      const order = composer.systemBlockOrder ?? [];
      const iStrategy = order.indexOf("strategy");
      expect(iStrategy, `${label} systemBlockOrder 未含 strategy`).toBeGreaterThanOrEqual(1);
      const iIp = order.indexOf("ip_dna");
      if (iIp >= 0) expect(iStrategy).toBeLessThan(iIp);
    });
  }

  /**
   * 每席「机制与流程」段（骨架第 ⑥ 槽）的覆盖清单。
   *
   * 四期从归档 md 吸收而来：这一段是模型的作业顺序与自检表，缺了它模型只知道
   * 要产出什么、不知道该按什么次序想，最典型的后果是先写细节再补主题。
   * 多子步的 step 只要求主创那一步有（plan / skeleton），fill 与 gap 是机械补漏，
   * 塞流程段反而干扰。
   */
  const COT_REQUIRED: Array<[string, PromptComposer]> = [
    ["preference_summary", PREFERENCE_SUMMARY_COMPOSER],
    ["initial_plan", INITIAL_PLAN_COMPOSER],
    ["worldview", WORLDVIEW_COMPOSER],
    ["character_enrichment", CHARACTER_ENRICHMENT_COMPOSER],
    ["item_database", ITEM_DATABASE_COMPOSER],
    ["scene_plan", SCENE_PLAN_COMPOSER],
    ["story_framework:plan", STORY_FRAMEWORK_PLAN_COMPOSER],
    ["outline_batch:plan", OUTLINE_PLAN_COMPOSER],
    ["detailed_outline:plan", DETAIL_PLAN_COMPOSER],
    ["plot_generation", PLOT_GENERATION_COMPOSER],
    ["quest_generation", QUEST_GENERATION_COMPOSER],
    ["script_generation", SCRIPT_GENERATION_COMPOSER],
    ["narrative_card", NARRATIVE_CARD_COMPOSER],
    ["lore_generation", LORE_GENERATION_COMPOSER],
  ];

  for (const [label, composer] of COT_REQUIRED) {
    it(`[${label}] 声明机制与流程段，且排在输出格式之前`, () => {
      const order = composer.systemBlockOrder ?? [];
      expect(order, `${label} systemBlockOrder 未含 cot`).toContain("cot");
      expect(composer.blocks?.cot, `${label} 缺 cot 块`).toBeDefined();

      // 流程段必须在输出格式之前：先讲怎么想，再讲怎么写。
      const iCot = order.indexOf("cot");
      for (const out of ["output", "output_format", "output_schema", "output_format_hint"]) {
        const iOut = order.indexOf(out);
        if (iOut >= 0) expect(iCot, `${label}: cot 应排在 ${out} 之前`).toBeLessThan(iOut);
      }
    });
  }

  for (const [label, composer] of CONSUMING_COMPOSERS) {
    it(`[${label}] 复用集中的 IP_DNA_SLOT_BLOCK，且段序合规`, () => {
      const order = composer.systemBlockOrder ?? [];

      // (1) 必须复用集中常量，禁止手写。
      expect(composer.blocks?.ip_dna, `${label} 应声明 ip_dna 块`).toBeDefined();
      expect(composer.blocks?.ip_dna, `${label} 的 ip_dna 必须 === IP_DNA_SLOT_BLOCK`).toBe(
        IP_DNA_SLOT_BLOCK,
      );

      // (2) ip_dna 必须在块序里，且不在首位（身份块之后）。
      const iIp = order.indexOf("ip_dna");
      expect(iIp, `${label} systemBlockOrder 未含 ip_dna`).toBeGreaterThanOrEqual(1);

      // (3) ip_dna 必须排在所有"素材/约束/输出"类块之前。
      for (let i = 0; i < iIp; i++) {
        expect(
          POST_IPDNA_BLOCKS.has(order[i]!),
          `${label}: "${order[i]}" 属素材/输出段，不应排在 IP DNA 之前`,
        ).toBe(false);
      }

      /**
       * (4) 反过来，叙事策略段必须排在 IP DNA 之前。
       *
       * 这一条与本文件早先的写法正好相反——那时品类风格被归为"IP DNA 之后"。
       * 骨架三期换过轴（见 prompt/skeleton.ts 头部）：策略先立、DNA 后填，免得品类
       * 风格被算子内容淹没。契约当时没跟着改，于是十个 step 一直按旧序排，而骨架
       * 那份说明写的是新序——两边各说各话，谁也不知道以哪个为准。这里收口到骨架。
       */
      for (const strategyBlock of ["strategy", "style_guide", "worldview_archetype", "character_archetype"]) {
        const iStrategy = order.indexOf(strategyBlock);
        if (iStrategy >= 0) {
          expect(iStrategy, `${label}: "${strategyBlock}" 应排在 IP DNA 之前`).toBeLessThan(iIp);
        }
      }
    });
  }
});
