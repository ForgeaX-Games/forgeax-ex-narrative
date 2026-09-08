/**
 * Phase 3 · 三视角 RAG 算子装备 —— 蓝图 §7 / §7.2 / §7.2b / §9。
 *
 * 核心：
 *   ① 三视角满员槽位：每个槽位作者/读者/角色三视角各填一个算子（提取 > 检索 > LLM 生成兜底）；
 *   ② 一步法"三视角同台"：所有算子注入同一次生成调用，模型内部两阶段（A 综合裁决创作方针 → B 生成）；
 *   ③ 算子方案落盘（每次消费写一个 JSON，§6.4）。
 *
 * 视角是槽位层分组键（由 knowledge_location/knowledge_domain 推断），不写进算子本体（§4.5）。
 * 来源 source(extracted/retrieved/generated) 记在槽位候选层。
 * 向量检索是 seam（本地向量模型，§7.1）；无向量时降级为关键词检索（确定性、可单测）。
 */

import type { LLMClient } from "../pipeline/runtime/llm-client.js";
import { parseJSON } from "../pipeline/runtime/llm-client.js";
import type {
  NarrativeOperator,
  OperatorPerspective,
  OperatorSlot,
  OperatorSlotCandidate,
  OperatorSolution,
  PerspectiveConflictCheck,
  StoryTimestamp,
} from "../types/narrative-ip-dna.js";
import { DEFAULT_CONFLICT_PRIORITY } from "../types/narrative-ip-dna.js";
import { loadOperatorCorpus, type LoadCorpusOptions } from "./corpus-loader.js";
import { loadIpDnaPrompt } from "./prompt-loader.js";

const ALL_PERSPECTIVES: OperatorPerspective[] = ["author", "reader", "character"];

// ─────────────────────────────────────────────────────────────────
// 视角推断（槽位分组键，不入算子本体）
// ─────────────────────────────────────────────────────────────────

/** 由算子 knowledge_domain / knowledge_location 推断其视角（§4.5）。 */
export function inferPerspective(op: NarrativeOperator): OperatorPerspective {
  const domain = op.knowledge_domain ?? "";
  const loc = op.knowledge_location ?? "";
  const hay = `${domain} ${loc}`;
  if (/情感|体验|读者|玩家|沉浸|代入/.test(hay)) return "reader";
  if (/角色|人物|动机|内心|弧光|性格/.test(hay)) return "character";
  // 叙事者定位 / 文学风格 / 叙事技巧 / 故事内容 → 作者视角
  return "author";
}

// ─────────────────────────────────────────────────────────────────
// 检索器：关键词兜底（确定性）+ 向量 seam
// ─────────────────────────────────────────────────────────────────

export interface OperatorRetriever {
  /** 检索某视角下与 query 最相关的算子（按相关度降序）。 */
  retrieve(query: string, perspective: OperatorPerspective, k: number): Promise<NarrativeOperator[]>;
}

/**
 * 关键词检索器（无本地向量模型时的降级实现，确定性可单测）。
 * 事前对语料按视角分桶；运行时用 query 分词与算子 name/definition/usage_guide 做词频打分。
 */
export class KeywordOperatorRetriever implements OperatorRetriever {
  private byPerspective: Map<OperatorPerspective, NarrativeOperator[]>;

  constructor(corpus: NarrativeOperator[]) {
    this.byPerspective = new Map(ALL_PERSPECTIVES.map((p) => [p, []]));
    for (const op of corpus) this.byPerspective.get(inferPerspective(op))!.push(op);
  }

