/**
 * ip-dna/injection/operator-injection.ts —— A→B 注入桥（蓝图 §7.2 / §7.2b / §8 / §10）。
 *
 * 「统一注入适配器」：把 IP DNA 的三大能力真正接入生成节点的提示词——
 *   ① 三视角算子（§7.2）：取提取算子 → 检索补缺 → LLM 生成兜底，三视角满员；
 *   ② KAG 关系网络子图（§8）：当前单元角色/场景关系，保持生成一致性；
 *   ③ 长记忆账本约束（§10）：已沉淀的设定/事实/关系，续写改写不吃书。
 *
 * 注入形态（§7.2b 一步法"三视角同台"的提示词适配）：
 *   不另起一次合成调用，而是把三视角算子 + 两阶段创作方针指令 + 关系/账本约束
 *   一并拼进【当前生成 step 自己的 system prompt】，由该 step 的单次 LLM 调用在内部
 *   先综合裁决（阶段A）再按本 step 既定输出格式生成（阶段B）。这样既贯彻"同台综合"，
 *   又不破坏各 step 的输出契约。
 *
 * 触发条件（§7：仅在消费算子的环节加载）：
 *   - stepId ∈ OPERATOR_SLOT_REGISTRY；且
 *   - ctx.narrativeIpDna 存在（即本次为 IP DNA 驱动的改编生成）。
 *   两者任一不满足 → 返回 null（零额外开销，常规生成完全不受影响）。
 */

import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../../pipeline/runtime/llm-client.js";
import type {
  NarrativeOperator,
  NarrativeTemplate,
  OperatorSlot,
  OperatorSolution,
  ExtractionLayer,
  LayeredOperators,
} from "../../types/narrative-ip-dna.js";
import { DEFAULT_CONFLICT_PRIORITY } from "../../types/narrative-ip-dna.js";
import { collectOperatorPool, selectOperatorsForStep } from "../phase2-extract.js";
import {
  fillSlot,
  precheckConflict,
  renderSlotsForPrompt,
  type OperatorRetriever,
} from "../phase3-rag.js";
import { buildHybridRetriever, type QueryEmbedder } from "../phase3-vector.js";
import { buildKagFromTemplate, renderRelationInjection } from "../phase3b-kag.js";
import {
  renderLedgerInjection,
  queryLedger,
  type LongMemoryLedger,
} from "../phase5-polish.js";
import { saveOperatorSolution } from "../filesystem.js";
import { getSlotSpec, isOperatorConsumingStep } from "./slot-registry.js";
import { buildCustomTeamFragment } from "../../custom-team/injection.js";

// ─────────────────────────────────────────────────────────────────
// 共享检索器（懒加载单例，避免每步重复加载语料）
// ─────────────────────────────────────────────────────────────────

let sharedRetriever: OperatorRetriever | null = null;
let globalEmbedder: QueryEmbedder | undefined;

function getSharedRetriever(): OperatorRetriever {
  if (!sharedRetriever) sharedRetriever = buildHybridRetriever({ embedder: globalEmbedder });
  return sharedRetriever;
}

/** 测试用：覆盖共享检索器（注入确定性 mock）。 */
export function setSharedRetriever(r: OperatorRetriever | null): void {
  sharedRetriever = r;
}

/**
 * 注入本地查询向量化器（e5），启用 RAG vector 通道（§7.1）。
 * 未注入时检索器走 scope+tag 降级。设置后重建共享检索器。
 */
export function setQueryEmbedder(embedder: QueryEmbedder | undefined): void {
  globalEmbedder = embedder;
  sharedRetriever = null;
}

// ─────────────────────────────────────────────────────────────────
// 冲突预检（D9 §4.5 第 7 点）：与用户改编需求对冲的提取算子作废
// ─────────────────────────────────────────────────────────────────

/** 用户需求 ↔ 算子取向的对冲词对（命中即视为冲突，提取算子作废，改走检索/生成）。 */
const NEED_ANTONYMS: Array<[RegExp, RegExp]> = [
  [/快|紧凑|爽|强节奏|高能/, /慢|舒缓|铺垫|留白/],
  [/分支|多线|自由|开放/, /线性|单线|固定/],
  [/轻松|喜剧|搞笑|治愈/, /黑暗|致郁|压抑|沉重/],
  [/写实|克制|真实/, /夸张|戏剧化|中二/],
  [/成人|硬核|血腥/, /低龄|合家欢|温和/],
];

