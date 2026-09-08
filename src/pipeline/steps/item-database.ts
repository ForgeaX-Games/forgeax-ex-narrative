import type {
  NarrativeContext,
  GameItem,
  ItemLifecycle,
  ItemAffiliation,
} from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, userInstructionsBlock, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK } from "../runtime/prompt-composer.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";

const MIN_ITEMS = 8;
const MAX_ITEMS = 30;

export const ITEM_DATABASE_COMPOSER: PromptComposer = {
  stepId: "item_database",
  blocks: {
    cot: `## 机制与流程
1. 盘点世界观的规则与历史，提取其中值得被"物化"成道具的概念。
2. 为每件关键道具设计四层：来历 / 当前归属 / 象征意义 / 玩法作用，四层要能互相解释。
3. 排它的生命周期：在哪个节点到手、在哪些节点起作用、何时脱手或损毁、收场时在谁手里。
4. 排它的附属关系：属于谁、由谁造、与哪件道具成对、只在哪儿生效——一件道具的牵连常是多头的。
5. 撰写富含 Lore 的描述文本——道具是玩家随身携带的世界观切片。
6. 自检：道具是否服务叙事而不只是数值载体？归属与出现位置是否与角色、势力咬合？
   生命周期上的节点名是否真的出现在故事框架里（编一个不存在的节点名等于没写）？`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    role: `你是游戏系统策划，请生成资源型道具数据库 JSON。所有输出使用中文。`,
    task_spec: `要求：
- 物品数量 ${MIN_ITEMS}~${MAX_ITEMS}
- 字段包含：name, category, rarity(common/uncommon/rare/epic/legendary), description, effect, initial_owner(null或角色名), initial_scene(初始出现场景名), related_character(关联角色名或null), value({"buy":数字,"sell":数字}), max_stack(堆叠上限), read_content(可选,仅readable物品)
- lifecycle（生命周期）：{"acquired_at":"到手的故事节点名","used_at":["起作用的节点名"],"lost_at":"脱手/损毁的节点名，全程持有填null","final_state":"收场时在谁手里"}
  节点名一律取自下方「故事框架」里已有的节点，不要另起名字；这件道具在剧情里没有明确时间轴时整个 lifecycle 留空不填
- affiliations（附属关系）：[{"target":"另一头的名字","kind":"character|faction|scene|item","relation":"关系本身，一句话"}]
  只写世界观/角色/剧情里真有依据的关系；没有就给空数组，不要为了填满而编
- description 必须包含：外观描述 + 作用说明
- 位置信息必须基于世界观/故事/角色信息`,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `输出格式（严格 JSON）：
{"item_database": [ {...}, ... ]}`,
    context_inputs: (ctx: NarrativeContext): string => buildUserPrompt(ctx),
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
  systemBlockOrder: ["role", "task_spec", "ip_dna", "style_guide", "constraints", "cot", "ip_source", "output_schema"],
  // user 段必须挂在 composer 上而不是由 step 函数手拼：runner 只认 composer 解析出的
  // 提示词，user 段留空就等于让模型在没有世界观/角色/框架的情况下凭空编道具，
  // 而且不报错。用户修改意见同理——它原来靠 appendUserInstructions 事后追加，
  // runner 路径没有那个插入点，所以作为最后一块列进来（joinNonEmpty 同样以空行相接，
  // 拼出来与旧路径逐字相同）。
  userBlockOrder: ["context_inputs", "user_instructions"],
  skillSlots: ["style_guide", "constraints"],
};

function buildUserPrompt(ctx: NarrativeContext): string {
  const charSummary = (ctx.detailed_character_sheets ?? [])
    .map(c => `${c.name} (${c.label}): ${c.occupation ?? ""} - ${c.role_in_story ?? ""}`)
    .join("\n");

  return `## 用户原始需求⭐
${ctx.user_input}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 剧情简介
${JSON.stringify(ctx.plot_synopsis ?? {}, null, 2)}

## 核心设定
${JSON.stringify(ctx.core_settings ?? {}, null, 2)}

## 角色列表
${charSummary || "（无）"}

## 故事框架
${ctx.story_framework
    ? JSON.stringify(ctx.story_framework.framework.nodes.map(n => ({
        name: n.name, narrative_function: n.narrative_function,
      })), null, 2)
    : "（无）"}
${buildDesignContextSnippet(ctx)}
请输出道具数据库JSON：`;
}

const AFFILIATION_KINDS = new Set(["character", "faction", "scene", "item"]);

/** 空对象等于没填——留着会让下游把"模型没给"读成"这件道具全程无人持有"。 */
function normalizeLifecycle(raw: unknown): ItemLifecycle | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const nonEmpty = (v: unknown): string | undefined => {
    const s = typeof v === "string" ? v.trim() : "";
    return s && s !== "null" ? s : undefined;
  };
  const lifecycle: ItemLifecycle = {};
  const acquired = nonEmpty(r.acquired_at);
  if (acquired) lifecycle.acquired_at = acquired;
  const used = Array.isArray(r.used_at)
    ? r.used_at.map((n) => String(n).trim()).filter((n) => n && n !== "null")
    : [];
  if (used.length > 0) lifecycle.used_at = used;
  const final = nonEmpty(r.final_state);
  if (final) lifecycle.final_state = final;
  // lost_at 的三态要分清：给了节点名 = 在那儿脱手；显式 null = 全程持有（是个结论，
  // 不是缺失）；整个字段没给 = 模型没排到这一项，不落字段。
  const lost = nonEmpty(r.lost_at);
  if (lost) lifecycle.lost_at = lost;
  else if (r.lost_at === null || r.lost_at === "null") lifecycle.lost_at = null;

  return Object.keys(lifecycle).length > 0 ? lifecycle : undefined;
}

