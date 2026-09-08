/**
 * Shared types between narrative-studio backend and viz frontend.
 * Keep in sync with ../src/types/index.ts — only the subset needed by UI.
 */

export type TierId = "tier1" | "tier2" | "tier3" | "tier4";

export type ModeId =
  | "character"
  | "item_lore"
  | "scene"
  | "worldview"
  | "initial_outline"
  | "story_framework"
  | "story_outline"
  | "detailed_outline"
  | "novel"
  | "script"
  | "quest"
  | "full"
  | "narrative_card"
  | "tier2_enhanced"
  | "tier3_basic"
  | "fragmented"
  | "emergent"
  | "card_narrative"
  | "open_world_narrative"
  | "narrative_auto"
  | "design_auto"
  | "design_full_narrative"
  | "design_fragmented"
  | "design_emergent"
  | "design_only"
  | "vn_full"
  | "design_vn_full"
  | "vn_script"
  | "vn_storyboard_mode";

/**
 * `skipped` = 后端因缺上游没跑这一步。它不是失败（整条链继续往后走），
 * 也绝不能显示成完成——那正是此前静默空跑骗过用户的地方。
 */
export type StepStatus = "pending" | "running" | "completed" | "skipped" | "failed";

/**
 * announce 帧里的一段「同属一个专家的连续步骤」（后端 types/index.ts 同名结构）。
 * 画布靠它把席位管线的步骤收进一个专家容器，而不是摊成一排同级节点。
 */
export interface AnnounceSeatGroup {
  id: string;
  name: string;
  steps: string[];
}

export interface AnnounceStepGroup {
  id: string;
  /** 专家显示名（如「互动叙事专家」），即容器标题。 */
  label: string;
  steps: string[];
  /** 跑的是哪条席位管线（新架构四条之一）。 */
  pipelineId?: string;
  /** 管线内部名（如「叙事管线（分镜）」），作副标题用。 */
  pipelineName?: string;
  /** 组内 step 的席位归属，卡上据此标「这一步属于哪一席」。 */
  seats?: AnnounceSeatGroup[];
}

export interface PipelineProgress {
  stage: string;
  stepId?: string;
  step: number;
  totalSteps: number;
  status: StepStatus;
  message?: string;
  data?: unknown;
  nodeId?: string;
  nodeDone?: number;
  nodeTotal?: number;
  type?: "streaming" | "pipeline_steps_announce";
  chunk?: string;
  accumulated?: string;
  /** 本帧只是运行横幅（如管线配置），不对应 agent：画布不为它建节点。 */
  meta?: boolean;
  /** status === "skipped" 时的原因：缺哪些字段、该先跑哪几席、给用户看的一句话。 */
  skipInfo?: {
    missing: string[];
    blockedBy: string[];
    hint: string;
  };
  // D4: pipeline_steps_announce payload
  steps?: string[];
  /**
   * 步骤显示名（step id → 名称），来自后端 STEP_REGISTRY。
   * 待跑节点的标题优先用它，前端那份中文步名表只作离线兜底。
   */
  stepNames?: Record<string, string>;
  /** 步序里哪些 id 只是运行横幅；名单由后端给，前端不硬编码 id。 */
  metaSteps?: string[];
  /** 步骤的专家归属；缺省（旧后端 / 非席位路径）时画布退回一排同级节点。 */
  stepGroups?: AnnounceStepGroup[];
  pipelineTemplate?: string;
  complexity?: number;
  routingMode?: "auto" | "semi" | "manual";
}

export interface RunStartResponse {
  id: string;
  status: "running";
  message: string;
  tier?: TierId;
  mode?: ModeId;
  /** 条目锚点与产物地址分开给：单管线两者相等，但不应依赖这个巧合。 */
  entryKey?: string;
  sourceDir?: string;
  /** G1：运行期实际生效的 pipelineId（沿用了 /plan 传入的，或缺省时后端现铸的）。 */
  pipelineId?: string;
}

