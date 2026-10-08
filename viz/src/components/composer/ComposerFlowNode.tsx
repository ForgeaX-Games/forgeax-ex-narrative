import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "reactflow";
import { useNarrativeStore } from "../../store/narrativeStore";
import type { StructureVote } from "../../lib/structureVote";
import { useT, getLocale } from "../../i18n";
import {
  TIER_ITEMS,
  NARRATIVE_ROUTES,
  TAG_DIMENSIONS,
  COMPLEXITY_LEVELS,
  TIER_HAS_COMPLEXITY,
} from "../../lib/routingCatalog";
import type { UploadedItem } from "../../lib/uploads";
import { fetchGenres, type GenreCategoryGroup, type NarrativeAxesCatalog } from "../../hooks/useNarrativeStream";
import { loadNarrativeAxes, axisOptionLabel } from "../../lib/axesCache";
import { useSingleAgentRun } from "../../hooks/useSingleAgentRun";
import {
  computeAnchoredPipelines,
  composerNodeLabel,
  isEntryNode,
  composerUploads,
} from "../../composer/composerCatalog";
import { NodeProgressBar, NodeProgressRing, statusPct } from "../nodes/NodeProgress";
import type { TierId, ModeId } from "../../types";
import { ComposerFileEditor } from "./ComposerFileEditor";
import { ASSISTANT_SEATS } from "../../composer/seats.generated";

/** 可挂载席：从席位投影现取，手抄一份 id 会在席位改名后静默失效。 */
const ATTACHABLE_SEATS = ASSISTANT_SEATS.filter((s) => s.pipelineRole === "attachable");

/** 投票依据里轴名到界面文案 key 的对应。 */
const VOTE_AXIS_LABEL_KEYS: Record<string, string> = {
  genre: "composer.cfg.structure.axis.genre",
  type: "composer.cfg.storyType",
  theme: "composer.cfg.storyTheme",
};

/**
 * 第四轴：推出了什么结构、凭什么，以及要不要改。
 *
 * 结构默认不由用户挑 —— 一开始他没有依据。但把推导结论和各轴的推荐摆出来之后他
 * 就有依据了，此时给一个覆盖入口才是成立的：结构决定整棵剧情树的分叉密度、是否
 * 收束、有几个结局，换一条轴就换出另一棵树，用户有权在看懂之后说"我要线性"。
 *
 * 覆盖写进 routing 草稿（不是写死结论），选回「跟随推导」就重新交给投票。
 */
