/**
 * pipeline/prompt/ —— 统一提示词组装模块（蓝图 §7.2b）。
 *
 * 收敛"分散在多个来源"的提示词为：
 *   一份固定骨架段序（skeleton.PROMPT_SLOT_ORDER）+ 单一占位语法（syntax）
 *   + 可插拔片段提供器（providers）。
 *
 * **唯一生产引擎 = 模板路径**：所有消费算子的 step 经 PromptComposer 的 IP_DNA_SLOT_BLOCK
 *   （{{slot:objective_truth/operators/relations/ledger}}，其段序直接派生自 PROMPT_SLOT_ORDER）
 *   或 .md 模板声明插槽，由 composeSystemPrompt → buildSlotMap 结构化填充，段序与 §7.2b 一致。
 *
 * skeleton.ts 提供**段序契约的单一事实源**（PROMPT_SLOT_ORDER 等数据 + 纯函数 assemblePrompt
 * 参考实现）；生产引擎复用该 PROMPT_SLOT_ORDER，由 skeleton-contract.test.ts 强校验段序不漂移。
 */
import type { NarrativeContext } from "../../types/index.js";
import { renderPlaceholders } from "./syntax.js";
import {
  buildSlotMap,
  buildDataHelpers,
  DEFAULT_PROVIDERS,
  type FragmentProvider,
} from "./providers.js";

export * from "./skeleton.js";
export * from "./syntax.js";
export * from "./providers.js";

/**
 * 模板路径：渲染 .md 模板字符串，用 provider 填 {{slot:*}}/{{IP_DNA.*}}/{{SKILL.*}}，
 * 用 ctx + data 助手填 {{ctx.*}}/{{data:*}}。一次完成全部占位。
 */
export function renderTemplateWithProviders(
  template: string,
  ctx: NarrativeContext,
  stepId: string,
  providers: readonly FragmentProvider[] = DEFAULT_PROVIDERS,
): string {
  const slots = buildSlotMap(ctx, stepId, providers);
  const data = buildDataHelpers(ctx);
  return renderPlaceholders(template, { ctx, slots, data });
}
