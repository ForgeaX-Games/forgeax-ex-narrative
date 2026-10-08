/**
 * plot-tree-normalize.ts —— 剧情树的结构读数一律从连接算出来。
 *
 * 节点类型与拓扑计数都是**派生量**：一个节点是起点、分叉、汇点还是结局，答案完整地写在
 * 它的入边与出边里。`PlotNodeType` 的注释一直这么说（"由入度/出度推导"），但值由提取
 * 阶段的模型填，于是声明可以与图本身矛盾 —— 标着 `["normal"]` 的节点连了三条出边，标着
 * `["end"]` 的节点还有后继。
 *
 * 矛盾的代价不是多一个错字段，是同一个节点有两个功能位：提取侧的 `plotTreeToStructureSeat`
 * 读声明，生成侧的 `inferNodeFunction` 读拓扑。两边各自都"对"，合起来那棵树说不清自己
 * 长什么样。
 *
 * 所以这里派生覆盖声明，而不是比对后报错。**不记不一致**是有意的：能报给谁？模型的声明
 * 本来就不该当真值源，读者拿到修正后的树也没有额外动作可做，而后果（两个功能位）在覆盖
 * 的那一刻就没了。提取提示词也不再要 `nodeTypes`，省下的不只是 token —— 模型不声明，
 * 声明就无从与图矛盾。
 */
import { toEndingType } from "../types/narrative-ip-dna.js";
import type {
  PlotNodeType,
  PlotTree,
  PlotTreeNode,
  PlotTreeTopology,
  EndingType,
} from "../types/narrative-ip-dna.js";

/**
 * 从入出度派生节点类型（可多重）。
 *
 * 与生成侧的 `inferNodeFunction` 同源，差别只在这里给全部命中、那边按次序取一个：
 * 一个入度 3 出度 2 的节点既是汇点也是分叉，两件事都值得下游知道，而 `NodeFunction`
 * 是单值字段，只能取 branch（汇点性仍可从入度与 merge 边读出）。
 *
 * `normal` 只在其余都不成立时给，保证数组非空 —— 空数组会让 `includes` 型的读取点
 * 一律落空，那是"这个节点没有任何结构角色"的意思，而没有节点是那样。
 */
export function inferPlotNodeTypes(node: Pick<PlotTreeNode, "prevNodes" | "nextNodes">): PlotNodeType[] {
  const inDegree = node.prevNodes?.length ?? 0;
  const outDegree = node.nextNodes?.length ?? 0;
  const types: PlotNodeType[] = [];
  // 孤立节点（入出度皆零）会同时得到 start 与 end。那是个错误形状，但两个标签都是
  // 实话；连接检查会单独报它，这里不替它挑一个说法。
  if (outDegree === 0) types.push("end");
  if (inDegree === 0) types.push("start");
  if (outDegree > 1) types.push("pivot");
  if (inDegree > 1) types.push("merge");
  return types.length > 0 ? types : ["normal"];
}

/**
 * 按连接重算拓扑计数。
 *
 * 从前这件事只在多单元合并时做，且做了一半：节点集合用的是合并后的实际节点（那修掉了
 * "计数 58、节点 12"的断裂），但类型仍取模型的声明，所以 `pivotCount` 仍可能与图里真实
 * 的分叉数不符。单单元的树更直接 —— 计数原样取模型报的数。
 */
export function derivePlotTopology(
  nodes: readonly PlotTreeNode[],
  /**
   * 原有拓扑里**派生不出来的**部分，原样带过去。
   *
   * 目前只有 `shape`（原作的叙事结构形态）：它取生成侧那套 12 码，要读懂剧情才判得出，
   * 图里没有。计数全部重算、它原样保留，正是"派生量派生、非派生量不动"的分界。
   */
  keep?: Pick<PlotTreeTopology, "shape">,
): PlotTreeTopology {
  let startCount = 0, endCount = 0, pivotCount = 0, mergeCount = 0;
  const endingCountsByType: Partial<Record<EndingType, number>> = {};

  for (const n of nodes) {
    const types = inferPlotNodeTypes(n);
    if (types.includes("start")) startCount++;
    if (types.includes("pivot")) pivotCount++;
    if (types.includes("merge")) mergeCount++;
    if (types.includes("end")) {
      endCount++;
      // 经归一再计数：结局落点是模型给的（图里读不出来），但它的词汇可能是存量的
      // `open` 或 TAPD 稿的 `true`，直接当键会多出不属于三档的桶。
      const kind = toEndingType(n.endingType);
      endingCountsByType[kind] = (endingCountsByType[kind] ?? 0) + 1;
    }
  }

  return {
    nodeCount: nodes.length,
    startCount,
    endCount,
    pivotCount,
    mergeCount,
    ...(Object.keys(endingCountsByType).length > 0 ? { endingCountsByType } : {}),
    ...(keep?.shape ? { shape: keep.shape } : {}),
  };
}

/**
 * 把一棵树的结构读数全部换成派生值。
 *
 * 幂等：派生只看连接，连接没变，再归一多少次结果相同。所以可以在任何拿到树的地方调，
 * 不必追踪"这棵树归一过没有"。
 */
export function normalizePlotTree(tree: PlotTree): PlotTree {
  const nodes = tree.nodes.map((n) => ({ ...n, nodeTypes: inferPlotNodeTypes(n) }));
  return {
    ...tree,
    nodes,
    entryNodeId: tree.entryNodeId || nodes[0]?.id || "",
    topology: derivePlotTopology(nodes, tree.topology),
  };
}
