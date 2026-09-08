/**
 * structure-check.ts — 结构检查助手（席位 2.3.14）的独立席位实现
 *
 * ─────────────────────────────────────────────────────────────────
 * 与既有 structure-validation.ts 的分工
 * ─────────────────────────────────────────────────────────────────
 * structure-validation 是**生成步内部的后处理钩子**：L1/L2/L3 各自跑完立刻修连接、
 * 拆环、补悬挂分支，修完就把结果写回同一份产物。它是管线的一部分，用户看不见也叫不动。
 *
 * 本文件是**能被单独调用的席位**：跨层通读已生成的结构，出一份完整报告。
 * 覆盖席位表点名、但内联钩子一直没做的两项——结局节点设置与节奏设置。
 *
 * 所以两者不是重复：前者修，后者审。席位同时拥有两种实现（见 assistant-seats.ts）。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么是确定性 agent 而非 LLM
 * ─────────────────────────────────────────────────────────────────
 * 分支是否配对、结局是否可达、单元长度是否失衡，都是图上的事实，不需要也不应该让模型猜。
 * 内容层面的"好不好"归内容检查助手（2.3.15），那才需要模型。
 */
import type {
  BranchType,
  DetailedOutlineNode,
  NodeEdge,
  NodeFunction,
  NarrativeContext,
  OutlineNode,
  PlotNode,
  VnBranchedBeats,
} from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { fullValidation } from "../../utils/connection-repair.js";
import { checkNodeFunctions, type NodeFunctionIssue } from "../graph/node-function.js";
import { findingId, mergeFindingStatuses, type QaFinding, type RepairKind } from "../qa/findings.js";

// ════════════════════════════════════════════════════════
// 归一化图：各层节点形状不同，检查逻辑只认这一种
// ════════════════════════════════════════════════════════

interface CheckNode {
  id: string;
  /**
   * 分组键 = 所属**叙事单元**（大纲席切分的游戏体验单元）。
   * RPG 各层取 parent_id；归档影游产物取 act_id——新架构已不再有「幕」，
   * 但检查器仍要读得懂后端静默保留的旧产物。
   */
  group: string;
  prev: string[];
  next: string[];
  isBranch: boolean;
  isEnding: boolean;
  /** 结构席显式声明的功能位；存量产物没有此字段，届时全靠拓扑推断。 */
  declared?: NodeFunction;
  /** 带条件的出边。 */
  edges?: readonly NodeEdge[];
  /** 分支代价档。 */
  branchType?: BranchType;
  /** 结局达成条件。 */
  endingTrigger?: string;
  /** 结局作用域：local 是中途 game over，不该计入全剧终的数量上限。 */
  endingScope?: "local" | "global";
}

export type StructureLayer = "L1" | "L2" | "L3" | "VN";

export interface LayerCheckResult {
  layer: StructureLayer;
  label: string;
  nodeCount: number;
  /** 连接/环路/分支-合并（复用既有规则引擎）。 */
  errors: string[];
  warnings: string[];
  cycles: string[];
  branchMergeErrors: string[];
  /** 结局节点检查。 */
  endings: { count: number; nodeIds: string[]; issues: string[] };
  /** 节奏检查。 */
  pacing: { issues: string[]; groupSizes: Record<string, number>; branchRatio: number };
  /** 节点功能位与条件完整性（声明与拓扑是否相符、该给条件的是否给了）。 */
  functions: { issues: NodeFunctionIssue[] };
}

export interface StructureCheckReport {
  layers: LayerCheckResult[];
  /**
   * 全部问题的扁平清单，与内容检查席同形。
   *
   * `layers` 是给人读的分层明细，这里是给机器用的：每条带稳定 id 与修复路径，
   * 前端照它画勾选框、后端照它定位要改哪个节点。两者是同一批问题的两种视图——
   * `layers` 里的裸字符串没有 id、没有节点定位，勾不动也修不了。
   */
  findings: QaFinding[];
  /** fail = 有硬错误；warn = 只有警告或节奏问题；pass = 干净。 */
  verdict: "pass" | "warn" | "fail";
  summary: string;
  checkedAt: string;
}

