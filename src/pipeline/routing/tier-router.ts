import type { NarrativeContext, TierId, TierDetectionResult } from "../../types/index.js";
import type { DemandAnalysis, GameplayStage, ResourceNode } from "../../types/game-design.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { GENRE_TAXONOMY, matchGenre, findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import { getNarrativeType } from "../../knowledge/genre-narrative-type.js";
import type { NarrativeType } from "../../knowledge/genre-narrative-type.js";
import { getRequiredAndRecommended } from "../../knowledge/game-design/system-matrix.js";
import { getLoopTemplate } from "../../knowledge/game-design/game-loops.js";

const TIER_LABELS: Record<TierId, string> = {
  tier1: "叙事驱动型（70-95%叙事占比）",
  tier2: "叙事增强型（40-70%叙事占比）",
  tier3: "叙事点缀型（15-40%叙事占比）",
  tier4: "无叙事型（0-15%叙事占比）",
};

function buildTaxonomySummary(): string {
  const grouped: Record<TierId, string[]> = {
    tier1: [], tier2: [], tier3: [], tier4: [],
  };
  for (const g of GENRE_TAXONOMY) {
    grouped[g.tier].push(`${g.code}(${g.name})`);
  }
  const lines: string[] = [];
  for (const [tier, items] of Object.entries(grouped)) {
    lines.push(`${tier} — ${TIER_LABELS[tier as TierId]}:`);
    lines.push(`  ${items.join(", ")}`);
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `你是一个游戏品类识别专家。根据用户的游戏需求描述，识别出最匹配的游戏品类和叙事强度等级(Tier)。

## 品类-Tier 映射表

${buildTaxonomySummary()}

## 输出格式（严格JSON）

{
  "tier": "tier1|tier2|tier3|tier4",
  "genre_code": "品类代码（如 rpg-jrpg）",
  "genre_name": "品类中文名（如 JRPG）",
  "theme_code": "题材代码（如 fantasy）",
  "theme_name": "题材中文名（如 奇幻）",
  "demand_type": "full_design_doc|concept_doc|script_dialogue|full_assets|single_module",
  "duration_minutes": 数字,
  "reasoning": "判断理由（1-2句话）"
}

## 规则
1. 如果用户描述明确指向某个品类，直接匹配
2. 如果描述含混，根据关键特征推断最可能的品类
3. 如果用户描述了一个休闲/超休闲游戏（三消、跑酷、IO等），归为 tier4
4. 如果无法确定，默认 tier1 + rpg-jrpg
5. theme_code 从用户描述中识别（fantasy/sci-fi/horror/romance/historical/modern/post-apocalyptic/wuxia/cyberpunk/military）
6. demand_type 根据用户意图判断：需要完整游戏设计选 full_design_doc，只要概念选 concept_doc，只要剧本选 script_dialogue，需要全资产选 full_assets
7. duration_minutes 根据品类和用户描述估算游戏总时长（分钟）`;

interface LLMDetectionResult {
  tier: TierId;
  genre_code: string;
  genre_name: string;
  theme_code?: string;
  theme_name?: string;
  demand_type?: string;
  duration_minutes?: number;
  reasoning: string;
}

function getNarrativeDepth(tier: TierId): "full" | "standard" | "basic" | "minimal" {
  switch (tier) {
    case "tier1": return "full";
    case "tier2": return "standard";
    case "tier3": return "basic";
    case "tier4": return "minimal";
  }
}

function getDefaultNarrativeMode(type: NarrativeType, tier: TierId): string {
  switch (type) {
    case "linear":      return tier === "tier1" ? "full" : "story_framework";
    case "branching":   return "full";
    // C3（2026-08）：mode "fragmented" 已从 MODE_CONFIGS 摘下（吸收进通用
    // lore_generation，见 mode-routing.ts / modes.ts 的封存注记），碎片化品类
    // 改由 narrative_auto（席位路由）承接。
    case "fragmented":  return "narrative_auto";
    case "emergent":    return "emergent";
    case "minimal":     return "narrative_card";
  }
}

function getAvailableNarrativeModes(type: NarrativeType, tier: TierId): string[] {
  const modes: string[] = ["auto"];
  switch (type) {
    case "linear":
      modes.push("full", "script", "novel", "story_outline", "story_framework");
      break;
    case "branching":
      modes.push("full", "script", "novel", "story_outline");
      break;
    case "fragmented":
      modes.push("worldview", "character", "item_lore");
      break;
    case "emergent":
      modes.push("emergent", "worldview");
      break;
    case "minimal":
      modes.push("narrative_card");
      break;
  }
  if (tier === "tier2" || tier === "tier3") {
    if (!modes.includes("worldview")) modes.push("worldview");
    if (!modes.includes("character")) modes.push("character");
  }
  return modes;
}

/**
 * 当 GENRE_TAXONOMY 命中失败时（manual / fallback 路径）的默认需求向量。
 * 数值范围 0-3（与 taxonomy 一致）：
 *   0=不需要 / 1=可选 / 2=推荐 / 3=必需
 */
function getDefaultNeedsByTier(tier: TierId): Record<string, number> {
  switch (tier) {
    case "tier1": return { W: 3, C: 3, S: 3, D: 3, Q: 2, E: 2, I: 2, U: 2, L: 2 };
    case "tier2": return { W: 2, C: 2, S: 2, D: 2, Q: 1, E: 1, I: 1, U: 1, L: 1 };
    case "tier3": return { W: 2, C: 1, S: 1, D: 1, Q: 0, E: 0, I: 1, U: 1, L: 0 };
    // Tier4 至少跑出"初步方案 + 世界观 + UI 文案"，避免空管线
    case "tier4": return { W: 1, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 };
  }
}

export function buildDemandAnalysis(
  genreCode: string,
  genreName: string,
  tier: TierId,
  themeCode: string,
  themeName: string,
  demandType: string,
  durationMinutes: number,
  reasoning: string,
): DemandAnalysis {
  const genreEntry = GENRE_TAXONOMY.find((g) => g.code === genreCode);
  const narrativeNeeds = genreEntry?.needs ?? getDefaultNeedsByTier(tier);
  const narrativeType = getNarrativeType(genreCode);

  const { required, recommended } = getRequiredAndRecommended(genreCode);
  const requiredSystems = required.map((s) => s.id);
  const recommendedSystems = recommended.map((s) => s.id);

  const loopTemplate = getLoopTemplate(genreCode);
  const loopTemplates = {
    system_loop: loopTemplate?.system_loop?.core_systems ?? [],
    gameplay_loop: (loopTemplate?.gameplay_loop?.stages ?? []) as GameplayStage[],
    resource_loop: (loopTemplate?.resource_loop?.sources ?? []) as ResourceNode[],
  };

  const availModes = getAvailableNarrativeModes(narrativeType, tier);
  const recMode = getDefaultNarrativeMode(narrativeType, tier);

  const volumeFeasibility = durationMinutes > 0
    ? (durationMinutes < 5 && tier === "tier1" ? "mismatch" as const :
       durationMinutes < 30 && (tier === "tier1" || tier === "tier2") ? "risky" as const : "ok" as const)
    : "ok" as const;

  return {
    genre_code: genreCode,
    genre_name: genreName,
    tier,
    theme: { code: themeCode, name: themeName },
    volume: {
      duration_minutes: durationMinutes,
      feasibility: volumeFeasibility,
      suggestion: volumeFeasibility === "mismatch" ? "游戏时长与品类不匹配，建议调整" : undefined,
    },
    demand_type: (demandType as DemandAnalysis["demand_type"]) || "full_design_doc",
    narrative_needs: narrativeNeeds as Record<string, number>,
    narrative_type: narrativeType,
    required_systems: requiredSystems,
    recommended_systems: recommendedSystems,
    loop_templates: loopTemplates,
    narrative_routing: {
      available_modes: availModes,
      recommended_mode: recMode,
    },
    reasoning,
  };
}

/**
 * TierRouter: 自动识别用户需求对应的游戏品类和 Tier，输出完整的 DemandAnalysis。
 * 先尝试关键词匹配（快速且免费），匹配失败再调用 LLM。
 */
export async function detectTier(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  // P0-1（§4.4d）：IP 改编种子已指定目标品类时，短路"源料品类识别"——
  // 避免"上传小说 → 被 LLM 识别成 rpg-jrpg"覆盖用户"我要做影游/互动叙事"的意图。
  // 注：显式 config.genreCode 已在 pipeline 层优先命中（explicitGenre），此处兜底覆盖
  // "未透传 config.genreCode 但改编指令携带 target_output.genre_code"的情形。
  const seededGenreCode = ctx.adaptation_directive?.game_unit_plan?.target_output?.genre_code;
  if (seededGenreCode) {
    const g = findGenreByCode(seededGenreCode);
    if (g) {
      ctx.tier_detection = {
        tier: g.tier,
        genre_code: g.code,
        genre_name: g.name,
        reasoning: `IP 改编目标品类锁定（短路源料识别）: ${g.name} (${g.code})`,
      };
      ctx.demand_analysis = buildDemandAnalysis(
        g.code, g.name, g.tier, "auto", "自动识别", "full_design_doc", 0,
        "IP 改编目标品类锁定（短路源料识别）",
      );
      return;
    }
  }

  const userInput = ctx.user_input;

  // 快速路径：关键词匹配
  const quickMatch = matchGenre(userInput);
  if (quickMatch) {
    const reasoning = `关键词匹配: ${quickMatch.keywords.filter((k) => userInput.toLowerCase().includes(k.toLowerCase())).join(", ")}`;

    ctx.tier_detection = {
      tier: quickMatch.tier,
      genre_code: quickMatch.code,
      genre_name: quickMatch.name,
      reasoning,
    };

    ctx.demand_analysis = buildDemandAnalysis(
      quickMatch.code,
      quickMatch.name,
      quickMatch.tier,
      "auto",
      "自动识别",
      "full_design_doc",
      0,
      reasoning,
    );
    return;
  }

  // 慢速路径：LLM 识别
  try {
    const raw = await llm.callWithRetry(
      SYSTEM_PROMPT,
      `用户需求：${userInput}`,
      { temperature: 0.1, responseFormat: "json" },
      (r) => {
        const parsed = extractJSON<LLMDetectionResult>(r);
        if (!parsed.tier || !parsed.genre_code) throw new Error("缺少必需字段");
      },
    );

    const result = extractJSON<LLMDetectionResult>(raw);

    const validTiers: TierId[] = ["tier1", "tier2", "tier3", "tier4"];
    if (!validTiers.includes(result.tier)) {
      result.tier = "tier1";
    }
    result.genre_name = result.genre_name ?? "未知品类";
    result.reasoning = result.reasoning ?? "";

    ctx.tier_detection = {
      tier: result.tier,
      genre_code: result.genre_code,
      genre_name: result.genre_name,
      reasoning: result.reasoning,
    };

    ctx.demand_analysis = buildDemandAnalysis(
      result.genre_code,
      result.genre_name,
      result.tier,
      result.theme_code ?? "auto",
      result.theme_name ?? "自动识别",
      result.demand_type ?? "full_design_doc",
      result.duration_minutes ?? 0,
      result.reasoning,
    );
  } catch (e) {
    console.warn(`[TierRouter] LLM detection failed, falling back to tier1: ${(e as Error).message}`);
    ctx.tier_detection = {
      tier: "tier1",
      genre_code: "fallback",
      genre_name: "默认（识别失败回退）",
      reasoning: `LLM识别失败: ${(e as Error).message.slice(0, 100)}`,
    };

    ctx.demand_analysis = buildDemandAnalysis(
      "rpg-jrpg",
      "JRPG",
      "tier1",
      "fantasy",
      "奇幻",
      "full_design_doc",
      0,
      `LLM识别失败回退: ${(e as Error).message.slice(0, 100)}`,
    );
  }
}
