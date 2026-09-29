import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "reactflow";
import { useNarrativeStore } from "../../store/narrativeStore";
import { startEntryPipelines, planPipelines, saveEntry } from "../../hooks/useNarrativeStream";
import { getLocale, useT } from "../../i18n";
import type { TierId, ModeId } from "../../types";
import { composerIpGenerators, isEntryNode, type AnchoredPipeline } from "../../composer/composerCatalog";
import { ComposerCanvas } from "./ComposerCanvas";
import { CenterHero } from "../panels/CenterHero";
import { clearComposerRunner, registerComposerRunner } from "../../lib/composerRun";

/**
 * 无限画布编排视图（"未生成"态取代只读节点视图）。
 * Phase-2 M8：按开始节点切分多管线 → /plan（每条各自 config）→ 落盘 entry.pipelines
 * → `/entry/start` 批量启动全部可运行管线（各自 runId / SSE / manifest）。
 */
function composeUserInput(config: Record<string, unknown>): string {
  const tab = (config.inputTab as string) ?? "text";
  if (tab === "tags") {
    const sel = (config.tagSelections as Record<string, string>) ?? {};
    const parts = Object.values(sel).map((v) => String(v ?? "").trim()).filter(Boolean);
    const custom = String(((config.tagCustomTexts as Record<string, string>) ?? {}).custom ?? "").trim();
    if (custom) parts.push(custom);
    return parts.join("；");
  }
  return String(config.userInput ?? "").trim();
}

/** 一条锚定管线解析出的启动参数（各自的 routing / expert 节点为准）。 */
interface ResolvedPipelineConfig {
  startNodeId: string;
  userInput: string;
  routeGroup: "planning" | "narrative";
  tier?: TierId;
  mode?: ModeId;
  genreCode?: string;
  complexity?: number;
  /** 三轴中用户可选的两轴；结构轴由后端按类型+题材推导，前端不传。 */
  storyType?: string;
  storyTheme?: string;
  pipelineTemplate?: string;
  autoDetect: boolean;
  /** 输入节点走的是 IP 文件链，需转交 IP 生成器而非文本管线。 */
  isFileFlow: boolean;
  /**
   * 这条管线的需求是怎么给的（直接输入 / 标签选择 / 文件上传）。
   *
   * 要单独带出来，是因为 `userInput` 只是三种输入方式**折算**后的文本：标签选出来的
   * 五维标签折成一行分号串、文件链折成空串。条目落盘时只认 userInput 就会把标签链
   * 与文件链一律记成"直接输入"，任务面板于是显示不出用户实际投了什么。
   */
  inputTab: "text" | "tags" | "file";
  /** 标签链的原始取值（落盘用，不参与路由）。 */
  tags?: { selections?: Record<string, string>; customTexts?: Record<string, string> };
  /** 文件链投了哪些文件（正文不入条目，只记名单）。 */
  uploadedFileNames?: string[];
  /**
   * 这条管线带的自定义专属团队（2.4）。
   *
   * 团队节点不是步骤，所以它不进 requestedSteps：它是整条管线的修饰，后端据 id 取
   * profile 并按席位注入。这也是它必须单独传的原因——混进步序会被当成一个跑不起来的
   * step 而让整条泳道被判为不完整。
   */
  teamId?: string;
  /**
   * 入口节点上勾选启用的可挂载席（打磨三席）。
   *
   * 与 requestedSteps 不同：这几席不构成一条链，而是"预置管线照跑、锚点席后多挂
   * 一道"。混进 requestedSteps 会把整条预置步序替换成这三步。
   */
  activateSeats?: string[];
}

/**
 * 从锚定管线自身的节点解析配置。
 * 多管线各自有 routing/expert 节点，不能共用首条的参数 —— 否则第二条画布上选的
 * 品类/复杂度会被静默替换成第一条的。
 */