/** 各层对应的 ctx 字段：拓扑修复要知道改哪一层。 */
const LAYER_TARGET_FIELD: Readonly<Record<StructureLayer, string>> = {
  L1: "outlines_generated",
  L2: "detailed_outlines_generated",
  L3: "plots_generated",
  VN: "vn_branched_beats",
};

/** 从 `<node_id>: ...` 或消息里出现的「节点 X / 结局 X / 分支 X」抽出节点号。 */
function nodeIdFromMessage(message: string): string {
  const prefixed = /^([\w.\-]+):\s/.exec(message);
  if (prefixed) return prefixed[1];
  const named = /(?:节点|结局|分支)\s*([\w.\-]+)/.exec(message);
  return named ? named[1] : "global";
}

/**
 * 结局问题的修法：走不到的结局是图上的事（补一条到达路径），
 * 「一个结局都没有」「全剧终太多」得作者自己定夺，不给自动修。
 */
function endingRepairKind(message: string): RepairKind | undefined {
  return message.includes("走不到") ? "topology" : undefined;
}

/**
 * 节奏问题的修法：断头路是图上的事，其余（单元长度失衡、分支密度）
 * 要靠增删节点来解决，那是重生成而非修复。
 */
function pacingRepairKind(message: string): RepairKind | undefined {
  return message.includes("断头路") ? "topology" : undefined;
}

/**
 * 功能位问题的修法：声明与拓扑不符、假分支、边与连接对不上都是图上的事；
 * 缺条件、缺分支代价档是要补文字，而定点重写改的是节点正文、够不着边上的字段，
 * 所以这两类暂不给自动修。
 */
function functionRepairKind(kind: NodeFunctionIssue["kind"]): RepairKind | undefined {
  return kind === "missing_condition" || kind === "missing_branch_type" ? undefined : "topology";
}

/** 把一层的检查结果摊成扁平 findings。 */
function layerFindings(layer: LayerCheckResult): QaFinding[] {
  const targetField = LAYER_TARGET_FIELD[layer.layer];
  const make = (
    criterion: string,
    severity: QaFinding["severity"],
    issue: string,
    repairKind: RepairKind | undefined,
    nodeId = nodeIdFromMessage(issue),
  ): QaFinding => ({
    id: findingId("structure", layer.layer, criterion, nodeId, issue),
    criterion: `${layer.label}·${criterion}`,
    nodeId,
    severity,
    issue,
    excerpt: `${layer.label}（${layer.nodeCount} 个节点）`,
    suggestion:
      repairKind === "topology"
        ? "可自动修复：按图规则补齐连接"
        : "需要回到对应席位调整结构后重生成",
    ...(repairKind ? { repairKind, targetField } : {}),
  });

  return [
    ...layer.errors.map((m) => make("连接完整性", "error", m, "topology")),
    ...layer.warnings.map((m) => make("连接完整性", "warn", m, "topology")),
    ...layer.cycles.map((m) => make("环路", "error", m, "topology")),
    ...layer.branchMergeErrors.map((m) => make("分支合并配对", "error", m, "topology")),
    ...layer.endings.issues.map((m) => make("结局设置", "warn", m, endingRepairKind(m))),
    ...layer.pacing.issues.map((m) => make("节奏设置", "warn", m, pacingRepairKind(m))),
    ...layer.functions.issues.map((i) =>
      make("节点功能位", "warn", i.message, functionRepairKind(i.kind), i.nodeId),
    ),
  ];
}

// ════════════════════════════════════════════════════════
// 阈值：都写成常量并给出理由，方便按品类调
// ════════════════════════════════════════════════════════

