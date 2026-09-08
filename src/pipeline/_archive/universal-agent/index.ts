/**
 * universal-agent (B-M2)
 * ─────────────────────────────────────────────────────────────────
 * 通用三件套 agent 框架。M3-M5 把以下 7 个 stub step 迁移过来：
 *   - branch_tree, dialogue_script, cinematic_storyboard (M3 narrative)
 *   - emergent_event, region_design                      (M4 quest/region)
 *   - card_lore, event_pool                              (M5 scene/lore)
 *
 * 这 7 个 stub 全部已封存：前 3 个随 tpl-vn 于 C2（2026-08）搬进 `_archive/vn-v1/`，
 * 后 4 个随四个品类特化能力于 C3（2026-08）搬进 `_archive/specialized/`。框架本身
 * （runUniversalAgent 等）仍是活跃代码，继续被 lore_generation/plot_generation
 * 等通用 step 使用。
 */

export { runUniversalAgent } from "./runner.js";
export { planAgent, extractNeedsMatrix } from "./planner.js";
export { evaluateOutput } from "./evaluator.js";
export {
  createAdaptiveCapability,
  type ActPlan,
  type AdaptiveCapabilitySpec,
  type ChunkedConfig,
  type SingleShotConfig,
} from "./chunked-capability.js";
export type {
  UniversalAgentSpec,
  Capability,
  CapabilityContext,
  CapabilityExecutor,
  CapabilityResult,
  AgentPlan,
  EvaluatorSpec,
  EvaluatorVerdict,
  NeedsKey,
  NeedsScore,
  NeedsMatrix,
} from "./types.js";
