/**
 * node-function.ts — 剧情树节点功能位的推断与校验
 *
 * 剧情树是所有品类共用的叙事原语：大纲定叙事单元，结构把每个单元展开成一棵树，
 * 情节填树上每个节点的内容。树的**形态**（线性 / 树状 / 碎片化 / 涌现 / 混合 /
 * 多线交织 / 多视角交织）由叙事策略的结构轴决定，但**功能位**的语义对所有形态恒定。
 *
 * 功能位既可由结构席显式声明，也可从拓扑推断。两者都保留是有意的：
 * - 推断保证存量产物（历史节点没有 node_function 字段）照样能被检查；
 * - 声明保证"这里是让玩家作答的地方"是结构席的主动决策，而不是恰好多了条出边。
 * 二者不一致时以声明为准并报告分歧——那通常意味着结构席想做分支但连接没接上。
 *
 * ─────────────────────────────────────────────────────────────────
 * 形制来源
 * ─────────────────────────────────────────────────────────────────
 * 条件挂在**边**上、聚合由 merge 边显式声明、分支带代价档、结局分 good/bad/neutral 与
 * local/global——这四样都不是新造的，是从归档影游实现（VnNextEdge / branch_type /
 * VnEnding）迁进来的已验证设计。归档那条管线整体被新架构替换，但这几件形制经判断
 * 是品类无关的叙事原语，值得升为通用层。
 */
import type { BranchType, NodeCondition, NodeEdge, NodeFunction } from "../../types/index.js";

/** 需要显式给出条件的功能位：凭什么分岔、凭什么汇回、凭什么算达成结局。 */
export const CONDITION_REQUIRED_FUNCTIONS: readonly NodeFunction[] = ["branch", "merge", "ending"];

/**
 * 从入出度推断功能位。
 *
 * 判定次序有讲究：先判结局（无后继），再判起始（无前驱）。孤立节点（既无前驱也无
 * 后继）会被判成 ending 而非 start——因为"写了个到不了的结局"比"写了个走不出的开头"
 * 常见得多，且两种情况都会被连接检查另行报错，此处不必纠结。
 */
export function inferNodeFunction(prev: readonly string[], next: readonly string[]): NodeFunction {
  if (next.length === 0) return "ending";
  if (prev.length === 0) return "start";
  if (next.length > 1) return "branch";
  if (prev.length > 1) return "merge";
  return "normal";
}

export interface NodeFunctionIssue {
  nodeId: string;
  kind: "mismatch" | "missing_condition" | "missing_branch_type" | "fake_branch" | "edge_mismatch";
  message: string;
}

export interface FunctionCheckInput {
  id: string;
  prev: readonly string[];
  next: readonly string[];
  declared?: NodeFunction;
  edges?: readonly NodeEdge[];
  branchType?: BranchType;
  /** 结局分档；有值即视为已交代达成条件。 */
  endingTrigger?: string;
}

const FUNCTION_LABEL: Readonly<Record<NodeFunction, string>> = {
  start: "起始",
  branch: "分支",
  merge: "聚合",
  ending: "结局",
  normal: "普通",
};

/** 收集指向本节点的边（用于校验聚合是否被 merge 边显式标出）。 */
function incomingEdges(
  nodes: readonly FunctionCheckInput[],
): Map<string, NodeEdge[]> {
  const map = new Map<string, NodeEdge[]>();
  for (const n of nodes) {
    for (const e of n.edges ?? []) {
      map.set(e.to, [...(map.get(e.to) ?? []), e]);
    }
  }
  return map;
}

function hasCondition(e: NodeEdge): boolean {
  return Boolean(e.condition?.description?.trim());
}

/**
 * 校验一层节点的功能位、条件完整性与分支质量。
 *
 * 全部判警告级：存量产物普遍没有 edges / branch_type / ending 这些字段，
 * 若判成硬错误会让所有历史项目一夜变红。
 */
export function checkNodeFunctions(nodes: readonly FunctionCheckInput[]): NodeFunctionIssue[] {
  const issues: NodeFunctionIssue[] = [];
  const incoming = incomingEdges(nodes);

  for (const n of nodes) {
    const inferred = inferNodeFunction(n.prev, n.next);
    const effective = n.declared ?? inferred;
    const label = FUNCTION_LABEL[effective];

    if (n.declared && n.declared !== inferred) {
      issues.push({
        nodeId: n.id,
        kind: "mismatch",
        message:
          `节点 ${n.id} 声明为「${label}」，但拓扑看是「${FUNCTION_LABEL[inferred]}」` +
          `（入度 ${n.prev.length} / 出度 ${n.next.length}）——多半是连接没接上`,
      });
    }

    // edges 与 next_node 必须指向同一批目标，否则下游读哪个都不对
    if (n.edges?.length) {
      const viaEdges = [...n.edges].map((e) => e.to).sort().join(",");
      const viaNext = [...n.next].sort().join(",");
      if (viaEdges !== viaNext) {
        issues.push({
          nodeId: n.id,
          kind: "edge_mismatch",
          message: `节点 ${n.id} 的 edges 目标（${viaEdges || "空"}）与 next_node（${viaNext || "空"}）不一致`,
        });
      }
    }

    switch (effective) {
      case "branch": {
        // 分支的每条出边都要有自己的条件——挂在边上才说得清"哪个选择通向哪里"
        const uncond = (n.edges ?? []).filter((e) => !hasCondition(e));
        if (!n.edges?.length) {
          issues.push({
            nodeId: n.id,
            kind: "missing_condition",
            message: `分支节点 ${n.id} 未给出带条件的出边，下游情节与任务层无从具体化`,
          });
        } else if (uncond.length > 0) {
          issues.push({
            nodeId: n.id,
            kind: "missing_condition",
            message: `分支节点 ${n.id} 有 ${uncond.length} 条出边没写条件（指向 ${uncond.map((e) => e.to).join("、")}）`,
          });
        }
        if (!n.branchType) {
          issues.push({
            nodeId: n.id,
            kind: "missing_branch_type",
            message: `分支节点 ${n.id} 未给代价档（converge / diverge / terminal），无从判断这处分岔的后果量级`,
          });
        }
        // 假分支：几条边指向同一个目标，玩家的选择没有产生任何差异
        const targets = new Set((n.edges ?? []).map((e) => e.to));
        if (n.edges && n.edges.length > 1 && targets.size === 1) {
          issues.push({
            nodeId: n.id,
            kind: "fake_branch",
            message: `分支节点 ${n.id} 的所有出边都指向 ${[...targets][0]}：选择没有产生差异，是假分支`,
          });
        }
        break;
      }
      case "merge": {
        // 聚合应由上游的 merge 边显式标出，而不是靠入度大于一被事后推断
        const ins = incoming.get(n.id) ?? [];
        if (ins.length > 0 && !ins.some((e) => e.kind === "merge")) {
          issues.push({
            nodeId: n.id,
            kind: "missing_condition",
            message: `聚合节点 ${n.id} 的入边无一标为 merge：各分支凭什么汇回没有交代`,
          });
        }
        break;
      }
      case "ending": {
        if (!n.endingTrigger?.trim()) {
          issues.push({
            nodeId: n.id,
            kind: "missing_condition",
            message: `结局节点 ${n.id} 未给出达成条件`,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return issues;
}
