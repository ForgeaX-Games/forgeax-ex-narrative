import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  MapPin,
  GitBranch,
  MessageSquare,
  Film,
  FolderTree,
  ClipboardList,
  BookOpen,
  Drama,
  CornerDownRight,
  type LucideIcon,
} from "lucide-react";
import { useNarrativeStore } from "../../store/narrativeStore";
import type { EditDraft } from "../../store/narrativeStore";
import { useTypewriter } from "../../hooks/useTypewriter";
import { useOrderedSteps } from "../../hooks/useOrderedSteps";
import type { NarrativeContext, StoryNode, SceneNode, PlotSynopsis, QaReport } from "../../types";
import { STEP_CTX_FIELD, PIPELINE_STEPS } from "../../types";
import { ProgressRing } from "../controls/ProgressRing";
import { CenterHero } from "./CenterHero";
import { GenericObjectView, MarkdownBlock } from "../shared/GenericObjectView";
import { QaReportView } from "../shared/QaReportView";
import { dataToReadableText } from "../shared/dataReadable";
import { localizeTagSummary } from "../../i18n/tagSummary";
import { NodeActionBar, NodeUserInputBox, NodeEditTextarea } from "../shared/NodeEditActions";
import { useNodeEdit } from "../../hooks/useNodeEdit";
import { useTreeEdit } from "../../hooks/useTreeEdit";
import { notifyContentEdited } from "../../lib/bridge";
import { parseEditedText, restoreOriginal, saveStepEdit } from "../../lib/editPersist";
import { switchActivePipeline } from "../../lib/pipelineSwitch";
import { resolveStepDisplay, getStepIcon } from "../../utils/stepDisplay";
import type { EntryStatus } from "../../utils/stepDisplay";
import { findStepsContainingNodeId } from "../../utils/cross-step-node";
import { StageFileBrowser, fileGroupsForStep } from "../shared/StageFileBrowser";
import { useT, tStepLabel, tStepTags, tDisplayState, getLocale } from "../../i18n";
import { sceneLevelLabel } from "../../i18n/ui";

const STEP_LABEL_MAP = new Map(PIPELINE_STEPS.map((s) => [s.id, s.label]));

/** 跨步联动 chip 图标（lucide，与 Studio 产品图标规范一致） */
const CROSS_STEP_ICONS: Record<string, LucideIcon> = {
  branch_tree: GitBranch,
  dialogue_script: MessageSquare,
  cinematic_storyboard: Film,
  story_framework: FolderTree,
  outline_batch: ClipboardList,
  detailed_outline: BookOpen,
  plot_generation: Drama,
};


function resolveStepData(stepId: string, result: NarrativeContext | null): unknown {
  if (!result) return undefined;
  let field = STEP_CTX_FIELD[stepId];
  if (stepId === "script_generation") field = "jrpg_script";
  if (stepId === "scene_plan") field = "scene_map";
  if (stepId === "tier_router") field = "tier_detection";
  if (stepId === "core_concept") field = "core_concept";
  if (stepId === "system_architecture") field = "system_architecture";
  if (stepId === "system_detail") field = "system_details";
  if (stepId === "value_framework") field = "value_framework";
  if (stepId === "design_doc") field = "game_design_context";
  return field ? (result as Record<string, unknown>)[field] : undefined;
}

