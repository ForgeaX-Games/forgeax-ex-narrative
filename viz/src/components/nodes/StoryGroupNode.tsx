import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { StepStatus } from "../../types";
import { NodeProgressBar, NodeProgressRing, statusColor, statusPct } from "./NodeProgress";
import { useT } from "../../i18n";
import { resolveGraphNodeLabel, resolvePipelineName, resolveSeatLabel } from "../../i18n/graphLabels";
import { useGenreName } from "../../lib/genreCache";
import { useNarrativeStore } from "../../store/narrativeStore";

interface PhaseInfo {
  id: string;
  label: string;
  done?: boolean;
  active?: boolean;
}

interface StoryGroupData {
  label: string;
  /** 副标题：专家容器用它报所跑的席位管线名。 */
  sublabel?: string;
  /** 席位容器：标题按席位 id 查 i18n，label 只作缺键兜底。 */
  seatId?: string;
  status: StepStatus;
  childCount: number;
  expanded: boolean;
  progress?: number;
  phases?: PhaseInfo[];
}

function StoryGroupNodeRaw({ data, id }: NodeProps<StoryGroupData>) {
  const t = useT();
  const { label, sublabel, seatId, status, childCount, expanded, progress, phases } = data;
  // 专家容器的标题 announce 只给中文（「JRPG专家」）。品类目录是后端按语言下发的，
  // 所以不去反查那个中文串，直接拿本次运行的品类 code 现拼——换语言立刻跟上。
  // 取 activeConfig 而非 routing：前者是这条条目的启动快照，后者是顶栏当下的草稿，
  // 翻旧任务时草稿可能早改成别的品类了。
  const genreName = useGenreName(id.startsWith("expert::"));
  const genreCode = useNarrativeStore(
    (s) => s.activeConfig?.genreCode ?? s.routing.genreCode,
  );
  const expertName = id.startsWith("expert::") ? genreName(genreCode) : null;
  const displayLabel = seatId
    ? resolveSeatLabel(seatId, label)
    : expertName && expertName !== genreCode
      ? t("nav.suffix.expert", { name: expertName })
      : resolveGraphNodeLabel(id, label);

  const dotColor = statusColor(status);
  const pct = statusPct(status, progress);
  const isComposite = !!phases?.length;

  return (
    <div className={`rf-story-group status-${status} ${expanded ? "expanded" : "collapsed"}${isComposite ? " composite" : ""}`}>
      <Handle type="target" position={Position.Left} className="rf-handle" />

      <div className="rf-story-group-header">
        <span style={{ fontSize: "var(--text-caption)", color: dotColor, pointerEvents: "none" }}>◈</span>
        <span className="rf-story-group-label">{displayLabel}</span>
        {sublabel && <span className="rf-story-group-sublabel">{resolvePipelineName(sublabel)}</span>}
        {childCount > 0 && (
          <span className="rf-story-group-count">{childCount}</span>
        )}
        <NodeProgressRing pct={pct} status={status} size={16} />
        {expanded && <span className="rf-story-collapse-hint">▾</span>}
        {!expanded && childCount > 0 && <span className="rf-story-collapse-hint">▸</span>}
      </div>

      {/* Phase badges for composite nodes (e.g. scene generation P1→P2→P3) */}
      {isComposite && (
        <div className="rf-phase-bar">
          {phases!.map((ph, idx) => (
            <span key={ph.id} className="rf-phase-item">
              {idx > 0 && <span className="rf-phase-arrow">→</span>}
              <span className={`rf-phase-badge${ph.done ? " done" : ""}${ph.active ? " active" : ""}`}>
                {resolveGraphNodeLabel(ph.id, ph.label)}
              </span>
            </span>
          ))}
        </div>
      )}

      <NodeProgressBar pct={pct} status={status} />

      {!expanded && childCount > 0 && (
        <div className="rf-story-summary">
          {t("node.nodesExpand", { n: childCount })}
        </div>
      )}
      {!expanded && childCount === 0 && (
        <div className="rf-story-summary dim">
          {status === "pending" ? t("node.waiting") : status === "running" ? t("node.generating") : t("node.noData")}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

export const StoryGroupNode = memo(StoryGroupNodeRaw);
