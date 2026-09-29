import { useEffect, useRef, useCallback, useMemo, useState, type ReactNode } from "react";
import { useT } from "./i18n";
import { NarrativeCanvas } from "./components/NarrativeCanvas";
import { TextViewPanel } from "./components/panels/TextViewPanel";
import { FilePreview } from "./components/panels/FilePreview";
import { RegeneratePanel } from "./components/panels/RegeneratePanel";
import { LeftPane } from "./components/sidebar/LeftPane";
import { CenterToolbar } from "./components/controls/CenterToolbar";
import { CenterNote } from "./components/controls/CenterNote";
import { CenterOverlay } from "./components/controls/CenterOverlay";
import { NarrativeRuntimeProvider } from "./components/runtime/NarrativeRuntimeProvider";
import { ComposerView } from "./components/composer/ComposerView";
import { useNarrativeStore, useNarrativePhase } from "./store/narrativeStore";
import { isCompositionEditable } from "./store/phase";
import type { TierId, ModeId } from "./types";
import { useAutoAttach } from "./hooks/useAutoAttach";
import { useFocusedFileFocus } from "./hooks/useFocusedFile";
import { getPaneMode, isRuntimeOwner } from "./lib/pane";
import { notifyReady, sendToHost, onHostMessage } from "./lib/bridge";
import "reactflow/dist/style.css";

export type { ViewMode } from "./store/narrativeStore";

// 侧栏宽度：默认占屏宽 1/5，可拖拽（min/max 夹取），结果记忆到 localStorage。
const SIDEBAR_WIDTH_KEY = "forgeax.narrative.sidebarW";
const SIDEBAR_MIN_WIDTH = 220;
const sidebarMaxWidth = (): number => Math.round((window.innerWidth || 1200) * 0.6);
const defaultSidebarWidth = (): number =>
  Math.max(SIDEBAR_MIN_WIDTH, Math.round((window.innerWidth || 1200) / 5));

function getInitialSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= SIDEBAR_MIN_WIDTH) {
      return Math.min(raw, sidebarMaxWidth());
    }
  } catch { /* ignore */ }
  return defaultSidebarWidth();
}

/**
 * 只有 owner 那一侧挂 Provider（它负责落盘、拉清单、开 SSE）。
 * 平台把 viz 嵌成两个 iframe，中栏那份必须是纯消费者，否则同一次生成会被执行两遍。
 */
function NarrativeRuntimeScope({ children }: { children: ReactNode }) {
  const owner = useMemo(isRuntimeOwner, []);
  return owner ? <NarrativeRuntimeProvider>{children}</NarrativeRuntimeProvider> : <>{children}</>;
}