export function TextViewPanel() {
  const t = useT();
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const activeResult = useNarrativeStore((s) => s.activeResult);
  const expandedStepId = useNarrativeStore((s) => s.expandedStepId);
  const focusedChildNodeId = useNarrativeStore((s) => s.focusedChildNodeId);
  const setFocus = useNarrativeStore((s) => s.setFocus);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const setEditDraft = useNarrativeStore((s) => s.setEditDraft);
  const clearEditDraft = useNarrativeStore((s) => s.clearEditDraft);

  const activeSourceDir = useNarrativeStore((s) => s.activeSourceDir);
  const ipRunKey = useNarrativeStore((s) => s.ipRunKey);
  const ipPreviewRunId = useNarrativeStore((s) => s.ipPreviewRunId);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const entryPipelines = useNarrativeStore((s) => s.entryPipelines);
  const activePipelineId = useNarrativeStore((s) => s.activePipelineId);
  const isViewingRunning =
    activeEntryKey != null &&
    activeEntryKey === runningEntryKey &&
    (!!runningRunId || !!ipPreviewRunId || runningProgress.length > 0);
  // 环节文件浏览的运行键：半自动预览期用 ipRunKey（真实落盘键），历史回看用产物目录。
  // 用 activeSourceDir 而非 activeEntryKey：次管线的产物在 `<key>/pipelines/<pid>` 下，
  // 拿条目键去读会读到主管线那一份（见 docs/contracts.md §1.3）。
  const artifactDir = activeSourceDir ?? activeEntryKey;
  const fileRunKey = (isViewingRunning ? ipRunKey : artifactDir) ?? artifactDir;
  // 加载对象 + 顺序由 useOrderedSteps 统一计算（与可视化节点模式同源同序）。
  const steps = useOrderedSteps();
  const result = activeResult;
  // IP 半自动预览也设置了 runningEntryKey（见 startIpPreviewRun），故沿用同一判定即可。
  const isRunningState = isViewingRunning && !!runningEntryKey;
  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const entryStatus = isViewingRunning && runningEntryKey ? "running" as EntryStatus : activeEntryStatus;

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusedChildNodeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-node-id="${focusedChildNodeId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("node-highlight");
      const timer = setTimeout(() => el.classList.remove("node-highlight"), 2000);
      return () => clearTimeout(timer);
    }
  }, [focusedChildNodeId, expandedStepId]);

  useEffect(() => {
    if (!expandedStepId || !scrollRef.current) return;
    const timer = setTimeout(() => {
      const el = scrollRef.current?.querySelector(`[data-step-id="${expandedStepId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(timer);
  }, [expandedStepId]);

  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
      if (!nearBottom) {
        userScrolledRef.current = true;
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => { userScrolledRef.current = false; }, 3000);
      } else {
        userScrolledRef.current = false;
      }
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isRunningState || userScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [steps.length, isRunningState]);

  const animatingStepId = useNarrativeStore((s) => s.animatingStepId);
  const STORY_STEP_IDS = useMemo(() => new Set(
    PIPELINE_STEPS.filter((p) => p.type === "story").map((p) => p.id),
  ), []);

  const linkedStepIds = useMemo(
    () => focusedChildNodeId
      ? findStepsContainingNodeId(result, focusedChildNodeId, expandedStepId)
      : [],
    [result, focusedChildNodeId, expandedStepId],
  );

  /**
   * 整步编辑的落盘。
   *
   * 抛出去让 `StepCard` 接住：写失败时编辑框要留着，把人刚写的东西关掉再报错等于弄丢。
   * `data` 的类型决定编辑框里那段文本怎么解析回去 —— markdown 正文原样送，对象要 parse。
   */
  const persistStepEdit = async (
    stepId: string,
    data: unknown,
    content: string | undefined,
    userInput: string | undefined,
  ): Promise<void> => {
    if (!artifactDir) throw new Error("没有可写入的条目目录");
    if (content !== undefined) {
      const value = parseEditedText(content, typeof data === "string");
      await saveStepEdit({ sourceDir: artifactDir, stepId, editedContent: value, userInput });
    } else if (userInput?.trim()) {
      // 只写了"怎么改"没动正文：内容不落盘（没什么可落），但这条待办要留给 ⑥。
      await Promise.resolve();
    }
    setEditDraft(stepId, { content, userInput, editing: false, saved: true });
    notifyContentEdited({ stepId, hasUserInput: !!userInput?.trim(), sourceDir: artifactDir });
  };

  /** 还原整步原文。 */
  const restoreStep = async (stepId: string): Promise<void> => {
    if (!artifactDir) throw new Error("没有可还原的条目目录");
    await restoreOriginal({ sourceDir: artifactDir, stepId });
    clearEditDraft(stepId);
    notifyContentEdited({ stepId, hasUserInput: false, sourceDir: artifactDir });
  };

  if (!entryStatus && (!result || steps.length === 0)) {
    return (
      <div className="text-view empty-state">
        <CenterHero />
      </div>
    );
  }

  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="text-view" ref={scrollRef}>
      {isRunningState && (
        <div className="text-progress-bar">
          <ProgressRing progress={progress} size={40} />
          <span className="text-progress-label">
            {(() => {
              const running = steps.find((s) => s.status === "running");
              return running ? tStepLabel(running.id, running.label) : t("textView.preparing");
            })()}
          </span>
        </div>
      )}

      {focusedChildNodeId && linkedStepIds.length > 0 && (
        <div className="cross-step-link-bar" data-node-id={focusedChildNodeId}>
          <span className="cross-step-link-icon" aria-hidden>
            <MapPin size={14} />
          </span>
          <span className="cross-step-link-label">
            {t("textView.crossStepPrefix")} <code className="cross-step-link-node">{focusedChildNodeId}</code> {t("textView.crossStepAlso")}
          </span>
          {linkedStepIds.map((sid) => {
            const stepLabel = steps.find((st) => st.id === sid)?.label
              ? tStepLabel(sid, steps.find((st) => st.id === sid)!.label)
              : tStepLabel(sid, STEP_LABEL_MAP.get(sid) ?? sid);
            const Icon = CROSS_STEP_ICONS[sid] ?? CornerDownRight;
            return (
              <button
                key={sid}
                className="cross-step-link-chip"
                title={t("textView.crossStepJump", { step: stepLabel })}
                onClick={() => setFocus(sid, focusedChildNodeId)}
              >
                <span className="cross-step-link-chip-icon" aria-hidden>
                  <Icon size={12} />
                </span>
                <span className="cross-step-link-chip-label">{stepLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="step-card-list">
        {/* Phase-1：多管线时外包一层「大框」；小框仍是现有 StepCard */}
        {entryPipelines.length > 1 && (
          <div className="text-pipeline-tabs" role="tablist">
            {entryPipelines.map((p, i) => (
              <button
                key={p.pipelineId}
                type="button"
                role="tab"
                aria-selected={activePipelineId === p.pipelineId}
                className={`text-pipeline-tab ${activePipelineId === p.pipelineId ? "is-active" : ""}`}
                onClick={() => void switchActivePipeline(p.pipelineId)}
              >
                {t("textView.pipelineTab", { n: i + 1 })}
                {!p.complete ? ` · ${t("textView.incomplete")}` : ""}
              </button>
            ))}
          </div>
        )}
        {entryPipelines.length > 1 ? (
          entryPipelines.map((p, i) => {
            const open = activePipelineId === p.pipelineId || (!activePipelineId && i === 0);
            const agentIds = new Set(p.agents?.map((a) => a.agentId) ?? []);
            const pipeSteps = steps.filter(
              (s) => !s.id.startsWith("structure_validation") && (agentIds.size === 0 || agentIds.has(s.id)),
            );
            if (!open) return null;
            return (
              <div key={p.pipelineId} className="text-pipeline-box" data-pipeline-id={p.pipelineId}>
                <div className="text-pipeline-box__head">
                  {t("textView.pipelineBox", { n: i + 1 })}
                  <span className="text-pipeline-box__meta">
                    {pipeSteps.filter((s) => s.status === "completed").length}/{pipeSteps.length}
                  </span>
                </div>
                <div className="text-pipeline-box__body">
                  {pipeSteps.map((s) => {
                    const isExpanded = expandedStepId === s.id;
                    const data = s.data ?? resolveStepData(s.id, result);
                    const tags = tStepTags(s.id);
                    const isStory = STORY_STEP_IDS.has(s.id);
                    const isLocked = s.status === "running" && isRunningState && !isStory;
                    const isAnimating = animatingStepId === s.id;
                    const draft = editDrafts[s.id] as EditDraft | undefined;
                    const canEdit = (entryStatus === "completed" || entryStatus === "interrupted") && s.status === "completed";
                    const display = resolveStepDisplay(s.status, entryStatus, draft);
                    return (
                      <StepCard
                        key={`${p.pipelineId}:${s.id}`}
                        stepId={s.id}
                        label={s.label ? tStepLabel(s.id, s.label) : tStepLabel(s.id, STEP_LABEL_MAP.get(s.id) ?? s.id)}
                        stepStatus={s.status}
                        message={s.message}
                        tags={tags}
                        expanded={isExpanded}
                        data={data}
                        result={result}
                        fileRunKey={fileRunKey}
                        fileGroups={fileGroupsForStep(s.id)}
                        isRunning={s.status === "running" && isRunningState}
                        isLocked={isLocked}
                        isAnimating={isAnimating}
                        canEdit={canEdit}
                        draft={draft}
                        displayState={display}
                        onToggle={() => {
                          if (!isLocked) setFocus(isExpanded ? null : s.id);
                        }}
                        onStartEdit={() => setEditDraft(s.id, { editing: true })}
                        onSaveDraft={(content, userInput) => persistStepEdit(s.id, data, content, userInput)}
                        onRestore={() => restoreStep(s.id)}
                        onCancelEdit={() => clearEditDraft(s.id)}
                        onDraftChange={(content, userInput) => {
                          if (content !== undefined) setEditDraft(s.id, { content });
                          if (userInput !== undefined) setEditDraft(s.id, { userInput });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : steps.filter((s) => !s.id.startsWith("structure_validation")).map((s) => {
          const isExpanded = expandedStepId === s.id;
          const data = s.data ?? resolveStepData(s.id, result);
          const tags = tStepTags(s.id);
          const isStory = STORY_STEP_IDS.has(s.id);
          const isLocked = s.status === "running" && isRunningState && !isStory;
          const isAnimating = animatingStepId === s.id;
          const draft = editDrafts[s.id] as EditDraft | undefined;
          const canEdit = (entryStatus === "completed" || entryStatus === "interrupted") && s.status === "completed";
          const display = resolveStepDisplay(s.status, entryStatus, draft);

          return (
            <StepCard
              key={s.id}
              stepId={s.id}
              label={s.label ? tStepLabel(s.id, s.label) : tStepLabel(s.id, STEP_LABEL_MAP.get(s.id) ?? s.id)}
              stepStatus={s.status}
              message={s.message}
              tags={tags}
              expanded={isExpanded}
              data={data}
              result={result}
              fileRunKey={fileRunKey}
              fileGroups={fileGroupsForStep(s.id)}
              isRunning={s.status === "running" && isRunningState}
              isLocked={isLocked}
              isAnimating={isAnimating}
              canEdit={canEdit}
              draft={draft}
              displayState={display}
              onToggle={() => {
                if (!isLocked) setFocus(isExpanded ? null : s.id);
              }}
              onStartEdit={() => setEditDraft(s.id, { editing: true })}
              onSaveDraft={(content, userInput) => persistStepEdit(s.id, data, content, userInput)}
              onRestore={() => restoreStep(s.id)}
              onCancelEdit={() => clearEditDraft(s.id)}
              onDraftChange={(content, userInput) => {
                if (content !== undefined) setEditDraft(s.id, { content });
                if (userInput !== undefined) setEditDraft(s.id, { userInput });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function StepCard({
  stepId, label, stepStatus, message, tags, expanded, data, result, fileRunKey, fileGroups, isRunning, isLocked, isAnimating,
  canEdit, draft, displayState,
  onToggle, onStartEdit, onSaveDraft, onRestore, onCancelEdit, onDraftChange,
}: {
  stepId: string;
  label: string;
  stepStatus: string;
  message?: string;
  tags: string[];
  expanded: boolean;
  data: unknown;
  result: NarrativeContext | null;
  fileRunKey?: string | null;
  fileGroups?: string[];
  isRunning: boolean;
  isLocked?: boolean;
  isAnimating?: boolean;
  canEdit?: boolean;
  draft?: EditDraft;
  displayState: string;
  onToggle: () => void;
  onStartEdit?: () => void;
  /** 落盘。失败要 reject —— 编辑框据此留着不关。 */
  onSaveDraft?: (content?: string, userInput?: string) => void | Promise<void>;
  /** 还原原文（这一步改过才给）。 */
  onRestore?: () => void | Promise<void>;
  onCancelEdit?: () => void;
  onDraftChange?: (content?: string, userInput?: string) => void;
}) {
  const t = useT();
  const [showInput, setShowInput] = useState(false);
  const [localEditing, setLocalEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [userInputText, setUserInputText] = useState(draft?.userInput ?? "");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isInEditState = draft?.editing || localEditing;
  const statusIcon = getStepIcon(displayState as Parameters<typeof getStepIcon>[0]);

  const colorCls = isLocked ? " color-locked"
    : displayState === "editing" ? " color-editing"
    : displayState === "draft_ready" ? " color-modified"
    : isAnimating ? " color-fresh"
    : "";

  const displayBadge =
    displayState === "editing" ? t("display.editing") :
    displayState === "draft_ready" ? t("display.draft_ready") :
    displayState === "incomplete" ? t("display.incomplete") :
    null;

  // Backend emits step progress messages in Chinese (interpolating Chinese step
  // names). Since every message carries a stepId + status, re-derive a localized
  // message from the (already localized) label + status. Only transform raw
  // Chinese backend messages; leave already-localized/English text untouched.
  const locMessage = (() => {
    if (!message || !/[\u4e00-\u9fff]/.test(message)) return message;
    const mm = message.match(/(\d+)\s*\/\s*(\d+)/);
    if (stepStatus === "running") {
      if (mm) return t("msg.progressCount", { label, n: mm[1], m: mm[2] });
      if (/重新生成/.test(message)) return t("msg.regeneratingLabel", { label });
      return t("msg.generatingLabel", { label });
    }
    if (stepStatus === "completed") {
      if (/已恢复/.test(message)) return t("msg.stepRestored", { label });
      if (/已保留/.test(message)) return t("msg.stepKept", { label });
      return t("msg.stepDone", { label });
    }
    if (stepStatus === "failed") return t("msg.stepFailed", { label });
    return message;
  })();

  const handleEdit = () => {
    const textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    setEditContent(typeof draft?.content === "string" ? draft.content : textContent);
    setLocalEditing(true);
    setSaveError(null);
    onStartEdit?.();
  };

  /** 保存 = 真落盘。写成功才关编辑框，失败留着让人改完再存。 */
  const handleSave = () => {
    setBusy(true);
    setSaveError(null);
    void Promise.resolve(onSaveDraft?.(localEditing ? editContent : undefined, userInputText || undefined))
      .then(() => {
        setLocalEditing(false);
        setShowInput(false);
      })
      .catch((e: unknown) => setSaveError((e as Error).message))
      .finally(() => setBusy(false));
  };

  const handleRestore = () => {
    setBusy(true);
    setSaveError(null);
    void Promise.resolve(onRestore?.())
      .then(() => {
        setLocalEditing(false);
        setShowInput(false);
        setEditContent("");
        setUserInputText("");
      })
      .catch((e: unknown) => setSaveError((e as Error).message))
      .finally(() => setBusy(false));
  };

  const handleCancel = () => {
    setLocalEditing(false);
    setShowInput(false);
    setEditContent("");
    setUserInputText("");
    setSaveError(null);
    onCancelEdit?.();
  };

  return (
    <div className={`text-step-card status-${displayState}${colorCls} ${expanded ? "expanded" : ""}`} data-step-id={stepId}>
      <div className="tsc-header" onClick={onToggle} style={isLocked ? { cursor: "not-allowed" } : undefined}>
        <span className={`tsc-status-icon status-${displayState}`}>{statusIcon}</span>
        <span className="tsc-title">{label}</span>
        {displayBadge ? (
          <span className={`tsc-badge lifecycle-${displayState}`}>{displayBadge}</span>
        ) : (
          <span className={`tsc-badge status-${displayState}`}>{tDisplayState(displayState)}</span>
        )}
        {!isLocked && <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>}
        {isLocked && <span className="tsc-lock-icon">🔒</span>}
      </div>

      {!expanded && tags.length > 0 && (
        <div className="tsc-tags" onClick={onToggle}>
          {tags.map((t) => (
            <span key={t} className="tsc-tag">{t}</span>
          ))}
        </div>
      )}
      {!expanded && locMessage && (stepStatus === "running" || (stepStatus === "completed" && tags.length === 0)) && (
        <div className="tsc-running-msg">{locMessage}</div>
      )}
      {expanded && (
        <div className="tsc-body">
          {isInEditState ? (
            <textarea
              className="tsc-edit-textarea"
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                onDraftChange?.(e.target.value, undefined);
              }}
              rows={12}
            />
          ) : (
            <StreamingContent
              stepId={stepId}
              stepStatus={stepStatus}
              data={data}
              result={result}
              isRunning={isRunning}
              isAnimating={isAnimating}
              message={locMessage}
            />
          )}
          {fileGroups && fileGroups.length > 0 && (
            <StageFileBrowser runKey={fileRunKey ?? null} groups={fileGroups} />
          )}
        </div>
      )}

      {showInput && expanded && (
        <div className="tsc-user-input-box">
          <textarea
            className="tsc-user-input-textarea"
            placeholder={t("textView.userInputPlaceholder")}
            value={userInputText}
            onChange={(e) => {
              setUserInputText(e.target.value);
              onDraftChange?.(undefined, e.target.value);
            }}
            rows={3}
          />
        </div>
      )}

      {expanded && canEdit && (
        <div className="tsc-actions tsc-four-buttons">
          <button
            className={`tsc-action-btn edit${isInEditState ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); handleEdit(); }}
            title={t("textView.editTitle")}
            disabled={!!isInEditState}
          >
            {t("textView.edit")}
          </button>
          <button
            className={`tsc-action-btn input${showInput ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setShowInput(!showInput); }}
            title={t("textView.inputTitle")}
          >
            {t("textView.input")}
          </button>
          <button
            className="tsc-action-btn save"
            onClick={(e) => { e.stopPropagation(); handleSave(); }}
            title={t("textView.saveTitle")}
            disabled={busy || (!isInEditState && !userInputText.trim())}
          >
            {t("textView.save")}
          </button>
          {draft?.saved && onRestore && (
            <button
              className="tsc-action-btn restore"
              onClick={(e) => { e.stopPropagation(); handleRestore(); }}
              title={t("node.restore.hint")}
              disabled={busy}
            >
              {t("node.restore")}
            </button>
          )}
          <button
            className="tsc-action-btn cancel"
            onClick={(e) => { e.stopPropagation(); handleCancel(); }}
            title={t("textView.cancelTitle")}
            disabled={busy}
          >
            {t("textView.cancel")}
          </button>
        </div>
      )}
      {saveError && expanded && <div className="node-actions-error">{saveError}</div>}
    </div>
  );
}

function StreamingContent({
  stepId, stepStatus, data, result, isRunning, isAnimating, message,
}: {
  stepId: string;
  stepStatus: string;
  data: unknown;
  result: NarrativeContext | null;
  isRunning: boolean;
  isAnimating?: boolean;
  message?: string;
}) {
  const t = useT();
  const streamChunk = useNarrativeStore((s) => s.streamingChunks[stepId]);
  const streamPlayed = useNarrativeStore((s) => s.streamPlayedSteps.includes(stepId));
  const finishAnimation = useNarrativeStore((s) => s.finishAnimation);

  if (isRunning && streamChunk && !streamPlayed) {
    const isJson = stepId !== "preference_summary" && stepId !== "initial_outline";
    return (
      <div className="streaming-live">
        {isJson ? (
          <pre className="streaming-code">{streamChunk}<span className="cursor">|</span></pre>
        ) : (
          <div className="streaming-md">
            <MarkdownBlock text={streamChunk} />
            <span className="cursor">|</span>
          </div>
        )}
      </div>
    );
  }

  if (data && isAnimating && !streamPlayed) {
    return (
      <FirstViewTypewriter
        stepId={stepId}
        data={data}
        result={result}
        onComplete={() => finishAnimation(stepId)}
      />
    );
  }

  if (data) {
    return <StepRenderer stepId={stepId} data={data} result={result} isRunning={isRunning} />;
  }

  if (message) {
    return <div className="tsc-message">{message}</div>;
  }

  return (
    <div className="tsc-empty">
      {stepStatus === "running" ? t("textView.generating") : stepStatus === "pending" ? t("textView.waiting") : t("textView.noData")}
    </div>
  );
}

function FirstViewTypewriter({
  stepId, data, result, onComplete,
}: {
  stepId: string;
  data: unknown;
  result: NarrativeContext | null;
  onComplete: () => void;
}) {
  const t = useT();
  const fullText = useMemo(() => {
    const raw = dataToReadableText(data);
    return stepId === "input" ? localizeTagSummary(raw, t) : raw;
  }, [data, stepId, t]);
  const displayed = useTypewriter(fullText, true, 30);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!doneRef.current && displayed.length >= fullText.length) {
      doneRef.current = true;
      const timer = setTimeout(onComplete, 300);
      return () => clearTimeout(timer);
    }
  }, [displayed, fullText, onComplete]);

  if (displayed.length >= fullText.length) {
    return <StepRenderer stepId={stepId} data={data} result={result} isRunning={false} />;
  }

  return (
    <div className="streaming-reveal">
      <MarkdownBlock text={displayed} />
      <span className="cursor">|</span>
    </div>
  );
}

function StreamText({ text, isRunning }: { text: string; isRunning: boolean }) {
  const displayed = useTypewriter(text, isRunning, 30);
  if (isRunning && displayed.length < text.length) {
    return (
      <pre className="section-pre stream-text">
        {displayed}
        <span className="cursor">|</span>
      </pre>
    );
  }
  return <MarkdownBlock text={text} />;
}


// ══════════════════════════════════════════════════════════════════════════════
// Step renderer dispatch
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 按 stepId 分派到对应的可读渲染。
 *
 * 导出给 FilePreview 用：左栏点开一份产物时，那份产物走的是与文本视图**同一套**渲染，
 * 而不是另写一遍或干脆摊成 JSON。分派只认 stepId 与数据本身，`result` 给 null 也能工作
 * （落到数据驱动的那几支），所以能安全地渲染不属于当前那一跑的文件。
 */
export function StepRenderer({
  stepId, data, result, isRunning,
}: {
  stepId: string;
  data: unknown;
  result: NarrativeContext | null;
  isRunning: boolean;
}) {
  const t = useT();
  if (stepId === "preference_summary" && typeof data === "string") {
    return <StreamText text={data} isRunning={isRunning} />;
  }

  // 合并步骤 initial_plan：依次展示 outline / core_settings / plot_synopsis 三段。
  // 数据源优先级：result（最新）→ data（聚合对象，断点恢复时用）。
  if (stepId === "initial_plan") {
    return <InitialPlanView result={result} data={data} />;
  }

  if (stepId === "preference_analysis" && data && typeof data === "object") {
    return <PreferenceAnalysisView data={data as Record<string, unknown>} />;
  }

  if (stepId === "worldview" && result?.worldview_structure) {
    return <WorldviewView wv={result.worldview_structure} />;
  }

  // ── 向后兼容：老存档可能还存在独立的 initial_outline / core_settings / plot_synopsis 节点 ──
  // 当前主流程已合并为 initial_plan，但若用户直接访问老节点（例如旧存档 step_done 帧），仍能渲染。
  if (stepId === "initial_outline" && typeof data === "string") {
    return <StreamText text={data} isRunning={isRunning} />;
  }
  if (stepId === "core_settings" && result?.core_settings) {
    return <CoreSettingsView cs={result.core_settings} />;
  }
  if (stepId === "plot_synopsis" && result?.plot_synopsis) {
    return <PlotSynopsisView ps={result.plot_synopsis} />;
  }

  if (stepId === "story_framework" && result?.story_framework) {
    return (
      <div>
        <FullNodesTable
          nodes={result.story_framework.framework.nodes}
          nodeType="framework"
          stepId="story_framework"
        />
        {result.story_framework.dynamic_structure?.branch_groups &&
          result.story_framework.dynamic_structure.branch_groups.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <BranchStructureTitle />
            <GenericObjectView data={result.story_framework.dynamic_structure.branch_groups} />
          </div>
        )}
      </div>
    );
  }

  if (stepId === "outline_batch" && result?.outlines_generated) {
    const outlines = result.outlines_generated.outlines;
    return (
      <div>
        <FullNodesTable nodes={outlines} nodeType="outline" stepId="outline_batch" />
        <BranchSummary nodes={outlines} />
      </div>
    );
  }

  if (stepId === "detailed_outline" && result?.detailed_outlines_generated) {
    const detailedOutlines = result.detailed_outlines_generated.detailed_outlines;
    return (
      <div>
        <FullNodesTable nodes={detailedOutlines} nodeType="detailed" stepId="detailed_outline" />
        <BranchSummary nodes={detailedOutlines} />
      </div>
    );
  }

  if (stepId === "plot_generation" && result?.plots_generated) {
    return <FullNodesTable nodes={result.plots_generated.plots as unknown as StoryNode[]} nodeType="plot" stepId="plot_generation" />;
  }

  if (stepId === "character_enrichment" && result?.detailed_character_sheets) {
    return <FullCharactersView characters={result.detailed_character_sheets} />;
  }

  if (stepId === "item_database" && result?.item_database) {
    return <FullItemDatabaseView items={result.item_database} />;
  }

  if (stepId === "script_generation" && result?.jrpg_script) {
    return <FullScriptView script={result.jrpg_script} />;
  }

  if (stepId === "quest_generation" && result?.quest_graph) {
    return <FullQuestGraphView questGraph={result.quest_graph} />;
  }

  if (stepId === "scene_plan" && result?.scene_map) {
    return <FullSceneTreeView sceneMap={result.scene_map} />;
  }

  // 两个质检席：产物就是报告。逐条列出并给可修的那些配勾选框，
  // 「检查到修复」这一环靠它闭合（走 POST /api/narrative/qa/apply）。
  if ((stepId === "structure_check" || stepId === "content_check") && data && typeof data === "object") {
    return <QaReportStepView stepId={stepId} data={data} />;
  }

  // E1-02 三幕扩写：单步三输出（三幕大纲 + 人物小传 + 关键道具）。
  // 后端把三份子结构分别写入 vn_outline_acts / vn_character_bios / vn_key_items，
  // 这里合并展示，避免只看到剧情而漏掉人物与道具。
  if (stepId === "vn_outline_acts") {
    return <VnOutlineActsView result={result} data={data} />;
  }

  if (typeof data === "string") {
    const text = stepId === "input" ? localizeTagSummary(data, t) : data;
    return <StreamText text={text} isRunning={isRunning} />;
  }
  return <GenericObjectView data={data} />;
}

/**
 * 检查报告的接线层：报告本身由 `QaReportView` 渲染，这里只负责取条目目录。
 *
 * 单独一层是因为 `StepRenderer` 是条件分派的一长串 if，不能在里面调 hook；
 * 而修复要往哪个条目写，只有 store 知道。
 */
function QaReportStepView({ stepId, data }: { stepId: string; data: unknown }) {
  const activeSourceDir = useNarrativeStore((s) => s.activeSourceDir);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  return (
    <QaReportView
      stepId={stepId}
      report={data as QaReport}
      sourceDir={activeSourceDir ?? activeEntryKey}
    />
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Initial Plan (合并视图：outline + core_settings + plot_synopsis)
// ══════════════════════════════════════════════════════════════════════════════

interface InitialPlanData {
  initial_story_outline?: NarrativeContext["initial_story_outline"];
  core_settings?: NarrativeContext["core_settings"];
  plot_synopsis?: NarrativeContext["plot_synopsis"];
}

function BranchStructureTitle() {
  const t = useT();
  return <div className="result-section-title">{t("textView.branchStructure")}</div>;
}

function InitialPlanView({
  result, data,
}: {
  result: NarrativeContext | null;
  data: unknown;
}) {
  const t = useT();
  // 优先用 result（顶层 ctx，永远是最新），其次 data（断点续传时 step_done 携带的聚合对象）
  const aggregated = (data && typeof data === "object" ? data as InitialPlanData : null);
  const outline = result?.initial_story_outline ?? aggregated?.initial_story_outline ?? null;
  const cs = result?.core_settings ?? aggregated?.core_settings ?? null;
  const ps = result?.plot_synopsis ?? aggregated?.plot_synopsis ?? null;

  if (!outline && !cs && !ps) {
    return <div className="tsc-empty">{t("textView.noData")}</div>;
  }

  return (
    <div className="initial-plan-view">
      {outline && (
        <section className="ip-section">
          <h3 className="ip-title">📋 {t("textView.initialOutline")}</h3>
          <InitialOutlineSection outline={outline} />
        </section>
      )}
      {cs && (
        <section className="ip-section">
          <h3 className="ip-title">⚙️ {t("textView.coreSettings")}</h3>
          <CoreSettingsView cs={cs} />
        </section>
      )}
      {ps && (
        <section className="ip-section">
          <h3 className="ip-title">📖 {t("textView.plotSynopsis")}</h3>
          <PlotSynopsisView ps={ps} />
        </section>
      )}
    </div>
  );
}

function InitialOutlineSection({
  outline,
}: {
  outline: NonNullable<NarrativeContext["initial_story_outline"]>;
}) {
  const t = useT();
  return (
    <div className="initial-outline-section">
      <div className="ip-row"><span className="ip-label">{t("field.theme")}</span><span>{outline.theme ?? "—"}</span></div>
      {outline.background && <div className="ip-row"><span className="ip-label">{t("field.background")}</span><span>{outline.background}</span></div>}
      {outline.character_arc && <div className="ip-row"><span className="ip-label">{t("field.characterArc")}</span><span>{outline.character_arc}</span></div>}
      {outline.main_conflict && <div className="ip-row"><span className="ip-label">{t("field.mainConflict")}</span><span>{outline.main_conflict}</span></div>}
      {outline.story_structure && (
        <div className="ip-substruct">
          <div className="ip-label">{t("field.storyStructure")}</div>
          {outline.story_structure.opening && <div>· {t("field.opening")}：{outline.story_structure.opening}</div>}
          {outline.story_structure.development?.length > 0 && (
            <ul>{outline.story_structure.development.map((d: string, i: number) => <li key={i}>· {t("field.development")}：{d}</li>)}</ul>
          )}
          {outline.story_structure.ending && <div>· {t("field.ending")}：{outline.story_structure.ending}</div>}
        </div>
      )}
      {outline.key_plot_points?.length > 0 && (
        <div className="ip-substruct">
          <div className="ip-label">{t("field.keyPlotPoints")}</div>
          <ul>{outline.key_plot_points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Core Settings (full view)
// ══════════════════════════════════════════════════════════════════════════════

function CoreSettingsView({ cs }: { cs: NonNullable<NarrativeContext["core_settings"]> }) {
  const t = useT();
  return (
    <div>
      <KV label={t("field.worldName")} value={cs.world_name} />
      <KV label={t("field.background")} value={cs.world_setting} />
      <KV label={t("field.theme")} value={cs.main_theme} />
      <KV label={t("field.mainConflict")} value={cs.main_conflict} />
      <KV label={t("field.genre")} value={cs.genre} />
      <KV label={t("field.narrativePerspective")} value={cs.narrative_perspective} />
      {cs.protagonist && (
        <div className="sub-section">
          <div className="result-section-title">{t("field.protagonist")}</div>
          <KV label={t("field.name")} value={cs.protagonist.name} />
          <KV label={t("field.identity")} value={cs.protagonist.identity} />
          <KV label={t("field.personality")} value={cs.protagonist.personality} />
          <KV label={t("field.coreConflict")} value={cs.protagonist.core_conflict} />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// E1-02 三幕扩写（三幕大纲 + 人物小传 + 关键道具，单步三输出合并视图）
// ══════════════════════════════════════════════════════════════════════════════

interface VnAct { act_id?: string; act_name?: string; content?: string }
interface VnOutlineActsData { title?: string; central_theme?: string; acts?: VnAct[] }
interface VnCharacterBio {
  name?: string; role?: string; identity?: string;
  external_motivation?: string; internal_motivation?: string;
  arc?: string; voice?: string; visual?: string;
}
interface VnKeyItemData {
  name?: string; category?: string; description?: string;
  narrative_function?: string; bound_character?: string;
  act_appearance?: string[]; symbolism?: string;
}

function VnOutlineActsView({ result, data }: { result: NarrativeContext | null; data: unknown }) {
  const t = useT();
  const ctx = result as Record<string, unknown> | null;
  // 优先从 result 读三个独立字段；断点恢复时退回 data（聚合对象或仅三幕）。
  const fallback = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const outline = (ctx?.vn_outline_acts ?? fallback.outline_acts ?? fallback) as VnOutlineActsData;
  const bios = (ctx?.vn_character_bios ?? fallback.character_bios) as { characters?: VnCharacterBio[] } | undefined;
  const keyItems = (ctx?.vn_key_items ?? fallback.key_items) as { items?: VnKeyItemData[] } | undefined;

  const characters = bios?.characters ?? [];
  const items = keyItems?.items ?? [];

  return (
    <div>
      {/* ── 三幕大纲 ── */}
      <div className="sub-section">
        <div className="result-section-title">📖 {t("textView.threeActOutline")}</div>
        {outline?.title && <KV label={t("field.title")} value={outline.title} />}
        {outline?.central_theme && <KV label={t("field.centralTheme")} value={outline.central_theme} />}
        {(outline?.acts ?? []).map((act, i) => (
          <ProseBlock
            key={i}
            title={`${t("field.act", { n: act.act_id ?? i + 1 })} · ${act.act_name ?? ""}`}
            text={act.content ?? ""}
            color="green"
          />
        ))}
      </div>

      {characters.length > 0 && (
        <div className="sub-section">
          <div className="result-section-title">👥 {t("textView.characterBios", { n: characters.length })}</div>
          {characters.map((c, i) => (
            <div key={i} className="prose-block">
              <div className="prose-block-title prose-title-gold">
                {c.name ?? t("textView.characterDefault", { n: i + 1 })}{c.role ? ` · ${c.role}` : ""}
              </div>
              {c.identity && <KV label={t("field.identity")} value={c.identity} />}
              {c.external_motivation && <KV label={t("field.externalDrive")} value={c.external_motivation} />}
              {c.internal_motivation && <KV label={t("field.internalDrive")} value={c.internal_motivation} />}
              {c.arc && <KV label={t("field.arc")} value={c.arc} />}
              {c.voice && <KV label={t("field.voice")} value={c.voice} />}
              {c.visual && <KV label={t("field.visual")} value={c.visual} />}
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="sub-section">
          <div className="result-section-title">🗝 {t("textView.keyItemsSection", { n: items.length })}</div>
          {items.map((it, i) => (
            <div key={i} className="prose-block">
              <div className="prose-block-title prose-title-blue">
                {it.name ?? t("textView.itemDefault", { n: i + 1 })}{it.category ? ` · ${it.category}` : ""}
              </div>
              {it.description && <KV label={t("field.description")} value={it.description} />}
              {it.narrative_function && <KV label={t("field.narrativeFunction")} value={it.narrative_function} />}
              {it.bound_character && <KV label={t("field.boundCharacter")} value={it.bound_character} />}
              {it.act_appearance?.length ? <KV label={t("field.appearanceActs")} value={it.act_appearance.join("、")} /> : null}
              {it.symbolism && <KV label={t("field.symbolism")} value={it.symbolism} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Preference Analysis (42 dimensions)
// ══════════════════════════════════════════════════════════════════════════════

function PreferenceAnalysisView({ data }: { data: Record<string, unknown> }) {
  const t = useT();
  const gcp = data["全局控制参数"] as Record<string, unknown> | undefined;
  const sections: Array<{ labelKey: string; key: string }> = [
    { labelKey: "pref.section.worldview", key: "世界观维度" },
    { labelKey: "pref.section.frameworkL0", key: "框架层维度_L0" },
    { labelKey: "pref.section.outlineL1", key: "大纲层维度_L1" },
    { labelKey: "pref.section.detailedL2", key: "细纲层维度_L2" },
  ];

  return (
    <div>
      {gcp && (
        <div className="sub-section">
          <div className="result-section-title">{t("pref.section.globalControl")}</div>
          <KV label={t("textView.complexity")} value={String(gcp.complexity ?? "-")} />
          <KV label={t("textView.deviation")} value={gcp.deviation !== undefined ? Number(gcp.deviation).toFixed(2) : String(gcp.deviation_direction ?? "-")} />
        </div>
      )}
      {sections.map((sec) => {
        const slots = data[sec.key] as Record<string, Record<string, unknown>> | undefined;
        if (!slots || !Object.keys(slots).length) return null;
        return (
          <div key={sec.key} className="sub-section">
            <div className="result-section-title">{t(sec.labelKey)}</div>
            {Object.entries(slots).map(([k, v]) => (
              <div key={k} className="wv-slot-row">
                <span className="wv-slot-key">{k} {String(v.slot_name ?? "")}</span>
                <span className="wv-slot-val">
                  {String(v.user_preference ?? v.content ?? v.description ?? "")}
                  {v.entropy != null && (
                    <span style={{ marginLeft: 8, fontSize: "var(--text-caption)", color: "color-mix(in srgb, var(--color-status-success) 40%, transparent)" }}>
                      H={String(Number(v.entropy).toFixed(2))}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Worldview (layered slots)
// ══════════════════════════════════════════════════════════════════════════════

function WorldviewView({ wv }: { wv: NarrativeContext["worldview_structure"] }) {
  const t = useT();
  if (!wv) return null;
  const layers: Array<{ key: string; labelKey: string }> = [
    { key: "基础架构层", labelKey: "textView.worldArchitecture" },
    { key: "交互叙事层", labelKey: "textView.interactiveNarrative" },
  ];

  return (
    <div>
      <KV label={t("field.worldName")} value={wv.world_name} />
      {wv.worldview_title && <KV label={t("field.title")} value={wv.worldview_title} />}
      {layers.map(({ key, labelKey }) => {
        const slots = (wv as Record<string, unknown>)[key] as Record<string, Record<string, unknown>> | undefined;
        if (!slots || !Object.keys(slots).length) return null;
        return (
          <div key={key} className="sub-section">
            <div className="result-section-title">{t(labelKey)}</div>
            {Object.entries(slots).map(([k, v]) => {
              const parts = k.split("_");
              const slotId = parts.slice(0, 2).join("_");
              const slotName = parts.slice(2).join("");
              const desc = String(
                typeof v === "object" && v
                  ? ((v as Record<string, unknown>).description ?? (v as Record<string, unknown>).content ?? JSON.stringify(v, null, 2))
                  : v,
              );
              return (
                <div key={k} className="wv-slot-row">
                  <span className="wv-slot-key">{slotId} {slotName}</span>
                  <span className="wv-slot-val">{desc}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {Array.isArray((wv as Record<string, unknown>)["核心规则"]) && (
        <div className="sub-section">
          <div className="result-section-title">{t("textView.coreRules")}</div>
          {((wv as Record<string, unknown>)["核心规则"] as Array<{ rule_name: string; rule_content: string }>).map((r, i) => (
            <div key={i} className="wv-slot-row">
              <span className="wv-slot-key">{r.rule_name}</span>
              <span className="wv-slot-val">{r.rule_content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Nodes Table (framework / outline / detailed / plot)
// ══════════════════════════════════════════════════════════════════════════════

function FullNodesTable({
  nodes,
  nodeType,
  stepId,
}: {
  nodes: StoryNode[];
  nodeType: "framework" | "outline" | "detailed" | "plot";
  stepId?: string;
}) {
  const t = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const tree = useTreeEdit(stepId);
  const edit = useNodeEdit(stepId ?? "");

  if (!nodes || nodes.length === 0) return <p className="section-text">{t("textView.noNodes")}</p>;

  return (
    <div className="nodes-table node-card-list">
      {nodes.map((raw) => {
        const n = raw as unknown as Record<string, unknown>;
        const nodeId = String(n.node_id ?? "");
        const name = String(n.name ?? n.title ?? "");
        const expanded = expandedId === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const isBranch = !!n.is_branch;
        const prevNode = (n.prev_node as string[]) ?? [];
        const nextNode = (n.next_node as string[]) ?? [];
        const se = n.story_elements as Record<string, unknown> | undefined;
        const bc = n.boundary_constraints as Record<string, string> | undefined;
        const jrpg = n.jrpg_elements as Record<string, unknown> | undefined;
        const charArcs = n.character_arcs as Array<Record<string, string>> | undefined;
        const operators = n.operators_used as Array<Record<string, string>> | undefined;
        const content = String(n.main_content ?? n.content ?? "");
        const funcText = nodeType === "plot"
          ? String(jrpg?.chapter_type ?? "")
          : String(n.narrative_function ?? "");
        const stage = String(n.narrative_stage ?? n.stage_type ?? "");
        const tension = se?.tension_level;

        const funcParts: string[] = [];
        if (funcText) funcParts.push(funcText);
        if (stage) funcParts.push(t("textView.stagePrefix", { value: stage }));
        if (tension != null) funcParts.push(t("textView.tensionPrefix", { value: String(tension) }));
        if (se?.conflict_type) funcParts.push(t("textView.conflictPrefix", { value: String(se.conflict_type) }));
        if (se?.stakes) funcParts.push(t("textView.stakesPrefix", { value: String(se.stakes) }));

        return (
          <div
            key={nodeId}
            data-node-id={nodeId}
            className={`node-card clickable ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="node-card-header" onClick={() => setExpandedId(expanded ? null : nodeId)}>
              <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>
              <span className="node-id">{nodeId}{isBranch ? " ⑂" : ""}</span>
              <span className="node-name">{name}</span>
              {tension != null && <span className="node-badge tension">{t("textView.tensionBadge", { value: String(tension) })}</span>}
              {isBranch && <span className="node-badge branch">{t("textView.branch")}</span>}
              {stage && <span className="node-badge">{stage}</span>}
              <span className="tsc-badge status-completed">{tDisplayState("completed")}</span>
            </div>
            {funcParts.length > 0 && expanded && (
              <div className="nti-func-bar">{funcParts.join(" · ")}</div>
            )}
            {expanded && (
              <div className="node-expanded-content">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} />
                ) : (
                  <>
                    {content && <p className="section-text">{content}</p>}
                    {se && <StoryElementsBlock se={se} />}
                    {bc && (
                      <div className="nti-extra-block blue">
                        {bc.cause && <div><LabelSpan color="blue">{t("textView.causeConstraint")}</LabelSpan> {bc.cause}</div>}
                        {bc.result && <div><LabelSpan color="blue">{t("textView.resultConstraint")}</LabelSpan> {bc.result}</div>}
                      </div>
                    )}
                    {jrpg && <JrpgElementsBlock jrpg={jrpg} />}
                    {charArcs && charArcs.length > 0 && (
                      <div className="nti-extra-block">
                        <LabelSpan>{t("textView.charArc")}</LabelSpan>
                        {charArcs.map((a, i) => (
                          <div key={i}>{a.character_name ?? a.character ?? ""}: {a.emotional_state ?? ""} → {a.growth ?? a.arc_description ?? ""}</div>
                        ))}
                      </div>
                    )}
                    {operators && operators.length > 0 && (
                      <div className="nti-extra-block dim">
                        <LabelSpan>{t("textView.operators")}</LabelSpan>
                        {operators.map((o, i) => (
                          <div key={i}>{o.name ?? ""}{o.slot_id ? ` (${o.slot_id})` : ""}{o.effect ? ` — ${o.effect}` : ""}</div>
                        ))}
                      </div>
                    )}
                    {(prevNode.length > 0 || nextNode.length > 0) && (
                      <div className="nti-conn">
                        {prevNode.length > 0 && <span>← {prevNode.join(", ")}</span>}
                        {prevNode.length > 0 && nextNode.length > 0 && <span>{"  "}</span>}
                        {nextNode.length > 0 && <span>→ {nextNode.join(", ")}</span>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <>
                <NodeActionBar
                  nodeId={nodeId}
                  edit={edit}
                  editData={n}
                />
                {tree.enabled && (
                  <TreeNodeActions
                    tree={tree}
                    nodeId={nodeId}
                    nextNodeIds={nextNode}
                    existingIds={nodes.map((x) => String((x as unknown as Record<string, unknown>).node_id ?? ""))}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
      {tree.enabled && tree.message && <div className="tree-crud-message">{tree.message}</div>}
    </div>
  );
}

/**
 * 剧情树的增删。
 *
 * 与编辑分成两排键：编辑改的是**这个节点写了什么**，增删改的是**树上有几个节点、怎么连**。
 * 混成一排会让"保存"与"删除"挨在一起，那是个很容易点错且不可撤销的邻居。
 */
function TreeNodeActions({
  tree,
  nodeId,
  nextNodeIds,
  existingIds,
}: {
  tree: ReturnType<typeof useTreeEdit>;
  nodeId: string;
  nextNodeIds: string[];
  existingIds: string[];
}) {
  const t = useT();
  return (
    <div className="tsc-actions node-actions tree-crud-actions">
      <button
        className="tsc-action-btn tree-add"
        title={t("tree.addAfter.hint")}
        disabled={tree.busy}
        onClick={(e) => { e.stopPropagation(); tree.addAfter(nodeId, nextNodeIds, existingIds); }}
      >
        {t("tree.addAfter")}
      </button>
      <button
        className="tsc-action-btn tree-delete"
        title={t("tree.delete.hint")}
        disabled={tree.busy}
        onClick={(e) => { e.stopPropagation(); tree.remove(nodeId); }}
      >
        {t("tree.delete")}
      </button>
    </div>
  );
}

function BranchSummary({ nodes }: { nodes: StoryNode[] }) {
  const t = useT();
  const branchNodes = nodes.filter((n) => {
    const r = n as unknown as Record<string, unknown>;
    return !!r.is_branch;
  });
  if (branchNodes.length === 0) return null;

  const byParent = new Map<string, string[]>();
  for (const n of branchNodes) {
    const r = n as unknown as Record<string, unknown>;
    const pid = String(r.parent_id ?? "root");
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(String(r.node_id ?? r.name ?? ""));
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="result-section-title">{t("textView.branchNodes", { n: branchNodes.length })}</div>
      <div className="nti-extra-block">
        {Array.from(byParent.entries()).map(([parentId, children]) => (
          <div key={parentId}>
            <span className="node-badge branch">{t("textView.parentNode", { id: parentId })}</span>
            {" → "}
            {children.map((c, i) => (
              <span key={c}>
                {i > 0 && " / "}
                <span className="node-id">{c}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryElementsBlock({ se }: { se: Record<string, unknown> }) {
  const t = useT();
  const plot = se.plot as Record<string, string> | undefined;
  const parts: JSX.Element[] = [];

  if (plot) {
    if (plot.cause) parts.push(<div key="cause"><LabelSpan>{t("textView.cause")}</LabelSpan> {plot.cause}</div>);
    if (plot.process) parts.push(<div key="process"><LabelSpan>{t("textView.process")}</LabelSpan> {plot.process}</div>);
    if (plot.result) parts.push(<div key="result"><LabelSpan>{t("textView.result")}</LabelSpan> {plot.result}</div>);
  }
  if (se.atmosphere) parts.push(<div key="atm"><LabelSpan color="gold">{t("textView.atmosphere")}</LabelSpan> {String(se.atmosphere)}</div>);
  if (se.dialogue_hint) parts.push(<div key="dlg"><LabelSpan color="gold">{t("textView.dialogueHint")}</LabelSpan> {String(se.dialogue_hint)}</div>);
  if (se.monologue_hint) parts.push(<div key="mono"><LabelSpan color="gold">{t("textView.monologueHint")}</LabelSpan> {String(se.monologue_hint)}</div>);
  if (se.narration_hint) parts.push(<div key="nar"><LabelSpan color="gold">{t("textView.narrationHint")}</LabelSpan> {String(se.narration_hint)}</div>);
  if (se.turning_point) parts.push(<div key="turn"><LabelSpan color="gold">{t("textView.turningPoint")}</LabelSpan> {String(se.turning_point)}</div>);

  if (parts.length === 0) return null;
  return <div className="nti-extra-block">{parts}</div>;
}

function JrpgElementsBlock({ jrpg }: { jrpg: Record<string, unknown> }) {
  const t = useT();
  const parts: JSX.Element[] = [];

  if (jrpg.scene_location)
    parts.push(<div key="loc"><LabelSpan color="gold">{t("textView.scene")}</LabelSpan> {String(jrpg.scene_location)}</div>);
  const locs = jrpg.scene_locations as string[] | undefined;
  if (locs?.length)
    parts.push(<div key="locs"><LabelSpan color="gold">{t("textView.sceneList")}</LabelSpan> {locs.join("、")}</div>);
  const chars = jrpg.scene_characters as string[] | undefined;
  if (chars?.length)
    parts.push(<div key="chars"><LabelSpan color="gold">{t("textView.characters")}</LabelSpan> {chars.join("、")}</div>);
  const keyItems = jrpg.key_items as string[] | undefined;
  if (keyItems?.length)
    parts.push(<div key="items"><LabelSpan color="gold">{t("textView.keyItems")}</LabelSpan> {keyItems.join("、")}</div>);
  const narHints = jrpg.narration_hints as string[] | undefined;
  if (narHints?.length)
    parts.push(<div key="narh"><LabelSpan color="gold">{t("textView.narrationHints")}</LabelSpan> {narHints.join("；")}</div>);
  if (jrpg.bgm_hint)
    parts.push(<div key="bgm"><LabelSpan color="gold">{t("textView.bgm")}</LabelSpan> {String(jrpg.bgm_hint)}</div>);
  if (jrpg.camera_hint)
    parts.push(<div key="cam"><LabelSpan color="gold">{t("textView.camera")}</LabelSpan> {String(jrpg.camera_hint)}</div>);
  const trigger = jrpg.trigger as Record<string, string> | undefined;
  if (trigger?.condition || trigger?.event)
    parts.push(<div key="trig"><LabelSpan color="blue">{t("textView.trigger")}</LabelSpan> {trigger?.condition ?? ""} / {trigger?.event ?? ""}</div>);
  const completion = jrpg.completion as Record<string, string> | undefined;
  if (completion?.condition || completion?.event)
    parts.push(<div key="comp"><LabelSpan color="blue">{t("textView.completion")}</LabelSpan> {completion?.condition ?? ""} / {completion?.event ?? ""}</div>);
  const dialogues = jrpg.dialogue_segments as Array<Record<string, string>> | undefined;
  if (dialogues?.length) {
    parts.push(
      <div key="dlgs" className="nti-dialogue-block">
        <LabelSpan color="gold">{t("textView.dialogue")}</LabelSpan>
        {dialogues.map((d, i) => (
          <div key={i} className="nti-dialogue-line">
            <span className="nti-dlg-speaker">{d.speaker ?? ""}</span>
            {d.emotion && <span className="nti-dlg-emotion">[{d.emotion}]</span>}
            : {d.text ?? ""}
          </div>
        ))}
      </div>,
    );
  }

  if (parts.length === 0) return null;
  return <div className="nti-extra-block gold-border">{parts}</div>;
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Characters View (rich card like old version)
// ══════════════════════════════════════════════════════════════════════════════

function FullCharactersView({ characters }: { characters: NarrativeContext["detailed_character_sheets"] }) {
  const t = useT();
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const edit = useNodeEdit("character_enrichment");
  if (!characters) return null;

  return (
    <div className="char-grid-text">
      {characters.map((c) => {
        const nodeId = c.name;
        const expanded = expandedName === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const r = c as Record<string, unknown>;
        const isMain = c.label === "主角";
        const isPlayer = r._is_player as boolean | undefined;
        const ocean = r.ocean_personality_model as Record<string, number> | undefined;
        const desc = r.description as Record<string, unknown> | undefined;
        const appearance = String(desc?.appearance_description ?? "");
        const locDesc = typeof desc?.location_description === "object"
          ? Object.values(desc.location_description as Record<string, string>).filter(Boolean).join("、")
          : String(desc?.location_description ?? "");
        const arcSpec = typeof c.character_arc_spectrum === "object"
          ? `${(c.character_arc_spectrum as Record<string, string>).start_state ?? ""} → ${(c.character_arc_spectrum as Record<string, string>).end_state ?? ""}`
          : String(c.character_arc_spectrum ?? "");
        const bgInfo = String(r.background_information ?? "");
        const archetype = c.archetype_analysis as Record<string, string> | undefined;
        const psych = c.psychological_drivers as Record<string, string> | undefined;
        const theme = r.character_theme as Record<string, string> | undefined;
        const voice = r.voice_and_mannerisms as Record<string, unknown> | undefined;
        const sigPhrases = voice?.signature_phrases as string[] | undefined;
        const gm = c.game_mechanics as Record<string, unknown> | undefined;
        const gmBase = gm?.base_stats as Record<string, unknown> | undefined;
        const rels = r.relationships as Record<string, unknown[]> | undefined;
        const relationships: string[] = [];
        if (rels?.family_relationships?.length)
          relationships.push(`${t("char.relationship.family")}: ${(rels.family_relationships as Array<Record<string, string>>).map((rel) => rel.name ?? rel.character ?? "").join("、")}`);
        if (rels?.social_relationships?.length)
          relationships.push(`${t("char.relationship.social")}: ${(rels.social_relationships as Array<Record<string, string>>).map((rel) => rel.name ?? rel.character ?? "").join("、")}`);
        const benefitRels = r.benefit_based_relationships as Array<Record<string, string>> | undefined;
        if (benefitRels?.length)
          relationships.push(`${t("char.relationship.benefit")}: ${benefitRels.map((rel) => `${rel.name ?? ""}(${rel.relationship ?? ""})`).join("、")}`);
        const abilities = Array.isArray(r.special_abilities) ? (r.special_abilities as string[]).join("、") : String(r.special_abilities ?? "");

        return (
          <div
            key={nodeId}
            className={`char-card-text ${isMain ? "main" : "npc"} ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="char-card-header" onClick={() => setExpandedName(expanded ? null : nodeId)}>
              <span className="char-toggle">{expanded ? "▾" : "▸"}</span>
              <span className="char-label-badge">{c.label}{isPlayer ? " 🎮" : ""}</span>
              <strong className="char-card-name">{c.name}</strong>
              {r.occupation ? <span className="char-card-occ">{String(r.occupation)}</span> : null}
            </div>
            {!expanded && (
              <div className="char-card-meta">
                {[r.race, r.gender, r.age != null && r.age !== "" ? t("textView.ageYears", { n: String(r.age) }) : ""].filter(Boolean).map(String).join(" · ")}
              </div>
            )}

            {expanded && (
              <div className="char-card-detail">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={15} />
                ) : (
                  <>
                    <div className="char-card-meta">
                      {[r.race, r.gender, r.age != null && r.age !== "" ? t("textView.ageYears", { n: String(r.age) }) : ""].filter(Boolean).map(String).join(" · ")}
                    </div>
                    {c.role_in_story && <div className="char-card-role">{c.role_in_story}</div>}
                    {(r.birthplace as string) && <CharRow label={t("char.birth")} value={String(r.birthplace)} />}
                    {appearance && <CharRow label={t("char.appearance")} value={appearance} />}
                    {locDesc && <CharRow label={t("char.haunt")} value={locDesc} />}
                    {(r.activity_locations as string[])?.length > 0 && <CharRow label={t("char.activityLocations")} value={(r.activity_locations as string[]).join("、")} />}
                    {(r.story_importance as string) && <CharRow label={t("char.importance")} value={String(r.story_importance)} />}
                    {psych?.core_motivation && <CharRow label={t("char.motivation")} value={psych.core_motivation} />}
                    {psych?.core_fear && <CharRow label={t("char.fear")} value={psych.core_fear} />}
                    {(r.decisive_past_event as string) && <CharRow label={t("char.decisivePast")} value={String(r.decisive_past_event)} />}
                    {arcSpec && <CharRow label={t("field.arc")} value={arcSpec} />}
                    {archetype?.core_archetype && <CharRow label={t("char.archetype")} value={`${archetype.core_archetype}${archetype.surface_archetype ? " / " + archetype.surface_archetype : ""}`} />}
                    {(r.archetype_conflict as string) && <CharRow label={t("char.archetypeConflict")} value={String(r.archetype_conflict)} />}
                    {(r.performance_archetype as string) && <CharRow label={t("char.performanceArchetype")} value={String(r.performance_archetype)} />}
                    {abilities && <CharRow label={t("char.abilities")} value={abilities} />}
                    {relationships.length > 0 && <CharRow label={t("char.relationships")} value={relationships.join("；")} />}
                    {(r.behavior_settings as string) && <CharRow label={t("char.behavior")} value={String(r.behavior_settings)} />}
                    {sigPhrases?.length && <CharRow label={t("char.catchphrase")} value={sigPhrases.join("；")} />}
                    {(r.voice_strength as string) && <CharRow label={t("char.voiceLine")} value={String(r.voice_strength)} />}
                    {(r.verbal_tics as string) && <CharRow label={t("char.verbalTic")} value={String(r.verbal_tics)} />}
                    {(r.speech_patterns as string) && <CharRow label={t("char.speechPattern")} value={String(r.speech_patterns)} />}
                    {(r.dialogue_style as string) && <CharRow label={t("char.dialogueStyle")} value={String(r.dialogue_style)} />}
                    {(r.symbolic_meaning as string) && <CharRow label={t("field.symbolism")} value={String(r.symbolic_meaning)} />}
                    {theme?.central_theme && <CharRow label={t("field.theme")} value={theme.central_theme} />}
                    {bgInfo && <CharRow label={t("field.background")} value={bgInfo} />}
                    {(() => {
                      const pl = r.personal_life as Record<string, unknown> | undefined;
                      if (!pl) return null;
                      const likes = Array.isArray(pl.likes) ? (pl.likes as string[]).join("、") : "";
                      const dislikes = Array.isArray(pl.dislikes) ? (pl.dislikes as string[]).join("、") : "";
                      const habits = Array.isArray(pl.habits) ? (pl.habits as string[]).join("、") : "";
                      const bonds = Array.isArray(pl.independent_bonds)
                        ? (pl.independent_bonds as Array<Record<string, string>>).map(b => `${b.name}(${b.relationship}: ${b.detail})`).join("；")
                        : "";
                      return (
                        <>
                          {likes && <CharRow label={t("char.likes")} value={likes} />}
                          {dislikes && <CharRow label={t("char.dislikes")} value={dislikes} />}
                          {habits && <CharRow label={t("char.habits")} value={habits} />}
                          {(pl.speech_pattern as string) && <CharRow label={t("char.speakingStyle")} value={String(pl.speech_pattern)} />}
                          {(pl.personal_item as string) && <CharRow label={t("char.personalItem")} value={String(pl.personal_item)} />}
                          {(pl.private_wish as string) && <CharRow label={t("char.privateWish")} value={String(pl.private_wish)} />}
                          {(pl.vulnerability as string) && <CharRow label={t("char.vulnerability")} value={String(pl.vulnerability)} />}
                          {bonds && <CharRow label={t("char.privateBonds")} value={bonds} />}
                        </>
                      );
                    })()}
                    {gmBase && (
                      <CharRow label={t("char.stats")} value={`HP:${gmBase.hp ?? "-"} ATK:${gmBase.attack ?? "-"} DEF:${gmBase.defense ?? "-"} MAG:${gmBase.magic ?? "-"} Lv.${gm?.level ?? 1}${gm?.exp != null ? ` EXP:${gm.exp}` : ""}${gm?.money != null ? ` G:${gm.money}` : ""}`} />
                    )}
                    {ocean && (
                      <div className="char-ocean">
                        {(["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"] as const).map((k) => (
                          <span key={k} className="ocean-badge">{k.slice(0, 3).toUpperCase()} {ocean[k] ?? "-"}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <NodeActionBar
                nodeId={nodeId}
                edit={edit}
                editData={c}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CharRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="char-detail-row">
      <span className="cdr-label">{label}</span>
      <span className="cdr-value">{value}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Script View (chapter → scene → line)
// ══════════════════════════════════════════════════════════════════════════════

function FullScriptView({ script }: { script: NarrativeContext["jrpg_script"] }) {
  const t = useT();
  const [expandedCh, setExpandedCh] = useState<string | null>(null);
  const edit = useNodeEdit("script_generation");
  if (!script) return null;

  const chapterTypeLabel = (type: string) => {
    const key = `textView.chapterType.${type}`;
    const hit = t(key);
    return hit === key ? type : hit;
  };

  return (
    <div>
      <KV label={t("field.title")} value={script.title} />
      <p className="section-text">{t("textView.chapters", { n: script.chapters.length })}</p>
      {script.chapters.map((ch) => {
        const nodeId = ch.chapter_id;
        const expanded = expandedCh === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const funcParts: string[] = [];
        if (ch.chapter_type) funcParts.push(chapterTypeLabel(ch.chapter_type));
        funcParts.push(t("textView.tensionBadge", { value: ch.conflict.tension_level }));

        return (
          <div
            key={nodeId}
            data-node-id={ch.node_id}
            className={`sub-section script-chapter clickable ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="node-row-header" onClick={() => setExpandedCh(expanded ? null : nodeId)}>
              <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>
              <span className="node-id">{ch.node_id}</span>
              <span className="node-badge">{funcParts[0]}</span>
              <strong>{ch.title}</strong>
              <span className="node-func">{funcParts.slice(1).join(" · ")}</span>
            </div>
            {expanded && (
              <div className="script-detail">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={15} />
                ) : (
                  <>
                    <div className="script-conflict">
                      <KV label={t("textView.conflictType")} value={ch.conflict.type} />
                      <KV label={t("textView.stakesLabel")} value={ch.conflict.stakes} />
                      <KV label={t("textView.turningPointLabel")} value={ch.conflict.turning_point} />
                      <KV label={t("textView.sourcePlot")} value={ch.plot_node_id} />
                    </div>

                    {ch.character_arcs.length > 0 && (
                      <div className="script-arcs">
                        <div className="result-section-title">{t("textView.charArcLight")}</div>
                        {ch.character_arcs.map((arc, i) => (
                          <div key={i} className="wv-slot-row">
                            <span className="wv-slot-key">{arc.character}</span>
                            <span className="wv-slot-val">{arc.arc_phase} · {arc.emotional_shift} → {arc.growth}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {ch.scenes.map((sc) => (
                      <div key={sc.scene_id} className="script-scene">
                        <div className="scene-header">
                          <span className="node-badge">{t("textView.scene")}</span>
                          <span>{sc.location}</span>
                          <span className="node-func">{sc.atmosphere}</span>
                          {sc.bgm && <span className="node-func">🎵 {sc.bgm}</span>}
                          {sc.camera_direction && <span className="node-func">📷 {sc.camera_direction}</span>}
                        </div>
                        <div className="script-content-lines">
                          {sc.content.map((line, li) => (
                            <div key={li} className={`script-line type-${line.type}`}>
                              {line.type === "dialogue" ? (
                                <>
                                  <span className="line-speaker">{line.speaker ?? ""}</span>
                                  <span className="line-text">{line.text}</span>
                                  {(line.emotion || line.action) && (
                                    <span className="line-emotion">
                                      [{line.emotion ?? ""}{line.action ? `, ${line.action}` : ""}]
                                    </span>
                                  )}
                                  {line.subtext && (
                                    <div className="line-subtext">({line.subtext})</div>
                                  )}
                                </>
                              ) : line.type === "stage_direction" ? (
                                <span className="line-text">（{line.text}）</span>
                              ) : line.type === "inner_monologue" ? (
                                <em className="line-text">{line.text}</em>
                              ) : line.type === "branch_point" ? (
                                <span className="line-text">⑂ {line.text}</span>
                              ) : (
                                <>
                                  <span className="line-type">{line.type}</span>
                                  <span className="line-text">{line.text}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <NodeActionBar
                nodeId={nodeId}
                edit={edit}
                editData={ch}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Scene Tree (hierarchical with icons)
// ══════════════════════════════════════════════════════════════════════════════

const LEVEL_ICONS = ["🌐", "⛰️", "🏘️", "🏛️", "🚪", "🔮"];

function levelLabel(level: number): string {
  return sceneLevelLabel(level, getLocale());
}

function sceneLevel(s: SceneNode): number {
  return s.scene_level ?? s.level ?? 0;
}

function sceneDescText(s: SceneNode): string {
  if (!s.description) return "";
  if (typeof s.description === "string") return s.description;
  const d = s.description as { location_description?: string; art_style_description?: string; semantics_description?: string };
  return [d.location_description, d.art_style_description, d.semantics_description].filter(Boolean).join(" | ");
}

function SceneTreeMerged({ scenes }: { scenes: SceneNode[] }) {
  const byParent = new Map<string, SceneNode[]>();
  for (const s of scenes) {
    const key = s.parent || "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(s);
  }

  function renderLevel(parentName: string, depth: number): React.ReactNode {
    const children = byParent.get(parentName) ?? [];
    if (!children.length) return null;
    return (
      <div className="scene-tree-level" style={{ paddingLeft: depth * 16 }}>
        {children.map((s) => {
          const lvl = sceneLevel(s);
          const desc = sceneDescText(s);
          return (
            <div key={s.uid || s.name} data-node-id={s.uid} className="scene-tree-node">
              <div className="scene-tree-row">
                <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
                <span className={`node-badge scene-level-${lvl}`}>{levelLabel(lvl)}</span>
                <span className={`scene-name scene-name-l${lvl}`}>{s.name}</span>
                {s.story_units?.length && (
                  <span className="scene-units">🔗 {s.story_units.join(", ")}</span>
                )}
              </div>
              {desc && <p className="section-text scene-desc">{desc}</p>}
              {renderLevel(s.name, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  }

  const roots = byParent.get("__root__") ?? byParent.get("") ?? [];
  if (roots.length === 0) return <GenericObjectView data={scenes} />;

  return (
    <>
      {roots.map((r) => {
        const lvl = sceneLevel(r);
        const desc = sceneDescText(r);
        return (
          <div key={r.uid || r.name} className="scene-tree-node root">
            <div className="scene-tree-row">
              <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
              <span className={`node-badge scene-level-${lvl}`}>{levelLabel(lvl)}</span>
              <span className={`scene-name scene-name-l${lvl}`}>{r.name}</span>
            </div>
            {desc && <p className="section-text scene-desc">{desc}</p>}
            {renderLevel(r.name, 1)}
          </div>
        );
      })}
    </>
  );
}

type SceneTab = "all" | "skeleton" | "L0" | "L1" | "L2" | "L345";

const SCENE_TAB_KEYS: Record<SceneTab, string> = {
  all: "textView.allScenes",
  skeleton: "textView.skeletonScenes",
  L0: "textView.l0Framework",
  L1: "textView.l1Outline",
  L2: "textView.l2Detailed",
  L345: "textView.l345Plot",
};

function SceneList({ scenes }: { scenes: SceneNode[] }) {
  const t = useT();
  if (!scenes.length) return <p className="section-text">{t("textView.noSceneData")}</p>;
  return (
    <div className="scene-tree-level">
      {scenes.map((s, si) => {
        const lvl = sceneLevel(s);
        const desc = sceneDescText(s);
        return (
          <div key={s.uid || s.name || si} data-node-id={s.uid} className="scene-tree-node">
            <div className="scene-tree-row">
              <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
              <span className={`node-badge scene-level-${lvl}`}>{levelLabel(lvl)}</span>
              <span className={`scene-name scene-name-l${lvl}`}>{s.name}</span>
              {s.story_units?.length && (
                <span className="scene-units">🔗 {s.story_units.join(", ")}</span>
              )}
            </div>
            {desc && <p className="section-text scene-desc">{desc}</p>}
          </div>
        );
      })}
    </div>
  );
}

function ScenePerNodeGroups({ p2, edit, expandedGroup, setExpandedGroup }: {
  p2: Record<string, SceneNode[]>;
  edit: ReturnType<typeof useNodeEdit>;
  expandedGroup: string | null;
  setExpandedGroup: (id: string | null) => void;
}) {
  const t = useT();
  const entries = Object.entries(p2);
  if (entries.length === 0) return <p className="section-text">{t("textView.noGroupData")}</p>;
  return (
    <div className="node-card-list">
      {entries.map(([nodeId, groupScenes]) => {
        const expanded = expandedGroup === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        return (
          <div
            key={nodeId}
            data-node-id={nodeId}
            className={`node-card clickable ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="node-card-header" onClick={() => setExpandedGroup(expanded ? null : nodeId)}>
              <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>
              <span className="node-id">{nodeId}</span>
              <span className="node-name">{t("textView.sceneGroup", { n: Array.isArray(groupScenes) ? groupScenes.length : 0 })}</span>
            </div>
            {expanded && (
              <div className="node-expanded-content">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={12} />
                ) : (
                  Array.isArray(groupScenes) ? (
                    groupScenes.map((s, si) => {
                      const lvl = sceneLevel(s);
                      const desc = sceneDescText(s);
                      return (
                        <div key={s.uid || s.name || si} className="scene-tree-node" style={{ marginLeft: 8 }}>
                          <div className="scene-tree-row">
                            <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
                            <span className={`node-badge scene-level-${lvl}`}>{levelLabel(lvl)}</span>
                            <span className={`scene-name scene-name-l${lvl}`}>{s.name}</span>
                            {s.story_units?.length && (
                              <span className="scene-units">🔗 {s.story_units.join(", ")}</span>
                            )}
                          </div>
                          {desc && <p className="section-text scene-desc">{desc}</p>}
                        </div>
                      );
                    })
                  ) : (
                    <GenericObjectView data={groupScenes} />
                  )
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <NodeActionBar
                nodeId={nodeId}
                edit={edit}
                editData={groupScenes}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FullSceneTreeView({ sceneMap }: { sceneMap: NarrativeContext["scene_map"] }) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SceneTab>("all");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const edit = useNodeEdit("scene_plan");
  if (!sceneMap) return null;

  const sm = sceneMap as unknown as Record<string, unknown>;
  const scenes = sceneMap.scenes ?? [];
  const skeleton = sm._phase1_skeleton as SceneNode[] | undefined;
  const byLayer = sm._phase1_by_layer as { l0?: SceneNode[]; l1?: SceneNode[]; l2?: SceneNode[] } | undefined;
  const p2 = sm._phase2_per_node as Record<string, SceneNode[]> | undefined;

  const l0Scenes = byLayer?.l0 as SceneNode[] | undefined;
  const l1Scenes = byLayer?.l1 as SceneNode[] | undefined;
  const l2Scenes = byLayer?.l2 as SceneNode[] | undefined;

  const p2Flat: SceneNode[] = useMemo(() => {
    if (!p2) return [];
    const all: SceneNode[] = [];
    for (const arr of Object.values(p2)) {
      if (Array.isArray(arr)) all.push(...arr);
    }
    return all;
  }, [p2]);

  const availableTabs: SceneTab[] = ["all"];
  if (l0Scenes?.length) availableTabs.push("L0");
  if (l1Scenes?.length) availableTabs.push("L1");
  if (l2Scenes?.length) availableTabs.push("L2");
  if (skeleton?.length) availableTabs.push("skeleton");
  if (p2Flat.length > 0) availableTabs.push("L345");

  const tabData: Record<SceneTab, SceneNode[]> = {
    all: scenes,
    skeleton: skeleton ?? [],
    L0: l0Scenes ?? [],
    L1: l1Scenes ?? [],
    L2: l2Scenes ?? [],
    L345: p2Flat,
  };

  const activeScenes = tabData[activeTab];

  return (
    <div className="scene-tree">
      <KV label={t("textView.world")} value={sceneMap.world_name} />

      <div className="scene-tab-bar">
        {availableTabs.map((tab) => (
          <button
            key={tab}
            className={`scene-tab${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {t(SCENE_TAB_KEYS[tab])} ({tabData[tab].length})
          </button>
        ))}
      </div>

      <div className="scene-stats">
        <span className="scene-stat-badge">{t("textView.currentNodes", { n: activeScenes.length })}</span>
        {(() => {
          const lc = new Map<number, number>();
          for (const s of activeScenes) lc.set(sceneLevel(s), (lc.get(sceneLevel(s)) ?? 0) + 1);
          return Array.from(lc.entries()).sort(([a], [b]) => a - b).map(([level, count]) => (
            <span key={level} className={`scene-stat-badge level-${level}`}>
              {LEVEL_ICONS[level] ?? ""} {levelLabel(level).split(" ").slice(1).join(" ") || `L${level}`} x{count}
            </span>
          ));
        })()}
      </div>

      {activeTab === "L345" && p2 && Object.keys(p2).length > 0 ? (
        <ScenePerNodeGroups p2={p2} edit={edit} expandedGroup={expandedGroup} setExpandedGroup={setExpandedGroup} />
      ) : activeTab === "all" ? (
        <SceneTreeMerged scenes={scenes} />
      ) : (
        <SceneList scenes={activeScenes} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Item Database (full view)
// ══════════════════════════════════════════════════════════════════════════════

/*
 * 稀有度曾经是写死的五个色相（灰 / 绿 / 蓝 / 紫 / 橙）。改走 class，颜色在
 * `index.css` 里按主题取值——五个单值 hex 两套主题拿到的是同一个颜色，浅色下
 * #3c3 和 #6cf 压在白底上都读不清。同时色相换成了明暗档：稀有度是有序的，
 * 「越稀有越重」说得通，而没人分得清紫比蓝稀有还是蓝比紫稀有。
 */

function FullItemDatabaseView({ items }: { items: Record<string, unknown>[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState<string | null>(null);
  const edit = useNodeEdit("item_database");

  return (
    <div className="item-db-list">
      <div className="scene-stats">
        <span className="scene-stat-badge">{t("textView.itemList", { n: items.length })}</span>
      </div>
      {items.map((item, i) => {
        const nodeId = String(item.name ?? t("textView.itemDefault", { n: i + 1 }));
        const rarity = String(item.rarity ?? "common");
        const category = String(item.category ?? "");
        const isOpen = expanded === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const desc = String(item.description ?? "");
        const effect = String(item.effect ?? "");
        const owner = item.initial_owner ? String(item.initial_owner) : "";
        const scene = item.initial_scene ? String(item.initial_scene) : "";
        const relChar = item.related_character ? String(item.related_character) : "";
        const val = item.value as Record<string, number> | undefined;
        const maxStack = item.max_stack != null ? String(item.max_stack) : "";
        const readContent = item.read_content ? String(item.read_content) : "";

        return (
          <div
            key={`${nodeId}_${i}`}
            className={`char-card-text ${isOpen ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="char-card-header" onClick={() => setExpanded(isOpen ? null : nodeId)}>
              <span className="char-toggle">{isOpen ? "▾" : "▸"}</span>
              <span className={`node-badge rarity-${rarity}`}>{rarity}</span>
              <strong className="char-card-name">{nodeId}</strong>
              {category && <span className="char-card-occ">{category}</span>}
            </div>
            {!isOpen && desc && (
              <div className="char-card-meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {desc.slice(0, 60)}{desc.length > 60 ? "…" : ""}
              </div>
            )}

            {isOpen && (
              <div className="char-card-detail">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={10} />
                ) : (
                  <>
                    {desc && <CharRow label={t("field.description")} value={desc} />}
                    {effect && <CharRow label={t("field.effect")} value={effect} />}
                    {owner && <CharRow label={t("field.initialOwner")} value={owner} />}
                    {scene && <CharRow label={t("field.initialScene")} value={scene} />}
                    {relChar && <CharRow label={t("field.relatedCharacter")} value={relChar} />}
                    {val && (
                      <CharRow label={t("field.value")} value={
                        Object.entries(val).map(([k, v]) => `${k === "buy" ? t("field.buy") : k === "sell" ? t("field.sell") : k}: ${v}`).join(" / ")
                      } />
                    )}
                    {maxStack && <CharRow label={t("field.maxStack")} value={maxStack} />}
                    {readContent && <CharRow label={t("field.readContent")} value={readContent} />}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && isOpen && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {isOpen && edit.canEditNodes && (
              <NodeActionBar
                nodeId={nodeId}
                edit={edit}
                editData={item}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Quest Graph (full view)
// ══════════════════════════════════════════════════════════════════════════════

function FullQuestGraphView({ questGraph }: { questGraph: NarrativeContext["quest_graph"] }) {
  const t = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const edit = useNodeEdit("quest_generation");
  if (!questGraph) return null;
  const quests = questGraph.quests ?? [];
  const mainChain = questGraph.main_quest_chain ?? [];

  const questTypeLabel = (type: string) => {
    const key = `textView.questType.${type}`;
    const hit = t(key);
    return hit === key ? type : hit;
  };

  return (
    <div className="quest-graph-view">
      <div className="scene-stats">
        <span className="scene-stat-badge">{t("textView.questSystem", { n: quests.length })}</span>
        <span className="scene-stat-badge">{t("textView.mainChain", { n: mainChain.length })}</span>
      </div>
      {quests.map((q, i) => {
        const quest = q as Record<string, unknown>;
        const qid = String(quest.quest_id ?? `q_${i}`);
        const qname = String(quest.name ?? "");
        const qtype = String(quest.type ?? "main");
        const isOpen = expandedId === qid;
        const isNodeEditing = edit.editingNodeId === qid;
        return (
          <div key={qid} className={`char-card${isNodeEditing ? " editing" : ""}`}>
            <div className="char-header" onClick={() => setExpandedId(isOpen ? null : qid)}>
              <span className="char-toggle">{isOpen ? "▾" : "▸"}</span>
              <span className="char-name">{qname}</span>
              <span className={`node-badge quest-${qtype === "main" ? "main" : "side"}`}>
                {questTypeLabel(qtype)}
              </span>
              <span className="char-role">{String(quest.story_node_id ?? "")}</span>
            </div>
            {isOpen && (
              <div className="char-details">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={12} />
                ) : (
                  <GenericObjectView data={(() => {
                    const { quest_id: _qid, name: _qn, type: _qt, ...rest } = quest;
                    return rest;
                  })()} />
                )}
              </div>
            )}

            {edit.showNodeInput === qid && isOpen && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {isOpen && edit.canEditNodes && (
              <NodeActionBar
                nodeId={qid}
                edit={edit}
                editData={quest}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Shared components
// ══════════════════════════════════════════════════════════════════════════════

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value}</span>
    </div>
  );
}

function LabelSpan({ children, color }: { children: React.ReactNode; color?: "gold" | "blue" }) {
  const cls = color === "gold" ? "label-gold" : color === "blue" ? "label-blue" : "label-green";
  return <span className={`nti-label ${cls}`}>{children}</span>;
}

function ProseBlock({ title, text, color }: { title: string; text: string; color?: "green" | "gold" | "blue" }) {
  const colorCls = color === "gold" ? "prose-title-gold" : color === "blue" ? "prose-title-blue" : "prose-title-green";
  return (
    <div className="prose-block">
      <div className={`prose-block-title ${colorCls}`}>{title}</div>
      <MarkdownBlock text={text} />
    </div>
  );
}


function PlotSynopsisView({ ps }: { ps: PlotSynopsis }) {
  const t = useT();
  return (
    <div className="synopsis-view">
      {ps.synopsis_strategy && (
        <div className="synopsis-strategy">
          <span className="synopsis-strategy-label">{t("textView.strategy")}</span>
          <span className="synopsis-strategy-text">{ps.synopsis_strategy}</span>
        </div>
      )}
      <ProseBlock title={t("textView.plot")} text={ps.synopsis} />
      {ps.highlight_analysis && (
        <ProseBlock title={t("textView.highlightAnalysis")} text={ps.highlight_analysis} color="gold" />
      )}
    </div>
  );
}
