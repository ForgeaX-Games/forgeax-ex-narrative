import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, RotateCcw } from "lucide-react";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useNarrativeRuntimeActions } from "../runtime/useNarrativeRuntimeActions";
import {
  getComposerRunner,
  subscribeComposerRunner,
  type ComposerRunner,
} from "../../lib/composerRun";
import { useT } from "../../i18n";

/**
 * 底部工具条的生成键：开始生成 / 取消 / 断点续跑 / 重新生成。
 *
 * 纯图标，与右边的视图与缩放键同形，六个键排成一条居中的工具条。
 * 按钮本身不执行动作，只往 store 的命令槽写一条；执行在 owner 侧的 NarrativeRuntimeProvider。
 *
 * 开始键有两条路：画布在编排态时走画布那条（按节点解析出的锚定管线开跑，
 * 顺带落一个新任务条目），否则走条目那条常规启动。判据是画布有没有登记开跑动作。
 */
export function RunActionBar() {
  const t = useT();
  const {
    runState, primaryAction, cancelEnabled, busy, isRunning, isGenerating, isHeavyUpload,
    ipCanGenerate, hasRequirement, canStart, start, cancel, resume, regenerate,
  } = useNarrativeRuntimeActions();

  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);

  const [composer, setComposer] = useState<ComposerRunner | null>(getComposerRunner);
  useEffect(() => subscribeComposerRunner(setComposer), []);

  // 主键三态共用一个位置：没跑过是「开始」，跑挂了是「续跑」，跑完了是「重新生成」。
  const primary =
    composer
    ? {
        onClick: composer.run,
        disabled: !composer.canRun || composer.starting,
        Icon: Play,
        title: composer.starting
          ? t("tms.start.starting")
          : composer.canRun
            ? t("tms.start")
            : t("composer.noInput"),
      }
    : primaryAction === "regen"
      ? {
          onClick: regenerate,
          disabled: busy || isRunning,
          Icon: RefreshCw,
          title: busy ? t("tms.regen.analyzing") : isRunning ? t("tms.regen.running") : t("tms.regen"),
        }
      : primaryAction === "resume"
        ? {
            onClick: resume,
            disabled: busy || isRunning,
            Icon: RotateCcw,
            title: busy
              ? t("tms.resume.resuming")
              : isRunning
                ? t("tms.resume.generating")
                : t("tms.resume"),
          }
        : {
            onClick: start,
            disabled: !canStart,
            Icon: Play,
            title: !hasRequirement
              ? t("tms.start.noInputTitle")
              : isHeavyUpload && !ipCanGenerate
                ? t("tms.start.ipScopeTitle")
                : busy
                  ? t("tms.start.starting")
                  : isGenerating
                    ? t("tms.start.generating")
                    // 中断但没有断点：这一次只能从头跑，说清楚，别让用户以为点了会接着上次。
                    : runState === "interrupted"
                      ? t("tms.start.restart")
                      : t("tms.start"),
          };

  return (
    <div className="cw-actions">
      <button
        type="button"
        className="cw-canvasctl__btn cw-canvasctl__btn--primary"
        onClick={primary.onClick}
        disabled={primary.disabled}
        title={primary.title}
        aria-label={primary.title}
      >
        <primary.Icon size={14} strokeWidth={2} aria-hidden />
      </button>

      {/* 取消 = 界面上的"暂停生成"：停下来但保住断点，主键随后变成续跑。 */}
      <button
        type="button"
        className={`cw-canvasctl__btn${cancelEnabled ? " is-warn" : ""}`}
        onClick={cancel}
        disabled={!cancelEnabled}
        title={t("tms.cancel")}
        aria-label={t("tms.cancel")}
      >
        <Pause size={14} strokeWidth={2} aria-hidden />
      </button>

      {isRunning && activeEntryKey !== runningEntryKey && (
        <button
          type="button"
          className="cw-actions__hint"
          onClick={() => {
            if (!runningEntryKey) return;
            useNarrativeStore.setState({
              activeEntryKey: runningEntryKey,
              activeEntryStatus: "running",
              activeSteps: runningProgress,
            });
          }}
        >
          {t("tms.runningHint")}
        </button>
      )}
    </div>
  );
}
