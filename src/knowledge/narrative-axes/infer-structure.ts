/**
 * 从一棵已知的剧情树的拓扑数字，反推它是 12 种结构里的哪一种。
 *
 * ## 为什么需要反推
 *
 * 结构轴平时是**投票选**出来的（品类/类型/题材三轴各出意见）。IP 改编不一样：原作的
 * 结构是既成事实，摆在提炼出来的 plot_tree 里——七次循环顺序推进就是七个首尾相连的
 * 节点，一个分叉都没有。这时再去投票，等于对着一份已知答案重新猜。
 *
 * 缺了这一步的后果在真实跑里看得见：一部八段线性的原作，改编出来是一棵带分叉与合流的
 * 树。原因不是哪段代码写错了，是**没有任何地方把原作的形状接到生成侧的结构轴上**
 * ——提炼把 topology 存下来了，生成侧从不读它，于是按缺省结构参数长树。
 *
 * ## 为什么宁可返回 null
 *
 * 数字分不清的情况是存在的：一条"分了必回、单结局"的主干，既可能是鱼骨，也可能是
 * 环形（时间循环在图上常常也是首尾相连的一条线）。这种时候返回 null，让上游保留它
 * 原本的判断，比硬给一个五五开的结论强——猜错的结构会去调制分支率，代价比不猜大。
 */
import type { StoryStructureCode } from "./story-structures.js";

/** 反推所需的拓扑数字，字段名与 IP DNA 的 `story_structure.topology` 对齐。 */
export interface TopologyCounts {
  nodeCount?: number;
  startCount?: number;
  endCount?: number;
  /** 分叉点数量（出度 > 1 的节点）。 */
  pivotCount?: number;
  /** 合流点数量（入度 > 1 的节点）。 */
  mergeCount?: number;
}

export function inferStructureFromTopology(
  topology: TopologyCounts | undefined | null,
): StoryStructureCode | null {
  if (!topology) return null;
  const nodes = topology.nodeCount ?? 0;
  // 两三个节点的树什么形状都谈不上，别从噪声里读出结构来。
  if (nodes < 4) return null;

  const starts = topology.startCount ?? 1;
  const ends = topology.endCount ?? 1;
  const pivots = topology.pivotCount ?? 0;
  const merges = topology.mergeCount ?? 0;

  // 多个起点各走各的：这是多线并行的定义，与后面分不分叉无关，所以先判。
  if (starts > 1) return "multiline";

  if (pivots === 0) {
    // 一条道走到黑。单结局是线性；多结局而不分叉在图上讲不通，交回去别猜。
    return ends <= 1 ? "linear" : null;
  }

  // 分了不回头 + 多结局 = 纯树状。
  if (merges === 0 && ends > 1) return "tree";

  // 分了必回 + 结局收敛 = 鱼骨。环形在数字上与它同形，分不开，所以只在
  // 分叉够多（不是偶然一处）时才认，且把结论限定在这条判据能支撑的范围内。
  if (merges >= pivots && ends <= 2 && pivots >= 2) return "fishbone";

  return null;
}
