/**
 * 路由与输入的纯元数据表 + 无状态派生函数。
 *
 * 从 TierModeSelector 抽出：拆栏之后需求输入在中栏、项目清单在左栏，两边都要读这些表，
 * 再放在某个组件文件里就成了跨栏的隐式依赖。这里只放没有 React 状态的东西。
 */

import type { TierId, ModeId, NarrativeContext } from "../types";
import { PIPELINE_STEPS, STEP_CTX_FIELD } from "../types";
import type { StepState } from "../store/narrativeStore";
import type { HistoryEntry, IpDnaHierarchySummary } from "../hooks/useNarrativeStream";
import { planPipelines } from "../hooks/useNarrativeStream";
import { t as tGlobal } from "../i18n";

export type RouteGroup = "narrative" | "planning";

/**
 * IP DNA 半自动前驱节点链（输入 + IP 处理），拼在生成管线 previewStepOrder 头部（WS-F）。
 * 改编规划(ip_adapt_plan) 合并了范围裁剪 + 游戏单元；拆解(ip_decompose) 为可选分支，仅在体量超线时按需插入（§3.5 动态分步）。
 * 中间管线的 C 序号由 PipelineStatusBar 按实际出现顺序动态赋号，故此链可随路径增减而序号自洽。
 */
export const IP_PREDECESSOR_STEPS = ["ip_input", "ip_standardize", "ip_volume", "ip_adapt_plan", "ip_dna_extract"];

/**
 * 叙事路由清单（纯 UI 元数据）。
 *
 * Phase-2 M9：每个路由的 steps 镜像已删除 —— 那是后端 modes.ts 的第二份实现，
 * 只用于「/plan 返回前先画一条链」，漂移时会给用户看错的管线。步序统一问 /plan。
 * 这里只留下渲染按钮需要的东西：id 与「该路由是否开放复杂度档位」。
 *
 * E3：`fragmented` / `card_narrative` / `open_world_narrative` 已随 C3 从后端
 * `modes.ts` 退场（吸收进 lore_generation/plot_generation 的通用实现），这里跟着摘下
 * 使其不再可选。`ModeId` 类型联合与 `route.*.label/hint` 的 i18n 条目仍保留，
 * 历史条目里存的旧 mode 值要能正常读出名字。
 */
export const NARRATIVE_ROUTES: { id: ModeId; hasComplexity: boolean }[] = [
  { id: "narrative_auto",   hasComplexity: true  },
  { id: "initial_outline",  hasComplexity: false },
  { id: "worldview",        hasComplexity: false },
  { id: "character",        hasComplexity: false },
  { id: "item_lore",        hasComplexity: false },
  { id: "script",           hasComplexity: true  },
  { id: "quest",            hasComplexity: true  },
  { id: "scene",            hasComplexity: true  },
  { id: "vn_script",        hasComplexity: true  },
  { id: "vn_storyboard_mode", hasComplexity: true },
  { id: "emergent",         hasComplexity: false },
  { id: "narrative_card",   hasComplexity: false },
];

// 排列顺序：自动 / T4 / T3 / T2 / T1 — 由轻到重，符合用户阅读习惯
export const TIER_ITEMS: { id: TierId | "auto" }[] = [
  { id: "auto" },
  { id: "tier4" },
  { id: "tier3" },
  { id: "tier2" },
  { id: "tier1" },
];

/**
 * 层级 → 默认运行模式。事实源是后端 pipeline/modes.ts 的 TIER_DEFAULT_MODE，
 * 这里只是回传用的镜像，两边必须一致：选了层级就显式带上 mode，若这份还写
 * design_auto，后端就会照 D0-D4 全量策划跑，而不是该层级的席位叙事管线。
 */
export const TIER_DEFAULT_MODES: Record<TierId, ModeId> = {
  tier1: "narrative_auto",
  tier2: "narrative_auto",
  tier3: "narrative_auto",
  tier4: "narrative_auto",
};

// Phase 3.5: tier4 也可自由选复杂度（默认 1，但允许手动改）。auto 路由不走品类 → 隐藏。
export const TIER_HAS_COMPLEXITY: Record<string, boolean> = {
  auto: false, tier1: true, tier2: true, tier3: true, tier4: true,
};

export const COMPLEXITY_LEVELS = [
  { level: 1 },
  { level: 2 },
  { level: 3 },
  { level: 4 },
  { level: 5 },
];

export const TIER_DEFAULT_COMPLEXITY: Record<TierId, number> = {
  tier1: 4,
  tier2: 3,
  tier3: 2,
  tier4: 1,
};

// ── Tag system ──
export interface TagDimension {
  key: string;
  nameKey: string;
  options: string[];
  allowCustom?: boolean;
}

