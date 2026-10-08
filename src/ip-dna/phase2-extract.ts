/**
 * Phase 2 · 游戏单元 IP DNA（scoped 提取）—— 蓝图 §5.1 / §4.2c / §4.3。
 *
 * 流程：
 *   ① 对每个最小叙事单元提取三件套（template/operators/metadata）—— LLM seam；
 *   ② summary 由下至上**递归聚合**为上层 template + 算子池（确定性核心，可单测）；
 *   ③ 顶层 template（=游戏单元完整故事内容）映射到 NarrativeContext 生成字段（A→B，对齐 data-atlas）。
 *
 * 聚合是确定性的（去重/拼接/上卷），LLM 仅负责"从单元正文抽取" + 可选的上层 prose 精炼。
 */

import type { LLMClient } from "../pipeline/runtime/llm-client.js";
import { parseJSON } from "../pipeline/runtime/llm-client.js";
import { loadIpDnaPrompt } from "./prompt-loader.js";
import { plotTreeToStoryFramework, plotTreeToStructureSeat } from "./plot-tree-to-structure.js";
import { derivePlotTopology, inferPlotNodeTypes, normalizePlotTree } from "./plot-tree-normalize.js";
import { contentFidelityOf } from "./fidelity.js";
import type {
  NarrativeIpDna,
  HierarchyNode,
  HierarchyLevelType,
  NarrativeTemplate,
  NarrativeOperator,
  TemplateSummary,
  TemplateWorldview,
  TemplateCharacter,
  TemplateCoreElements,
  TemplateStoryStructure,
  PlotTreeTopology,
  PlotTree,
  PlotTreeNode,
  EndingType,
  ExtractionLayer,
  LayeredOperators,
} from "../types/narrative-ip-dna.js";
import { toEndingType } from "../types/narrative-ip-dna.js";
import type {
  NarrativeContext,
  CoreSettings,
  CharacterSheet,
  WorldviewStructure,
  UploadedScript,
  SceneMap,
  GameItem,
  StoryFramework,
  FrameworkNode,
} from "../types/index.js";

// ─────────────────────────────────────────────────────────────────
// 确定性聚合：summary / template 由下至上上卷
// ─────────────────────────────────────────────────────────────────

/** 聚合 N 条子 summary → 父 summary（去重角色、拼接场景/事件）。 */
export function aggregateSummaries(children: TemplateSummary[]): TemplateSummary {
  const characters = dedupe(children.flatMap((c) => c.characters));
  const scene = joinNonEmpty(children.map((c) => c.scene), " / ");
  const events = joinNonEmpty(children.map((c) => c.events), "；");
  return { characters, scene, events };
}

/** 聚合 N 个子 template → 父 template（worldview/characters/core_elements 上卷）。 */
export function aggregateTemplates(children: NarrativeTemplate[]): NarrativeTemplate {
  const worldview: TemplateWorldview = {
    setting: joinNonEmpty(children.map((c) => c.worldview.setting), "\n"),
    scene_structure: joinNonEmpty(children.map((c) => c.worldview.scene_structure), "\n"),
    item_inventory: joinNonEmpty(children.map((c) => c.worldview.item_inventory), "\n"),
  };

  // 角色按 name 去重合并（关系并集）
  const charMap = new Map<string, TemplateCharacter>();
  for (const c of children) {
    for (const ch of c.characters) {
      const existing = charMap.get(ch.name);
      if (!existing) {
        charMap.set(ch.name, { ...ch, relationships: [...(ch.relationships ?? [])] });
      } else {
        if (!existing.arc && ch.arc) existing.arc = ch.arc;
        existing.relationships = mergeRelationships(existing.relationships, ch.relationships);
      }
    }
  }

  const core_elements: TemplateCoreElements = {
    subject: firstNonEmpty(children.map((c) => c.core_elements.subject)),
    theme: firstNonEmpty(children.map((c) => c.core_elements.theme)),
    core_conflict: joinNonEmpty(children.map((c) => c.core_elements.core_conflict), "；"),
    literature_style: firstNonEmpty(children.map((c) => c.core_elements.literature_style)),
    emotion_experience: joinNonEmpty(children.map((c) => c.core_elements.emotion_experience), "；"),
  };

  // 保留 plot_tree（§4.3）：把子单元的剧情树并入父级（加单元前缀防碰撞），避免上卷丢失实质剧情结构。
  const childTrees = children
    .map((c) => c.story_structure.plot_tree)
    .filter((t): t is PlotTree => !!t && t.nodes.length > 0);
  const mergedTree = childTrees.length > 0 ? mergePlotTrees(childTrees) : undefined;
  const story_structure: TemplateStoryStructure = {
    // topology 与合并后剧情树的实际节点一致；无 plot_tree 时才回退按子拓扑求和（best-effort）。
    topology: mergedTree
      ? mergedTree.topology
      : {
          nodeCount: sum(children.map((c) => c.story_structure.topology.nodeCount)),
          startCount: sum(children.map((c) => c.story_structure.topology.startCount)),
          endCount: sum(children.map((c) => c.story_structure.topology.endCount)),
          pivotCount: sum(children.map((c) => c.story_structure.topology.pivotCount)),
          mergeCount: sum(children.map((c) => c.story_structure.topology.mergeCount)),
        },
    plot_tree: mergedTree,
  };

  return {
    worldview,
    characters: [...charMap.values()],
    story_structure,
    core_elements,
    summary: aggregateSummaries(children.map((c) => c.summary)),
  };
}

/**
 * 合并多个子单元剧情树为一棵（§4.3）——修"topology 计数与实际节点断裂"：
 *   ① 给每棵子树的节点 id 加**单元前缀**（各章都从 1.1 起编号会跨单元互撞、被去重丢弃），
 *      同步重写所有引用（prevNodes / nextNodes.to / options.leadsTo）；拼接后无碰撞、不丢节点。
 *   ② nodeTypes 与 topology 按合并后的**连接**重算（不再简单相加子 topology，杜绝 58≠12）。
 * entry 取首棵（对齐 collectLeafIds 的 index 序）。
 */
function mergePlotTrees(trees: PlotTree[]): PlotTree {
  const prefixed = trees.map((t, i) => prefixPlotTree(t, `u${i + 1}:`));
  const nodes = prefixed.flatMap((t) => t.nodes).map((n) => ({ ...n, nodeTypes: inferPlotNodeTypes(n) }));
  return {
    nodes,
    entryNodeId: prefixed[0]?.entryNodeId ?? nodes[0]?.id ?? "",
    // 合并后的 nodeTypes 与计数一并按连接重算：跨单元拼接会改变节点的入出度
    // （子树的结局接上了下一单元的开头），此时子树里的旧读数已经不成立。
    topology: derivePlotTopology(nodes, prefixed[0]?.topology),
  };
}

