/**
 * artifact-address.ts — 产物寻址的四元组（见 docs/contracts.md §一）
 *
 * 产物地址一律是 `(entryKey, pipelineId?, stepId?, nodeId?)`，版本另附。两条铁律：
 *
 *   1. `runId` 只用于订阅进度，绝不用于寻址 —— 它是 `runs` Map 里的内存句柄，
 *      进程重启即失效。本模块只在「该 run 恰好还活着」时把它翻译成四元组，
 *      翻译不到就当它本来就是磁盘键，绝不把 runId 本身当地址存下去。
 *   2. 目录名是四元组的**派生值**，不是第五个标识符。`sourceDir` 就是
 *      `runDirName(entryKey, pipelineId)`，反解走 `parseRunDirName`。
 *
 * 主管线的 `sourceDir` 恰好等于 `entryKey`，这个巧合是历史上多处混用的根源：
 * `path.basename(outputDir)` 对主管线碰巧对，次管线一出现就推成 pipelineId。
 * 所以本模块只暴露显式的双字段，不提供任何「从路径猜 entryKey」的便利函数。
 */
import { parseRunDirName, runDirName } from "./run-layout.js";

export interface ArtifactAddress {
  /** 条目键 = `output/` 下的目录名，永久。 */
  entryKey: string;
  /**
   * 产物所在的管线子目录；**主管线留空**（它的产物就落在条目根下）。
   *
   * 注意这与「泳道身份」不是同一个字段：主管线也有 pipelineId 身份（manifest 与
   * SSE lane 都带它），但它不出现在路径里。寻址只关心产物在哪个目录，所以这里
   * 只在次管线才置位。
   */
  pipelineId?: string;
  /** 实现步骤 id（= agentId）。 */
  stepId?: string;
  /** 剧情树节点 id。 */
  nodeId?: string;
  /** 钉住的编辑版本；缺省表示「跟随最新」。 */
  version?: number;
}

/** run 目录相对 `output/` 的路径 —— 即前端拿到的 `sourceDir`。 */
export function artifactRunDir(addr: ArtifactAddress): string {
  return runDirName(addr.entryKey, addr.pipelineId);
}

/**
 * 反解 `sourceDir` 形态的引用（`<key>` 或 `<key>/pipelines/<pipelineId>`）。
 * 非法形态返回 null —— 逐段白名单校验在 `parseRunDirName` 里，防目录穿越。
 */
export function parseArtifactRef(ref: string): ArtifactAddress | null {
  return parseRunDirName(ref);
}

/** 运行实例在寻址时能提供的锚点（`RunState` 的子集，便于单测不依赖 server）。 */
export interface RunAnchor {
  /**
   * 相对 `output/` 的目录。**优先用它**：它同时给出 entryKey 与「是否落在子目录」，
   * 而主管线带着泳道身份却不下沉子目录，单看 pipelineId 无法判断产物在哪。
   */
  sourceDir?: string;
  /** 无 outputDir（未落盘的 run）时的兜底。 */
  entryKey?: string;
}

export interface ResolveAddressInput {
  /** 路径参数：可能是 entryKey、sourceDir，或（历史遗留）runId。 */
  ref: string;
  /** 显式覆盖，优先级最高。 */
  pipelineId?: string;
  stepId?: string;
  nodeId?: string;
  version?: number;
  /**
   * runId → 锚点。仅当 `ref` 解不出合法目录、或该 run 仍在内存里时才用。
   * 传 undefined 表示「不做 runId 翻译」，此时 ref 必须已是磁盘键。
   */
  lookupRun?: (runId: string) => RunAnchor | undefined;
}

/**
 * 把一次寻址请求收敛成四元组。
 *
 * 解析顺序（先到先得）：
 *   1. `ref` 命中一个**活着的 run** → 用它的 entryKey/pipelineId（最准，因为
 *      次管线的磁盘目录名单看是个 pipelineId，从字符串无从判断）
 *   2. `ref` 是合法的 `sourceDir` 形态 → 直接反解
 *   3. 都不成 → null（调用方回 404，而不是拿着可疑字符串去拼路径）
 *
 * 显式传入的 pipelineId 覆盖前两步的结果：调用方明确说了要哪条**次**管线时以它为准。
 * 传主管线的泳道身份进来会指向一个不存在的子目录 —— 落盘侧因此还要再兜一层
 * 「子目录不存在就退回条目根」（见 server 的 `artifactRootsForAddress`），
 * 这样调用方分不清主次时也不会读空。
 */
export function resolveArtifactAddress(
  input: ResolveAddressInput,
): ArtifactAddress | null {
  const ref = input.ref?.trim();
  if (!ref) return null;

  let base: ArtifactAddress | null = null;

  const anchor = input.lookupRun?.(ref);
  if (anchor) {
    base = anchor.sourceDir ? parseArtifactRef(anchor.sourceDir) : null;
    if (!base && anchor.entryKey) base = { entryKey: anchor.entryKey };
  }
  base ??= parseArtifactRef(ref);
  if (!base) return null;

  return {
    entryKey: base.entryKey,
    pipelineId: input.pipelineId?.trim() || base.pipelineId,
    stepId: input.stepId?.trim() || undefined,
    nodeId: input.nodeId?.trim() || undefined,
    version: Number.isInteger(input.version) ? input.version : undefined,
  };
}
