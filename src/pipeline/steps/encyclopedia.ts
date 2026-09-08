/**
 * 百科娘（席位 2.3.20 encyclopedia）
 *
 * 职责原文：对用户想要体验的目标——某一作品，或相关历史事实——从本地或网上
 * 检索、对比、分析，得出准确信息和设定。
 *
 * ─────────────────────────────────────────────────────────────────
 * 两条通道，缺一要说清
 * ─────────────────────────────────────────────────────────────────
 * local  用户上传的原文、IP DNA 提炼出的层级树标题与模板。这是**权威源**：
 *        用户拿来的作品，原文说什么就是什么。
 * web    Gemini 的 googleSearch grounding。只有直连 API 的部署有；走 LiteLLM
 *        代理（OpenAI 兼容口）时没有这个工具，此时退化为纯本地。
 *
 * 退化必须显式记进 `channels` 与 `sources`。原因不是"记录完整"这种正确性洁癖：
 * 一份凭模型记忆写出来的作品设定，和一份真检索来的，文本上分不出差别，
 * 而下游席位会把它当外部事实去对齐世界观与角色。这是本席唯一的失败模式。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么分两轮 LLM 调用
 * ─────────────────────────────────────────────────────────────────
 * 工具调用与强制 JSON mime 不能同时开，所以联网那轮只能出自由文本；
 * 结构化交给第二轮（纯装配，不再检索）。没有联网通道时只有第二轮。
 */
import type {
  NarrativeContext,
  EncyclopediaDoc,
  EncyclopediaEntry,
} from "../../types/index.js";
import type { LLMClient, WebSource } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { userInstructionsBlock } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt } from "../runtime/prompt-composer.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import type { PreflightResult } from "../blueprint/types.js";

/** 联网检索那轮的产出，作为第二轮的材料。挂在 ctx 上供 composer 取用。 */
const WEB_FINDINGS_KEY = "_encyclopediaWebFindings";
/** 联网检索的来源清单。runner 路径下 normalizer 只认 (parsed, ctx)，citations 靠这个私有键跨阶段传递。 */
const WEB_CITATIONS_KEY = "_encyclopediaWebCitations";

/** 检索目标：优先显式指定，否则就是用户需求本身。 */
export function encyclopediaTopic(ctx: NarrativeContext): string {
  const explicit = (ctx as Record<string, unknown>).encyclopedia_topic;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  return String(ctx.user_input ?? "").trim();
}

/**
 * 本地源摘要。
 *
 * 只摘不改：上传原文按长度截断（资料检索要的是"书里怎么说"的凭据，不是全文），
 * IP DNA 侧取层级树标题——它是提炼管线对这部作品的结构判读，正是资料骨架。
 */
export function buildLocalEvidence(ctx: NarrativeContext): string {
  const parts: string[] = [];

  const uploaded = ctx.uploaded_script?.content;
  if (uploaded && uploaded.trim()) {
    const excerpt = uploaded.length > 12_000 ? `${uploaded.slice(0, 12_000)}\n……（原文过长，此处截断）` : uploaded;
    parts.push(`### 本地源：用户上传原文（权威）\n${excerpt}`);
  }

  const dna = ctx.narrativeIpDna;
  if (dna) {
    const titles = collectHierarchyTitles(dna as unknown as HierarchyLike, 0, []);
    if (titles.length > 0) {
      parts.push(`### 本地源：IP DNA 层级树（提炼管线对本作的结构判读）\n${titles.join("\n")}`);
    }
  }

  return parts.join("\n\n");
}

interface HierarchyLike {
  title?: string;
  children?: HierarchyLike[];
  root?: HierarchyLike;
}

/** 层级树标题，最多铺三层——再深就成了目录抄写，对资料汇编没有增量。 */
function collectHierarchyTitles(
  node: HierarchyLike | undefined,
  depth: number,
  acc: string[],
): string[] {
  if (!node || depth > 2 || acc.length >= 200) return acc;
  const start = node.root ?? node;
  if (start !== node) return collectHierarchyTitles(start, depth, acc);
  if (start.title) acc.push(`${"  ".repeat(depth)}- ${start.title}`);
  for (const child of start.children ?? []) collectHierarchyTitles(child, depth + 1, acc);
  return acc;
}

