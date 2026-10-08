/**
 * run-manifest-builder.ts — config → resolved RunManifest（Phase-1 M2）
 *
 * 算法只在后端：调用 planPipeline，填 agents[].lifecycle=pending。
 * 前端「未运行」预览与 /start 前预检均经此入口，禁止客户端重算步序。
 */
import { randomUUID } from "node:crypto";
import { findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import { resolveNarrativeStructure, resolveUserAxes } from "../../knowledge/narrative-axes/index.js";
import type { ResolvedStructure, TagDerivedAxes } from "../../knowledge/narrative-axes/index.js";
import type { ModeId, TierId, ContentLocale } from "../../types/index.js";
import {
  type RunManifest,
  type RunManifestConfig,
  type CompositionGraph,
  type ManifestAgentSlot,
  isCompositionComplete,
  emptyLifecycle,
} from "../../types/run-manifest.js";
import { expandPipelineSteps, resolveNarrativePipeline, resolveSeatStepGroups } from "../routing/narrative-pipelines.js";
import { isSeatRoutedMode, resolveModeStepGroups } from "../routing/mode-routing.js";
import { getModeConfig, TIER_DEFAULT_MODE } from "../routing/modes.js";
import { type PipelineTemplateId } from "../routing/templates.js";
import { getNarrativeAgent } from "../core/agent-registry.js";
import { type AgentLifecycle, prototypeFromStructure } from "../core/agent-contract.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
// Ensure StepDescriptor + AgentDef registries are populated for name/prototype lookup.
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

export interface PlanManifestRequest {
  entryKey?: string;
  pipelineId?: string;
  config: RunManifestConfig;
  compositionGraph?: CompositionGraph;
  /** 自由编排显式请求的 step id（工程师节点）；与预设冲突时以此为准。 */
  requestedSteps?: string[];
  /**
   * C1（VN v2 吸收与封存）后已不再触发任何步序旁路——上传剧本的业务功能下沉进
   * `preference_summary` 席 composer（读 `ctx.uploaded_script`），与步序正交。
   * 字段保留只为兼容仍在传这个参数的调用方，`resolveStepGroups` 不再读它。
   */
  hasUploadedScript?: boolean;
}

function agentName(id: string): string {
  return getNarrativeAgent(id)?.name ?? STEP_REGISTRY.get(id)?.name ?? id;
}

/**
 * 把投票过程整理成可落盘、可展示的形状。
 *
 * 只在真有内容时写字段：显式指定结构的条目没有"比较过程"可讲，
 * 塞一个只含自己的 candidates 数组反而让 UI 误以为发生过一次投票。
 */
export function buildStructureRationale(
  structure: ResolvedStructure,
  derived: TagDerivedAxes,
): RunManifestConfig["structureRationale"] {
  const byAxis: Record<string, string[]> = {};
  for (const [axis, codes] of Object.entries(structure.byAxis)) {
    if (codes.length > 0) byAxis[axis] = [...codes];
  }
  const tagDerived: Record<string, { dimension: string; value: string }> = {};
  if (derived.hits.storyType) tagDerived.storyType = derived.hits.storyType;
  if (derived.hits.storyTheme) tagDerived.storyTheme = derived.hits.storyTheme;

  const rationale: NonNullable<RunManifestConfig["structureRationale"]> = {};
  if (structure.source === "vote" && structure.candidates.length > 0) {
    rationale.candidates = [...structure.candidates];
  }
  if (Object.keys(byAxis).length > 0) rationale.byAxis = byAxis;
  if (Object.keys(tagDerived).length > 0) rationale.tagDerived = tagDerived;

  return Object.keys(rationale).length > 0 ? rationale : undefined;
}

function agentPrototype(id: string) {
  const a = getNarrativeAgent(id);
  if (a) return a.prototype;
  return prototypeFromStructure("single-turn");
}

/** 展平并去重（保序、保留并行组），供 mode 步序与 planner 步序拼接。 */
function concatGroupsDeduped(
  ...groupLists: (string | string[])[][]
): (string | string[])[] {
  const seen = new Set<string>();
  const out: (string | string[])[] = [];
  for (const groups of groupLists) {
    for (const entry of groups) {
      if (Array.isArray(entry)) {
        const kept = entry.filter((id) => !seen.has(id));
        for (const id of kept) seen.add(id);
        if (kept.length === 1) out.push(kept[0]!);
        else if (kept.length > 1) out.push(kept);
      } else if (!seen.has(entry)) {
        seen.add(entry);
        out.push(entry);
      }
    }
  }
  return out;
}

interface ResolveStepsInput {
  mode: ModeId | null | undefined;
  tier: TierId;
  genreCode: string | undefined;
  pipelineTemplate: PipelineTemplateId | undefined;
}

/**
 * config → 步序，镜像 NarrativePipeline.run 的两层路由（Phase-2 M9）。
 *
 * 一期把 /plan 的步序算法收到后端，但只调了 planPipeline，漏掉了运行时真正的第一层
 * ——mode 路由：design_* 模式先跑 D0-D4，narrative_* 静态模式直接用 modeConfig.steps。
 * 前端于是自己补 D0-D4 前缀、自己维护 NARRATIVE_ROUTES.steps 镜像，形成两份算法。
 * 这里把 mode 路由补齐，/plan 才真的是唯一步序真值。
 *
 * 与运行时的唯一差异：运行时 design_auto 的叙事段在 D4 完成后才由 Planner 追加
 * （需要 LLM 的 demand_analysis），预览则直接把 Planner 结果接在 D0-D4 之后，
 * 使「待生成」链条完整可见；两者的步集一致，只是揭示时机不同。
 */
function resolveStepGroups(input: ResolveStepsInput): {
  stepGroups: (string | string[])[];
  resolvedTemplate: string;
} {
  const { tier, genreCode, pipelineTemplate } = input;
  // 预览与运行时读同一个步序真值：品类 + 层级 → 四条席位管线之一。
  // 这两侧一旦各算一份，用户在「待生成」看到的链就会与实际跑的不符。
  const seat = resolveSeatStepGroups(genreCode, tier);
  // 提示词库版本仍由品类的 pipelineTemplate 决定 —— 它与"跑哪些步"正交，
  // 换步序不该顺手把 V1/V2 槽位库也换掉。
  const seatTemplate =
    pipelineTemplate ??
    (genreCode ? findGenreByCode(genreCode)?.pipelineTemplate : undefined) ??
    "needs-driven";

  const mode = (input.mode ?? TIER_DEFAULT_MODE[tier]) as ModeId;
  let modeConfig: ReturnType<typeof getModeConfig> | undefined;
  try {
    modeConfig = getModeConfig(mode);
  } catch {
    modeConfig = undefined;
  }

  let stepGroups: (string | string[])[];
  let resolvedTemplate: string;

  if (!modeConfig || mode === "narrative_auto") {
    // 专家组（纯叙事）：席位管线即全部步序。
    stepGroups = [...seat.stepGroups];
    resolvedTemplate = seatTemplate;
  } else if (modeConfig.isDynamic) {
    // design_*：modeConfig.steps（D0-D4）在前，叙事段接同一条席位管线。
    stepGroups = concatGroupsDeduped([...modeConfig.steps], seat.stepGroups);
    resolvedTemplate = seatTemplate;
  } else if (isSeatRoutedMode(mode)) {
    // 静态叙事单品（worldview / script / vn_script ...）：路由归一后步序也来自席位管线。
    // 这里必须与 run() 的第三支同调用同参数，否则预览按 modeConfig.steps 画、实跑按
    // 席位管线跑，用户在「待生成」看到的链与真跑的链不是一条——正是归一要消掉的分歧。
    const routed = resolveModeStepGroups({ mode, genreCode, tier });
    stepGroups = [...routed.stepGroups];
    resolvedTemplate = modeConfig.pipeline_template ?? seatTemplate;
  } else {
    // 席位管线表达不了交付物的少数 mode（LEGACY_STEP_ORDER_MODES）：仍读 modeConfig.steps。
    stepGroups = concatGroupsDeduped([...modeConfig.steps]);
    resolvedTemplate = modeConfig.pipeline_template ?? pipelineTemplate ?? "needs-driven";
  }

  return { stepGroups, resolvedTemplate };
}

/**
 * 画布子图 → 用户编排的步序（自由编排的事实源）。
 *
 * 只有画布上出现**单品助手节点**（category=engineer）才认定为自由编排：那是用户在逐步
 * 指定"跑哪几件、什么顺序"。只有输入 + 路由 + 专家的图恰好就是预设路径本身，交回
 * resolveStepGroups 走席位管线，免得把并行组拍平成串行。
 *
 * 专家节点按其品类展开为整条席位管线 —— 用户拖进来的"互动叙事专家"语义是一整条管线，
 * 不是一个 step；混排时它贡献自己那一段。
 *
 * 拓扑序用 Kahn，同层按画布 x 坐标再按声明序打破平局：用户从左到右摆节点表达的就是先后。
 */
export function compositionStepOrder(
  graph: CompositionGraph,
  ctx: { tier: TierId; genreCode?: string },
): string[] | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!graph.nodes.some((n) => n.category === "engineer")) return undefined;

  const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const rank = (id: string): number => {
    const n = byId.get(id);
    return (n?.position?.x ?? 0) * 1e4 + (order.get(id) ?? 0);
  };

  const ready = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const sorted: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => rank(a) - rank(b));
    const cur = ready.shift()!;
    sorted.push(cur);
    for (const next of outgoing.get(cur) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  // 有环时 Kahn 会漏掉环内节点：按声明序补回，宁可多跑也不静默少跑。
  for (const n of graph.nodes) if (!sorted.includes(n.id)) sorted.push(n.id);

  const steps: string[] = [];
  for (const id of sorted) {
    const node = byId.get(id)!;
    if (node.category === "engineer") {
      const stepId = node.agentId ?? (node.config?.stepId as string | undefined);
      if (stepId) steps.push(stepId);
    } else if (node.category === "expert") {
      const code = (node.config?.genreCode as string | undefined) ?? ctx.genreCode;
      const nodeTier = (node.config?.tier as TierId | undefined) ?? ctx.tier;
      steps.push(...expandPipelineSteps(resolveNarrativePipeline(code ?? "", nodeTier)));
    }
  }

  const unique = [...new Set(steps)];
  return unique.length > 0 ? unique : undefined;
}

