/**
 * 需求驱动步骤组合器（deriveSteps）
 *
 * 根据 NarrativeRequirements.needs 矩阵动态组合叙事步骤。
 * 步骤按固定执行顺序过滤：越靠前的步骤越基础，不可跳过上游步骤。
 *
 * 维度含义（0-3）：
 *   W=世界观  C=角色  S=剧情结构  D=对话剧本  Q=任务
 *   E=环境叙事  I=物品  U=UI文案  L=Lore碎片
 *
 * C2（2026-08）：原 F1 为 narrative_type === "branching"（VN/互动影游 家族）
 * 专门输出的 tpl-vn / tpl-vn-v2 步骤序列（branch_tree+dialogue_script /
 * vn_logline 九步）已随 VN v1、v2 封存分别退役——两条分支的实现本体都已
 * 搬进 `_archive/vn-v1/`、`_archive/vn-v2/`，业务功能吸收进通用席位。
 * `buildVnAutoSteps` / `buildVnV2AutoSteps` 因而改为委托 `buildClassicAutoSteps`：
 * 这两个分支只在 `pipeline.ts` 的 `usePlanner=false` 显式回退路径上才会被触发
 * （生产路径全部走四条席位管线：`resolveSeatStepGroups` / `resolveModeStepGroups`），
 * 保留分支只是为了不让这条冷路径产出已下线的 step id 而报错，不代表 VN 品类
 * 还有专属自动步序。
 *
 * D1（2026-08）：本文件原引用的 `planPipeline()`（`pipeline/planner/`）已确认
 * 全仓零生产调用点并封存进 `_archive/planner/`——见下方函数注释的订正。
 */
import type { NarrativeRequirements } from "../../types/game-design.js";
import { STEP_IDS } from "../routing/modes.js";
import type { PipelineTemplateId } from "../routing/templates.js";
import { GENRE_TAXONOMY } from "../../knowledge/genre-taxonomy.js";

const S = STEP_IDS;

export interface BuildAutoStepsOptions {
  /** 来自 demand_analysis.genre_code，用于查 skill 的 enableSteps */
  genreCode?: string;
}

function resolvePipelineTemplate(genreCode: string | undefined): PipelineTemplateId | undefined {
  if (!genreCode) return undefined;
  const entry = GENRE_TAXONOMY.find((g) => g.code === genreCode);
  return entry?.pipelineTemplate;
}

/**
 * 根据叙事需求矩阵动态组合叙事步骤列表。
 * 返回按正确执行顺序排列的步骤 ID 数组。
 *
 * 路由优先级：
 *   1) 品类的 pipelineTemplate（显式声明，最高优先级）
 *   2) narrative_type 兜底（未显式映射的品类）
 *   3) 经典 L0-L5 RPG 链（兜底默认）
 *
 * @deprecated 生产路径已改用四条席位管线（`resolveSeatStepGroups` / `resolveModeStepGroups`，
 * 见 `narrative-pipelines.ts` / `mode-routing.ts`）。原 @deprecated 注记指向的
 * `planPipeline()` 已确认零生产调用点，随 D1 封存进 `_archive/planner/`。
 * 此函数保留用于 `pipeline.ts` 的 `usePlanner=false` 显式回退路径和 rerunFromStep 历史兼容。
 */
export function buildAutoSteps(
  req: NarrativeRequirements,
  options: BuildAutoStepsOptions = {},
): string[] {
  const template = resolvePipelineTemplate(options.genreCode);

  // 模板优先：先按品类显式声明的 pipelineTemplate 路由
  switch (template) {
    case "tpl-narrative-card":
      return buildNarrativeCardAutoSteps();
    case "tpl-open-world":
      return buildOpenWorldAutoSteps(req, options);
    case "tpl-card-game":
      return buildCardGameAutoSteps(req, options);
    case "tpl-light":
      return buildLightAutoSteps(req);
    case "tpl-vn":
      return buildVnAutoSteps(req);
    case "tpl-vn-v2":
      return buildVnV2AutoSteps(req);
    case "tpl-fragmented":
      return buildFragmentedAutoSteps(req);
    case "tpl-emergent":
      return buildEmergentAutoSteps(req);
    case "tpl-rpg":
      return buildClassicAutoSteps(req);
    case undefined:
      // 未知品类（无 pipelineTemplate）：按 narrative_type 兜底
      break;
  }

  // narrative_type 兜底：未显式映射的品类按 narrative_type 走经典分支
  if (req.narrative_type === "branching") {
    return buildVnAutoSteps(req);
  }
  if (req.narrative_type === "fragmented") {
    return buildFragmentedAutoSteps(req);
  }
  if (req.narrative_type === "emergent") {
    return buildEmergentAutoSteps(req);
  }
  if (req.narrative_type === "minimal") {
    return buildLightAutoSteps(req);
  }

  return buildClassicAutoSteps(req);
}

