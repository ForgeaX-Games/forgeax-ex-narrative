/**
 * 共享工具：将策划管线的输出注入到叙事步骤的 prompt 中。
 * 当 NarrativeContext 中有 game_design_context / narrative_requirements 时，
 * 生成一段 prompt 文本供叙事步骤参考。
 *
 * 也提供 userInstructions 注入：当 rerunFromStep 设置了 ctx._userInstructions 时，
 * 步骤函数可调用 appendUserInstructions 将修改意见追加到 LLM prompt。
 */
import type { NarrativeContext } from "../../types/index.js";

export function buildDesignContextSnippet(ctx: NarrativeContext): string {
  const nr = ctx.narrative_requirements;
  const gdc = ctx.game_design_context;
  const cc = ctx.core_concept;

  if (!nr && !cc) return "";

  const lines: string[] = ["\n## 策划约束（来自策划管线，叙事必须遵守）\n"];

  if (cc) {
    lines.push(`游戏名称: ${cc.game_name}`);
    lines.push(`一句话概括: ${cc.one_liner}`);
    if (cc.narrative_pillars?.length) {
      lines.push(`叙事支柱: ${cc.narrative_pillars.join("、")}`);
    }
    if (cc.three_loops?.gameplay_loop) {
      lines.push(`玩法循环: ${cc.three_loops.gameplay_loop.description}`);
    }
    lines.push("");
  }

  if (nr) {
    if (nr.constraints?.length) {
      lines.push("### 叙事约束");
      for (const c of nr.constraints) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }

    if (nr.system_context?.length) {
      lines.push("### 相关系统（叙事需参考）");
      for (const sc of nr.system_context.slice(0, 8)) {
        lines.push(`- ${sc.name}: ${sc.brief}`);
      }
      lines.push("");
    }

    if (nr.loops_summary) {
      if (nr.loops_summary.gameplay_loop) {
        lines.push(`玩法循环摘要: ${nr.loops_summary.gameplay_loop}`);
      }
      if (nr.loops_summary.resource_loop) {
        lines.push(`资源循环摘要: ${nr.loops_summary.resource_loop}`);
      }
      lines.push("");
    }

    if (nr.priority_content?.length) {
      lines.push(`优先内容: ${nr.priority_content.slice(0, 5).join("、")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Append user modification instructions to an LLM prompt when running in
 * rerunFromStep mode. Returns the original prompt unmodified if no instructions
 * are present on ctx.
 */
export function appendUserInstructions(prompt: string, ctx: NarrativeContext): string {
  const block = userInstructionsBlock(ctx);
  return block ? `${prompt}\n\n${block}` : prompt;
}

/**
 * 用户修改意见块本身（无则空串）。
 *
 * 供 PromptComposer 的 userBlockOrder 直接列为一块：提示词交给 composer 装配后，
 * user prompt 不再由 step 函数手工拼接，appendUserInstructions 那种"事后追加"
 * 就没有插入点了。两者共用同一段文案，措辞只有一处。
 */
export function userInstructionsBlock(ctx: NarrativeContext): string {
  const instructions = (ctx as Record<string, unknown>)._userInstructions as string | undefined;
  if (!instructions) return "";
  return `## 🚨 用户修改意见（本次重新生成的核心指导，必须优先遵守）\n${instructions}`;
}

/**
 * 原文参考块的两种语气，对应席位表里两类席位对上传原作的不同处置：
 *   - "adapt"（结构层：大纲 / 结构 / 情节）——原作的情节顺序与因果为准，
 *     只在游戏化结构层面重组；
 *   - "extract"（设定层：需求清单 / 策划文档 / 世界观 / 角色 / 道具 / 场景 / 设定集）——
 *     席位表逐条写的是「上传的是文件，则直接提炼文件里的内容即可」，
 *     职责是**抽取归档**而非再创作，套用 adapt 的"重组"口径会诱导模型改写原作设定。
 */
export type IpSourceMode = "adapt" | "extract";

/**
 * IP 原文参考块（§B2）：当存在 IP 改编范围内的原文切片（ctx.uploaded_script.content，
 * 由 IP DNA 编排在 buildGenerationInput 时注入）时，给本步一个显式、高优先级的
 * "原文权威性"指令。原文正文已由管线 M1.6 拼接到 user_input 末尾，此处不重复倾倒
 * 全文（避免 token 膨胀），仅声明其权威性与处置口径。
 * 无上传原文时返回空串（纯生成行为不变）。
 */
export function buildIpSourceReference(
  ctx: NarrativeContext,
  mode: IpSourceMode = "adapt",
): string {
  const u = ctx.uploaded_script;
  if (!u?.content?.trim()) return "";
  if (ctx.content_locale === "en") {
    const metaEn = u.description ?? `${u.format ?? "prose"} format, ~${u.char_count ?? u.content.length} chars`;
    if (mode === "extract") {
      return [
        "\n## 📖 Source material (extraction baseline, highest priority)",
        `This work adapts an existing IP. The source material (${metaEn}) is appended to the end of "user requirements". Your job here is to **extract** what this layer needs from it, not to invent afresh:`,
        "- Reuse names and meanings exactly as the source states them (characters, places, factions, items, locations) — no renaming, no embellishment;",
        "- Only extrapolate where this layer requires something the source never covers, and keep it compatible with established source facts;",
        "- Where the source contradicts itself, follow the version that recurs more often and sits closer to the main line; do not invent a third reading.",
      ].join("\n");
    }
    return [
      "\n## 📖 Source material (faithful-adaptation baseline, highest priority)",
      `This work adapts an existing IP. The source material (${metaEn}) is appended to the end of "user requirements"; treat it as the authoritative basis for this step:`,
      "- Keep the source's names for characters, places, factions and locations, plus its key lines; invent nothing that contradicts its core setting;",
      "- Event order, causality and character motivation follow the source; restructure only at the game layer (nodes / branches / units);",
      "- If the source is larger than this layer needs, condense per this layer's remit without dropping its pivotal turns or standout passages.",
    ].join("\n");
  }
  const meta = u.description ?? `${u.format ?? "prose"} 格式（约 ${u.char_count ?? u.content.length} 字）`;
  if (mode === "extract") {
    return [
      "\n## 📖 IP 原文参考（提炼基准，最高优先级）",
      `本作品改编自既有 IP，原文素材（${meta}）已附在「用户需求」末尾。本步的职责是**从原文中提炼**本层级需要的设定，不是另起炉灶重写：`,
      "- 原作已经写明的，直接沿用其名称与原义（人名、地名、势力、物品、场景），不改写、不美化、不换名；",
      "- 原作未涉及而本层级必须补全的，才允许推演补写，且必须与原文既有设定相容，并在措辞上与原作风格一致；",
      "- 原作中相互矛盾或语焉不详之处，以出现频次更高、与主线关系更紧的那一版为准，不擅自裁定成新设定；",
      "- 若原文体量大于本层级所需，按本层级职责取舍，但不得遗漏原文反复强调的核心设定。",
    ].join("\n");
  }
  return [
    "\n## 📖 IP 原文参考（忠实改编基准，最高优先级）",
    `本作品改编自既有 IP，原文素材（${meta}）已附在「用户需求」末尾，请将其作为本步创作的权威依据：`,
    "- 严格沿用原作的人名、地名、势力、场景命名与关键台词，不臆造与原作冲突的核心设定；",
    "- 情节顺序、因果关系与人物动机以原文为准，仅在游戏化结构（节点/分支/单元）层面做必要重组；",
    "- 若原文体量大于本层级所需，按本层级职责提炼，不遗漏原文中的关键转折与高光段落。",
  ].join("\n");
}

import { getStepSkill, renderStepSkillForSystemPrompt } from "../../knowledge/game-narrative/skill-loader.js";

/**
 * C5-P0：把品类 skill 拼到 system prompt 末尾。
 *
 * 调用方式（每个 step 改 1 行）：
 *   const SP = buildSkillSystemPrompt(BASE_SYSTEM_PROMPT, ctx, "worldview");
 *
 * 当 ctx.demand_analysis.genre_code 不存在或该品类未注册 skill 时，原样返回 baseSystemPrompt。
 *
 * 这是方案 A 的最小注入：所有 26 处 step 共用此 helper。后续 PromptComposer
 * (C6-P1) 重构的 step 会把 skill 内容插入命名 slot 而非末尾。
 */
export function buildSkillSystemPrompt(
  baseSystemPrompt: string,
  ctx: NarrativeContext,
  stepId: string,
): string {
  const genreCode = ctx.demand_analysis?.genre_code ?? ctx.tier_detection?.genre_code;
  if (!genreCode) return baseSystemPrompt;
  const block = getStepSkill(genreCode, stepId);
  if (!block) return baseSystemPrompt;
  const skillText = renderStepSkillForSystemPrompt(block);
  if (!skillText) return baseSystemPrompt;
  return `${baseSystemPrompt}\n\n## 🎭 品类专属指引（${genreCode}）\n${skillText}`;
}