export function App() {
  const t = useT();
  const pane = useMemo(getPaneMode, []);
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const focusedFile = useNarrativeStore((s) => s.focusedFile);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const tier = useNarrativeStore((s) => s.tier);
  const mode = useNarrativeStore((s) => s.mode);
  const prevStatus = useRef(activeEntryStatus);
  const prevStepsRef = useRef<string>("");

  // §状态机重构：header/状态灯由单一 phase 派生。generating（SSE run 或 IP DNA 下游 job）→ running；
  // done → completed；其余（含 IP 半自动预处理 input/routed）→ activeEntryStatus（预处理期恒为 STANDBY，
  // 不再因 useAutoAttach 误设 runningRunId 而闪成 GENERATING）。
  const phase = useNarrativePhase();
  const displayStatus = phase === "generating" ? "running" : phase === "done" ? "completed" : activeEntryStatus;
  // 无限画布编排态：仅在"未生成"（idle，无条目/未运行/无预处理）时把节点视图切成可编辑编排画布。
  // 一旦进入 input/routed/generating/done 则回到只读管线视图，避免与实时预览冲突。
  // 判据出自 store/phase.ts 的 isCompositionEditable —— 调色板可不可拖读的是同一处，
  // 否则会出现"能拖但没有落点"的静默失败。
  const composerMode = isCompositionEditable(phase);

  // 自动挂载 agent（Kotone）在后台起的 run：让中间预览直播 + 左栏选择器回填，无需 host 转发。
  useAutoAttach();
  // 左栏点开一份产物时，节点视图跟着挪到产它的节点上（文本侧由 FilePreview 接手）。
  useFocusedFileFocus();

  useEffect(() => {
    notifyReady();
    return onHostMessage((event) => {
      if (event.type === "narrative:reload") {
        const state = useNarrativeStore.getState();
        if (state.runningRunId) {
          window.location.reload();
        }
      } else if (event.type === "narrative:attach-run") {
        // Kotone（或其它 agent）通过 narrative:start-pipeline 工具起的 run —— host 把 runId 转发过来，
        // 这里挂载到该 run：设 runningRunId（→ SSE 自动连上直播中间预览）+ 回填左栏选择器。
        const p = event.payload;
        const st = useNarrativeStore.getState();
        if (st.runningRunId === p.runId) return; // 已挂载，幂等
        const tierVal = (p.tier ?? undefined) as TierId | undefined;
        const modeVal = (p.mode ?? undefined) as ModeId | undefined;
        st.startNewRun(p.runId, p.entryKey ?? p.runId, tierVal, modeVal);
        st.setActiveConfig({
          userInput: p.userInput,
          routeGroup: p.routeGroup,
          tier: tierVal ?? null,
          mode: modeVal ?? null,
          genreCode: p.genreCode ?? null,
          hydrateToken: Date.now(),
        });
      } else if (event.type === "narrative:trigger-regenerate") {
        // G4：agent 侧发起的重新生成走与界面完全相同的路径 —— 不是直接调 /regenerate 绕开确认，
        // 而是把 {stepId, instructions} 写成一条"已保存的改动"（与手工编辑走同一份 editDrafts），
        // 再走"命令信道"把 regenerate 命令投给 owner 侧 NarrativeRuntimeProvider（跨 iframe 时经
        // BroadcastChannel 同步，见 narrativeStore SYNC_KEYS 里的 editDrafts/pendingCommand）。
        // owner 收到后照常跑 handleRegenerate → analyze-impact → 弹 ImpactPreviewModal，
        // 仍需人在 modal 里点"确认重新生成"，agent 只是替用户填好了"改哪一步、怎么改"。
        const { stepId, instructions } = event.payload;
        const st = useNarrativeStore.getState();
        st.setEditDraft(stepId, { userInput: instructions, saved: true });
        st.requestCommand("regenerate");
      }
    });
  }, []);

  useEffect(() => {
    if (prevStatus.current === displayStatus) return;
    prevStatus.current = displayStatus;

    if (displayStatus === "running" && runningRunId) {
      sendToHost({
        type: "narrative:run-started",
        payload: { runId: runningRunId, tier: tier ?? undefined, mode: mode ?? undefined },
      });
    } else if (displayStatus === "completed" && activeEntryKey) {
      sendToHost({
        type: "narrative:run-completed",
        payload: { runId: activeEntryKey },
      });
    }
  }, [displayStatus, runningRunId, activeEntryKey, tier, mode]);

  useEffect(() => {
    const snapshot = activeSteps.map((s) => `${s.id}:${s.status}`).join(",");
    if (snapshot === prevStepsRef.current) return;

    const prevMap = new Map(
      prevStepsRef.current.split(",").filter(Boolean).map((entry) => {
        const [id, st] = entry.split(":");
        return [id, st] as [string, string];
      }),
    );

    for (const s of activeSteps) {
      const prevSt = prevMap.get(s.id);
      if (prevSt !== s.status) {
        sendToHost({
          type: "narrative:step-changed",
          payload: { stepId: s.id, status: s.status },
        });
      }
    }

    prevStepsRef.current = snapshot;
  }, [activeSteps]);

  const showSidebar = pane === "left" || pane === "full";
  const showCenter = pane === "center" || pane === "full";
  // 拖拽条仅在左右两栏同时可见（独立/并排 full 模式）时有意义；嵌入平台的 left 全宽模式不需要。
  const resizable = pane === "full";

  const [sidebarWidth, setSidebarWidth] = useState<number>(getInitialSidebarWidth);
  const draggingRef = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const startX = e.clientX;
      const startW = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const next = Math.min(
          sidebarMaxWidth(),
          Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX)),
        );
        setSidebarWidth(next);
      };
      const onUp = () => {
        draggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setSidebarWidth((w) => {
          try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w)); } catch { /* ignore */ }
          return w;
        });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  const handleResizeReset = useCallback(() => {
    const w = defaultSidebarWidth();
    setSidebarWidth(w);
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w)); } catch { /* ignore */ }
  }, []);

  return (
    <NarrativeRuntimeScope>
    <div className="app-root">
      {/* 第一层只放插件名。运行状态归第四层右侧那条注释——它原本在这里、
          左栏头、右栏头各有一份，同一件事说三遍。 */}
      {pane === "full" && (
        <header className="app-header">
          <div className="header-left">
            <span className="header-title">{t("app.title")}</span>
          </div>
        </header>
      )}

      <main className="app-main">
        {showSidebar && (
          <aside
            className="app-sidebar tool-left-panel"
            aria-label={t("app.sidebarAria")}
            style={resizable ? { width: sidebarWidth } : undefined}
          >
            {/* 第二层：区域名。左边是记录与存档，右边是干活的地方。 */}
            <header className="narrative-pane-header">
              <span className="narrative-pane-title">{t("left.title")}</span>
            </header>
            <div className="tool-left-panel__body">
              <LeftPane />
            </div>
          </aside>
        )}

        {showSidebar && showCenter && resizable && (
          <div
            className="app-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("app.resizeAria")}
            onMouseDown={handleResizeStart}
            onDoubleClick={handleResizeReset}
            title={t("app.resizeTitle")}
          />
        )}

        {showCenter && (
          <div className="app-right-panel editor-center-workspace">
            <header className="narrative-pane-header cw-preview-header">
              <span className="narrative-pane-title">{t("app.previewTitle")}</span>
            </header>
            <div className="cw-toolbar">
              {/* 第二层：只放三类工具组；视图与缩放归底栏那条居中工具条。 */}
              <CenterToolbar />

              {/* 第三层：看的是哪一份 / 管线多大多深，与左栏路径行成对。 */}
              <div className="cw-toolbar-row">
                <CenterNote />
              </div>
            </div>

            <div className="editor-center-body app-content">
              <RegeneratePanel />
              {viewMode === "text" ? (
                // 左栏点开了某份产物就先看那一份，关掉退回按环节组织的常规文本视图。
                focusedFile ? <FilePreview /> : <TextViewPanel />
              ) : composerMode ? (
                <ComposerView />
              ) : (
                // 节点模式下画布独占整片：内容看的是节点自己展开的那一段，
                // 不再在下方另开一块文本面板——同一份数据两处摆着，用户得先判断该看哪一处。
                <div className="graph-layout">
                  <div className="graph-canvas-area">
                    <NarrativeCanvas />
                  </div>
                </div>
              )}
              {/* 浮层压在主体之上：主体永远整片铺开，输入卡与操作条只是盖上去。 */}
              <CenterOverlay />
            </div>
          </div>
        )}
      </main>
    </div>
    </NarrativeRuntimeScope>
  );
}
