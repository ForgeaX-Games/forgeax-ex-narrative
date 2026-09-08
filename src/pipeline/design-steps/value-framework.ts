/**
 * D3: 数值框架 — 展开资源循环 → 经济/成长/平衡
 */
import type { NarrativeContext } from "../../types/index.js";
import type { ValueFramework } from "../../types/game-design.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildValueSkillSummary } from "../../knowledge/game-design/system-skill-recommender.js";
import { appendUserInstructions } from "../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../runtime/prompt-composer.js";

const VALUE_FRAMEWORK_COMPOSER: PromptComposer = {
  stepId: "value_framework",
  skillSlots: ["constraints"],
  systemBlockOrder: ["role", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: "你是一位游戏数值策划，擅长为不同品类游戏设计合理的经济体系、成长曲线和平衡性。",

    output_format: `## 输出要求（严格JSON）

{
  "resource_detail": {
    "currencies": [
      {
        "id": "货币ID",
        "name": "货币名称",
        "type": "premium|soft|energy|token|score",
        "cap": null或数字,
        "description": "说明"
      }
    ],
    "acquisition_channels": [
      {"name": "获取渠道", "rate": "获取速率描述", "systems": ["关联系统ID"]}
    ],
    "consumption_channels": [
      {"name": "消耗渠道", "cost": "消耗量描述", "systems": ["关联系统ID"]}
    ],
    "balance_notes": ["平衡设计要点1", "要点2"]
  },
  "growth": {
    "curve_type": "曲线类型(linear/exponential/logarithmic/s-curve)",
    "milestones": [
      {"level": "阶段", "unlock": "解锁内容"}
    ]
  },
  "combat_values": {
    "base_stats": "基础属性描述",
    "damage_formula": "伤害公式描述",
    "scaling_note": "数值缩放说明"
  },
  "difficulty": {
    "curve_type": "难度曲线类型",
    "stages": [
      {"name": "阶段名", "description": "难度描述"}
    ]
  }
}

要求：
1. currencies 至少包含游戏的主要货币/资源
2. acquisition_channels 和 consumption_channels 需要与D2中的系统对应
3. combat_values 仅在品类有战斗系统时填写，否则设为 null
4. growth milestones 至少3个关键节点
5. difficulty stages 至少3个阶段
6. 数值设计必须符合品类惯例`,

    context_inputs: (ctx: NarrativeContext): string => {
      const da = ctx.demand_analysis;
      const cc = ctx.core_concept;
      const sd = ctx.system_details;
      if (!da || !cc) throw new Error("D3 requires demand_analysis and core_concept");

      const resourceLoop = cc.three_loops.resource_loop;
      const gameplayLoop = cc.three_loops.gameplay_loop;

      const systemsBrief = sd
        ? sd.systems
            .filter((s) => ["economy", "leveling", "equipment", "loot", "stats", "combat", "shop", "crafting"].includes(s.id))
            .map((s) => `${s.name}: ${s.design_brief.slice(0, 80)}`)
            .join("\n")
        : "";

      const valueSkillSummary = buildValueSkillSummary(da.genre_code);
      const valueSkillBlock = valueSkillSummary
        ? `\n\n## 数值/经济相关系统设计参考（摘自子系统 Skill 库）\n${valueSkillSummary}`
        : "";

      return `## 游戏信息
游戏: ${cc.game_name} | 品类: ${da.genre_name}
单次会话时长: ${gameplayLoop.session_length}
${gameplayLoop.meta_loop ? `外循环: ${gameplayLoop.meta_loop}` : ""}

## 资源循环定义（来自D0）
${JSON.stringify(resourceLoop, null, 2)}

## 相关系统设计摘要（来自D2）
${systemsBrief}${valueSkillBlock}`;
    },

    task_instruction: "请根据上述信息设计完整的数值框架。",
  },
};

export async function valueFramework(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const sp = composeSystemPrompt(VALUE_FRAMEWORK_COMPOSER, ctx);
  const up = composeUserPrompt(VALUE_FRAMEWORK_COMPOSER, ctx);

  const raw = await llm.callWithRetry(
    sp,
    appendUserInstructions(up, ctx),
    { temperature: 0.5, responseFormat: "json" },
    (r) => {
      const parsed = extractJSON<ValueFramework>(r);
      if (!parsed.resource_detail || !parsed.growth) throw new Error("缺少 resource_detail 或 growth");
    },
    streamEmit,
  );

  ctx.value_framework = extractJSON<ValueFramework>(raw);
}
