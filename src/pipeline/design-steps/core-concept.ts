/**
 * D0: 核心概念 — High Concept + 三大循环定义 + 叙事支柱
 */
import type { NarrativeContext } from "../../types/index.js";
import type { CoreConcept } from "../../types/game-design.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { getLoopTemplate } from "../../knowledge/game-design/game-loops.js";
import { GENRE_TAXONOMY } from "../../knowledge/genre-taxonomy.js";
import { appendUserInstructions } from "../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../runtime/prompt-composer.js";

const CORE_CONCEPT_COMPOSER: PromptComposer = {
  stepId: "core_concept",
  skillSlots: ["constraints"],
  systemBlockOrder: ["role", "task", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: "你是一位资深游戏策划总监，擅长从用户模糊需求中提炼出清晰的游戏核心概念。",

    task: "根据以下信息生成游戏核心概念文档。",

    output_format: `## 输出要求（严格JSON）

生成完整的核心概念文档，包含三大循环的设计。结构如下：

{
  "game_name": "游戏名称",
  "one_liner": "一句话概括(20字以内)",
  "core_experience": {
    "emotion": "核心情感体验",
    "gameplay": "核心玩法体验",
    "narrative": "核心叙事体验"
  },
  "narrative_pillars": ["叙事支柱1", "叙事支柱2", "..."],
  "scale_estimate": {
    "play_hours": 数字,
    "chapters": 数字,
    "characters": 数字,
    "endings": 数字
  },
  "reference_games": ["参考游戏1", "参考游戏2"],
  "three_loops": {
    "system_loop": {
      "description": "系统循环总体描述",
      "core_systems": ["核心基础系统ID"],
      "gameplay_systems": ["玩法实现系统ID"],
      "support_systems": ["辅助表现系统ID"],
      "flow": "系统运行流程描述"
    },
    "gameplay_loop": {
      "description": "玩法循环总体描述",
      "stages": [
        {
          "name": "阶段名",
          "player_action": "玩家行为",
          "systems_involved": ["涉及系统ID"],
          "emotion": "情感体验"
        }
      ],
      "session_length": "单次循环时长",
      "meta_loop": "外循环描述(可选)"
    },
    "resource_loop": {
      "description": "资源循环总体描述",
      "currencies": ["货币1", "货币2"],
      "sources": [{"name": "来源名", "description": "说明"}],
      "sinks": [{"name": "消耗名", "description": "说明"}],
      "transformations": [{"input": "输入", "output": "输出", "via": "途径"}],
      "growth_driver": "成长驱动力"
    }
  }
}

要求：
1. 三大循环必须完整，与品类匹配
2. system_loop 中的系统ID必须来自已识别的必需/推荐系统列表
3. gameplay_loop 的 stages 需要至少3个阶段
4. resource_loop 需要明确的产出和消耗途径
5. 所有内容必须与用户需求和品类特征一致`,

    context_inputs: (ctx: NarrativeContext): string => {
      const da = ctx.demand_analysis;
      if (!da) throw new Error("D0 requires demand_analysis from tier_router");

      const genreEntry = GENRE_TAXONOMY.find((g) => g.code === da.genre_code);
      const loopTemplate = getLoopTemplate(da.genre_code);

      const genreInfo = genreEntry
        ? `品类: ${genreEntry.name}(${genreEntry.code}), Tier: ${da.tier}, 叙事占比: ${genreEntry.narrative_ratio}`
        : `品类: ${da.genre_name}(${da.genre_code}), Tier: ${da.tier}`;

      const loopRef = loopTemplate
        ? `\n## 品类循环模板参考\n\`\`\`json\n${JSON.stringify(loopTemplate, null, 2)}\n\`\`\`\n该模板仅为参考起点，请基于用户需求进行个性化调整。`
        : "";

      return `## 用户需求
${ctx.user_input}

## 品类识别结果
${genreInfo}
题材: ${da.theme.name}(${da.theme.code})
必需系统: ${da.required_systems.join(", ")}
推荐系统: ${da.recommended_systems.join(", ")}
${loopRef}`;
    },

    task_instruction: "请根据上述信息生成完整的游戏核心概念文档。",
  },
};

export async function coreConcept(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const sp = composeSystemPrompt(CORE_CONCEPT_COMPOSER, ctx);
  const up = composeUserPrompt(CORE_CONCEPT_COMPOSER, ctx);

  const raw = await llm.callWithRetry(
    sp,
    appendUserInstructions(up, ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => {
      const parsed = extractJSON<CoreConcept>(r);
      if (!parsed.game_name || !parsed.three_loops) throw new Error("缺少必需字段 game_name 或 three_loops");
    },
    streamEmit,
  );

  ctx.core_concept = extractJSON<CoreConcept>(raw);
}
