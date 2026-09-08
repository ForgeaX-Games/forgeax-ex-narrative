/**
 * step-skip.ts —— 「缺上游所以没跑」的结构化记录
 *
 * 消掉的是这样一种失败：`if (outlines.length === 0) return;`。函数体安静地返回，
 * 管线照样发一帧 completed，画布把节点点亮，用户以为这一步跑过了——其实零产物。
 * 后面每一步都以为上游给了东西，于是整条链一路空转到底，谁也没报错。
 *
 * 换成显式记录后：缺什么、该先跑哪一席、这一步到底跑没跑，三件事都能说出口，
 * SSE 有独立的 skipped 状态，画布显示"已跳过：需先运行【故事结构助手】"。
 *
 * 反查逻辑不在这里重造，统一走 input-provenance——单席 422 文案、席位发现的
 * blockedBy、这里的跳过提示是同一个答案的三种呈现。
 */
import type { NarrativeContext } from "../../types/index.js";
import { blockingSeatIds, formatMissingInputsHint } from "./input-provenance.js";

export interface StepSkipRecord {
  stepId: string;
  /** 缺失的 ctx 字段。 */
  missing: string[];
  /** 该先运行的席位 id。 */
  blockedBy: string[];
  /** 给用户看的一句话，如"需先运行【故事结构助手】"。 */
  hint: string;
}

/** ctx 上存放跳过记录的内部键（下划线前缀 = 运行期内部字段，不落盘为产物）。 */
const SKIP_KEY = "_skippedSteps";

type SkipMap = Record<string, StepSkipRecord>;

function skipMap(ctx: NarrativeContext): SkipMap {
  const bag = ctx as unknown as Record<string, unknown>;
  if (!bag[SKIP_KEY]) bag[SKIP_KEY] = {} as SkipMap;
  return bag[SKIP_KEY] as SkipMap;
}

/**
 * 声明本步因缺上游未执行。
 *
 * 调用方仍然 return（不抛错）：缺上游不是错误，是这条链在这里到头了，
 * 后续步骤会各自因为同样的原因被跳过，整条链的报告是完整的。
 */
export function markStepSkipped(
  ctx: NarrativeContext,
  stepId: string,
  missing: readonly string[],
): StepSkipRecord {
  const record: StepSkipRecord = {
    stepId,
    missing: [...missing],
    blockedBy: blockingSeatIds(missing),
    hint: formatMissingInputsHint(missing) || "缺少上游产物",
  };
  skipMap(ctx)[stepId] = record;
  return record;
}

/** 本步是否被标记为跳过。 */
export function getStepSkip(ctx: NarrativeContext, stepId: string): StepSkipRecord | undefined {
  return (ctx as unknown as Record<string, SkipMap | undefined>)[SKIP_KEY]?.[stepId];
}

/** 本次运行里所有被跳过的步骤，供运行结束时汇总。 */
export function listStepSkips(ctx: NarrativeContext): StepSkipRecord[] {
  const map = (ctx as unknown as Record<string, SkipMap | undefined>)[SKIP_KEY];
  return map ? Object.values(map) : [];
}

/** 重跑同一步之前清掉旧记录，避免上一轮的跳过被当成本轮结果。 */
export function clearStepSkip(ctx: NarrativeContext, stepId: string): void {
  const map = (ctx as unknown as Record<string, SkipMap | undefined>)[SKIP_KEY];
  if (map) delete map[stepId];
}