function buildClassicAutoSteps(req: NarrativeRequirements): string[] {
  const needs = req.needs;
  const W = needs.W ?? 0;
  const C = needs.C ?? 0;
  const S_ = needs.S ?? 0;
  const D = needs.D ?? 0;
  const Q = needs.Q ?? 0;
  const E = needs.E ?? 0;
  const I = needs.I ?? 0;
  // L (Lore) 已由通用叙事 agent 内嵌产出，不再驱动独立 step
  // U (UI 文案) 已从叙事模块移除

  const steps: string[] = [];

  // ── Phase 0: 通用前置（所有叙事品类必须执行）──
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);

  // ── Phase 1: 世界观（W≥1 时需要，基本所有品类都满足）──
  if (W >= 1) {
    steps.push(S.WORLDVIEW);
  }

  // ── Phase 2: 实体层（世界观之后、叙事结构之前）──
  // 角色档案（C≥2）
  if (C >= 2) {
    steps.push(S.CHARACTER_ENRICHMENT);
  }
  // 道具清单（I≥2，需要角色数据作为上下文）
  if (I >= 2) {
    steps.push(S.ITEM_DATABASE);
  }

  // ── Phase 3: 叙事结构 L0-L2 ──
  // L0 故事框架（S≥2）
  if (S_ >= 2) {
    steps.push(S.STORY_FRAMEWORK);
  }
  // L1 章节大纲（S≥2）
  if (S_ >= 2) {
    steps.push(S.OUTLINE_BATCH);
  }
  // L2 详细大纲（S≥3）
  if (S_ >= 3) {
    steps.push(S.DETAILED_OUTLINE);
  }

  // ── Phase 4: 叙事内容 L3-L4 ──
  // L3 情节生成（D≥2 或 S≥3 时需要完整情节描写）
  if (D >= 2 || S_ >= 3) {
    steps.push(S.PLOT_GENERATION);
  }
  // L4 剧本生成（D≥3 时需要完整对话剧本）
  if (D >= 3) {
    steps.push(S.SCRIPT_GENERATION);
  }

  // ── Phase 5: 系统内容 L5 + 场景 ──
  // L5 任务生成（Q≥2）
  if (Q >= 2) {
    steps.push(S.QUEST_GENERATION);
  }
  // 场景生成（E≥2）
  if (E >= 2) {
    steps.push(S.SCENE_PLAN);
  }

  // ── Phase 6: 补充内容 ──
  // Lore 已集成至通用叙事 agent（按 needs.L 由 capability 内嵌产出，不再独立 step）
  // UI 文案已从叙事模块移除

  return steps;
}

/**
 * C2（2026-08）已封存：视觉小说 / 互动影游 / 乙女 / 互动叙事家族原走 tpl-vn
 * 专属三步（branch_tree → dialogue_script → [可选 cinematic_storyboard]）。
 * 实现本体已搬进 `_archive/vn-v1/`，业务功能吸收进 structure / plot /
 * storyboard 三个通用席位（详见该目录 README）。
 *
 * `use_legacy_pipeline=true` 冷路径仍可能按 pipelineTemplate 落到这个分支，
 * 为避免它产出已下线的 step id 导致下游找不到 STEP_FNS 而报错，改为委托
 * `buildClassicAutoSteps`——即与未显式声明 pipelineTemplate 的品类一样，走
 * 通用 L0-L4 步序（由 needs.W/C/S/D 门控）。
 */
function buildVnAutoSteps(req: NarrativeRequirements): string[] {
  return buildClassicAutoSteps(req);
}

/**
 * C1（2026-08）已封存：tpl-vn-v2 专属固定 9 步管线，实现本体已搬进
 * `_archive/vn-v2/`，业务功能吸收进通用席位（详见该目录 README）。
 *
 * 与 `buildVnAutoSteps` 同理，仅为 `use_legacy_pipeline=true` 冷路径兜底，
 * 委托 `buildClassicAutoSteps` 而非再产出 VN_LOGLINE 等已下线的 step id。
 */
