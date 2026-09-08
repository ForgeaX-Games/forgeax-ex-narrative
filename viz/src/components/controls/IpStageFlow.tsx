/**
 * IP 半自动分步流程（蓝图 §5.1）—— 左侧 INPUT 区在上传 IP 作品后渲染的分步卡片。
 *
 * 流程：0 IP作品 → 1 摄入+标准化(含干扰过滤) → 2 体量判断 →(超线可拆解)→ 3 确认裁剪范围
 *       → 配置 ROUTING → 生成 scoped IP DNA + 下游叙事生成（自动串跑）。
 *
 * 左侧步骤号用纯数字；中间管线预览节点用 C0–C4 前缀（与策划 D0–D4 区分）。
 * C0 提供「自动」（全程默认直跑）与「执行」（半自动逐步确认）两个入口；其余步骤为执行/确认。
 * 同一套阶段门能力另经 narrative:ip-dna-* 工具暴露给右侧平台 agent，故此处不设「交给 AI」入口。
 * 每确认一步即把该步产物推给中间预览（由父组件通过 onStageProgress 驱动）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ipDnaIngest,
  ipDnaPackage,
  fetchIpDnaJob,
  fetchIpDnaHierarchy,
  fetchIpHierarchy,
  ipDnaConfirmScope,
  ipDnaConfirmUnits,
  ipDnaDecompose,
  ipDnaGenerate,
  startIpDnaRun,
  type IpDnaFilePayload,
  type IpHierarchyResult,
  type IpHierarchyNode,
  type IpDnaJobStartResponse,
  type IpDnaJobStatus,
} from "../../hooks/useNarrativeStream";
import { useNarrativeStore } from "../../store/narrativeStore";
import type { TierId, ModeId } from "../../types";
import { useT, t } from "../../i18n";
import { localizeBackendMessage } from "../../i18n/backendMessage";
/** 顶层上传单体的展示信息（类型抽象符号）。 */
export interface IpUploadDisplay {
  name: string;
  kind: "text" | "docx" | "binary";
  fileType?: string;
}

/**
 * 改编规划一行（§5.1）：一行 = 一部 = 一个游戏单元 = 一个区间 [起点 ~ 终点]。
 * startPath/endPath[k] = 第 k+1 层选中的节点 id；"" / 不存在表示该层及以下"全部"（不再下钻）。
 * 起点取其解析子树的"首叶"，终点取解析子树的"末叶"（文档序），构成游戏单元的最小单元闭区间。
 */
interface PlanRow {
  id: string;
  startPath: string[];
  endPath: string[];
}

interface IpStageFlowProps {
  files: IpDnaFilePayload[];
  displayItems: IpUploadDisplay[];
  title?: string;
  tier?: TierId;
  mode?: ModeId;
  complexity?: number;
  /** ROUTING 是否已配置（叙事路由/品类已选）。与裁剪范围都就绪时"开始生成"才亮。 */
  routingReady?: boolean;
  /**
   * 半自动每步产物推给中间预览（step id ∈ ip_input/ip_standardize/ip_volume/ip_adapt_plan/ip_dna_extract）。
   * data 为该步可读正文：文本直接展示，图片/视频等以 @文件名 符号表示（中间文本视图据此渲染）。
   */
  onStageProgress?: (stepId: string, status: "running" | "completed", message?: string, data?: unknown) => void;
  /** 生成开始（jobId）回调，供父组件接管轮询/预览。 */
  onGenerateStarted?: (jobId: string, runId: string) => void;
  /**
   * §条目提前建立：卡0「确认 IP 作品」时回调父组件建立草稿条目，返回稳定 entryKey，
   * 本组件将其作为 ingest 的 story_timestamp 复用，使 IP 运行锚定到同一条目。
   */
  onConfirmWorks?: () => string | undefined;
  /**
   * §统一底部生成入口：上报"开始生成"就绪态与触发器给父组件——底部统一「开始生成」按钮据此
   * 对重需求 IP 分流触发（本组件不再持有生成触发按钮）。
   */
  onGenerateStateChange?: (s: { canGenerate: boolean; generate: () => void }) => void;
}

type Stage = "idle" | "confirmed" | "ingesting" | "standardized" | "scope_confirmed" | "generating" | "done" | "error";

/** 对外展示名：一律优先用规范名 displayName（序号_《原标题》），回退原始 title。 */
function disp(n?: { displayName?: string; title?: string } | null): string {
  return n?.displayName ?? n?.title ?? "";
}

/** 文件类型抽象符号。 */
function typeSymbol(item: IpUploadDisplay): string {
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "tar", "gz", "tgz"].includes(ext)) return "📦";
  if (item.kind === "docx" || ["doc", "docx"].includes(ext)) return "📄";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "🎬";
  if (["mp3", "wav", "m4a"].includes(ext)) return "🎵";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "🖼️";
  if (ext === "pdf") return "📕";
  return "📝";
}

/** C0 输入正文：文本类直接展示内容，多模态/二进制以 @文件名 符号表示。 */
function buildInputContent(files: IpDnaFilePayload[], items: IpUploadDisplay[]): string {
  const blocks = items.map((it, i) => {
    const f = files[i];
    const sym = typeSymbol(it);
    if (it.kind === "text" && typeof f?.content === "string" && f.content.trim()) {
      const body =
        f.content.length > 4000
          ? `${f.content.slice(0, 4000)}\n\n${t("ipc.truncated")}`
          : f.content;
      return `### ${sym} ${it.name}\n\n${body}`;
    }
    // 多模态/压缩包/二进制：不展开正文，以 @文件名 符号表示。
    return `### ${sym} ${it.name}\n\n@${it.name}`;
  });
  return blocks.join("\n\n---\n\n");
}

/** C1 标准化层级：渲染层级树为缩进列表，附干扰项过滤摘要。可由完整 ingest 结果或只读层级摘要驱动。 */
function buildHierarchyContent(hierarchy: IpHierarchyNode[], noiseFiltered?: string[]): string {
  const byParent = new Map<string | null, IpHierarchyNode[]>();
  for (const n of hierarchy) {
    const k = n.parent ?? null;
    const arr = byParent.get(k);
    if (arr) arr.push(n);
    else byParent.set(k, [n]);
  }
  const ids = new Set(hierarchy.map((n) => n.id));
  const roots = hierarchy.filter((n) => !n.parent || !ids.has(n.parent));
  const lines: string[] = [t("ipc.hier.title")];
  const leaves: IpHierarchyNode[] = [];
  const walk = (nodes: IpHierarchyNode[], depth: number): void => {
    for (const n of [...nodes].sort((a, b) => a.index - b.index)) {
      const kids = byParent.get(n.id) ?? [];
      lines.push(`${"  ".repeat(depth)}- ${disp(n)}${n.childRange ? t("ipc.hier.range", { r: n.childRange }) : ""}`);
      if (kids.length === 0) leaves.push(n);
      walk(kids, depth + 1);
    }
  };
  walk(roots, 0);
  if (noiseFiltered && noiseFiltered.length > 0) {
    lines.push(t("ipc.hier.filtered", { n: noiseFiltered.length, items: noiseFiltered.join("、") }));
  }
  // 最小叙事单元文件清单（点1：让中间预览能看到"每个环节落了哪些文件"）：
  // 每个最小叙事单元标准化后各落一份 content.md，落点目录名即其规范名 displayName。
  if (leaves.length > 0) {
    lines.push("", t("ipc.hier.fileList", { n: leaves.length }));
    lines.push(t("ipc.hier.dropPath"));
    for (const lf of [...leaves].sort((a, b) => a.index - b.index)) {
      lines.push(`- \`${disp(lf)}/content.md\``);
    }
  }
  return lines.join("\n");
}

