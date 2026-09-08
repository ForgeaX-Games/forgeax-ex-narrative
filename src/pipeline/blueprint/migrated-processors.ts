/**
 * blueprint/migrated-processors.ts
 *
 * 已迁到 runner 的席位所需的校验器与归一化器。副作用文件：import 即注册。
 *
 * 为什么单独一个文件：RUNNER_MIGRATIONS 只按名字引用处理器，名字对不上要到运行时
 * 才炸（getValidator 抛 "not registered"）。把实现集中在一处，"表里点了名、注册表里
 * 没有"这类漏项一眼可见，也有 migrated-runner 测试逐条对照。
 *
 * 处理器本体一律从 step 文件里 import，不在这儿重写一份 —— 两份规则各自演化的话，
 * legacy 与 runner 会在某次改动后开始产出不同的东西，而两边都不报错。
 */
import {
  registerValidator,
  registerNormalizer,
  registerProcessor,
  registerPreflight,
  registerSplitter,
  registerMerger,
  registerChunkSink,
  registerWaveLayerer,
  registerWaveSummarizer,
  registerWaveConstraintCheck,
} from "./processor-registry.js";
import { registerStageComposer } from "./stage-composer-registry.js";
import {
  validateCharacterEnrichment,
  normalizeCharacterSheets,
} from "../steps/character-enrichment.js";
import {
  validateItemDatabase,
  normalizeItemDatabase,
} from "../steps/item-database.js";
import {
  validateQuestChunk,
  normalizeQuestChunk,
  questTargetPlots,
  commitQuestNode,
  buildQuestGraph,
  qaQuestGraphIfFull,
} from "../steps/quest-generation.js";
import { validatePreferenceAnalysis, normalizePreferenceAnalysis } from "../steps/user-preference-analysis.js";
import { validateInitialPlan, normalizeInitialPlan } from "../steps/initial-plan.js";
import { validateWorldview, normalizeWorldview } from "../steps/worldview-construction.js";
import { validateLoreGeneration, normalizeLoreGeneration } from "../steps/lore-generation.js";
import { buildStructureCheckReport } from "../steps/structure-check.js";
import {
  validateContentCheck,
  normalizeContentCheck,
  contentCheckPreflight,
} from "../steps/content-check.js";
import {
  validateEncyclopedia,
  normalizeEncyclopedia,
  encyclopediaPreflight,
} from "../steps/encyclopedia.js";
import {
  polishSplitter,
  polishChunkDone,
  polishMerger,
  validatePolishOutput,
} from "../steps/polish-family.js";
import {
  DEAI_SPEC,
  PLOT_REFINE_SPEC,
  PLOT_POLISH_SPEC,
  PLAYABILITY_SPEC,
} from "../steps/polish-seats.js";
import {
  STORY_FRAMEWORK_PLAN_COMPOSER,
  STORY_FRAMEWORK_FILL_COMPOSER,
  validateStoryFrameworkPlan,
  validateStoryFrameworkFill,
  storyFrameworkRoute,
  storyFrameworkPrepareRegen,
  storyFrameworkPrepareFull,
  normalizeStoryFramework,
} from "../steps/story-framework.js";
import {
  validatePlotGeneration,
  plotGenerationWaveLayerer,
  plotGenerationWaveConstraintCheck,
  plotGenerationWaveSummarizer,
  plotGenerationChunkDone,
  plotGenerationMerger,
  normalizePlotGeneration,
} from "../steps/plot-generation.js";
import {
  validateScriptGeneration,
  scriptGenerationWaveLayerer,
  scriptGenerationWaveConstraintCheck,
  scriptGenerationWaveSummarizer,
  scriptGenerationChunkDone,
  scriptGenerationMerger,
} from "../steps/script-generation.js";
import type { NarrativeContext, Quest, QuestGraph } from "../../types/index.js";

registerValidator("character_enrichment_validator", (raw) => {
  validateCharacterEnrichment(raw);
});
registerNormalizer("character_enrichment_normalizer", (parsed, ctx) =>
  // 顺带派生 ctx.player_name —— runner 只写 io.outputField，派生字段没有别的落点。
  normalizeCharacterSheets(parsed, ctx),
);

registerValidator("item_database_validator", (raw) => {
  validateItemDatabase(raw);
});
registerNormalizer("item_database_normalizer", (parsed) => normalizeItemDatabase(parsed));