/** kind 认不出的整条丢掉：留着会让"这是哪类关系"的判断落到下游各自去猜。 */
function normalizeAffiliations(raw: unknown): ItemAffiliation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      target: String(a.target ?? "").trim(),
      kind: String(a.kind ?? "").trim(),
      relation: String(a.relation ?? "").trim(),
    }))
    .filter((a) => a.target && a.relation && AFFILIATION_KINDS.has(a.kind))
    .map((a) => a as ItemAffiliation);
  return list.length > 0 ? list : undefined;
}

function normalizeItem(raw: Record<string, unknown>): GameItem {
  const val = raw.value;
  const valueObj = (typeof val === "object" && val !== null)
    ? val as Record<string, number>
    : {};

  let owner = raw.initial_owner;
  if (owner === "null" || owner === "" || owner === undefined) owner = null;

  let related = raw.related_character;
  if (related === "null" || related === "" || related === undefined) related = null;

  const lifecycle = normalizeLifecycle(raw.lifecycle);
  const affiliations = normalizeAffiliations(raw.affiliations);

  return {
    name: String(raw.name ?? ""),
    category: String(raw.category ?? ""),
    rarity: String(raw.rarity ?? "common"),
    description: String(raw.description ?? ""),
    effect: String(raw.effect ?? ""),
    initial_owner: owner as string | null,
    initial_scene: String(raw.initial_scene ?? ""),
    related_character: related as string | null,
    value: valueObj,
    max_stack: Number(raw.max_stack ?? 1),
    ...(raw.read_content ? { read_content: String(raw.read_content) } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(affiliations ? { affiliations } : {}),
  };
}

/** 模型可能裸给数组，也可能包在 item_database 键下；两种都收。 */
function itemArrayOf(parsed: unknown): Array<Record<string, unknown>> | undefined {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  const wrapped = (parsed as Record<string, unknown> | null)?.item_database;
  return Array.isArray(wrapped) ? (wrapped as Array<Record<string, unknown>>) : undefined;
}

/** 输出格式校验（抛错即触发 LLM 重试）。runner 与 legacy 共用同一份规则。 */
export function validateItemDatabase(raw: string): void {
  const arr = itemArrayOf(extractJSON(raw));
  if (!arr) throw new Error("输出必须包含 item_database 数组");
  if (arr.length < 3) throw new Error(`道具数量太少(${arr.length})，至少3个`);
}

/** 逐件归一。 */
export function normalizeItemDatabase(parsed: unknown): GameItem[] {
  return (itemArrayOf(parsed) ?? []).map(normalizeItem);
}

export async function itemDatabase(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const rawText = await llm.callWithRetry(
    composeSystemPrompt(ITEM_DATABASE_COMPOSER, ctx),
    composeUserPrompt(ITEM_DATABASE_COMPOSER, ctx),
    { responseFormat: "json" },
    validateItemDatabase,
  );

  ctx.item_database = normalizeItemDatabase(extractJSON<Record<string, unknown>>(rawText));
}
