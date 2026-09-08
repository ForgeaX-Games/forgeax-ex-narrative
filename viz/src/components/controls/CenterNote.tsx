import { useNarrativeStore, useNarrativePhase } from "../../store/narrativeStore";
import { RUN_STATE_LABEL, resolveRunState } from "../../store/runState";
import { useT } from "../../i18n";

/**
 * 创作空间的第三层注释——与左栏路径行同一职责：说清"眼下看的是哪一份"。
 *
 * 两种视图问的其实是两个问题，所以答两句不同的话：
 *  - 文本模式关心内容，就报选中那一份产物的名字；没选中则说明铺的是整跑。
 *  - 节点模式关心结构，就报管线的规模与状态：编排态数节点与管线条数，
 *    跑起来之后数步骤与完成数。
 */
export function CenterNote() {
  const t = useT();
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const focusedFile = useNarrativeStore((s) => s.focusedFile);
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  // 订阅连线：管线条数随连线变化，注释要跟着刷新。
  useNarrativeStore((s) => s.composerEdges);
  const getAnchoredPipelines = useNarrativeStore((s) => s.getAnchoredPipelines);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeCanResume = useNarrativeStore((s) => s.activeCanResume);
  const ipDnaGenerating = useNarrativeStore((s) => s.ipDnaGenerating);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const phase = useNarrativePhase();

  if (viewMode === "text") {
    return (
      <span className="cw-note">
        {focusedFile ? t("cw.note.selected", { name: focusedFile.name }) : t("cw.note.selectNone")}
      </span>
    );
  }

  // 编排态（未生成）：画布上摆了什么就报什么。
  if (phase === "idle") {
    return (
      <span className="cw-note">
        {composerNodes.length === 0
          ? t("cw.note.composeEmpty")
          : t("cw.note.compose", {
              n: composerNodes.length,
              pipes: getAnchoredPipelines().length,
            })}
      </span>
    );
  }

  // 状态字样取自运行状态机那一份派生，"已暂停（可续跑）"与"已中断（需重开）"因此分得开。
  const runState = resolveRunState({
    activeEntryStatus,
    activeCanResume,
    generating: !!runningRunId || ipDnaGenerating,
    hasDrafts: false,
    pendingFork: false,
  });
  const status = runState === "pending" ? t("app.status.standby") : t(RUN_STATE_LABEL[runState]);

  return (
    <span className="cw-note">
      {t("cw.note.run", {
        n: activeSteps.length,
        done: activeSteps.filter((s) => s.status === "completed").length,
        status,
      })}
    </span>
  );
}
