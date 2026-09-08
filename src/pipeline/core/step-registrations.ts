/**
 * step-registrations.ts — 所有活跃 step 的 StepDescriptor 注册
 *
 * 副作用文件：import 后自动注册所有 step 到 STEP_REGISTRY。
 * 按类别组织：偏好前置 → 叙事核心 → B3 模板步骤 → 策划 D0-D4 → 向后兼容 → 质检 → 打磨
 *
 * C1（2026-08）已封存原「D. 影游叙事 v2 专属管线（tpl-vn-v2）」9 步注册
 * （vn_logline / vn_outline_acts / vn_beats / vn_script_normalize /
 * vn_segment_confirm / vn_branched_beats / vn_state_ledger / vn_screenplay /
 * vn_storyboard）与 `vn_structure_check`：实现本体搬进 `_archive/vn-v2/`，
 * 业务功能吸收进通用席位实现，详见该目录 README。
 *
 * C2（2026-08）已封存原「C. tpl-vn 专属三步」注册（branch_tree / dialogue_script /
 * cinematic_storyboard）：实现本体搬进 `_archive/vn-v1/`，业务功能吸收进
 * structure（`tree.md` 结构卡）/ plot / storyboard 三个通用席位，详见该目录 README。
 *
 * C3（2026-08）已封存原「C. B3 管线模板步骤」四步注册（region_design /
 * emergent_event / card_lore / event_pool，对应 tpl-open-world / tpl-card-game /
 * tpl-emergent 三个模板）：实现本体搬进 `_archive/specialized/`，业务功能吸收进
 * lore_generation / plot_generation 两个通用席位，形态差异交给 network.md /
 * emergent.md / fragmented.md 结构卡，详见该目录 README。
 */
import { registerStep } from "./step-registry.js";

// Step 函数导入（与 pipeline.ts 保持一致）。
//
// 一并导入各步的 PromptComposer：内联 composer 是生产提示词的事实源，而 runner 只认
// resolvedPrompts，`agent-exec.resolvePrompts` 从 `StepDescriptor.composer` 取。不登记
// 的话，该步一旦切到 useNewRunner 就会发**空提示词** —— 不报错，只让模型胡说。
// 所以登记与切 runner 解耦：先把 composer 全挂上，切换才是安全动作。
import { userPreferenceSummary, PREFERENCE_SUMMARY_COMPOSER } from "../steps/user-preference-summary.js";
import { userPreferenceAnalysis, PREFERENCE_ANALYSIS_COMPOSER } from "../steps/user-preference-analysis.js";
import { initialPlan, INITIAL_PLAN_COMPOSER } from "../steps/initial-plan.js";
import { worldviewConstruction, WORLDVIEW_COMPOSER } from "../steps/worldview-construction.js";
import { characterEnrichment, CHARACTER_ENRICHMENT_COMPOSER } from "../steps/character-enrichment.js";
import { itemDatabase, ITEM_DATABASE_COMPOSER } from "../steps/item-database.js";
import { storyFramework } from "../steps/story-framework.js";
import { outlineBatch } from "../steps/outline-batch.js";
import { detailedOutlineBatch } from "../steps/detailed-outline-batch.js";
import { plotGeneration, PLOT_GENERATION_COMPOSER } from "../steps/plot-generation.js";
import { scriptGeneration, SCRIPT_GENERATION_COMPOSER } from "../steps/script-generation.js";
import { questGeneration, QUEST_GENERATION_COMPOSER } from "../steps/quest-generation.js";
import { scenePlan, SCENE_PLAN_COMPOSER } from "../steps/scene-plan.js";
import { sceneEvidence, SCENE_EVIDENCE_COMPOSER } from "../steps/scene-evidence.js";
import { scriptSceneGeneration, SCRIPT_SCENE_SKELETON_COMPOSER } from "../steps/script-scene-generation.js";
import { narrativeCardGeneration, NARRATIVE_CARD_COMPOSER } from "../steps/narrative-card.js";
import { encyclopediaRetrieval, ENCYCLOPEDIA_COMPOSER } from "../steps/encyclopedia.js";
import { loreGeneration, LORE_GENERATION_COMPOSER } from "../steps/lore-generation.js";
import { coreConcept } from "../design-steps/core-concept.js";
import { systemArchitecture } from "../design-steps/system-architecture.js";
import { systemDetail } from "../design-steps/system-detail.js";
import { valueFramework } from "../design-steps/value-framework.js";
import { designDoc } from "../design-steps/design-doc.js";
import { initialStoryOutline } from "../steps/initial-story-outline.js";
import { coreSettingsExtraction } from "../steps/core-settings-extraction.js";
import { plotSynopsis } from "../steps/plot-synopsis.js";
import {
  structureValidationL1,
  structureValidationL2,
  structureValidationL3,
} from "../steps/structure-validation.js";
import { structureCheck } from "../steps/structure-check.js";
import { contentCheck, CONTENT_CHECK_COMPOSER } from "../steps/content-check.js";
import {
  deaiPolish,
  plotRefine,
  plotPolish,
  playabilityAdapt,
  DEAI_COMPOSER,
  PLOT_REFINE_COMPOSER,
  PLOT_POLISH_COMPOSER,
  PLAYABILITY_COMPOSER,
} from "../steps/polish-seats.js";

