import type { NarrativeContext, LoreFragment, ItemLore } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, userInstructionsBlock, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK } from "../runtime/prompt-composer.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";

export const LORE_GENERATION_COMPOSER: PromptComposer = {
  stepId: "lore_generation",
  blocks: {
    cot: `## 机制与流程
1. 通读上游的世界观与角色设定，挑出适合"由碎片侧面说出"的那几桩事——
   正面平铺直叙的内容不该做成碎片。
2. 为每桩事分配 2-3 个不同来源的碎片（碑文的口吻与酒馆传言的口吻应当截然不同），
   让它们从不同视角互相印证。
3. 撰写碎片正文，只给线索不给结论——玩家拼合后得到的信息应当多于任一单片。
4. 为物品写 Lore 与风味文本，把世界观的质感压进玩家随手可见的地方。
5. 自检：碎片之间有没有互相矛盾？是否与上游设定冲突？有没有哪片说得太满、
   把该由玩家拼出来的答案直接讲了？`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    role: `你是一个游戏世界观设计师，擅长创作碎片化叙事内容。
根据已有的世界观、故事框架和角色设定，生成 Lore 碎片和物品叙事文本。

## 本环节的位置
你面对的是**叙事要求较低**的品类：故事不靠一条主线推进，
而是散落在碑文、手记、物品描述里，由玩家自己拼起来。
具体是哪个品类、该用什么文本调性与分级体系，由品类守则另行给出；
本段只规定"碎片化承载"这一共性，不预设任何品类的形态。
与"叙事要求极低"的叙事卡不同，你**有上游**：世界观、故事框架、角色设定都已确立。
你的产出是它们的**切片与回声**，不是另一套设定——
凡上游写明的，沿用其名称与口径；凡上游没写的，只在碎片能触及的边角处补，且不得与上游冲突。
碎片之间要能互相印证：同一桩往事从不同视角被提起，玩家拼合后应得到比单片更多的信息。`,
    task_spec: `## Lore 碎片类型
- inscription: 碑文/铭刻 — 古老的石碑、墙壁刻文、祭坛铭文
- journal: 日志/手记 — 探险者日记、学者笔记、战场报告
- npc_whisper: NPC 碎语 — 酒馆传言、村民闲谈、神秘低语
- item_description: 物品描述 — 装备/道具的Lore文本
- codex_entry: 图鉴条目 — 百科条目、生物志、种族志

## 物品叙事要求
- 每件物品需要: 名称、类型、Lore文本（2-3句背景故事）、风味文本（1句意境文本）
- 数量按世界观里真正值得讲的物件来定，不为凑数硬造；本品类若不靠物件承载叙事，
  可以少给或不给，把笔力放在碎片上
- 分级体系（稀有度等）不是通用要求：只有品类守则明确要求时才填，
  没有要求就留空，不要自行发明分级`,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `## 输出格式（严格JSON）
{
  "lore_fragments": [
    {
      "id": "lore_001",
      "type": "inscription|journal|npc_whisper|item_description|codex_entry",
      "title": "碎片标题",
      "content": "碎片正文（50-150字）",
      "source_location": "发现地点",
      "related_characters": ["相关角色"],
      "related_worldview": "关联的世界观设定"
    }
  ],
  "item_lore": [
    {
      "item_name": "物品名称",
      "item_type": "weapon|armor|accessory|consumable|key_item|material",
      "rarity": "（可选）品类守则要求分级时按其档位填写，否则省略",
      "lore_text": "Lore文本（2-3句）",
      "flavor_text": "风味文本（1句）"
    }
  ]
}`,
    context_inputs: (ctx: NarrativeContext): string => buildLoreUserPrompt(ctx),
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
  systemBlockOrder: ["role", "task_spec", "style_guide", "ip_dna", "constraints", "cot", "ip_source", "output_schema"],
  userBlockOrder: ["context_inputs", "user_instructions"],
  skillSlots: ["style_guide", "constraints"],
};

function buildLoreUserPrompt(ctx: NarrativeContext): string {
  const worldview = ctx.worldview_structure;
  const framework = ctx.story_framework;
  const characters = ctx.detailed_character_sheets;
  const coreSettings = ctx.core_settings;

  let contextInfo = `## 世界观\n`;
  if (worldview) {
    contextInfo += `世界名: ${worldview.world_name}\n`;
    if (worldview.基础架构层) {
      contextInfo += `基础架构层: ${JSON.stringify(worldview.基础架构层, null, 2)}\n`;
    }
  }

  if (coreSettings) {
    contextInfo += `\n## 核心设定\n`;
    contextInfo += `主题: ${coreSettings.main_theme}\n`;
    contextInfo += `冲突: ${coreSettings.main_conflict}\n`;
    contextInfo += `题材: ${coreSettings.genre}\n`;
  }

  if (framework?.framework?.nodes) {
    contextInfo += `\n## 故事框架节点\n`;
    for (const node of framework.framework.nodes) {
      contextInfo += `- ${node.name}: ${node.main_content ?? ""}\n`;
    }
  }

  if (characters && characters.length > 0) {
    contextInfo += `\n## 角色\n`;
    for (const ch of characters) {
      contextInfo += `- ${ch.name} (${ch.label}): ${ch.occupation ?? ""} ${ch.role_in_story ?? ""}\n`;
    }
  }

  const designContext = buildDesignContextSnippet(ctx);
  return `${contextInfo}
${designContext}
请基于以上世界观和故事设定，生成：
1. 8-12 个 Lore 碎片（涵盖多种类型：碑文、日志、NPC碎语、图鉴条目等）
2. 若世界观里有值得讲的物件，为它们写物品叙事（涵盖不同类型）

要求：
- Lore 碎片之间有关联性，拼凑起来能揭示更大的故事
- 物品叙事要与世界观紧密结合
- 风味文本要有诗意和意境感
- 每个碎片的 source_location 要合理`;
}

/** 输出校验（抛错触发 LLM 重试）。runner 与 legacy 共用。 */
export function validateLoreGeneration(raw: string): void {
  const parsed = extractJSON<{ lore_fragments: LoreFragment[]; item_lore: ItemLore[] }>(raw);
  if (!Array.isArray(parsed.lore_fragments)) throw new Error("lore_fragments 必须是数组");
  if (!Array.isArray(parsed.item_lore)) throw new Error("item_lore 必须是数组");
}

/**
 * 归一化。runner 只写 io.outputField（lore_fragments），item_lore 是派生字段，
 * 顺带在这里写进 ctx —— 与 character_enrichment_normalizer 派生 player_name 同一惯例。
 */
export function normalizeLoreGeneration(
  parsed: unknown,
  ctx: NarrativeContext,
): LoreFragment[] {
  const result = parsed as { lore_fragments: LoreFragment[]; item_lore: ItemLore[] };

  ctx.item_lore = result.item_lore.map((item) => ({
    item_name: String(item.item_name ?? ""),
    item_type: String(item.item_type ?? ""),
    rarity: String(item.rarity ?? "common"),
    lore_text: String(item.lore_text ?? ""),
    flavor_text: String(item.flavor_text ?? ""),
  }));

  return result.lore_fragments.map((f, i) => ({
    id: f.id || `lore_${String(i + 1).padStart(3, "0")}`,
    type: f.type,
    title: String(f.title ?? ""),
    content: String(f.content ?? ""),
    source_location: f.source_location ? String(f.source_location) : undefined,
    related_characters: Array.isArray(f.related_characters) ? f.related_characters.map(String) : undefined,
    related_worldview: f.related_worldview ? String(f.related_worldview) : undefined,
  }));
}

/**
 * Tier2 Lore 碎片 + 物品叙事生成
 * 依赖: worldview_structure, story_framework, detailed_character_sheets (如有)
 */
export async function loreGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const raw = await llm.callWithRetry(
    composeSystemPrompt(LORE_GENERATION_COMPOSER, ctx),
    composeUserPrompt(LORE_GENERATION_COMPOSER, ctx),
    { temperature: 0.85 },
    validateLoreGeneration,
  );

  ctx.lore_fragments = normalizeLoreGeneration(extractJSON(raw), ctx);
}
