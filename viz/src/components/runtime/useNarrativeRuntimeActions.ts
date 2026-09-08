import { useCallback, useMemo } from "react";
import { useNarrativeStore, useNarrativePhase } from "../../store/narrativeStore";
import { isHeavyUploadSet } from "../../lib/uploads";
import { fireIpGenerate } from "../../lib/ipGenerateBridge";
import { runControls, type PrimaryAction, type RunState } from "../../store/runState";
import { useT } from "../../i18n";

export type { PrimaryAction, RunState };

/**
 * 操作条的动作门面：判断该亮哪个主按钮，并把点击转成命令。
 *
 * 全部只读 store，因此中栏 iframe 也能算得准；真正的执行落在 owner 侧的 NarrativeRuntimeProvider。
 * 唯一的例外是重需求的 IP 生成——它的触发闭包在渲染 IpStageFlow 的那个文档里，
 * 所以先就地 fire，fire 不到（本文档没渲染）才退回命令槽。
 */
export function useNarrativeRuntimeActions() {
  const t = useT();
  const phase = useNarrativePhase();
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeCanResume = useNarrativeStore((s) => s.activeCanResume);
  const pendingFork = useNarrativeStore((s) => s.pendingFork);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const uploadedFiles = useNarrativeStore((s) => s.input.uploadedFiles);
  const ipCanGenerate = useNarrativeStore((s) => s.ipCanGenerate);
  const busy = useNarrativeStore((s) => s.runtimeBusy);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const ipDnaJob = useNarrativeStore((s) => s.ipDnaJob);
  const requestCommand = useNarrativeStore((s) => s.requestCommand);
  const setEntryDirty = useNarrativeStore((s) => s.setEntryDirty);
  const setRuntimeError = useNarrativeStore((s) => s.setRuntimeError);

  const hasDrafts = useMemo(() => Object.values(editDrafts).some((d) => d.saved), [editDrafts]);
  const isHeavyUpload = isHeavyUploadSet(uploadedFiles);
  const isRunning = !!runningRunId;
  const ipDnaRunning =
    !!ipDnaJob && ipDnaJob.status !== "completed" && ipDnaJob.status !== "failed" && ipDnaJob.status !== "cancelled";

  /**
   * 两个键的亮灭与语义都出自同一次派生（store/runState.ts）。
   *
   * 此前主键看 `activeEntryStatus`、取消键看 `phase === "generating"`，两套判据讲同一件事，
   * 分开写就会有自相矛盾的一帧。`phase` 现在只管它擅长的（画布显示编排还是管线），
   * 不再兼职按钮门控。
   */
  const controls = useMemo(
    () =>
      runControls({
        activeEntryStatus,
        activeCanResume,
        generating: isRunning || ipDnaRunning,
        hasDrafts,
        pendingFork,
      }),
    [activeEntryStatus, activeCanResume, isRunning, ipDnaRunning, hasDrafts, pendingFork],
  );
  const primaryAction: PrimaryAction = controls.primary;

  const start = useCallback(() => {
    if (isHeavyUpload) {
      if (!ipCanGenerate) {
        setRuntimeError(t("tms.error.ipScopeRequired"));
        return;
      }
      if (fireIpGenerate()) {
        setEntryDirty(false); // 开始生成即视为已保存（IP 路径自身已落盘配置/确认）
        return;
      }
    }
    requestCommand("start");
  }, [isHeavyUpload, ipCanGenerate, requestCommand, setEntryDirty, setRuntimeError, t]);

  const cancel = useCallback(() => requestCommand("cancel"), [requestCommand]);
  const resume = useCallback(() => requestCommand("resume"), [requestCommand]);
  const regenerate = useCallback(() => requestCommand("regenerate"), [requestCommand]);

  /**
   * 叙事路由不再是开跑的前置条件：输入确认了就能开始，没选的轴交给后端自行判定
   * （handleStart 走 autoDetect，本就支持）。头脑风暴阶段没人想先定题材和体量，
   * 硬卡在 routed 只会逼用户乱点一个，反而把错的偏好焊进这一跑。
   */
  const hasRequirement = phase === "routed" || phase === "input";

  return {
    phase,
    /** 六态里的当前那一态（含 paused = 中断且有断点）。 */
    runState: controls.state,
    primaryAction,
    cancelEnabled: controls.cancelEnabled && !busy,
    busy,
    isRunning,
    isGenerating: isRunning || ipDnaRunning,
    isHeavyUpload,
    ipCanGenerate,
    hasRequirement,
    canStart: hasRequirement && !busy && !(isHeavyUpload && !ipCanGenerate),
    start,
    cancel,
    resume,
    regenerate,
  };
}