// ════════════════════════════════════════════════════════════
// requiredInputs 的写法约定（与 assistant-seats.ts 的 runPolicy 配套）
// ════════════════════════════════════════════════════════════
//
// 起跑闸门只有这一处真值。`dependsOn` 表达的是排序与重跑影响面，不是闸门——
// getStepRequiredInputs 里那条"没写 requiredInputs 就从 dependsOn 派生"的回退
// 是给未接入席位的历史 step 兜底的，凡绑定到席位的 step 都必须**显式**写清，
// 否则派生结果会把"通常接在谁后面"误当成"没它就不能跑"。
//
//   runPolicy: independent       → requiredInputs: [] 或 ["user_input"]
//   runPolicy: requires-upstream → requiredInputs 非空，且每个字段都能反查到产出席位
//
// 两条规则由 gate-contract.test.ts 双向校验，改一边忘另一边会红。
//
// ════════════════════════════════════════════════════════════
// A. 需求清单席（所有叙事品类必须执行）
//
// 两步是这一席的实现，name 随架构走——四期起这一环节叫「需求清单」，
// 画布与日志上不再出现「偏好」这个四期前的说法。step id 与产物字段名不动：
// 它们是存量 checkpoint 与落盘文件的键，改名等于让历史条目读不出来。
// ════════════════════════════════════════════════════════════

registerStep({
  id: "preference_summary",
  name: "需求提炼",
  fn: userPreferenceSummary,
  composer: PREFERENCE_SUMMARY_COMPOSER,
  extractOutputKey: "user_preference_summary",
  dependsOn: [],
  requiredInputs: [],
  outputFields: ["user_preference_summary"],
});

registerStep({
  id: "preference_analysis",
  name: "需求分析",
  fn: userPreferenceAnalysis,
  composer: PREFERENCE_ANALYSIS_COMPOSER,
  extractOutputKey: "user_preference_analysis",
  dependsOn: ["preference_summary"],
  outputFields: ["user_preference_analysis", "global_control_params"],
});

registerStep({
  id: "initial_plan",
  name: "初步方案",
  fn: initialPlan,
  composer: INITIAL_PLAN_COMPOSER,
  extractOutputKey: "initial_plan",
  dependsOn: ["preference_analysis"],
  // 策划文档席可独立起跑：没有需求清单时直接读 user_input 规划关键设定
  // （composer 对缺席上游一律 `?? "（无）"` 兜底）。
  requiredInputs: [],
  outputFields: ["initial_story_outline", "core_settings", "plot_synopsis", "target_acts"],
});

// ════════════════════════════════════════════════════════════
// B. 叙事核心步骤
// ════════════════════════════════════════════════════════════

registerStep({
  id: "worldview",
  name: "世界观构建",
  fn: worldviewConstruction,
  composer: WORLDVIEW_COMPOSER,
  extractOutputKey: "worldview_structure",
  needsDesignContext: true,
  dependsOn: ["initial_plan"],
  requiredInputs: [],
  outputFields: ["worldview_structure"],
  needsThreshold: { W: 1 },
});

