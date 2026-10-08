import { useEffect, useState } from "react";
import { ChevronLeft, Plus, Upload } from "lucide-react";
import { TaskFiles } from "./TaskFiles";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useNarrativeRuntime } from "../runtime/NarrativeRuntimeProvider";
import { formatHistoryTime, STEP_LABEL_MAP } from "../../lib/routingCatalog";
import { useGenreName } from "../../lib/genreCache";
import { axisLabelByName, loadNarrativeAxes } from "../../lib/axesCache";
import type { NarrativeAxesCatalog } from "../../hooks/useNarrativeStream";
import { localizeTagSummary } from "../../i18n/tagSummary";
import { useT, tStepLabel } from "../../i18n";
import { switchActivePipeline } from "../../lib/pipelineSwitch";
import { describeEntryStatus } from "../../lib/entryStatusLabel";

/**
 * 任务管理：每次通过对话开启的一次生成，就是一个任务。
 *
 * 三级树的第一级在这里——每条任务卡三行，正好答三个问题：
 *  ① 什么时候跑的（时间戳 + 状态）
 *  ② 当时要的是什么（需求文字，或上传了哪些文件）
 *  ③ 走的是哪条路（叙事路由：品类专家 / 单品模块 / 三轴 / 复杂度）
 * 双击进第二级（按实跑环节归的文件夹），再往下是第三级（文件与同环节的多个版本）。
 *
 * 任务的类别是系统按实跑环节自动归的，用户改不了；用户自己攒的柜子在隔壁「项目管理」。
 */