/**
 * 由用户需求文本构造"提取算子冲突"判定（确定性、零 LLM）。
 * 思路：用户需求出现 A 取向、而算子明显是相反的 B 取向 → 判冲突。
 */
export function buildConflictPredicate(
  needText: string,
): (op: NarrativeOperator) => boolean {
  const need = needText ?? "";
  return (op: NarrativeOperator): boolean => {
    const opText = `${op.name} ${op.definition} ${op.usage_guide} ${op.adaptation?.type ?? ""} ${op.adaptation?.element ?? ""}`;
    for (const [a, b] of NEED_ANTONYMS) {
      if (a.test(need) && b.test(opText)) return true;
      if (b.test(need) && a.test(opText)) return true;
    }
    return false;
  };
}

// ─────────────────────────────────────────────────────────────────
// 注入片段渲染
// ─────────────────────────────────────────────────────────────────

function rootTemplate(ctx: NarrativeContext): NarrativeTemplate | undefined {
  const dna = ctx.narrativeIpDna;
  if (!dna) return undefined;
  return dna.nodes[dna.rootId]?.template;
}

function buildQuery(ctx: NarrativeContext, queryHint: string | undefined): string {
  const t = rootTemplate(ctx);
  return [
    queryHint,
    t?.core_elements.theme,
    t?.core_elements.core_conflict,
    t?.core_elements.literature_style,
  ]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(" ")
    .slice(0, 200);
}

/** 一步法"三视角同台"的提示词指令（不改变本 step 自身的输出格式）。 */
function synthesisDirective(tensions: string[]): string {
  const tensionLine =
    tensions.length > 0
      ? `\n本次已检测到视角张力：${tensions.join("；")}。请据上述优先级裁决，不要简单三选一。`
      : "";
  return [
    "## IP DNA 算子注入（三视角同台·一步法 §7.2b）",
    "下面提供本节点应消费的【作者 / 读者·玩家 / 角色】三视角算子。请在生成时分两个内部阶段，于同一次输出内完成：",
    "【阶段A·综合裁决】先在心里把每个槽位的三视角算子融合成一条统一创作方针（非三选一，而是兼顾三者的最优解）；",
    `视角间冲突按优先级裁决：${DEFAULT_CONFLICT_PRIORITY.join(" > ")}。${tensionLine}`,
    "【阶段B·生成】严格依据该创作方针，按本任务既定的输出格式与字段要求产出内容（不要输出方针本身，只输出本任务要求的结果）。",
  ].join("\n");
}

/**
 * 由三视角满员槽位确定性合成「综合裁决方针」+ 采纳说明（§7.2b 阶段A 的可落盘镜像）。
 * 这不是模型内心推理的回读，而是对"本节点被装备了哪些三视角算子、按何优先级裁决"的忠实记录，
 * 让 §6.4 的算子方案产物始终非空、可追溯（来源/视角/张力一目了然）。
 */
function buildCreativeDirective(
  slots: OperatorSlot[],
  tensions: string[],
): { directive: string; adoptionNotes: Record<string, string> } {
  const adoptionNotes: Record<string, string> = {};
  const lines: string[] = [];
  for (const slot of slots) {
    const byPersp = slot.candidates
      .map((c) => `${c.perspective}/${c.source}:${c.operator.name}`)
      .join("、");
    for (const c of slot.candidates) {
      const key = c.operator.uid || `${slot.slot_name}-${c.perspective}`;
      adoptionNotes[key] = `[${slot.slot_name}·${c.perspective}·${c.source}] ${c.operator.name}`;
    }
    if (byPersp) lines.push(`「${slot.slot_name}」融合三视角（${byPersp}）为统一取向`);
  }
  if (lines.length === 0) return { directive: "", adoptionNotes };
  const tensionNote =
    tensions.length > 0
      ? `；残余张力按优先级 ${DEFAULT_CONFLICT_PRIORITY.join(" > ")} 裁决（${tensions.join("；")}）`
      : "";
  const directive = `综合裁决方针：${lines.join("；")}${tensionNote}。`;
  return { directive, adoptionNotes };
}

/**
 * step 执行后回捕真实创作方针（可选接通点）：若某 step 在生成时回读到模型实际产出的
 * creative_directive / adoption_notes，可调本函数覆盖注入期落盘的确定性镜像并重新落盘。
 * 找不到对应方案 / 缺标题时静默返回（不阻断主链）。
 */