function buildVnV2AutoSteps(req: NarrativeRequirements): string[] {
  return buildClassicAutoSteps(req);
}

/**
 * 开放世界 RPG (rpg-open-world) 步骤序列：
 * 偏好 → 初步方案 → 世界观 → 设定集 → 角色 → 情节 → UI
 *
 * C3（2026-08）已封存：原 region_design / emergent_event 两个 tpl-open-world /
 * tpl-emergent 专属 step 实现本体已搬进 `_archive/specialized/`，业务功能
 * （区域地理/势力/危险等级、事件模板/触发条件）吸收进通用 lore_generation /
 * plot_generation，形态差异交给 network.md / emergent.md 结构卡。
 * `use_legacy_pipeline=true` 冷路径改用这两个通用 step id，不再产出已下线的
 * step id 导致下游找不到 STEP_FNS 而报错。
 */
function buildOpenWorldAutoSteps(
  req: NarrativeRequirements,
  _options: BuildAutoStepsOptions,
): string[] {
  const needs = req.needs;
  const C = needs.C ?? 0;

  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  steps.push(S.LORE_GENERATION);
  if (C >= 2) steps.push(S.CHARACTER_ENRICHMENT);
  steps.push(S.PLOT_GENERATION);
  return steps;
}

/**
 * 卡牌游戏 (card-ccg / card-dbg / card-boardgame) 步骤序列：
 * 偏好 → 初步方案 → 世界观 → 设定集 → 情节 → UI
 *
 * C3（2026-08）已封存：原 card_lore / event_pool 两个 tpl-card-game 专属 step
 * 实现本体已搬进 `_archive/specialized/`，业务功能（势力体系/稀有度文本、
 * 运营事件池节奏与奖励）吸收进通用 lore_generation / plot_generation，形态
 * 差异交给 fragmented.md 结构卡。`use_legacy_pipeline=true` 冷路径改用这两个
 * 通用 step id，理由同上。
 */
function buildCardGameAutoSteps(
  _req: NarrativeRequirements,
  _options: BuildAutoStepsOptions,
): string[] {
  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  steps.push(S.LORE_GENERATION);
  steps.push(S.PLOT_GENERATION);
  return steps;
}

/**
 * 轻量管线 (tpl-light, Tier3 大部分品类)：
 * 偏好 → 初步方案 → 世界观 → 角色 → UI
 */
function buildLightAutoSteps(req: NarrativeRequirements): string[] {
  const needs = req.needs;
  const W = needs.W ?? 0;
  const C = needs.C ?? 0;

  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  if (W >= 1) steps.push(S.WORLDVIEW);
  if (C >= 1) steps.push(S.CHARACTER_ENRICHMENT);
  return steps;
}

/**
 * 碎片化叙事 (tpl-fragmented)：Souls-like / Metroidvania / 心理恐怖 等
 * 偏好 → 初步方案 → 世界观 → 角色 → 道具 → 场景 → UI
 *
 * Lore 已集成至通用叙事 agent（在 item_database 与 scene_plan 内部按 needs.L 产出），
 * 不再独立 step。
 */
function buildFragmentedAutoSteps(req: NarrativeRequirements): string[] {
  const needs = req.needs;
  const C = needs.C ?? 0;
  const E = needs.E ?? 0;
  const I = needs.I ?? 0;

  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  if (C >= 1) steps.push(S.CHARACTER_ENRICHMENT);
  if (I >= 1) steps.push(S.ITEM_DATABASE);
  if (E >= 1) steps.push(S.SCENE_PLAN);
  return steps;
}

/**
 * 涌现叙事 (tpl-emergent)：4X / 沙盒 / 模拟经营 / 生存
 * 偏好 → 初步方案 → 世界观 → 情节 → UI
 *
 * C3（2026-08）已封存：原 emergent_event 专属 step 实现本体已搬进
 * `_archive/specialized/`，业务功能吸收进通用 plot_generation，形态差异
 * 交给 emergent.md 结构卡。
 */
function buildEmergentAutoSteps(_req: NarrativeRequirements): string[] {
  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  steps.push(S.PLOT_GENERATION);
  return steps;
}

/**
 * 叙事卡 (tpl-narrative-card, Tier4 全部品类)：仅 narrative_card 一步生成。
 * 不进入 PREFERENCE / INITIAL_PLAN（避免对超休闲 / IO 等品类过度展开）。
 */
function buildNarrativeCardAutoSteps(): string[] {
  return [S.NARRATIVE_CARD];
}