/** 叙事单元之间节点数的最大倍差。超过意味着某个单元被压缩或注水。 */
const MAX_GROUP_SIZE_RATIO = 3;
/** 判定"分支过密"的阈值：一半以上节点都在分叉，玩家会失去主线感。 */
const MAX_BRANCH_RATIO = 0.5;
/** 节点数达到这个量级还完全没有分支，才算"过于线性"（短篇线性是正常的）。 */
const LINEAR_SUSPICION_MIN_NODES = 8;
/** 结局数量上限；超过通常是把普通终点误当结局。 */
const MAX_ENDINGS = 8;

// ════════════════════════════════════════════════════════
// 适配器
// ════════════════════════════════════════════════════════

type RpgNode = OutlineNode | DetailedOutlineNode | PlotNode;

function fromRpgNodes(nodes: RpgNode[]): CheckNode[] {
  return nodes.map((n) => {
    const next = n.next_node ?? [];
    return {
      id: n.node_id,
      group: n.parent_id ?? "",
      prev: n.prev_node ?? [],
      next,
      isBranch: next.length > 1,
      // RPG 各层没有结局标记，终点即结局
      isEnding: next.length === 0,
      declared: "node_function" in n ? n.node_function : undefined,
      edges: "edges" in n ? n.edges : undefined,
      branchType: "branch_type" in n ? n.branch_type : undefined,
      endingTrigger: "ending" in n ? n.ending?.trigger : undefined,
      endingScope: "ending" in n ? n.ending?.scope : undefined,
    };
  });
}

/**
 * 影游剧情树的结局是独立于 beats 的一张表，beat 的 next_nodes 直接指向 ending_id。
 * 把结局也补成图上的终点节点，否则指向结局的边会被误判成断头路。
 */
function fromVnTree(tree: VnBranchedBeats): CheckNode[] {
  const beatNodes: CheckNode[] = tree.beats.map((b) => {
    const rawEdges = b.next_nodes ?? [];
    const next = rawEdges.map((e) => e.to);
    return {
      id: b.beat_id,
      group: b.act_id ?? "",
      prev: b.prev_nodes ?? [],
      next,
      isBranch: next.length > 1,
      isEnding: b.is_ending,
      /**
       * 影游的边原生就是「目标 + kind + label」，与通用 NodeEdge 同构，直接映射。
       * 这正是把这套形制升为通用层的回报：归档产物与新产物走同一批检查规则。
       * branch_qte 是已停用的互动形式，在通用层归入 choice。
       */
      edges: rawEdges.map((e) => ({
        to: e.to,
        kind: e.kind === "branch_qte" ? ("choice" as const) : e.kind,
        label: e.label,
        condition: e.label
          ? { type: "choice" as const, description: `选择 ${e.label}` }
          : undefined,
      })),
      branchType: b.branch_type,
    };
  });

  const referencedBy = new Map<string, string[]>();
  for (const b of beatNodes) {
    for (const nx of b.next) {
      referencedBy.set(nx, [...(referencedBy.get(nx) ?? []), b.id]);
    }
  }
  const beatIds = new Set(beatNodes.map((b) => b.id));
  const endingNodes: CheckNode[] = (tree.endings ?? [])
    .filter((e) => !beatIds.has(e.ending_id))
    .map((e) => ({
      id: e.ending_id,
      group: "",
      prev: referencedBy.get(e.ending_id) ?? [],
      next: [],
      isBranch: false,
      isEnding: true,
      endingTrigger: e.trigger,
      endingScope: e.scope ?? "global",
    }));

  return [...beatNodes, ...endingNodes];
}

// ════════════════════════════════════════════════════════
// 检查项
// ════════════════════════════════════════════════════════

/**
 * 结局节点：既要有，也要能走到，还不能满地都是。
 * 「可达」用正向可达集判断——挂在图外的结局等于没写。
 */
