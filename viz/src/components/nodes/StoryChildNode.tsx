import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { GenericObjectView } from "../shared/GenericObjectView";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useTreeEdit } from "../../hooks/useTreeEdit";
import { rerollNode } from "../../lib/nodeReroll";
import { useT } from "../../i18n";

interface StoryChildData {
  nodeId: string;
  contentId?: string;
  name: string;
  narrativeFunction?: string;
  isBranch?: boolean;
  isMerge?: boolean;
  isFork?: boolean;
  branchLetter?: string;
  /**
   * 本节点在最优路径上（席位 2.3.8 标记的"最符合用户需求的那条链路"）。
   *
   * 这一层没有任何节点被标过时布局层给 false——线性形态后端不逐点标注，
   * 那时全线即主线，整张图都高亮等于没有高亮。
   */
  onOptimalPath?: boolean;
  content?: string;
  stageType?: string;
  animStartTime?: number;
  ringDuration?: number;
  storyElements?: Record<string, unknown>;
  fullData?: Record<string, unknown>;
  /** 这一批子节点所属的 step id（分段容器已剥掉 `::` 后缀），单节点操作靠它落接口。 */
  stepId?: string;
  /** 本节点在剧情树上的下游 id 列表，"插入节点"要用它把新节点串进去。 */
  nextNodeIds?: string[];
  /** 同层全部节点 id，"插入节点"起新 id 时用它避免撞号。 */
  existingIds?: string[];
}

const NODE_OFFSET_MS = 450;