export const TAG_DIMENSIONS: TagDimension[] = [
  { key: "theme", nameKey: "tagDim.theme", options: ["成长", "救赎", "复仇", "爱情", "友情", "牺牲", "自由", "权力", "命运", "探索"] },
  { key: "genre", nameKey: "tagDim.genre", options: ["奇幻", "科幻", "武侠", "悬疑", "恐怖", "历史", "都市", "末日", "仙侠", "军事"] },
  { key: "tone", nameKey: "tagDim.tone", options: ["热血", "黑暗", "温暖", "幽默", "史诗", "治愈", "压抑", "荒诞", "浪漫", "硬核"] },
  { key: "conflict", nameKey: "tagDim.conflict", options: ["人vs人", "人vs自然", "人vs社会", "人vs自我", "人vs命运", "人vs科技", "阵营对抗", "生存危机"] },
  { key: "worldtype", nameKey: "tagDim.worldtype", options: ["中世纪", "赛博朋克", "蒸汽朋克", "后启示录", "太空歌剧", "东方仙侠", "克苏鲁", "现代都市", "异世界"] },
  { key: "custom", nameKey: "tagDim.custom", options: [], allowCustom: true },
];

/* ═══════════════════════════════════════════════════════════════════
 *  M7: UI 灰显方案 B（D12）
 *  根据当前 genreCode 的 needs 矩阵，给叙事按钮标星级。
 * ═══════════════════════════════════════════════════════════════════ */
type NeedsKey = "W" | "C" | "S" | "D" | "Q" | "E" | "I" | "U" | "L";

const ROUTE_NEEDS_MAP: Record<string, ReadonlyArray<NeedsKey> | null> = {
  narrative_auto:  null,
  initial_outline: null,
  worldview:       ["W"],
  character:       ["C"],
  item_lore:       ["I"],
  script:          ["S", "D", "L"],
  quest:           ["Q"],
  scene:           ["E"],
  vn_script:       ["S", "D"],
  vn_storyboard_mode: ["S", "D", "E"],
  emergent:        ["E", "S"],
  narrative_card:  null,
};

const NEED_KEYS: NeedsKey[] = ["W", "C", "S", "D", "Q", "E", "I", "U", "L"];

export function scoreToTag(score: number | null): { tag: string; cls: string } {
  if (score === null) return { tag: "", cls: "" };
  if (score >= 3) return { tag: "★★★", cls: "tms-route-needs-3" };
  if (score === 2) return { tag: "★★", cls: "tms-route-needs-2" };
  if (score === 1) return { tag: "★", cls: "tms-route-needs-1" };
  return { tag: "—", cls: "tms-route-needs-0" };
}

/** 构造完整的 9 维 needs tooltip。 */
export function formatNeedsTooltip(needs: Record<string, number> | null, routeId: string): string {
  const routeHint = tGlobal(`route.${routeId}.hint`);
  if (!needs) return routeHint === `route.${routeId}.hint` ? "" : routeHint;
  const keys = ROUTE_NEEDS_MAP[routeId];
  const lines: string[] = [];
  if (keys && keys.length > 0) {
    const detail = keys.map((k) => `${tGlobal(`need.${k}`)}=${needs[k] ?? 0}`).join(", ");
    lines.push(tGlobal("needs.tooltip.routeDimensions", { detail }));
  }
  const all = NEED_KEYS
    .map((k) => `${tGlobal(`need.${k}`)}${needs[k] ?? 0}`)
    .join(" | ");
  lines.push(tGlobal("needs.tooltip.full", { all }));
  if (routeHint && routeHint !== `route.${routeId}.hint`) lines.push(routeHint);
  return lines.join("\n");
}

/** 计算单个 button 的"代表 needs 分数"（needsKeys 中取最大值）。 */
export function computeRouteScore(routeId: string, needs: Record<string, number> | null): number | null {
  const keys = ROUTE_NEEDS_MAP[routeId];
  if (!keys || !needs) return null;
  let max = 0;
  for (const k of keys) {
    const v = needs[k] ?? 0;
    if (v > max) max = v;
  }
  return max;
}

/** 某条路由是否开放叙事体量档位。 */
export function routeHasComplexity(routeGroup: RouteGroup, tierChoice: TierId | "auto", narrativeRoute: ModeId): boolean {
  if (routeGroup === "planning") return TIER_HAS_COMPLEXITY[tierChoice] ?? false;
  return NARRATIVE_ROUTES.find((r) => r.id === narrativeRoute)?.hasComplexity ?? false;
}

/**
 * 历史回放还原输入模块（§6 LIST 双模块）：由已落盘 IP DNA 层级树摘要重建各 IP 前驱步的可读正文，
 * 使点选 LIST 条目时中间预览能精确展示「之前经历的所有步骤」（嵌套到最小叙事单元）。
 * ip_input 上传原件不可由层级树反推，仅以顶层单元概述占位；其余步直接由树/计数派生。
 */