function StructureField({
  vote,
  override,
  onOverride,
  axes,
  t,
}: {
  vote: StructureVote | null;
  override: string | null;
  onOverride: (code: string | null) => void;
  axes: NarrativeAxesCatalog;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const nameOf = (code: string): string => {
    const hit = axes.structures.find((o) => o.code === code);
    return hit ? axisOptionLabel(hit) : code;
  };

  const basis = Object.entries(vote?.byAxis ?? {})
    .filter(([, codes]) => codes.length > 0)
    .map(([axis, codes]) => {
      const key = VOTE_AXIS_LABEL_KEYS[axis];
      return `${key ? t(key) : axis} → ${codes.map(nameOf).join("、")}`;
    });

  // 三轴全空又没覆盖时整块不出现：那时还没有任何投票发生过，摆一个"未选"
  // 只会让人以为哪里漏配了。
  if (!vote?.structure && !override) return null;

  return (
    <label className="composer-config__field">
      <span className="composer-config__label">{t("composer.cfg.structure")}</span>
      <select
        className="composer-config__select"
        value={override ?? ""}
        onChange={(e) => onOverride(e.target.value || null)}
      >
        <option value="">
          {vote?.structure
            ? t("composer.cfg.structure.follow", { name: nameOf(vote.structure) })
            : t("composer.cfg.tierAuto")}
        </option>
        {axes.structures.map((o) => (
          <option key={o.code} value={o.code}>{axisOptionLabel(o)}</option>
        ))}
      </select>
      <span className="composer-config__hint">
        {override
          ? t("composer.cfg.structure.explicit")
          : t("composer.cfg.structure.voted")}
      </span>
      {/* 依据只在跟随推导时给：自己点定了结构，再列各轴推荐就成了噪音。 */}
      {!override && basis.length > 0 && (
        <ul className="composer-config__basis">
          {basis.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </label>
  );
}

const LONG_PRESS_MS = 250;
const MOVE_THRESHOLD = 4;

export interface ComposerFlowData {
  isolated?: boolean;
}

interface DragState {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  dragging: boolean;
  moved: boolean;
}

// 品类目录按 locale 缓存（多个「叙事全量」节点复用同一份，避免重复请求）。
const genreCache: Record<string, Promise<GenreCategoryGroup[]>> = {};
function loadGenres(locale: string): Promise<GenreCategoryGroup[]> {
  if (!genreCache[locale]) genreCache[locale] = fetchGenres(locale).catch(() => []);
  return genreCache[locale];
}

/**
 * 无限画布节点组件。参照管线状态节点（PipelineStepNode）：横向左入右出、前后连接。
 *
 * 交互（内在逻辑 = 并/交/补）：
 *  - 拖动手柄 = 标题栏 ∪ 简介栏(收起态)；展开态简介栏隐藏，手柄只剩标题栏。
 *  - 交互补集 = 详情/编辑栏（展开态）：点击编辑，不触发拖动/平移。
 *  - 节点整体带 `nopan`：长按拖节点时画布不跟随；空白画布仍可拖动平移。
 *  - 长按(≥250ms)标题/简介栏进入拖动；短按(几乎无位移)切换展开/收起。
 *
 * 详情栏完全复刻左侧栏对应入口：
 *  - 直接输入 → 需求文本框；标签选择 → 五维标签+自定义；文件上传 → 拖放区+文件列表。
 *  - 需求入口 → 输入方式三选一 + 三轴（叙事类型/叙事题材/叙事体量）。
 *  - 叙事全量 → 叙事层级/游戏品类/复杂度；叙事单品 → 叙事模块/复杂度。
 */
function ComposerFlowNodeRaw({ id, data, selected }: NodeProps<ComposerFlowData>) {
  const t = useT();
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  const composerEdges = useNarrativeStore((s) => s.composerEdges);
  const node = composerNodes.find((n) => n.id === id);
  const setComposerNodeConfig = useNarrativeStore((s) => s.setComposerNodeConfig);
  const moveComposerNode = useNarrativeStore((s) => s.moveComposerNode);
  const { getViewport } = useReactFlow();
  const [expanded, setExpanded] = useState(false);
  // 文件上传件的正文（含 base64）驻留在会话级 composerUploads，不入 store：几 MB 的
  // 正文不该进持久化快照。本地 state 只是它的镜像，初值从注册表取回——收起节点、
  // 切视图都会卸载本组件，没有这次取回，用户投过的文件会在重新展开时凭空消失。
  const [uploadedItems, setUploadedItems] = useState<UploadedItem[]>(
    () => composerUploads.get(id) ?? [],
  );

  const dragRef = useRef<DragState | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const cfg = node?.config ?? {};
  const savedUploadNames = (cfg.uploadedFileNames as string[] | undefined) ?? [];

  /**
   * 文件名单：本轮真收到文件就用它，否则退回 config 里存的那份。
   *
   * 退回这一步是关键：节点组件在画布上会被卸载重挂（视口剔除、切视图、刷新页面），
   * 本地态一并归零。没有这份回退，上传过的文件在重挂后既不显示、`inputReady` 也变假，
   * 用户会看到确认键突然点不动——而他什么都没改。
   */
  const uploadNames = uploadedItems.length > 0
    ? uploadedItems.map((f) => f.name)
    : savedUploadNames;

  /** 文件件变了：正文进会话注册表，名单进 config。 */
  const onUploadItemsChange = (items: UploadedItem[]): void => {
    setUploadedItems(items);
    if (items.length > 0) composerUploads.set(id, items);
    else composerUploads.delete(id);
    if (!node) return;
    const names = items.map((f) => f.name);
    const same =
      names.length === savedUploadNames.length && names.every((n, i) => n === savedUploadNames[i]);
    // 名单没变就不写：无差别回写会把"已确认"擦成"待确认"，而用户什么也没动。
    if (same) return;
    setComposerNodeConfig(node.id, { uploadedFileNames: names, confirmed: false });
  };
  const routeGroup = (cfg.routeGroup as string) ?? "planning";
  /**
   * 需求从哪来 —— 两条入口，不是三档说法。
   *
   * 从前是 `text | tags | file` 三档互斥，于是需求文本与标签六维二选一。v4 的口径是三者
   * 并存（需求描述 + 标签设置 + 体量选择，"与"不是"或"），所以文本与标签同属"自己描述"
   * 这一条入口，同屏并列；`adapted` 才是另一条入口（上传原作改编）。
   *
   * 存量节点 config 里可能还写着旧三档，在这里吃下来：服务端的 `toIntakeSource` 管盘上的
   * 存量，这里管前端状态里的存量。
   */
  const inputTab: "authored" | "adapted" = (() => {
    const raw = String(cfg.inputTab ?? "").toLowerCase();
    return raw === "adapted" || raw === "file" || raw === "works" ? "adapted" : "authored";
  })();

  // 入口节点出「需求输入 + 三轴」；独立的叙事全量/单品路由节点出旧的层级·品类·模块面板。
  const isEntry = !!node && isEntryNode(node);
  const showInputCfg = node?.category === "input";
  const showRoutingCfg = node?.category === "routing";
  const showAxesCfg = isEntry;

  // 第四轴的推导结论：由 /plan 预演算出，provider 写进 store，这里只读。
  const structureVote = useNarrativeStore((s) => s.structureVote);

  // 三轴词表（类型/题材/结构）：入口节点专用，进程内共享一次请求。
  const [axes, setAxes] = useState<NarrativeAxesCatalog>({ types: [], themes: [], structures: [] });
  useEffect(() => {
    if (!showAxesCfg) return;
    let alive = true;
    void loadNarrativeAxes().then((a) => { if (alive) setAxes(a); });
    return () => { alive = false; };
  }, [showAxesCfg]);

  // 「叙事全量」节点：拉取品类目录（按 locale 缓存）。
  // 专家节点也要：卡上报的管线名由品类查表得出，静态快捷项（JRPG/ORPG/影游）
  // 拖进来时不带管线信息，需要现查——前端不推算品类→管线，那是后端的表。
  const [genres, setGenres] = useState<GenreCategoryGroup[]>([]);
  const needGenres =
    (showRoutingCfg && routeGroup === "planning") ||
    (node?.category === "expert" && !node.narrativePipelineName);
  useEffect(() => {
    if (!needGenres) return;
    let alive = true;
    loadGenres(getLocale()).then((g) => { if (alive) setGenres(g); });
    return () => { alive = false; };
  }, [needGenres]);

  const tierVal = (cfg.tier as string | null) ?? null;
  const genreOptions = useMemo(() => {
    if (!tierVal || tierVal === "auto") return [];
    return genres
      .flatMap((c) => c.genres)
      .filter((g) => g.tier === tierVal)
      .map((g) => ({ code: g.code, name: g.name }));
  }, [genres, tierVal]);

  /** 专家节点跑的席位管线：节点自带的优先，缺了按 genreCode 查品类目录。 */
  const expertPipeline = useMemo(() => {
    if (node?.category !== "expert") return null;
    if (node.narrativePipelineId || node.narrativePipelineName) {
      return { id: node.narrativePipelineId, name: node.narrativePipelineName };
    }
    const code = cfg.genreCode as string | undefined;
    const g = code ? genres.flatMap((c) => c.genres).find((x) => x.code === code) : undefined;
    return g ? { id: g.narrative_pipeline, name: g.narrative_pipeline_name } : null;
  }, [node, cfg.genreCode, genres]);

  // 文件上传节点：从下游连接的「叙事路由」节点解析 tier/mode/complexity/是否就绪，喂给 IpStageFlow。
  const fileRouting = useMemo(() => {
    if (!node || node.category !== "input" || inputTab !== "adapted") return null;
    const mine = computeAnchoredPipelines(composerNodes, composerEdges).find(
      (p) => p.inputNode.id === node.id,
    );
    const r = mine?.routingNode;
    const rc = (r?.config ?? {}) as Record<string, unknown>;
    const rTier = (rc.tier as TierId | null | undefined) ?? undefined;
    const rMode = rc.mode as ModeId | undefined;
    const rGenre = rc.genreCode as string | undefined;
    const routingReady = !!rTier || !!rGenre || (!!rMode && rMode !== "narrative_auto");
    return {
      tier: rTier,
      mode: r?.routeGroup === "narrative" ? rMode : undefined,
      complexity: rc.complexity as number | undefined,
      routingReady,
    };
  }, [node, inputTab, composerNodes, composerEdges]);

  // 单 agent 试跑（Phase-2 M9）：工程师 = 单步 agent，专家 = composite 子 DAG。
  // 专家取 catalogId（expert.genre.<code> / expert.jrpg 这类），它就是后端注册的
  // composite AgentDef id；旧版取 pipelineTemplate，那是个 step 模板 id，
  // 注册表里查不到 tpl-vn-v2，点试跑只会得到「未知 agent」。
  const soloRun = useSingleAgentRun();
  const soloAgentId =
    node?.category === "engineer"
      ? (node.stepId ?? null)
      : node?.category === "expert"
        ? (node.catalogId ?? null)
        : null;
  // 试跑要有需求文本：取本节点所在管线的输入节点内容（与 fileRouting 同一条解析路径）。
  const soloUserInput = useMemo(() => {
    if (!node || !soloAgentId) return "";
    const mine = computeAnchoredPipelines(composerNodes, composerEdges).find((p) =>
      p.orderedNodes.some((n) => n.id === node.id),
    );
    return String(mine?.inputNode.config.userInput ?? "").trim();
  }, [node, soloAgentId, composerNodes, composerEdges]);

  if (!node) return null;
  const isolated = data.isolated && node.category !== "input";

  // ── 节点起止类型 & 连接态（Part4）──────────────────────────────
  // 起始节点 = 输入节点（管线锚点）：无前驱，左侧不出把手。
  // 结尾节点：暂无固定"结尾"类别，其余节点左右皆出把手，供自由串接。
  const isStart = node.category === "input";
  const hasIncoming = composerEdges.some((e) => e.target === node.id);
  const hasOutgoing = composerEdges.some((e) => e.source === node.id);
  const set = (patch: Record<string, unknown>) => setComposerNodeConfig(node.id, patch);
  // 编辑内容即置为"待确认"（脏态）；点「确认」才置 confirmed。
  const setField = (patch: Record<string, unknown>) => set({ ...patch, confirmed: false });
  const confirmed = !!cfg.confirmed;
  const needsConfirm = node.category === "input" || node.category === "routing";

  // ── 拖动手柄：长按拖动 / 短按切换 ──────────────────────────────
  const onDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: node.position.x,
      origY: node.position.y,
      dragging: false,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      const ds = dragRef.current;
      if (ds) ds.dragging = true;
    }, LONG_PRESS_MS);
  };

  const onDragPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) ds.moved = true;
    if (ds.dragging) {
      const zoom = getViewport().zoom || 1;
      moveComposerNode(node.id, { x: ds.origX + dx / zoom, y: ds.origY + dy / zoom });
    }
  };

  const onDragPointerUp = (e: React.PointerEvent) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const ds = dragRef.current;
    dragRef.current = null;
    if (!ds) return;
    if (!ds.moved) setExpanded((v) => !v);
  };

  const cls = [
    "rf-pipeline-node",
    "composer-node",
    "composer-node--card",
    "nopan",
    `cat-${node.category}`,
    selected ? "selected" : "",
    isolated ? "isolated" : "",
    expanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  /** 折叠态的一行摘要。两半都可能有值，就都摘出来 —— 只报一半会让另一半看着像没填。 */
  const inputSummary = (): string => {
    if (inputTab === "adapted") {
      return uploadNames.length ? uploadNames.join(", ") : t("composer.cfg.fileEmpty");
    }
    const sel = (cfg.tagSelections as Record<string, string>) ?? {};
    const picked = Object.values(sel).filter(Boolean);
    const text = String(cfg.userInput ?? "").trim();
    const parts = [text, picked.join(" · ")].filter(Boolean);
    return parts.length ? parts.join(" ｜ ") : t("composer.node.noInput");
  };

  /**
   * 可挂载席（打磨三席）：不在预置步序里，勾选才跑。
   *
   * 从后端席位投影现取而不是手抄一份 id 列表——手抄的那份会在席位改名后
   * 静默失效（勾了没反应，因为后端认不出这个 id）。
   */
  const activeSeats = (cfg.activateSeats as string[] | undefined) ?? [];

  /** 入口节点的路由这一半：三轴各报一格，没选的报「自动」——留空是合法选择，不是缺项。 */
  const axisSummary = (): string => {
    const auto = t("composer.cfg.tierAuto");
    const typeCode = (cfg.storyType as string | null) ?? null;
    const themeCode = (cfg.storyTheme as string | null) ?? null;
    const hit = (list: typeof axes.types, code: string | null) => {
      if (!code) return auto;
      const o = list.find((x) => x.code === code);
      return o ? axisOptionLabel(o) : code;
    };
    const lv = cfg.complexity as number | undefined;
    const scaleLab = lv ? t(`complexity.${lv}.label`) : null;
    const scale = lv ? (scaleLab === `complexity.${lv}.label` ? String(lv) : scaleLab) : auto;
    return `${hit(axes.types, typeCode)}｜${hit(axes.themes, themeCode)}｜${scale}`;
  };

  const routeSummary = (): string => {
    if (routeGroup === "narrative") {
      const m = (cfg.mode as string) || "narrative_auto";
      const lab = t(`route.${m}.label`);
      return lab === `route.${m}.label` ? m : lab;
    }
    const tl = tierVal
      ? (t(`tier.${tierVal}`) === `tier.${tierVal}` ? tierVal.toUpperCase() : t(`tier.${tierVal}`))
      : t("composer.cfg.tierAuto");
    const g = cfg.genreCode ? ` · ${cfg.genreCode}` : "";
    return `${label(t, "composer.cfg.routeGroup.planning")}｜${tl}${g}`;
  };

  const summary = (() => {
    switch (node.category) {
      // 入口节点一行报两半：需求说了什么，以及三轴落在哪。
      case "input":
        return isEntry ? `${inputSummary()} ⟶ ${axisSummary()}` : inputSummary();
      case "routing":
        return routeSummary();
      // 专家卡报的是「跑哪条席位管线」。旧版报 tpl-* 模板 id，那是四期前的步序模板，
      // 与后端实际路由的 pl-* 管线不是一回事，卡上写着 v2 而后端跑的是新管线。
      // 无品类的「其他品类叙事专家」报「自动」：管线由后端识别出品类后才定，
      // 这时报空白会让人以为节点坏了。
      case "expert":
        return expertPipeline?.name ?? expertPipeline?.id ?? t("composer.cfg.tierAuto");
      case "assistant":
        return t("composer.cfg.strategy");
      case "engineer":
        return node.stepId ?? t("composer.cfg.step");
      default:
        return "";
    }
  })();

  const statusKind: "isolated" | "ready" | "pending" = isolated
    ? "isolated"
    : needsConfirm
      ? (confirmed ? "ready" : "pending")
      : "ready";
  const statusText =
    statusKind === "isolated"
      ? t("composer.node.isolated")
      : statusKind === "pending"
        ? t("composer.node.unconfirmed")
        : needsConfirm
          ? t("tms.confirmDone")
          : t("composer.node.ready");

  // 试跑起来之后，这枚节点就该像管线节点那样报进度：标题栏换成进度环，底部一条进度条。
  // 环与条用的是与管线视图同一份实现（NodeProgress），两侧的"生成中"长一个样。
  const runStatus =
    soloRun.state.status === "running"
      ? "running"
      : soloRun.state.status === "completed"
        ? "completed"
        : soloRun.state.status === "failed"
          ? "failed"
          : null;
  const runPct = (() => {
    if (!runStatus) return 0;
    const total = soloRun.state.steps.length;
    const done = soloRun.state.steps.filter((s) => s.status === "completed").length;
    const ratio = total > 0 ? Math.round((done / total) * 100) : undefined;
    return statusPct(runStatus, ratio);
  })();

  const complexityOptions = COMPLEXITY_LEVELS.map((c) => {
    const lab = t(`complexity.${c.level}.label`);
    return { level: c.level, label: lab === `complexity.${c.level}.label` ? String(c.level) : lab };
  });

  /** 需求这一半填够了没。入口节点的"确认"只有一枚，得同时管住三种说法中当前那一种。 */
  const inputReady = (() => {
    if (inputTab === "adapted") return uploadNames.length > 0;
    // 文本与标签并存，所以门槛是"至少给了一样"，不是"当前那一档填了"。都给满也对。
    const sel = (cfg.tagSelections as Record<string, string>) ?? {};
    const custom = String(((cfg.tagCustomTexts as Record<string, string>) ?? {}).custom ?? "").trim();
    return (
      !!String(cfg.userInput ?? "").trim() ||
      Object.values(sel).filter(Boolean).length > 0 ||
      !!custom
    );
  })();

  const INPUT_WAYS: { id: "authored" | "adapted"; labelKey: string }[] = [
    { id: "authored", labelKey: "composer.item.input.authored" },
    { id: "adapted", labelKey: "composer.item.input.adapted" },
  ];

  return (
    <div className={cls}>
      {/* 起始节点（输入）无左把手；其余左侧出把手，空心=未连线 / 实心=已连线 */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Left}
          className={`rf-handle composer-handle ${hasIncoming ? "is-filled" : "is-empty"}`}
        />
      )}

      {/* 拖动手柄：标题栏 + 简介栏(收起) */}
      <div
        className="composer-node__drag"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
      >
        <div className="rf-pipeline-header composer-node__head">
          <span className="composer-node__icon" aria-hidden>{node.icon}</span>
          <span className="rf-pipeline-label composer-node__title">{composerNodeLabel(t, node)}</span>
          {runStatus ? (
            <NodeProgressRing pct={runPct} status={runStatus} size={16} />
          ) : (
            <span className={`composer-node__status is-${statusKind}`}>
              <span className="composer-node__status-dot" aria-hidden />
              <span className="composer-node__status-text">{statusText}</span>
            </span>
          )}
        </div>
        {!expanded && (
          <div className="composer-node__summary" title={typeof summary === "string" ? summary : undefined}>
            {summary}
          </div>
        )}
      </div>
      {runStatus && <NodeProgressBar pct={runPct} status={runStatus} />}

      {/* 详情/编辑栏（交互补集）：点击编辑，不触发拖动/平移 */}
      {expanded && (
        <div className="composer-node__editor nodrag nopan">
          {/* ── 入口节点：三种说法自己挑一种，不必回目录里换一枚节点 ── */}
          {isEntry && (
            <div className="composer-config__field">
              <span className="composer-config__label">{t("composer.cfg.inputWay")}</span>
              <div className="composer-config__seg">
                {INPUT_WAYS.map((way) => (
                  <button
                    key={way.id}
                    type="button"
                    className={`composer-config__seg-btn${inputTab === way.id ? " is-active" : ""}`}
                    onClick={() => setField({ inputTab: way.id })}
                  >
                    {t(way.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── 自己描述：需求文本与标签六维同屏，两者并存（填一样、填两样都行）── */}
          {showInputCfg && inputTab === "authored" && (
            <>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.input")}</span>
                <textarea
                  className="composer-config__textarea"
                  rows={5}
                  placeholder={t("composer.cfg.inputPlaceholder")}
                  value={(cfg.userInput as string) ?? ""}
                  onChange={(e) => setField({ userInput: e.target.value })}
                />
              </label>
              {TAG_DIMENSIONS.filter((d) => !d.allowCustom).map((dim) => (
                <label className="composer-config__field" key={dim.key}>
                  <span className="composer-config__label">{t(dim.nameKey)}</span>
                  <select
                    className="composer-config__select"
                    value={((cfg.tagSelections as Record<string, string>) ?? {})[dim.key] ?? ""}
                    onChange={(e) =>
                      setField({
                        tagSelections: {
                          ...((cfg.tagSelections as Record<string, string>) ?? {}),
                          [dim.key]: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">{t("tms.tags.unlimited") === "tms.tags.unlimited" ? "不限" : t("tms.tags.unlimited")}</option>
                    {dim.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.tagsCustom")}</span>
                <input
                  className="composer-config__input"
                  type="text"
                  placeholder={t("composer.cfg.tagsCustomPlaceholder")}
                  value={((cfg.tagCustomTexts as Record<string, string>) ?? {}).custom ?? ""}
                  onChange={(e) =>
                    setField({
                      tagCustomTexts: {
                        ...((cfg.tagCustomTexts as Record<string, string>) ?? {}),
                        custom: e.target.value,
                      },
                    })
                  }
                />
              </label>
              {!isEntry && (
                <ConfirmFoot
                  confirmed={confirmed}
                  disabled={!inputReady}
                  onConfirm={() => set({ confirmed: true })}
                  t={t}
                />
              )}
            </>
          )}

          {/* ── 上传原作改编（§1.3：真实读取 + IP 预处理流程 IpStageFlow）── */}
          {showInputCfg && inputTab === "adapted" && fileRouting && (
            <ComposerFileEditor
              nodeId={node.id}
              items={uploadedItems}
              onItemsChange={onUploadItemsChange}
              tier={fileRouting.tier}
              mode={fileRouting.mode}
              complexity={fileRouting.complexity}
              routingReady={fileRouting.routingReady}
            />
          )}

          {/* ── 入口节点的三轴：类型 / 题材 / 体量。
                 第四轴「叙事结构」不给用户选，但给他看：它由品类+类型+题材投票推出
                 （resolveNarrativeStructure），而结构决定整棵剧情树的分叉密度、是否收束、
                 有几个结局。换一条轴就换出另一种结构，藏起来用户只能盲信一个看不到来路的结论。
                 游戏品类与单品模块也不在这儿：前者由策划专家组选定，后者由单品助手团队定。 ── */}
          {showAxesCfg && (
            <>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.storyType")}</span>
                <select
                  className="composer-config__select"
                  value={(cfg.storyType as string) ?? ""}
                  onChange={(e) => setField({ storyType: e.target.value || null })}
                >
                  <option value="">{t("composer.cfg.tierAuto")}</option>
                  {axes.types.map((o) => (
                    <option key={o.code} value={o.code}>{axisOptionLabel(o)}</option>
                  ))}
                </select>
              </label>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.storyTheme")}</span>
                <select
                  className="composer-config__select"
                  value={(cfg.storyTheme as string) ?? ""}
                  onChange={(e) => setField({ storyTheme: e.target.value || null })}
                >
                  <option value="">{t("composer.cfg.tierAuto")}</option>
                  {axes.themes.map((o) => (
                    <option key={o.code} value={o.code}>{axisOptionLabel(o)}</option>
                  ))}
                </select>
              </label>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.scale")}</span>
                <select
                  className="composer-config__select"
                  value={(cfg.complexity as number) ?? ""}
                  onChange={(e) => setField({ complexity: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">{t("composer.cfg.tierAuto")}</option>
                  {complexityOptions.map((c) => (
                    <option key={c.level} value={c.level}>{c.label}</option>
                  ))}
                </select>
              </label>
              <StructureField
                vote={structureVote}
                override={(cfg.narrativeStructure as string | null) ?? null}
                onOverride={(code) => setField({ narrativeStructure: code })}
                axes={axes}
                t={t}
              />
              {/* ── 可挂载席：勾一下就在预置管线里多过一道，不必手连整条链。
                     默认全关——三席都作用在情节层，全开等于情节生成完再过三轮 LLM。 ── */}
              <div className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.attachSeats")}</span>
                <div className="composer-config__checks">
                  {ATTACHABLE_SEATS.map((seat) => {
                    const on = activeSeats.includes(seat.id);
                    return (
                      <label key={seat.id} className="composer-config__check" title={t("nav.seat.role.attachable.hint")}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setField({
                              activateSeats: on
                                ? activeSeats.filter((s) => s !== seat.id)
                                : [...activeSeats, seat.id],
                            })
                          }
                        />
                        <span>{seat.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── 叙事路由：叙事全量 ── */}
          {showRoutingCfg && routeGroup === "planning" && (
            <>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.tier")}</span>
                <select
                  className="composer-config__select"
                  value={tierVal ?? "auto"}
                  onChange={(e) => setField({ tier: e.target.value === "auto" ? null : e.target.value, genreCode: null })}
                >
                  {TIER_ITEMS.map((it) => {
                    const lab = it.id === "auto"
                      ? t("composer.cfg.tierAuto")
                      : (t(`tier.${it.id}`) === `tier.${it.id}` ? it.id.toUpperCase() : t(`tier.${it.id}`));
                    return <option key={it.id} value={it.id}>{lab}</option>;
                  })}
                </select>
              </label>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.genreSelect")}</span>
                <select
                  className="composer-config__select"
                  value={(cfg.genreCode as string) ?? ""}
                  disabled={!tierVal || tierVal === "auto"}
                  onChange={(e) => setField({ genreCode: e.target.value || null })}
                >
                  <option value="">
                    {!tierVal || tierVal === "auto"
                      ? t("composer.cfg.tierSelectFirst")
                      : (t("field.any") === "field.any" ? "不限" : t("field.any"))}
                  </option>
                  {genreOptions.map((g) => (
                    <option key={g.code} value={g.code}>{g.name}</option>
                  ))}
                </select>
              </label>
              {TIER_HAS_COMPLEXITY[tierVal ?? "auto"] && (
                <label className="composer-config__field">
                  <span className="composer-config__label">{t("composer.cfg.complexity")}</span>
                  <select
                    className="composer-config__select"
                    value={(cfg.complexity as number) ?? ""}
                    onChange={(e) => setField({ complexity: e.target.value ? Number(e.target.value) : undefined })}
                  >
                    <option value="">{t("composer.cfg.tierAuto")}</option>
                    {complexityOptions.map((c) => (
                      <option key={c.level} value={c.level}>{c.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {/* ── 叙事路由：叙事单品 ── */}
          {showRoutingCfg && routeGroup === "narrative" && (
            <>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.module")}</span>
                <select
                  className="composer-config__select"
                  value={(cfg.mode as string) ?? "narrative_auto"}
                  onChange={(e) => setField({ mode: e.target.value })}
                >
                  {NARRATIVE_ROUTES.map((r) => {
                    const lab = t(`route.${r.id}.label`);
                    return <option key={r.id} value={r.id}>{lab === `route.${r.id}.label` ? r.id : lab}</option>;
                  })}
                </select>
              </label>
              {(NARRATIVE_ROUTES.find((r) => r.id === (cfg.mode ?? "narrative_auto"))?.hasComplexity) && (
                <label className="composer-config__field">
                  <span className="composer-config__label">{t("composer.cfg.complexity")}</span>
                  <select
                    className="composer-config__select"
                    value={(cfg.complexity as number) ?? ""}
                    onChange={(e) => setField({ complexity: e.target.value ? Number(e.target.value) : undefined })}
                  >
                    <option value="">{t("composer.cfg.tierAuto")}</option>
                    {complexityOptions.map((c) => (
                      <option key={c.level} value={c.level}>{c.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {/* ── 确认（叙事全量 / 叙事单品 / 需求入口 共用；确认后条目/生成由顶部统一触发）。
                 入口节点走同一枚按钮，但要等需求那一半也填了才点得动。 ── */}
          {(showRoutingCfg || showAxesCfg) && (
            <ConfirmFoot
              confirmed={confirmed}
              disabled={isEntry && !inputReady}
              onConfirm={() => set({ confirmed: true })}
              t={t}
            />
          )}

          {/* ── 专家 / 助手 / 工程师：只读信息 ── */}
          {node.category === "expert" && expertPipeline && (
            <div className="composer-config__field">
              <span className="composer-config__label">{t("composer.cfg.pipeline")}</span>
              <span className="composer-config__readonly" title={expertPipeline.id ?? ""}>
                {expertPipeline.name ?? expertPipeline.id}
                {node.tier ? ` · ${node.tier.toUpperCase()}` : ""}
              </span>
            </div>
          )}
          {soloAgentId && (
            <SoloRunFoot
              agentId={soloAgentId}
              userInput={soloUserInput}
              run={soloRun}
              t={t}
            />
          )}
          {node.category === "assistant" && (
            <div className="composer-config__field">
              <span className="composer-config__label">{t("composer.cfg.strategy")}</span>
              <span className="composer-config__readonly">{composerNodeLabel(t, node)}</span>
            </div>
          )}
          {node.category === "engineer" && (
            <div className="composer-config__field">
              <span className="composer-config__label">{t("composer.cfg.step")}</span>
              <span className="composer-config__readonly">{node.stepId ?? composerNodeLabel(t, node)}</span>
            </div>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className={`rf-handle composer-handle ${hasOutgoing ? "is-filled" : "is-empty"}`}
      />
    </div>
  );
}

/** 节点确认按钮（复刻左栏 §1/§2「确认」）：确认后置灰显示「✓ 确认」，编辑内容后重新点亮。 */
function ConfirmFoot({
  confirmed,
  disabled,
  onConfirm,
  t,
}: {
  confirmed: boolean;
  disabled: boolean;
  onConfirm: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="ip-stage-card__foot composer-config__foot">
      <button
        type="button"
        className="btn-generate btn-generate--compact ip-stage-btn"
        disabled={disabled || confirmed}
        onClick={onConfirm}
      >
        {confirmed ? t("tms.confirmDone") : t("tms.confirm")}
      </button>
    </div>
  );
}

/**
 * 单 agent 试跑控件（Phase-2 M9）。
 * composite 专家会按子步逐个点亮，故这里把 announce 出来的步序原样铺成 chip 行。
 */
function SoloRunFoot({
  agentId,
  userInput,
  run,
  t,
}: {
  agentId: string;
  userInput: string;
  run: ReturnType<typeof useSingleAgentRun>;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const { state, start } = run;
  const running = state.status === "running";
  const done = state.steps.filter((s) => s.status === "completed").length;
  return (
    <div className="composer-config__field composer-solo">
      <span className="composer-config__label">{t("composer.solo.label")}</span>
      <div className="composer-solo__row">
        <button
          type="button"
          className="btn-generate btn-generate--compact ip-stage-btn"
          disabled={running || !userInput}
          title={userInput ? undefined : t("composer.solo.needInput")}
          onClick={() => start(agentId, { userInput })}
        >
          {running
            ? t("composer.solo.running", { done, total: state.steps.length })
            : t("composer.solo.run")}
        </button>
        {state.status === "completed" && (
          <span className="composer-solo__state is-completed">{t("composer.solo.done")}</span>
        )}
        {state.status === "failed" && (
          <span className="composer-solo__state is-failed" title={state.error}>
            {t("composer.solo.failed")}
          </span>
        )}
      </div>
      {state.steps.length > 0 && (
        <div className="composer-solo__steps">
          {state.steps.map((s) => (
            <span key={s.id} className={`composer-solo__step is-${s.status}`} title={s.message}>
              {s.id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 小工具：i18n 取值，缺失回退。 */
function label(t: (k: string) => string, key: string): string {
  const v = t(key);
  return v === key ? key.split(".").pop() ?? key : v;
}

export const ComposerFlowNode = memo(ComposerFlowNodeRaw);