const WEB_SEARCH_SYSTEM = `你是资料检索员。请就给定目标进行联网检索，只汇报**检索到的**信息。

要求：
- 每条信息后标注它来自哪个网页（标题或网址），检索不到就说检索不到；
- 不同来源说法冲突时，把冲突双方都列出来，不要自行取舍；
- 不要补充你记忆中的内容——分不清哪句有来源，这份资料就没有价值。`;

export const ENCYCLOPEDIA_COMPOSER: PromptComposer = {
  stepId: "encyclopedia_retrieval",
  blocks: {
    role: `你是百科娘——一位资料考据员。你的产出是一份资料汇编，供下游创作席位当**外部事实**引用。

你的价值只有一个：准确。写不准的条目就不写，说法有分歧就把分歧写清楚，
没有依据的话一句都不要写进条目里。凭印象补全对本席是最严重的失职——
下游会把你写的每一条当真。`,
    task_spec: `## 产出要求

1. **概述**：这个目标是什么，为什么下游需要了解它。
2. **条目**：人物、地点、事件、术语、设定，逐条给准确信息，并注明依据来自哪个来源。
3. **冲突**：来源之间说法不一致的地方如实登记，写明采信哪一说及理由；判不了就写判不了。
4. **来源清单**：本地源写文件名或字段名，网络源写网址。

## 依据规则（硬约束）

- 每个条目的 basis 必须指向来源清单里真实存在的来源；
- 只有本地源时，不要写出本地源里没有的条目；
- 联网检索结果为空时，如实只用本地源，不要用记忆填补。`,
    cot: `## 机制与流程
1. 先认清目标是"某部作品"还是"某段史实"——两者的可靠来源不同。
2. 通读本地源：用户拿来的原文是权威，与外部说法冲突时以原文为准。
3. 比对网络检索结果与本地源，一致处合并，不一致处登记为冲突。
4. 逐条落条目，每条都回头确认依据真的支持它。
5. 自检：有没有哪条写得比来源更具体？那就是补全，删掉或降级为冲突项。`,
    output_schema: `## 输出格式（严格 JSON）
{
  "topic": "检索目标",
  "summary": "全局概述",
  "entries": [{ "term": "条目名", "detail": "准确信息与设定", "basis": ["来源标签或网址"] }],
  "conflicts": [{ "term": "条目名", "claims": [{ "claim": "某来源的说法", "basis": "来源" }], "resolution": "采信哪一说及理由，或写明无法判定" }],
  "sources": [{ "kind": "local", "label": "用户上传原文" }, { "kind": "web", "label": "页面标题", "uri": "https://..." }]
}`,
    topic: (ctx: NarrativeContext): string => `## 检索目标\n${encyclopediaTopic(ctx)}`,
    local_evidence: (ctx: NarrativeContext): string => {
      const local = buildLocalEvidence(ctx);
      return local ? `## 本地源\n${local}` : "## 本地源\n（无本地源：本次没有上传原文，也没有 IP DNA 产物）";
    },
    web_findings: (ctx: NarrativeContext): string => {
      const findings = (ctx as Record<string, unknown>)[WEB_FINDINGS_KEY];
      if (typeof findings === "string" && findings.trim()) {
        return `## 联网检索结果（第一轮实检所得）\n${findings}`;
      }
      // 说清"为什么没有"，模型才不会拿记忆去补这一段。
      return "## 联网检索结果\n（本次部署无联网检索通道，或检索未返回结果。只允许使用本地源，不得以记忆补充。）";
    },
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
  systemBlockOrder: ["role", "task_spec", "cot", "output_schema"],
  userBlockOrder: ["topic", "local_evidence", "web_findings", "user_instructions"],
  skillSlots: [],
};

/** 输出校验（抛错触发 LLM 重试）。runner 与 legacy 共用。 */
export function validateEncyclopedia(raw: string): void {
  const doc = extractJSON<Record<string, unknown>>(raw);
  if (!doc.topic || !String(doc.topic).trim()) throw new Error("缺少检索目标 topic");
  if (!Array.isArray(doc.entries)) throw new Error("entries 必须是数组");
  if (!Array.isArray(doc.sources)) throw new Error("sources 必须是数组");
}

/**
 * 归一化：补齐可选段，并把"实际用了哪些通道"钉在产物上。
 *
 * channels 由**执行事实**决定而非模型自述：模型说自己查了网，与它真的调用了
 * 搜索工具是两件事，只有前者的话这份资料的可信度就无从判断。
 */
export function normalizeEncyclopedia(
  parsed: unknown,
  ctx: NarrativeContext,
  webCitations?: WebSource[],
): EncyclopediaDoc {
  // runner 路径的 NormalizerFn 签名只有 (parsed, ctx)，citations 落在 preflight
  // 写入的私有键里；legacy 路径显式传参，传参优先。
  const citations = webCitations
    ?? ((ctx as Record<string, unknown>)[WEB_CITATIONS_KEY] as WebSource[] | undefined)
    ?? [];
  const raw = (parsed ?? {}) as Record<string, unknown>;
  const entries: EncyclopediaEntry[] = Array.isArray(raw.entries)
    ? (raw.entries as Array<Record<string, unknown>>).map((e) => ({
        term: String(e.term ?? ""),
        detail: String(e.detail ?? ""),
        basis: Array.isArray(e.basis) ? e.basis.map(String) : [],
      }))
    : [];

  const sources = Array.isArray(raw.sources)
    ? (raw.sources as Array<Record<string, unknown>>).map((s) => ({
        kind: s.kind === "web" ? ("web" as const) : ("local" as const),
        label: String(s.label ?? s.uri ?? ""),
        ...(s.uri ? { uri: String(s.uri) } : {}),
      }))
    : [];

  // 实检到的网页一律并进来源清单：模型漏写来源，不等于这次没检索到。
  for (const c of citations) {
    if (!c.uri || sources.some((s) => s.uri === c.uri)) continue;
    sources.push({ kind: "web", label: c.title ?? c.uri, uri: c.uri });
  }

  return {
    topic: String(raw.topic ?? encyclopediaTopic(ctx)),
    summary: String(raw.summary ?? ""),
    entries,
    conflicts: Array.isArray(raw.conflicts)
      ? (raw.conflicts as Array<Record<string, unknown>>).map((c) => ({
          term: String(c.term ?? ""),
          claims: Array.isArray(c.claims)
            ? (c.claims as Array<Record<string, unknown>>).map((cl) => ({
                claim: String(cl.claim ?? ""),
                basis: String(cl.basis ?? ""),
              }))
            : [],
          resolution: String(c.resolution ?? "无法判定"),
        }))
      : [],
    sources,
    channels: {
      local: buildLocalEvidence(ctx).length > 0,
      web: citations.length > 0,
    },
  };
}

/**
 * 第一轮：联网实检（有通道才跑）。
 *
 * 把结果写进 ctx 的私有键供 composer 的 web_findings 段取用，同时回传来源清单
 * 用于 channels 判定。检索失败按"没有联网通道"处理并留日志 —— 资料席宁可少一条
 * 通道，不能因为外网抖动整步失败。
 */
async function retrieveFromWeb(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<WebSource[]> {
  if (!llm.supportsWebSearch) return [];
  const topic = encyclopediaTopic(ctx);
  if (!topic) return [];

  try {
    const result = await llm.callWithWebSearch(
      WEB_SEARCH_SYSTEM,
      `检索目标：${topic}\n\n请汇报检索到的人物、地点、事件、术语与设定，逐条标注来源。`,
      { temperature: 0.2 },
    );
    (ctx as Record<string, unknown>)[WEB_FINDINGS_KEY] = result.text;
    (ctx as Record<string, unknown>)[WEB_CITATIONS_KEY] = result.citations;
    return result.citations;
  } catch (err) {
    console.warn("[encyclopedia] 联网检索失败，退化为纯本地源:", err);
    return [];
  }
}

/**
 * 起飞前联网实检：side effect 写 ctx 私有键（web_findings 段与 citations）供
 * composer 与 normalizer 读，返回值缺省即继续走正常的 LLM 调用——不短路。
 */
export async function encyclopediaPreflight(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<PreflightResult | void> {
  await retrieveFromWeb(ctx, llm);
}

export async function encyclopediaRetrieval(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const citations = await retrieveFromWeb(ctx, llm);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(ENCYCLOPEDIA_COMPOSER, ctx),
    composeUserPrompt(ENCYCLOPEDIA_COMPOSER, ctx),
    { responseFormat: "json", temperature: 0.3 },
    validateEncyclopedia,
  );

  ctx.encyclopedia_doc = normalizeEncyclopedia(
    extractJSON<Record<string, unknown>>(raw),
    ctx,
    citations,
  );
}