/** 给剧情树整棵加节点 id 前缀，并同步重写所有引用，避免跨单元 id 碰撞。 */
function prefixPlotTree(tree: PlotTree, prefix: string): PlotTree {
  const remap = (id: string): string => `${prefix}${id}`;
  const nodes: PlotTreeNode[] = tree.nodes.map((n) => ({
    ...n,
    id: remap(n.id),
    prevNodes: (n.prevNodes ?? []).map(remap),
    nextNodes: (n.nextNodes ?? []).map((e) => ({ ...e, to: remap(e.to) })),
    ...(n.options ? { options: n.options.map((o) => ({ ...o, leadsTo: remap(o.leadsTo) })) } : {}),
  }));
  return {
    nodes,
    entryNodeId: tree.entryNodeId ? remap(tree.entryNodeId) : (nodes[0]?.id ?? ""),
    topology: tree.topology,
  };
}

/**
 * 在 IP DNA 上对某子树做"由下至上"的 template 聚合（确定性）。
 * 叶子需已具备 template（由 LLM 提取填入）；内部节点的 template 由子节点聚合得到。
 * 返回根节点（rootId 子树）的聚合 template。原地写回每个内部节点的 template。
 */
export function aggregateSubtreeTemplates(dna: NarrativeIpDna, rootId: string): NarrativeTemplate | undefined {
  const node = dna.nodes[rootId];
  if (!node) return undefined;
  if (node.children.length === 0) return node.template;

  const childTemplates: NarrativeTemplate[] = [];
  const sorted = [...node.children].sort((a, b) => dna.nodes[a].index - dna.nodes[b].index);
  for (const c of sorted) {
    const t = aggregateSubtreeTemplates(dna, c);
    if (t) childTemplates.push(t);
  }
  if (childTemplates.length === 0) return node.template;
  const aggregated = aggregateTemplates(childTemplates);
  node.template = aggregated;
  // 确定性降级（无 LLM）：父层算子无法提取，留空数组 + 元数据，保证每层文件夹三件套齐全（§4.2）。
  if (node.operators === undefined) node.operators = [];
  node.metadata = node.metadata ?? {
    processing_status: "extracted",
    adaptation_status: "未改编",
    stats: { operator_count: 0 },
    updated_at: new Date().toISOString(),
  };
  return aggregated;
}

// ─────────────────────────────────────────────────────────────────
// 逐层递归聚合（LLM 合父三件套 + 批压缩 + DynamicHierarchyAnalyzer，§3.3）
// 迁移自 agentos v6 递归聚合内核，改造为 TS：去掉框架开销，保留"后序逐层 + 批压缩 + 规模自适应"，
// 顶在确定性 aggregateTemplates 之上——LLM 不可用时整体降级为确定性结构上卷（不抛错）。
// ─────────────────────────────────────────────────────────────────

/** 聚合规模档位（驱动批大小与是否做迭代归并）。 */
export type AggregationScale = "micro" | "meso" | "macro";

/** 层级规模分析结果（DynamicHierarchyAnalyzer，§3.3）。 */
export interface HierarchyAnalysis {
  totalNodes: number;
  leafCount: number;
  maxDepth: number;
  /** 最大扇出（单节点最多子节点数）。 */
  maxFanout: number;
  scale: AggregationScale;
  /** 推荐批压缩大小（macro 更小以控 prompt）。 */
  batchSize: number;
}

/**
 * DynamicHierarchyAnalyzer（§3.3）：据叶子规模选聚合策略。
 *   micro（≤25 叶）：直接逐层 LLM 合父；
 *   meso（≤300 叶）：批压缩(25) + 逐层合父；
 *   macro（>300 叶，千章级）：更小批(20) 迭代归并 + 逐层合父。
 */
