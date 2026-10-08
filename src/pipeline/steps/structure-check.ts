/**
 * structure-check.ts — 结构检查助手（席位 2.5.15）的独立席位实现
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
 * 内容层面的"好不好"归内容检查助手（2.5.16），那才需要模型。
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
import { toEdgeKind } from "../../types/index.js";
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
  /** 契约硬规则（编号律、场号同步律、假分支、糖葫芦串）。 */
  contract: { issues: string[] };
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
    /**
     * 契约规则记 error，不是 warn。
     *
     * 其余几组问的是「这棵树好不好」，答案可以见仁见智，所以报警告让人判断。这组问的是
     * 「它还算不算一棵合格的树」——编号乱序、假分支、糖葫芦串都不是风格选择，是缺陷。
     * 记成警告的后果是它跟一堆"可以这样也可以那样"的提示混在一起，而它恰恰是那个必须动手的。
     */
    ...layer.contract.issues.map((m) => make("契约规则", "error", m, "topology")),
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
       * 影游的边原生就是「目标 + kind + label」，与通用 NodeEdge 同构，只需把词
       * 换成契约三值。这正是把这套形制升为通用层的回报：归档产物与新产物走同一批
       * 检查规则。
       */
      edges: rawEdges.map((e) => ({
        to: e.to,
        kind: toEdgeKind(e.kind),
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

/**
 * 契约硬规则 —— 这棵树符不符合「树」的形制规定。
 *
 * 与另两组检查问的是不同的问题：`checkEndings` 问结局设置对不对、`checkPacing` 问节奏匀
 * 不匀，两者都还承认这是一棵合格的树。这里问的是它算不算一棵合格的树。
 *
 * 规则来自 §4.3 的编号律与外部提示词三版演进的踩坑史。**光靠提示词约束不够**是这组存在
 * 的全部理由：提示词第三版拿了近半篇幅讲「分叉后不要一跳就合流」，说明那是模型的默认失败
 * 模式 —— 反复叮嘱仍会犯的事，得有机械检查兜底。
 */
function checkContract(nodes: CheckNode[]): LayerCheckResult["contract"] {
  const issues: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // ── 编号律：id 按 DFS 序单调递增（§4.3）。乱序的树没法靠 id 判先后，
  //    而下游的人工排查、日志对照、断点续跑都在靠 id 认位置。
  const ordinals = nodes.map((n) => parseOrdinal(n.id));
  if (ordinals.every((o) => o !== undefined)) {
    // 只在**全部** id 都解析得出时才比：混着两种格式时比出来的先后没有意义，
    // 而误报会把一份干净的报告判成 warn，让真问题淹在噪声里。
    for (let i = 1; i < nodes.length; i++) {
      if (compareOrdinal(ordinals[i]!, ordinals[i - 1]!) <= 0) {
        issues.push(`节点编号未按 DFS 序递增：${nodes[i - 1]!.id} 之后是 ${nodes[i]!.id}`);
        break; // 一条就够：乱序通常是整段乱，逐个报只是把同一件事说 n 遍
      }
    }
  }

  // ── 场号同步律：同一叙事单元的节点必须连续。分散成几段意味着 id 的场号与实际
  //    归属对不上，而「场号 = id 前缀」是编号律的另一半。
  const seenGroups = new Set<string>();
  let lastGroup: string | undefined;
  for (const n of nodes) {
    if (!n.group) continue;
    if (n.group !== lastGroup) {
      if (seenGroups.has(n.group)) {
        issues.push(`叙事单元 ${n.group} 的节点不连续：在 ${n.id} 处又出现一段`);
        break;
      }
      seenGroups.add(n.group);
      lastGroup = n.group;
    }
  }

  for (const n of nodes) {
    // ── 声明了结局却有出边。结局是「走到这里故事结束」，有后继就不是结局。
    //    这条查的是声明与拓扑的矛盾：RPG 各层的 isEnding 由出度派生，恒不矛盾，
    //    而 ending 字段（trigger / scope）是结构席显式给的，能与出边并存。
    if ((n.endingTrigger !== undefined || n.endingScope !== undefined) && n.next.length > 0) {
      issues.push(`节点 ${n.id} 标了结局（达成条件/作用域），却还有 ${n.next.length} 条出边`);
    }

    if (!n.isBranch) continue;

    // ── 第一跳不可共用。几条边指向同一个目标是假分支：玩家选了，什么也没改变。
    const targets = new Set(n.next);
    if (targets.size < n.next.length) {
      issues.push(`分支 ${n.id} 有多条出边指向同一节点：玩家选了但什么也没改变，是假分支`);
    }

  }

  // ── 糖葫芦串：全树没有一个选择的影响能持续过一跳。
  //
  //    病态是**全树性质**，不是单点的。单个「分叉 → 各支一个节点 → 合并点」的菱形恰恰
  //    是 `converge` 代价档的正常形态（路径不同、结果相同），`buildSkeleton` 的 shouldMerge
  //    分支自己就生成这个形状。一处菱形报缺陷，等于把系统的标准骨架判成缺陷。
  //
  //    成「串」才是病：每一处分叉都在下一跳合流，于是玩家的任何决定都在一跳内被抹平，
  //    整棵树是 ●-<>-●-<>-● 穿在一根签子上，宽度恒为二、深度上毫无分歧。所以判据是
  //    「分叉不止一处，且无一例外」—— 只要有一处分支撑过两跳，树就有真正的分歧承载。
  //
  //    它与 `checkPacing` 的断头路检查正好相反：那边查收束得太晚，这边查收束得太早。
  const branches = nodes.filter((n) => n.isBranch);
  const oneHopMerges = branches.filter((n) => oneHopMergeTarget(n, byId) !== undefined);
  if (branches.length >= 2 && oneHopMerges.length === branches.length) {
    issues.push(
      `${branches.length} 处分叉全部在一跳内合流（${oneHopMerges
        .map((n) => n.id)
        .join("、")}）：没有一个选择的影响能持续过一跳，整棵树是糖葫芦串`,
    );
  }

  return { issues };
}

/**
 * 这处分叉是不是「各支走一个节点就全汇到同一处」；是就返回那个汇合点。
 *
 * 直通结局的支不算 —— 那是 `terminal` 代价档（选错就完），它本来就不该汇回。
 */
function oneHopMergeTarget(
  branch: CheckNode,
  byId: Map<string, CheckNode>,
): string | undefined {
  const hops = [...new Set(branch.next)]
    .map((id) => byId.get(id))
    .filter((t): t is CheckNode => !!t);
  if (hops.length < 2 || !hops.every((t) => !t.isEnding && t.next.length === 1)) return undefined;
  const landings = new Set(hops.map((t) => t.next[0]!));
  return landings.size === 1 ? [...landings][0] : undefined;
}

/**
 * 把 `1_2` / `1.2` / `2_3_1` 这类层级编号解析成数值序。
 *
 * 解析不出来就给 undefined，由调用方决定跳过 —— 各层的 id 格式不统一（L1 是
 * `场号_序号`，别处还有带前缀的），拿解析失败当错误报会把格式差异误判成乱序。
 */
function parseOrdinal(id: string): number[] | undefined {
  const parts = id.split(/[._]/);
  const nums = parts.map((p) => Number(p));
  if (parts.length === 0 || nums.some((n) => !Number.isFinite(n))) return undefined;
  return nums;
}

/** 层级编号的字典序比较：先比场号，同场比场内序号。 */
function compareOrdinal(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
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
    contract: checkContract(nodes),
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

  /**
   * 判定从 findings 算，不再手工枚举各分组。
   *
   * `layerFindings` 已经是每组严重性的唯一声明处；这里从前另外枚举一遍哪些组算硬错误、
   * 哪些算警告，于是同一件事在两处各说一次。加一组检查要同时改两处，漏掉计数那处的后果
   * 很安静：finding 老老实实标着 error，`verdict` 却仍是 warn —— 上游按 verdict 放行时
   * 就把它放过去了。本轮加契约规则时正好撞上这一下。
   */
  const findings = layers.flatMap(layerFindings);
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;

  // 一层都没有时不能报 pass——那会让调用方以为结构没问题，其实是根本没结构
  const verdict: StructureCheckReport["verdict"] =
    errorCount > 0 ? "fail" : warnCount > 0 || layers.length === 0 ? "warn" : "pass";

  const summary =
    layers.length === 0
      ? "没有可检查的结构：故事结构助手还没产出任何一层"
      : `检查 ${layers.length} 层结构，硬错误 ${errorCount} 项、待关注 ${warnCount} 项`;

  return {
    layers,
    findings,
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
