import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchModes,
  fetchGenres,
  startRun,
  resumeRun,
  cancelRun,
  fetchHistory,
  loadHistoryResult,
  useNarrativeStream,
  analyzeImpact,
  regenerateStep,
  fetchIpDnaJob,
  fetchIpDnaHierarchy,
  ipDnaCancel,
  saveEntry,
  planPipelines,
} from "../../hooks/useNarrativeStream";
import { useSecondaryPipelineStreams } from "../../hooks/useSecondaryPipelineStreams";
import type { HistoryEntry, GenreCategoryGroup } from "../../hooks/useNarrativeStream";
import { useNarrativeStore, type StepState } from "../../store/narrativeStore";
import { readStructureVote } from "../../lib/structureVote";
import { tryRestoreFromStorage } from "../../store/narrativeStore";
import type { TierId, ModeId } from "../../types";
import { STEP_CTX_FIELD } from "../../types";
import { useT, t as tGlobal, getLocale } from "../../i18n";
import { fireIpGenerate } from "../../lib/ipGenerateBridge";
import { draftKeyOf, listEdits } from "../../lib/editPersist";
import { isHeavyUploadSet, pickScriptFile } from "../../lib/uploads";
import {
  IP_PREDECESSOR_STEPS,
  TAG_DIMENSIONS,
  TIER_DEFAULT_MODES,
  TIER_DEFAULT_COMPLEXITY,
  STEP_LABEL_MAP,
  buildIpReplayContent,
  buildStepsFromCtx,
  fetchPlannedOrder,
  inferRouteGroup,
  routeHasComplexity,
} from "../../lib/routingCatalog";
import { useEntryActions } from "./useEntryActions";
import { ImpactPreviewModal } from "../controls/ImpactPreviewModal";

/**
 * 创作台的 owner 侧执行体。
 *
 * 布局重构后需求输入与操作条都在中栏 iframe，而落盘、拉历史、开 SSE 只能有一份，
 * 于是所有"写"集中在这里：本组件只挂在 owner（pane=left 或独立 full）那一侧，
 * 中栏通过 store.pendingCommand 请求执行。
 *
 * 对外暴露的 context 只有任务清单相关的东西——那是左栏 TaskPanel 独占的。
 * 表单态一律走 store，任何组件都能直接读写，不必经 context。
 */

type PendingForkPlan = {
  fromStepId: string;
  pipelineOrder: string[];
  affectedStepIds: string[];
  skipSteps: string[];
  nodeFilter?: Record<string, string[]>;
  savedDrafts: Record<string, { content?: unknown; userInput?: string }>;
  preloadSteps: StepState[];
};

export interface NarrativeRuntimeContextValue {
  historyList: HistoryEntry[];
  /** 叠加了"运行中虚拟条目"与"草稿条目"的展示用清单。 */
  displayHistory: HistoryEntry[];
  historyLoading: boolean;
  /** 正在加载哪个条目（点击后转圈）。 */
  loadingKey: string | null;
  loadHistory: () => Promise<void>;
  selectEntry: (entry: HistoryEntry) => Promise<void>;
  genreCategories: GenreCategoryGroup[];
}

const NarrativeRuntimeContext = createContext<NarrativeRuntimeContextValue | null>(null);

/** 左栏 TaskPanel 用。中栏没有 Provider，调用会拿到 null。 */
export function useNarrativeRuntime(): NarrativeRuntimeContextValue | null {
  return useContext(NarrativeRuntimeContext);
}

