/**
 * plot-tree-to-structure.ts — 原作剧情树 → 结构席骨架（L0 / L1 / L2）
 *
 * 设计已定「树在结构层成形，情节层只填内容」（seat-spec.ts），structure 席 =
 * outline_batch + detailed_outline = L1+L2。改编要保真，就得让原作的树直接成为
 * 结构席的产出，而不是让 L1/L2 各自 1:N 重新规划一遍。
 *
 * ─────────────────────────────────────────────────────────────────
 * 三层怎么对上：场是 L0，最小叙事单元是 L1
 * ─────────────────────────────────────────────────────────────────
 * PlotTree 是一张扁平的图，`sceneId` 是它自带的唯一分层信号（id 形如
 * `<场号>.<场内序号>`）。量级也只有一种对法：`MIN_PLOT_TREE_NODES` 是 25，而 L0
 * 预算最宽的史诗档上限是 15 —— 把每个最小叙事单元当成一个 L0 章节，光 L0 就超预算
 * 两三倍，体量档位随即失效。按场聚合后 L0 落在 5-10，正好是 L0 该有的量级。
 *
 * 所以：场 → L0，最小叙事单元 → L1，L2 1:1 跟随 L1。
 *
 * L1→L2 在常规生成里是 1:N，这里是 1:1 —— 原作的最小叙事单元已经是最细的粒度，
 * 再展开一层就是替原作加戏。L2→L3 本来就是 1:1 同 id，一路对齐。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么不沿用原作的 id
 * ─────────────────────────────────────────────────────────────────
 * 原作 id 允许带字母（`1.1b`）。而下游 `connection-repair.ts` 的
 * `extractFullBranchPath` 按 `<数字><字母>` 的形状从 id 里读"分支路径"，`1_1b` 会
 * 被读成"在分支 b 上"，于是 `areBranchesCompatible` 判它与 `1_2a` 不兼容，修复链
 * 就把原作真实存在的边删掉了。生成侧 id 一律用纯数字段，原作 id 另存 `sourceIds`
 * 供追溯。
 */
import type {
  PlotTree,
  PlotTreeNode,
  PlotTreeEdge,
  EndingType,
  EndingPosition,
} from "../types/narrative-ip-dna.js";
import { toEndingType } from "../types/narrative-ip-dna.js";
import type {
  StoryFramework,
  FrameworkNode,
  OutlineNode,
  DetailedOutlineNode,
  NodeEdge,
  NodeFunction,
  EndingSpec,
  BranchType,
  NodeCondition,
  StructureSeatSeed,
} from "../types/index.js";
import { inferNodeFunction } from "../pipeline/graph/node-function.js";

/** 场：一组同 sceneId 的最小叙事单元，按原作次序排列。 */
interface Scene {
  /** L0 的 node_id。 */
  id: string;
  sourceSceneId: string;
  nodes: PlotTreeNode[];
}

/** 纯数字的 sceneId 直接用作 L0 id；否则退回场序号，保证 id 段一定合法。 */
function groupIntoScenes(tree: PlotTree): Scene[] {
  const order: string[] = [];
  const byScene = new Map<string, PlotTreeNode[]>();
  for (const n of tree.nodes) {
    const key = n.sceneId ?? "";
    if (!byScene.has(key)) {
      byScene.set(key, []);
      order.push(key);
    }
    byScene.get(key)!.push(n);
  }
  // 场号是纯数字时按数值排，否则保持原作出现次序（id 是 DFS 单调递增的）。
  const allNumeric = order.every((k) => /^\d+$/.test(k));
  const sorted = allNumeric ? [...order].sort((a, b) => Number(a) - Number(b)) : order;
  return sorted.map((key, i) => ({
    id: allNumeric ? key : String(i + 1),
    sourceSceneId: key,
    nodes: byScene.get(key)!,
  }));
}

/** 中途结局与全剧终是两回事：不分档，一个允许失败的游戏会因"结局太多"被误判。 */
function endingScopeOf(pos: EndingPosition | undefined): EndingSpec["scope"] {
  return pos === "final" ? "global" : "local";
}

/**
 * 分支代价档的局部判断：只看这个分叉的直接下游。
 * 分支最终是否收束要看整条下游链，那要等 structure_check 的全图规则；这里给出
 * 有依据的近似，比留空让 `missing_branch_type` 报错更有用。
 */
