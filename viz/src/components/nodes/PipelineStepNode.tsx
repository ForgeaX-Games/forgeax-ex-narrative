import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { StepStatus } from "../../types";
import { GenericObjectView } from "../shared/GenericObjectView";
import { dataToReadableText } from "../shared/dataReadable";
import { NodeProgressBar, NodeProgressRing, statusColor, statusPct } from "./NodeProgress";
import { useNarrativeStore } from "../../store/narrativeStore";
import { rerollNode } from "../../lib/nodeReroll";
import { useT } from "../../i18n";
import { resolveGraphNodeLabel, resolveSeatLabel } from "../../i18n/graphLabels";

interface PipelineStepData {
  label: string;
  status: StepStatus;
  stepType: "pipeline" | "story" | "special";
  isSelected?: boolean;
  progress?: number;
  stepData?: unknown;
  /**
   * 本步独占的席位名（编号 2.3.x）。
   *
   * 席位才是新架构里的单位，step 只是它的实现，所以有席位名时卡的标题用席位名——
   * 「需求清单」这一席不该在画布上写着四期前的「偏好总结」。
   * 一席多步的情形不走这里：那时席位名在外层席位容器的标题上。
   */
  seatName?: string;
  seatId?: string;
  /** status === "skipped" 时后端给的一句话原因（如"需先运行【故事结构助手】"）。 */
  skipHint?: string;
}

/**
 * 收起态的简介行。
 *
 * 已生成的报内容本身的头一句（用与文本视图同一套可读化，再压成一行）；
 * 还没生成的没有内容可报，就报状态——「未生成状态没有详细信息」，那连简介也只能是状态。
 *
 * 挑哪一句有讲究：可读化后的正文里，`**字段**: 值` 是真信息，`### 小节名` 只是个抽屉标签。
 * 直接取第一行常常只拿到"分类""系统"这种词，卡上等于什么都没说，所以优先找第一条带值的。
 */
function summarize(
  status: StepStatus,
  stepData: unknown,
  t: (k: string) => string,
  skipHint?: string,
): string {
  if (status === "running") return t("node.generating");
  if (status === "failed") return t("node.failed");
  // 跳过必须写在卡面上，且要带原因。若与"等待中"共用一句话，用户会一直等一步
  // 永远不会跑的环节；若显示成完成，就退回了静默空跑那种骗人的绿灯。
  if (status === "skipped") {
    return skipHint ? `${t("node.skipped")}：${skipHint}` : t("node.skipped");
  }
  if (status !== "completed") return t("node.waiting");
  if (stepData == null) return t("node.noData");

  const clip = (s: string) => (s.length > 48 ? `${s.slice(0, 48)}…` : s);
  const text = typeof stepData === "string" ? stepData : dataToReadableText(stepData);
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);

  for (const line of lines) {
    const kv = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
    if (kv) return clip(`${kv[1]}: ${kv[2]}`);
  }
  const first = lines[0]?.replace(/[#*`]/g, "").trim();
  return first ? clip(first) : t("node.noData");
}

/**
 * 管线状态节点——与画布编排节点（ComposerFlowNode）同一形式：
 * 满铺标题条（图标 + 标题 + 进度环）、收起态一行简介、展开态才有详情。
 *
 * 两种节点长成一副样子不是审美偏好：同一个用户在同一个视图里，先编排后生成，
 * 若两态各是一套观感，他得把"这是哪一种卡"当额外信息去记。形式统一之后，
 * 卡上唯一变化的是内容与进度。
 *
 * 展开是原地形变，与编排侧一致：同一张卡片长大，标题条与简介留在原处，
 * 底下续上一段可滚动的全量内容。曾经用浮层盖住原卡以免压住邻居和边，
 * 但那样展开态与收起态成了两块东西——用户点开后先要重新找一遍"我点的是哪张"。
 * 压住邻居由抬 z-index 承担：一次只有一张卡是展开的。
 */
function PipelineStepNodeRaw({ data, id }: NodeProps<PipelineStepData>) {
  const { label, status, stepType, isSelected, progress, stepData, seatName, seatId, skipHint } = data;
  const t = useT();
  const displayLabel = seatName
    ? resolveSeatLabel(seatId, seatName)
    : resolveGraphNodeLabel(id, label);
  const [expanded, setExpanded] = useState(false);

  const dotColor = statusColor(status);
  const isStory = stepType === "story";
  // 未生成 = 没有详情可展开。点了也不该展开一片空白。
  const hasData = status === "completed" && !!stepData;
  const pct = statusPct(status, progress);

  const cls = [
    "rf-pipeline-node",
    "composer-node",
    `type-${stepType}`,
    `status-${status}`,
    isSelected ? "selected" : "",
    expanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      onClick={(e) => {
        if (hasData) {
          e.stopPropagation();
          setExpanded(!expanded);
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-pipeline-header composer-node__head">
        <span className="composer-node__icon" style={{ color: dotColor }} aria-hidden>
          {isStory ? "◈" : "◆"}
        </span>
        <span className="rf-pipeline-label composer-node__title">{displayLabel}</span>
        <NodeProgressRing pct={pct} status={status} size={16} />
        {expanded && <span className="rf-child-close" aria-hidden>✕</span>}
      </div>
      <div className="composer-node__summary" title={skipHint ?? displayLabel}>
        {summarize(status, stepData, t, skipHint)}
      </div>
      <NodeProgressBar pct={pct} status={status} />
      {expanded && hasData && (
        <ExpandedDetail stepId={id} stepData={stepData} status={status} />
      )}
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

/**
 * 展开态续在收起态下面的那一段：全量内容 + 两枚动作。
 *
 * 标题与简介不在这里重复一遍——它们就在上面几行没动过。
 *
 * 「编辑」仍然跳文本视图，这是刻意的：改正文要看得见上下文、要能对着别的节点比，
 * 画布上这张小卡片给不了。而「重新生成」不需要编辑器，就在这儿做完
 * （只重跑这一步，下游不动）。
 */
function ExpandedDetail({
  stepId, stepData, status,
}: {
  stepId: string; stepData: unknown; status: StepStatus;
}) {
  const t = useT();
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const setFocus = useNarrativeStore((s) => s.setFocus);
  const canEdit = (activeEntryStatus === "completed" || activeEntryStatus === "interrupted") && status === "completed";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    // nodrag/nopan + 吞掉点击：滚动、选字都会被画布的拖拽平移和卡片的收起吃掉。
    <div className="rf-pipeline-detail nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <div className="rf-node-detail">
        {typeof stepData === "string" ? (
          <pre className="rf-node-detail-pre">{stepData}</pre>
        ) : (
          <GenericObjectView data={stepData} />
        )}
      </div>
      {canEdit && (
        <div className="rf-overlay-actions">
          <button
            className="rf-overlay-edit-btn"
            onClick={() => {
              useNarrativeStore.getState().setViewMode("text");
              setTimeout(() => setFocus(stepId), 50);
            }}
            title={t("node.switchToText")}
          >
            {t("textView.edit")}
          </button>
          <button
            className="rf-overlay-edit-btn"
            disabled={busy}
            title={t("node.reroll.hint")}
            onClick={() => {
              setBusy(true);
              setError(null);
              void rerollNode({ stepId })
                .catch((e: unknown) => setError((e as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            {t("node.reroll")}
          </button>
        </div>
      )}
      {error && <div className="node-actions-error">{error}</div>}
    </div>
  );
}

export const PipelineStepNode = memo(PipelineStepNodeRaw);