function checkEndings(nodes: CheckNode[]): LayerCheckResult["endings"] {
  const endings = nodes.filter((n) => n.isEnding);
  const issues: string[] = [];

  if (endings.length === 0) {
    issues.push("没有任何结局节点：所有节点都有后继，故事走不到头");
  } else {
    /**
     * 数量上限只管**全剧终**。局部结局（中途 game over、提前圆满）本就该多，
     * 一个允许失败的游戏会有一堆；不分档地一起数，只会把设计得当的树误判成注水。
     * 未标 scope 的存量数据按 global 计，与旧行为一致。
     */
    const global = endings.filter((e) => (e.endingScope ?? "global") === "global");
    if (global.length > MAX_ENDINGS) {
      issues.push(
        `全剧终结局 ${global.length} 个，超过 ${MAX_ENDINGS}：多半是把中途终点误标成了大结局` +
          `（中途 game over 应标 scope=local）`,
      );
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter((n) => n.prev.length === 0);
  const reachable = new Set<string>();
  const queue = roots.map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const nx of byId.get(id)?.next ?? []) queue.push(nx);
  }
  for (const e of endings) {
    if (!reachable.has(e.id)) issues.push(`结局 ${e.id} 从任何起点都走不到`);
  }

  return { count: endings.length, nodeIds: endings.map((e) => e.id), issues };
}

/**
 * 节奏：各叙事单元长度是否均衡、分支密度是否合理、分叉后多久才收束。
 * 全是图上可算的量，不掺内容判断。
 */
function checkPacing(nodes: CheckNode[]): LayerCheckResult["pacing"] {
  const issues: string[] = [];

  const groupSizes: Record<string, number> = {};
  for (const n of nodes) {
    if (!n.group) continue;
    groupSizes[n.group] = (groupSizes[n.group] ?? 0) + 1;
  }
  const sizes = Object.values(groupSizes);
  if (sizes.length > 1) {
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);
    if (min > 0 && max / min > MAX_GROUP_SIZE_RATIO) {
      const heaviest = Object.entries(groupSizes).find(([, v]) => v === max)?.[0];
      const lightest = Object.entries(groupSizes).find(([, v]) => v === min)?.[0];
      issues.push(
        `单元长度失衡：${heaviest} 有 ${max} 个节点、${lightest} 只有 ${min} 个，` +
          `倍差超过 ${MAX_GROUP_SIZE_RATIO}`,
      );
    }
  }

  const branchCount = nodes.filter((n) => n.isBranch).length;
  const branchRatio = nodes.length > 0 ? branchCount / nodes.length : 0;
  if (branchCount === 0 && nodes.length >= LINEAR_SUSPICION_MIN_NODES) {
    issues.push(`${nodes.length} 个节点无一分叉：结构完全线性，玩家没有选择`);
  } else if (branchRatio > MAX_BRANCH_RATIO) {
    issues.push(
      `分支密度 ${(branchRatio * 100).toFixed(0)}%：分叉过密，主线会被稀释`,
    );
  }

  // 分叉后迟迟不收束：从分支节点出发，找不到入度≥2 的汇聚点
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    for (const nx of n.next) inDegree.set(nx, (inDegree.get(nx) ?? 0) + 1);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const endingIds = new Set(nodes.filter((n) => n.isEnding).map((n) => n.id));
  for (const branch of nodes.filter((n) => n.isBranch)) {
    let converges = false;
    const seen = new Set<string>([branch.id]);
    const queue = [...branch.next];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if ((inDegree.get(id) ?? 0) > 1) {
        converges = true;
        break;
      }
      if (endingIds.has(id)) continue; // 直通结局属正常的 diverge 分支
      for (const nx of byId.get(id)?.next ?? []) queue.push(nx);
    }
    const allEndInEnding = branch.next.every((id) => {
      const seenLocal = new Set<string>();
      const q = [id];
      while (q.length > 0) {
        const cur = q.shift()!;
        if (seenLocal.has(cur)) continue;
        seenLocal.add(cur);
        if (endingIds.has(cur)) return true;
        for (const nx of byId.get(cur)?.next ?? []) q.push(nx);
      }
      return false;
    });
    if (!converges && !allEndInEnding) {
      issues.push(`分支 ${branch.id} 分叉后既不汇聚也不走向结局，是断头路`);
    }
  }

  return { issues, groupSizes, branchRatio };
}