function resolvePipelineConfig(anchored: AnchoredPipeline): ResolvedPipelineConfig {
  const routing = anchored.routingNode;
  const expert = anchored.orderedNodes.find((n) => n.category === "expert");
  const inputCfg = anchored.inputNode.config;
  const rawTab = inputCfg.inputTab as string | undefined;
  const inputTab: ResolvedPipelineConfig["inputTab"] =
    rawTab === "tags" || rawTab === "file" ? rawTab : "text";

  // 冲突以「自由编排」为准：路由节点优先于专家节点。
  const routeGroup =
    (routing?.config.routeGroup as "planning" | "narrative" | undefined) ??
    expert?.routeGroup ??
    "planning";

  let tier: TierId | undefined;
  let mode: ModeId | undefined;
  let genreCode: string | undefined;
  let autoDetect: boolean;

  if (routeGroup === "narrative") {
    mode = (routing?.config.mode as ModeId | undefined) ?? "narrative_auto";
    autoDetect = mode === "narrative_auto";
  } else {
    tier =
      ((routing?.config.tier as TierId | null | undefined) ?? expert?.tier ?? undefined) ||
      undefined;
    // 品类住在专家节点上——选哪个专家就是选哪个品类。需求入口不再有品类字段，
    // 所以这里必须落到专家节点的 config，否则品类丢失 → 后端按 tier 兜到
    // design_auto，跑出来是全量策划的 D0-D4 而不是该专家的叙事管线。
    genreCode =
      ((routing?.config.genreCode as string | undefined) ||
        (expert?.config.genreCode as string | undefined)) ||
      undefined;
    autoDetect = !genreCode;
  }

  return {
    startNodeId: anchored.inputNode.id,
    userInput: composeUserInput(anchored.inputNode.config),
    routeGroup,
    tier,
    mode,
    genreCode,
    complexity: (routing?.config.complexity as number | undefined) ?? undefined,
    // 三轴住在需求入口节点上（它兼任 routingNode）；独立路由节点没有这两轴，取到 undefined 即「自动」。
    storyType: (routing?.config.storyType as string | null | undefined) || undefined,
    storyTheme: (routing?.config.storyTheme as string | null | undefined) || undefined,
    pipelineTemplate: expert?.pipelineTemplate,
    autoDetect,
    isFileFlow: inputTab === "file",
    inputTab,
    tags:
      inputTab === "tags"
        ? {
            selections: (inputCfg.tagSelections as Record<string, string>) ?? {},
            customTexts: (inputCfg.tagCustomTexts as Record<string, string>) ?? {},
          }
        : undefined,
    uploadedFileNames:
      inputTab === "file" ? ((inputCfg.uploadedFileNames as string[]) ?? []) : undefined,
    // 一条管线最多带一位专属成员：多位的技能会在同一段里互相打架，
    // 取可达的第一枚而不是静默合并。
    teamId: (anchored.orderedNodes.find((n) => n.category === "team")?.config.teamId as string | undefined)
      || undefined,
    activateSeats: (anchored.inputNode.config.activateSeats as string[] | undefined) ?? undefined,
  };
}

/** 管线是否连到了可执行节点（否则只 plan 不 start）。 */
function hasExecutableNode(anchored: AnchoredPipeline): boolean {
  // 入口节点自带路由，单它一枚就是一条能跑的管线——不必再往后接点什么才算数。
  if (isEntryNode(anchored.inputNode)) return true;
  return anchored.orderedNodes.some(
    (n) =>
      n.category === "routing" || n.category === "expert" || n.category === "engineer",
  );
}

