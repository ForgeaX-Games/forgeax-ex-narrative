import type { StepStatus } from "../../types";

/**
 * 节点上的生成进度：一枚环 + 一条底部细条。唯一实现，三种节点共用
 * （管线状态节点、故事组节点、画布编排节点）。
 *
 * 此前环与条在两个节点文件里各抄了一份，改一处忘一处的代价是两种节点的进度对不上。
 * 节点 UI 统一成同一形式之后，进度自然也该是同一份实现。
 *
 * 语义：完成即满环打勾，运行中走真实百分比（外部动画钩子按复杂度估的），
 * 失败也画满但染红——失败不是"停在 60%"，而是"这一环到此为止"。
 * 跳过（缺上游没跑）也画满，但染成灰黄：环走完了，只是这一环没有产物。
 */
export function statusPct(status: StepStatus | string, progress?: number): number {
  if (status === "completed") return 100;
  if (status === "running") return progress ?? 50;
  if (status === "failed") return 100;
  if (status === "skipped") return 100;
  return 0;
}

export function statusColor(status: StepStatus | string): string {
  if (status === "completed") return "rgba(77,255,160,0.85)";
  if (status === "running") return "rgba(255,107,53,0.9)";
  if (status === "failed") return "rgba(255,80,80,0.8)";
  if (status === "skipped") return "rgba(214,196,110,0.75)";
  return "rgba(77,255,160,0.15)";
}

export function NodeProgressRing({
  pct,
  status,
  size = 16,
}: {
  pct: number;
  status: StepStatus | string;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - 3) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (circ * pct) / 100;
  const color = statusColor(status);

  if (pct >= 100 && status === "completed") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
        <polyline
          points={`${cx - 3},${cy} ${cx - 1},${cy + 2.5} ${cx + 3.5},${cy - 2.5}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {pct > 0 && pct < 100 && (
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          fill={color}
          fontSize={5}
          fontFamily="monospace"
          fontWeight={700}
        >
          {pct}%
        </text>
      )}
    </svg>
  );
}

export function NodeProgressBar({ pct, status }: { pct: number; status: StepStatus | string }) {
  return (
    <div className="rf-progress-bar">
      <div className={`rf-progress-fill status-${status}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
