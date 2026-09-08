/**
 * pipelineSwitch.ts — G1：切次管线泳道时把该泳道自己的产物读回中间区。
 *
 * `narrativeStore.setActivePipelineId` 只换指针与 `activeSourceDir`（同步、无副作用）；
 * 真正的读盘必须在这里异步做，再灌回 store。拆成独立文件是因为
 * `hooks/useNarrativeStream.ts` 已经反向 import `narrativeStore`，
 * store 内部不能再 import 回 `loadHistoryResult`，否则循环依赖。
 */
import { useNarrativeStore } from "../store/narrativeStore";
import { loadHistoryResult } from "../hooks/useNarrativeStream";
import { draftKeyOf, listEdits } from "./editPersist";

/**
 * 切换到某条泳道：先同步换指针（UI 立刻响应 tab 高亮/文件目录），
 * 再异步取回该泳道自己的 checkpoint/full_result 并灌回中间区。
 * 正在运行的泳道不重复读盘——SSE 已经在实时喂数据，读历史反而会拿到过期快照。
 */
export async function switchActivePipeline(pipelineId: string | null): Promise<void> {
  const store = useNarrativeStore.getState();
  store.setActivePipelineId(pipelineId);
  if (pipelineId == null) return;

  // 编辑草稿是泳道维度的（每条泳道有自己的 `_edits.json`），先清空避免上一条泳道的
  // "已修改" 状态在新泳道数据回来之前短暂串场。
  useNarrativeStore.getState().clearAllDrafts();

  // 该泳道正在跑：中间区已经由 SSE 帧驱动，不需要（也不应该）覆盖成盘上的旧快照。
  const lane = store.pipelineRuns[pipelineId];
  if (lane?.status === "running") return;

  const sourceDir = useNarrativeStore.getState().activeSourceDir;
  if (!sourceDir) return;

  try {
    const data = await loadHistoryResult(sourceDir);
    if (data.result) {
      useNarrativeStore.getState().applyLaneResult(sourceDir, {
        result: data.result,
        stepGroups: data.stepGroups,
      });
    }
  } catch {
    // 读取失败保留切换前的展示，不打断用户操作；该泳道可能确实还没产物。
  }

  try {
    const edits = await listEdits(sourceDir);
    // 陈旧响应校验：这段时间里用户可能又切到别的泳道了。
    if (useNarrativeStore.getState().activeSourceDir !== sourceDir) return;
    for (const e of edits) {
      useNarrativeStore.getState().setEditDraft(draftKeyOf(e), {
        content: typeof e.editedContent === "string" ? e.editedContent : undefined,
        userInput: e.userInput,
        editing: false,
        saved: true,
      });
    }
  } catch {
    // 该泳道没有编辑账本是正常情况，不视为错误。
  }
}