export function NarrativeRuntimeProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = getLocale();

  const { cutOffActiveRun, confirmInput, saveEntryConfig } = useEntryActions();

  // ---- Store selectors ----
  const routing = useNarrativeStore((s) => s.routing);
  const input = useNarrativeStore((s) => s.input);
  const setRouting = useNarrativeStore((s) => s.setRouting);
  const setInput = useNarrativeStore((s) => s.setInput);
  const setEntryDirty = useNarrativeStore((s) => s.setEntryDirty);
  const setRuntimeBusy = useNarrativeStore((s) => s.setRuntimeBusy);
  const setRuntimeError = useNarrativeStore((s) => s.setRuntimeError);
  const ipDnaJob = useNarrativeStore((s) => s.ipDnaJob);
  const setIpDnaJob = useNarrativeStore((s) => s.setIpDnaJob);
  const runtimeBusy = useNarrativeStore((s) => s.runtimeBusy);
  const pendingCommand = useNarrativeStore((s) => s.pendingCommand);
  const clearCommand = useNarrativeStore((s) => s.clearCommand);
  const historyRevision = useNarrativeStore((s) => s.historyRevision);

  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeConfig = useNarrativeStore((s) => s.activeConfig);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const tier = useNarrativeStore((s) => s.tier);
  const mode = useNarrativeStore((s) => s.mode);
  const autoDetect = useNarrativeStore((s) => s.autoDetect);
  const setConfig = useNarrativeStore((s) => s.setConfig);
  const setAvailableModes = useNarrativeStore((s) => s.setAvailableModes);
  const storeStartNewRun = useNarrativeStore((s) => s.startNewRun);
  const storeStartFork = useNarrativeStore((s) => s.startFork);
  const storeStartResume = useNarrativeStore((s) => s.startResume);
  const storeLoadEntry = useNarrativeStore((s) => s.loadEntry);
  const setPreviewOrder = useNarrativeStore((s) => s.setPreviewOrder);
  const setStructureVote = useNarrativeStore((s) => s.setStructureVote);
  const setRoutingConfigured = useNarrativeStore((s) => s.setRoutingConfigured);
  const beginDraftEntry = useNarrativeStore((s) => s.beginDraftEntry);
  const inputConfirmed = useNarrativeStore((s) => s.inputConfirmed);

  const { routeGroup, tierChoice, narrativeRoute, genreCode, complexity, complexityTouched } = routing;
  const { userInput, tagSelections, tagCustomTexts, uploadedFiles } = input;
  const inputTab = useNarrativeStore((s) => s.inputTab);

  const scriptFile = useMemo(() => pickScriptFile(uploadedFiles), [uploadedFiles]);
  const isHeavyUpload = isHeavyUploadSet(uploadedFiles);
  const ipDnaRunning =
    !!ipDnaJob && ipDnaJob.status !== "completed" && ipDnaJob.status !== "failed" && ipDnaJob.status !== "cancelled";
  const isRunning = !!runningRunId;
  const hasDrafts = useMemo(() => Object.values(editDrafts).some((d) => d.saved), [editDrafts]);
  const showComplexity = routeHasComplexity(routeGroup, tierChoice, narrativeRoute);

  // ---- Owner-local state ----
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [genreCategories, setGenreCategories] = useState<GenreCategoryGroup[]>([]);
  const [impactPreview, setImpactPreview] = useState<{
    affectedSteps: string[];
    canSkip: string[];
    reasoning: string;
    fallback?: boolean;
  } | null>(null);
  const [pendingForkPlan, setPendingForkPlan] = useState<PendingForkPlan | null>(null);
  const actionLockRef = useRef(false);
  // G1：预演 /plan 铸出的 pipelineId，开始生成时原样透传，避免 /start 运行期再现铸一个。
  // 单管线场景下这个 id 只固定身份，不改变落盘位置（仍是条目根）。
  const previewPipelineIdRef = useRef<string | undefined>(undefined);

  useNarrativeStream();
  // Phase-2 M8：次管线各自一条 SSE，写入 pipelineRuns 供状态栏多 lane 渲染。
  useSecondaryPipelineStreams();

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistoryList(await fetchHistory());
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    tryRestoreFromStorage();
    fetchModes().then(setAvailableModes).catch(() => {});
    fetchGenres(locale)
      .then((cats) => setGenreCategories(cats ?? []))
      .catch((err) => {
        console.error("[NarrativeRuntimeProvider] fetchGenres failed:", err);
        setGenreCategories([]);
      });
    void loadHistory();
  }, [setAvailableModes, locale, loadHistory]);

  // 任一 pane 落盘后 bump 一次，这里重拉清单。
  useEffect(() => {
    if (historyRevision === 0) return;
    void loadHistory();
  }, [historyRevision, loadHistory]);

  // Refresh history when a run completes
  const prevRunningRef = useRef(runningRunId);
  useEffect(() => {
    const prev = prevRunningRef.current;
    prevRunningRef.current = runningRunId;
    if (prev && !runningRunId) void loadHistory();
  }, [runningRunId, loadHistory]);

  // ---- 路由草稿 → store.tier/mode/autoDetect ----
  useEffect(() => {
    if (routeGroup === "planning") {
      if (tierChoice === "auto") {
        setConfig(null, null, true);
      } else {
        setConfig(tierChoice, TIER_DEFAULT_MODES[tierChoice], false);
      }
    } else {
      setConfig(null, narrativeRoute, narrativeRoute === "narrative_auto");
    }
  }, [routeGroup, tierChoice, narrativeRoute, setConfig]);

  // 叙事体量默认按层级，用户手改过就不再套。
  useEffect(() => {
    if (complexityTouched) return;
    if (routeGroup !== "planning" || tierChoice === "auto") return;
    const defaultC = TIER_DEFAULT_COMPLEXITY[tierChoice];
    if (defaultC && defaultC !== complexity) setRouting({ complexity: defaultC });
  }, [routeGroup, tierChoice, complexityTouched, complexity, setRouting]);

  // 切换层级时清掉不兼容的品类选择（防止 T1 切到 T3 后留着 T1 的品类）。
  useEffect(() => {
    if (tierChoice === "auto") {
      if (genreCode) setRouting({ genreCode: null });
      return;
    }
    if (!genreCode) return;
    const found = genreCategories.flatMap((c) => c.genres).find((g) => g.code === genreCode);
    if (found && found.tier !== tierChoice) setRouting({ genreCode: null });
  }, [tierChoice, genreCode, genreCategories, setRouting]);

  // 外部挂载回填：Kotone 通过 narrative:attach-run 起的 run，App.tsx 把 agent 选好的参数写入
  // store.activeConfig 并打上 hydrateToken。仅在 token 变化时执行一次——手动启动/编辑流程
  // 从不设 token，因此绝不会覆盖用户正在进行的编辑。
  const hydratedTokenRef = useRef<number | null>(null);
  useEffect(() => {
    const token = activeConfig?.hydrateToken;
    if (!token || token === hydratedTokenRef.current) return;
    hydratedTokenRef.current = token;
    const c = activeConfig!;
    if (c.userInput != null) setInput({ userInput: c.userInput });
    const patch: Parameters<typeof setRouting>[0] = {};
    if (c.routeGroup) patch.routeGroup = c.routeGroup;
    if (c.routeGroup === "narrative") {
      const resolved = (c.mode === ("auto" as ModeId) ? ("narrative_auto" as ModeId) : c.mode) ?? null;
      if (resolved) patch.narrativeRoute = resolved;
    } else if (c.tier) {
      patch.tierChoice = c.tier;
    }
    if (c.genreCode !== undefined) patch.genreCode = c.genreCode ?? null;
    setRouting(patch);
  }, [activeConfig, setInput, setRouting]);

  /**
   * §条目持久化桥接：IP 摄入产出真实运行键（<条目键>_<标题>）后，立刻把它回写到当前条目的
   * _entry.json.ipRunKey，无需等用户点「确认保存」。否则输入侧 IP 运行与 output 条目对不上桥接键，
   * LIST 会把同一请求裂成两条；历史回放也拿不到层级树。
   */
  const ipRunKey = useNarrativeStore((s) => s.ipRunKey);
  const bridgedIpRunKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ipRunKey || !activeEntryKey || activeEntryStatus) return;
    if (ipRunKey === activeEntryKey) return; // 纯时间戳（自动模式未带标题）暂不桥接，等全键就绪
    if (!ipRunKey.startsWith(`${activeEntryKey}`)) return; // 仅桥接属于当前条目的运行键
    if (bridgedIpRunKeyRef.current === ipRunKey) return;
    bridgedIpRunKeyRef.current = ipRunKey;
    void saveEntry(activeEntryKey, { ipRunKey }).then(() => void loadHistory());
  }, [ipRunKey, activeEntryKey, activeEntryStatus, loadHistory]);

  // IP DNA 重需求上传时（输入阶段）：中间管线只呈现"输入 + IP 处理"前驱环节链，
  // 不提前铺生产全管线（避免一上来就 0/23）。生产环节在"开始生成"后由实时运行轨揭示。
  useEffect(() => {
    if (!isHeavyUpload) return;
    setPreviewOrder([...IP_PREDECESSOR_STEPS], false);
  }, [isHeavyUpload, setPreviewOrder]);

  const previewIsAuto = routeGroup === "planning" && tierChoice === "auto";

  /**
   * 预演链路（fresh-config，未开始生成时的"待生成"步骤序）。
   * Phase-2 M9：步序真值只有一个来源 —— 后端 POST /api/narrative/plan。
   */
  useEffect(() => {
    if (isHeavyUpload) return;
    let cancelled = false;
    const isPlanning = routeGroup === "planning";
    const g = isPlanning ? (genreCode ?? undefined) : undefined;
    const tierArg = isPlanning && tierChoice !== "auto" ? (tierChoice as TierId) : undefined;
    const modeArg = isPlanning ? undefined : narrativeRoute;
    // pipelineTemplate 不再由前端算：后端 resolveStepGroups 已能仅凭 genreCode 反查
    // 同一份 findGenreByCode(...).pipelineTemplate，前端这份是重算一遍再透传的冗余值。
    planPipelines({
      config: {
        tier: tierArg ?? null,
        mode: modeArg ?? null,
        genreCode: g ?? null,
        routeGroup,
        complexity: showComplexity ? complexity : undefined,
        locale: getLocale() === "en" ? "en" : "zh",
      },
      genreCode: g,
      tier: tierArg,
      mode: modeArg,
      storyType: routing.storyType,
      storyTheme: routing.storyTheme,
      // 用户覆盖过结构就带上，让预演算出的结构与实跑一致；null = 跟随投票。
      narrativeStructure: routing.narrativeStructure,
      // 标签无条件带上：后端据标签兜底推类型/题材两轴，不带这份，预览算出的结构会与
      // 实跑（实跑从 _entry.json 读到标签）不一致。从前只在标签档带，于是用户既写需求
      // 又勾标签时，预览与实跑看到的输入不是同一份。
      tags: { selections: tagSelections, customTexts: tagCustomTexts },
      // tpl-vn-v2 E1/E2 互斥由后端同一实现裁决（vn-v2-e2.ts）。
      hasUploadedScript: !!(scriptFile?.content || scriptFile?.contentBase64),
    })
      .then((res) => {
        if (cancelled) return;
        const agents = res.pipeline?.agents ?? res.pipelines[0]?.agents;
        setPreviewOrder(agents?.length ? agents.map((a) => a.agentId) : null, previewIsAuto);
        previewPipelineIdRef.current = res.pipeline?.pipelineId ?? res.pipelines[0]?.pipelineId;
        // 第四轴「叙事结构」的结论与依据也在这份预演里。它不出面让用户选，但必须
        // 出面让用户看见 —— 三轴换一换就换出另一种结构，看不到就只能盲信。
        setStructureVote(readStructureVote(res.pipeline?.config ?? res.pipelines[0]?.config));
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewOrder(null, previewIsAuto);
        setStructureVote(null);
      });
    return () => { cancelled = true; };
  }, [
    isHeavyUpload, routeGroup, genreCode, tierChoice, narrativeRoute,
    complexity, showComplexity,
    routing.storyType, routing.storyTheme, routing.narrativeStructure,
    inputTab, tagSelections, tagCustomTexts,
    previewIsAuto, scriptFile, setPreviewOrder, setStructureVote,
  ]);

  // 标签不再回写输入框。那个同步是互斥时代的产物：注释写着"避免覆盖手动输入"，实际
  // 只要在标签档就无条件覆盖 `userInput`，用户手写的需求当场没了。并存之后标签自有住所
  // （`tagSelections`），折成文本在提交时一次做（`composeAuthoredInput`）。

  // IP DNA 异步任务轮询：每 1.5s 拉一次进度，完成/失败即停；完成后刷新历史列表。
  useEffect(() => {
    if (!ipDnaJob?.jobId) return;
    if (ipDnaJob.status === "completed" || ipDnaJob.status === "failed" || ipDnaJob.status === "cancelled") return;
    let cancelled = false;
    const jobId = ipDnaJob.jobId;
    const tick = async () => {
      try {
        const st = await fetchIpDnaJob(jobId);
        if (cancelled) return;
        setIpDnaJob((prev) =>
          prev && prev.jobId === st.jobId
            ? { ...prev, status: st.status, stage: st.current_stage, progress: st.progress, message: st.message, error: st.error, result: st.result }
            : prev,
        );
        if (st.status === "completed" || st.status === "failed" || st.status === "cancelled") {
          void loadHistory();
        }
      } catch { /* 轮询失败下次再试 */ }
    };
    const id = setInterval(tick, 1500);
    void tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [ipDnaJob?.jobId, ipDnaJob?.status, setIpDnaJob, loadHistory]);

  // ---- Handlers ----

  const handleStart = useCallback(async () => {
    const st = useNarrativeStore.getState();
    const files = st.input.uploadedFiles;
    const heavy = isHeavyUploadSet(files);
    const script = pickScriptFile(files);
    if ((!st.input.userInput.trim() && files.length === 0) || actionLockRef.current) return;
    // §条目排他性：开始新一次生成前，切断上一个正在运行的工作流（不再报错拒绝，改为自动接管）。
    if (st.runningRunId || ipDnaRunning) await cutOffActiveRun();

    // §统一底部生成入口：重需求路径由「开始生成」分流到 IP DNA 下游生成，
    // 触发器由渲染 IpStageFlow 的那个文档登记（分栏时是中栏，那侧会先自行触发）。
    if (heavy) {
      if (!st.ipCanGenerate || !fireIpGenerate()) {
        setRuntimeError(t("tms.error.ipScopeRequired"));
        return;
      }
      setEntryDirty(false);
      return;
    }

    actionLockRef.current = true;
    setRuntimeBusy(true);
    setRuntimeError(null);
    try {
      const r = st.routing;
      const hasGenre = !!r.genreCode && r.routeGroup === "planning";
      // routing mode 由 (tier, genreCode) 隐式推导：选了品类即 manual 路由。
      const effectiveAutoDetect = hasGenre ? false : st.autoDetect;
      // 上传剧本独立通道传给 backend；user_input 留给"用户在输入框写的口头需求"。
      const trimmedInput = st.input.userInput.trim();
      const fallbackInput = script?.name ? tGlobal("ipc.msg.scriptUploaded", { name: script.name }) : "";
      const effectiveUserInput = trimmedInput || fallbackInput;
      // §状态机核心：有分叉待决（pendingFork）时**不复用键**——铸新键 fork（原条目不可变、全量保留）。
      const forking = st.pendingFork;
      const reuseKey =
        !forking && st.inputConfirmed && !st.activeEntryStatus ? st.activeEntryKey ?? undefined : undefined;
      const res = await startRun(effectiveUserInput, {
        tier: st.tier ?? undefined,
        mode: st.mode ?? undefined,
        autoDetect: effectiveAutoDetect,
        complexity: routeHasComplexity(r.routeGroup, r.tierChoice, r.narrativeRoute) ? r.complexity : undefined,
        routeGroup: r.routeGroup,
        genreCode: hasGenre ? r.genreCode! : undefined,
        storyType: r.storyType ?? undefined,
        storyTheme: r.storyTheme ?? undefined,
        locale,
        entryKey: reuseKey,
        // G1：沿用预演时铸的 pipelineId，运行期不再现铸；重新 fork 时预演已失效不应误用。
        pipelineId: forking ? undefined : previewPipelineIdRef.current,
        uploadedScript: script
          ? {
              content: script.content,
              content_base64: script.contentBase64,
              encoding: script.encoding as "utf8" | "base64-docx",
              file_name: script.name,
              size: script.size,
              mime: script.mime,
            }
          : undefined,
      });
      // 条目锚点用 entryKey，产物地址用 sourceDir。单管线两者相等，但不再依赖这个
      // 巧合（见 docs/contracts.md §1.3）；老后端只给 sourceDir 时退回它。
      const launched = res as { entryKey?: string; sourceDir?: string };
      const sourceDir = launched.sourceDir;
      const entryKey = launched.entryKey ?? sourceDir;
      if (!entryKey) throw new Error(t("tms.error.noSourceDir"));
      storeStartNewRun(res.id, entryKey, res.tier ?? undefined, res.mode ?? undefined, sourceDir);
      setEntryDirty(false); // /start 已把当次配置回写 _entry.json（兜底落盘）→ 清脏
    } catch (e) {
      setRuntimeError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setRuntimeBusy(false);
    }
  }, [ipDnaRunning, cutOffActiveRun, locale, storeStartNewRun, setEntryDirty, setRuntimeBusy, setRuntimeError, t]);

  const handleCancel = useCallback(async () => {
    const store = useNarrativeStore.getState();
    // 收束 IP 预览轨（任意阶段取消）：把"运行中"步骤标为中断、退出运行态，否则预览残留 running。
    if (store.ipPreviewRunId) store.finishIpPreview("interrupted");
    const job = store.ipDnaJob;
    const jobRunning = !!job && job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled";
    if (jobRunning && job?.jobId) {
      try { await ipDnaCancel(job.jobId); } catch { /* 后端无端点时静默，仅清前端态 */ }
      setIpDnaJob((prev) => (prev ? { ...prev, status: "failed" } : prev));
      setTimeout(() => void loadHistory(), 500);
      return;
    }
    if (store.runningRunId) {
      cancelRun(store.runningRunId);
      store.cancelRun();
    } else {
      // 后端还在跑但前端跟丢了：从历史里找出 running 条目取消掉。
      const history = await fetchHistory().catch(() => [] as HistoryEntry[]);
      const runningEntry = history.find((h) => h.status === "running" && h.id);
      if (runningEntry?.id) cancelRun(runningEntry.id);
      if (store.activeEntryStatus === "running") {
        useNarrativeStore.setState({ activeEntryStatus: "interrupted" });
      }
      setHistoryList(history);
    }
    setTimeout(() => void loadHistory(), 500);
  }, [setIpDnaJob, loadHistory]);

  const handleResume = useCallback(async () => {
    const st = useNarrativeStore.getState();
    if (!st.activeEntryKey || actionLockRef.current) return;
    if (st.runningRunId) {
      setRuntimeError(t("tms.error.concurrentRun", { key: st.runningEntryKey ?? st.runningRunId ?? "" }));
      return;
    }
    actionLockRef.current = true;
    setRuntimeBusy(true);
    setRuntimeError(null);
    try {
      // G1：resume 后端要的是产物目录（可能是次管线的 `<key>/pipelines/<pid>`），
      // 传 activeEntryKey 在次管线上会寻址到条目根，续跑错泳道。
      const res = await resumeRun(st.activeSourceDir ?? st.activeEntryKey, { locale });
      const entryKey = (res as { entryKey?: string }).entryKey ?? st.activeEntryKey;
      storeStartResume(res.id, entryKey, res.tier ?? undefined, res.mode ?? undefined);
    } catch (e) {
      setRuntimeError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setRuntimeBusy(false);
    }
  }, [storeStartResume, locale, setRuntimeBusy, setRuntimeError, t]);

  /**
   * Phase 4 阶段 A：调 /analyze-impact，把结果存入 impactPreview，并预算好 fork 所需参数。
   * 用户在 modal 里点"确认重新生成"时由 confirmRegenerate 真正调用 /regenerate + startFork。
   */
  const handleRegenerate = useCallback(async () => {
    const st = useNarrativeStore.getState();
    const key = st.activeEntryKey;
    const drafts = st.editDrafts;
    const anyDraft = Object.values(drafts).some((d) => d.saved);
    if (!key || !anyDraft || actionLockRef.current) return;
    // G1：影响面分析要的是产物目录，次管线上 activeEntryKey 会寻址到条目根读错泳道的 ctx。
    const sourceDir = st.activeSourceDir ?? key;
    if (st.runningRunId) {
      setRuntimeError(t("tms.error.concurrentRun", { key: st.runningEntryKey ?? st.runningRunId ?? "" }));
      return;
    }
    actionLockRef.current = true;
    setRuntimeBusy(true);
    setRuntimeError(null);
    try {
      const savedDrafts: Record<string, { content?: unknown; userInput?: string }> = {};
      const modifiedStepIds: string[] = [];
      const modifications: Array<{
        stepId: string;
        nodeId?: string;
        editedContent?: unknown;
        userInput?: string;
      }> = [];
      for (const [dk, draft] of Object.entries(drafts)) {
        if (!draft.saved) continue;
        savedDrafts[dk] = { content: draft.content, userInput: draft.userInput };
        const [baseStep, nodeId] = dk.includes("::") ? dk.split("::") : [dk, undefined];
        if (!modifiedStepIds.includes(baseStep)) modifiedStepIds.push(baseStep);
        modifications.push({ stepId: baseStep, nodeId, userInput: draft.userInput, editedContent: draft.content });
      }

      const impact = await analyzeImpact(sourceDir, modifications);

      // pipelineOrder 优先级：LLM impact 返回 → activeConfig 持久化 → 后端 /plan 兜底
      const livePipelineOrder = impact.pipelineOrder
        ?? st.activeConfig?.pipelineOrder
        ?? (await fetchPlannedOrder(st.tier, st.mode, st.routing.genreCode));

      // 取最早需要重跑的一步：优先 LLM 的 affectedSteps（可能含上游），否则用最早被改的那步。
      let earliestIdx = livePipelineOrder.length;
      for (const id of [...(impact.affectedSteps ?? []), ...modifiedStepIds]) {
        const idx = livePipelineOrder.indexOf(id);
        if (idx >= 0 && idx < earliestIdx) earliestIdx = idx;
      }
      if (earliestIdx >= livePipelineOrder.length) {
        setRuntimeError(t("tms.error.stepNotFound"));
        return;
      }

      const fromStepId = livePipelineOrder[earliestIdx];
      const modSet = new Set(modifiedStepIds);
      const affectedSet = new Set(impact.affectedSteps ?? modifiedStepIds);
      const skipSteps = (impact.canSkip ?? []).filter((s) => !modSet.has(s) && !affectedSet.has(s));

      let nodeFilter: Record<string, string[]> | undefined;
      if (impact.nodeImpacts?.length) {
        nodeFilter = {};
        for (const ni of impact.nodeImpacts) nodeFilter[ni.stepId] = ni.nodeIds;
      }

      // 预铺 preloadSteps（fromStepId 之前=completed/绿，之后=pending/灰）
      const staleSet = new Set(livePipelineOrder.slice(earliestIdx));
      const preloadSteps: StepState[] = [
        { id: "pipeline_config", label: STEP_LABEL_MAP.get("pipeline_config") ?? tGlobal("tms.pipelineConfig"), status: "completed" as const, isMeta: true },
        ...livePipelineOrder.map((id) => ({
          id,
          label: STEP_LABEL_MAP.get(id) ?? id,
          status: staleSet.has(id) ? ("pending" as const) : ("completed" as const),
        })),
      ];

      setImpactPreview({
        affectedSteps: impact.affectedSteps ?? [],
        canSkip: impact.canSkip ?? [],
        reasoning: impact.reasoning ?? "",
        fallback: impact.fallback,
      });
      setPendingForkPlan({
        fromStepId,
        pipelineOrder: livePipelineOrder,
        affectedStepIds: [...affectedSet],
        skipSteps,
        nodeFilter,
        savedDrafts,
        preloadSteps,
      });
    } catch (e) {
      setRuntimeError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setRuntimeBusy(false);
    }
  }, [setRuntimeBusy, setRuntimeError, t]);

  /** Phase 4 阶段 B：用户确认后真正调 /regenerate + startFork。 */
  const confirmRegenerate = useCallback(async () => {
    const stNow = useNarrativeStore.getState();
    const key = stNow.activeEntryKey;
    // G1：重生成要从当前查看的那条泳道续，次管线上传 activeEntryKey 会从条目根（另一条泳道）续。
    const sourceDir = stNow.activeSourceDir ?? key;
    if (!pendingForkPlan || !key || !sourceDir) return;
    actionLockRef.current = true;
    setRuntimeBusy(true);
    setRuntimeError(null);
    try {
      // §排他性：重新生成也建立新条目（fork），先切断上一个正在运行的工作流。
      if (useNarrativeStore.getState().runningRunId || ipDnaRunning) await cutOffActiveRun();
      const res = await regenerateStep(sourceDir, pendingForkPlan.fromStepId, {
        skipSteps: pendingForkPlan.skipSteps.length ? pendingForkPlan.skipSteps : undefined,
        nodeFilter: pendingForkPlan.nodeFilter,
        editDrafts: pendingForkPlan.savedDrafts,
        locale,
      });
      const newEntryKey = res.newEntryKey ?? `__fork__${res.id}`;

      // 后端 /regenerate 会返回最终 staleSteps（更精确），覆盖前端 affectedSet。
      const finalStaleSet = new Set(res.staleSteps ?? pendingForkPlan.affectedStepIds);
      const finalPreload: StepState[] = [
        { id: "pipeline_config", label: STEP_LABEL_MAP.get("pipeline_config") ?? tGlobal("tms.pipelineConfig"), status: "completed" as const, isMeta: true },
        ...pendingForkPlan.pipelineOrder.map((id) => ({
          id,
          label: STEP_LABEL_MAP.get(id) ?? id,
          status: finalStaleSet.has(id) ? ("pending" as const) : ("completed" as const),
        })),
      ];

      storeStartFork(
        res.id,
        newEntryKey,
        key,
        res.tier as TierId | undefined,
        res.mode as ModeId | undefined,
        finalPreload,
      );
      setImpactPreview(null);
      setPendingForkPlan(null);
      setTimeout(() => void loadHistory(), 500);
    } catch (e) {
      setRuntimeError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setRuntimeBusy(false);
    }
  }, [pendingForkPlan, storeStartFork, ipDnaRunning, cutOffActiveRun, locale, loadHistory, setRuntimeBusy, setRuntimeError]);

  const cancelRegenerate = useCallback(() => {
    setImpactPreview(null);
    setPendingForkPlan(null);
  }, []);

  /**
   * §条目可选中兜底：任何条目点击都必须能"选中并反映状态"，即使后端 /load 返回 404 或无 result。
   * 最小化锚定：置 activeEntryKey + 反映真实 status，并尽力回放可读内容。
   */
  const selectEntryBestEffort = useCallback(async (entry: HistoryEntry) => {
    const store = useNarrativeStore.getState();
    store.resetPreviewContext();
    const st =
      entry.status === "running" ? ("running" as const)
        : entry.status === "completed" ? ("completed" as const)
          : (entry.status === "interrupted" || entry.status === "failed") ? ("interrupted" as const)
            : null;
    useNarrativeStore.setState({ activeEntryKey: entry.key, activeEntryStatus: st, inputConfirmed: true });
    if (entry.userInput) store.setInput({ userInput: entry.userInput });
    if (entry.routeGroup === "narrative" || entry.routeGroup === "planning") {
      store.setRouting({ routeGroup: entry.routeGroup });
    }
    if (entry.kind === "ip-dna") {
      store.startIpPreviewRun(`ip-preview-${entry.key}`, entry.key, [...IP_PREDECESSOR_STEPS]);
      try {
        const summary = await fetchIpDnaHierarchy(entry.key);
        if (summary) {
          const ipContent = buildIpReplayContent(summary);
          for (const stepId of IP_PREDECESSOR_STEPS) {
            store.pushProgress({
              stage: stepId, stepId, step: 0, totalSteps: 0,
              status: "completed", message: tGlobal("ipc.msg.restored"), data: ipContent[stepId] ?? undefined,
            });
          }
        }
      } catch { /* 无层级树则仅锚定，不回放 */ }
    } else if (entry.userInput) {
      store.startIpPreviewRun(`ip-preview-${entry.key}`, entry.key, ["input"]);
      store.pushProgress({
        stage: tGlobal("ipc.stage.inputContent"), stepId: "input", step: 0, totalSteps: 0,
        status: "completed", message: tGlobal("ipc.msg.inputConfirmed"), data: entry.userInput,
      });
    }
  }, []);

  const selectEntry = useCallback(async (entry: HistoryEntry) => {
    const { runningEntryKey: currentRunKey, runningRunId: currentRunId, runningProgress: currentProgress } =
      useNarrativeStore.getState();
    const currentlyRunning = !!currentRunId;

    if (entry.status === "running" && currentlyRunning && entry.key === currentRunKey) {
      useNarrativeStore.setState({
        activeEntryKey: entry.key,
        activeEntryStatus: "running",
        activeSteps: currentProgress,
      });
      return;
    }
    // 条目显示 running 但前端没跟踪：尊重后端状态，只锚定。
    if (entry.status === "running" && !currentlyRunning) {
      useNarrativeStore.setState({ activeEntryKey: entry.key, activeEntryStatus: "running", activeSteps: [] });
      return;
    }

    setLoadingKey(entry.key);
    setRuntimeError(null);
    try {
      const data = await loadHistoryResult(entry.key);
      const entryCfg = data.entry;

      // §条目持久化：仅「无 result」时走 config 恢复分支（有 result 的完成/中断条目继续下方加载）。
      if (!data.result && (entry.status === "config" || !!entryCfg)) {
        const cfg = entryCfg ?? {};
        beginDraftEntry(entry.key, { userInput: cfg.userInput, routeGroup: cfg.routeGroup });
        setInput({
          userInput: cfg.userInput ?? "",
          tagSelections: cfg.tags?.selections ?? {},
          tagCustomTexts: cfg.tags?.customTexts ?? {},
        });
        setRouting({
          routeGroup: cfg.routeGroup ?? "planning",
          tierChoice: cfg.tier ?? "auto",
          narrativeRoute: (cfg.mode as ModeId) ?? "narrative_auto",
          genreCode: cfg.genreCode ?? null,
          complexity: cfg.complexity ?? 2,
          complexityTouched: cfg.complexity != null,
          // 三轴回填：旧条目没这几个字段，落 null 让顶栏显示"未选"而不是留着上一条的残值。
          storyType: cfg.storyType ?? null,
          storyTheme: cfg.storyTheme ?? null,
          // 条目里存的是用户覆盖（不是上次的推导结论），所以直接回填。
          narrativeStructure: cfg.narrativeStructure ?? null,
        });
        // 服务端读盘已归一成两值（`toIntakeSource`），这里直接回填。
        if (cfg.inputType) useNarrativeStore.getState().setInputTab(cfg.inputType);
        useNarrativeStore.getState().setActiveConfig({
          storyType: cfg.storyType ?? null,
          storyTheme: cfg.storyTheme ?? null,
          narrativeStructure: cfg.narrativeStructure ?? null,
        });
        setRoutingConfigured(true);
        setEntryDirty(false); // 刚从磁盘还原 → 与磁盘一致，非脏态
        const store = useNarrativeStore.getState();
        // Phase-1 多管线 + 画布拓扑恢复
        if (cfg.pipelines?.length) {
          store.setEntryPipelines(cfg.pipelines, cfg.activePipelineId ?? cfg.pipelines[0]?.pipelineId);
          if (cfg.pipelines.length > 1 && cfg.listExpanded !== false) store.setListExpanded(entry.key, true);
        }
        if (cfg.compositionNodes && cfg.compositionEdges) {
          useNarrativeStore.setState({
            composerNodes: cfg.compositionNodes as never,
            composerEdges: cfg.compositionEdges as never,
          });
        }
        // IP 作品条目：经 ipRunKey 取已落盘层级树回放 IP 前驱步；文本/标签则重建"输入"单节点预览。
        if (cfg.ipRunKey) {
          store.startIpPreviewRun(`ip-preview-${entry.key}`, entry.key, [...IP_PREDECESSOR_STEPS]);
          try {
            const summary = await fetchIpDnaHierarchy(cfg.ipRunKey);
            if (summary) {
              const ipContent = buildIpReplayContent(summary);
              for (const stepId of IP_PREDECESSOR_STEPS) {
                store.pushProgress({
                  stage: stepId, stepId, step: 0, totalSteps: 0,
                  status: "completed", message: tGlobal("ipc.msg.restored"),
                  data: ipContent[stepId] ?? undefined,
                });
              }
            }
          } catch { /* 无层级树则仅锚定，不回放 */ }
        } else if (cfg.userInput) {
          store.startIpPreviewRun(`ip-preview-${entry.key}`, entry.key, ["input"]);
          store.pushProgress({
            stage: tGlobal("ipc.stage.inputContent"), stepId: "input", step: 0, totalSteps: 0,
            status: "completed", message: tGlobal("ipc.msg.inputConfirmed"), data: cfg.userInput,
          });
        }
        setLoadingKey(null);
        return;
      }

      if (!data.result) {
        // 无完整结果（如中断的 IP 预处理条目）：仍选中并尽力回放，不让点击落空。
        await selectEntryBestEffort(entry);
        setLoadingKey(null);
        return;
      }
      const ctx = data.result;
      const entryTier = (data.tier ?? entry.tier ?? null) as TierId | null;
      const entryMode = (data.mode ?? entry.mode ?? null) as ModeId | null;
      const entryStatus = data.status ?? entry.status;

      // 「忠实反应后端」: 权威步骤序优先级
      //   1) 持久化的 pipelineOrder → 2) backend completedSteps → 3) 后端 /plan 重解
      const authoritativeOrder: string[] =
        (data.pipelineOrder && data.pipelineOrder.length > 0)
          ? data.pipelineOrder
          : (data.completedSteps && data.completedSteps.length > 0)
            ? data.completedSteps
            : await fetchPlannedOrder(entryTier, entryMode, data.genre_code);

      const rawSteps = buildStepsFromCtx(ctx, authoritativeOrder);

      // §6 LIST 双模块：若权威序含 IP 前驱段，拉已落盘层级树摘要回填各 IP 步的可读正文。
      if (authoritativeOrder.some((id) => id.startsWith("ip_"))) {
        try {
          const summary = await fetchIpDnaHierarchy(entry.key);
          if (summary) {
            const ipContent = buildIpReplayContent(summary);
            for (const s of rawSteps) {
              if (s.id.startsWith("ip_")) {
                s.status = "completed";
                if (ipContent[s.id] != null) s.data = ipContent[s.id];
              }
            }
          }
        } catch { /* 无 IP 层级树：保持原状，零回归 */ }
      }

      // pipeline_config 是「管线启动」元 step，没有 ctx field；出现在权威序里即视为隐式 completed。
      for (const s of rawSteps) {
        if (s.id === "pipeline_config" && s.status === "pending") s.status = "completed";
      }

      // 对未完成 entry，按 backend completedSteps 修正：实际没跑的 step 改回 pending。
      if (entryStatus !== "completed" && data.completedSteps) {
        const doneSet = new Set(data.completedSteps);
        const ctxRec = ctx as Record<string, unknown>;
        for (const s of rawSteps) {
          if (s.status === "completed" && !doneSet.has(s.id) && s.id !== "pipeline_config") {
            s.status = "pending";
            s.data = undefined;
            const field = STEP_CTX_FIELD[s.id];
            if (field) delete ctxRec[field];
          }
        }
      }

      // 「忠实反应后端」硬约束：completed entry 不存在「待跑」step → 过滤掉 pending。
      const steps = entryStatus === "completed" ? rawSteps.filter((s) => s.status !== "pending") : rawSteps;
      const allDone = steps.every((s) => s.status === "completed");
      const resolvedStatus = (entryStatus === "running" || (currentlyRunning && entry.key === currentRunKey))
        ? "running"
        : allDone ? "completed" : entryStatus;

      const savedInput = data.userInput ?? ctx.user_input;
      const savedRouteGroup = data.routeGroup ?? entry.routeGroup ?? inferRouteGroup(entryTier, entryMode);
      const savedComplexity = data.complexity ?? entry.complexity;
      // data.genre_code 是权威源；旧 entry fallback 到 ctx.tier_detection。
      // 注意：旧版"用户手动指定 tier"时 genre_code 会写成 "manual" 占位，要 strip 掉。
      const tdCode = ctx.tier_detection?.genre_code;
      const tdCodeReal = tdCode && tdCode !== "manual" ? tdCode : undefined;
      const daCode = (ctx.demand_analysis as { genre_code?: string } | undefined)?.genre_code;
      const savedGenreCode: string | null = data.genre_code ?? tdCodeReal ?? daCode ?? null;

      storeLoadEntry({
        entryKey: entry.key,
        tier: entryTier,
        mode: entryMode,
        result: ctx,
        status: resolvedStatus,
        // 有断点才给"断点续传"键：`canResume` 是后端看过磁盘的结论
        // （有 `_checkpoint.json` 且不在跑），前端不猜。
        canResume: resolvedStatus === "completed" ? false : (entry.canResume ?? false),
        steps,
        stepGroups: data.stepGroups,
        config: {
          userInput: savedInput,
          routeGroup: savedRouteGroup,
          tier: entryTier,
          mode: entryMode,
          complexity: savedComplexity,
          genreCode: savedGenreCode,
          pipelineOrder: data.pipelineOrder,
          routingMode: data.routingMode,
        },
      });

      // Phase-1：加载多管线清单（若 _entry.json 有 pipelines）；否则用权威步序合成单管线投影。
      if (entryCfg?.pipelines?.length) {
        useNarrativeStore.getState().setEntryPipelines(
          entryCfg.pipelines,
          entryCfg.activePipelineId ?? entryCfg.pipelines[0]?.pipelineId,
        );
        if (entryCfg.pipelines.length > 1 && entryCfg.listExpanded !== false) {
          useNarrativeStore.getState().setListExpanded(entry.key, true);
        }
        if (entryCfg.compositionNodes && entryCfg.compositionEdges) {
          useNarrativeStore.setState({
            composerNodes: entryCfg.compositionNodes as never,
            composerEdges: entryCfg.compositionEdges as never,
          });
        }
      } else if (data.pipelineOrder?.length) {
        useNarrativeStore.getState().setEntryPipelines([
          {
            pipelineId: `${entry.key}-default`,
            entryKey: entry.key,
            status: resolvedStatus === "running" ? "running" : "completed",
            config: {},
            agents: data.pipelineOrder.map((agentId, index) => ({
              agentId,
              name: agentId,
              prototype: "atomic",
              index,
              lifecycle: { status: "completed" },
            })),
            promptLibrary: "v2",
            complete: true,
          },
        ]);
      }
      // 回填这个条目改过哪些正文。
      //
      // `loadEntry` 把 `editDrafts` 清空了 —— 那本来是对的，草稿是条目维度的。但编辑现在
      // 真落了盘，`_edits.json` 才是"改过哪些"的事实源，不读回来就会出现：改完刷新，
      // 磁盘上内容确实是改后的，界面却既不显示"已修改"也不给"还原原文"。
      void listEdits(entry.key)
        .then((edits) => {
          if (useNarrativeStore.getState().activeEntryKey !== entry.key) return;
          for (const e of edits) {
            useNarrativeStore.getState().setEditDraft(draftKeyOf(e), {
              content: typeof e.editedContent === "string" ? e.editedContent : undefined,
              userInput: e.userInput,
              editing: false,
              saved: true,
            });
          }
        })
        .catch(() => { /* 账本读不到不该挡住条目加载 */ });

      useNarrativeStore.getState().snapshot();

      // 回填表单草稿，使 INPUT/ROUTING 与被选条目一致。
      setInput({ userInput: savedInput ?? "" });
      setRouting({
        routeGroup: savedRouteGroup,
        tierChoice: savedRouteGroup === "planning" ? (entryTier ?? "auto") : routing.tierChoice,
        narrativeRoute:
          savedRouteGroup === "narrative"
            ? (entryMode === ("auto" as ModeId) ? ("narrative_auto" as ModeId) : entryMode) ?? "narrative_auto"
            : routing.narrativeRoute,
        complexity: savedComplexity ?? routing.complexity,
        complexityTouched: savedComplexity != null,
        genreCode: savedGenreCode ?? null,
        storyType: entryCfg?.storyType ?? null,
        storyTheme: entryCfg?.storyTheme ?? null,
      });
    } catch (e) {
      // 后端 /load 404 等：仍选中并尽力回放，保证"任何有条目的记录点击都能选中并反映状态"。
      try {
        await selectEntryBestEffort(entry);
      } catch {
        setRuntimeError((e as Error).message);
      }
    } finally {
      setLoadingKey(null);
    }
  }, [
    storeLoadEntry, selectEntryBestEffort, beginDraftEntry, setInput, setRouting,
    setRoutingConfigured, setEntryDirty, setRuntimeError, routing.tierChoice, routing.narrativeRoute, routing.complexity,
  ]);

  // ---- 命令信道：中栏发起，owner 执行 ----
  const handledNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingCommand) return;
    if (handledNonceRef.current === pendingCommand.nonce) return;
    handledNonceRef.current = pendingCommand.nonce;
    const { kind, nonce } = pendingCommand;
    clearCommand(nonce);
    switch (kind) {
      case "start": void handleStart(); break;
      case "cancel": void handleCancel(); break;
      case "resume": void handleResume(); break;
      case "regenerate": void handleRegenerate(); break;
      case "confirmInput": confirmInput(); break;
      case "saveEntry": void saveEntryConfig(); break;
    }
  }, [pendingCommand, clearCommand, handleStart, handleCancel, handleResume, handleRegenerate, confirmInput, saveEntryConfig]);

  const displayHistory = useMemo<HistoryEntry[]>(() => {
    if (isRunning && runningEntryKey) {
      const doneSteps = runningProgress.filter((s) => s.status === "completed").map((s) => s.id);
      const alreadyInList = historyList.some((h) => h.key === runningEntryKey);
      if (!alreadyInList) {
        return [{
          key: runningEntryKey,
          type: "dir",
          id: runningRunId,
          tier: tier ?? undefined,
          mode: mode ?? undefined,
          status: "running",
          startedAt: new Date().toISOString(),
          hasCheckpoint: false,
          lastCompletedStep: doneSteps.length > 0 ? doneSteps[doneSteps.length - 1] : null,
          completedSteps: doneSteps,
          canResume: false,
          canLoad: false,
          userInput: userInput || undefined,
          routeGroup,
          complexity: showComplexity ? complexity : undefined,
        }, ...historyList];
      }
      return historyList.map((h) => (h.key === runningEntryKey ? { ...h, status: "running" } : h));
    }
    // §条目持久化：首次输入确认后即在清单展示该条目（status=config，"待生成"）。
    // 落盘异步完成，这里给一个即时虚拟项占位；真实条目进入 historyList 后即去重。
    if (inputConfirmed && activeEntryKey && !activeEntryStatus) {
      const materialized = historyList.some(
        (h) => h.key === activeEntryKey || h.key.startsWith(`${activeEntryKey}_`),
      );
      if (!materialized) {
        return [{
          key: activeEntryKey,
          type: "dir",
          id: null,
          tier: tier ?? undefined,
          mode: mode ?? undefined,
          status: "config",
          startedAt: new Date().toISOString(),
          hasCheckpoint: false,
          lastCompletedStep: null,
          completedSteps: [],
          canResume: false,
          canLoad: false,
          userInput: userInput || undefined,
          routeGroup,
          complexity: showComplexity ? complexity : undefined,
        }, ...historyList];
      }
    }
    return historyList;
  }, [
    isRunning, runningEntryKey, runningRunId, tier, mode, runningProgress, userInput,
    routeGroup, complexity, showComplexity, historyList, inputConfirmed, activeEntryKey, activeEntryStatus,
  ]);

  const value = useMemo<NarrativeRuntimeContextValue>(
    () => ({ historyList, displayHistory, historyLoading, loadingKey, loadHistory, selectEntry, genreCategories }),
    [historyList, displayHistory, historyLoading, loadingKey, loadHistory, selectEntry, genreCategories],
  );

  return (
    <NarrativeRuntimeContext.Provider value={value}>
      {children}
      {impactPreview && pendingForkPlan && (
        <ImpactPreviewModal
          fromStepId={pendingForkPlan.fromStepId}
          pipelineOrder={pendingForkPlan.pipelineOrder}
          affectedSteps={pendingForkPlan.affectedStepIds}
          skipSteps={pendingForkPlan.skipSteps}
          reasoning={impactPreview.reasoning}
          fallback={impactPreview.fallback}
          submitting={runtimeBusy}
          onConfirm={confirmRegenerate}
          onCancel={cancelRegenerate}
        />
      )}
    </NarrativeRuntimeContext.Provider>
  );
}