export function TaskPanel() {
  const t = useT();
  const wb = useNarrativeRuntime();
  const genreName = useGenreName();
  // 三轴词表用来把落盘的中文轴名翻成当前语言；进程内缓存，全应用只请求一次。
  const [axes, setAxes] = useState<NarrativeAxesCatalog | null>(null);
  useEffect(() => { void loadNarrativeAxes().then(setAxes); }, []);
  const openedTaskKey = useNarrativeStore((s) => s.openedTaskKey);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const listExpandedKeys = useNarrativeStore((s) => s.listExpandedKeys);
  const entryPipelines = useNarrativeStore((s) => s.entryPipelines);
  const activePipelineId = useNarrativeStore((s) => s.activePipelineId);
  const toggleListExpanded = useNarrativeStore((s) => s.toggleListExpanded);
  const deselectEntry = useNarrativeStore((s) => s.deselectEntry);
  const resetFormDraft = useNarrativeStore((s) => s.resetFormDraft);
  const openTask = useNarrativeStore((s) => s.openTask);
  const closeTask = useNarrativeStore((s) => s.closeTask);

  if (!wb) return null;
  const { displayHistory, historyLoading, loadingKey, selectEntry } = wb;

  // 新建任务 = 松开当前条目 + 清草稿，回到谁都没选中的空态。
  // 这里不建条目——条目要等这一跑真开工（对话栏点发送 / 底栏点开始）才落库，
  // 否则用户随手点两下就攒出一串空壳任务。
  // 位置在列表最上且钉住滚动区顶部：新建是这一栏最常用的动作，
  // 翻到十三条历史的底下才找到它没道理。
  const newTaskCard = (
    <button
      type="button"
      className="history-new"
      title={t("task.new")}
      aria-label={t("task.new")}
      onClick={() => {
        deselectEntry();
        resetFormDraft();
        closeTask();
      }}
    >
      <Plus size={16} strokeWidth={2} aria-hidden />
    </button>
  );

  /**
   * ① 时间戳 + 状态。展开态多一枚返回键，列表态多一枚管线折叠。
   *
   * 中断态在这里要分成两枚牌：有断点的说"已暂停"（点进去主键是断点续传），
   * 没断点的才说"已中断"（只能从头再跑）。同一个字面上的 `interrupted` 给两种指望，
   * 用户会照牌面去点一个注定 404 的键。
   */
  const renderTimeRow = (
    entry: (typeof displayHistory)[number],
    opts: { running: boolean; toggle?: React.ReactNode; back?: boolean },
  ) => {
    const paused = entry.status === "interrupted" && !!entry.canResume;
    return (
    <div className="hi-header">
      <span className="hi-time">
        {opts.running && !entry.startedAt ? t("tms.history.current") : formatHistoryTime(entry)}
      </span>
      <span className={`hi-badge hi-badge--${paused ? "paused" : entry.status ?? "unknown"}`}>
        {describeEntryStatus(entry, t) || "?"}
      </span>
      {opts.toggle}
      {opts.back && (
        <button
          type="button"
          className="hi-back"
          title={t("task.back")}
          aria-label={t("task.back")}
          onClick={(ev) => { ev.stopPropagation(); closeTask(); }}
        >
          <ChevronLeft size={24} aria-hidden />
        </button>
      )}
    </div>
    );
  };

  /** ② 需求输入 / 文件上传：上传型条目的正文是文件，不是那段文字。 */
  const renderInputRow = (entry: (typeof displayHistory)[number]) => {
    const uploads = entry.uploadedFileNames ?? [];
    const isUpload = uploads.length > 0 || entry.inputType === "adapted" || entry.kind === "ip-dna";
    const text = isUpload
      ? uploads.length > 0
        ? t("task.row.upload", { n: uploads.length, names: uploads.join("、") })
        : t("task.row.uploadUnknown")
      : entry.userInput
        ? localizeTagSummary(entry.userInput, t)
        : t("task.row.noInput");
    return (
      <div className="hi-input-preview" title={text}>
        {isUpload && <Upload size={10} className="hi-row-icon" aria-hidden />}
        {text.length > 120 ? `${text.slice(0, 120)}…` : text}
      </div>
    );
  };

  /** ③ 叙事路由：品类（专家）为主，三轴与复杂度为辅；一个都没定就说走自动。 */
  const renderRouteRow = (entry: (typeof displayHistory)[number]) => {
    const parts: string[] = [];
    if (entry.routeGroup) {
      parts.push(
        entry.routeGroup === "planning" ? t("tms.routeGroup.planning") : t("tms.routeGroup.narrative"),
      );
    }
    const genre = genreName(entry.genreCode);
    if (genre) parts.push(t("nav.suffix.expert", { name: genre }));
    // 这四项落盘存的都是后端的索引值（模式 id、三轴的中文名），不是给人看的文案；
    // 直接贴上去英文界面就会冒出中文。译文存在就取译文，没有才照原样显示。
    if (entry.mode && entry.mode !== "narrative_auto") {
      const modeLabel = t(`route.${entry.mode}.label`);
      parts.push(modeLabel === `route.${entry.mode}.label` ? entry.mode : modeLabel);
    }
    if (entry.storyType) parts.push(axisLabelByName(axes, entry.storyType));
    if (entry.storyTheme) parts.push(axisLabelByName(axes, entry.storyTheme));
    if (entry.narrativeStructure) parts.push(axisLabelByName(axes, entry.narrativeStructure));
    if (entry.complexity != null) parts.push(t("nav.scale.level", { n: entry.complexity }));
    return (
      <div className="hi-meta">
        {parts.length > 0 ? (
          parts.map((p, i) => (
            <span key={`${p}-${i}`} className="hi-tag">{p}</span>
          ))
        ) : (
          <span className="hi-tag hi-tag--auto">{t("task.row.routeAuto")}</span>
        )}
        {entry.parentKey && (
          <span className="hi-tag hi-tag--fork" title={entry.forkReason}>
            {t("tms.history.fork")}
          </span>
        )}
        {entry.fileCount != null && (
          <span className="hi-files">{t("tms.history.files", { n: entry.fileCount })}</span>
        )}
      </div>
    );
  };

  if (openedTaskKey) {
    // 中间层的顺序 = 这一跑的环节顺序。看的正是当前条目就用实时步序，
    // 看别的历史条目则用它落盘的已完成步序；都没有就让 TaskFiles 退回花名册顺序。
    const opened = displayHistory.find((e) => e.key === openedTaskKey);
    const stepOrder =
      openedTaskKey === activeEntryKey && activeSteps.length > 0
        ? activeSteps.map((s) => s.id)
        : (opened?.completedSteps ?? []);

    // 进来之后不另起一条「返回任务列表」——那条只重复了一遍用户刚点过的东西。
    // 留在原位的还是那张任务卡（照样三行报清身份），返回图标挂在它自己的时间行右端。
    return (
      <div className="project-panel project-panel--opened">
        <div className="project-panel__body">
          {opened ? (
            <div className={`history-item status-${opened.status ?? "unknown"} is-opened`}>
              {renderTimeRow(opened, { running: opened.key === runningEntryKey, back: true })}
              {renderInputRow(opened)}
              {renderRouteRow(opened)}
            </div>
          ) : (
            <div className="history-item is-opened">
              {/* 历史列表还没回来时先占位，返回口不能因此失灵。 */}
              <div className="hi-header">
                <span className="hi-time">{openedTaskKey}</span>
                <button
                  type="button"
                  className="hi-back"
                  title={t("task.back")}
                  aria-label={t("task.back")}
                  onClick={closeTask}
                >
                  <ChevronLeft size={12} aria-hidden />
                </button>
              </div>
            </div>
          )}
          <TaskFiles taskKey={openedTaskKey} stepOrder={stepOrder} />
        </div>
      </div>
    );
  }

  return (
    <div className="project-panel">
      {/* 条数不必单开一条带子报：列表自己就在那儿，数它一眼的事。 */}
      <div className="project-panel__body">
        {historyLoading ? (
          <div className="history-loading">{t("tms.history.loading")}</div>
        ) : displayHistory.length === 0 ? (
          <div className="history-list">
            {newTaskCard}
            <div className="history-empty">{t("task.empty")}</div>
          </div>
        ) : (
          <div className="history-list">
            {newTaskCard}
            {displayHistory.map((entry) => {
              const isActive = activeEntryKey === entry.key;
              const isCurrentlyRunning = entry.key === runningEntryKey || entry.status === "running";
              const busy = loadingKey === entry.key;
              const pipeCount = Math.max(entry.pipelineCount ?? 0, isActive ? entryPipelines.length : 0);
              const multi = pipeCount > 1;
              const listExpanded = listExpandedKeys.includes(entry.key);
              const entryPipes = isActive ? entryPipelines : [];

              return (
                <div key={entry.key} className="history-item-wrap">
                  <div
                    className={`history-item status-${entry.status ?? "unknown"} ${isActive ? "selected" : ""} ${isCurrentlyRunning ? "current-run" : ""}`}
                    style={{ cursor: busy ? "wait" : "pointer" }}
                    title={t("task.openHint")}
                    onClick={() => {
                      if (busy) return;
                      if (isActive) {
                        deselectEntry();
                        resetFormDraft();
                        return;
                      }
                      void selectEntry(entry);
                    }}
                    onDoubleClick={() => {
                      // busy 常由前一次单击的 selectEntry 触发，此处不能因此吞掉双击
                      if (!isActive && !busy) void selectEntry(entry);
                      openTask(entry.key);
                    }}
                  >
                    {renderTimeRow(entry, {
                      running: isCurrentlyRunning,
                      toggle: multi ? (
                        <button
                          type="button"
                          className="hi-pipe-toggle"
                          title={t("tms.history.pipelinesToggle")}
                          onClick={(ev) => { ev.stopPropagation(); toggleListExpanded(entry.key); }}
                        >
                          {listExpanded ? "▾" : "▸"} {t("tms.history.pipelines", { n: pipeCount })}
                        </button>
                      ) : undefined,
                    })}
                    {renderInputRow(entry)}
                    {renderRouteRow(entry)}
                    {entry.hasCheckpoint && entry.lastCompletedStep && (
                      <div className="hi-cp-info">
                        {t("tms.history.checkpoint", {
                          step: tStepLabel(entry.lastCompletedStep, STEP_LABEL_MAP.get(entry.lastCompletedStep) ?? entry.lastCompletedStep),
                        })}
                      </div>
                    )}
                    {busy && <div className="hi-loading-indicator">{t("tms.history.loading")}</div>}
                  </div>

                  {multi && listExpanded && isActive && entryPipes.length > 0 && (
                    <div className="history-pipelines" role="list">
                      {entryPipes.map((p, i) => (
                        <button
                          key={p.pipelineId}
                          type="button"
                          role="listitem"
                          className={`history-pipeline-row ${activePipelineId === p.pipelineId ? "is-active" : ""} ${p.complete ? "" : "is-incomplete"}`}
                          onClick={(ev) => { ev.stopPropagation(); void switchActivePipeline(p.pipelineId); }}
                        >
                          <span className="hp-idx">{i + 1}</span>
                          <span className="hp-label">
                            {t("tms.history.pipelineLabel", { n: i + 1 })}
                            {!p.complete ? ` · ${t("tms.history.incomplete")}` : ""}
                          </span>
                          <span className="hp-meta">{p.agents?.length ?? 0} {t("tms.history.steps")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
