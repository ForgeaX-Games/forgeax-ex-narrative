/**
 * 结构验证步骤（移植自 v3 StructureValidationAgent）
 *
 * 在 L1/L2 生成后运行，聚合所有结构检查：
 * 1. 连接推断验证（边存在性 + 入口节点 + 跨分支）
 * 2. 环路检测
 * 3. 分支-合并配对验证
 * 4. 悬挂分支修复
 * 5. NvN 路由修复
 * 6. 双向一致性修复
 *
 * 此步骤既做验证（报告问题）又做修复（尽可能自动修正），
 * 修复结果写回 ctx 对应的节点列表。
 */
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import {
  fullValidation,
  inferCrossParentConnections,
  repairIntraGroupConnections,
  fixDanglingBranches,
  fixNvNRouting,
  filterCrossBranchConnections,
  ensureBidirectionalConsistency,
  type ValidationReport,
} from "../../utils/connection-repair.js";

interface NodeLike {
  node_id: string;
  parent_id: string;
  prev_node: string[];
  next_node: string[];
  sequence_index?: number;
  is_branch?: boolean;
}

function runStructureValidation<T extends NodeLike>(
  nodes: T[],
  parentNodes: Array<{ node_id: string; next_node: string[] }>,
  layerLabel: string,
): { nodes: T[]; report: ValidationReport; fixLogs: string[] } {
  const preReport = fullValidation(nodes);

  let repaired = inferCrossParentConnections(nodes, parentNodes);
  repaired = repairIntraGroupConnections(repaired);
  const { nodes: fixed, logs: danglingLogs } = fixDanglingBranches(repaired, parentNodes);

  const afterNvN = fixNvNRouting(fixed);
  const afterFilter = filterCrossBranchConnections(afterNvN);
  const afterBidi = ensureBidirectionalConsistency(afterFilter);

  const postReport = fullValidation(afterBidi);

  const allLogs = [...danglingLogs];

  if (preReport.errors.length > 0 || preReport.warnings.length > 0) {
    console.warn(
      `[${layerLabel}] 结构验证 - 修复前: ${preReport.errors.length} 错误, ${preReport.warnings.length} 警告`,
    );
  }

  if (postReport.errors.length > 0) {
    console.warn(
      `[${layerLabel}] 结构验证 - 修复后仍有 ${postReport.errors.length} 错误:`,
      postReport.errors.slice(0, 5),
    );
  }

  if (danglingLogs.length > 0) {
    console.log(`[${layerLabel}] 悬挂分支修复: ${danglingLogs.length} 项`);
    for (const log of danglingLogs.slice(0, 10)) console.log(`  ${log}`);
  }

  if (postReport.warnings.length > 0) {
    console.warn(
      `[${layerLabel}] 结构警告 (${postReport.warnings.length}):`,
      postReport.warnings.slice(0, 5),
    );
  }

  return { nodes: afterBidi, report: postReport, fixLogs: allLogs };
}

/**
 * L1 结构验证（outline_batch 之后运行）
 */
export async function structureValidationL1(
  ctx: NarrativeContext,
  _llm: LLMClient,
): Promise<void> {
  const outlines = ctx.outlines_generated?.outlines;
  if (!outlines || outlines.length === 0) return;

  const frameworkNodes = (ctx.story_framework?.framework.nodes ?? []).map((n) => ({
    node_id: n.node_id,
    next_node: n.next_node ?? [],
  }));

  const { nodes: fixed, report, fixLogs } = runStructureValidation(
    outlines, frameworkNodes, "L1 验证",
  );

  ctx.outlines_generated = { outlines: fixed };

  (ctx as Record<string, unknown>).l1_validation = {
    errors: report.errors,
    warnings: report.warnings,
    cycles: report.cycles,
    branchMergeErrors: report.branchMergeErrors,
    fixLogs,
  };
}

/**
 * L2 结构验证（detailed_outline_batch 之后运行）
 */
export async function structureValidationL2(
  ctx: NarrativeContext,
  _llm: LLMClient,
): Promise<void> {
  const details = ctx.detailed_outlines_generated?.detailed_outlines;
  if (!details || details.length === 0) return;

  const outlineNodes = (ctx.outlines_generated?.outlines ?? []).map((o) => ({
    node_id: o.node_id,
    next_node: o.next_node,
  }));

  const { nodes: fixed, report, fixLogs } = runStructureValidation(
    details, outlineNodes, "L2 验证",
  );

  ctx.detailed_outlines_generated = { detailed_outlines: fixed };

  (ctx as Record<string, unknown>).l2_validation = {
    errors: report.errors,
    warnings: report.warnings,
    cycles: report.cycles,
    branchMergeErrors: report.branchMergeErrors,
    fixLogs,
  };
}

/**
 * L3 结构验证（plot_generation 之后运行）
 *
 * PlotNode 的 prev_node/next_node 由 LLM 生成，可能存在断连、环路等问题。
 * 以 L2 detailed_outlines 作为 parentNodes 进行跨层验证。
 */
export async function structureValidationL3(
  ctx: NarrativeContext,
  _llm?: LLMClient,
): Promise<void> {
  const plots = ctx.plots_generated?.plots;
  if (!plots || plots.length === 0) return;

  const detailedNodes = (ctx.detailed_outlines_generated?.detailed_outlines ?? []).map(
    (d) => ({ node_id: d.node_id, next_node: d.next_node }),
  );

  const { nodes: fixed, report, fixLogs } = runStructureValidation(
    plots, detailedNodes, "L3 验证",
  );

  ctx.plots_generated = { ...ctx.plots_generated!, plots: fixed };

  (ctx as Record<string, unknown>).l3_validation = {
    errors: report.errors,
    warnings: report.warnings,
    cycles: report.cycles,
    branchMergeErrors: report.branchMergeErrors,
    fixLogs,
  };
}