function StoryChildNodeRaw({ data }: NodeProps<StoryChildData>) {
  const {
    nodeId, contentId, name, narrativeFunction,
    isBranch, isMerge, isFork, branchLetter, onOptimalPath,
    content, stageType, animStartTime = -1, ringDuration = 1500, storyElements,
    fullData, stepId, nextNodeIds, existingIds,
  } = data;
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const alreadyPlayed = useNarrativeStore((s) => s.animPlayedNodes.includes(data.nodeId));
  const markAnimPlayed = useNarrativeStore((s) => s.markAnimPlayed);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const tree = useTreeEdit(stepId);
  const [rerollBusy, setRerollBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canEdit = !!stepId && (activeEntryStatus === "completed" || activeEntryStatus === "interrupted");

  // Compute remaining delay from absolute timestamp (synced with edge clock)
  const delayRef = useRef<number | null>(null);
  if (animStartTime > 0 && delayRef.current === null) {
    delayRef.current = Math.max(0, animStartTime - Date.now());
  }
  if (animStartTime <= 0) delayRef.current = null;
  const enterDelay = delayRef.current ?? -1;
  const skipAnim = enterDelay < 0 || alreadyPlayed;

  useEffect(() => {
    if (enterDelay >= 0 && !alreadyPlayed) {
      const totalMs = enterDelay + 500 + ringDuration + 400;
      const timer = setTimeout(() => markAnimPlayed(data.nodeId), totalMs);
      return () => clearTimeout(timer);
    }
  }, [enterDelay, alreadyPlayed, ringDuration, data.nodeId, markAnimPlayed]);

  const cls = `${isMerge ? "merge" : isBranch ? "branch" : "main"}${expanded ? " is-expanded" : ""}${
    onOptimalPath ? " is-optimal" : ""
  }`;
  // 展示用 id：去掉前端撞号消歧后缀（"5.2#1" → "5.2"），内部 nodeId 仍保唯一用于动画追踪/键。
  const displayId = nodeId.split("#")[0];
  const badge =
    isBranch && branchLetter ? `⑂${branchLetter.toUpperCase()}` :
    isMerge ? "⊕" :
    isFork ? "⑂" : null;

  return (
    <div
      className={`rf-story-child ${cls}${skipAnim ? " no-anim" : ""}`}
      style={{
        ...(!skipAnim ? { "--enter-delay": `${enterDelay}ms` } : {}),
      } as React.CSSProperties}
      onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
    >
      <Handle type="target" position={Position.Left} className="rf-handle-sm" />

      <div className="rf-child-collapsed">
        {/* 第一行：序号 + 标题（单行省略）；徽标与进度环靠右 */}
        <div className="rf-child-header">
          <span className="rf-child-id">{displayId}</span>
          <span className="rf-child-name" title={name}>{name}</span>
          {onOptimalPath && (
            <span className="rf-child-optimal" title={t("tree.optimalPath")}>★</span>
          )}
          {badge && <span className="rf-child-badge">{badge}</span>}
          <ChildProgressRing enterDelay={enterDelay} skipAnim={skipAnim} ringDuration={ringDuration} />
          {expanded && <span className="rf-child-close" aria-hidden>✕</span>}
        </div>
        {/* 第二行：正文预览，最多两行、超出以省略号结束；无正文时回落到叙事功能 */}
        {content ? (
          <div className="rf-child-body" title={content}>{content}</div>
        ) : narrativeFunction ? (
          <div className="rf-child-func">{narrativeFunction}</div>
        ) : null}
      </div>

      {/* 展开是原地续一段，不是另盖一张卡：序号 + 标题 + 预览就在上面没动过，
          这里只补它们装不下的全量内容。nodrag/nopan 让这一段能滚动、能选字。 */}
      {expanded && (
        <div className="rf-child-detail nodrag nopan" onClick={(e) => e.stopPropagation()}>
          {(contentId || stageType) && (
            <div className="rf-child-exp-header">
              {contentId && <span className="rf-child-cid">{contentId}</span>}
              {stageType && <span className="rf-child-stage">{stageType}</span>}
            </div>
          )}
          {fullData ? (
            <div className="rf-child-exp-content">
              <GenericObjectView data={fullData} />
            </div>
          ) : (
            <>
              {narrativeFunction && (
                <div className="rf-child-exp-func">{narrativeFunction}</div>
              )}
              {content && (
                <div className="rf-child-exp-content">{content}</div>
              )}
              {storyElements && (
                <div className="rf-child-exp-elements">
                  <GenericObjectView data={storyElements} />
                </div>
              )}
            </>
          )}
          {canEdit && (
            <div className="rf-overlay-actions">
              <button
                className="rf-overlay-edit-btn"
                disabled={rerollBusy}
                title={t("node.reroll.hint")}
                onClick={() => {
                  setRerollBusy(true);
                  setActionError(null);
                  void rerollNode({ stepId: stepId!, nodeId: displayId })
                    .catch((e: unknown) => setActionError((e as Error).message))
                    .finally(() => setRerollBusy(false));
                }}
              >
                {t("node.reroll")}
              </button>
              {tree.enabled && (
                <>
                  <button
                    className="rf-overlay-edit-btn"
                    disabled={tree.busy}
                    title={t("tree.addAfter.hint")}
                    onClick={() => tree.addAfter(displayId, nextNodeIds ?? [], existingIds ?? [])}
                  >
                    {t("tree.addAfter")}
                  </button>
                  <button
                    className="rf-overlay-edit-btn"
                    disabled={tree.busy}
                    title={t("tree.delete.hint")}
                    onClick={() => tree.remove(displayId)}
                  >
                    {t("tree.delete")}
                  </button>
                </>
              )}
            </div>
          )}
          {(actionError || (tree.enabled && tree.message)) && (
            <div className="node-actions-error">{actionError ?? tree.message}</div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="rf-handle-sm" />
    </div>
  );
}

/**
 * Pure CSS-driven progress ring for child nodes.
 * Appears after enterDelay, then animates:
 *   0% → 50% in 33%, 50% → 99% in 67%, then ✓ check
 * Total animation duration = ringDuration, driven by CSS @keyframes + custom property
 */
function ChildProgressRing({ enterDelay, skipAnim, ringDuration }: { enterDelay: number; skipAnim: boolean; ringDuration: number }) {
  const size = 14;
  const cx = size / 2, cy = size / 2, r = (size - 2.5) / 2;
  const circ = 2 * Math.PI * r;

  if (skipAnim) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ flexShrink: 0, marginLeft: "auto" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(77,255,160,0.85)" strokeWidth={1.2} />
        <polyline
          points={`${cx - 2.5},${cy} ${cx - 0.8},${cy + 2} ${cx + 3},${cy - 2}`}
          fill="none" stroke="rgba(77,255,160,0.85)" strokeWidth={1.2}
          strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }

  const ringDelay = enterDelay + NODE_OFFSET_MS;

  return (
    <svg
      className="rf-child-progress-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        flexShrink: 0,
        marginLeft: "auto",
        "--ring-delay": `${ringDelay}ms`,
        "--ring-circ": `${circ.toFixed(1)}`,
        "--ring-dur": `${ringDuration}ms`,
      } as React.CSSProperties}
    >
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1.2}
      />
      <circle
        className="rf-child-progress-arc"
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(77,255,160,0.7)"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray={`0 ${circ.toFixed(1)}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <polyline
        className="rf-child-progress-check"
        points={`${cx - 2.5},${cy} ${cx - 0.8},${cy + 2} ${cx + 3},${cy - 2}`}
        fill="none"
        stroke="rgba(77,255,160,0.85)"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const StoryChildNode = memo(StoryChildNodeRaw);
