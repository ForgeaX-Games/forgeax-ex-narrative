import type { NarrativeContext, NarrativeCard } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { matchPreset, WRITING_CORE, OUTPUT_TEMPLATE, type Tier4Preset } from "../../knowledge/game-narrative/tier4-presets.js";
import { buildDesignContextSnippet, buildIpSourceReference, userInstructionsBlock } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK } from "../runtime/prompt-composer.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";

function buildPresetContext(preset: Tier4Preset): string {
  let ctx = `品类：${preset.name}\n\n`;
  ctx += `## 组合逻辑\n${preset.comboLogic}\n\n`;

  ctx += `## 要素库\n`;
  for (const table of preset.elements) {
    ctx += `### ${table.category}\n`;
    for (const row of table.rows) {
      ctx += `- ${row.type}: ${row.variants}\n`;
    }
    ctx += "\n";
  }

  if (preset.examples.length > 0) {
    ctx += `## 组合示例\n`;
    for (const ex of preset.examples) {
      ctx += `- **${ex.name}**: 主角=${ex.protagonist}, 动机=${ex.motivation}, 目标=${ex.target}, 挑战=${ex.challenge}, 结局=${ex.ending}\n`;
    }
  }

  return ctx;
}

export const NARRATIVE_CARD_COMPOSER: PromptComposer = {
  stepId: "narrative_card",
  blocks: {
    cot: `## 机制与流程
1. 分析用户需求文本，先认准游戏品类与核心玩法——故事是给这套玩法做包装的。
2. 从品类预设中匹配最贴合的一组，用它的组合逻辑与要素库构思故事。
3. 按三段式落故事，每一段都要能对应到玩家实际会做的操作。
4. 补齐玩法映射与关卡拓展，让"故事怎么讲"和"关卡怎么长"是同一件事的两面。
5. 自检：名称有没有记忆点？一句话能不能秒懂？故事有没有画面感？映射是否准确？关卡是否有递进？`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    role: `你是一个休闲游戏叙事设计师。根据用户的游戏需求和品类预设，生成一张完整的叙事卡。

## 本环节的位置
你面对的是**叙事要求极低**的品类（消除、放置、休闲益智等）：玩家为玩法而来，故事只是让玩法讲得通、有点期待感的一层包装。
这一步是整条管线上**唯一**的叙事环节——没有上游的世界观、角色档案可依赖，也没有下游细化。
因此这张卡必须自成一体：读完就够开工，不留"细节待补"的口子；也不要越界去写玩法数值或关卡参数。
宁可薄而完整，不要厚而半成品。`,
    task_spec: `## 写作公式
${WRITING_CORE.formula}

## 三段式故事结构
- 第一段：${WRITING_CORE.storyStructure.p1}
- 第二段：${WRITING_CORE.storyStructure.p2}
- 第三段：${WRITING_CORE.storyStructure.p3}

## 写作原则
${WRITING_CORE.principles.map((p) => `- ${p}`).join("\n")}`,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `## 输出格式（严格JSON）
{
  "game_name": "游戏名称",
  "one_liner": "一句话（15-30字，秒懂+想玩）",
  "story": "三段式故事（150-200字）",
  "gameplay_mapping": {
    "你是": "...",
    "核心行动": "...",
    "收集/消除": "...",
    "失败意味着": "...",
    "最终目标": "..."
  },
  "level_expansion": {
    "scene_line": "场景线（如：森林→雪山→火山→海底）",
    "difficulty_line": "难度线（如：敌人更强/时间更紧）",
    "final_chapter": "最终章（如：Boss战/大团圆）"
  }
}`,
    // ── 上下文输入段（八段骨架第 ⑦ 段）──
    // 这几块原先是 step 函数里手工拼的字符串。搬进 composer 是为了让 user prompt
    // 也有单一事实源：runner 只认 composer 装配出来的提示词，留在函数体里就意味着
    // 「跑 runner」与「跑 step 函数」会发出两份不同的 user prompt。
    user_request: (ctx: NarrativeContext): string => `用户需求：${ctx.user_input}`,
    preset_context: (ctx: NarrativeContext): string =>
      `## 匹配到的品类预设\n${buildPresetContext(matchPreset(ctx.user_input))}`,
    design_constraints: (ctx: NarrativeContext): string => {
      const snippet = buildDesignContextSnippet(ctx);
      return snippet ? `## 策划约束（若有）\n${snippet}` : "";
    },
    output_reference: `## 输出模板参考\n${OUTPUT_TEMPLATE}`,
    task_request: `请根据用户需求和品类预设，生成一张完整的叙事卡（JSON格式）。
要求：
1. 游戏名称要有创意，体现游戏主题
2. 一句话要让人秒懂玩法+想玩
3. 故事要有画面感，用短句保持节奏
4. 玩法映射要准确对应游戏核心机制
5. 关卡拓展要有递进感`,
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
  systemBlockOrder: ["role", "task_spec", "ip_dna", "style_guide", "constraints", "cot", "ip_source", "output_schema"],
  userBlockOrder: [
    "user_request",
    "preset_context",
    "design_constraints",
    "output_reference",
    "task_request",
    "user_instructions",
  ],
  skillSlots: ["style_guide", "constraints"],
};

/**
 * Tier4 叙事卡生成步骤（兼容期实现）。
 *
 * 本席已切到 SingleTurnRunner（AgentDef.useNewRunner），提示词与校验都由
 * composer + validator 提供，两条路发出的文本完全相同——所以这个函数只在
 * 未注册 AgentDef 的场景下作为兜底存在，不再是唯一实现。
 */
export async function narrativeCardGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const raw = await llm.callWithRetry(
    composeSystemPrompt(NARRATIVE_CARD_COMPOSER, ctx),
    composeUserPrompt(NARRATIVE_CARD_COMPOSER, ctx),
    { temperature: 0.8 },
    (r) => {
      const card = extractJSON<NarrativeCard>(r);
      if (!card.game_name || !card.one_liner || !card.story) {
        throw new Error("叙事卡缺少必需字段: game_name/one_liner/story");
      }
    },
  );

  ctx.narrative_card = extractJSON<NarrativeCard>(raw);
}