// ── quest_generation：按情节节点分片 ─────────────────────────────────────
//
// 四件处理器各管一段，缺任一段就退化成"跑完了但东西不在"：
//   splitter    本次要处理的节点（含局部重跑的过滤）
//   chunk_done  单节点一完成就增量落地（场景生成靠它判断就绪、前端靠它逐个亮）
//   merger      汇总主线链与支线归属
//   normalizer  全量生成时的图质量门（异步，故归一化器允许返回 Promise）

registerValidator("quest_generation_validator", (raw) => {
  validateQuestChunk(raw);
});

registerSplitter("quest_generation_splitter", (ctx) =>
  questTargetPlots(ctx).map((plot) => ({ chunkId: plot.node_id, data: { plot } })),
);

/** chunkId 即 node_id，据此把该片输出挂回它的情节节点。 */
function questsOfChunk(
  ctx: NarrativeContext,
  chunkId: string,
  output: unknown,
): Quest[] {
  const plot = questTargetPlots(ctx).find((p) => p.node_id === chunkId);
  if (!plot) return [];
  return normalizeQuestChunk(output, plot);
}

registerChunkSink("quest_generation_chunk_done", (chunk, ctx) => {
  const plot = questTargetPlots(ctx).find((p) => p.node_id === chunk.chunkId);
  if (!plot) return;
  commitQuestNode(ctx, plot, normalizeQuestChunk(chunk.output, plot));
});

registerMerger("quest_generation_merger", (chunks, ctx) =>
  buildQuestGraph(chunks.flatMap((c) => questsOfChunk(ctx, c.chunkId, c.output))),
);

registerNormalizer("quest_generation_normalizer", async (merged, ctx) => {
  const graph = merged as QuestGraph;
  await qaQuestGraphIfFull(ctx, graph);
  return graph;
});

// ── M2 原子迁移：preference_analysis / initial_plan / worldview / lore_generation ──

registerValidator("preference_analysis_validator", (raw) => {
  validatePreferenceAnalysis(raw);
});
registerNormalizer("preference_analysis_normalizer", (parsed, ctx) =>
  normalizePreferenceAnalysis(parsed, ctx),
);

registerValidator("initial_plan_validator", (raw) => {
  validateInitialPlan(raw);
});
registerNormalizer("initial_plan_normalizer", (parsed, ctx) =>
  normalizeInitialPlan(parsed, ctx),
);

registerValidator("worldview_validator", (raw) => {
  validateWorldview(raw);
});
registerNormalizer("worldview_normalizer", (parsed) =>
  normalizeWorldview(parsed as Parameters<typeof normalizeWorldview>[0]),
);

registerValidator("lore_generation_validator", (raw) => {
  validateLoreGeneration(raw);
});
registerNormalizer("lore_generation_normalizer", (parsed, ctx) =>
  normalizeLoreGeneration(parsed, ctx),
);

// ── structure_check：确定性席位，无 LLM 调用 ─────────────────────────────

registerProcessor("structure_check_processor", (ctx) => {
  (ctx as Record<string, unknown>).structure_check_report = buildStructureCheckReport(ctx);
});

// ── content_check：preflight 短路空材料，避免对着空剧情发请求 ──────────────

registerValidator("content_check_validator", (raw) => {
  validateContentCheck(raw);
});
registerNormalizer("content_check_normalizer", (parsed) => normalizeContentCheck(parsed));
registerPreflight("content_check_preflight", (ctx) => contentCheckPreflight(ctx));

// ── encyclopedia_retrieval：preflight 联网实检，结果落 ctx 私有键供 composer/normalizer 读 ──

registerValidator("encyclopedia_validator", (raw) => {
  validateEncyclopedia(raw);
});
registerNormalizer("encyclopedia_normalizer", (parsed, ctx) => normalizeEncyclopedia(parsed, ctx));
registerPreflight("encyclopedia_preflight", (ctx, llm) => encyclopediaPreflight(ctx, llm));

// ── 打磨家族四席：deai_polish / plot_refine / plot_polish / playability_adapt ──
//
// 四席共用 polish-family 的splitter/merger/chunk_done 工厂，只是各自套自己的 PolishSeatSpec，
// 与 buildPolishComposer 按 spec 出各自 composer 是同一惯例。