registerStep({
  id: "character_enrichment",
  name: "角色档案",
  fn: characterEnrichment,
  composer: CHARACTER_ENRICHMENT_COMPOSER,
  extractOutputKey: "detailed_character_sheets",
  dependsOn: ["worldview"],
  requiredInputs: [],
  outputFields: ["detailed_character_sheets", "player_name"],
  needsThreshold: { C: 2 },
});

registerStep({
  id: "item_database",
  name: "道具清单",
  fn: itemDatabase,
  composer: ITEM_DATABASE_COMPOSER,
  extractOutputKey: "item_database",
  dependsOn: ["worldview", "character_enrichment"],
  requiredInputs: [],
  outputFields: ["item_database"],
  needsThreshold: { I: 2 },
});

// ── 多阶段步：composer 故意留空 ──────────────────────────────────────────
//
// 下面三步（story_framework / outline_batch / detailed_outline）
// 各自有 2–3 个分阶段 composer（plan / fill / gap），
// 而 `StepDescriptor.composer` 只能放一个，所以这里的 composer 字段故意留空。
//
// 随便挑一个登记比不登记更坏：不登记切 runner 会发空提示词（能被守卫测试拦住），
// 挑一个则会拿「规划阶段」的提示词去跑「填充阶段」，模型照样胡说，但看起来一切正常。
// 正确出路是把分阶段上移成 SequenceStage / ChunkedConfig，由 runner 按阶段取提示词。
// story_framework 已完成这一步（见 runner-migration.ts 的 sequence 配置 + stage-composer-registry），
// 提示词经 composerId 按阶段查表，不经这里的 composer 字段——outline_batch / detailed_outline
// 仍在 seat-spec.ts 的 SHAPE_DIVERGENCES 登记为落差，尚未跟进。
registerStep({
  id: "story_framework",
  name: "故事框架",
  fn: storyFramework,
  extractOutputKey: "story_framework",
  // 七单品链式依赖：①初步方案→②世界观→③角色→④道具→⑤叙事(L0)。
  // item_database 仅在含道具的管线出现；缺席时该依赖对拓扑排序/下游计算无副作用。
  dependsOn: ["worldview", "character_enrichment", "item_database"],
  // 故事大纲席可独立起跑：只有 user_input 时也能规划宏观框架，设定层产物是软输入。
  requiredInputs: [],
  outputFields: ["story_framework"],
  needsThreshold: { S: 2 },
});

