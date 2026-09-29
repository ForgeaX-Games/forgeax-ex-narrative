import { memo, useRef } from "react";
import type { EdgeProps } from "reactflow";

interface DetroitEdgeData {
  status?: "done" | "running" | "pending";
  level?: "outer" | "inner";
  animStartTime?: number;
  bendFraction?: number;
  /**
   * 跨列长边的"绕行通道"——相对源连接点 Y 的偏移（布局期算好的一条空白水平带）。
   * 给定时走 5 段正交折线（出→升/降到通道→通道内水平横穿→升/降到目标行→入），
   * 避免直线压过中间列的节点。相对偏移而非绝对值，故对 parent-relative / 绝对坐标都成立。
   */
  routeLaneOffsetY?: number;
  /**
   * 两端都在最优路径上（席位 2.3.8 标记的那条链路）。
   *
   * 主线画粗一档并加一层底光，与支线拉开层次——只靠节点上的小标很难看出"链路"，
   * 而这一项要回答的问题恰恰是"顺着哪条线走"。
   */
  onOptimalPath?: boolean;
}

const MIN_EXIT = 24;
const EDGE_DRAW_MS = 500;
const ARROW_OFFSET_MS = 480;

function buildPath(
  sx: number, sy: number, tx: number, ty: number,
  bendFraction?: number, routeLaneOffsetY?: number,
): string {
  // 跨列绕行：出源右侧 → 竖到空白通道 → 通道内横穿 → 竖到目标行 → 入目标。
  // 两条竖段都落在列间空隙（源右侧 +MIN_EXIT / 目标左侧 -MIN_EXIT），不碰节点。
  if (routeLaneOffsetY !== undefined && tx > sx + 4) {
    const laneY = Math.round(sy + routeLaneOffsetY);
    const exitX = Math.round(sx + MIN_EXIT);
    const entryX = Math.round(tx - MIN_EXIT);
    if (entryX > exitX) {
      return `M ${sx},${sy} L ${exitX},${sy} L ${exitX},${laneY} L ${entryX},${laneY} L ${entryX},${ty} L ${tx},${ty}`;
    }
  }

  if (Math.abs(sy - ty) < 4) {
    return `M ${sx},${sy} L ${tx},${ty}`;
  }

  if (tx > sx + 4) {
    const mx = bendFraction !== undefined
      ? Math.round(sx + bendFraction * (tx - sx))
      : Math.round((sx + tx) / 2);
    return `M ${sx},${sy} L ${mx},${sy} L ${mx},${ty} L ${tx},${ty}`;
  }

  const bx = Math.round(Math.max(sx, tx) + MIN_EXIT);
  return `M ${sx},${sy} L ${bx},${sy} L ${bx},${ty} L ${tx},${ty}`;
}

function arrowPoints(sx: number, sy: number, tx: number, ty: number, sz: number): string {
  const half = sz / 2;
  const pointsRight = Math.abs(sy - ty) < 4 ? tx >= sx : tx > sx + 4;
  return pointsRight
    ? `${tx - sz},${ty - half} ${tx},${ty} ${tx - sz},${ty + half}`
    : `${tx + sz},${ty - half} ${tx},${ty} ${tx + sz},${ty + half}`;
}

function DetroitEdgeRaw({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<DetroitEdgeData>) {
  const status = data?.status ?? "done";
  const isOuter = (data?.level ?? "outer") === "outer";

  // Compute remaining delay from absolute timestamp (synced with node clock)
  const ast = data?.animStartTime ?? -1;
  const delayRef = useRef<number | null>(null);
  if (ast > 0 && delayRef.current === null) {
    delayRef.current = Math.max(0, ast - Date.now());
  }
  if (ast <= 0) delayRef.current = null;
  const enterDelay = delayRef.current;
  const shouldAnimate = enterDelay !== null && enterDelay >= 0;

  const edgeColor =
    status === "running" ? (isOuter ? "color-mix(in srgb, var(--color-status-warning) 90%, transparent)" : "color-mix(in srgb, var(--color-status-warning) 70%, transparent)")
    : status === "pending" ? (isOuter ? "color-mix(in srgb, var(--color-status-success) 14%, transparent)" : "color-mix(in srgb, var(--color-status-success) 8%, transparent)")
    : isOuter ? "color-mix(in srgb, var(--color-status-success) 65%, transparent)" : "color-mix(in srgb, var(--color-status-success) 45%, transparent)";

  const onPath = data?.onOptimalPath === true && status !== "pending";
  // 主线在支线之上：粗一档 + 一层底光。颜色不换——换色会让人误读成另一种状态。
  const strokeW = (isOuter ? 2.5 : 1.5) + (onPath ? 1 : 0);
  const d = buildPath(sourceX, sourceY, targetX, targetY, data?.bendFraction, data?.routeLaneOffsetY);
  const sz = isOuter ? 7 : 4;

  if (shouldAnimate) {
    const drawAnim = `edgeDraw ${EDGE_DRAW_MS}ms ease-out ${enterDelay}ms forwards`;
    const arrowAnim = `edgeFadeIn 0.15s ease-out ${enterDelay + ARROW_OFFSET_MS}ms forwards`;
    const aPts = arrowPoints(sourceX, sourceY, targetX, targetY, sz);

    return (
      <g>
        {(isOuter || onPath) && status !== "pending" && (
          <path d={d} fill="none" stroke={onPath ? "color-mix(in srgb, var(--color-status-warning) 22%, transparent)" : "color-mix(in srgb, var(--color-status-success) 16%, transparent)"}
            strokeWidth={strokeW + 6} strokeLinecap="round" pathLength={1}
            style={{
              pointerEvents: "none",
              strokeDasharray: 1, strokeDashoffset: 1,
              animation: drawAnim,
            }} />
        )}
        <path id={id} d={d} fill="none" stroke={edgeColor}
          strokeWidth={strokeW} strokeLinecap="round" pathLength={1}
          style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: drawAnim }} />
        <polygon points={aPts} fill={edgeColor}
          style={{ opacity: 0, animation: arrowAnim }} />
      </g>
    );
  }

  const markerId = `arrow-${id}`;
  const half = sz / 2;
  return (
    <g>
      <defs>
        <marker id={markerId} markerWidth={sz} markerHeight={sz}
          refX={sz} refY={half} orient="auto">
          <polygon points={`0 0, ${sz} ${half}, 0 ${sz}`} fill={edgeColor} />
        </marker>
      </defs>
      {(isOuter || onPath) && status !== "pending" && (
        <path d={d} fill="none" stroke={onPath ? "color-mix(in srgb, var(--color-status-warning) 22%, transparent)" : "color-mix(in srgb, var(--color-status-success) 16%, transparent)"}
          strokeWidth={strokeW + 6} strokeLinecap="round" style={{ pointerEvents: "none" }} />
      )}
      <path id={id} d={d} fill="none" stroke={edgeColor} strokeWidth={strokeW}
        strokeLinecap="round" markerEnd={`url(#${markerId})`}
        style={{ transition: "stroke 0.3s ease" }} />
    </g>
  );
}

export const DetroitEdge = memo(DetroitEdgeRaw);