function checkLayer(
  layer: StructureLayer,
  label: string,
  nodes: CheckNode[],
): LayerCheckResult {
  // 复用既有规则引擎做连接/环路/分支-合并检查（它认 NodeLike 形状）
  const report = fullValidation(
    nodes.map((n) => ({
      node_id: n.id,
      parent_id: n.group,
      prev_node: n.prev,
      next_node: n.next,
      is_branch: n.isBranch,
    })),
  );

  return {
    layer,
    label,
    nodeCount: nodes.length,
    errors: report.errors,
    warnings: report.warnings,
    cycles: report.cycles,
    branchMergeErrors: report.branchMergeErrors,
    endings: checkEndings(nodes),
    pacing: checkPacing(nodes),
    functions: { issues: checkNodeFunctions(nodes) },
  };
}

// ════════════════════════════════════════════════════════
// 席位入口
// ════════════════════════════════════════════════════════

/**
 * 通读 ctx 里已经存在的所有结构层，各出一份检查结果。
 * 不在的层直接跳过——同一个席位要同时服务 RPG 与影游两套管线。
 */
export function buildStructureCheckReport(ctx: NarrativeContext): StructureCheckReport {
  const layers: LayerCheckResult[] = [];

  const outlines = ctx.outlines_generated?.outlines;
  if (outlines?.length) layers.push(checkLayer("L1", "故事大纲", fromRpgNodes(outlines)));

  const details = ctx.detailed_outlines_generated?.detailed_outlines;
  if (details?.length) layers.push(checkLayer("L2", "故事细纲", fromRpgNodes(details)));

  const plots = ctx.plots_generated?.plots;
  if (plots?.length) layers.push(checkLayer("L3", "故事情节", fromRpgNodes(plots)));

  const tree = ctx.vn_branched_beats;
  if (tree?.beats?.length) layers.push(checkLayer("VN", "剧情树", fromVnTree(tree)));

  const errorCount = layers.reduce(
    (n, l) => n + l.errors.length + l.cycles.length + l.branchMergeErrors.length,
    0,
  );
  const warnCount = layers.reduce(
    (n, l) =>
      n +
      l.warnings.length +
      l.endings.issues.length +
      l.pacing.issues.length +
      l.functions.issues.length,
    0,
  );

  // 一层都没有时不能报 pass——那会让调用方以为结构没问题，其实是根本没结构
  const verdict: StructureCheckReport["verdict"] =
    errorCount > 0 ? "fail" : warnCount > 0 || layers.length === 0 ? "warn" : "pass";

  const summary =
    layers.length === 0
      ? "没有可检查的结构：故事结构助手还没产出任何一层"
      : `检查 ${layers.length} 层结构，硬错误 ${errorCount} 项、待关注 ${warnCount} 项`;

  return {
    layers,
    findings: layers.flatMap(layerFindings),
    verdict,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

/** 结构检查席位的通用实现（RPG 层级树管线）。 */
export async function structureCheck(
  ctx: NarrativeContext,
  _llm: LLMClient,
): Promise<void> {
  const report = buildStructureCheckReport(ctx);
  // M3：重跑这一席不能把用户已经处置过的 finding（fixed/dismissed）打回"待处理"——
  // 同一个 id 再出现就是同一处问题特征没变，处置结论继续有效。
  const priorFindings = (ctx as Record<string, unknown>).structure_check_report as
    | { findings?: QaFinding[] }
    | undefined;
  if (priorFindings?.findings?.length) {
    report.findings = mergeFindingStatuses(priorFindings.findings, report.findings);
  }
  (ctx as Record<string, unknown>).structure_check_report = report;
  console.log(`[结构检查] ${report.summary}`);
  for (const layer of report.layers) {
    const fnIssues = layer.functions.issues.map((i) => i.message);
    for (const issue of [...layer.endings.issues, ...layer.pacing.issues, ...fnIssues]) {
      console.warn(`[结构检查][${layer.label}] ${issue}`);
    }
  }
}
