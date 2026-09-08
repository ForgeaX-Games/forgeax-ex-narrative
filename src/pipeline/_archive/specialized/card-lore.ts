/**
 * card-lore.ts (F3)
 * ─────────────────────────────────────────────────────────────────
 * 卡牌游戏卡牌叙事 Lore：为每张卡片输出独立但相互关联的叙事片段。
 *
 * 使用 PromptComposer 模式，CCG / 叙事卡牌品类的 skill 通过
 * card_lore.slots.* 注入 flavor 风格、势力体系、稀有度规则。
 *
 * C3（2026-08）已封存：不再被任何活跃代码 import。业务功能（势力体系/稀有度
 * 文本/flavor_text 与关联卡牌）吸收进通用 `lore_generation`，形态差异交给
 * `fragmented.md` 结构卡；needs 门控（原 needs.L>=2 或 needs.I>=2）改由品类
 * skill 选择承担。详见 `../README.md` 吸收台账。
 */
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { type PromptComposer } from "../../runtime/prompt-composer.js";
import { runUniversalAgent } from "../universal-agent/index.js";
import { createComposerCapability } from "../universal-agent/universal-narrative.js";

const ROLE = `你是 CCG 卡牌游戏 Lore 设计师。基于世界观，为每张代表性卡片输出叙事文本。`;

const TASK = `## 任务
- 至少 20-40 张卡片，跨越多个势力
- 同势力卡片有 lore 关联，可串成完整故事线
- flavor_text 简短有力（1-3 句），不说教
- lore 与卡牌机制（费用 / 类型 / 稀有度）保持一致`;

const STYLE_PLACEHOLDER = `## 风味 / 文学调性
{{SKILL.style_guide}}`;

const FACTION_PLACEHOLDER = `## 势力体系
{{SKILL.faction_rules}}`;

const RARITY_PLACEHOLDER = `## 稀有度文本规则
{{SKILL.rarity_rules}}`;

const CONSTRAINTS_PLACEHOLDER = `## 硬性约束
{{SKILL.constraints}}`;

const OUTPUT_FORMAT = `## 输出格式（严格 JSON）
{
  "cards": [
    {
      "id": "CARD_01",
      "name": "卡牌名（中文）",
      "type": "unit|spell|artifact|hero|location",
      "rarity": "common|rare|epic|legendary|mythic",
      "faction": "所属势力（可选）",
      "flavor_text": "风味文本（1-3 句，富有诗意）",
      "lore": "完整背景故事（3-5 句，融入世界观）",
      "related_cards": ["关联卡牌 ID 列表"]
    }
  ],
  "lore_arcs": [
    { "title": "Lore 故事线名", "card_ids": ["CARD_01", "CARD_02"], "summary": "故事线 1 句话总结" }
  ]
}`;

const USER_CONTEXT = (ctx: NarrativeContext): string => {
  const wv = ctx.worldview_structure
    ? JSON.stringify(ctx.worldview_structure).slice(0, 1500)
    : "（无世界观）";
  return `## 世界观摘要\n${wv}\n\n## 用户原始需求\n${ctx.user_input}\n\n请输出卡牌 Lore JSON。`;
};

const CARD_LORE_COMPOSER: PromptComposer = {
  stepId: "card_lore",
  blocks: {
    role: ROLE,
    task: TASK,
    style: STYLE_PLACEHOLDER,
    faction: FACTION_PLACEHOLDER,
    rarity: RARITY_PLACEHOLDER,
    constraints: CONSTRAINTS_PLACEHOLDER,
    output_format: OUTPUT_FORMAT,
    user_context: USER_CONTEXT,
  },
  systemBlockOrder: [
    "role",
    "task",
    "style",
    "faction",
    "rarity",
    "constraints",
    "output_format",
  ],
  userBlockOrder: ["user_context"],
  skillSlots: ["style_guide", "faction_rules", "rarity_rules", "constraints"],
};

interface CardLoreOutput {
  cards: unknown[];
  lore_arcs: unknown[];
}

/**
 * B-M5: 通过 universal-agent 框架执行。
 *
 * 启用条件：needs.L >= 2 或 needs.I >= 2（CCG / 收集类卡牌品类专用）
 * 输出字段：ctx.card_lore（{ cards, lore_arcs }）
 */
export const cardLoreCapability = createComposerCapability<CardLoreOutput>({
  id: "card_lore",
  description: "CCG 卡牌 Lore 文本",
  needsKeys: ["L", "I"],
  minNeed: 2,
  composer: CARD_LORE_COMPOSER,
  outputField: "card_lore",
  temperature: 0.8,
  parse: (raw) => {
    const parsed = extractJSON<{ cards?: unknown[]; lore_arcs?: unknown[] }>(raw);
    if (parsed && Array.isArray(parsed.cards)) {
      return {
        cards: parsed.cards,
        lore_arcs: Array.isArray(parsed.lore_arcs) ? parsed.lore_arcs : [],
      };
    }
    return { cards: [], lore_arcs: [] };
  },
});

export async function cardLore(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  await runUniversalAgent(
    {
      stepId: "card_lore",
      name: "CardLoreAgent",
      outputField: "card_lore",
      capabilities: [cardLoreCapability],
      aggregate: (results) =>
        (results[0]?.output as CardLoreOutput) ?? { cards: [], lore_arcs: [] },
      emptyFallback: () => ({ cards: [], lore_arcs: [] }),
      evaluator: { disabled: true },
    },
    ctx,
    llm,
  );
}