function parallelGroupsToIndex(
  stepGroups: (string | string[])[],
  flat: string[],
): number[][] {
  const indexOf = new Map(flat.map((id, i) => [id, i]));
  const groups: number[][] = [];
  for (const g of stepGroups) {
    if (!Array.isArray(g) || g.length < 2) continue;
    groups.push(g.map((id) => indexOf.get(id)!).filter((n) => n !== undefined));
  }
  return groups;
}

/**
 * 有序 step id → ManifestAgentSlot[]。
 * /plan 预览与运行时 manifest 共用，保证两侧 slot 形状一致。
 */
export function buildAgentSlots(
  flatSteps: string[],
  pipelineId: string,
  lifecycle?: Record<string, AgentLifecycle>,
): ManifestAgentSlot[] {
  return flatSteps.map((agentId, index) => {
    const na = getNarrativeAgent(agentId);
    return {
      agentId,
      name: agentName(agentId),
      prototype: agentPrototype(agentId),
      index,
      lifecycle: emptyLifecycle(lifecycle?.[agentId] ?? "pending"),
      outputField: na?.io.outputField,
      outputRef: `${pipelineId}:${agentId}`,
    };
  });
}

/**
 * 将前端 config（+ 可选画布拓扑）解析为 RunManifest。
 * 自由编排 requestedSteps / compositionGraph 优先于预设管线。
 */