/**
 * C4 输出流程正文（点2：输入流程+输出流程统一预览）：把生成 job 结果（scoped IP DNA + 下游游戏单元）
 * 整理为可读结构，让中间预览在输入各步之后接续展示"输出流程"的产出概览（每单元含产出目录/状态/质量）。
 * 完整的 D0–D4 逐节点内容随生成的 output run 落盘，可在历史中打开该 run 查看。
 */
function buildExtractResultContent(result: unknown): string {
  const r = (result ?? {}) as {
    title?: string;
    node_count?: number;
    game_units?: Array<{ index: number; generated?: boolean; output_dir?: string }>;
    extraction_quality?: { passed: boolean; checks?: Array<{ name: string; passed: boolean; detail?: string }>; warnings?: string[] };
  };
  const lines: string[] = [t("ipc.extract.title")];
  lines.push(t("ipc.extract.inputOutputs"));
  lines.push(t("ipc.extract.hierNodes", { n: r.node_count ?? 0 }));
  if (r.extraction_quality) {
    lines.push(t("ipc.extract.quality", { status: r.extraction_quality.passed ? t("ipc.common.pass") : t("ipc.common.warn") }));
    for (const c of r.extraction_quality.checks ?? []) {
      lines.push(`  - ${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    }
    if (r.extraction_quality.warnings?.length) {
      lines.push(t("ipc.extract.warnings", { items: r.extraction_quality.warnings.join("；") }));
    }
  }
  const units = r.game_units ?? [];
  lines.push("", t("ipc.extract.outputOutputs"));
  if (units.length === 0) {
    lines.push(t("ipc.extract.noUnits"));
  } else {
    for (const u of units) {
      lines.push(t("ipc.extract.unit", {
        i: u.index,
        status: u.generated ? t("ipc.common.generated") : t("ipc.common.notGenerated"),
        dir: u.output_dir ? t("ipc.extract.outputDir", { dir: u.output_dir }) : "",
      }));
    }
    lines.push("", t("ipc.extract.footnote"));
  }
  return lines.join("\n");
}

/** C2 体量判断正文。 */
function buildVolumeContent(h: IpHierarchyResult): string {
  const v = h.volume;
  if (!v) return t("ipc.volume.empty");
  return [
    t("ipc.volume.title"),
    t("ipc.volume.basis", { basis: v.thresholdBasis }),
    t("ipc.volume.charCount", { n: v.charCount }),
    t("ipc.volume.isShort", { v: v.isShort ? t("ipc.common.yes") : t("ipc.common.no") }),
    t("ipc.volume.needsDecompose", { v: v.needsDecompose ? t("ipc.volume.suggestChunks", { n: v.suggestedChunks }) : t("ipc.common.no") }),
  ].join("\n");
}

const POLL_MS = 1500;

/** 前驱节点顺序（与中间预览 ip_* step id 对齐；改编规划=范围裁剪+游戏单元合并，§5.1）。 */
const IP_AUTO_STEPS = ["ip_input", "ip_standardize", "ip_volume", "ip_adapt_plan", "ip_dna_extract"] as const;

/**
 * 全自动 job 的 current_stage(phase) → 当前所处前驱节点下标，用于轮询时把 C0..Cn 逐步点亮
 * （≤idx-1 标 completed，idx 标 running），而不是拿到 jobId 就一次性全完成。
 * phase1 内部含体量判断，故 ip_volume 无独立 phase；phase2b_adapt 覆盖改编规划（范围+单元）。
 */
const PHASE_TO_STEP_INDEX: Record<string, number> = {
  pending: 0,
  phase0: 0,
  phase1: 1,
  phase2b_adapt: 3,
  phase2_extract: 4,
  quality: 4,
  mapping: 4,
  generation: 4,
  done: 5,
};

export function IpStageFlow(props: IpStageFlowProps) {
  const t = useT();
  const { files, displayItems, title, tier, mode, complexity, routingReady = true } = props;

  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hierarchy, setHierarchy] = useState<IpHierarchyResult | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 标准化层级树「下拉栏」展开态（默认收起，跟范围区间裁剪一个形式：点开才展开树，超高滚轮查看）。 */
  const [hierPanelOpen, setHierPanelOpen] = useState(false);
  /**
   * 改编规划行（§5.1）：一行 = 一个游戏单元（部）= 一个区间 [起点 ~ 终点]。默认 1 行（整部作品 → 单品）。
   * 行数即游戏单元数：1 行=单品 single；≥2 行=系列 series（部=游戏单元）。
   */
  const [rows, setRows] = useState<PlanRow[]>([{ id: "r1", startPath: [], endPath: [] }]);
  const rowSeq = useRef(2);
  /** 自定义补充（§5.1 自由文本）：作者改编意图，空＝忠实转化。 */
  const [adaptationNotes, setAdaptationNotes] = useState<string>("");
  /**
   * 改编范围是否已确认（点3 逐步门控）：范围卡内置「确认」按钮，确认后锁定区间/单元 UI，
   * 并据此**才揭示**「自定义补充」卡；尚未最终调 API（最终确认在补充卡）。
   */
  const [rangeConfirmed, setRangeConfirmed] = useState(false);
  /**
   * 体量门控（点 4 逐步）：pending=等用户在卡 2 抉择/确认；crop=进入改编范围裁剪；
   * redecompose=正在再标准化（拆解中）。卡 3 仅在 != pending 时揭示。
   */
  const [volumeDecision, setVolumeDecision] = useState<"pending" | "crop" | "redecompose">("pending");
  /** 是否已执行过"再标准化"（影响改编范围卡的动态序号：是→再标准化卡占 2、改编占 3）。 */
  const [didRestandardize, setDidRestandardize] = useState(false);
  /**
   * 【问题】是否曾出现（粘性，点1）：仅当检出超大最小叙事单元时置真；一旦出现就保留在前端
   * （即使后续再标准化把超大单元拆没了也保留为"已处理"摘要），不随 oversized 归零而消失。
   */
  const [questionEverShown, setQuestionEverShown] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; message?: string } | null>(null);
  /** 自动模式 runId（hierarchy 未建时由 /start 的 story_timestamp 回填，修 bug#1）。 */
  const [autoRunId, setAutoRunId] = useState<string>("");

  const runId = hierarchy?.run_id || autoRunId;

  // 回填真实落盘运行键到 store，供中间预览「按环节浏览文件」按 key 读取 input/ 与 output/ 两侧文件。
  const setIpRunKey = useNarrativeStore((s) => s.setIpRunKey);
  useEffect(() => {
    if (runId) setIpRunKey(runId);
  }, [runId, setIpRunKey]);

  const pollJob = useCallback(
    async (
      jobId: string,
      onDone: (result: NonNullable<IpHierarchyResult>["confirmation"] | unknown) => void,
      onTick?: (st: IpDnaJobStatus) => void,
    ): Promise<void> => {
      return new Promise((resolve) => {
        const tick = async () => {
          try {
            const st = await fetchIpDnaJob(jobId);
            setProgress({ pct: st.progress ?? 0, message: localizeBackendMessage(st.message, t) });
            onTick?.(st);
            if (st.status === "awaiting_confirmation" || st.status === "completed") {
              onDone(st.result);
              resolve();
              return;
            }
            if (st.status === "failed" || st.status === "cancelled") {
              setError(st.status === "cancelled" ? t("ipStage.cancelled") : (st.error ?? t("ipStage.taskFailed")));
              setStage("error");
              resolve();
              return;
            }
          } catch (e) {
            setError((e as Error).message);
          }
          setTimeout(tick, POLL_MS);
        };
        void tick();
      });
    },
    [],
  );

  // ── 自动模式：全程走默认（默认全量 / 默认体量切分），一路直跑无暂停 ──
  const handleAuto = useCallback(async () => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setStage("generating");
    // 自动模式端到端直跑亦属"生成中"：置信号使 header/取消键与半自动一致。
    useNarrativeStore.getState().setIpDnaGenerating(true);
    props.onStageProgress?.("ip_input", "completed", t("ipc.msg.uploads", { n: files.length }), buildInputContent(files, displayItems));
    props.onStageProgress?.("ip_standardize", "running", t("ipc.msg.autoStraight"));
    try {
      const resp = await startIpDnaRun(files, {
        title,
        tier,
        generationMode: mode,
        complexity,
        runGeneration: true,
      });
      const jobId = (resp as IpDnaJobStartResponse).jobId;
      // 修 bug#1：从 /start 回传 story_timestamp 立即捕获 runId，回传父组件做预览/落盘关联（不再传空）。
      const ipRunId = (resp as IpDnaJobStartResponse).story_timestamp ?? "";
      if (ipRunId) setAutoRunId(ipRunId);
      if (jobId) {
        props.onGenerateStarted?.(jobId, ipRunId);
        // 自动模式无逐步确认，但仍要让中间预览看到每步正文：一旦层级落盘即拉只读摘要补 standardize 正文。
        let hierFetched = false;
        await pollJob(
          jobId,
          (result) => {
            for (const s of IP_AUTO_STEPS) props.onStageProgress?.(s, "completed");
            // 自动模式默认全量改编 / 按体量定档：给改编规划/提取节点补可读默认正文，避免"暂无数据"。
            props.onStageProgress?.("ip_adapt_plan", "completed", t("ipc.msg.fullByVolume"), t("ipc.adapt.autoContent"));
            // 输出流程产出接续到中间预览（点2）：展示 scoped IP DNA + 各游戏单元产出概览。
            props.onStageProgress?.("ip_dna_extract", "completed", t("ipc.msg.dnaDownstreamDone"), buildExtractResultContent(result));
            setStage("done");
          },
          async (st) => {
            // 按 job 实际 phase 逐步点亮前驱节点（C0→C4），不再瞬间全完成。
            const idx = PHASE_TO_STEP_INDEX[st.current_stage ?? ""] ?? -1;
            if (idx >= 0) {
              for (let i = 0; i < Math.min(idx, IP_AUTO_STEPS.length); i++) {
                props.onStageProgress?.(IP_AUTO_STEPS[i], "completed");
              }
              if (idx < IP_AUTO_STEPS.length) {
                props.onStageProgress?.(IP_AUTO_STEPS[idx], "running", localizeBackendMessage(st.message, t));
              }
            }
            // 层级一旦就绪（phase1+ 且拿到 run/story id），拉只读摘要补标准化正文（容错：拉不到则仅状态点亮）。
            if (!hierFetched && idx >= 1) {
              const ipId = st.result?.run_id ?? st.story_timestamp;
              if (ipId) {
                hierFetched = true;
                try {
                  const summary = await fetchIpDnaHierarchy(ipId);
                  if (summary) {
                    props.onStageProgress?.(
                      "ip_standardize",
                      "completed",
                      t("ipc.msg.nodes", { n: summary.node_count }),
                      buildHierarchyContent(summary.hierarchy),
                    );
                  }
                } catch { /* 容错：拉不到层级摘要则保持仅状态点亮 */ }
              }
            }
          },
        );
      } else {
        for (const s of IP_AUTO_STEPS) props.onStageProgress?.(s, "completed");
        setStage("done");
      }
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    } finally {
      setBusy(false);
      setProgress(null);
      useNarrativeStore.getState().setIpDnaGenerating(false);
    }
  }, [busy, files, displayItems, title, tier, mode, complexity, runId, pollJob, props]);

  /** §条目提前建立：卡0 确认时父组件铸造的草稿 entryKey，作为 ingest story_timestamp 复用锚定。 */
  const draftKeyRef = useRef<string | undefined>(undefined);

  // ── 卡0：确认 IP 作品（建立条目 + 即刻零 LLM 落盘 input/ + 揭示卡1 标准化）──
  const handleConfirmWorks = useCallback(() => {
    if (busy || files.length === 0) return;
    // 首次确认即建立条目（§point3）；返回的稳定键用于 package/ingest 锚定，使输入与后续处理同锚一处。
    const key = props.onConfirmWorks?.() ?? draftKeyRef.current;
    draftKeyRef.current = key;
    setStage("confirmed");
    // §状态机 / IP「确认」即落盘（零 LLM）：把原料固化到 input/<媒体>/<故事类型>/<时间戳_标题>/ 并写 manifest。
    // 拿到 run_id → 回填 autoRunId → 触发 setIpRunKey → 父组件桥接 effect 回写 _entry.json.ipRunKey（input/output 同键关联）。
    // 标准化/建树/提取不在此触发，推迟到卡1「执行」及「开始生成」。失败不阻断 UI（保留内存态，可重试确认）。
    void ipDnaPackage(files, { title, storyTimestamp: key })
      .then((pkg) => { if (pkg?.run_id) setAutoRunId(pkg.run_id); })
      .catch(() => { /* 落盘失败静默：不阻断分步 UI，用户可重新确认或直接执行标准化 */ });
  }, [busy, files, title, props]);

  // ── 卡1：执行 摄入 + 标准化（半自动，停在标准化等确认）──
  const handleIngest = useCallback(async () => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setStage("ingesting");
    setVolumeDecision("pending"); // 逐步门控：标准化完成后停在体量抉择，等用户点击再揭示改编范围
    setDidRestandardize(false);
    setRangeConfirmed(false); // 重新摄入：复位改编范围确认门
    setQuestionEverShown(false); // 重新摄入：清空上一轮"问题"粘性

    props.onStageProgress?.("ip_input", "completed", t("ipc.msg.uploads", { n: files.length }), buildInputContent(files, displayItems));
    props.onStageProgress?.("ip_standardize", "running", t("ipc.msg.standardizeFilter"));
    try {
      const resp = await ipDnaIngest(files, { title, decompose: false, async: true, storyTimestamp: draftKeyRef.current });
      const jobId = (resp as unknown as IpDnaJobStartResponse).jobId;
      if (!jobId) {
        // 同步返回（小文件）：直接是 hierarchy 结果。
        const h = resp as IpHierarchyResult;
        setHierarchy(h);
        setStage("standardized");
        props.onStageProgress?.("ip_standardize", "completed", t("ipc.msg.distractorsFiltered", { n: h.noise_filtered?.length ?? 0 }), buildHierarchyContent(h.hierarchy, h.noise_filtered));
        props.onStageProgress?.("ip_volume", "completed", h.volume?.thresholdBasis, buildVolumeContent(h));
        return;
      }
      await pollJob(jobId, (result) => {
        const h = result as IpHierarchyResult;
        setHierarchy(h);
        setStage("standardized");
        props.onStageProgress?.("ip_standardize", "completed", t("ipc.msg.distractorsFiltered", { n: h.noise_filtered?.length ?? 0 }), buildHierarchyContent(h.hierarchy, h.noise_filtered));
        props.onStageProgress?.("ip_volume", "completed", h.volume?.thresholdBasis, buildVolumeContent(h));
      });
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, files, displayItems, title, pollJob, props]);

  // ── 拆解（超线时）──
  const handleDecompose = useCallback(async () => {
    if (busy || !runId) return;
    setBusy(true);
    setRangeConfirmed(false); // 再标准化改变层级 → 复位改编范围确认门
    setVolumeDecision("redecompose"); // 再标准化中
    try {
      props.onStageProgress?.("ip_decompose", "running", t("ipc.msg.decomposeRestd"));
      const res = await ipDnaDecompose(runId);
      // 修 bug#4：拆解后重算体量——优先重拉权威 hierarchy(含新 volume)，刷新 C1/C2；
      // 失败则按返回回填并清除"建议拆解"标记，避免"建议拆解"残留。
      try {
        const fresh = await fetchIpHierarchy(runId);
        setHierarchy(fresh);
        props.onStageProgress?.("ip_standardize", "completed", t("ipc.msg.nodes", { n: fresh.node_count }), buildHierarchyContent(fresh.hierarchy, fresh.noise_filtered));
        props.onStageProgress?.("ip_volume", "completed", fresh.volume?.thresholdBasis, buildVolumeContent(fresh));
      } catch {
        setHierarchy((prev) =>
          prev
            ? {
                ...prev,
                hierarchy: res.hierarchy,
                node_count: res.node_count,
                volume: prev.volume ? { ...prev.volume, needsDecompose: false } : prev.volume,
              }
            : prev,
        );
      }
      props.onStageProgress?.("ip_decompose", "completed", t("ipc.msg.decomposedInto", { n: res.chunk_count }));
      // 按设计：再标准化执行后直接进入改编范围（再标准化卡占序号 2、改编范围占 3），不再循环追问。
      setDidRestandardize(true);
      setVolumeDecision("crop");
    } catch (e) {
      setError((e as Error).message);
      setVolumeDecision("pending");
    } finally {
      setBusy(false);
    }
  }, [busy, runId, props]);

  // ── ③ 确认裁剪范围（递归嵌套折叠树，§4.4 第①步 / 蓝图 §4 嵌套裁剪契约）──
  const childrenById = useCallback(
    (id: string): IpHierarchyNode[] =>
      (hierarchy?.hierarchy.filter((n) => n.parent === id) ?? []).sort((a, b) => a.index - b.index),
    [hierarchy],
  );

  /** 层级树根（complete 节点）id。 */
  const rootId = useMemo(
    () => hierarchy?.hierarchy.find((n) => n.levelType === "complete" || !n.parent)?.id ?? null,
    [hierarchy],
  );

  // 标准化结果就绪：默认展开"完整作品"根（让内容默认可见，仍可手动折叠收起）。
  useEffect(() => {
    if (rootId) setExpanded((prev) => (prev.has(rootId) ? prev : new Set(prev).add(rootId)));
  }, [rootId]);

  /** 顶层节点（complete 直挂 = 各"部/卷"），按 index 排序。 */
  const topNodes = useMemo<IpHierarchyNode[]>(
    () =>
      hierarchy
        ? hierarchy.hierarchy
            .filter((n) => hierarchy.hierarchy.find((p) => p.id === n.parent)?.levelType === "complete")
            .sort((a, b) => a.index - b.index)
        : [],
    [hierarchy],
  );

  /**
   * 改编范围每侧下拉 = **根列（只读"完整作品"）+ 其下真实层级列**（§"根+真实层级"）。
   * 后端 `levels[0]`=complete 根、其后为真实层级。蛊真人=[完整作品][节]=2 列；多卷=[完整作品][部][章][节]。
   */
  const realLevels = useMemo(
    () => (hierarchy?.levels ?? []).filter((l) => l.levelType !== "complete"),
    [hierarchy],
  );
  /** 交互下拉列数 = 真实层级数（root 以下）；后端缺省时回退物理树深度，至少 1。 */
  const interactiveDepth = useMemo(() => {
    if (realLevels.length > 0) return realLevels.length;
    if (!hierarchy || !rootId) return 1;
    const depthOf = (id: string, d: number): number => {
      const kids = hierarchy.hierarchy.filter((n) => n.parent === id);
      return kids.length === 0 ? d : Math.max(...kids.map((k) => depthOf(k.id, d + 1)));
    };
    return Math.max(1, depthOf(rootId, 0));
  }, [realLevels, hierarchy, rootId]);
  /** 真实层级每列标题。 */
  const realLabels = useMemo<string[]>(() => realLevels.map((l) => l.label), [realLevels]);
  /** 只读根列标题（完整作品）。 */
  const rootLabel = useMemo(
    () => hierarchy?.levels?.find((l) => l.levelType === "complete")?.label ?? t("ipStage.wholeWork"),
    [hierarchy],
  );

  /** 收集某子树的最小叙事单元（叶）id（文档序）——供 unitRange 起止用。 */
  const collectLeaves = useCallback(
    (nodeId: string): string[] => {
      const walk = (id: string): string[] => {
        const kids = childrenById(id);
        return kids.length === 0 ? [id] : kids.flatMap((k) => walk(k.id));
      };
      return walk(nodeId);
    },
    [childrenById],
  );

  /** id → 节点 速查。 */
  const byId = useMemo(() => {
    const m = new Map<string, IpHierarchyNode>();
    for (const n of hierarchy?.hierarchy ?? []) m.set(n.id, n);
    return m;
  }, [hierarchy]);

  /** 全部最小单元（叶）id，文档序——供区间顺延与 leafRange 解析。 */
  const allLeaves = useMemo<string[]>(() => (rootId ? collectLeaves(rootId) : []), [rootId, collectLeaves]);

  /** 路径解析：最后一个非空层级的节点 id；全空=null（整部 root）。 */
  const resolvePath = useCallback((path: string[]): string | null => {
    for (let k = path.length - 1; k >= 0; k--) if (path[k]) return path[k];
    return null;
  }, []);

  /** 路径展示标签（解析节点标题，全空=整部作品）。 */
  const resolveLabel = useCallback(
    (path: string[]): string => {
      const id = resolvePath(path);
      return id ? disp(byId.get(id)) || id : t("ipStage.wholeWork");
    },
    [resolvePath, byId, t],
  );

  /** 解析路径子树的首叶 / 末叶（文档序）。 */
  const pathStartLeaf = useCallback(
    (path: string[]): string | null => {
      const id = resolvePath(path) ?? rootId;
      const leaves = id ? collectLeaves(id) : [];
      return leaves[0] ?? null;
    },
    [resolvePath, rootId, collectLeaves],
  );
  const pathEndLeaf = useCallback(
    (path: string[]): string | null => {
      const id = resolvePath(path) ?? rootId;
      const leaves = id ? collectLeaves(id) : [];
      return leaves[leaves.length - 1] ?? null;
    },
    [resolvePath, rootId, collectLeaves],
  );

  /** 某叶子/节点的层级路径（[顶层…自身]，不含 complete root），用于把"顺延叶子"回填为选择器路径。 */
  const ancestorPath = useCallback(
    (nodeId: string): string[] => {
      const path: string[] = [];
      let cur: string | null = nodeId;
      while (cur) {
        const node = byId.get(cur);
        if (!node || node.levelType === "complete" || node.parent == null) break;
        path.unshift(cur);
        cur = node.parent;
      }
      return path;
    },
    [byId],
  );

  /** 一行 → 区间 [首叶, 末叶]（叶子 id，文档序）。 */
  const rowRange = useCallback(
    (row: PlanRow): { start: string; end: string } | null => {
      const start = pathStartLeaf(row.startPath);
      const end = pathEndLeaf(row.endPath);
      if (!start || !end) return null;
      // 若起点在终点之后（用户误选），按文档序自动取小→大。
      const si = allLeaves.indexOf(start);
      const ei = allLeaves.indexOf(end);
      if (si >= 0 && ei >= 0 && si > ei) return { start: end, end: start };
      return { start, end };
    },
    [pathStartLeaf, pathEndLeaf, allLeaves],
  );

  /** rows → scope（每部一个 leafRange 闭区间）+ full（仅 1 行且整部时全量）。 */
  const rowsToScope = useCallback((): { selections: { leafRange: { start: string; end: string } }[]; full: boolean } => {
    const wholeWork =
      rows.length === 1 && resolvePath(rows[0].startPath) === null && resolvePath(rows[0].endPath) === null;
    if (wholeWork) return { selections: [], full: true };
    const selections = rows
      .map((r) => rowRange(r))
      .filter((rg): rg is { start: string; end: string } => !!rg)
      .map((leafRange) => ({ leafRange }));
    return selections.length === 0 ? { selections: [], full: true } : { selections, full: false };
  }, [rows, resolvePath, rowRange]);

  /** rows → 显式 game_unit_plan（行→GameUnit 1:1，区间=叶子闭区间）。 */
  const rowsToGameUnitPlan = useCallback((): {
    mode: "single" | "series";
    units: Array<{ index: number; partId?: string; unitRange: { start: string; end: string }; boundary: "hard" }>;
    userSpecified: boolean;
  } => {
    const units = rows
      .map((r, i) => {
        const rg = rowRange(r);
        if (!rg) return null;
        return {
          index: i + 1,
          partId: r.startPath[0] || undefined,
          unitRange: rg,
          boundary: "hard" as const,
        };
      })
      .filter((u): u is NonNullable<typeof u> => !!u);
    return { mode: rows.length >= 2 ? "series" : "single", units, userSpecified: true };
  }, [rows, rowRange]);

  /** 改编规划预览正文（区间行 + 单元 + 补充摘要），推给中间预览 ip_adapt_plan。 */
  const buildPlanContent = useCallback(
    (full: boolean, plan: { mode: string; units: unknown[] }): string => {
      const lines = [
        t("ipc.adapt.title"),
        t("ipc.adapt.mode", { mode: plan.mode === "series" ? t("ipc.adapt.series") : t("ipc.adapt.single") }),
        t("ipc.adapt.unitCount", { n: plan.units.length }),
        "",
        t("ipc.adapt.scopeHeader"),
      ];
      rows.forEach((r, i) => {
        const whole = full && rows.length === 1;
        lines.push(t("ipc.adapt.part", {
          i: i + 1,
          start: resolveLabel(r.startPath),
          end: resolveLabel(r.endPath),
          whole: whole ? t("ipc.adapt.wholeSuffix") : "",
        }));
      });
      lines.push("", t("ipc.adapt.notesHeader"));
      lines.push(adaptationNotes.trim() || t("ipc.adapt.notesEmpty"));
      return lines.join("\n");
    },
    [rows, resolveLabel, adaptationNotes],
  );

  // ── 改编规划行编辑 ──
  const updateRow = useCallback((rowId: string, which: "start" | "end", path: string[]) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [which === "start" ? "startPath" : "endPath"]: path } : r)),
    );
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => {
      const id = `r${rowSeq.current++}`;
      // 自动顺延：新部默认起点 = 上一部终点叶子的"下一个叶子"（连续不重叠）；终点默认到结尾（留空）。
      const last = prev[prev.length - 1];
      const prevEnd = pathEndLeaf(last.endPath);
      const idx = prevEnd ? allLeaves.indexOf(prevEnd) : -1;
      const nextLeaf = idx >= 0 && idx + 1 < allLeaves.length ? allLeaves[idx + 1] : null;
      const startPath = nextLeaf ? ancestorPath(nextLeaf) : [];
      return [...prev, { id, startPath, endPath: [] }];
    });
  }, [pathEndLeaf, allLeaves, ancestorPath]);

  const removeRow = useCallback((rowId: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== rowId)));
  }, []);

  /** 重新规划（修 bug#6）：scope 确认后复位到标准化态，重开行编辑。 */
  const handleReplan = useCallback(() => {
    if (busy || stage === "generating" || stage === "done") return;
    setRangeConfirmed(false);
    setStage("standardized");
  }, [busy, stage]);

  // ── 改编规划：单一确认（范围裁剪 + 游戏单元 + 自定义补充，§D4）──
  const handleConfirmPlan = useCallback(async () => {
    if (busy || !runId) return;
    setBusy(true);
    setError(null);
    try {
      const { selections, full } = rowsToScope();
      const plan = rowsToGameUnitPlan();
      // 顺序提交：范围+补充 → 游戏单元（增量合并、幂等）。
      await ipDnaConfirmScope(runId, {
        scopeSelections: full ? [] : selections,
        scopeFull: full,
        adaptationNotes: adaptationNotes.trim() || undefined,
      });
      await ipDnaConfirmUnits(runId, { gameUnitPlan: plan });
      setStage("scope_confirmed");
      props.onStageProgress?.(
        "ip_adapt_plan",
        "completed",
        `${t("ipc.msg.units", { n: plan.units.length })} · ${full ? t("ipc.common.full") : t("ipc.msg.crops", { n: selections.length })}`,
        buildPlanContent(full, plan),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, runId, rowsToScope, rowsToGameUnitPlan, adaptationNotes, buildPlanContent, props]);

  // ── 开始生成（提取 + 下游自动串跑）：改编规划已在确认步落盘，此处仅 generate（修 bug#3）──
  const handleGenerate = useCallback(async () => {
    if (busy || !runId) return;
    setBusy(true);
    setError(null);
    setStage("generating");
    // §状态机重构：置生成信号 → phase=generating（header 显 GENERATING、底部取消键亮）。
    useNarrativeStore.getState().setIpDnaGenerating(true);
    const extractText = [
      t("ipc.extract.startTitle"),
      t("ipc.extract.work", { title: hierarchy?.title ?? title ?? runId }),
      t("ipc.extract.hierNodes", { n: hierarchy?.node_count ?? 0 }),
      t("ipc.extract.startNote"),
    ].join("\n");
    props.onStageProgress?.("ip_dna_extract", "running", t("ipc.msg.genDna"), extractText);
    // §图2 品类透传 + P0-1（§4.4d 目标输出形态锁定）：把 ROUTING 选定的 genreCode 一并发给 generate，
    // 并显式透传 pipeline_family——IP 改编旗舰场景 = 互动叙事(VN)，避免默认漂移到 rpg/design_auto。
    // family 派生：已知 VN/RPG 品类才显式设定；未知品类省略交后端据 genre_code 派生；无品类选择则缺省 vn。
    const routedGenre = useNarrativeStore.getState().activeConfig?.genreCode ?? undefined;
    const VN_GENRE_HINT = /(adv-interactive|adv-avg|vn|galgame|visual|interactive|avg)/i;
    const targetFamily: "rpg" | "vn" | undefined = routedGenre
      ? (VN_GENRE_HINT.test(routedGenre) ? "vn" : /rpg/i.test(routedGenre) ? "rpg" : undefined)
      : "vn";
    try {
      const resp = await ipDnaGenerate(runId, {
        tier,
        generationMode: mode,
        complexity,
        ...(routedGenre ? { genreCode: routedGenre } : {}),
        ...(targetFamily ? { pipelineFamily: targetFamily } : {}),
        async: true,
      });
      const jobId = (resp as unknown as IpDnaJobStartResponse).jobId;
      if (jobId) {
        props.onGenerateStarted?.(jobId, runId);
        // §图2：后端为下游生成注册了正式 SSE run → startNewRun 挂载它。
        // 这样在 ip_* 前驱步之后，前端会随 SSE 铺开下游叙事节点并逐步推进，跑完由 done 帧收尾，
        // 不再只停在 ip_dna_extract、也不再永久卡「生成中」。
        const genRunId = (resp as unknown as IpDnaJobStartResponse).generationRunId;
        if (genRunId) {
          const st0 = useNarrativeStore.getState();
          const entryKey = st0.runningEntryKey ?? st0.activeEntryKey ?? runId;
          st0.startNewRun(genRunId, entryKey, tier, mode);
        }
        await pollJob(jobId, (result) => {
          setStage("done");
          // 输出流程产出接续到中间预览（点2）：scoped IP DNA + 各游戏单元产出概览。
          props.onStageProgress?.("ip_dna_extract", "completed", t("ipc.msg.dnaDownstreamDone"), buildExtractResultContent(result));
          // 下游 job 完成：收束 IP 预览轨但保留节点（finishIpPreview 不再清空 runningEntryKey）。
          const st = useNarrativeStore.getState();
          st.finishIpPreview("completed");
          useNarrativeStore.setState({ activeEntryStatus: "completed" });
        });
      } else {
        setStage("done");
        props.onStageProgress?.("ip_dna_extract", "completed", t("ipc.msg.dnaGenerated"));
      }
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    } finally {
      setBusy(false);
      setProgress(null);
      // 生成收束（完成/失败）：清生成信号，phase 回落 done/routed。
      useNarrativeStore.getState().setIpDnaGenerating(false);
    }
  }, [busy, runId, mode, tier, complexity, hierarchy, title, pollJob, props]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const scopeReady = stage === "scope_confirmed" || stage === "generating" || stage === "done";
  const generateEnabled = scopeReady && routingReady && stage !== "generating" && stage !== "done";
  /** 范围 UI 是否锁定（已确认范围 或 已最终确认）：锁定后下拉/增删/确认按钮不可再编辑。 */
  const rangeLocked = rangeConfirmed || scopeReady;

  // §统一底部生成入口：把"就绪态 + 触发器"上报给父组件，由底部统一「开始生成」按钮驱动。
  const onGenerateStateChange = props.onGenerateStateChange;
  useEffect(() => {
    onGenerateStateChange?.({ canGenerate: generateEnabled && !busy, generate: handleGenerate });
  }, [onGenerateStateChange, generateEnabled, busy, handleGenerate]);

  /** 改编范围卡「确认」：仅锁定范围/单元 UI，不立即调最终 API；据此揭示自定义补充卡（点3）。 */
  const handleConfirmRange = useCallback(() => {
    if (busy) return;
    setRangeConfirmed(true);
  }, [busy]);

  /** 范围「重新编辑」：最终确认前可解锁重选区间。 */
  const handleEditRange = useCallback(() => {
    if (busy || scopeReady) return;
    setRangeConfirmed(false);
  }, [busy, scopeReady]);

  // ── 逐步门控派生量 ──
  const hierReady = !!hierarchy && stage !== "ingesting" && stage !== "idle" && stage !== "confirmed";
  /** 真·超大最小叙事单元数：>0 才触发【问题】；整部体量大≠超大文件（蓝图 §5.0）。 */
  const oversizedUnits = hierarchy?.volume?.oversizedUnitCount ?? 0;
  // 粘性置位（点1）：一旦检出超大单元就记下，问题块此后常驻前端，不随 oversized 归零消失。
  useEffect(() => {
    if (oversizedUnits > 0) setQuestionEverShown(true);
  }, [oversizedUnits]);
  /**
   * 【问题】块（点1）：仅当检出超大单元时出现（无则默认直接进入确认范围）；出现后粘性保留。
   * 它是左栏的"是否再标准化"抉择门，不作为中间/右侧的管线节点（不 push 到预览）。
   */
  const showQuestion = hierReady && questionEverShown;
  /**
   * 改编范围卡：无超大单元（问题从未出现）→ 标准化后直接揭示；有超大单元 → 用户在问题块作出
   * "直接确认 / 再标准化" 抉择（volumeDecision=crop）后才揭示。
   */
  const showRange = hierReady && (volumeDecision === "crop" || (!questionEverShown && volumeDecision === "pending"));
  /** 改编范围卡动态序号：经历"再标准化"则改编占 3（再标准化占 2），否则占 2；自定义补充顺延 +1。 */
  const rangeCardNo = didRestandardize ? 3 : 2;
  const notesCardNo = rangeCardNo + 1;

  /**
   * 渲染单个层级节点（递归）：有子节点 → 可折叠（默认展开根）；叶子 → 纯文本行（无折叠箭头）。
   * 展示一律用规范名 displayName（disp）。
   */
  const renderHierNode = (node: IpHierarchyNode, depth: number) => {
    const kids = childrenById(node.id);
    const hasKids = kids.length > 0;
    const open = expanded.has(node.id);
    return (
      <div key={node.id} className="ip-tree-group" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
        {hasKids ? (
          <button className="ip-tree-toggle" onClick={() => toggleExpand(node.id)}>
            <span className="ip-tree-caret">{open ? "▾" : "▸"}</span>
            <span className="ip-tree-label">{disp(node)}</span>
            {node.childRange && <span className="ip-tree-range">{t("ipStage.childRange", { n: node.childRange })}</span>}
          </button>
        ) : (
          <div className="ip-tree-child">· {disp(node)}</div>
        )}
        {hasKids && open && (
          <div className="ip-tree-children">{kids.map((c) => renderHierNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  /** 渲染层级树（标准化卡 / 再标准化卡复用）：以"完整作品"根起的一棵可折叠只读树。 */
  const renderHierTree = () => {
    const root = rootId ? byId.get(rootId) : null;
    return (
      <div className="ip-stage-tree">
        {root ? renderHierNode(root, 0) : topNodes.map((node) => renderHierNode(node, 0))}
      </div>
    );
  };

  /**
   * 标准化「层级化文件系统」下拉栏：跟范围区间裁剪一个形式——一行可点的下拉头（展示根名 + 最小叙事单元数），
   * 点开后在受限高度（max-height）的滚动容器里展示整棵只读可折叠树，超高用滚轮查看；不再直接铺在卡片里。
   */
  const renderHierDropdown = () => {
    const leafWord = realLabels.length > 0 ? realLabels[realLabels.length - 1] : t("ipStage.leafUnitDefault");
    const summary = t("ipStage.hierSummary", { root: rootLabel, n: allLeaves.length, unit: leafWord });
    return (
      <div className={`ip-hier-dd${hierPanelOpen ? " ip-hier-dd--open" : ""}`}>
        <button
          type="button"
          className="ip-hier-dd__head"
          aria-expanded={hierPanelOpen}
          onClick={() => setHierPanelOpen((v) => !v)}
          title={summary}
        >
          <span className="ip-hier-dd__caret">{hierPanelOpen ? "▾" : "▸"}</span>
          <span className="ip-hier-dd__summary">{summary}</span>
          <span className="ip-hier-dd__hint">{hierPanelOpen ? t("ipStage.collapse") : t("ipStage.expand")}</span>
        </button>
        {hierPanelOpen && <div className="ip-hier-dd__body">{renderHierTree()}</div>}
      </div>
    );
  };

  /**
   * 渲染区间一侧（起点/终点）：**只读"完整作品"根列 + 其下真实层级级联下拉**（根+真实层级）。
   * 根列固定（单一作品，始终全选其下）；真实层级列有几层就几列，深层依赖上层选择，展示用规范名 disp。
   */
  const renderRangeSide = (rowId: string, which: "start" | "end", path: string[]) => (
    <>
      <select className="ip-scope-select ip-scope-select--root" disabled value="__root__" title={rootLabel}>
        <option value="__root__">{disp(rootId ? byId.get(rootId) : null) || rootLabel}</option>
      </select>
      {Array.from({ length: interactiveDepth }).map((_, lvl) => {
        const options = lvl === 0 ? topNodes : path[lvl - 1] ? childrenById(path[lvl - 1]) : [];
        const disabled = rangeLocked || (lvl > 0 && !path[lvl - 1]) || options.length === 0;
        const allLabel = realLabels[lvl] ? `${t("ipStage.all")}${realLabels[lvl]}` : t("ipStage.all");
        return (
          <select
            key={lvl}
            className="ip-scope-select"
            value={path[lvl] ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const next = path.slice(0, lvl);
              if (e.target.value) next[lvl] = e.target.value;
              updateRow(rowId, which, next);
            }}
          >
            <option value="">{allLabel}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{disp(o)}</option>
            ))}
          </select>
        );
      })}
    </>
  );

  return (
    <div className="ip-stage-flow">
      {/* 0 IP 作品 */}
      <div className="ip-stage-card">
        <div className="ip-stage-card__head">
          <span className="ip-stage-card__no">0</span>
          <span className="ip-stage-card__title">{t("ipStage.works")}</span>
        </div>
        <div className="ip-stage-items">
          {displayItems.map((it, i) => (
            <div key={i} className="ip-stage-item" title={it.name}>
              <span className="ip-stage-item__sym">{typeSymbol(it)}</span>
              <span className="ip-stage-item__name">{it.name}</span>
            </div>
          ))}
        </div>
        {stage === "idle" && (
          <div className="ip-stage-card__foot">
            <button
              className="btn-generate btn-generate--compact ip-stage-btn ip-stage-btn--auto"
              disabled={busy || files.length === 0}
              onClick={handleAuto}
              title={t("ipStage.autoTitle")}
            >
              {t("ipStage.auto")}
            </button>
            <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy || files.length === 0} onClick={handleConfirmWorks}>
              {t("ipStage.confirm")}
            </button>
          </div>
        )}
        {stage !== "idle" && <p className="narrative-helper ip-stage-ok">{t("ipStage.confirmed", { n: displayItems.length })}</p>}
      </div>

      {stage === "ingesting" && (
        <div className="ip-stage-progress">{t("ipStage.standardizing", { pct: progress?.pct ?? 0, msg: progress?.message ?? "" })}</div>
      )}

      {/* 1 标准化：卡0 确认后揭示；执行才真正标准化。执行前列上传件名，执行后每件一棵只读可展开树。 */}
      {stage !== "idle" && stage !== "ingesting" && (
        <div className="ip-stage-card">
          <div className="ip-stage-card__head">
            <span className="ip-stage-card__no">1</span>
            <span className="ip-stage-card__title">{t("ipStage.standardize")}</span>
          </div>
          {hierReady ? (
            <>
              {renderHierDropdown()}
              {hierarchy?.noise_filtered && hierarchy.noise_filtered.length > 0 && (
                <p className="narrative-helper ip-stage-noise">{t("ipStage.noiseFiltered", {
                  n: hierarchy.noise_filtered.length,
                  list: `${hierarchy.noise_filtered.slice(0, 4).join("、")}${hierarchy.noise_filtered.length > 4 ? "…" : ""}`,
                })}</p>
              )}
            </>
          ) : (
            <>
              <div className="ip-stage-tree">
                {displayItems.map((it, i) => (
                  <div key={i} className="ip-tree-group ip-tree-group--pending">
                    <span className="ip-tree-caret">▸</span>
                    <span className="ip-tree-label">{it.name}</span>
                  </div>
                ))}
              </div>
              <div className="ip-stage-card__foot">
                <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleIngest}>
                  {t("ipStage.execute")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 【问题】无序号块（点1）：仅在检出超大最小叙事单元时出现；出现后粘性保留在前端，
          展示当前抉择状态。它只是左栏的"是否再标准化"门，不作为中间/右侧管线节点。 */}
      {showQuestion && (
        <div className="ip-stage-question">
          <p className="ip-stage-question__text">
            {t("ipStage.question", { n: oversizedUnits })}
          </p>
          {volumeDecision === "pending" ? (
            <>
              <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={() => setVolumeDecision("crop")}>
                {t("ipStage.questionNo")}
              </button>
              <button className="btn-generate btn-generate--compact ip-stage-btn ip-stage-btn--ghost" disabled={busy} onClick={handleDecompose}>
                {t("ipStage.questionYes")}
              </button>
            </>
          ) : (
            <p className="narrative-helper ip-stage-ok">
              {didRestandardize ? t("ipStage.questionDoneRestandardize") : t("ipStage.questionDoneDirect")}
            </p>
          )}
        </div>
      )}
      {volumeDecision === "redecompose" && (
        <div className="ip-stage-progress">{t("ipStage.restandardizing", { pct: progress?.pct ?? 0 })}</div>
      )}

      {/* 2 再标准化（仅当走了"是"路径）：展示再标准化后的层级树。 */}
      {hierReady && didRestandardize && (
        <div className="ip-stage-card">
          <div className="ip-stage-card__head">
            <span className="ip-stage-card__no">2</span>
            <span className="ip-stage-card__title">{t("ipStage.restandardize")}</span>
          </div>
          {renderHierDropdown()}
        </div>
      )}

      {/* 改编范围裁剪（动态序号 2/3）：每部=一个游戏单元=一个区间 [起点~终点]，起止各按层级展开内联级联下拉。 */}
      {showRange && (
        <>
          <div className="ip-stage-card">
            <div className="ip-stage-card__head">
              <span className="ip-stage-card__no">{rangeCardNo}</span>
              <span className="ip-stage-card__title">{t("ipStage.adaptScope")}</span>
            </div>
            <p className="narrative-helper">{t("ipStage.adaptScopeHint")}</p>
            {/* 点3：每部两行——第一行=「第 N 部」标题（× 删除固定标题行最右）；第二行=范围区间全宽展示。 */}
            <div className="ip-plan-rows">
              {rows.map((row, ri) => (
                <div key={row.id} className="ip-plan-unit">
                  <div className="ip-plan-unit__head">
                    <span className="ip-plan-row__no">{t("ipStage.partN", { n: ri + 1 })}</span>
                    {!rangeLocked && rows.length > 1 && (
                      <button type="button" className="ip-plan-row__del" onClick={() => removeRow(row.id)} aria-label={t("ipStage.deletePart")}>
                        ×
                      </button>
                    )}
                  </div>
                  <div className="ip-plan-row__range">
                    <div className="ip-plan-row__side">{renderRangeSide(row.id, "start", row.startPath)}</div>
                    <span className="ip-plan-row__tilde">~</span>
                    <div className="ip-plan-row__side">{renderRangeSide(row.id, "end", row.endPath)}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* 点3：+号满宽（与下拉行同宽）；语义说明改为下方注释（格式同其他 narrative-helper 注释）。 */}
            {!rangeLocked && (
              <>
                <button type="button" className="ip-plan-add" onClick={addRow}>
                  {t("ipStage.addPart")}
                </button>
                <p className="narrative-helper ip-plan-add__hint">{t("ipStage.addPartHint")}</p>
              </>
            )}
            {/* 范围卡内置「确认」（仅锁定范围/单元 UI，不立即调最终 API）；确认后才揭示自定义补充。 */}
            {!scopeReady && (
              <div className="ip-stage-card__foot">
                {!rangeConfirmed ? (
                  <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleConfirmRange}>
                    {t("ipStage.confirm")}
                  </button>
                ) : (
                  <>
                    <p className="narrative-helper ip-stage-ok">{t("ipStage.rangeConfirmed", { n: rows.length })}</p>
                    <button className="btn-generate btn-generate--compact ip-stage-btn ip-stage-btn--auto" disabled={busy} onClick={handleEditRange}>
                      {t("ipStage.reeditRange")}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 自定义补充（点4：后置门控——仅在改编范围确认后才挂载）：作者改编意图，留空＝忠实转化。
              改编规划在此卡最终确认（裁剪范围 + 游戏单元 + 补充一并提交）。 */}
          {rangeConfirmed && (
          <div className="ip-stage-card">
            <div className="ip-stage-card__head">
              <span className="ip-stage-card__no">{notesCardNo}</span>
              <span className="ip-stage-card__title">{t("ipStage.customNotes")}</span>
            </div>
            <p className="narrative-helper">{t("ipStage.customNotesHint")}</p>
            <textarea
              className="ip-plan-notes__input"
              rows={3}
              placeholder={t("ipStage.customNotesPlaceholder")}
              value={adaptationNotes}
              disabled={scopeReady}
              onChange={(e) => setAdaptationNotes(e.target.value)}
            />
            {!scopeReady ? (
              <div className="ip-stage-card__foot">
                <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleConfirmPlan}>
                  {t("ipStage.confirm")}
                </button>
              </div>
            ) : (
              <div className="ip-stage-card__foot">
                <p className="narrative-helper ip-stage-ok">{t("ipStage.planConfirmed", { n: rows.length })}</p>
                {stage !== "generating" && stage !== "done" && (
                  <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleReplan}>
                    {t("ipStage.replan")}
                  </button>
                )}
              </div>
            )}
          </div>
          )}

          {/* §统一底部生成入口：范围确认后此处仅提示状态，实际生成由底部统一「开始生成」按钮触发。 */}
          {scopeReady && (
            <div className="ip-stage-generate">
              {stage === "done" ? (
                <p className="narrative-helper">{t("ipStage.doneHint")}</p>
              ) : stage === "generating" ? (
                <p className="narrative-helper">{t("ipStage.generatingHint", { pct: progress?.pct ?? 0 })}{progress?.message ? ` · ${progress.message}` : ""}</p>
              ) : !routingReady ? (
                <p className="narrative-helper">{t("ipStage.routingRequired")}</p>
              ) : (
                <p className="narrative-helper">{t("ipStage.scopeReadyHint")}</p>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="ip-stage-error">{error}</p>}
    </div>
  );
}

export default IpStageFlow;