export function ComposerView() {
  const t = useT();
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  // 订阅 edges：锚点数量随连线变化，保证工具条提示实时刷新。
  useNarrativeStore((s) => s.composerEdges);
  const getAnchoredPipelines = useNarrativeStore((s) => s.getAnchoredPipelines);
  const storeStartNewRun = useNarrativeStore((s) => s.startNewRun);
  const setEntryPipelines = useNarrativeStore((s) => s.setEntryPipelines);
  const setListExpanded = useNarrativeStore((s) => s.setListExpanded);
  const setPipelineRuns = useNarrativeStore((s) => s.setPipelineRuns);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lockRef = useRef(false);

  const pipelines = getAnchoredPipelines();
  const inputCount = pipelines.length;

  const handleRun = useCallback(async () => {
    if (lockRef.current) return;
    setError(null);
    const anchored = getAnchoredPipelines();
    if (anchored.length === 0) {
      setError(t("composer.noInput"));
      return;
    }

    const nodes = useNarrativeStore.getState().composerNodes;
    const edges = useNarrativeStore.getState().composerEdges;

    // 每条锚定管线各自解析配置；文件链（IP 上传）不走文本管线，转交对应生成器。
    const resolved = anchored.map(resolvePipelineConfig);
    const primary =
      resolved.find((r, i) => hasExecutableNode(anchored[i]!) && !r.isFileFlow) ?? resolved[0]!;

    if (primary.isFileFlow) {
      const trigger = composerIpGenerators.get(primary.startNodeId);
      setSelectedId(primary.startNodeId);
      if (trigger?.canGenerate) trigger.generate();
      else setError(t("composer.fileFlowHint"));
      return;
    }

    if (!primary.userInput) {
      setError(t("composer.cfg.inputPlaceholder"));
      setSelectedId(primary.startNodeId);
      return;
    }

    lockRef.current = true;
    setStarting(true);
    try {
      if (useNarrativeStore.getState().runningRunId) {
        useNarrativeStore.getState().cancelRun();
      }

      const configByStart = Object.fromEntries(
        resolved.map((r) => [
          r.startNodeId,
          {
            tier: r.tier ?? null,
            mode: r.mode ?? null,
            genreCode: r.genreCode ?? null,
            storyType: r.storyType ?? null,
            storyTheme: r.storyTheme ?? null,
            complexity: r.complexity,
            routeGroup: r.routeGroup,
            pipelineTemplate: r.pipelineTemplate,
            userInput: r.userInput,
          },
        ]),
      );

      const planned = await planPipelines({
        compositionNodes: nodes.map((n) => ({
          id: n.id,
          catalogId: n.catalogId,
          category: n.category,
          config: n.config,
          agentId: n.stepId ?? n.catalogId,
          position: n.position,
        })),
        compositionEdges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        })),
        config: {
          tier: primary.tier ?? null,
          mode: primary.mode ?? null,
          genreCode: primary.genreCode ?? null,
          storyType: primary.storyType ?? null,
          storyTheme: primary.storyTheme ?? null,
          complexity: primary.complexity,
          routeGroup: primary.routeGroup,
          pipelineTemplate: primary.pipelineTemplate,
          userInput: primary.userInput,
          locale: getLocale() === "en" ? "en" : "zh",
        },
        configByStart,
      });

      const entryKey = planned.entryKey ?? `composer-${Date.now()}`;
      setEntryPipelines(planned.pipelines, planned.pipelines[0]?.pipelineId);
      if (planned.pipelines.length > 1) setListExpanded(entryKey, true);

      await saveEntry(entryKey, {
        // 输入方式按入口节点的实际取值落盘（"works" 是 IP 作品链的既有口径）。
        inputType: primary.inputTab === "tags" ? "tags" : primary.inputTab === "file" ? "works" : "text",
        tags: primary.tags,
        uploadedFileNames: primary.uploadedFileNames,
        userInput: primary.userInput,
        routeGroup: primary.routeGroup,
        tier: primary.tier,
        mode: primary.mode,
        genreCode: primary.genreCode,
        storyType: primary.storyType,
        storyTheme: primary.storyTheme,
        complexity: primary.complexity,
        locale: getLocale() === "en" ? "en" : "zh",
        pipelines: planned.pipelines,
        activePipelineId: planned.pipelines[0]?.pipelineId,
        listExpanded: planned.pipelines.length > 1,
        compositionNodes: nodes,
        compositionEdges: edges,
      });

      // 每条 manifest 配上它那条管线的启动参数：manifest 顺序 == 后端切分顺序 == resolved 顺序。
      const byStart = new Map(resolved.map((r) => [r.startNodeId, r]));
      const requests = planned.pipelines.map((p, i) => {
        const cfg = byStart.get(p.compositionGraph?.startNodeId ?? "") ?? resolved[i];
        return {
          pipelineId: p.pipelineId,
          complete: p.complete && !!cfg && !cfg.isFileFlow,
          incompletenessReason: cfg?.isFileFlow ? "file_flow" : p.incompletenessReason,
          userInput: cfg?.userInput,
          tier: cfg?.tier,
          mode: cfg?.mode,
          genreCode: cfg?.genreCode ?? null,
          storyType: cfg?.storyType ?? null,
          storyTheme: cfg?.storyTheme ?? null,
          complexity: cfg?.complexity,
          routeGroup: cfg?.routeGroup,
          autoDetect: cfg?.autoDetect,
          pipelineTemplate: cfg?.pipelineTemplate,
          // 自由编排：把 /plan 解析出的那条链原样带去启动。不带就等于让后端重新按
          // 预设路由算一遍，用户看着自己的编排、跑的是别的步序（且不报错）。
          requestedSteps:
            p.stepSource === "composition" ? p.agents.map((a) => a.agentId) : undefined,
          // 专属团队（2.4）：后端按 id 取 ready 的 profile 注入各席位；未就绪时它按没选处理。
          teamId: cfg?.teamId,
          // 勾选启用的打磨席：预置管线照跑，只在情节席后多挂这几席。
          activateSeats: cfg?.activateSeats,
        };
      });

      if (!requests.some((r) => r.complete && !!r.userInput?.trim())) {
        setError(t("composer.incompletePipelines"));
        return;
      }

      const started = await startEntryPipelines({
        entryKey,
        locale: getLocale(),
        pipelines: requests,
      });

      setPipelineRuns(
        started.runs.map((r) => ({
          pipelineId: r.pipelineId ?? "",
          runId: r.runId,
          sourceDir: r.sourceDir,
          primary: r.primary,
          status: "running" as const,
          completedSteps: [],
          runningStepId: null,
        })),
      );

      // 主管线接主轨（phase / 取消 / 结果回填仍单头）；次管线由 useSecondaryPipelineStreams 消费。
      const main = started.runs.find((r) => r.primary) ?? started.runs[0];
      if (main) {
        // 条目锚点取批量启动响应的 entryKey（条目级、权威）；产物地址取该管线自己的
        // sourceDir。主管线两者相等，但拿 sourceDir 当条目键在次管线上会错。
        storeStartNewRun(
          main.runId,
          entryKey,
          main.tier as TierId | undefined,
          main.mode as ModeId | undefined,
          main.sourceDir || entryKey,
        );
      }
      if (started.skipped.length > 0) {
        // 跑不起来的环节要指名道姓：只说"跳过了 1 条"用户无从下手改画布。
        const bad = [...new Set(started.skipped.flatMap((s) => s.unrunnableSteps ?? []))];
        setError(
          bad.length > 0
            ? t("composer.unrunnableSteps", { steps: bad.join("、") })
            : t("composer.someSkipped", { n: started.skipped.length }),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lockRef.current = false;
      setStarting(false);
    }
  }, [getAnchoredPipelines, storeStartNewRun, setEntryPipelines, setListExpanded, setPipelineRuns, t]);

  // 开始键归底栏那条居中工具条，画布只把动作交出去；两处各摆一个开始键会让用户犯迷糊。
  useEffect(() => {
    registerComposerRunner({ run: () => void handleRun(), canRun: inputCount > 0, starting });
    return clearComposerRunner;
  }, [handleRun, inputCount, starting]);

  return (
    <div className="composer-view">
      {/* 空画布不摆提示条：设计稿 01 的空态只有水印。「清空画布」挪到底部居中工具条
          跟视图/缩放键放一块（CenterOverlay.tsx）——顶栏留操作提示 + 三层信息架构
          的第三层注释：节点数量、是否选中。单个节点更细的运行状态（未开始/运行中/
          已完成/中断/失败）已经画在节点卡自己身上（ComposerFlowNode 的状态角标 +
          进度环），这里不重复画第二份，只报"有多少、选没选"这层概览。 */}
      {composerNodes.length > 0 && (
        <div className="composer-view__toolbar">
          {/* 只报"选没选"。节点数量归第四层那条注释（CenterNote），
              在它下方 34px 再说一遍同一个数就是重复。 */}
          <span className="composer-view__status">
            {selectedId ? t("composer.status.selected") : t("composer.status.unselected")}
          </span>
          <span className="composer-view__hint">
            {error
              ? error
              : inputCount > 1
                ? t("composer.multiInput", { n: inputCount })
                : t("composer.hint")}
          </span>
        </div>
      )}

      <div className="composer-view__body">
        <div className="composer-view__canvas">
          {composerNodes.length === 0 && (
            <div className="composer-view__empty">
              <CenterHero />
            </div>
          )}
          <ReactFlowProvider>
            <ComposerCanvas selectedId={selectedId} onSelect={setSelectedId} />
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
}
