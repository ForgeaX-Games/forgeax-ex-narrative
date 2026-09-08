/**
 * 单节点重 roll（契约 docs/contracts.md §2.2）。
 *
 * ─────────────────────────────────────────────────────────────────
 * ⑤ 与 ⑥ 的区别就在这两个参数上
 * ─────────────────────────────────────────────────────────────────
 * ⑥ 影响面重生成：先 `analyze-impact` 算出受牵连的一批步，从最早那步一路跑到底。
 * ⑤ 单节点重 roll：只重跑这一个节点，下游一律不动 ——
 *
 *   `nodeFilter: { [stepId]: [nodeId] }`  把这一步限制在这一个节点上
 *   `stopAfterStep: stepId`                跑完这一步就停，不往下推
 *
 * 少了 `stopAfterStep`，后端会从这一步一直跑到管线末尾（`rerunFromStep` 的默认边界是
 * 最后一步），那就变成了 ⑥ 而且还跳过了影响面分析 —— 用户点的是"换一版这个节点"，
 * 拿到的却是半条管线重跑，最糟的是它不报错。
 *
 * 与 ⑥ 一致的地方：也 fork 新条目。原条目是不可变事实源，重 roll 的结果落在新键上，
 * 旧的那一版永远还在。
 */
import { getLocale } from "../i18n";
import { regenerateStep } from "../hooks/useNarrativeStream";
import { useNarrativeStore, type StepState } from "../store/narrativeStore";
import type { ModeId, TierId } from "../types";

export interface RerollArgs {
  stepId: string;
  /** 不给就是整步重 roll（这一步全部节点重跑，下游仍然不动）。 */
  nodeId?: string;
  /** 作者写的"这一版要怎么不一样"，进重生成的提示词。 */
  userInstructions?: string;
}

/**
 * 重 roll 一个节点，返回新条目键。
 *
 * 正在跑的时候直接拒绝：后端对并发运行会回 409，前端先挡一层能给出明白的话，
 * 而不是把一个 HTTP 错误码摊给用户。
 */
export async function rerollNode(args: RerollArgs): Promise<string> {
  const st = useNarrativeStore.getState();
  const sourceDir = st.activeSourceDir ?? st.activeEntryKey;
  if (!sourceDir) throw new Error("没有可重生成的条目");
  if (st.runningRunId || st.ipDnaGenerating) throw new Error("有运行中的生成，先取消再重 roll");

  const res = await regenerateStep(sourceDir, args.stepId, {
    // 不给 nodeId 就不下 nodeFilter：整步重跑。`stopAfterStep` 两种情形都要给，
    // 它才是"不往下推"这件事的开关。
    nodeFilter: args.nodeId ? { [args.stepId]: [args.nodeId] } : undefined,
    stopAfterStep: args.stepId,
    userInstructions: args.userInstructions,
    locale: getLocale(),
  });

  const newEntryKey = res.newEntryKey ?? `__fork__${res.id}`;
  // 预铺步骤：除了被重 roll 的那一步，其余保持已完成 —— 画布要说清"只有这一步在重跑"。
  const preload: StepState[] = st.activeSteps.map((s) => ({
    ...s,
    status: s.id === args.stepId ? ("pending" as const) : s.status,
  }));

  useNarrativeStore.getState().startFork(
    res.id,
    newEntryKey,
    sourceDir,
    res.tier as TierId | undefined,
    res.mode as ModeId | undefined,
    preload.length ? preload : undefined,
  );
  return newEntryKey;
}