  async retrieve(query: string, perspective: OperatorPerspective, k: number): Promise<NarrativeOperator[]> {
    const pool = this.byPerspective.get(perspective) ?? [];
    const terms = tokenize(query);
    const scored = pool.map((op) => ({ op, score: scoreOperator(op, terms) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.op);
  }
}

/**
 * 从 knowledge_base 语料构建关键词检索器（§7）。
 * 语料缺失时返回空检索器（槽位将走 LLM 生成兜底）。
 */
export function buildCorpusRetriever(options?: LoadCorpusOptions): KeywordOperatorRetriever {
  return new KeywordOperatorRetriever(loadOperatorCorpus(options));
}

function tokenize(text: string): string[] {
  return (text.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g) ?? []).map((s) => s.toLowerCase());
}

function scoreOperator(op: NarrativeOperator, terms: string[]): number {
  const hay = `${op.name} ${op.definition} ${op.usage_guide} ${op.example}`.toLowerCase();
  let score = 0;
  for (const t of terms) if (hay.includes(t)) score += 1;
  return score;
}

// ─────────────────────────────────────────────────────────────────
// 冲突预检（廉价、零额外 LLM 调用）
// ─────────────────────────────────────────────────────────────────

const ANTONYM_PAIRS: Array<[RegExp, RegExp]> = [
  [/慢|舒缓|铺垫/, /快|紧凑|急促/],
  [/线性|单线/, /分支|多线|发散/],
  [/写实|克制/, /夸张|戏剧化/],
  [/明示|直白/, /留白|隐晦/],
];

/** 三视角候选间张力预检（标签级，不调 LLM）。 */
export function precheckConflict(candidates: OperatorSlotCandidate[]): PerspectiveConflictCheck {
  const texts = candidates.map((c) => `${c.operator.usage_guide} ${c.operator.definition}`);
  for (const [a, b] of ANTONYM_PAIRS) {
    const hasA = texts.some((t) => a.test(t));
    const hasB = texts.some((t) => b.test(t));
    if (hasA && hasB) {
      return { hasConflict: true, detail: `${a.source} ↔ ${b.source}` };
    }
  }
  return { hasConflict: false };
}

// ─────────────────────────────────────────────────────────────────
// 槽位填充：提取 > 检索 > LLM 生成兜底（满员）
// ─────────────────────────────────────────────────────────────────

export interface FillSlotInput {
  slotName: string;
  query: string;
  /** 从 IP DNA 提取出的算子（按视角分组后优先占位）。 */
  extracted: NarrativeOperator[];
  /** 与用户改编需求冲突的提取算子（作废、不使用，§4.5 第 7 点）。 */
  conflictsWithUserNeed?: (op: NarrativeOperator) => boolean;
  retriever: OperatorRetriever;
  llm: LLMClient;
  /** 生成兜底算子的来源名（= 故事/项目标题，§4.5）。 */
  storyTitle: string;
}

/**
 * 填满一个槽位的三视角候选（确定性优先级 + LLM 兜底）：
 * 每视角：先取不冲突的提取算子；无则检索；再无则 LLM 生成。保证三视角满员。
 */
export async function fillSlot(input: FillSlotInput): Promise<OperatorSlot> {
  const extractedByPersp = new Map<OperatorPerspective, NarrativeOperator[]>(
    ALL_PERSPECTIVES.map((p) => [p, []]),
  );
  for (const op of input.extracted) {
    if (input.conflictsWithUserNeed?.(op)) continue; // 冲突即作废
    extractedByPersp.get(inferPerspective(op))!.push(op);
  }

  const candidates: OperatorSlotCandidate[] = [];
  for (const perspective of ALL_PERSPECTIVES) {
    const ext = extractedByPersp.get(perspective)!;
    if (ext.length > 0) {
      candidates.push({ perspective, operator: ext[0], source: "extracted" });
      continue;
    }
    const retrieved = await input.retriever.retrieve(input.query, perspective, 1);
    if (retrieved.length > 0) {
      candidates.push({ perspective, operator: retrieved[0], source: "retrieved" });
      continue;
    }
    const generated = await generateFallbackOperator(input.llm, input.slotName, input.query, perspective, input.storyTitle);
    candidates.push({ perspective, operator: generated, source: "generated" });
  }

  // 冲突预检接入选取链（§7.2b 第 7 点）：三视角候选出现对冲取向时，不只在提示词里写一句张力，
  // 而是按视角优先级（角色合理性 > 读者体验 > 作者技法）从最低优先视角起做一次重检索替换，
  // 真正改变被选中的算子；替换不掉则保留候选并把残余张力交给同台综合裁决。
  const resolved = await resolveSlotConflict(input.slotName, candidates, input);
  return { slot_name: input.slotName, candidates: resolved };
}

/** 视角替换优先级（低 → 高）：先动作者视角，保住更高优先的读者 / 角色取向。 */
const CONFLICT_RESOLUTION_ORDER: OperatorPerspective[] = ["author", "reader"];

/**
 * 冲突消解（确定性、有界）：检测到三视角张力时，为最低优先视角重检索若干备选，
 * 取第一个能消除张力且不与用户需求冲突的算子替换之；逐视角各尝试一次（无循环、零额外 LLM）。
 */
async function resolveSlotConflict(
  slotName: string,
  initial: OperatorSlotCandidate[],
  input: FillSlotInput,
): Promise<OperatorSlotCandidate[]> {
  let candidates = initial;
  if (!precheckConflict(candidates).hasConflict) return candidates;
  for (const persp of CONFLICT_RESOLUTION_ORDER) {
    if (!precheckConflict(candidates).hasConflict) break;
    const idx = candidates.findIndex((c) => c.perspective === persp);
    if (idx < 0) continue;
    const alts = await input.retriever.retrieve(`${slotName} ${input.query}`.trim(), persp, 5);
    for (const alt of alts) {
      if (input.conflictsWithUserNeed?.(alt)) continue;
      if (alt.uid && alt.uid === candidates[idx].operator.uid) continue;
      const trial = candidates.map((c, i) =>
        i === idx ? { perspective: persp, operator: alt, source: "retrieved" as const } : c,
      );
      if (!precheckConflict(trial).hasConflict) {
        candidates = trial;
        break;
      }
    }
  }
  return candidates;
}

const GEN_OP_SYSTEM = loadIpDnaPrompt(
  "gen-operator",
  `你是叙事算子生成助手。为指定槽位与视角生成一个算子。仅输出 JSON（8 字段，knowledge_location 填故事/项目标题）。`,
);

/** LLM 生成兜底算子（source-name = 故事/项目标题，§4.5）。 */
export async function generateFallbackOperator(
  llm: LLMClient,
  slotName: string,
  query: string,
  perspective: OperatorPerspective,
  storyTitle: string,
): Promise<NarrativeOperator> {
  const raw = await llm.callWithRetry(
    GEN_OP_SYSTEM,
    `槽位：${slotName}\n视角：${perspective}\n需求：${query}\n故事/项目标题：${storyTitle}`,
    { responseFormat: "json", temperature: 0.4 },
  );
  const op = parseJSON<NarrativeOperator>(raw);
  // 强约束来源名（§4.5：生成算子的 source-name = 故事/项目标题，同时落在 knowledge_location 与 example，
  // 便于下游按任一字段做来源归属与可追溯）+ uid 兜底
  op.knowledge_location = storyTitle;
  if (!op.example || !op.example.trim()) op.example = storyTitle;
  if (!op.uid) op.uid = `gen-${slotName}-${perspective}-${Date.now()}`;
  return op;
}

// ─────────────────────────────────────────────────────────────────
// 一步法"三视角同台"：组装提示词 + 单次生成 + 落盘方案
// ─────────────────────────────────────────────────────────────────

/** 一步法生成的系统提示骨架（两阶段在同一次调用内完成）。提示词正文外置于 prompts/ip-dna/synthesis.md。 */
export const SYNTHESIS_SYSTEM = loadIpDnaPrompt(
  "synthesis",
  `你是兼具【作者】【读者/玩家】【角色】三重视角的叙事生成者。分两阶段在同一次输出完成：A 综合裁决出 creative_directive（视角张力按优先级 {{conflict_priority}} 裁决）；B 依据方针生成正文。输出 JSON：{"creative_directive":"","adoption_notes":{},"content":""}`,
).replace("{{conflict_priority}}", DEFAULT_CONFLICT_PRIORITY.join(" > "));

/** 把三视角槽位拼成 prompt 片段。 */
export function renderSlotsForPrompt(slots: OperatorSlot[]): string {
  return slots
    .map((slot) => {
      const lines = slot.candidates
        .map(
          (c) =>
            `  - [${c.perspective}/${c.source}] ${c.operator.name}：${c.operator.definition}（用法：${c.operator.usage_guide}）`,
        )
        .join("\n");
      return `槽位「${slot.slot_name}」三视角算子：\n${lines}`;
    })
    .join("\n\n");
}

export interface ConsumeOperatorsInput {
  story_id: StoryTimestamp;
  storyTitle: string;
  /** 消费算子的生成节点标识（如 "rpg.plot.3"）。 */
  node: string;
  /** 生成任务说明（要生成什么内容）。 */
  task: string;
  slots: OperatorSlot[];
  llm: LLMClient;
}

export interface ConsumeOperatorsResult {
  solution: OperatorSolution;
  /** 阶段B 产出的叙事正文。 */
  content: string;
}

/**
 * 一步法消费算子（§7.2b）：组装三视角槽位 → 单次 LLM 调用（内部两阶段）→ 产出方案 + 正文。
 * 调用方负责把 solution 落盘（saveOperatorSolution）。
 */
export async function consumeOperators(input: ConsumeOperatorsInput): Promise<ConsumeOperatorsResult> {
  const userPrompt = `# 生成任务\n${input.task}\n\n# 三视角算子（同台综合，非三选一）\n${renderSlotsForPrompt(input.slots)}`;
  const raw = await input.llm.callWithRetry(SYNTHESIS_SYSTEM, userPrompt, {
    responseFormat: "json",
    temperature: 0.7,
  });
  const parsed = parseJSON<{ creative_directive?: string; adoption_notes?: Record<string, string>; content?: string }>(raw);

  const solution: OperatorSolution = {
    story_id: input.story_id,
    node: input.node,
    slots: input.slots,
    creative_directive: parsed.creative_directive ?? "",
    adoption_notes: parsed.adoption_notes,
  };
  return { solution, content: parsed.content ?? "" };
}

// ─────────────────────────────────────────────────────────────────
// 高层便捷：装备某节点的三视角算子并一步消费
// ─────────────────────────────────────────────────────────────────

export interface EquipAndConsumeInput {
  story_id: StoryTimestamp;
  storyTitle: string;
  /** 消费算子的生成节点标识。 */
  node: string;
  /** 生成任务说明。 */
  task: string;
  /** 检索/生成用的需求 query（缺省用 task）。 */
  query?: string;
  /** 槽位名（缺省 = node）。 */
  slotName?: string;
  /** 从 IP DNA 节点提取的算子（优先占位）。 */
  extracted: NarrativeOperator[];
  /** 与用户改编需求冲突判定（命中即作废）。 */
  conflictsWithUserNeed?: (op: NarrativeOperator) => boolean;
  retriever: OperatorRetriever;
  llm: LLMClient;
}

/**
 * 把一个生成节点接入"三视角算子装备 + 一步消费"：
 *   提取/检索/生成填满三视角 → 单次 LLM 同台综合 → 产出方案 + 正文。
 * 这是把 RAG 语料真正接入"消费节点"的入口（§7.2/§7.2b）。
 */
export async function equipAndConsume(input: EquipAndConsumeInput): Promise<ConsumeOperatorsResult> {
  const slot = await fillSlot({
    slotName: input.slotName ?? input.node,
    query: input.query ?? input.task,
    extracted: input.extracted,
    conflictsWithUserNeed: input.conflictsWithUserNeed,
    retriever: input.retriever,
    llm: input.llm,
    storyTitle: input.storyTitle,
  });
  return consumeOperators({
    story_id: input.story_id,
    storyTitle: input.storyTitle,
    node: input.node,
    task: input.task,
    slots: [slot],
    llm: input.llm,
  });
}