export function recordCreativeDirective(
  ctx: NarrativeContext,
  stepId: string,
  directive: string,
  adoptionNotes?: Record<string, string>,
): void {
  const solutions = (ctx as Record<string, unknown>)._operator_solutions as
    | OperatorSolution[]
    | undefined;
  if (!solutions || solutions.length === 0) return;
  // 取该 step 最后一次注入的方案（批处理时可能多次注入）。
  let target: OperatorSolution | undefined;
  for (let i = solutions.length - 1; i >= 0; i--) {
    if (solutions[i].node === stepId) {
      target = solutions[i];
      break;
    }
  }
  if (!target) return;
  if (directive && directive.trim()) target.creative_directive = directive.trim();
  if (adoptionNotes) target.adoption_notes = { ...target.adoption_notes, ...adoptionNotes };
  if (ctx.story_title && ctx.story_timestamp) {
    try {
      saveOperatorSolution(target, ctx.story_title);
    } catch {
      /* 落盘失败不阻断生成 */
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────────

/**
 * IP DNA 注入的结构化分段（对齐统一提示词骨架 §7.2b 的命名插槽）。
 * 每段对应骨架的一个插槽，供 prompt provider 按骨架顺序填充；
 * 缺省段为 undefined（该插槽不出现）。
 */
export interface OperatorInjectionSections {
  /** 客观真相：IP 叙事内核切片摘要（题材/主题/冲突/风格）。 */
  objective_truth?: string;
  /** 三视角算子（同台综合指令 + 槽位）。 */
  operators?: string;
  /** KAG 关系网络子图。 */
  relations?: string;
  /** 长记忆账本一致性约束。 */
  ledger?: string;
}

export interface OperatorInjectionResult {
  /** 拼进 step system prompt 的注入片段（向后兼容：operators+relations+ledger 合并）。 */
  fragment: string;
  /** 结构化分段（统一骨架插槽，§7.2b）。 */
  sections: OperatorInjectionSections;
  /** 算子方案（落盘 §6.4：slots + 节点 + 确定性合成的 creative_directive/adoption_notes；
   *  step 后可经 recordCreativeDirective 用模型实际方针覆盖）。 */
  solution: OperatorSolution;
  slotCount: number;
}

/** 客观真相段：IP 叙事内核切片的精炼摘要（不含算子，纯设定真相）。 */
function buildObjectiveTruth(ctx: NarrativeContext): string {
  const t = rootTemplate(ctx);
  if (!t) return "";
  const ce = t.core_elements;
  const lines = [
    ce.subject ? `题材：${ce.subject}` : "",
    ce.theme ? `主题：${ce.theme}` : "",
    ce.core_conflict ? `核心冲突：${ce.core_conflict}` : "",
    ce.literature_style ? `文学风格：${ce.literature_style}` : "",
    ce.emotion_experience ? `情感体验：${ce.emotion_experience}` : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `## 客观真相（IP 叙事内核切片，须忠实遵守）\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/**
 * 为某个消费算子的生成 step 构建统一注入片段（算子 + KAG + 账本）。
 * 不消费算子的 step 或无 IP DNA 时返回 null。
 */
export async function buildOperatorInjection(
  ctx: NarrativeContext,
  stepId: string,
  llm: LLMClient,
): Promise<OperatorInjectionResult | null> {
  const spec = getSlotSpec(stepId);
  if (!spec) return null;
  const dna = ctx.narrativeIpDna;
  if (!dna) return null;

  const storyTitle = ctx.story_title ?? dna.title ?? "";
  const story_id = ctx.story_timestamp ?? dna.story_id ?? "";
  const fallbackPool = collectOperatorPool(dna, dna.rootId);
  const layered = (ctx as Record<string, unknown>)._operator_layers as LayeredOperators | undefined;
  const stepLayers: ExtractionLayer[] = spec.layers ?? ["leaf"];
  const { pool: operatorPool, layerByUid } = selectOperatorsForStep(layered, stepLayers, fallbackPool);
  const retriever = getSharedRetriever();
  const needText = [ctx.user_input, ctx.user_preference_summary]
    .filter((s): s is string => typeof s === "string")
    .join("\n");
  const conflictsWithUserNeed = buildConflictPredicate(needText);
  const query = buildQuery(ctx, spec.queryHint);

  // ① 三视角算子槽位（满员）
  const slots: OperatorSlot[] = [];
  const tensions: string[] = [];
  for (const slotName of spec.slots) {
    const slot = await fillSlot({
      slotName,
      query: `${slotName} ${query}`.trim(),
      extracted: operatorPool,
      conflictsWithUserNeed,
      retriever,
      llm,
      storyTitle,
    });
    slots.push(slot);
    const conflict = precheckConflict(slot.candidates);
    if (conflict.hasConflict && conflict.detail) tensions.push(`${slotName}:${conflict.detail}`);
  }

  // 为提取算子标注 sourceLayer（§3.2 显式可查）。
  for (const slot of slots) {
    for (const c of slot.candidates) {
      if (c.source === "extracted" && c.operator.uid) {
        const layer = layerByUid.get(c.operator.uid);
        if (layer) c.sourceLayer = layer;
      }
    }
  }

  const sections: OperatorInjectionSections = {};

  // 客观真相段（§7.2b 骨架首段，纯设定切片）。
  const truth = buildObjectiveTruth(ctx);
  if (truth) sections.objective_truth = truth;

  // ① 三视角算子段（同台综合指令 + 槽位）。
  sections.operators = [synthesisDirective(tensions), renderSlotsForPrompt(slots)]
    .filter(Boolean)
    .join("\n\n");

  // ② KAG 关系网络子图（§8）
  if (spec.kag) {
    const kagText = ctx.relation_network?.trim()
      ? `## 关系网络（KAG，须在生成中保持一致）\n${ctx.relation_network.trim()}`
      : renderKagFromCtx(ctx);
    if (kagText) sections.relations = kagText;
  }

  // ③ 长记忆账本约束（§10）
  if (spec.ledger) {
    const ledger = (ctx as Record<string, unknown>)._long_memory_ledger as
      | LongMemoryLedger
      | undefined;
    if (ledger) {
      // 取设定/事实/关系类约束（续写改写一致性核心）。
      const relevant: LongMemoryLedger = {
        story_id: ledger.story_id,
        storyTitle: ledger.storyTitle,
        entries: [
          ...queryLedger(ledger, { kind: "setting" }),
          ...queryLedger(ledger, { kind: "fact" }),
          ...queryLedger(ledger, { kind: "relationship" }),
          ...queryLedger(ledger, { kind: "foreshadow" }),
        ],
      };
      const ledgerText = renderLedgerInjection(relevant, { max: 30 });
      if (ledgerText) sections.ledger = ledgerText;
    }
  }

  // creative_directive 落盘（§6.4）：内联注入不另起一次合成调用，无法回读模型 A 阶段的内心方针，
  // 故在此用确定性方式合成一条「综合裁决方针」+ 采纳说明落盘，保证 §6.4 算子方案产物非空且可追溯；
  // 若下游 step 之后回捕到模型实际产出的方针，可调 recordCreativeDirective 覆盖并重新落盘。
  const { directive, adoptionNotes } = buildCreativeDirective(slots, tensions);
  const solution: OperatorSolution = {
    story_id,
    node: stepId,
    slots,
    creative_directive: directive,
    adoption_notes: adoptionNotes,
    step_layers: stepLayers,
  };

  // 向后兼容的合并片段（沿用旧顺序：算子 → 关系 → 账本，不含 objective_truth）。
  const fragment = [sections.operators, sections.relations, sections.ledger]
    .filter((s): s is string => !!s)
    .join("\n\n");

  return { fragment, sections, solution, slotCount: slots.length };
}

function joinFragments(...parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join("\n\n");
}

/**
 * 落一份自定义专属团队片段（2.4）。
 *
 * 写进 `operators` 段与合并片段两处，正是为了让**两条提示词装配路径**都覆盖到：
 * 声明了 `{{slot:operators}}` 的 step 走 provider 读 sections，没声明的走末尾 append
 * 读合并片段。只写一处必然有一半 step 拿不到。
 *
 * 纯函数、无 LLM、无 IO —— 它只是从 profile 里取该席位那一段。
 */
function appendCustomTeamInjection(ctx: NarrativeContext, stepId: string): void {
  const fragment = buildCustomTeamFragment(ctx, stepId);
  if (!fragment) return;
  const ctxRaw = ctx as Record<string, unknown>;

  const injectionMap = (ctxRaw._operator_injection as Record<string, string> | undefined) ?? {};
  // 幂等：同一 step 可能被重跑（节点重 roll、失败重试），重复追加会让片段翻倍。
  if (!injectionMap[stepId]?.includes(fragment)) {
    injectionMap[stepId] = joinFragments(injectionMap[stepId], fragment);
    ctxRaw._operator_injection = injectionMap;
  }

  const sectionMap =
    (ctxRaw._operator_injection_sections as Record<string, OperatorInjectionSections> | undefined) ?? {};
  const sections = sectionMap[stepId] ?? {};
  if (!sections.operators?.includes(fragment)) {
    sectionMap[stepId] = { ...sections, operators: joinFragments(sections.operators, fragment) };
    ctxRaw._operator_injection_sections = sectionMap;
  }
}

/** 读取已注入到 ctx 的某 step 结构化分段（供统一骨架/provider 按插槽填充）。 */
export function getInjectedSections(
  ctx: NarrativeContext,
  stepId: string,
): OperatorInjectionSections | null {
  const map = (ctx as Record<string, unknown>)._operator_injection_sections as
    | Record<string, OperatorInjectionSections>
    | undefined;
  return map?.[stepId] ?? null;
}

/**
 * 注入服务入口（T5「逻辑下沉」）：在某个消费算子的 step 执行前，
 * 装备三视角算子 + KAG + 账本，写入 ctx 的注入片段 / 结构化分段 / 算子方案，
 * 并把方案落盘（§6.4）。整套副作用全在本模块内完成，pipeline.ts 只需薄委托。
 *
 * 触发条件不满足（非 IP DNA 驱动 / 非消费算子 step）或任意失败 → 静默返回，
 * 绝不阻断主生成链（注入是增强项）。
 */
export async function prepareInjection(
  ctx: NarrativeContext,
  stepId: string,
  llm: LLMClient,
): Promise<void> {
  // 自定义专属团队（2.4）先落：它与算子注入的触发条件不同 —— 用户可以只选一位
  // 蒸馏助手而不带任何 IP DNA，那时下面的算子链整段跳过，但助手仍必须注入。
  appendCustomTeamInjection(ctx, stepId);

  if (!ctx.narrativeIpDna) return;
  if (!isOperatorConsumingStep(stepId)) return;
  try {
    const result = await buildOperatorInjection(ctx, stepId, llm);
    if (!result) return;
    const ctxRaw = ctx as Record<string, unknown>;

    // 团队片段已经先落在这两张表里；算子内容追加在它之后，不互相覆盖。
    const injectionMap = (ctxRaw._operator_injection as Record<string, string> | undefined) ?? {};
    injectionMap[stepId] = joinFragments(injectionMap[stepId], result.fragment);
    ctxRaw._operator_injection = injectionMap;

    const sectionMap =
      (ctxRaw._operator_injection_sections as Record<string, OperatorInjectionSections> | undefined) ?? {};
    const existing = sectionMap[stepId];
    sectionMap[stepId] = {
      ...result.sections,
      operators: joinFragments(existing?.operators, result.sections.operators),
    };
    ctxRaw._operator_injection_sections = sectionMap;

    const solutions = (ctxRaw._operator_solutions as OperatorSolution[] | undefined) ?? [];
    solutions.push(result.solution);
    ctxRaw._operator_solutions = solutions;

    // 落盘算子方案（§6.4）。无标题/时间戳时跳过落盘（仍完成注入）。
    if (ctx.story_title && ctx.story_timestamp) {
      try {
        saveOperatorSolution(result.solution, ctx.story_title);
      } catch {
        /* 落盘失败不阻断生成 */
      }
    }
  } catch {
    /* 注入失败不阻断主生成链 */
  }
}

function renderKagFromCtx(ctx: NarrativeContext): string {
  const t = rootTemplate(ctx);
  if (!t) return "";
  const graph = buildKagFromTemplate(t);
  if (graph.edgeCount === 0) return "";
  return renderRelationInjection(graph, { maxRelations: 24 });
}

/** 读取已注入到 ctx 的某 step 算子注入片段（供 prompt 系统拼接）。 */
export function getInjectedFragment(ctx: NarrativeContext, stepId: string): string {
  const map = (ctx as Record<string, unknown>)._operator_injection as
    | Record<string, string>
    | undefined;
  const frag = map?.[stepId];
  return typeof frag === "string" ? frag : "";
}
