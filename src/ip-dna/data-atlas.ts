/**
 * 字段级数据图谱（Data Atlas）—— 蓝图 §15「字段级数据流转地图」/ §4.1 的可执行编码。
 *
 * 全系统只有两套数据：
 *   A = NarrativeIpDna（输入理解产物，./types/narrative-ip-dna.ts）
 *   B = NarrativeContext 其余字段（生成管线产物，./types/index.ts）
 *
 * 本文件把"A↔B 双向映射 + 每个原子字段的上游/生成/消费"编码为**可被代码消费的结构化表**，
 * 而非散落文档。两大用途：
 *   ① 实现总索引：迁移/对齐 A→B 时按表施工，不漏字段；
 *   ② 改写影响面依据（Phase 4）：给定改动字段，沿 downstream 链推导受影响的下游产物。
 *
 * 注意：算子（operators）不在 A→B 模板映射内——算子是质量增强模块，随生成注入（§3.3 / §7），
 * 故 atlas 仅覆盖 template 四维度 ↔ NarrativeContext 生成字段。
 */

/** 数据归属：A=IP DNA 输入侧；B=生成上下文。 */
export type AtlasDomain = "A" | "B";

/** 流向：A→B 喂入；B 内部下游传播。 */
export type AtlasDirection = "A2B" | "B_internal";

export interface AtlasEntry {
  /** 稳定主键，便于跨表引用与影响面图遍历。 */
  key: string;
  domain: AtlasDomain;
  /** 字段路径（A：narrativeIpDna.<node>.template.*；B：NarrativeContext.*）。 */
  fieldPath: string;
  /** 一句话职责。 */
  role: string;
  /** 上游来源 key（空=源头，如用户输入/提取）。 */
  upstream: string[];
  /** 生成逻辑/由谁产出（步骤或阶段标识）。 */
  producedBy: string;
  /** 下游消费 key（改写影响面沿此传播）。 */
  downstream: string[];
  direction: AtlasDirection;
}

/**
 * 核心映射表。覆盖 template 四维度 → NarrativeContext 生成字段的主链路。
 * 字段不求穷尽枚举每个叶子，而求"原子可定位单元"齐全，足以驱动迁移与影响面分析。
 */
