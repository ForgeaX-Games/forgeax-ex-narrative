/**
 * narrative-steps-defaults.ts
 * ─────────────────────────────────────────────────────────────────
 * 原型族（archetype）默认 narrativeSteps 派生。
 *
 * 目标：让「用户选择品类 → Planner 第一步即可定位完整管线」对全部 ~94 品类
 *       统一成立，而不仅是手写旗舰品类。
 *
 * 设计要点：
 *   - narrativeSteps 是「专属叙事段」（通用前驱 偏好→初步方案 之后的链）。
 *     管线结构是原型族级别的（同族品类结构相似，由 plan 的 7 原型分组背书）；
 *     品类「完全独立的提示词」由 stepSkills / prompts/*.md 承载，与此正交。
 *   - 仅影响 Planner（planPipeline Step 0）。旧 buildAutoSteps 路径不读此字段，
 *     因此对既有 pipeline-templates 回归测试零影响。
 *   - tpl-vn-v2（互动影游 9 步固定重型管线）与 tpl-narrative-card（tier4 单步）
 *     使用各自 preset 固定链，不在此派生（返回 undefined）。
 *
 * 步骤 ID 全部取自 modes.ts STEP_IDS，未发明新 ID。
 */
import type { GenreEntry } from "../../genre-taxonomy.js";
import { getArchetypeForGenre } from "../skill-loader.js";

type Needs = Record<string, number>;

function n(needs: Needs, k: string): number {
  return needs[k] ?? 0;
}

/**
 * 史诗叙事型：RPG 七单品链（②世界观 … ⑦场景），按 needs 裁剪。
 *
 * 阈值与 tpl-rpg preset 的 optional 一致：低叙事需求的 tier2 品类（如叙事音游、
 * 体育管理）只拼出前段，不会被强行赋予 11 步重型链。满需求品类拼出完整链。
 */
// 实体三件套（世界观 → 角色 → 道具）是各原型族的共同地基。
// 道具（item_database）在多数品类都承载叙事（武器/收集品/卡牌/遗物），
// 不应被轻易裁掉 —— 因此统一放宽到 I>=1 即纳入，仅纯无物品品类（I=0）才省略。
function entityBase(needs: Needs, charThreshold = 1): Array<string | string[]> {
  const steps: Array<string | string[]> = [];
  if (n(needs, "W") >= 1) steps.push("worldview");
  if (n(needs, "C") >= charThreshold) steps.push("character_enrichment");
  if (n(needs, "I") >= 1) steps.push("item_database");
  return steps;
}

/** 全量/史诗（RPG 同构）：世界观→角色→道具→框架→大纲→细纲→情节→剧本→[任务∥场景]。 */
function epicChain(needs: Needs): Array<string | string[]> {
  const steps: Array<string | string[]> = entityBase(needs, 2);
  if (n(needs, "S") >= 2) steps.push("story_framework");
  if (n(needs, "S") >= 2) steps.push("outline_batch");
  if (n(needs, "S") >= 3) steps.push("detailed_outline");
  if (n(needs, "S") >= 3) steps.push("plot_generation");
  if (n(needs, "D") >= 3) steps.push("script_generation");
  const tail: string[] = [];
  if (n(needs, "Q") >= 2) tail.push("quest_generation");
  if (n(needs, "E") >= 2) tail.push("scene_plan");
  if (tail.length === 1) steps.push(tail[0]);
  else if (tail.length > 1) steps.push(tail);
  if (steps.length === 0) steps.push("worldview");
  return steps;
}

/**
 * 分支叙事型：世界观→角色→道具→大纲→情节→（按需）剧本。
 *
 * C2（2026-08）已封存：原 branch_tree（分支树）/ dialogue_script（对话脚本）/
 * cinematic_storyboard（电影分镜）三个 tpl-vn 专属 step 随 vn-v1 一并搬进
 * `pipeline/_archive/vn-v1/`，业务功能吸收进通用 L0/L1/L3/L4 席位——
 * outline_batch 依赖 story_framework 提供的父节点骨架，故补上 L0 作为结构
 * 前置（原 branch_tree 无此依赖，吸收后复用通用大纲机制必须先有框架树）。
 * 触发条件与原逻辑一一对应：大纲/情节始终产出，剧本仍按 E>=1 门控。
 */
function branchingChain(needs: Needs): Array<string | string[]> {
  const steps: Array<string | string[]> = entityBase(needs, 1);
  if (steps.length === 0) steps.push("worldview");
  steps.push("story_framework", "outline_batch", "plot_generation");
  if (n(needs, "E") >= 1) steps.push("script_generation");
  return steps;
}

/** 碎片叙事型：世界观→角色→道具→场景→碎片叙事（lore）。环境/物品/Lore 承载碎片。 */
function fragmentedChain(needs: Needs): Array<string | string[]> {
  const steps: Array<string | string[]> = entityBase(needs, 1);
  if (steps.length === 0) steps.push("worldview");
  steps.push("scene_plan");
  steps.push("lore_generation");
  return steps;
}