export function analyzeHierarchy(dna: NarrativeIpDna): HierarchyAnalysis {
  let totalNodes = 0;
  let leafCount = 0;
  let maxDepth = 0;
  let maxFanout = 0;
  const walk = (id: string, depth: number): void => {
    const n = dna.nodes[id];
    if (!n) return;
    if (id !== dna.rootId) {
      totalNodes++;
      maxDepth = Math.max(maxDepth, depth);
      if (n.children.length === 0) leafCount++;
    }
    maxFanout = Math.max(maxFanout, n.children.length);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(dna.rootId, 0);
  const scale: AggregationScale = leafCount <= 25 ? "micro" : leafCount <= 300 ? "meso" : "macro";
  const batchSize = scale === "macro" ? 20 : 25;
  return { totalNodes, leafCount, maxDepth, maxFanout, scale, batchSize };
}

const PARENT_AGG_SYSTEM = loadIpDnaPrompt(
  "parent-aggregate",
  `你是叙事聚合助手。给定若干下层叙事单元的摘要（角色/场景/事件），综合归纳出其父层级的统一摘要：合并去重角色、概括场景脉络、串联事件主线，忠实不臆造、不引入原文没有的设定。仅输出 JSON：{"characters":["..."],"scene":"...","events":"..."}。`,
);

/**
 * LLM 合成父层级三件套（§3.3）。失败/无 LLM 时确定性降级为 aggregateSummaries。
 */
export async function synthesizeParentSummary(
  llm: LLMClient | undefined,
  title: string,
  children: TemplateSummary[],
): Promise<TemplateSummary> {
  if (children.length === 0) return { characters: [], scene: "", events: "" };
  const fallback = aggregateSummaries(children);
  if (!llm) return fallback;
  try {
    const body = children
      .map((c, i) => `## 子单元${i + 1}\n- 角色：${(c.characters ?? []).join("、")}\n- 场景：${c.scene}\n- 事件：${c.events}`)
      .join("\n\n");
    const raw = await llm.callWithRetry(
      PARENT_AGG_SYSTEM,
      `# 父层级标题\n${title}\n\n# 下层摘要\n${body}`,
      { responseFormat: "json", temperature: 0.3 },
    );
    const parsed = parseJSON<Partial<TemplateSummary>>(raw);
    return {
      characters: dedupe((parsed.characters ?? []).length > 0 ? parsed.characters! : fallback.characters),
      scene: parsed.scene?.trim() || fallback.scene,
      events: parsed.events?.trim() || fallback.events,
    };
  } catch {
    return fallback; // LLM 不可用 / 解析失败 → 确定性降级（§3.3）。
  }
}

const PARENT_TEMPLATE_SYNTHESIS_SYSTEM = loadIpDnaPrompt(
  "parent-template-synthesis",
  `你是叙事内核综合助手。给定由若干下层叙事单元「拼接」而来的世界观与核心要素（往往重复、冗长、多段罗列），请**综合提炼**成该父层级**连贯统一的一份**：合并同类、去重、抽象出贯穿主线，保留关键差异与张力；忠实原著、不臆造原文没有的设定。
- worldview.setting：统一的世界基本规则与背景（整体连贯，非各段罗列）。
- worldview.scene_structure：主要场景的结构脉络（可分点，但整体连贯）。
- worldview.item_inventory：关键道具/资产清单（去重归并）。
- core_elements.core_conflict：贯穿本层级的**核心冲突主线**（一段连贯陈述，非多段并列流水账）。
- core_elements.emotion_experience：整体情感体验基调（凝练，非逐章罗列）。
仅输出 JSON：{"worldview":{"setting":"","scene_structure":"","item_inventory":""},"core_elements":{"core_conflict":"","emotion_experience":""}}。`,
);

/**
 * LLM 综合父层级的世界观 + 核心要素（§4.2c / §5.1b 重整）——修 Bug E"顶层 core_conflict/世界观是多章朴素拼接"。
 * 输入 = 确定性上卷后的 template（其 core_conflict/emotion/worldview 为多子单元 joinNonEmpty 拼接串）；
 * 输出 = 综合后连贯统一的 worldview + core_elements 子字段。subject/theme/literature_style 仍取确定性首非空（稳定不动）。
 * 无 LLM / 失败 → 原样返回确定性拼接结果（诚实降级，不抛错；算子/质量只增强不阻断，§3.3）。
 */
export async function synthesizeParentTemplateFields(
  llm: LLMClient | undefined,
  title: string,
  aggregated: NarrativeTemplate,
): Promise<Pick<NarrativeTemplate, "worldview" | "core_elements">> {
  const worldview = aggregated.worldview;
  const core_elements = aggregated.core_elements;
  if (!llm) return { worldview, core_elements };
  try {
    const input = [
      `# 父层级标题\n${title}`,
      `# 世界观设定（拼接待综合）\n${worldview.setting}`,
      `# 主要场景结构（拼接待综合）\n${worldview.scene_structure}`,
      `# 道具清单（拼接待综合）\n${worldview.item_inventory}`,
      `# 核心冲突（拼接待综合）\n${core_elements.core_conflict}`,
      `# 情感体验（拼接待综合）\n${core_elements.emotion_experience}`,
    ].join("\n\n");
    const raw = await llm.callWithRetry(PARENT_TEMPLATE_SYNTHESIS_SYSTEM, input, {
      responseFormat: "json",
      temperature: 0.3,
    });
    const parsed = parseJSON<{ worldview?: Partial<TemplateWorldview>; core_elements?: Partial<TemplateCoreElements> }>(raw);
    return {
      worldview: {
        setting: parsed.worldview?.setting?.trim() || worldview.setting,
        scene_structure: parsed.worldview?.scene_structure?.trim() || worldview.scene_structure,
        item_inventory: parsed.worldview?.item_inventory?.trim() || worldview.item_inventory,
      },
      core_elements: {
        ...core_elements,
        core_conflict: parsed.core_elements?.core_conflict?.trim() || core_elements.core_conflict,
        emotion_experience: parsed.core_elements?.emotion_experience?.trim() || core_elements.emotion_experience,
      },
    };
  } catch {
    return { worldview, core_elements }; // 降级：保留确定性拼接。
  }
}

// ─────────────────────────────────────────────────────────────────
// 父层算子提取（§3.2 分层提炼策略）：父层算子的关注维度与底层不同——
//   中层（章/部/卷/季）：文学风格 / 主题 / 整体情节 / 叙事框架-顺序-节奏-策略 / 情节技巧；
//   顶层（完整内容）：世界观 / 角色塑造与弧光 / 人物关系 / 情感体验 / 叙事者定位 / 表达方式。
// 之前聚合层只上卷 template + 精炼 summary，从不提取父层自身算子（父层 operators.json 缺失）。
// 这里补齐：每个内部/聚合节点按其层级维度 LLM 提取自己的算子，与叶子微观算子并列（非其并集）。
// ─────────────────────────────────────────────────────────────────

/** 父层算子的分层关注维度（§3.2），unit 层不用（走叶子 extractUnitTemplate）。 */
const PARENT_OPERATOR_FOCUS: Record<Exclude<HierarchyLevelType, "unit">, string> = {
  complete:
    "顶层（完整叙事内容）算子——聚焦宏观全局维度：世界观（空间/政治/经济/文化）、角色塑造与弧光、人物关系、情感体验、叙事者定位、整体表现/表达方式。切勿输出对白/语气/局部情节这类底层微观算子。",
  part:
    "中层（部/卷/季）算子——聚焦承上启下维度：文学风格、故事主题、整体情节走向、叙事框架/顺序/节奏/策略、情节技巧。不要输出局部对白/单句腔调这类底层微观算子。",
  chapter:
    "中层（章）算子——聚焦承上启下维度：文学风格、故事主题、本章整体情节、叙事框架/顺序/节奏/策略、情节技巧。不要输出局部对白/单句腔调这类底层微观算子。",
};

const PARENT_OPERATOR_SYSTEM = loadIpDnaPrompt(
  "parent-operator-extract",
  `你是叙事算子提取助手。给定一个【父层级】叙事单元（由若干下层单元聚合而成）的摘要与模板，提取**该层级特有维度**的叙事算子。父层算子关注的维度与底层（对白/独白/语气/局部情节腔调）不同，务必按下述层级重点提取：
{{focus}}
每个算子遵循 8 字段标准：uid/name/definition/adaptation{type,element}/usage_guide/example/knowledge_location/knowledge_domain。knowledge_domain 取五大核心分类之一：叙事者定位 / 情感体验 / 文学风格 / 故事内容 / 叙事技巧。忠实归纳、不臆造原文没有的手法。仅输出 JSON：{"operators":[ ... ]}。`,
);

/** 归一算子：补齐缺省 8 字段，缺 uid 时按 name+序号生成，保证下游注入/落盘不 NPE。 */
export function normalizeOperator(raw: Partial<NarrativeOperator>, fallbackUid: string): NarrativeOperator {
  return {
    uid: (raw.uid ?? "").trim() || fallbackUid,
    name: (raw.name ?? "").trim(),
    definition: (raw.definition ?? "").trim(),
    adaptation: { type: (raw.adaptation?.type ?? "").trim(), element: (raw.adaptation?.element ?? "").trim() },
    usage_guide: (raw.usage_guide ?? "").trim(),
    example: (raw.example ?? "").trim(),
    knowledge_location: (raw.knowledge_location ?? "").trim(),
    // P1-2：归一到五大核心分类（原自由文本/空值 → 规范分类），供三视角分组与覆盖统计。
    knowledge_domain: classifyOperatorDomain(raw),
  };
}

/**
 * 父层级算子提取（§3.2 分层策略）。给定父节点层级 + 聚合 template，提取该层维度专属算子。
 * 无 LLM / 失败 → 返回 []（诚实留空，不拿子算子冒充；子算子池由 collectOperatorPool 另行组装供注入）。
 */
export async function extractParentOperators(
  llm: LLMClient | undefined,
  node: Pick<HierarchyNode, "id" | "title" | "levelType">,
  aggregated: NarrativeTemplate,
): Promise<NarrativeOperator[]> {
  if (!llm) return [];
  const levelType = node.levelType === "unit" ? "chapter" : node.levelType; // 容错：非法层级按中层处理
  const focus = PARENT_OPERATOR_FOCUS[levelType as Exclude<HierarchyLevelType, "unit">] ?? PARENT_OPERATOR_FOCUS.chapter;
  const ce = aggregated.core_elements;
  const context = [
    `# 父层级标题\n${node.title}`,
    `# 层级类型\n${levelType}`,
    `# 聚合摘要\n- 角色：${(aggregated.summary.characters ?? []).join("、")}\n- 场景：${aggregated.summary.scene}\n- 事件脉络：${aggregated.summary.events}`,
    `# 核心要素\n- 题材：${ce.subject}\n- 主题：${ce.theme}\n- 核心冲突：${ce.core_conflict}\n- 文学风格：${ce.literature_style}\n- 情感体验：${ce.emotion_experience}`,
    `# 世界观设定\n${aggregated.worldview.setting}`,
  ].join("\n\n");
  try {
    const raw = await llm.callWithRetry(PARENT_OPERATOR_SYSTEM.replace("{{focus}}", focus), context, {
      responseFormat: "json",
      temperature: 0.3,
    });
    const parsed = parseJSON<{ operators?: Partial<NarrativeOperator>[] }>(raw);
    const list = Array.isArray(parsed.operators) ? parsed.operators : [];
    return list.map((op, i) => normalizeOperator(op, `${node.id}_op${i + 1}`));
  } catch {
    return []; // LLM 不可用 / 解析失败 → 确定性降级（§3.3，算子只增强质量、不阻断）。
  }
}

/**
 * 批压缩 + 迭代归并（§3.3）：子摘要超 batchSize 时分批合并为更少中间摘要，反复直至 ≤batchSize，
 * 再合成最终父摘要。控制 prompt 体量，支撑千章级（macro）聚合。
 */
export async function batchCompressSummaries(
  llm: LLMClient | undefined,
  title: string,
  summaries: TemplateSummary[],
  batchSize = 25,
): Promise<TemplateSummary> {
  if (summaries.length === 0) return { characters: [], scene: "", events: "" };
  let level = summaries;
  let round = 0;
  while (level.length > batchSize) {
    round++;
    const next: TemplateSummary[] = [];
    for (let i = 0; i < level.length; i += batchSize) {
      const batch = level.slice(i, i + batchSize);
      next.push(await synthesizeParentSummary(llm, `${title}·第${round}轮·批${next.length + 1}`, batch));
    }
    level = next;
  }
  return synthesizeParentSummary(llm, title, level);
}

/** 逐层递归聚合选项。 */
export interface RecursiveAggregateOptions {
  /** 提供则 LLM 精炼父三件套；缺省走确定性结构上卷。 */
  llm?: LLMClient;
  /** 批压缩大小；缺省由 analyzeHierarchy 决定。 */
  batchSize?: number;
}

/**
 * 逐层递归聚合（§3.3 主入口）：后序遍历，先聚合子树，再用确定性 aggregateTemplates 上卷结构，
 * 最后（有 LLM 时）用 synthesizeParentSummary / batchCompressSummaries 精炼父层级三件套。
 * 原地写回每个内部节点 template，返回根子树聚合 template。LLM 不可用整体降级为确定性。
 */
export async function aggregateSubtreeTemplatesRecursive(
  dna: NarrativeIpDna,
  rootId: string,
  options: RecursiveAggregateOptions = {},
): Promise<NarrativeTemplate | undefined> {
  const batchSize = options.batchSize ?? analyzeHierarchy(dna).batchSize;
  const recurse = async (id: string): Promise<NarrativeTemplate | undefined> => {
    const node = dna.nodes[id];
    if (!node) return undefined;
    if (node.children.length === 0) return node.template;
    const sorted = [...node.children].sort((a, b) => dna.nodes[a].index - dna.nodes[b].index);
    const childTemplates: NarrativeTemplate[] = [];
    for (const c of sorted) {
      const t = await recurse(c);
      if (t) childTemplates.push(t);
    }
    if (childTemplates.length === 0) return node.template;
    const aggregated = aggregateTemplates(childTemplates); // 确定性结构上卷（worldview/角色/拓扑）
    if (options.llm) {
      const childSummaries = childTemplates.map((t) => t.summary);
      aggregated.summary =
        childSummaries.length > batchSize
          ? await batchCompressSummaries(options.llm, node.title, childSummaries, batchSize)
          : await synthesizeParentSummary(options.llm, node.title, childSummaries);
      // P0-2（§5.1b）：世界观/核心要素也做 LLM 综合（替换朴素拼接），产出连贯统一的层级内核。
      const synth = await synthesizeParentTemplateFields(options.llm, node.title, aggregated);
      aggregated.worldview = synth.worldview;
      aggregated.core_elements = synth.core_elements;
    }
    node.template = aggregated;
    // §3.2 父层算子：按本层维度 LLM 提取自身算子（与叶子微观算子并列，非其并集）。
    // 无 LLM 时返回 []（诚实留空）；写回 operators + metadata 使每层文件夹三件套齐全。
    node.operators = await extractParentOperators(options.llm, node, aggregated);
    node.metadata = {
      processing_status: "extracted",
      adaptation_status: node.metadata?.adaptation_status ?? "未改编",
      stats: { ...(node.metadata?.stats ?? {}), operator_count: node.operators.length },
      updated_at: new Date().toISOString(),
    };
    return aggregated;
  };
  return recurse(rootId);
}

/** 收集子树下所有节点的算子，去重成算子池（按 uid）。 */
export function collectOperatorPool(dna: NarrativeIpDna, rootId: string): NarrativeOperator[] {
  const pool = new Map<string, NarrativeOperator>();
  const walk = (id: string): void => {
    const node = dna.nodes[id];
    if (!node) return;
    for (const op of node.operators ?? []) if (!pool.has(op.uid)) pool.set(op.uid, op);
    for (const c of node.children) walk(c);
  };
  walk(rootId);
  return [...pool.values()];
}

/** levelType → 提取层（§3.2）：complete→top、part/chapter→mid、unit→leaf。 */
export function levelTypeToLayer(levelType: HierarchyLevelType): ExtractionLayer {
  if (levelType === "complete") return "top";
  if (levelType === "unit") return "leaf";
  return "mid";
}

function dedupeOperatorsByUid(ops: NarrativeOperator[]): NarrativeOperator[] {
  const map = new Map<string, NarrativeOperator>();
  for (const op of ops) if (op?.uid && !map.has(op.uid)) map.set(op.uid, op);
  return [...map.values()];
}

/** 判定算子是否属于全局贯穿子集（情感体验/关系/环境/人称/认知类，§3.2 global）。 */
function isGlobalOperator(op: NarrativeOperator): boolean {
  if (classifyOperatorDomain(op) === "情感体验") return true;
  const hay = `${op.name} ${op.definition} ${op.usage_guide} ${op.knowledge_domain} ${op.knowledge_location}`.toLowerCase();
  return /关系|环境|人称|认知|视角|弧光|性格|空间|版图|贯穿/.test(hay);
}

/**
 * 按提取层归桶（§3.2）：top=顶层/complete、mid=章部祖先、leaf=选中叶子、global=贯穿子集。
 * extraTopOps：游戏单元 scoped 合成根的顶层算子（extractParentOperators 产出）。
 */
export function collectLayeredOperators(
  dna: NarrativeIpDna,
  leafIds: string[],
  extraTopOps: NarrativeOperator[] = [],
): LayeredOperators {
  const top: NarrativeOperator[] = [...extraTopOps];
  const mid: NarrativeOperator[] = [];
  const leaf: NarrativeOperator[] = [];

  const root = dna.nodes[dna.rootId];
  if (root?.operators?.length) top.push(...root.operators);

  const midNodeIds = new Set<string>();
  for (const id of leafIds) {
    let cur: string | null = dna.nodes[id]?.parent ?? null;
    while (cur && cur !== dna.rootId) {
      const node = dna.nodes[cur];
      if (node && (node.levelType === "part" || node.levelType === "chapter")) {
        midNodeIds.add(cur);
      }
      cur = node?.parent ?? null;
    }
  }
  for (const midId of midNodeIds) {
    for (const op of dna.nodes[midId]?.operators ?? []) mid.push(op);
  }

  for (const id of leafIds) {
    for (const op of dna.nodes[id]?.operators ?? []) leaf.push(op);
  }

  const topDeduped = dedupeOperatorsByUid(top);
  const midDeduped = dedupeOperatorsByUid(mid);
  const leafDeduped = dedupeOperatorsByUid(leaf);

  // global：跨层复现（同 uid 出现于 ≥2 层）+ 全局贯穿类算子子集。
  const layerByUid = new Map<string, Set<ExtractionLayer>>();
  const uidOp = new Map<string, NarrativeOperator>();
  const ingest = (ops: NarrativeOperator[], layer: ExtractionLayer) => {
    for (const op of ops) {
      if (!op?.uid) continue;
      uidOp.set(op.uid, op);
      const set = layerByUid.get(op.uid) ?? new Set();
      set.add(layer);
      layerByUid.set(op.uid, set);
    }
  };
  ingest(topDeduped, "top");
  ingest(midDeduped, "mid");
  ingest(leafDeduped, "leaf");

  const global: NarrativeOperator[] = [];
  for (const [uid, layers] of layerByUid) {
    if (layers.size >= 2) global.push(uidOp.get(uid)!);
  }
  for (const op of [...topDeduped, ...midDeduped, ...leafDeduped]) {
    if (isGlobalOperator(op)) global.push(op);
  }

  return {
    top: topDeduped,
    mid: midDeduped,
    leaf: leafDeduped,
    global: dedupeOperatorsByUid(global),
  };
}

/** 扁平化分层桶（去重），供 scoped root.operators 兜底整池。 */
export function flattenLayeredOperators(layers: LayeredOperators): NarrativeOperator[] {
  return dedupeOperatorsByUid([
    ...layers.top,
    ...layers.mid,
    ...layers.leaf,
    ...layers.global,
  ]);
}

/**
 * 按 step 声明的层从分层桶选候选池（§3.2）：
 *   - 取 spec.layers 对应桶之并集 + global（恒注入）；
 *   - mid 桶空 → 回退 top；全空 → 回退 fallbackPool（整池）。
 */
export function selectOperatorsForStep(
  layered: LayeredOperators | undefined,
  stepLayers: ExtractionLayer[],
  fallbackPool: NarrativeOperator[],
): { pool: NarrativeOperator[]; layerByUid: Map<string, ExtractionLayer> } {
  const layerByUid = new Map<string, ExtractionLayer>();
  const record = (ops: NarrativeOperator[], layer: ExtractionLayer) => {
    for (const op of ops) {
      if (op?.uid && !layerByUid.has(op.uid)) layerByUid.set(op.uid, layer);
    }
  };

  if (!layered) {
    return { pool: fallbackPool, layerByUid };
  }

  const buckets: NarrativeOperator[] = [];
  for (const layer of stepLayers) {
    if (layer === "global") continue;
    let ops = layered[layer] ?? [];
    if (layer === "mid" && ops.length === 0) ops = layered.top ?? [];
    record(ops, layer === "mid" && (layered.mid?.length ?? 0) === 0 ? "top" : layer);
    buckets.push(...ops);
  }
  record(layered.global ?? [], "global");
  buckets.push(...(layered.global ?? []));

  const pool = dedupeOperatorsByUid(buckets);
  return { pool: pool.length > 0 ? pool : fallbackPool, layerByUid };
}

// ─────────────────────────────────────────────────────────────────
// LLM 提取 seam：从单元正文抽取三件套
// ─────────────────────────────────────────────────────────────────

const UNIT_EXTRACT_SYSTEM = loadIpDnaPrompt(
  "unit-extract",
  `你是叙事 IP 提取助手。给定一个最小叙事单元的正文，提取其叙事模板与算子。仅输出 JSON（template + operators）。忠实原文、不臆造；summary 三件(characters/scene/events)必填。`,
);

/** 提取单个最小单元的三件套（LLM seam）。原地写回 node.template / node.operators。 */
export async function extractUnitTemplate(
  llm: LLMClient,
  node: HierarchyNode,
  unitText: string,
): Promise<void> {
  const raw = await llm.callWithRetry(
    UNIT_EXTRACT_SYSTEM,
    `# 单元标题\n${node.title}\n\n# 正文\n${unitText}`,
    { responseFormat: "json", temperature: 0.3 },
  );
  const parsed = parseJSON<{ template?: NarrativeTemplate; operators?: NarrativeOperator[] }>(raw);
  if (parsed.template) node.template = normalizeTemplate(parsed.template);
  // P1-2：叶子算子也走 normalizeOperator（补齐 8 字段 + 五大类归一），修"叶子算子未归一、覆盖 0/5、三视角失效"。
  node.operators = (parsed.operators ?? []).map((op, i) => normalizeOperator(op, `${node.id}_op${i + 1}`));
  node.metadata = {
    processing_status: "extracted",
    adaptation_status: "未改编",
    stats: { char_count: unitText.length, operator_count: node.operators.length },
    updated_at: new Date().toISOString(),
  };
}

/**
 * 确定性兜底提取（无 LLM 时用于 dry-run / 离线管线自检）。
 * 只做最朴素的结构化：标题作事件、正文首段作场景。不臆造世界观/角色。
 */
export function heuristicExtractUnit(node: HierarchyNode, unitText: string): void {
  const firstChunk = unitText.replace(/\s+/g, " ").trim().slice(0, 120);
  node.template = normalizeTemplate({
    summary: { characters: [], scene: firstChunk, events: node.title },
  });
  node.operators = [];
  node.metadata = {
    processing_status: "extracted",
    adaptation_status: "未改编",
    stats: { char_count: unitText.length, operator_count: 0 },
    updated_at: new Date().toISOString(),
  };
}

/**
 * 结构部分的归一：有树就按树算，没树才退回模型报的数。
 *
 * 这是模型产出的剧情树进入系统的唯一入口，所以也是结构读数唯一该被确定的地方。从前这里
 * 把五个计数逐个 `?? 0` 透传 —— 图就在手上，那些数不必问模型；而模型报的数与它自己连的
 * 图不符是常事（`nodeCount` 58、节点 12 那次断裂就是这么来的）。
 *
 * 无 `plot_tree` 时才保留透传：那种 template 只有计数没有图，算不出来，报的数是唯一的读数。
 */
function normalizeStoryStructure(
  s: Partial<NarrativeTemplate>["story_structure"],
): NarrativeTemplate["story_structure"] {
  if (s?.plot_tree) {
    const plot_tree = normalizePlotTree(s.plot_tree);
    return { topology: plot_tree.topology, plot_tree };
  }
  return {
    topology: {
      nodeCount: s?.topology?.nodeCount ?? 0,
      startCount: s?.topology?.startCount ?? 0,
      endCount: s?.topology?.endCount ?? 0,
      pivotCount: s?.topology?.pivotCount ?? 0,
      mergeCount: s?.topology?.mergeCount ?? 0,
      ...(s?.topology?.shape ? { shape: s.topology.shape } : {}),
    },
  };
}

/** 补齐 template 缺省字段，保证聚合不 NPE。 */
export function normalizeTemplate(t: Partial<NarrativeTemplate>): NarrativeTemplate {
  return {
    worldview: {
      setting: t.worldview?.setting ?? "",
      scene_structure: t.worldview?.scene_structure ?? "",
      item_inventory: t.worldview?.item_inventory ?? "",
    },
    characters: t.characters ?? [],
    story_structure: normalizeStoryStructure(t.story_structure),
    core_elements: {
      subject: t.core_elements?.subject ?? "",
      theme: t.core_elements?.theme ?? "",
      core_conflict: t.core_elements?.core_conflict ?? "",
      literature_style: t.core_elements?.literature_style ?? "",
      emotion_experience: t.core_elements?.emotion_experience ?? "",
    },
    summary: {
      characters: t.summary?.characters ?? [],
      scene: t.summary?.scene ?? "",
      events: t.summary?.events ?? "",
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// A→B：顶层 template 映射到 NarrativeContext（对齐 data-atlas）
// ─────────────────────────────────────────────────────────────────

/**
 * 把游戏单元顶层 template 映射进 NarrativeContext（A→B，§4.1 / data-atlas）。
 * 只填"输入理解可确定"的字段；其余生成字段交给后续生成管线。确定性转换。
 */
export function mapTemplateToContext(template: NarrativeTemplate, base: NarrativeContext): NarrativeContext {
  const ctx: NarrativeContext = { ...base };

  const protagonist = template.characters[0];
  const core_settings: CoreSettings = {
    world_name: ctx.story_title ?? "",
    world_setting: template.worldview.setting,
    world_summary: template.summary.scene,
    world_tags: { tone: [], theme: [template.core_elements.theme].filter(Boolean), hook: [] },
    protagonist: {
      name: protagonist?.name ?? "",
      identity: protagonist?.profile ?? "",
      personality: "",
      core_conflict: template.core_elements.core_conflict,
    },
    key_npcs: template.characters.slice(1).map((c) => ({
      name: c.name,
      identity: c.profile,
      personality: "",
      relationship_to_protagonist: (c.relationships ?? []).map((r) => `${r.target}:${r.relation}`).join("; "),
    })),
    main_theme: template.core_elements.theme,
    main_conflict: template.core_elements.core_conflict,
    narrative_perspective: "",
    genre: template.core_elements.subject,
  };
  ctx.core_settings = core_settings;

  // 初始大纲（A→B）：从 plot_tree 上卷 opening/development/ending + 关键节点，IP 已有则不丢。
  const plotTree = template.story_structure.plot_tree;
  const plotOutline = plotTree ? plotTreeToOutlineStructure(plotTree) : undefined;
  ctx.initial_story_outline = {
    theme: template.core_elements.theme,
    background: template.worldview.setting,
    character_arc: protagonist?.arc ?? "",
    main_conflict: template.core_elements.core_conflict,
    story_structure: plotOutline?.story_structure ?? { opening: "", development: [], ending: "" },
    key_plot_points: plotOutline?.key_plot_points ?? [],
  };

  // 叙事层世界观结构（A→B）：把模板世界观/规则上卷为 WorldviewStructure 的叙事侧骨架。
  // 深层"基础架构层/交互叙事层"留给后续生成管线细化，这里只落 IP 可确定的部分。
  const worldview_structure: WorldviewStructure = {
    world_name: core_settings.world_name,
    worldview_title: ctx.story_title,
    基础架构层: {
      时空背景: { setting: template.worldview.setting },
    },
    交互叙事层: {
      场景结构: { scene_structure: template.worldview.scene_structure },
      物品体系: { item_inventory: template.worldview.item_inventory },
    },
  };
  ctx.worldview_structure = worldview_structure;

  // 角色档案（A→B）：模板角色 → CharacterSheet（仅落确定字段，立绘/机制留生成）。
  ctx.detailed_character_sheets = template.characters.map((c, i): CharacterSheet => ({
    name: c.name,
    label: i === 0 ? "主角" : "NPC",
    role_in_story: c.profile,
    character_arc_spectrum: c.arc,
    background_information: c.profile,
    relationships: Object.fromEntries(
      (c.relationships ?? []).map((r) => [r.target, { relation: r.relation, detail: r.detail ?? "" }]),
    ),
    _is_player: i === 0 || undefined,
  }));

  // 场景地图（A→B，§4.2c worldview②）：把 IP 场景结构作为骨架种子带入；
  // 具体 SceneNode 由 scene_plan 步生成，这里只保留可确定的结构 md，避免丢失 IP 场景信息。
  if (template.worldview.scene_structure?.trim()) {
    ctx.scene_map = {
      world_name: core_settings.world_name,
      scenes: [],
      _scene_structure_md: template.worldview.scene_structure,
    } satisfies SceneMap;
  }

  // 道具库（A→B，§4.2c worldview③）：把道具清单切成种子条目，pipeline item_database 步再丰富。
  const items = parseItemInventory(template.worldview.item_inventory);
  if (items.length > 0) ctx.item_database = items;

  // 故事框架（A→B，§4.3）：plot_tree → StoryFramework.framework.nodes（确定性结构转换）。
  // 按场聚合，不是按最小叙事单元 —— 见 plot-tree-to-structure.ts 顶部的量级说明。
  //
  // 不分档产出：忠实档直接当骨架用；其余档会被 story_framework 的 full 模式重新规划
  // 覆盖，但转换是确定性的、零模型成本，而"原作分了几场"对读它的人是有用的读数。
  if (plotTree) {
    ctx.story_framework = plotTreeToStoryFramework(plotTree);
    // L1/L2 的树只在忠实档一并定下来。字段在场的含义是「这棵树已经定了」（见
    // StructureSeatSeed 的注释），所以按档决定产不产，而不是产了再让消费点忽略 ——
    // 后者会让"在场"同时表示两件相反的事。
    //
    // 忠实档不注入的后果：两席各自 1:N 重新规划，原作的分叉、合流与结局分布到 L3
    // 就不剩什么了，这正是「IP 结构被洗掉」的下半段。
    if (contentFidelityOf(ctx) === "faithful") {
      ctx.injected_structure_seed = plotTreeToStructureSeat(plotTree);
    }
  }

  return ctx;
}

/** plot_tree → InitialOutline 的结构部分（opening/development/ending + 关键节点）。 */
function plotTreeToOutlineStructure(tree: PlotTree): {
  story_structure: { opening: string; development: string[]; ending: string };
  key_plot_points: string[];
} {
  const titleOf = (id: string): string => tree.nodes.find((n) => n.id === id)?.title ?? id;
  // 读度数而不读 nodeTypes。归一之后两者等价，但读度数不必先确认"这棵树归一过没有"
  // —— 这个函数从 template 拿树，而不是所有进得来的 template 都经过同一条归一路。
  const starts = tree.nodes.filter((n) => (n.prevNodes?.length ?? 0) === 0);
  const ends = tree.nodes.filter((n) => (n.nextNodes?.length ?? 0) === 0);
  const pivots = tree.nodes.filter((n) => (n.nextNodes?.length ?? 0) > 1);
  const opening = starts[0] ? titleOf(starts[0].id) : (tree.entryNodeId ? titleOf(tree.entryNodeId) : "");
  const ending = ends.map((n) => n.title ?? n.id).filter(Boolean).join("；");
  const development = pivots.map((n) => n.title ?? n.id).filter(Boolean);
  const key_plot_points = pivots.map((n) => n.question ?? n.title ?? n.id).filter(Boolean);
  return { story_structure: { opening, development, ending }, key_plot_points };
}

/** 把自由文本道具清单切成 GameItem 种子条目（确定性，分隔符切分 + 去噪 + 上限）。 */
function parseItemInventory(inventory: string): GameItem[] {
  const text = (inventory ?? "").trim();
  if (!text) return [];
  const segments = text
    .split(/[、，,；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 40);
  const seen = new Set<string>();
  const items: GameItem[] = [];
  for (const name of segments) {
    if (seen.has(name)) continue;
    seen.add(name);
    items.push({
      name,
      category: "未分类",
      rarity: "common",
      description: name,
      effect: "",
      initial_owner: null,
      initial_scene: "",
      related_character: null,
      value: {},
      max_stack: 1,
    });
    if (items.length >= 30) break;
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────
// 生成输入构建：IP DNA 顶层 template → 驱动既有生成管线的 userInput + uploadedScript
// ─────────────────────────────────────────────────────────────────

/**
 * 由顶层（已聚合）template + 原文切片，合成一份"忠实改编简报" + uploaded_script。
 * 这是 A→B 的运行时主驱动：既有生成管线消费 user_input / uploaded_script 完成 IP 改编，
 * 而 mapTemplateToContext 负责把可确定字段提前落到 NarrativeContext（resumeCtx 喂入）。
 */
export function buildGenerationInput(
  template: NarrativeTemplate,
  options?: { storyTitle?: string; sourceText?: string },
): { userInput: string; uploadedScript?: UploadedScript } {
  const ce = template.core_elements;
  const wv = template.worldview;
  const charLines = template.characters
    .map((c, i) => `  - ${i === 0 ? "【主角】" : "【角色】"}${c.name}：${c.profile}${c.arc ? `（弧光：${c.arc}）` : ""}`)
    .join("\n");

  const userInput = [
    `请基于以下 IP 叙事内核进行忠实游戏化改编${options?.storyTitle ? `（项目：${options.storyTitle}）` : ""}：`,
    options?.storyTitle ? `- ⭐全局标题：本作品统一使用《${options.storyTitle}》作为作品名，所有标题/命名须与之一致，不要另起新名。` : "",
    ce.subject ? `- 题材：${ce.subject}` : "",
    ce.theme ? `- 主题：${ce.theme}` : "",
    ce.core_conflict ? `- 核心冲突：${ce.core_conflict}` : "",
    ce.literature_style ? `- 文学风格：${ce.literature_style}` : "",
    ce.emotion_experience ? `- 情感体验：${ce.emotion_experience}` : "",
    wv.setting ? `- 世界设定：${wv.setting}` : "",
    charLines ? `- 主要角色：\n${charLines}` : "",
    template.summary.events ? `- 关键事件脉络：${template.summary.events}` : "",
    `\n要求：尊重原 IP 设定、人物关系与情节脉络，不臆造与原作冲突的核心设定。`,
  ]
    .filter(Boolean)
    .join("\n");

  const sourceText = options?.sourceText?.trim();
  const uploadedScript: UploadedScript | undefined = sourceText
    ? {
        content: sourceText,
        format: "prose",
        char_count: sourceText.length,
        description: "来自 IP DNA 改编范围内的原文切片，用于忠实改编参考。",
      }
    : undefined;

  return { userInput, uploadedScript };
}

// ─────────────────────────────────────────────────────────────────
// 提取质量评估（§14.2 D3）—— 结构完整性 + 三件套齐全 + 五大类算子统计
// ─────────────────────────────────────────────────────────────────

import type { QualityCheck } from "./job.js";
import type { OperatorDomain } from "../types/narrative-ip-dna.js";

/** 五大核心算子分类（§3.2），用于覆盖度统计。 */
const OPERATOR_DOMAINS: OperatorDomain[] = ["叙事者定位", "情感体验", "文学风格", "故事内容", "叙事技巧"];

/** 五大分类关键词映射（§3.2/§4.5）：把 LLM 返回的自由文本归一到规范分类。 */
const OPERATOR_DOMAIN_KEYWORDS: Record<OperatorDomain, string[]> = {
  叙事者定位: ["视角", "人称", "叙事者", "认知", "全知", "限知", "旁白", "第一人称", "第三人称", "上帝视角", "聚焦", "pov", "narrator"],
  情感体验: ["情感", "情绪", "共鸣", "张力", "爽", "燃", "泪", "感染", "氛围", "悬念", "代入", "期待", "震撼", "压抑", "沉浸", "emotion"],
  文学风格: ["风格", "文风", "腔调", "语言", "修辞", "意象", "笔法", "文学", "描写", "比喻", "美学", "style"],
  叙事技巧: ["结构", "技巧", "节奏", "顺序", "框架", "伏笔", "铺垫", "蒙太奇", "闪回", "开局", "反转", "线索", "叙事手法", "开篇", "黄金三章", "技法", "plot", "structure", "pacing"],
  故事内容: ["角色", "人物", "世界观", "设定", "情节", "冲突", "关系", "台词", "对白", "场景", "道具", "主题", "事件", "剧情", "character", "world"],
};

/**
 * 把算子归一到五大核心分类之一（§3.2/§4.5，P1-2）——修"算子 knowledge_domain 是自由文本、五大类 0/5 覆盖、三视角分组失效"。
 * 已是规范分类直接返回；否则按 knowledge_domain/adaptation/name/definition 的关键词计分取最高命中；无命中兜底"故事内容"。
 * 三视角分组依赖此归一（读者←情感体验；作者←叙事者定位/叙事技巧/文学风格；角色←故事内容），属前置刚需。
 */
export function classifyOperatorDomain(op: Partial<NarrativeOperator>): OperatorDomain {
  const raw = (op.knowledge_domain ?? "").trim();
  if ((OPERATOR_DOMAINS as string[]).includes(raw)) return raw as OperatorDomain;
  const hay = [op.knowledge_domain, op.adaptation?.type, op.adaptation?.element, op.name, op.definition, op.knowledge_location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let best: OperatorDomain = "故事内容";
  let bestScore = 0;
  for (const d of OPERATOR_DOMAINS) {
    const score = OPERATOR_DOMAIN_KEYWORDS[d].reduce((s, kw) => s + (hay.includes(kw.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * 评估一次 scoped 提取的质量（§14.2 D3）：把"结构完整性 + 三件套齐全 + 算子统计"这套
 * 蓝图要求的质量闸门接到提取链路上（此前 runWithRetry/QualityCheck 仅有定义、无调用）。
 *
 * - 选中叶子（minimal units）必须有 template（三件套之 ②）且 metadata 标记 extracted；
 * - 顶层聚合 template 的核心要素不应全空（结构完整性："开端-发展-高潮-结局"的语义载体）；
 * - 五大类算子覆盖统计（缺类记 warning，不判失败——算子只增强质量、不阻断生成 §3.3）。
 *
 * 设计为**非阻断**：返回告警供编排器 emit / 落盘，degrade 友好（passed=false 不抛错）。
 */
export function assessExtractionQuality(
  dna: NarrativeIpDna,
  selectedLeafIds: string[],
): QualityCheck {
  const checks: QualityCheck["checks"] = [];
  const warnings: string[] = [];

  // ① 层级树连通性：rootId 存在、被选叶子可经 parent 链回溯到 root。
  const rootOk = !!dna.nodes[dna.rootId];
  const connected =
    rootOk &&
    selectedLeafIds.every((id) => {
      let cur: string | null = id;
      const guard = new Set<string>();
      while (cur && !guard.has(cur)) {
        if (cur === dna.rootId) return true;
        guard.add(cur);
        cur = dna.nodes[cur]?.parent ?? null;
      }
      return cur === dna.rootId;
    });
  checks.push({ name: "层级树连通", passed: connected });
  if (!connected) warnings.push("部分选中单元无法回溯到根节点，层级树可能断裂。");

  // ② 三件套齐全（template + metadata.extracted）。
  const missing = selectedLeafIds.filter(
    (id) => !dna.nodes[id]?.template || dna.nodes[id]?.metadata?.processing_status !== "extracted",
  );
  const triadOk = selectedLeafIds.length > 0 && missing.length === 0;
  checks.push({
    name: "三件套齐全",
    passed: triadOk,
    detail: missing.length > 0 ? `缺失/未提取单元：${missing.length}` : undefined,
  });
  if (missing.length > 0) warnings.push(`有 ${missing.length} 个选中单元缺 template 或未标记 extracted。`);

  // ③ 结构完整性：顶层聚合 template 的核心要素不应全空。
  const leafTemplates = selectedLeafIds
    .map((id) => dna.nodes[id]?.template)
    .filter((t): t is NarrativeTemplate => !!t);
  const top = leafTemplates.length > 0 ? aggregateTemplates(leafTemplates) : undefined;
  const ce = top?.core_elements;
  const coreOk =
    !!ce && [ce.subject, ce.theme, ce.core_conflict, ce.literature_style, ce.emotion_experience].some((s) => !!s?.trim());
  checks.push({ name: "核心要素非空", passed: coreOk });
  if (!coreOk) warnings.push("顶层核心要素（题材/主题/冲突/风格/情感）全空，提取可能过于稀薄。");

  // ④ 五大类算子覆盖统计（缺类仅告警）。P1-2：按归一后的规范分类统计（不再依赖 LLM 恰好填规范值）。
  // 分层注入：统计选中子树 top+mid+leaf 全层算子（§3.2），使顶层叙事者定位/中层文学风格可被计入。
  const layered = collectLayeredOperators(dna, selectedLeafIds);
  const operators = flattenLayeredOperators(layered);
  const presentDomains = new Set(operators.map((o) => classifyOperatorDomain(o)));
  const missingDomains = OPERATOR_DOMAINS.filter((d) => !presentDomains.has(d));
  checks.push({
    name: "算子分类覆盖",
    passed: operators.length > 0,
    detail: `共 ${operators.length} 个算子；覆盖 ${OPERATOR_DOMAINS.length - missingDomains.length}/${OPERATOR_DOMAINS.length} 类`,
  });
  if (operators.length === 0) warnings.push("未提取到任何算子（生成将退化为无算子增强，仍可跑通）。");
  else if (missingDomains.length > 0) warnings.push(`算子未覆盖分类：${missingDomains.join("、")}。`);

  return { passed: checks.every((c) => c.passed), checks, warnings };
}

// ─────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}
function joinNonEmpty(arr: string[], sep: string): string {
  return arr.filter(Boolean).join(sep);
}
function firstNonEmpty(arr: string[]): string {
  return arr.find(Boolean) ?? "";
}
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
function mergeRelationships(
  a: TemplateCharacter["relationships"],
  b: TemplateCharacter["relationships"],
): TemplateCharacter["relationships"] {
  const map = new Map<string, { target: string; relation: string; detail?: string }>();
  for (const r of [...(a ?? []), ...(b ?? [])]) map.set(`${r.target}|${r.relation}`, r);
  return [...map.values()];
}