export function buildIpReplayContent(summary: IpDnaHierarchySummary): Record<string, string> {
  const nodes = summary.hierarchy;
  const byParent = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const k = n.parent ?? null;
    const arr = byParent.get(k);
    if (arr) arr.push(n);
    else byParent.set(k, [n]);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => !n.parent || !ids.has(n.parent));
  const lines: string[] = [tGlobal("ipc.hier.title")];
  const walk = (group: typeof nodes, depth: number): void => {
    for (const n of [...group].sort((a, b) => a.index - b.index)) {
      lines.push(`${"  ".repeat(depth)}- ${n.title}${n.childRange ? tGlobal("ipc.hier.range", { r: n.childRange }) : ""}`);
      walk(byParent.get(n.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  const tree = lines.join("\n");
  const topTitles = [...roots].sort((a, b) => a.index - b.index).map((n) => `### ${n.title}`).join("\n\n");
  return {
    ip_input: tGlobal("ipc.hist.input", { titles: topTitles || summary.title }),
    ip_standardize: tree,
    ip_volume: tGlobal("ipc.hist.volume", { n: summary.node_count }),
    ip_adapt_plan: tGlobal("ipc.hist.adaptPlan"),
    ip_dna_extract: tGlobal("ipc.hist.extract", { title: summary.title, n: summary.node_count }),
  };
}

export const STEP_LABEL_MAP = new Map(PIPELINE_STEPS.map((s) => [s.id, s.label]));

export function formatHistoryTime(entry: HistoryEntry): string {
  if (entry.startedAt) {
    try {
      const d = new Date(entry.startedAt);
      if (!isNaN(d.getTime())) {
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      }
    } catch { /* fallback */ }
  }
  const k = entry.key.replace(/\.json$/, "");
  const m = k.match(/(\d{4})-(\d{2})-(\d{2})[T_](\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
  return k.slice(0, 16);
}

const NARRATIVE_MODE_IDS = new Set(NARRATIVE_ROUTES.map((r) => r.id));

/**
 * 已从 `NARRATIVE_ROUTES` 摘下、但历史条目仍可能存着的叙事单品 mode（C3 封存）。
 * 只用于 `inferRouteGroup` 的回溯判断，不进活跃路由清单——否则又变成能选出来。
 */
const LEGACY_NARRATIVE_MODE_IDS = new Set<ModeId>([
  "fragmented" as ModeId,
  "card_narrative" as ModeId,
  "open_world_narrative" as ModeId,
]);

export function inferRouteGroup(tier: TierId | null, mode: ModeId | null): RouteGroup {
  if (mode && (NARRATIVE_MODE_IDS.has(mode) || LEGACY_NARRATIVE_MODE_IDS.has(mode) || mode === ("auto" as ModeId))) {
    return "narrative";
  }
  if (tier) return "planning";
  return "planning";
}

/**
 * 步序兜底改问后端（Phase-2 M9）。
 *
 * 旧实现 resolveExpectedSteps 是前端第三份步序算法（TIER_MODE_STEPS / DESIGN_MODE_STEPS
 * 硬编码镜像 modes.ts），只在「极旧 entry 无 pipelineOrder 也无 completedSteps」与
 * 「fork 前拿不到 pipelineOrder」两处兜底 —— 而恰恰是这两处最需要真值：镜像漂移时
 * 会给 VN 条目铺一条 RPG 管线的灰节点。现在直接向 /plan 要。
 */
export async function fetchPlannedOrder(
  tier: TierId | null,
  mode: ModeId | null,
  genreCode?: string | null,
): Promise<string[]> {
  try {
    const res = await planPipelines({
      config: {
        tier: tier ?? null,
        mode: mode ?? null,
        genreCode: genreCode ?? null,
        routeGroup: mode && NARRATIVE_MODE_IDS.has(mode) ? "narrative" : "planning",
      },
      tier: tier ?? undefined,
      mode: mode ?? undefined,
      genreCode: genreCode ?? undefined,
    });
    const agents = res.pipeline?.agents ?? res.pipelines[0]?.agents;
    return agents?.map((a) => a.agentId) ?? [];
  } catch {
    return [];
  }
}

export function buildStepsFromCtx(ctx: NarrativeContext, expectedStepIds: string[]): StepState[] {
  return expectedStepIds.map((id) => {
    let ctxField = STEP_CTX_FIELD[id];
    if (id === "script_generation") ctxField = "jrpg_script";
    if (id === "scene_plan") ctxField = "scene_map";
    const fieldData = ctxField ? (ctx as Record<string, unknown>)[ctxField] : undefined;
    const hasData = fieldData != null;
    return {
      id,
      label: STEP_LABEL_MAP.get(id) ?? id,
      status: hasData ? "completed" as const : "pending" as const,
      data: hasData ? fieldData : undefined,
    };
  });
}
