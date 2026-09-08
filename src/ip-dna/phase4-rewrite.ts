/**
 * Phase 4 · 三视角投影（后端契约）+ 改写影响面 —— 蓝图 §9.3 / §10 / §15。
 *
 * 后端职责（交互侧不动，此处仅备接口）：
 *   ① 改写影响面：定点改动 → 沿 data-atlas 推导受影响下游 + 受影响层级节点（扩展到输入资产全链路）；
 *   ② 三视角投影：同一份"三视角同台"产物对外提供"按视角切片展示"的只读投影（投影展示，非重生成，§9.3）。
 */

import type { NarrativeIpDna, HierarchyNode, OperatorSlot, OperatorPerspective } from "../types/narrative-ip-dna.js";
import { computeImpactSet, computeUpstreamSet, ATLAS_INDEX } from "./data-atlas.js";

// ─────────────────────────────────────────────────────────────────
// 改写影响面
// ─────────────────────────────────────────────────────────────────

export interface RewriteImpact {
  /** 直接改动的字段 key。 */
  changed: string[];
  /** 受影响的下游产物 key（沿 atlas downstream 链，需重生成）。 */
  affectedDownstream: string[];
  /** 改动字段的全部上游来源 key（溯源/取证）。 */
  upstreamSources: string[];
  /** 受影响的输入侧层级节点 id（输入资产全链路）。 */
  affectedInputNodes: string[];
  /** 人类可读的影响说明。 */
  notes: string[];
}

/**
 * 分析一次改写的影响面。
 * @param changedKeys 改动的 atlas 字段 key（如 ["A.characters"]）
 * @param dna 可选：输入侧 IP DNA，用于把字段影响落到具体层级节点
 */
export function analyzeRewriteImpact(changedKeys: string[], dna?: NarrativeIpDna): RewriteImpact {
  const affectedDownstream = computeImpactSet(changedKeys);
  const upstreamSources = changedKeys.flatMap((k) => computeUpstreamSet(k));

  const notes: string[] = [];
  for (const k of changedKeys) {
    const entry = ATLAS_INDEX.get(k);
    if (entry) notes.push(`改动「${entry.role}」→ 影响 ${entry.downstream.join(", ") || "（无下游）"}`);
  }

  // 输入资产全链路（字段→节点级反向追溯，§15）：A 套字段的改动只牵动"该 template 字段实际承载内容
  // 且已改编/已生成"的层级节点，而非粗标全部已改编节点（避免无关节点被误标脏触发重算）。
  const changedAKeys = changedKeys.filter((k) => k.startsWith("A."));
  const affectedInputNodes: string[] = [];
  if (dna && changedAKeys.length > 0) {
    for (const node of Object.values(dna.nodes)) {
      const status = node.metadata?.adaptation_status;
      if (status !== "已改编" && status !== "已生成") continue;
      if (changedAKeys.some((k) => nodeCarriesAtlasField(node, k))) {
        affectedInputNodes.push(node.id);
      }
    }
  }

  return {
    changed: changedKeys,
    affectedDownstream,
    upstreamSources: [...new Set(upstreamSources)],
    affectedInputNodes,
    notes,
  };
}

/**
 * 字段→节点反向追溯断言（§15）：判断某层级节点的 template 是否实际承载给定 A.* 图谱字段的内容。
 * 仅当承载（非空）时，该字段的改动才会牵动此节点。未知 key 保守返回 true（不漏标）。
 */
export function nodeCarriesAtlasField(node: HierarchyNode, atlasKey: string): boolean {
  const t = node.template;
  if (!t) return false;
  switch (atlasKey) {
    case "A.worldview.setting":
      return !!t.worldview?.setting?.trim();
    case "A.worldview.scene_structure":
      return !!t.worldview?.scene_structure?.trim();
    case "A.worldview.item_inventory":
      return !!t.worldview?.item_inventory?.trim();
    case "A.characters":
      return (t.characters?.length ?? 0) > 0;
    case "A.story_structure":
      return (t.story_structure?.plot_tree?.nodes.length ?? 0) > 0
        || (t.story_structure?.topology?.nodeCount ?? 0) > 0;
    case "A.core_elements": {
      const ce = t.core_elements;
      return !!(ce && (ce.subject || ce.theme || ce.core_conflict || ce.literature_style || ce.emotion_experience));
    }
    case "A.summary": {
      const s = t.summary;
      return !!(s && ((s.characters?.length ?? 0) > 0 || s.scene?.trim() || s.events?.trim()));
    }
    default:
      // 未在表内显式映射的 A.* 字段：保守视为牵动（不漏标）。
      return atlasKey.startsWith("A.");
  }
}

// ─────────────────────────────────────────────────────────────────
// 三视角投影（只读切片展示，非重生成）
// ─────────────────────────────────────────────────────────────────

export interface PerspectiveProjection {
  perspective: OperatorPerspective;
  /** 该视角在各槽位采用的算子切片（用于前端"切视角看"）。 */
  slots: Array<{ slot_name: string; operatorName: string; definition: string; source: string }>;
}

/**
 * 把"三视角同台"槽位投影为某单一视角的展示切片（§9.3：前端切换=投影展示，不触发重生成）。
 */
export function projectPerspective(slots: OperatorSlot[], perspective: OperatorPerspective): PerspectiveProjection {
  const projected: PerspectiveProjection["slots"] = [];
  for (const slot of slots) {
    const cand = slot.candidates.find((c) => c.perspective === perspective);
    if (!cand) continue;
    projected.push({
      slot_name: slot.slot_name,
      operatorName: cand.operator.name,
      definition: cand.operator.definition,
      source: cand.source,
    });
  }
  return { perspective, slots: projected };
}

/** 一次性给出三视角全部投影（前端三个 tab 的数据）。 */
export function projectAllPerspectives(slots: OperatorSlot[]): PerspectiveProjection[] {
  return (["author", "reader", "character"] as OperatorPerspective[]).map((p) => projectPerspective(slots, p));
}
