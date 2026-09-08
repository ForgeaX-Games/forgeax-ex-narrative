import { describe, it, expect } from "vitest";
import { STEP_REGISTRY } from "../core/step-registry.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import "../core/step-registrations.js";
import {
  STORY_FRAMEWORK_PLAN_COMPOSER,
  STORY_FRAMEWORK_FILL_COMPOSER,
} from "../steps/story-framework.js";
import {
  OUTLINE_PLAN_COMPOSER,
  OUTLINE_FILL_COMPOSER,
  OUTLINE_GAP_COMPOSER,
} from "../steps/outline-batch.js";
import {
  DETAIL_PLAN_COMPOSER,
  DETAIL_FILL_COMPOSER,
  DETAIL_GAP_COMPOSER,
} from "../steps/detailed-outline-batch.js";
import { SCENE_PLAN_COMPOSER } from "../steps/scene-plan.js";

/**
 * 多阶 step 不进 STEP_REGISTRY.composer（一个 step 多个 composer，注册单数字段装不下），
 * 但它们同样受骨架约束，所以在此显式点名补进审计面。
 */
const MULTI_PHASE_COMPOSERS: Array<[string, PromptComposer]> = [
  ["story_framework:plan", STORY_FRAMEWORK_PLAN_COMPOSER],
  ["story_framework:fill", STORY_FRAMEWORK_FILL_COMPOSER],
  ["outline_batch:plan", OUTLINE_PLAN_COMPOSER],
  ["outline_batch:fill", OUTLINE_FILL_COMPOSER],
  ["outline_batch:gap", OUTLINE_GAP_COMPOSER],
  ["detailed_outline:plan", DETAIL_PLAN_COMPOSER],
  ["detailed_outline:fill", DETAIL_FILL_COMPOSER],
  ["detailed_outline:gap", DETAIL_GAP_COMPOSER],
  ["scene_plan", SCENE_PLAN_COMPOSER],
];

/**
 * 八段骨架的**块序审计**：skeleton-contract.test.ts 逐个点名校验重点 composer，
 * 本文件反过来扫全注册表，保证新增 step 不会绕过骨架。
 *
 * 只锁四条能从块名与块内容判定的硬规则。风格/示例/手法这些段落在 ⑤ 之前还是之后
 * 属可调口径，不在此设限——它们由 skeleton-contract 的 POST_IPDNA_BLOCKS 管。
 */

/** ① 角色段的块名（含把角色与任务并在一块的历史写法 base）。 */
const ROLE_BLOCKS = new Set(["role", "base"]);

/** ② 任务段的块名。 */
const TASK_BLOCKS = new Set([
  "task",
  "task_spec",
  "task_requirements",
  "extraction_guide",
  "slot_system",
]);

/** ⑧ 输出格式段的块名。 */
const OUTPUT_BLOCKS = new Set([
  "output",
  "output_format",
  "output_format_hint",
  "output_schema",
  "output_requirements",
]);

/**
 * 内联输出格式的特征串。
 *
 * 出现在角色/任务块里就意味着模型先读到 JSON 骨架、后读到要它想什么——
 * 段序被字符串拼接绕过了，systemBlockOrder 再对也没用。
 */
const INLINE_OUTPUT_MARKERS = [/输出\s*JSON/, /###?\s*输出格式/, /输出JSON格式/, /输出JSON对象/];

function composersInRegistry(): Array<[string, PromptComposer]> {
  const found: Array<[string, PromptComposer]> = [];
  for (const [stepId, desc] of STEP_REGISTRY) {
    const composer = (desc as { composer?: PromptComposer }).composer;
    if (composer) found.push([stepId, composer]);
  }
  return found;
}

function allAuditedComposers(): Array<[string, PromptComposer]> {
  return [...composersInRegistry(), ...MULTI_PHASE_COMPOSERS];
}

function resolveStatic(block: PromptComposer["blocks"][string] | undefined): string {
  return typeof block === "string" ? block : "";
}

describe("八段骨架块序审计（全注册表）", () => {
  it("注册表里真有 composer 可审", () => {
    expect(composersInRegistry().length).toBeGreaterThan(10);
  });

  for (const [stepId, composer] of allAuditedComposers()) {
    const order = composer.systemBlockOrder ?? [];

    it(`[${stepId}] ① 角色段在最前`, () => {
      const first = order[0];
      expect(first, `${stepId} systemBlockOrder 为空`).toBeDefined();
      expect(
        ROLE_BLOCKS.has(first!) || TASK_BLOCKS.has(first!),
        `${stepId} 首块是 "${first}"，应是角色或任务段`,
      ).toBe(true);
    });

    it(`[${stepId}] ② 任务段排在 ④ IP DNA 之前`, () => {
      const iIp = order.indexOf("ip_dna");
      if (iIp < 0) return;
      const iTask = order.findIndex((name) => TASK_BLOCKS.has(name));
      if (iTask < 0) return; // 任务并在 base 里的历史写法，由下一条规则兜
      expect(iTask, `${stepId}: 任务段应排在 IP DNA 之前`).toBeLessThan(iIp);
    });

    it(`[${stepId}] ⑧ 输出格式段在最后`, () => {
      const iOut = order.findIndex((name) => OUTPUT_BLOCKS.has(name));
      if (iOut < 0) return;
      expect(iOut, `${stepId}: 输出格式段后面还有 "${order.slice(iOut + 1).join(", ")}"`).toBe(
        order.length - 1,
      );
    });

    it(`[${stepId}] 输出格式不内联在角色/任务块里`, () => {
      const offenders: string[] = [];
      for (const name of order) {
        if (!ROLE_BLOCKS.has(name) && !TASK_BLOCKS.has(name)) continue;
        const text = resolveStatic(composer.blocks[name]);
        if (INLINE_OUTPUT_MARKERS.some((re) => re.test(text))) offenders.push(name);
      }
      expect(
        offenders,
        `${stepId}: 这些块内联了输出格式，应拆到 output 槽并置于末位`,
      ).toEqual([]);
    });
  }
});