export interface RunStatusResponse {
  id: string;
  status: "running" | "completed" | "failed";
  progress: PipelineProgress[];
  error?: string;
  startedAt: string;
  tier?: TierId;
  mode?: ModeId;
}

export interface StepModification {
  original: unknown;
  edited?: unknown;
  userInstructions?: string;
  modifiedAt: string;
}

export interface StepMeta {
  needsRegen: boolean;
  modifications: StepModification[];
  version: number;
}

export interface RunResultResponse {
  id: string;
  status: "completed" | "failed" | "running" | "interrupted";
  result?: NarrativeContext;
  error?: string;
  message?: string;
  /** G1：条目锚点，历史上曾被误标进 `sourceDir` 字段——两个字段现已分开返回。 */
  entryKey?: string;
  sourceDir?: string;
  tier?: TierId;
  mode?: ModeId;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  completedSteps?: string[] | null;
  stepMeta?: Record<string, StepMeta> | null;
  // Phase 1: 后端持久化的"启动管线快照"。
  // genre_code: 当时跑的真实品类（manual fallback 不算）；
  // pipelineOrder: 当时跑的"权威步骤序"（含动态追加的 narrative steps）；
  // routingMode: auto | semi | manual。
  genre_code?: string;
  pipelineOrder?: string[];
  routingMode?: "auto" | "semi" | "manual";
  /** 该条目的专家/席位嵌套结构，后端按品类 + 层级现算，与运行时那帧 announce 同源。 */
  stepGroups?: AnnounceStepGroup[];
}

export interface ModeInfo {
  id: ModeId;
  label: string;
  stepsCount: number;
}

export interface TierModeInfo {
  tier: TierId;
  defaultMode: ModeId;
  modes: ModeInfo[];
}

// Subset of NarrativeContext used by the viz
/**
 * 与 src/types/index.ts 的 InitialOutline 保持同步。
 * INITIAL_PLAN 合并步骤的子段，结构化对象（不再是 string）。
 */
export interface InitialOutline {
  theme: string;
  background: string;
  character_arc: string;
  main_conflict: string;
  story_structure: {
    opening: string;
    development: string[];
    ending: string;
  };
  key_plot_points: string[];
}

export interface NarrativeContext {
  user_input: string;
  user_preference_summary?: string;
  user_preference_analysis?: Record<string, unknown>;
  initial_story_outline?: InitialOutline;
  core_settings?: CoreSettings;
  worldview_structure?: WorldviewStructure;
  plot_synopsis?: PlotSynopsis;
  story_framework?: StoryFramework;
  outlines_generated?: OutlinesGenerated;
  detailed_outlines_generated?: DetailedOutlinesGenerated;
  detailed_character_sheets?: CharacterSheet[];
  plots_generated?: PlotsGenerated;
  jrpg_script?: JrpgScript;
  scene_map?: SceneMap;
  tier_detection?: TierDetectionResult;
  narrative_card?: NarrativeCard;
  lore_fragments?: LoreFragment[];
  item_lore?: ItemLore[];
  item_database?: Record<string, unknown>[];
  quest_graph?: { quests: Record<string, unknown>[]; main_quest_chain: string[]; branch_quests: Record<string, string[]> };
  // 策划管线数据 (D0-D4)
  demand_analysis?: Record<string, unknown>;
  core_concept?: Record<string, unknown>;
  system_architecture?: Record<string, unknown>;
  system_details?: Record<string, unknown>;
  value_framework?: Record<string, unknown>;
  game_design_context?: Record<string, unknown>;
  narrative_requirements?: Record<string, unknown>;
  // 质检席的报告：这两席的产物就是报告本身
  structure_check_report?: QaReport;
  content_check_report?: QaReport;
  [key: string]: unknown;
}

/** 修复路径。缺席表示这条问题只报不修（后端 `pipeline/qa/findings.ts` 的同名口径）。 */
export type RepairKind = "topology" | "content";

