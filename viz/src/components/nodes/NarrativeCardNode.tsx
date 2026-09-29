import { memo, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { StepStatus } from "../../types";
import { GenericObjectView } from "../shared/GenericObjectView";
import { resolveGraphNodeLabel } from "../../i18n/graphLabels";

interface NarrativeCardData {
  label: string;
  status: StepStatus;
  card?: Record<string, unknown>;
}

const PRIORITY_KEYS = new Set(["game_name", "one_liner", "story", "gameplay_mapping", "level_expansion"]);

function NarrativeCardNodeRaw({ data, id }: NodeProps<NarrativeCardData>) {
  const { label, status, card } = data;
  const displayLabel = resolveGraphNodeLabel(id, label);
  const [expanded, setExpanded] = useState(false);
  const extraFields = useMemo(() => {
    if (!card) return null;
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(card)) {
      if (!PRIORITY_KEYS.has(k) && v !== null && v !== undefined && v !== "") {
        extra[k] = v;
      }
    }
    return Object.keys(extra).length > 0 ? extra : null;
  }, [card]);

  const dotColor =
    status === "completed" ? "color-mix(in srgb, var(--color-status-success) 85%, transparent)" :
    status === "running" ? "color-mix(in srgb, var(--color-status-warning) 90%, transparent)" : "color-mix(in srgb, var(--color-status-success) 15%, transparent)";

  const hasData = status === "completed" && !!card;

  return (
    <div
      className={`rf-pipeline-node status-${status} type-special${expanded ? " is-expanded" : ""}`}
      onClick={(e) => { if (hasData) { e.stopPropagation(); setExpanded(!expanded); } }}
    >
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="rf-pipeline-header">
        <span style={{ fontSize: "var(--text-caption)", color: dotColor }}>✦</span>
        <span className="rf-pipeline-label">{displayLabel}</span>
        {expanded && <span className="rf-child-close">✕</span>}
      </div>
      {/* 展开原地续一段，标题条留在上面不重复；nodrag/nopan 保住内部滚动与选字。 */}
      {expanded && card && (
        <div className="rf-pipeline-detail rf-narrative-card-detail nodrag nopan" onClick={(e) => e.stopPropagation()}>
          {typeof card.game_name === "string" && card.game_name && (
            <div style={{ fontSize: "var(--text-compact)", fontWeight: 600, color: "color-mix(in srgb, var(--color-status-success) 90%, transparent)", marginBottom: 6 }}>
              {card.game_name}
            </div>
          )}
          {typeof card.one_liner === "string" && card.one_liner && (
            <div style={{ fontSize: "var(--text-caption)", color: "color-mix(in srgb, var(--color-text-primary) 70%, transparent)", marginBottom: 8, fontStyle: "italic" }}>
              {card.one_liner}
            </div>
          )}
          {typeof card.story === "string" && card.story && (
            <div style={{ fontSize: "var(--text-caption)", color: "color-mix(in srgb, var(--color-text-primary) 55%, transparent)", lineHeight: 1.5, marginBottom: 8, maxHeight: 200, overflow: "auto" }}>
              {card.story}
            </div>
          )}
          {typeof card.gameplay_mapping === "object" && card.gameplay_mapping && (
            <div style={{ fontSize: "var(--text-caption)", borderTop: "1px solid color-mix(in srgb, var(--color-status-success) 15%, transparent)", paddingTop: 6 }}>
              {Object.entries(card.gameplay_mapping as Record<string, string>).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 3 }}>
                  <span style={{ color: "color-mix(in srgb, var(--color-status-success) 70%, transparent)" }}>{k}：</span>
                  <span style={{ color: "color-mix(in srgb, var(--color-text-primary) 60%, transparent)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {typeof card.level_expansion === "object" && card.level_expansion && (
            <div style={{ fontSize: "var(--text-caption)", borderTop: "1px solid color-mix(in srgb, var(--color-status-success) 15%, transparent)", paddingTop: 6, marginTop: 6 }}>
              {Object.entries(card.level_expansion as Record<string, string>).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 3 }}>
                  <span style={{ color: "color-mix(in srgb, var(--color-status-success) 70%, transparent)" }}>{k}：</span>
                  <span style={{ color: "color-mix(in srgb, var(--color-text-primary) 60%, transparent)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {extraFields && (
            <div style={{ fontSize: "var(--text-caption)", borderTop: "1px solid color-mix(in srgb, var(--color-status-success) 15%, transparent)", paddingTop: 6, marginTop: 6 }}>
              <GenericObjectView data={extraFields} />
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

export const NarrativeCardNode = memo(NarrativeCardNodeRaw);
