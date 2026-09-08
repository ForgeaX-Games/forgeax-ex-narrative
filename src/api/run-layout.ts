/**
 * run-layout.ts — 多管线产物目录布局（Phase-2 M8）
 *
 * 一条目 = 一组管线。布局取「主管线占位 + 次管线分子目录」：
 *
 *   output/<key>/                          主管线产物 + _entry.json（条目级）
 *   output/<key>/pipelines/<pipelineId>/    其余管线各自产物（独立 manifest / checkpoint）
 *
 * 为什么不把全部管线一律下沉到 pipelines/：`output/<key>/` 会变空，历史列表、
 * 条目载入、fork 复制、stripIncompleteFields 等读侧共 40 余处引用都要跟着改。
 * 主管线占位把改动收在写侧，读侧零改动。
 */

export const PIPELINE_SUBDIR = "pipelines";

const SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function isSafeSegment(seg: string): boolean {
  return SEGMENT_RE.test(seg) && seg !== "." && seg !== "..";
}

/** run 目录相对 OUTPUT_DIR 的路径（= 前端拿到的 sourceDir）。 */
export function runDirName(entryKey: string, pipelineId?: string): string {
  return pipelineId ? `${entryKey}/${PIPELINE_SUBDIR}/${pipelineId}` : entryKey;
}

/**
 * 校验 sourceDir：只接受 `<key>` 或 `<key>/pipelines/<pipelineId>` 两种形态，
 * 逐段白名单校验（防目录穿越）。
 */
export function isSafeRunDir(dir: unknown): dir is string {
  if (typeof dir !== "string" || dir.length === 0) return false;
  const segs = dir.split("/");
  if (segs.length === 1) return isSafeSegment(segs[0]!);
  if (segs.length !== 3) return false;
  return (
    isSafeSegment(segs[0]!) && segs[1] === PIPELINE_SUBDIR && isSafeSegment(segs[2]!)
  );
}

/** 解析 sourceDir 回 (entryKey, pipelineId)；非法形态返回 null。 */
export function parseRunDirName(
  dir: string,
): { entryKey: string; pipelineId?: string } | null {
  if (!isSafeRunDir(dir)) return null;
  const segs = dir.split("/");
  if (segs.length === 1) return { entryKey: segs[0]! };
  return { entryKey: segs[0]!, pipelineId: segs[2]! };
}

/** 条目级 key（`_entry.json` 所在目录名）；次管线目录回溯到其条目。 */
export function entryKeyOfRunDir(dir: string): string | null {
  return parseRunDirName(dir)?.entryKey ?? null;
}

export interface RunPlacementInput {
  entryKey: string;
  /** 泳道身份（`/plan` 铸的那个）。主管线也有，只是不进路径。 */
  pipelineId?: string;
  /** 缺省视为主管线。 */
  primary?: boolean;
}

export interface RunPlacement {
  /** 产物落哪儿（相对 `output/`）。 */
  runDir: string;
  /** 写进 manifest 与 SSE 帧的泳道身份。 */
  laneId?: string;
  /** 是否条目级主管线（决定要不要回写 `_entry.json`）。 */
  primary: boolean;
}

/**
 * 拆开「泳道身份」与「落盘位置」这两件曾经挤在一个字段里的事。
 *
 * 历史上主管线为了不下沉子目录而**不传** pipelineId，于是运行期 manifest 只能现铸
 * 一个新 id，`_entry.json`（计划期）与 `_run_manifest.json`（运行期）从此不等 ——
 * 前端拿计划期 id 当泳道键、SSE 帧带运行期 id，主管线的泳道永远对不上。
 *
 * 所以身份一律沿用传入的 pipelineId，只有**位置**看 primary。
 */
export function resolveRunPlacement(input: RunPlacementInput): RunPlacement {
  const primary = input.primary !== false;
  return {
    runDir: runDirName(input.entryKey, primary ? undefined : input.pipelineId),
    laneId: input.pipelineId,
    primary,
  };
}