registerStep({
  id: "outline_batch",
  name: "大纲展开",
  fn: outlineBatch,
  extractOutputKey: "outlines_generated",
  dependsOn: ["story_framework"],
  // 故事结构席必须有上游：没有宏观框架，微观展开无从下手。
  requiredInputs: ["story_framework"],
  outputFields: ["outlines_generated"],
  derivedFields: ["l1_validation"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { S: 2 },
});

registerStep({
  id: "detailed_outline",
  name: "细纲展开",
  fn: detailedOutlineBatch,
  extractOutputKey: "detailed_outlines_generated",
  dependsOn: ["outline_batch"],
  requiredInputs: ["outlines_generated"],
  outputFields: ["detailed_outlines_generated"],
  derivedFields: ["l2_validation"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { S: 3 },
});

registerStep({
  id: "plot_generation",
  name: "情节生成",
  fn: plotGeneration,
  composer: PLOT_GENERATION_COMPOSER,
  extractOutputKey: "plots_generated",
  dependsOn: ["detailed_outline"],
  requiredInputs: ["detailed_outlines_generated"],
  outputFields: ["plots_generated"],
  derivedFields: ["l3_validation"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { S: 3 },
});

registerStep({
  id: "script_generation",
  name: "剧本生成",
  fn: scriptGeneration,
  composer: SCRIPT_GENERATION_COMPOSER,
  extractOutputKey: "jrpg_script",
  dependsOn: ["plot_generation"],
  requiredInputs: ["plots_generated"],
  outputFields: ["jrpg_script"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { D: 3 },
});

registerStep({
  id: "quest_generation",
  name: "任务生成",
  fn: questGeneration,
  composer: QUEST_GENERATION_COMPOSER,
  extractOutputKey: "quest_graph",
  dependsOn: ["plot_generation"],
  requiredInputs: ["plots_generated"],
  outputFields: ["quest_graph"],
  needsThreshold: { Q: 2 },
});

/**
 * 场景列表（2.3.6）——前向规划。
 *
 * `dependsOn` 只留 worldview：旧 `scene_generation` 曾声明依赖 story_framework /
 * outline_batch / detailed_outline / plot_generation，即依赖自己的**下游**，那是
 * 环节方向错位留下的痕迹（详见 `_archive/scene/README.md`）。前向规划从设定推演，
 * 不该等剧情。
 */
registerStep({
  id: "scene_plan",
  name: "场景列表",
  fn: scenePlan,
  composer: SCENE_PLAN_COMPOSER,
  extractOutputKey: "scene_map",
  dependsOn: ["worldview"],
  // 场景列表席可独立起跑：前向规划只需要世界观（甚至只需 user_input）。
  requiredInputs: [],
  outputFields: ["scene_map"],
  needsThreshold: { E: 2 },
});

/**
 * 场景取证（内容检查席 2.3.15 的子步，不是独立席位）。
 *
 * 硬输入取情节正文：取证的对象是"剧情里实际出现过什么"，没有剧情就无据可取。
 * 前向清单（scene_map）是软输入——没有清单时只出实测名单，不报漏项，否则全是假阳性。
 *
 * 登记的是首层（非增量）composer。取证按层分批，第二层起换用增量版，但两者只差
 * 末尾一段"保持归属一致"的追加说明，首层版能如实代表这一步的提示词，与
 * `script_scene_generation` 登记骨架 composer 是同一口径。
 */
registerStep({
  id: "scene_evidence",
  name: "场景取证",
  fn: sceneEvidence,
  composer: SCENE_EVIDENCE_COMPOSER,
  extractOutputKey: "scene_evidence",
  dependsOn: ["plot_generation"],
  requiredInputs: ["plots_generated"],
  outputFields: ["scene_evidence"],
});

registerStep({
  id: "script_scene_generation",
  name: "剧本+场景耦合生成",
  fn: scriptSceneGeneration,
  composer: SCRIPT_SCENE_SKELETON_COMPOSER,
  extractOutputKey: "script_scene",
  dependsOn: ["plot_generation"],
  outputFields: ["jrpg_script", "scene_map"],
});

registerStep({
  id: "narrative_card",
  name: "叙事卡",
  fn: narrativeCardGeneration,
  // 本席走 SingleTurnRunner，提示词由 executeAgent 从这里取；不登记就会发空提示词。
  composer: NARRATIVE_CARD_COMPOSER,
  extractOutputKey: "narrative_card",
  dependsOn: [],
  // 与手写 AgentDef（agent-def-registrations.ts）一致：只吃用户输入。
  requiredInputs: ["user_input"],
  outputFields: ["narrative_card"],
  temperature: 0.8,
  responseFormat: "json",
});

/**
 * 百科娘（2.3.20）。
 *
 * dependsOn 为空是刻意的：它检索的是**外部**资料，不吃管线上游产物，
 * 因此可以在任何环节之前独立跑，产出供其它席位当外部事实引用
 * （2.4.2 作家创作顾问蒸馏就靠它补作者资料）。
 */
registerStep({
  id: "encyclopedia_retrieval",
  name: "百科娘",
  fn: encyclopediaRetrieval,
  composer: ENCYCLOPEDIA_COMPOSER,
  extractOutputKey: "encyclopedia_doc",
  dependsOn: [],
  requiredInputs: [],
  outputFields: ["encyclopedia_doc"],
  temperature: 0.3,
  responseFormat: "json",
});

registerStep({
  id: "lore_generation",
  name: "Lore 碎片",
  fn: loreGeneration,
  composer: LORE_GENERATION_COMPOSER,
  extractOutputKey: "lore_fragments",
  dependsOn: ["worldview"],
  // 设定集席可独立起跑：世界观是软输入，缺席时按 user_input 直接做叙事包装。
  requiredInputs: [],
  outputFields: ["lore_fragments"],
});

// ════════════════════════════════════════════════════════════
// C. B3 管线模板步骤（tpl-open-world / tpl-card-game / tpl-emergent）
//
// tpl-vn 专属三步（branch_tree / dialogue_script / cinematic_storyboard）已随
// C2 封存进 `_archive/vn-v1/`，不再在此注册。
//
// region_design / emergent_event / card_lore / event_pool 四步已随 C3 封存进
// `_archive/specialized/`，不再在此注册。业务功能吸收进上方 lore_generation /
// plot_generation，详见 `_archive/specialized/README.md`。
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// D. 策划步骤 D0-D4（不改，仅注册元数据）
// ════════════════════════════════════════════════════════════

registerStep({
  id: "core_concept",
  name: "D0 核心概念",
  fn: coreConcept,
  extractOutputKey: "core_concept",
  dependsOn: [],
  outputFields: ["core_concept"],
});

registerStep({
  id: "system_architecture",
  name: "D1 系统架构",
  fn: systemArchitecture,
  extractOutputKey: "system_architecture",
  dependsOn: ["core_concept"],
  outputFields: ["system_architecture"],
});

registerStep({
  id: "system_detail",
  name: "D2 玩法设计",
  fn: systemDetail,
  extractOutputKey: "system_details",
  dependsOn: ["system_architecture"],
  outputFields: ["system_details"],
});

registerStep({
  id: "value_framework",
  name: "D3 数值框架",
  fn: valueFramework,
  extractOutputKey: "value_framework",
  dependsOn: ["system_detail"],
  outputFields: ["value_framework"],
});

registerStep({
  id: "design_doc",
  name: "D4 策划案整合",
  fn: designDoc,
  extractOutputKey: "game_design_context",
  dependsOn: ["value_framework"],
  outputFields: ["game_design_context", "narrative_requirements"],
});

// ════════════════════════════════════════════════════════════
// E. 向后兼容（旧存档引用，仅注册使其可执行）
// ════════════════════════════════════════════════════════════

registerStep({
  id: "initial_outline",
  name: "初步大纲（旧）",
  fn: initialStoryOutline,
  extractOutputKey: "initial_story_outline",
  dependsOn: [],
  outputFields: ["initial_story_outline"],
});

registerStep({
  id: "core_settings",
  name: "核心设定（旧）",
  fn: coreSettingsExtraction,
  extractOutputKey: "core_settings",
  dependsOn: [],
  outputFields: ["core_settings"],
});

registerStep({
  id: "plot_synopsis",
  name: "剧情简介（旧）",
  fn: plotSynopsis,
  extractOutputKey: "plot_synopsis",
  dependsOn: [],
  outputFields: ["plot_synopsis"],
});

registerStep({
  id: "structure_validation_l1",
  name: "L1 结构验证（旧）",
  fn: structureValidationL1,
  extractOutputKey: "l1_validation",
  dependsOn: [],
  outputFields: ["l1_validation"],
});

registerStep({
  id: "structure_validation_l2",
  name: "L2 结构验证（旧）",
  fn: structureValidationL2,
  extractOutputKey: "l2_validation",
  dependsOn: [],
  outputFields: ["l2_validation"],
});

registerStep({
  id: "structure_validation_l3",
  name: "L3 结构验证（旧）",
  fn: structureValidationL3,
  extractOutputKey: "l3_validation",
  dependsOn: [],
  outputFields: ["l3_validation"],
});

// ════════════════════════════════════════════════════════
// F. 质检席位（2.3.14–2.3.19）
//
// 同一份实现按管线注册两个描述符：席位是一个，接线各是各的。
// 上面的 structure_validation_* 是生成步内部的修复钩子，与本席位并存——
// 那三个负责修，这里负责审并出报告。
//
// C1（2026-08）已封存 `vn_structure_check`（曾与本 structure_check 共用同一份
// 实现，专供 tpl-vn-v2 的 vn_branched_beats 接线）：影游改走通用的 structure
// 席实现后不再需要第二个描述符。
// ════════════════════════════════════════════════════════

/**
 * 结构检查（2.3.14）。runPolicy: requires-upstream——没有剧情树就没有可检查的结构，
 * 空跑出一份"没发现问题"的报告比拦住更坏（用户会以为审过了）。
 *
 * 闸门取 L1 的 `outlines_generated` 而不是 `dependsOn` 指的 L2：结构席内部是
 * L1→L2 两步，只跑到 L1 的用户理应能先审一遍分支与聚合，有哪层查哪层这条宽容
 * 语义保留在实现里，闸门只拦"连一层都没有"。
 */
registerStep({
  id: "structure_check",
  name: "结构检查",
  fn: structureCheck,
  extractOutputKey: "structure_check_report",
  dependsOn: ["detailed_outline"],
  requiredInputs: ["outlines_generated"],
  outputFields: ["structure_check_report"],
});

/**
 * 内容检查（2.3.15）。runPolicy: requires-upstream——四类受检对象里故事内容是主体，
 * 缺了情节正文，剩下三类（角色 / 道具 / 场景）也失去比对基准。
 */
registerStep({
  id: "content_check",
  name: "内容检查",
  fn: contentCheck,
  composer: CONTENT_CHECK_COMPOSER,
  extractOutputKey: "content_check_report",
  dependsOn: ["plot_generation"],
  requiredInputs: ["plots_generated"],
  outputFields: ["content_check_report"],
  temperature: 0.3,
  responseFormat: "json",
});

// ════════════════════════════════════════════════════════
// G. 打磨席位（2.3.16–2.3.19）
//
// 四席共用 polish-family 的机制，各自只有提示词不同（见 polish-seats.ts）。
// 产物原位写回基准字段（席位表 branch.baseField）：这四席是「优化已生成剧本」的
// agent，产出就是同一份剧本的新一版。旧版由落盘层在覆盖前存版本快照
// （见 step-files 的 INPLACE_TRANSFORM_STEPS），"用哪一版"靠版本号而非字段分叉。
//
// 打磨的对象是"已经生成的东西"，所以前三席一律 requires-upstream，闸门取各自的
// 基准字段。玩法适配（2.3.19）已改 planned，不参与这条口径。
// ════════════════════════════════════════════════════════

registerStep({
  id: "deai_polish",
  name: "去 AI 味",
  fn: deaiPolish,
  composer: DEAI_COMPOSER,
  extractOutputKey: "plots_generated",
  dependsOn: ["plot_generation"],
  requiredInputs: ["plots_generated"],
  outputFields: ["plots_generated"],
  temperature: 0.8,
  responseFormat: "json",
});

registerStep({
  id: "plot_refine",
  name: "情节优化",
  fn: plotRefine,
  composer: PLOT_REFINE_COMPOSER,
  extractOutputKey: "plots_generated",
  dependsOn: ["plot_generation"],
  requiredInputs: ["plots_generated"],
  outputFields: ["plots_generated"],
  temperature: 0.7,
  responseFormat: "json",
});

registerStep({
  id: "plot_polish",
  name: "情节润色",
  fn: plotPolish,
  composer: PLOT_POLISH_COMPOSER,
  extractOutputKey: "plots_generated",
  dependsOn: ["plot_generation"],
  requiredInputs: ["plots_generated"],
  outputFields: ["plots_generated"],
  temperature: 0.8,
  responseFormat: "json",
});

// 玩法适配打磨的是细纲（剧情树那一层的分支与选项），所以 dependsOn 指细纲而非情节。
//
// 席位已改 planned（暂不接线，见 assistant-seats.ts 的 playability）：实现仍注册着
// 以便随时接回，但它不属于任一管线、不解析、不参与 runPolicy 口径，requiredInputs
// 因此维持空，不套用打磨三席那条硬闸门。
registerStep({
  id: "playability_adapt",
  name: "玩法适配",
  fn: playabilityAdapt,
  composer: PLAYABILITY_COMPOSER,
  extractOutputKey: "detailed_outlines_generated",
  dependsOn: ["detailed_outline"],
  requiredInputs: [],
  outputFields: ["detailed_outlines_generated"],
  temperature: 0.7,
  responseFormat: "json",
});
