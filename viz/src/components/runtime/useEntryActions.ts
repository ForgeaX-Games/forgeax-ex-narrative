import { useCallback } from "react";
import { useNarrativeStore } from "../../store/narrativeStore";
import {
  saveEntry,
  cancelRun,
  ipDnaCancel,
} from "../../hooks/useNarrativeStream";
import { readUploadedItem, isHeavyUploadSet, type UploadedItem } from "../../lib/uploads";
import { IP_PREDECESSOR_STEPS, TAG_DIMENSIONS, routeHasComplexity } from "../../lib/routingCatalog";
import { useT, t as tGlobal } from "../../i18n";

/**
 * 条目级动作：建条目、确认输入、保存配置、切断旧运行、收原料。
 *
 * 这些动作只碰 store 与单条 REST，不依赖任务清单等 owner 私有状态，因此**两个 pane 都能直接调**。
 * 需求输入面板搬到中栏后，它按下「确认」就在中栏这一侧铸条目；owner 侧靠 store.historyRevision
 * 感知磁盘变化去重拉清单，不必知道是谁改的。
 *
 * 真正必须由 owner 独占的（startRun / resumeRun / regenerate + 影响面 modal）留在 NarrativeRuntimeProvider。
 */
export function useEntryActions() {
  const t = useT();

  /** 生成后端兼容的稳定条目键（与 server formatTimestamp 同格式：YYYY-MM-DD_HH-mm-ss-SSS）。 */
  const mintEntryKey = useCallback(
    () => new Date().toISOString().replace(/T/, "_").replace(/[:.]/g, "-").replace(/Z$/, ""),
    [],
  );

  /**
   * §条目排他性：切断上一个正在运行的工作流（正式 SSE run + IP DNA 下游 job）。
   * 供 fork / 新条目提交（确认、开始生成、重新生成）前调用——任一提交动作建立新条目时，
   * 立即中断旧运行，保证同一时刻只有一条逻辑工作流在跑；选择态随后自动切到新条目。
   * await 掉 cancel 请求，避免后端单实例校验(409)竞态。
   */
  const cutOffActiveRun = useCallback(async () => {
    const store = useNarrativeStore.getState();
    const job = store.ipDnaJob;
    const jobRunning =
      !!job && job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled";
    let cut = false;
    if (store.ipPreviewRunId) store.finishIpPreview("interrupted");
    if (jobRunning && job?.jobId) {
      try { await ipDnaCancel(job.jobId); } catch { /* 后端无端点时静默 */ }
      store.setIpDnaJob((prev) => (prev ? { ...prev, status: "failed" } : prev));
      cut = true;
    }
    if (store.runningRunId) {
      try { await cancelRun(store.runningRunId); } catch { /* 静默 */ }
      store.cancelRun();
      cut = true;
    }
    store.setIpDnaGenerating(false);
    if (cut) setTimeout(() => useNarrativeStore.getState().bumpHistory(), 500);
    return cut;
  }, []);

  /**
   * §条目持久化：首次输入确认即建立"条目"——铸稳定 entryKey、锚定为当前条目，并把 INPUT 参数
   * 落盘到 output/<key>/_entry.json（POST /entry），使刷新可恢复、LIST 磁盘派生可见、任何阶段点击可还原。
   * previewText 非空时，向中间预览推一个"输入"节点（直接输入/标签选择即输入本身，单文本+单节点）。
   * 返回 entryKey，供上游（如 IpStageFlow 的 storyTimestamp）复用锚定。
   *
   * §排他性：建立新条目即改配置——若此刻有旧运行在跑，立即切断其工作流（自动跳转），
   * 新条目成为当前选择（beginDraftEntry 已切 activeEntryKey）。
   */
  const createEntry = useCallback(
    (previewText: string | null, inputType: "authored" | "adapted"): string => {
      const key = mintEntryKey();
      const store = useNarrativeStore.getState();
      const { userInput, tagSelections, tagCustomTexts, uploadedFiles } = store.input;
      const { routeGroup } = store.routing;
      const heavy = isHeavyUploadSet(uploadedFiles);
      // §建新条目：先切断上一个正在运行的工作流（排他性），再清预览/运行上下文。
      if (store.runningRunId || heavy) void cutOffActiveRun();
      store.resetPreviewContext();
      if (previewText != null) {
        // 单节点输入预览：用合成预览轨承载（与 IP 前驱步同源，右栏文本/节点视图可点开展示）。
        store.startIpPreviewRun(`ip-preview-${key}`, key, ["input"]);
      }
      store.beginDraftEntry(key, { userInput: previewText ?? userInput, routeGroup });
      if (previewText != null) {
        useNarrativeStore.getState().pushProgress({
          stage: tGlobal("ipc.stage.inputContent"),
          stepId: "input",
          step: 0,
          totalSteps: 0,
          status: "completed",
          message: tGlobal("ipc.msg.inputConfirmed"),
          data: previewText,
        });
      }
      // 首次确认即落盘 INPUT 参数。标签无条件落：从前只在标签档落，于是用户勾完标签
      // 再去写需求文本，标签整份丢掉，下一次还原 INPUT 时它就不存在了。
      void saveEntry(key, {
        inputType,
        userInput: previewText ?? userInput,
        tags: { selections: { ...tagSelections }, customTexts: { ...tagCustomTexts } },
        uploadedFileNames: inputType === "adapted" ? uploadedFiles.map((f) => f.name) : undefined,
        routeGroup,
      }).then(() => useNarrativeStore.getState().bumpHistory());
      // 刚建立条目：ROUTING 尚未确认保存 → 脏态点亮「确认保存」。
      store.setEntryDirty(true);
      return key;
    },
    [mintEntryKey, cutOffActiveRun],
  );

  /**
   * 「自己描述」确定：需求文本与标签六维**都**折进预览文本，铸条目 + 单节点预览。
   *
   * 从前分成 confirmText / confirmTags 两条，各只认一半；标签那条还把合成文本
   * `setInput({ userInput: composed })` 写回输入框，把用户手写的需求覆盖掉。两半并存
   * 之后不必再分流，也不必回写 —— 标签自有住所，折算只发生在提交这一次。
   */
  const confirmAuthored = useCallback(() => {
    const { userInput, tagSelections, tagCustomTexts } = useNarrativeStore.getState().input;
    const picked = TAG_DIMENSIONS.map((dim) => {
      const val = tagSelections[dim.key] ?? tagCustomTexts[dim.key]?.trim();
      return val ? `${t(dim.nameKey)}：${val}` : null;
    }).filter(Boolean) as string[];
    const composed = [userInput.trim(), picked.join("；")].filter(Boolean).join("\n\n");
    if (!composed) return;
    createEntry(composed, "authored");
  }, [createEntry, t]);

  /** 「上传原作改编」确定：铸条目锚定（不推预览节点，节点由 IpStageFlow 分步推送）。 */
  const confirmAdapted = useCallback((): string => createEntry(null, "adapted"), [createEntry]);

  /** 按当前入口分流的「确认」。 */
  const confirmInput = useCallback(() => {
    if (useNarrativeStore.getState().inputTab === "adapted") confirmAdapted();
    else confirmAuthored();
  }, [confirmAuthored, confirmAdapted]);

  /**
   * §条目持久化：「确认保存」——把当前 INPUT+ROUTING 全量快照 upsert 到 output/<key>/_entry.json，
   * 落盘成功后清脏（按钮变灰）。IP 作品条目带上 ipRunKey 指针桥接到媒体目录。
   */
  const saveEntryConfig = useCallback(async () => {
    const st = useNarrativeStore.getState();
    const key = st.activeEntryKey;
    if (!key || st.activeEntryStatus) return; // 仅未生成的条目可保存配置
    const { routeGroup, tierChoice, narrativeRoute, genreCode, complexity, storyType, storyTheme,
      narrativeStructure } = st.routing;
    const showComplexity = routeHasComplexity(routeGroup, tierChoice, narrativeRoute);
    const hasGenre = !!genreCode && routeGroup === "planning";
    await saveEntry(key, {
      inputType: st.inputTab,
      userInput: st.input.userInput,
      // 标签无条件保存，理由同 createEntry：按档保存会在切换入口时丢掉另一半。
      tags: { selections: { ...st.input.tagSelections }, customTexts: { ...st.input.tagCustomTexts } },
      routeGroup,
      tier: tierChoice === "auto" ? undefined : tierChoice,
      mode: narrativeRoute,
      genreCode: hasGenre ? genreCode! : undefined,
      storyType: storyType ?? undefined,
      storyTheme: storyTheme ?? undefined,
      narrativeStructure: narrativeStructure ?? undefined,
      complexity: showComplexity ? complexity : undefined,
      ipRunKey: st.ipRunKey ?? undefined,
    });
    const after = useNarrativeStore.getState();
    after.setEntryDirty(false);
    after.bumpHistory();
  }, []);

  /**
   * 半自动每步产物推给中间预览（WS-F 实时同步）：复用 pushProgress 把 IP 处理步骤
   * 作为生成管线前驱节点增量加入 runningProgress，使中间节点图随每步确认实时更新。
   */
  const pushIpStageProgress = useCallback(
    (stepId: string, status: "running" | "completed", message?: string, data?: unknown) => {
      const store = useNarrativeStore.getState();
      // 首次推送时建立 IP 预览运行轨：让中间画布/文本与正式生成同源（读 runningProgress + pipelineOrder），
      // 否则 IP 步因无 run 上下文而排不进预览（孤立浮节点 / 文本空）。独立旁路不触发 SSE、不撞并发守卫。
      if (!store.ipPreviewRunId && !store.runningRunId) {
        const diskKey = store.ipRunKey;
        const suffix = diskKey ?? String(Date.now());
        // §条目提前建立：优先复用草稿条目键作为预览轨 entryKey，使 INPUT/预处理/LIST 全部锚定同一条目。
        const draftKey = store.inputConfirmed && !store.activeEntryStatus ? store.activeEntryKey : null;
        const entryKey = draftKey ?? (diskKey ? `ip-preview:${diskKey}` : `ip-preview:${suffix}`);
        store.startIpPreviewRun(`ip-preview-${suffix}`, entryKey, [...IP_PREDECESSOR_STEPS]);
      }
      useNarrativeStore.getState().pushProgress({
        stage: stepId,
        stepId,
        step: 0,
        totalSteps: 0,
        status: status === "completed" ? "completed" : "running",
        message,
        // 该步可读正文（文本直接展示 / 多模态以 @文件名 表示），中间文本视图据此渲染。
        data,
      });
      // 不在 ip_dna_extract 完成时收束预览轨——节点需保留至用户配置 ROUTING 并手动触发生成；
      // 收束由 cancel / 新 run 挂载 / 显式 reset 负责。
    },
    [],
  );

  // ── 原料收取（多文件 + 多模态 + 压缩包，蓝图 §3.4）──
  // 读取与 userInput 解耦：输入框留给用户写口头需求。逐文件按扩展名分流：
  //   - 文本(txt/md)：utf8 content；docx：base64-docx（后端 mammoth）；
  //   - 二进制(图片/视频/音频/pdf/压缩包)：base64 + file_type（后端 IP DNA 摄入）。
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const store = useNarrativeStore.getState();
    store.setRoutingConfigured(false);
    const items: UploadedItem[] = [];
    const rejected: string[] = [];
    for (const f of list) {
      const item = await readUploadedItem(f);
      if (item) items.push(item);
      else rejected.push(f.name);
    }
    if (items.length > 0) {
      // 同名去重：后上传覆盖先前同名条目。
      store.setUploadedFiles((prev) => {
        const byName = new Map(prev.map((p) => [p.name, p] as const));
        for (const it of items) byName.set(it.name, it);
        return Array.from(byName.values());
      });
    }
    if (rejected.length > 0) {
      store.setRuntimeError(t("tms.error.unsupportedFormat", { names: rejected.join("、") }));
    }
    store.notifyConfigChange("input");
  }, [t]);

  const removeFile = useCallback((name: string) => {
    const store = useNarrativeStore.getState();
    store.setUploadedFiles((prev) => prev.filter((f) => f.name !== name));
    store.setRoutingConfigured(false);
    store.notifyConfigChange("input");
  }, []);

  return {
    mintEntryKey,
    cutOffActiveRun,
    createEntry,
    confirmAuthored,
    confirmAdapted,
    confirmInput,
    saveEntryConfig,
    pushIpStageProgress,
    addFiles,
    removeFile,
  };
}