function branchTypeOf(node: PlotTreeNode, byId: Map<string, PlotTreeNode>): BranchType {
  const targets = node.nextNodes.map((e) => byId.get(e.to)).filter((n): n is PlotTreeNode => !!n);
  // 读度数而不读 nodeTypes：结局是"没有后继"，汇点是"有多个前驱"，两件事图里都写着。
  if (targets.some((t) => t.nextNodes.length === 0)) return "terminal";
  if (node.nextNodes.some((e) => e.event === "merge") || targets.some((t) => t.prevNodes.length > 1))
    return "converge";
  return "diverge";
}

/**
 * 出边条件。
 *
 * 原作可以同时给两件事：选项文案（"原地呼救"，玩家做了什么）和边上的条件
 * （"持有信号枪"，要满足什么前提）。`NodeCondition` 是单条件模型，只有一个
 * `description` 和一个 `type`，所以两者都在时必须合并 —— 只取其一，下游情节层与
 * 任务层就少掉一个约束，而这正是"原作结构被洗掉"的一种细粒度形态。
 *
 * 无条件的 linear 边不造条件：那等于替原作编一个它没说的理由。
 */
function conditionOf(node: PlotTreeNode, edge: PlotTreeEdge): NodeCondition | undefined {
  const option = node.options?.find((o) => o.leadsTo === edge.to);
  const said = [option?.text || option?.label, edge.condition].filter(Boolean) as string[];
  if (said.length === 0) {
    if (edge.event === "choose" && node.question) {
      return { type: "choice", description: node.question };
    }
    return undefined;
  }
  return {
    type: option || edge.event === "choose" ? "choice" : "always",
    description: said.join("；"),
    ...(option?.cost ? { cost: option.cost } : {}),
  };
}

/**
 * 原作剧情树 → 结构席的 L1+L2 骨架。
 *
 * 保全清单（这些字段一旦在映射里丢掉，原作的结构就等于没带过来）：
 * `sceneId` 成为 L0 身份与 L1 的 parent_id；`question`/`options` 成为出边上的
 * 选择条件；`endingType`/`endingPosition` 成为 `ending` 分档；`isMainLine` 成为
 * `on_optimal_path`；边上的 `event`/`condition` 成为 `edges[].kind`/`condition`。
 */
export function plotTreeToStructureSeat(tree: PlotTree): StructureSeatSeed {
  const scenes = groupIntoScenes(tree);
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));

  // 先把全图的 id 映射建好：边可以跨场，映射目标必须先全部就位。
  const l1IdOf = new Map<string, string>();
  for (const scene of scenes) {
    scene.nodes.forEach((n, i) => l1IdOf.set(n.id, `${scene.id}_${i + 1}`));
  }

  const sourceIds: Record<string, string> = {};
  const outlines: OutlineNode[] = [];

  for (const scene of scenes) {
    for (const node of scene.nodes) {
      const id = l1IdOf.get(node.id)!;
      sourceIds[id] = node.id;

      const nextEdges: NodeEdge[] = node.nextNodes
        .filter((e) => l1IdOf.has(e.to))
        .map((e) => {
          const condition = conditionOf(node, e);
          return {
            to: l1IdOf.get(e.to)!,
            // 提取侧与生成侧现在是同一套词，不再需要一层翻译。
            kind: e.event,
            label: e.label ?? node.options?.find((o) => o.leadsTo === e.to)?.label,
            ...(condition ? { condition } : {}),
          };
        });

      // 功能位与生成侧同一个函数算：两份实现靠注释维持同序，而它们读的还不是
      // 同一个来源（那边读拓扑、这边读声明），声明与图一矛盾就是两个功能位。
      const fn = inferNodeFunction(node.prevNodes, node.nextNodes.map((e) => e.to));
      const out: OutlineNode = {
        node_id: id,
        parent_id: scene.id,
        name: node.title ?? id,
        narrative_stage: "",
        prev_node: node.prevNodes.filter((p) => l1IdOf.has(p)).map((p) => l1IdOf.get(p)!),
        next_node: nextEdges.map((e) => e.to),
        // 正文与因果链留空：结构席只定树，内容由填充生成。
        story_elements: { plot: { cause: "", process: "", result: "" } },
        content: "",
        node_function: fn,
        ...(nextEdges.length > 0 ? { edges: nextEdges } : {}),
        ...(node.isMainLine ? { on_optimal_path: true } : {}),
        ...(fn === "branch" ? { branch_type: branchTypeOf(node, byId) } : {}),
        ...(fn === "ending"
          ? {
              ending: {
                kind: toEndingType(node.endingType),
                scope: endingScopeOf(node.endingPosition),
                // 达成条件取入边上说过的话；原作没说就不编。
                ...(incomingTrigger(node, byId) ? { trigger: incomingTrigger(node, byId) } : {}),
              } satisfies EndingSpec,
            }
          : {}),
      };
      outlines.push(out);
    }
  }

  // L2 与 L1 一一对应：拓扑照抄，只换 id 与父指针。hint 类字段留空由内容填充补。
  const detailedOutlines: DetailedOutlineNode[] = outlines.map((o) => ({
    ...o,
    node_id: `${o.node_id}_1`,
    parent_id: o.node_id,
    prev_node: o.prev_node.map((p) => `${p}_1`),
    next_node: o.next_node.map((n) => `${n}_1`),
    ...(o.edges ? { edges: o.edges.map((e) => ({ ...e, to: `${e.to}_1` })) } : {}),
  }));
  for (const d of detailedOutlines) {
    sourceIds[d.node_id] = sourceIds[d.parent_id]!;
  }

  return { outlines, detailedOutlines, sourceIds };
}