/** 一条问题的生命周期（缺省即 `"open"`，兼容旧报告；见后端 `pipeline/qa/findings.ts`）。 */
export type QaFindingStatus = "open" | "fixed" | "dismissed";

/** 两个检查席共用的「一条问题」。 */
export interface QaFinding {
  id: string;
  criterion: string;
  nodeId: string;
  severity: "error" | "warn";
  issue: string;
  excerpt: string;
  suggestion: string;
  repairKind?: RepairKind;
  targetField?: string;
  status?: QaFindingStatus;
  fixedInVersion?: number;
  lastError?: string;
}

export interface QaReport {
  verdict: "pass" | "warn" | "fail";
  summary: string;
  findings: QaFinding[];
  checkedAt: string;
  /** 结构检查独有：分层明细，给人读的那一份。 */
  layers?: Array<{ layer: string; label: string; nodeCount: number }>;
  /** 内容检查独有：八项判据各自查了没查。 */
  coverage?: Array<{ criterion: string; checked: boolean; reason?: string }>;
}

/** `POST /api/narrative/qa/apply` 对每条勾选项的处置结果。 */
export interface QaRepairOutcome {
  findingId: string;
  status: "applied" | "skipped" | "failed";
  detail: string;
}

export interface CoreSettings {
  world_name: string;
  world_setting: string;
  world_summary: string;
  world_tags: { tone: string[]; theme: string[]; hook: string[] };
  protagonist: { name: string; identity: string; personality: string; core_conflict: string };
  key_npcs: Array<{ name: string; identity: string; personality: string; relationship_to_protagonist: string }>;
  main_theme: string;
  main_conflict: string;
  narrative_perspective: string;
  genre: string;
}

export interface WorldviewStructure {
  world_name: string;
  worldview_title?: string;
  [key: string]: unknown;
}

export interface PlotSynopsis {
  synopsis_strategy: string;
  synopsis: string;
  highlight_analysis: string;
}

export interface StoryNode {
  node_id: string;
  content_id?: string;
  name: string;
  narrative_function?: string;
  main_content?: string;
  content?: string;
  stage_type?: string;
  narrative_stage?: string;
  is_branch?: boolean;
  /**
   * 扇出是否算"分叉"。
   *
   * 默认按 next_node 数量推断，但推断只对剧情图成立：场景树的一个节点连着四个子场景
   * 是包含关系，不是玩家在这里有四条路可走，卡面不该打分叉标。这类拓扑显式写 false。
   */
  is_fork?: boolean;
  is_branch_point?: boolean;
  is_merge_point?: boolean;
  /**
   * 是否在最优路径上（席位 2.3.8「标记最符合用户需求的那一条链路」）。
   *
   * 后端从大纲层一直标到情节层，但此前前端一个字段都没读——于是那条链路只存在于
   * JSON 里，画布上二十个节点长得一模一样，"哪条是主线"要用户自己数 next_node。
   * 线性形态（无分支）时后端不逐点标注，缺省视为都在主线上。
   */
  on_optimal_path?: boolean;
  branch_letter?: string;
  prev_node?: string[];
  next_node?: string[];
  parent_id?: string;
  sequence_index?: number;
  story_elements?: {
    plot?: { cause?: string; process?: string; result?: string };
    dialogue_hint?: string;
    monologue_hint?: string;
    narration_hint?: string;
    atmosphere?: string;
  };
  boundary_constraints?: { cause?: string; result?: string };
  /**
   * 仅供 Detroit layout 算法解析 xKey 用的 "Detroit 风格 ID"（如 "1"、"2a"、"3"）。
   * 当 node_id 是语义化命名（如 "N_00_ROOT"、"A1_N12"）时必须填这个字段，
   * 否则列分配会失败。RPG story_framework / plot_generation 等本身就用 Detroit
   * 风格 id 的步骤可以不填（layout 会 fallback 到 node_id）。
   *
   * 显示层 / 引用关系（prev_node / next_node）仍用 node_id —— 这只是布局内部的别名。
   */
  _layoutId?: string;
  _rawData?: Record<string, unknown>;
}

