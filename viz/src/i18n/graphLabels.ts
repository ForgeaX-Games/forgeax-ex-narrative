import { getLocale, t, tStepLabel } from "./index";

/**
 * 中文名的真值在后端（STEP_REGISTRY 的 name / 席位表的 name），随 SSE 与 announce 下发。
 *
 * 所以中文语境下"后端给了名字就用后端的"：后端改一个环节名，画布立刻跟上，
 * 不需要在前端再改一遍表。前端那份中文表退化成离线兜底（后端没给名字的场合，
 * 如静态调色板、老存档回放）。英文语境反过来：后端只有中文名，必须走 i18n 表。
 */
function preferBackendName(fallback: string): boolean {
  // 认"含汉字"而不是"非空"：预填节点在旧后端下拿不到名字，label 会是 step id 那种
  // 纯 ASCII 串，那种情况必须继续走 i18n 表，否则画布上会出现 preference_summary。
  return getLocale() === "zh" && /[\u4e00-\u9fff]/.test(fallback);
}

/**
 * 图内合成节点（容器分段 / fork 分支）→ i18n key，按 id 后缀匹配。
 *
 * 分段 id 是 `<容器id>::p1` 这样拼出来的，容器 id 又随 step 变（独立的场景生成用
 * scene_plan，legacy 合并 step 用 qsg::scene），所以只认后缀不认全名——
 * 否则每加一处嵌套都要回来补一行全名表，而且骨架层数是数据决定的，补不齐。
 */
const GRAPH_NODE_SUFFIX_LABEL_KEY: Record<string, string> = {
  "::quest": "node.qsgQuest",
  "::scene": "node.qsgScene",
  "::acts": "node.threeActScript",
  "::p1": "node.skeletonExtract",
  "::p2": "node.sceneExpand",
  "::p3": "node.merge",
  "::p1::merge": "node.skeletonMerge",
};

function graphNodeLabelKey(nodeId: string): string | undefined {
  const parts = nodeId.split("::");
  if (parts.length < 2) return undefined;
  // 先长后短：`::p1::merge` 要赢过 `::merge`。
  return GRAPH_NODE_SUFFIX_LABEL_KEY[`::${parts.slice(-2).join("::")}`]
    ?? GRAPH_NODE_SUFFIX_LABEL_KEY[`::${parts[parts.length - 1]}`];
}

/**
 * Localize an assistant-seat label. Shares the palette's key space so the card on the
 * canvas reads exactly like the item the user dragged in; falls back to the backend name.
 */
export function resolveSeatLabel(seatId: string | undefined, fallback: string): string {
  if (!seatId) return fallback;
  if (preferBackendName(fallback)) return fallback;
  const key = `composer.item.engineer.${seatId}`;
  const hit = t(key);
  return hit === key ? fallback : hit;
}

/** Localize a React Flow node label from its id + stored fallback (usually the backend name). */
export function resolveGraphNodeLabel(nodeId: string, fallback: string): string {
  if (preferBackendName(fallback)) return fallback;
  const stepHit = tStepLabel(nodeId, "");
  if (stepHit && stepHit !== `step.${nodeId}.label`) return stepHit;
  const gKey = graphNodeLabelKey(nodeId);
  if (gKey) {
    const hit = t(gKey);
    if (hit !== gKey) return hit;
  }
  return fallback;
}