/**
 * 结局的达成条件：取入边上原作说过的话。
 *
 * 走 `conditionOf` 同一条判定，不另写一套优先级 —— 两套优先级会让"同一条边"在
 * 出边条件里和结局条件里读出不同的内容。多条入边则合并（多个走法都能到这个结局）。
 */
function incomingTrigger(node: PlotTreeNode, byId: Map<string, PlotTreeNode>): string | undefined {
  const said: string[] = [];
  for (const p of node.prevNodes) {
    const parent = byId.get(p);
    const edge = parent?.nextNodes.find((e) => e.to === node.id);
    if (!parent || !edge) continue;
    const text = conditionOf(parent, edge)?.description;
    if (text && !said.includes(text)) said.push(text);
  }
  return said.length > 0 ? said.join("；") : undefined;
}

/**
 * 原作剧情树 → L0 框架（按场聚合）。
 *
 * 从前这里是每个最小叙事单元一个 L0 章节，于是 25 个节点的原作会得到 25 章的 L0，
 * 而 L0 预算最宽也只有 15 —— 体量档位当场失效，L0 的填充提示词也被撑爆。场才是
 * L0 该有的粒度。
 */
export function plotTreeToStoryFramework(tree: PlotTree): StoryFramework {
  const scenes = groupIntoScenes(tree);
  const sceneIdOfNode = new Map<string, string>();
  for (const scene of scenes) {
    for (const n of scene.nodes) sceneIdOfNode.set(n.id, scene.id);
  }

  const nodes: FrameworkNode[] = scenes.map((scene, i) => {
    // 场间连接由跨场的节点边推导：场内的边不构成场级拓扑。
    const next = new Set<string>();
    const prev = new Set<string>();
    for (const n of scene.nodes) {
      for (const e of n.nextNodes) {
        const target = sceneIdOfNode.get(e.to);
        if (target && target !== scene.id) next.add(target);
      }
      for (const p of n.prevNodes) {
        const source = sceneIdOfNode.get(p);
        if (source && source !== scene.id) prev.add(source);
      }
    }
    return {
      node_id: scene.id,
      name: scene.nodes[0]?.title ?? `第 ${scene.id} 场`,
      narrative_function: scene.nodes.some((n) => n.nextNodes.length > 1) ? "pivot" : "normal",
      main_content: "",
      // 场里有分叉，这一章就是分叉章：L0 的 is_branch 决定 seeded 模式记
      // branching 还是 linear，判错会让原作的分叉在 L0 就被抹平。
      is_branch: scene.nodes.some((n) => n.nextNodes.length > 1) || undefined,
      prev_node: [...prev],
      next_node: [...next],
      sequence_index: i,
    };
  });

  return { framework: { nodes } };
}