export function buildRunManifest(req: PlanManifestRequest): RunManifest {
  const now = new Date().toISOString();
  const entryKey = req.entryKey ?? `draft-${randomUUID().slice(0, 8)}`;
  const pipelineId = req.pipelineId ?? `pipe-${randomUUID().slice(0, 8)}`;
  const cfg = req.config;

  let complete = true;
  let incompletenessReason: string | undefined;
  if (req.compositionGraph) {
    const c = isCompositionComplete(req.compositionGraph);
    complete = c.complete;
    incompletenessReason = c.reason;
  }

  const genreCode = cfg.genreCode ?? undefined;
  // tier 已降级为品类的只读派生属性：有品类就以品类为准，客户端传来的 tier 只在
  // 「还没选专家」的预览态兜底（PRD v1.4 §3.2.2）。
  const tier = ((genreCode ? findGenreByCode(genreCode)?.tier : undefined) ??
    cfg.tier ??
    "tier1") as TierId;

  // 三轴综合出叙事结构，结论**与推导过程**一并写回 config 供提示词层与前端读取。
  // 类型/题材先按「直选优先、标签兜底」定下来再投票，与 /start 同口径。
  const userAxes = resolveUserAxes({
    storyType: cfg.storyType,
    storyTheme: cfg.storyTheme,
    tags: cfg.tags,
  });
  const structure = resolveNarrativeStructure({
    genreCode,
    storyType: userAxes.storyType,
    storyTheme: userAxes.storyTheme,
    explicit: cfg.narrativeStructure,
  });
  const pipelineTemplate = (cfg.pipelineTemplate ??
    (genreCode ? findGenreByCode(genreCode)?.pipelineTemplate : undefined)) as
    | PipelineTemplateId
    | undefined;

  // 自由编排：显式 requestedSteps 优先，其次由画布拓扑推导（有单品助手节点才算编排）。
  // 推导只在后端做，前端把结果原样带去 /entry/start，保证预览与实跑是同一条链。
  const composed =
    req.requestedSteps && req.requestedSteps.length > 0
      ? req.requestedSteps
      : req.compositionGraph
        ? compositionStepOrder(req.compositionGraph, { tier, genreCode })
        : undefined;

  let flatSteps: string[];
  let stepGroups: (string | string[])[];
  let resolvedTemplate: string;

  if (composed && composed.length > 0) {
    flatSteps = [...new Set(composed)];
    stepGroups = flatSteps;
    resolvedTemplate = "composition-driven";
  } else {
    const resolved = resolveStepGroups({
      mode: cfg.mode,
      tier,
      genreCode,
      pipelineTemplate,
    });
    stepGroups = resolved.stepGroups;
    flatSteps = stepGroups.flatMap((g) => (Array.isArray(g) ? g : [g]));
    resolvedTemplate = resolved.resolvedTemplate;
  }

  const agents = buildAgentSlots(flatSteps, pipelineId);

  const templateCode =
    cfg.pipelineTemplate ??
    (resolvedTemplate !== "needs-driven" &&
    resolvedTemplate !== "composition-driven"
      ? resolvedTemplate
      : pipelineTemplate) ??
    "needs-driven";

  return {
    pipelineId,
    entryKey,
    status: "planned",
    config: {
      ...cfg,
      tier,
      genreCode: genreCode ?? null,
      storyType: userAxes.storyType,
      storyTheme: userAxes.storyTheme,
      narrativeStructure: structure.structure,
      structureSource: structure.source,
      structureRationale: buildStructureRationale(structure, userAxes.derived),
      pipelineTemplate: templateCode,
      mode: (cfg.mode ?? null) as ModeId | null,
      locale: (cfg.locale ?? "zh") as ContentLocale,
    },
    compositionGraph: req.compositionGraph,
    stepSource: resolvedTemplate === "composition-driven" ? "composition" : "preset",
    agents,
    parallelGroups: parallelGroupsToIndex(stepGroups, flatSteps),
    // 已退役字段，固定写 "v1"（A3：pipeline/_archive/jrpg/README.md 第四节）。
    promptLibrary: "v1",
    complete,
    incompletenessReason,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 多管线：对每张 composition 子图各建一份 manifest。
 * 每条管线可有自己的 config（各自的 routing/expert 节点参数不同），
 * 由 configByStart 按开始节点覆盖 baseConfig。
 */
export function buildEntryManifests(
  entryKey: string,
  graphs: CompositionGraph[],
  baseConfig: RunManifestConfig,
  requestedStepsByStart?: Record<string, string[]>,
  configByStart?: Record<string, Partial<RunManifestConfig>>,
  hasUploadedScript?: boolean,
): RunManifest[] {
  return graphs.map((graph) =>
    buildRunManifest({
      entryKey,
      config: { ...baseConfig, ...(configByStart?.[graph.startNodeId] ?? {}) },
      compositionGraph: graph,
      requestedSteps: requestedStepsByStart?.[graph.startNodeId],
      hasUploadedScript,
    }),
  );
}