/**
 * 涌现叙事型：世界观→角色→道具→（按需）场景→情节。系统驱动事件池。
 *
 * C3（2026-08）已封存：原 `emergent_event`（tpl-emergent 专属 step）随四个品类
 * 特化能力一并搬进 `_archive/specialized/`，业务功能（事件模板、触发条件、
 * 涌现节奏）吸收进通用 `plot_generation`，形态差异交给 `emergent.md` 结构卡。
 */
function emergentChain(needs: Needs): Array<string | string[]> {
  const steps: Array<string | string[]> = entityBase(needs, 1);
  if (steps.length === 0) steps.push("worldview");
  if (n(needs, "E") >= 1) steps.push("scene_plan");
  steps.push("plot_generation");
  return steps;
}

/** 轻量叙事型：世界观→角色→道具，点缀级叙事。 */
function lightweightChain(needs: Needs): Array<string | string[]> {
  const steps: Array<string | string[]> = entityBase(needs, 1);
  if (steps.length === 0) steps.push("worldview");
  return steps;
}

/**
 * 情节脊柱闭合校正。
 *
 * quest_generation / script_generation 硬依赖 plots_generated（上游为空时会静默
 * return，不报错但产物为空 —— 质量缺陷）。当某条链含这两个「情节消费者」却缺
 * plot_generation 时，自动在其之前补齐 L0–L3 脊柱中缺失的环节：
 *   story_framework → outline_batch → detailed_outline → plot_generation
 *
 * 这些都是 RPG 全量链里早已注册、早已带提示词的现成 step，补全不新增任何 agent
 * 或提示词，只是把声明式链上缺失的输入来源接回来。
 *
 * 注：scene_plan 不在校正范围 —— 它对缺失上游有 worldview 兜底，可安全降级。
 */
const PLOT_SPINE = [
  "story_framework",
  "outline_batch",
  "detailed_outline",
  "plot_generation",
] as const;

export function ensurePlotChainForConsumers(
  steps: Array<string | string[]>,
): Array<string | string[]> {
  const flat = steps.flatMap((s) => (Array.isArray(s) ? s : [s]));
  const hasConsumer =
    flat.includes("quest_generation") || flat.includes("script_generation");
  if (!hasConsumer) return steps;
  if (flat.includes("plot_generation")) return steps;

  const consumerIdx = steps.findIndex((e) =>
    Array.isArray(e)
      ? e.some((x) => x === "quest_generation" || x === "script_generation")
      : e === "quest_generation" || e === "script_generation",
  );
  if (consumerIdx < 0) return steps;

  // 按脊柱顺序补齐缺失环节（已存在的不重复），插到第一个消费者之前。
  const missing = PLOT_SPINE.filter((s) => !flat.includes(s));
  const out = [...steps];
  out.splice(consumerIdx, 0, ...missing);
  return out;
}

/**
 * 按品类（archetype + needs）派生默认 narrativeSteps。
 *
 * 返回 undefined 表示「该品类不走 narrativeSteps，沿用 preset 固定链」：
 *   - tpl-vn-v2：互动影游 9 步固定重型管线
 *   - tpl-narrative-card：tier4 单步 narrative_card
 */
export function deriveNarrativeSteps(
  entry: GenreEntry,
): Array<string | string[]> | undefined {
  if (entry.pipelineTemplate === "tpl-vn-v2") return undefined;
  if (entry.pipelineTemplate === "tpl-narrative-card") return undefined;

  // 模板级专属链（archetype 映射会丢失这些品类的专属 step，故先按模板处理）。
  //
  // C3（2026-08）已封存：card_lore/event_pool/region_design/emergent_event 四个
  // 品类特化 step 随实现搬进 `_archive/specialized/`，业务功能吸收进通用
  // lore_generation（card_lore/region_design）与 plot_generation（event_pool/
  // emergent_event），形态差异交给 network/emergent/fragmented 三张结构卡。
  if (entry.pipelineTemplate === "tpl-card-game") {
    return ["worldview", "lore_generation", "plot_generation"];
  }
  if (entry.pipelineTemplate === "tpl-open-world") {
    return ensurePlotChainForConsumers([
      "worldview",
      "character_enrichment",
      "item_database",
      "lore_generation",
      "plot_generation",
      ["quest_generation", "scene_plan"],
    ]);
  }

  const archetype = getArchetypeForGenre(entry.code);
  const needs = entry.needs as Needs;

  switch (archetype) {
    case "epic":
      return ensurePlotChainForConsumers(epicChain(needs));
    case "branching":
      return branchingChain(needs);
    case "fragmented":
      return fragmentedChain(needs);
    case "emergent":
      return emergentChain(needs);
    case "lightweight":
      return lightweightChain(needs);
    case "micro":
      return undefined; // tier4 单步，走 preset
    default:
      return lightweightChain(needs);
  }
}