export interface StoryFramework {
  framework: { nodes: StoryNode[] };
  dynamic_structure?: {
    structure_type: string;
    framework_nodes: StoryNode[];
    branch_groups?: Array<{ branch_at: string; branches: string[]; merge_at: string }>;
  };
}

export interface OutlinesGenerated {
  outlines: StoryNode[];
}

export interface DetailedOutlinesGenerated {
  detailed_outlines: StoryNode[];
}

export interface CharacterSheet {
  name: string;
  label: string;
  role_in_story?: string;
  [key: string]: unknown;
}

export interface PlotsGenerated {
  plots: StoryNode[];
  plot_id_map: Record<string, string>;
}

export interface ScriptChapter {
  chapter_id: string;
  node_id: string;
  plot_node_id: string;
  chapter_type: string;
  title: string;
  conflict: { type: string; tension_level: number; stakes: string; turning_point: string };
  character_arcs: Array<{ character: string; arc_phase: string; emotional_shift: string; growth: string }>;
  scenes: ScriptScene[];
  prev_node?: string[];
  next_node?: string[];
  is_branch?: boolean;
  narrative_stage?: string;
}

export interface ScriptContentItem {
  type: string;
  speaker?: string;
  text: string;
  emotion?: string;
  action?: string;
  subtext?: string;
}

export interface ScriptScene {
  scene_id: string;
  location: string;
  atmosphere: string;
  camera_direction?: string;
  bgm?: string;
  content: ScriptContentItem[];
}

export interface JrpgScript {
  title: string;
  chapters: ScriptChapter[];
}

export interface SceneDescription {
  location_description: string;
  art_style_description: string;
  semantics_description: string;
}

export type SceneLabel = "narrative" | "decoration" | "path" | "entrance";

export interface SceneNode {
  uid: string;
  name: string;
  parent: string;
  parent_uid?: string | null;
  parent_name?: string | null;
  parent_level?: number | null;
  scene_level?: number;
  label: SceneLabel[] | string;
  description: SceneDescription | string;
  level?: number;
  story_units?: string[];
}

export interface SkeletonLayerScene {
  name: string;
  parent: string;
  level?: number;
  label?: unknown;
  description?: unknown;
}

export interface SceneMap {
  world_name: string;
  scenes: SceneNode[];
  _phase1_skeleton?: SceneNode[];
  _phase1_by_layer?: {
    l0: SkeletonLayerScene[];
    l1: SkeletonLayerScene[];
    l2: SkeletonLayerScene[];
  };
  _phase2_per_node?: Record<string, SceneNode[]>;
  _phase2_per_node_md?: Record<string, string>;
  _scene_structure_md?: string;
}

export interface TierDetectionResult {
  tier: TierId;
  genre_code: string;
  genre_name: string;
  reasoning: string;
}

export interface NarrativeCard {
  game_name: string;
  one_liner: string;
  story: string;
  gameplay_mapping: Record<string, string>;
  level_expansion: {
    scene_line: string;
    difficulty_line: string;
    final_chapter: string;
  };
}

export interface LoreFragment {
  id: string;
  type: string;
  title: string;
  content: string;
  source_location?: string;
  related_characters?: string[];
}

export interface ItemLore {
  item_name: string;
  item_type: string;
  rarity: string;
  lore_text: string;
  flavor_text: string;
}

/** Pipeline step definition for the UI */
export interface PipelineStepDef {
  id: string;
  label: string;
  type: "pipeline" | "story" | "special";
}

