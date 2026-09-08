/**
 * D4: 策划案整合 — 完整策划文档 + 叙事需求接口
 */
import type { NarrativeContext, TierId } from "../../types/index.js";
import type {
  GameDesignContext,
  NarrativeRequirements,
  NarrativeDepth,
} from "../../types/game-design.js";
import type { NarrativeType } from "../../knowledge/genre-narrative-type.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { appendUserInstructions } from "../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../runtime/prompt-composer.js";

function getNarrativeDepth(tier: TierId): NarrativeDepth {
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

function getAvailableNarrativeModes(type: NarrativeType): string[] {
  const modes: string[] = ["auto"];
  switch (type) {
    case "linear":      modes.push("full", "script", "novel", "story_outline", "story_framework"); break;
    case "branching":   modes.push("full", "script", "novel"); break;
    case "fragmented":  modes.push("worldview", "character", "item_lore"); break;
    case "emergent":    modes.push("emergent", "worldview"); break;
    case "minimal":     modes.push("narrative_card"); break;
  }
  return modes;
}

const DESIGN_DOC_COMPOSER: PromptComposer = {
  stepId: "design_doc",
  skillSlots: ["constraints"],
  systemBlockOrder: ["role", "task", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: "你是一位资深游戏策划总监，擅长整合多个设计模块并评估完整性。",

    task: "整合前序步骤的所有设计产出，生成叙事需求接口。",

    output_format: `## 输出要求（严格JSON）

生成叙事需求接口和完整性检查：

{
  "completeness": {
    "missing": ["缺失项1", "..."],
    "warnings": ["警告1", "..."],
    "coverage": 0.0到1.0的覆盖率
  },
  "narrative_requirements": {
    "priority_content": ["按需求值降序的内容类型"],
    "constraints": ["叙事必须遵守的策划约束1", "约束2"],
    "system_context": [
      {"id": "系统ID", "name": "系统名", "brief": "叙事需要参考的摘要"}
    ],
    "loops_summary": {
      "gameplay_loop": "玩法循环一句话摘要",
      "resource_loop": "资源循环一句话摘要"
    }
  }
}

要求：
1. completeness.coverage 评估 D0-D3 四步的完整度
2. priority_content 根据 needs 矩阵值降序排列内容类型
3. constraints 来自策划设计对叙事的限制（如"角色必须有好感度阶段"）
4. system_context 提取 D2 中与叙事相关的系统摘要
5. loops_summary 简要概括两个循环供叙事参考`,

    context_inputs: (ctx: NarrativeContext): string => {
      const da = ctx.demand_analysis;
      const cc = ctx.core_concept;
      const sa = ctx.system_architecture;
      const sd = ctx.system_details;
      const vf = ctx.value_framework;
      if (!da || !cc) throw new Error("D4 requires demand_analysis and core_concept");

      const systemCount = sd?.systems.length ?? 0;
      const systemNames = sd?.systems.map((s) => s.name).join("、") ?? "无";
      const currencyNames = vf?.resource_detail.currencies.map((c) => c.name).join("、") ?? "无";

      return `## 游戏概况
名称: ${cc.game_name}
品类: ${da.genre_name}(${da.genre_code})
Tier: ${da.tier}
叙事类型: ${da.narrative_type}

## 已完成的设计
- D0 核心概念: ${cc.one_liner}
- D1 系统架构: ${sa?.generation_order.length ?? 0} 个系统
- D2 系统设计: ${systemCount} 个系统(${systemNames})
- D3 数值框架: ${currencyNames}

## 叙事需求矩阵（品类知识库）
W=${da.narrative_needs.W ?? 0}, C=${da.narrative_needs.C ?? 0}, S=${da.narrative_needs.S ?? 0}, D=${da.narrative_needs.D ?? 0}, Q=${da.narrative_needs.Q ?? 0}, E=${da.narrative_needs.E ?? 0}, I=${da.narrative_needs.I ?? 0}, U=${da.narrative_needs.U ?? 0}, L=${da.narrative_needs.L ?? 0}
(W=世界观, C=角色, S=剧情, D=对话, Q=支线, E=环境叙事, I=物品叙事, U=UI文案, L=Lore碎片)`;
    },

    task_instruction: "请整合所有设计产出，生成叙事需求接口和完整性检查。",
  },
};

export async function designDoc(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const da = ctx.demand_analysis;
  const cc = ctx.core_concept;
  if (!da || !cc) throw new Error("D4 requires demand_analysis and core_concept");

  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const sp = composeSystemPrompt(DESIGN_DOC_COMPOSER, ctx);
  const up = composeUserPrompt(DESIGN_DOC_COMPOSER, ctx);

  const raw = await llm.callWithRetry(
    sp,
    appendUserInstructions(up, ctx),
    { temperature: 0.3, responseFormat: "json" },
    (r) => {
      const parsed = extractJSON<{ completeness: unknown; narrative_requirements: unknown }>(r);
      if (!parsed.completeness || !parsed.narrative_requirements) {
        throw new Error("缺少 completeness 或 narrative_requirements");
      }
    },
    streamEmit,
  );

  const llmResult = extractJSON<{
    completeness: GameDesignContext["completeness"];
    narrative_requirements: Partial<NarrativeRequirements>;
  }>(raw);

  // 组装 narrative_requirements，合并 LLM 输出和知识库数据
  const tier = da.tier;
  const narrativeType = da.narrative_type;
  const depth = getNarrativeDepth(tier);

  const narrativeRequirements: NarrativeRequirements = {
    needs: da.narrative_needs,
    narrative_type: narrativeType,
    depth,
    available_modes: getAvailableNarrativeModes(narrativeType),
    recommended_mode: getDefaultNarrativeMode(narrativeType, tier),
    priority_content: llmResult.narrative_requirements.priority_content ?? [],
    constraints: llmResult.narrative_requirements.constraints ?? [],
    system_context: llmResult.narrative_requirements.system_context ?? [],
    loops_summary: llmResult.narrative_requirements.loops_summary ?? {
      gameplay_loop: "",
      resource_loop: "",
    },
  };

  // 组装完整 game_design_context
  const gdc: GameDesignContext = {
    core_concept: cc,
    system_architecture: ctx.system_architecture ?? {
      categories: { core: [], gameplay: [], progression: [], social: [], presentation: [] },
      dependency_graph: [],
      generation_order: [],
    },
    system_details: ctx.system_details ?? { systems: [] },
    value_framework: ctx.value_framework ?? {
      resource_detail: { currencies: [], acquisition_channels: [], consumption_channels: [], balance_notes: [] },
      growth: { curve_type: "linear", milestones: [] },
      difficulty: { curve_type: "linear", stages: [] },
    },
    completeness: llmResult.completeness,
    narrative_requirements: narrativeRequirements,
  };

  ctx.game_design_context = gdc;
  ctx.narrative_requirements = narrativeRequirements;
}