registerValidator("deai_polish_validator", (raw) => validatePolishOutput(raw));
registerSplitter("deai_polish_splitter", polishSplitter(DEAI_SPEC));
registerChunkSink("deai_polish_chunk_done", polishChunkDone(DEAI_SPEC));
registerMerger("deai_polish_merger", polishMerger(DEAI_SPEC));

registerValidator("plot_refine_validator", (raw) => validatePolishOutput(raw));
registerSplitter("plot_refine_splitter", polishSplitter(PLOT_REFINE_SPEC));
registerChunkSink("plot_refine_chunk_done", polishChunkDone(PLOT_REFINE_SPEC));
registerMerger("plot_refine_merger", polishMerger(PLOT_REFINE_SPEC));

registerValidator("plot_polish_validator", (raw) => validatePolishOutput(raw));
registerSplitter("plot_polish_splitter", polishSplitter(PLOT_POLISH_SPEC));
registerChunkSink("plot_polish_chunk_done", polishChunkDone(PLOT_POLISH_SPEC));
registerMerger("plot_polish_merger", polishMerger(PLOT_POLISH_SPEC));

registerValidator("playability_adapt_validator", (raw) => validatePolishOutput(raw));
registerSplitter("playability_adapt_splitter", polishSplitter(PLAYABILITY_SPEC));
registerChunkSink("playability_adapt_chunk_done", polishChunkDone(PLAYABILITY_SPEC));
registerMerger("playability_adapt_merger", polishMerger(PLAYABILITY_SPEC));

// ── story_framework：sequence 原语，四阶段与 legacy 共用同一批函数 ──────────

registerStageComposer("story_framework_plan", STORY_FRAMEWORK_PLAN_COMPOSER);
registerStageComposer("story_framework_fill", STORY_FRAMEWORK_FILL_COMPOSER);
registerValidator("story_framework_plan_validator", (raw, ctx) => validateStoryFrameworkPlan(raw, ctx));
registerValidator("story_framework_fill_validator", (raw) => validateStoryFrameworkFill(raw));
registerProcessor("story_framework_route", (ctx) => storyFrameworkRoute(ctx));
registerProcessor("story_framework_prepare_regen", (ctx) => storyFrameworkPrepareRegen(ctx));
registerProcessor("story_framework_prepare_full", (ctx) => storyFrameworkPrepareFull(ctx));
registerNormalizer("story_framework_normalizer", (parsed, ctx) => normalizeStoryFramework(parsed, ctx));

// ── plot_generation：wave 原语，与 legacy 共用同一批函数 ──────────────────

registerValidator("plot_generation_validator", (raw) => validatePlotGeneration(raw));
registerWaveLayerer("plot_generation_wave_layerer", (ctx) => plotGenerationWaveLayerer(ctx));
registerWaveConstraintCheck("plot_generation_wave_constraint_check", (output, ctx, unit) =>
  plotGenerationWaveConstraintCheck(output, ctx, unit));
registerWaveSummarizer("plot_generation_wave_summarizer", (output) => plotGenerationWaveSummarizer(output));
registerChunkSink("plot_generation_chunk_done", (chunk, ctx) => plotGenerationChunkDone(chunk, ctx));
registerMerger("plot_generation_merger", (results, ctx) => plotGenerationMerger(results, ctx));
registerNormalizer("plot_generation_normalizer", (merged, ctx) => normalizePlotGeneration(merged, ctx));

// ── script_generation：wave 原语，与 legacy 共用同一批函数 ──────────────────

registerValidator("script_generation_validator", (raw) => validateScriptGeneration(raw));
registerWaveLayerer("script_generation_wave_layerer", (ctx) => scriptGenerationWaveLayerer(ctx));
registerWaveConstraintCheck("script_generation_wave_constraint_check", (output, ctx, unit) =>
  scriptGenerationWaveConstraintCheck(output, ctx, unit));
registerWaveSummarizer("script_generation_wave_summarizer", (output) => scriptGenerationWaveSummarizer(output));
registerChunkSink("script_generation_chunk_done", (chunk, ctx) => scriptGenerationChunkDone(chunk, ctx));
registerMerger("script_generation_merger", (results, ctx) => scriptGenerationMerger(results, ctx));