export const STEP_CTX_FIELD: Record<string, string> = {
  // IP 输入处理前驱（ctx 无对应字段，由阶段门进度独立驱动，仅占位以纳入预览顺序）
  ip_input: "ip_input",
  ip_standardize: "ip_standardize",
  ip_volume: "ip_volume",
  ip_decompose: "ip_decompose",
  // 改编规划（范围裁剪 + 游戏单元，§5.1 合并步骤）
  ip_adapt_plan: "ip_adapt_plan",
  // 向后兼容：旧存档的分离节点 id，仍可映射（前端预览顺序已合并为 ip_adapt_plan）
  ip_scope: "ip_scope",
  ip_game_unit: "ip_game_unit",
  ip_dna_extract: "ip_dna_extract",
  preference_summary: "user_preference_summary",
  preference_analysis: "user_preference_analysis",
  initial_plan: "initial_plan",
  worldview: "worldview_structure",
  story_framework: "story_framework",
  outline_batch: "outlines_generated",
  detailed_outline: "detailed_outlines_generated",
  character_enrichment: "detailed_character_sheets",
  item_database: "item_database",
  plot_generation: "plots_generated",
  script_generation: "jrpg_script",
  quest_generation: "quest_graph",
  scene_plan: "scene_map",
  script_scene_generation: "jrpg_script",
  narrative_card: "narrative_card",
  lore_generation: "lore_fragments",
  // 质检席：报告本身就是产物。少了这两条映射，两席跑完前端读不到东西，
  // "已生成"卡片打开是空白——步骤照跑照烧钱，只是看不见。
  structure_check: "structure_check_report",
  content_check: "content_check_report",
  scene_evidence: "scene_evidence",
  encyclopedia_retrieval: "encyclopedia_doc",
  // B3 新模板专属步骤
  branch_tree: "branch_tree",
  dialogue_script: "dialogue_script",
  cinematic_storyboard: "cinematic_storyboard",
  region_design: "regions",
  emergent_event: "emergent_events",
  card_lore: "card_lore",
  event_pool: "event_pool",
  // 互动影游 v2 专属步骤（tpl-vn-v2）
  vn_logline: "vn_logline",
  vn_outline_acts: "vn_outline_acts",
  vn_scenes: "vn_scenes",
  vn_beats: "vn_beats",
  vn_script_normalize: "vn_script_normalized",
  vn_segment_confirm: "vn_segment_confirmed",
  vn_branched_beats: "vn_branched_beats",
  vn_screenplay: "vn_screenplay",
  vn_storyboard: "vn_storyboard",
  // 策划步骤 (D0-D4)
  core_concept: "core_concept",
  system_architecture: "system_architecture",
  system_detail: "system_details",
  value_framework: "value_framework",
  design_doc: "game_design_context",
  // ── 向后兼容（旧存档可能包含这些 id；前端忽略时不渲染）──
  initial_outline: "initial_story_outline",
  core_settings: "core_settings",
  plot_synopsis: "plot_synopsis",
  structure_validation_l1: "l1_validation",
  structure_validation_l2: "l2_validation",
  structure_validation_l3: "l3_validation",
};

