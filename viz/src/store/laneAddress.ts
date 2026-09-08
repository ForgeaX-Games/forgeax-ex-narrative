/**
 * laneAddress.ts — 前端这一侧的产物寻址（对应后端 api/run-layout.ts 与 api/artifact-address.ts）
 *
 * 产物地址是 `(entryKey, pipelineId?, stepId?, nodeId?, version?)`，目录名是它的派生值：
 * 主管线的产物落条目根，次管线落 `<entryKey>/pipelines/<pipelineId>/`（见 contracts §一）。
 *
 * 前后端各持一份同构实现，两边都不允许"从路径猜 entryKey"——主管线的 sourceDir 恰好等于
 * entryKey，这个巧合正是历史上把 sourceDir 当条目键用、次管线一出现就错的根源。
 *
 * 与后端的分工：后端可以看磁盘，前端不能，所以前端一律读后端给的事实
 * （启动响应的 sourceDir、或后端回写进 manifest 的同名字段），只在两者都没有时
 * 才落到条目根。**前端不自己拼 `pipelines/<pid>`**：一条泳道是不是主管线，取决于
 * 启动时刻哪几条真跑起来了（跳过的不占位），从清单下标猜必错。
 */

export const PIPELINE_SUBDIR = "pipelines";

/** 目录名 → (entryKey, pipelineId)；只认 `<key>` 与 `<key>/pipelines/<pid>` 两种形态。 */
export function parseSourceDir(
  dir: string | null | undefined,
): { entryKey: string; pipelineId?: string } | null {
  if (!dir) return null;
  const segs = dir.split("/");
  const safe = (s: string | undefined): boolean =>
    !!s && /^[A-Za-z0-9_.-]+$/.test(s) && s !== "." && s !== "..";
  if (segs.length === 1) return safe(segs[0]) ? { entryKey: segs[0]! } : null;
  if (segs.length !== 3 || segs[1] !== PIPELINE_SUBDIR) return null;
  if (!safe(segs[0]) || !safe(segs[2])) return null;
  return { entryKey: segs[0]!, pipelineId: segs[2]! };
}

/** 这条泳道在磁盘上的位置，由后端告知。 */
export interface LaneLocation {
  pipelineId?: string;
  sourceDir?: string;
}

/**
 * 某条泳道的产物目录；null = 后端还没说过（尚未启动的泳道没有产物）。
 *
 * 两处事实源按新鲜度排序：本轮启动响应（lanes）优先于 manifest 快照（manifests），
 * 前者是这一秒的真值，后者跨重启仍在。
 */
export function laneSourceDir(
  pipelineId: string | null | undefined,
  lanes: Record<string, LaneLocation | undefined>,
  manifests: readonly LaneLocation[],
): string | null {
  if (!pipelineId) return null;
  const fromLane = lanes[pipelineId]?.sourceDir;
  if (fromLane) return fromLane;
  return manifests.find((m) => m.pipelineId === pipelineId)?.sourceDir ?? null;
}