export const DATA_ATLAS: readonly AtlasEntry[] = [
  // ── A 套：IP DNA template 四维度（输入理解产物）──
  {
    key: "A.worldview.setting",
    domain: "A",
    fieldPath: "narrativeIpDna.<node>.template.worldview.setting",
    role: "世界观设定（IP DNA 三件套·世界观第①部分）",
    upstream: [],
    producedBy: "phase1.extract + phase2.aggregate",
    downstream: ["B.core_settings", "B.worldview_structure"],
    direction: "A2B",
  },
  {
    key: "A.worldview.scene_structure",
    domain: "A",
    fieldPath: "narrativeIpDna.<node>.template.worldview.scene_structure",
    role: "主要场景结构（世界观第②部分）",
    upstream: [],
    producedBy: "phase1.extract + phase2.aggregate",
    downstream: ["B.scene_map"],
    direction: "A2B",
  },
  {
    key: "A.worldview.item_inventory",
    domain: "A",
    fieldPath: "narrativeIpDna.<node>.template.worldview.item_inventory",
    role: "道具清单（世界观第③部分）",
    upstream: [],
    producedBy: "phase1.extract + phase2.aggregate",
    downstream: ["B.item_database", "B.item_lore"],
    direction: "A2B",
  },
  {
    key: "A.characters",
    domain: "A",
    fieldPath: "narrativeIpDna.<node>.template.characters",
    role: "角色（含弧光）+ 角色关系",
    upstream: [],
    producedBy: "phase1.extract + phase2.aggregate",
    downstream: ["B.detailed_character_sheets", "B.core_settings"],
    direction: "A2B",
  },
  {
    key: "A.story_structure",
    domain: "A",
    fieldPath: "narrativeIpDna.<node>.template.story_structure",
    role: "故事结构（剧情树拓扑 + 最小单元 plot_tree）",
    upstream: ["A.summary"],
    producedBy: "phase1.extract + phase2.aggregate",
    downstream: ["B.story_framework", "B.outlines_generated", "B.plots_generated"],
    direction: "A2B",
  },
  {
    key: "A.core_elements",
    domain: "A",
    fieldPath: "narrativeIpDna.<node>.template.core_elements",
    role: "核心要素（题材/主题/核心冲突/文学风格/情感体验）",
    upstream: [],
    producedBy: "phase1.extract + phase2.aggregate",
    downstream: ["B.initial_story_outline", "B.plot_synopsis", "B.user_preference_analysis"],
    direction: "A2B",
  },
  {
    key: "A.summary",
    domain: "A",
    fieldPath: "narrativeIpDna.<node>.template.summary",
    role: "聚合 summary（characters/scene/events），由下至上递归聚合的输入来源",
    upstream: [],
    producedBy: "phase1.extract(底层) → phase2.aggregate(上层)",
    downstream: ["A.story_structure", "A.core_elements"],
    direction: "A2B",
  },

  // ── B 套：NarrativeContext 生成字段（生成管线产物）──
  {
    key: "B.core_settings",
    domain: "B",
    fieldPath: "NarrativeContext.core_settings",
    role: "核心设定（世界名/主角/NPC/主题/冲突/视角/类型）",
    upstream: ["A.worldview.setting", "A.characters"],
    producedBy: "step:initial_plan / core_settings",
    downstream: ["B.worldview_structure", "B.story_framework"],
    direction: "B_internal",
  },
  {
    key: "B.worldview_structure",
    domain: "B",
    fieldPath: "NarrativeContext.worldview_structure",
    role: "世界观结构（基础架构层/交互叙事层/核心规则/UI风格）",
    upstream: ["A.worldview.setting", "B.core_settings"],
    producedBy: "step:worldview",
    downstream: ["B.scene_map", "B.story_framework"],
    direction: "B_internal",
  },
  {
    key: "B.scene_map",
    domain: "B",
    fieldPath: "NarrativeContext.scene_map",
    role: "场景地图（三层场景树）",
    upstream: ["A.worldview.scene_structure", "B.worldview_structure"],
    producedBy: "step:scene_plan",
    downstream: ["B.plots_generated"],
    direction: "B_internal",
  },
  {
    key: "B.item_database",
    domain: "B",
    fieldPath: "NarrativeContext.item_database",
    role: "道具数据库",
    upstream: ["A.worldview.item_inventory"],
    producedBy: "step:item_database",
    downstream: ["B.plots_generated", "B.quest_graph"],
    direction: "B_internal",
  },
  {
    key: "B.detailed_character_sheets",
    domain: "B",
    fieldPath: "NarrativeContext.detailed_character_sheets",
    role: "角色卡（立绘提示/原型/驱动/弧光/关系）",
    upstream: ["A.characters"],
    producedBy: "step:character_enrichment",
    downstream: ["B.plots_generated", "B.jrpg_script"],
    direction: "B_internal",
  },
  {
    key: "B.story_framework",
    domain: "B",
    fieldPath: "NarrativeContext.story_framework",
    role: "故事框架层（L0 框架节点；系列模式中=部）",
    upstream: ["A.story_structure", "B.core_settings"],
    producedBy: "step:story_framework",
    downstream: ["B.outlines_generated"],
    direction: "B_internal",
  },
  {
    key: "B.outlines_generated",
    domain: "B",
    fieldPath: "NarrativeContext.outlines_generated",
    role: "大纲层（L1）",
    upstream: ["A.story_structure", "B.story_framework"],
    producedBy: "step:outline_batch",
    downstream: ["B.detailed_outlines_generated"],
    direction: "B_internal",
  },
  {
    key: "B.detailed_outlines_generated",
    domain: "B",
    fieldPath: "NarrativeContext.detailed_outlines_generated",
    role: "细纲层（L2 = 游戏叙事节点）",
    upstream: ["B.outlines_generated"],
    producedBy: "step:detailed_outline",
    downstream: ["B.plots_generated"],
    direction: "B_internal",
  },
  {
    key: "B.plots_generated",
    domain: "B",
    fieldPath: "NarrativeContext.plots_generated",
    role: "情节层（L3，剧情树叶子正文锚点）",
    upstream: ["B.detailed_outlines_generated", "B.scene_map", "B.detailed_character_sheets"],
    producedBy: "step:plot_generation",
    downstream: ["B.jrpg_script", "B.quest_graph"],
    direction: "B_internal",
  },
  {
    key: "B.jrpg_script",
    domain: "B",
    fieldPath: "NarrativeContext.jrpg_script",
    role: "剧本层（L4）",
    upstream: ["B.plots_generated"],
    producedBy: "step:script_generation",
    downstream: [],
    direction: "B_internal",
  },
  {
    key: "B.quest_graph",
    domain: "B",
    fieldPath: "NarrativeContext.quest_graph",
    role: "任务系统（L5）",
    upstream: ["B.plots_generated", "B.item_database"],
    producedBy: "step:quest_generation",
    downstream: [],
    direction: "B_internal",
  },
] as const;

/** key → 条目索引。 */
export const ATLAS_INDEX: ReadonlyMap<string, AtlasEntry> = new Map(
  DATA_ATLAS.map((e) => [e.key, e]),
);

/**
 * 改写影响面分析（Phase 4 依据）：给定改动的字段 key，沿 downstream 链 BFS 推导
 * 所有受影响的下游产物 key（含间接）。用于"定点改写→受影响节点重生成"的最小化重算。
 */
export function computeImpactSet(changedKeys: string[]): string[] {
  const visited = new Set<string>();
  const queue = [...changedKeys];
  while (queue.length > 0) {
    const key = queue.shift()!;
    const entry = ATLAS_INDEX.get(key);
    if (!entry) continue;
    for (const down of entry.downstream) {
      if (!visited.has(down)) {
        visited.add(down);
        queue.push(down);
      }
    }
  }
  return [...visited];
}

/** 反向查询：某字段的全部上游来源（含间接），用于溯源。 */
export function computeUpstreamSet(targetKey: string): string[] {
  const visited = new Set<string>();
  const queue = [targetKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    const entry = ATLAS_INDEX.get(key);
    if (!entry) continue;
    for (const up of entry.upstream) {
      if (!visited.has(up)) {
        visited.add(up);
        queue.push(up);
      }
    }
  }
  return [...visited];
}