export const PIPELINE_STEPS: PipelineStepDef[] = [
  // ── IP 输入处理前驱（§5 半自动；生成管线前置，节点化展示输入+IP处理）──
  // C 序号在中间管线运行时按实际路径动态赋号（见 PipelineStatusBar withDynamicIpPrefix），
  // 故此处只存基础标签，不写死 Cn（拆解/游戏单元规划等可选分支会改变序号）。
  { id: "ip_input", label: "IP 作品输入", type: "pipeline" },
  { id: "ip_standardize", label: "标准化", type: "pipeline" },
  { id: "ip_volume", label: "体量判断", type: "pipeline" },
  { id: "ip_decompose", label: "拆解 · 再标准化", type: "pipeline" },
  { id: "ip_adapt_plan", label: "改编规划", type: "pipeline" },
  { id: "ip_dna_extract", label: "生成 scoped IP DNA", type: "pipeline" },
  { id: "tier_router", label: "品类识别", type: "pipeline" },
  { id: "pipeline_config", label: "管线配置", type: "pipeline" },
  // 策划步骤 (D0-D4)
  { id: "core_concept", label: "D0 核心概念", type: "pipeline" },
  { id: "system_architecture", label: "D1 系统架构", type: "pipeline" },
  { id: "system_detail", label: "D2 玩法设计", type: "pipeline" },
  { id: "value_framework", label: "D3 数值框架", type: "pipeline" },
  { id: "design_doc", label: "D4 策划案整合", type: "pipeline" },
  // 叙事步骤
  { id: "preference_summary", label: "需求提炼", type: "pipeline" },
  { id: "preference_analysis", label: "需求分析", type: "pipeline" },
  { id: "initial_plan", label: "初步方案", type: "pipeline" },
  { id: "worldview", label: "世界观构建", type: "pipeline" },
  { id: "character_enrichment", label: "角色档案", type: "pipeline" },
  { id: "item_database", label: "道具清单", type: "pipeline" },
  // L0-L5 那套层级记号只留在提示词与结构校验内部（那里它确实指"第几层展开"），
  // 画布与列表上按环节说话：席位名在外，实现名在里。
  { id: "story_framework", label: "故事框架", type: "story" },
  { id: "outline_batch", label: "大纲展开", type: "story" },
  { id: "detailed_outline", label: "细纲展开", type: "story" },
  { id: "plot_generation", label: "情节生成", type: "story" },
  { id: "script_generation", label: "剧本生成", type: "story" },
  { id: "quest_generation", label: "任务生成", type: "story" },
  { id: "scene_plan", label: "场景生成", type: "story" },
  { id: "script_scene_generation", label: "剧本+场景", type: "story" },
  // B3 新模板专属步骤
  { id: "branch_tree", label: "分支树（VN）", type: "story" },
  { id: "dialogue_script", label: "对话脚本（VN）", type: "story" },
  { id: "cinematic_storyboard", label: "影像分镜（互动影游）", type: "story" },
  // 互动影游 v2 专属管线（tpl-vn-v2）9 步独立 step
  { id: "vn_logline",         label: "E1-01 一句话故事梗概",     type: "story" },
  { id: "vn_outline_acts",    label: "E1-02 三幕扩写",            type: "story" },
  { id: "vn_scenes",          label: "E1-03 场搭建",             type: "story" },
  { id: "vn_beats",           label: "E1-04 情节点搭建",         type: "story" },
  { id: "vn_script_normalize", label: "E2-01 用户剧本预处理",    type: "story" },
  { id: "vn_segment_confirm", label: "E2-02 影游化文本段确认",   type: "story" },
  { id: "vn_branched_beats",  label: "G-01 剧情树改造",          type: "story" },
  { id: "vn_screenplay",      label: "G-02 剧本创作",            type: "story" },
  { id: "vn_storyboard",      label: "G-03 分镜设计",            type: "story" },
  { id: "region_design", label: "区域设计（开放世界）", type: "story" },
  { id: "emergent_event", label: "涌现事件（开放世界/沙盒）", type: "story" },
  { id: "card_lore", label: "卡牌 Lore", type: "story" },
  { id: "event_pool", label: "事件池", type: "story" },
  // 终点/特殊
  { id: "narrative_card", label: "叙事卡", type: "special" },
  { id: "lore_generation", label: "Lore 碎片", type: "special" },
  { id: "structure_check", label: "结构检查", type: "special" },
  { id: "content_check", label: "内容检查", type: "special" },
  { id: "scene_evidence", label: "场景取证", type: "special" },
  { id: "encyclopedia_retrieval", label: "资料汇编", type: "special" },
  // ── 向后兼容（旧存档显示用，不出现在任何模板的步骤列表）──
  { id: "initial_outline", label: "初步大纲（已合并）", type: "pipeline" },
  { id: "core_settings", label: "核心设定（已合并）", type: "pipeline" },
  { id: "plot_synopsis", label: "剧情简介（已合并）", type: "pipeline" },
  { id: "structure_validation_l1", label: "L1 结构验证（已废弃）", type: "pipeline" },
  { id: "structure_validation_l2", label: "L2 结构验证（已废弃）", type: "pipeline" },
  { id: "structure_validation_l3", label: "L3 结构验证（已废弃）", type: "pipeline" },
];
