/**
 * 由 scripts/gen-seats.ts 从 src/pipeline/routing/assistant-seats.ts 生成——请勿手改。
 * 改席位请改后端注册表，然后跑 `npm run gen:seats`。
 */

export type SeatKind = "generator" | "validator" | "polisher" | "retriever" | "coordinator";

/**
 * 跑一条管线会不会带上这一席。
 * - default    跑那条管线就会跑到
 * - optional   在步序里但默认跳过（可选终点席）
 * - attachable 不在步序里，可在编排面勾选挂载（打磨席）
 * - manual     不属于任何管线，只能手动拖入或单跑
 */
export type SeatPipelineRole = "default" | "optional" | "attachable" | "manual";

export interface SeatBindingView {
  /** 管线模板 id 或运行模式 id；null = 通用兜底。 */
  scope: string | null;
  agentIds: string[];
}

export interface SeatView {
  id: string;
  featureId: string;
  name: string;
  kind: SeatKind;
  /** planned = 契约已立、后端实现待建：可拖可 @，不可单跑。 */
  status: "active" | "planned";
  /** 产物落到哪个内容类别（对应 lib/contentTypes.ts）。 */
  contentType: string | null;
  /** 跑一条管线会不会带上这一席。 */
  pipelineRole: SeatPipelineRole;
  /** 该席位产物的文件名前缀，两库据此归类。 */
  filePrefixes: string[];
  bindings: SeatBindingView[];
}

export const ASSISTANT_SEATS: readonly SeatView[] = [
  {
    id: "entry_config",
    featureId: "2.5.0",
    name: "叙事生成配置助手",
    kind: "coordinator",
    status: "planned",
    contentType: null,
    pipelineRole: "manual",
    filePrefixes: [],
    bindings: [],
  },
  {
    id: "encyclopedia",
    featureId: "2.5.1",
    name: "百科娘",
    kind: "retriever",
    status: "active",
    contentType: "encyclopedia",
    pipelineRole: "manual",
    filePrefixes: ["18_"],
    bindings: [
      { scope: null, agentIds: ["encyclopedia_retrieval"] },
    ],
  },
  {
    id: "req_list",
    featureId: "2.5.2",
    name: "需求清单助手",
    kind: "generator",
    status: "active",
    contentType: "requirement",
    pipelineRole: "default",
    filePrefixes: ["00_","01_","01a_"],
    bindings: [
      { scope: null, agentIds: ["preference_summary","preference_analysis"] },
    ],
  },
  {
    id: "design_doc",
    featureId: "2.5.3",
    name: "策划文档助手",
    kind: "generator",
    status: "active",
    contentType: "design-doc",
    pipelineRole: "default",
    filePrefixes: ["02_","D0_","D1_","D2_","D3_","D4_","D4a_"],
    bindings: [
      { scope: null, agentIds: ["initial_plan"] },
      { scope: "design_auto", agentIds: ["core_concept","system_architecture","system_detail","value_framework","design_doc"] },
    ],
  },
  {
    id: "worldview",
    featureId: "2.5.4",
    name: "世界观设定助手",
    kind: "generator",
    status: "active",
    contentType: "worldview",
    pipelineRole: "default",
    filePrefixes: ["04_"],
    bindings: [
      { scope: null, agentIds: ["worldview"] },
    ],
  },
  {
    id: "character",
    featureId: "2.5.5",
    name: "角色档案助手",
    kind: "generator",
    status: "active",
    contentType: "character",
    pipelineRole: "default",
    filePrefixes: ["09_"],
    bindings: [
      { scope: null, agentIds: ["character_enrichment"] },
    ],
  },
  {
    id: "item",
    featureId: "2.5.6",
    name: "道具清单助手",
    kind: "generator",
    status: "active",
    contentType: "item",
    pipelineRole: "default",
    filePrefixes: ["10_","15a_"],
    bindings: [
      { scope: null, agentIds: ["item_database"] },
    ],
  },
  {
    id: "scene_list",
    featureId: "2.5.7",
    name: "场景列表助手",
    kind: "generator",
    status: "active",
    contentType: "scene",
    pipelineRole: "default",
    filePrefixes: ["14_"],
    bindings: [
      { scope: null, agentIds: ["scene_plan"] },
    ],
  },
  {
    id: "outline",
    featureId: "2.5.8",
    name: "故事大纲助手",
    kind: "generator",
    status: "active",
    contentType: "outline",
    pipelineRole: "default",
    filePrefixes: ["06_"],
    bindings: [
      { scope: null, agentIds: ["story_framework"] },
    ],
  },
  {
    id: "structure",
    featureId: "2.5.9",
    name: "故事结构助手",
    kind: "generator",
    status: "active",
    contentType: "structure",
    pipelineRole: "default",
    filePrefixes: ["07_","08_"],
    bindings: [
      { scope: null, agentIds: ["outline_batch","detailed_outline"] },
    ],
  },
  {
    id: "plot",
    featureId: "2.5.10",
    name: "故事情节助手",
    kind: "generator",
    status: "active",
    contentType: "plot",
    pipelineRole: "default",
    filePrefixes: ["11_"],
    bindings: [
      { scope: null, agentIds: ["plot_generation"] },
    ],
  },
  {
    id: "quest",
    featureId: "2.5.11",
    name: "任务助手",
    kind: "generator",
    status: "active",
    contentType: "quest",
    pipelineRole: "default",
    filePrefixes: ["13_"],
    bindings: [
      { scope: null, agentIds: ["quest_generation"] },
    ],
  },
  {
    id: "storyboard",
    featureId: "2.5.12",
    name: "分镜助手",
    kind: "generator",
    status: "active",
    contentType: "storyboard",
    pipelineRole: "default",
    filePrefixes: ["12_"],
    bindings: [
      { scope: null, agentIds: ["script_generation"] },
    ],
  },
  {
    id: "narrative_card",
    featureId: "2.5.13",
    name: "叙事卡助手",
    kind: "generator",
    status: "active",
    contentType: "narrative-card",
    pipelineRole: "default",
    filePrefixes: ["17_"],
    bindings: [
      { scope: null, agentIds: ["narrative_card"] },
    ],
  },
  {
    id: "codex",
    featureId: "2.5.14",
    name: "设定集助手",
    kind: "generator",
    status: "active",
    contentType: "codex",
    pipelineRole: "default",
    filePrefixes: ["15_"],
    bindings: [
      { scope: null, agentIds: ["lore_generation"] },
    ],
  },
  {
    id: "structure_check",
    featureId: "2.5.15",
    name: "结构检查助手",
    kind: "validator",
    status: "active",
    contentType: "structure-check",
    pipelineRole: "default",
    filePrefixes: ["07a_","08a_","11a_","19_"],
    bindings: [
      { scope: null, agentIds: ["structure_check"] },
    ],
  },
  {
    id: "content_check",
    featureId: "2.5.16",
    name: "内容检查助手",
    kind: "validator",
    status: "active",
    contentType: "content-check",
    pipelineRole: "default",
    filePrefixes: ["20_","20a_"],
    bindings: [
      { scope: null, agentIds: ["content_check","scene_evidence"] },
    ],
  },
  {
    id: "deai",
    featureId: "2.5.17",
    name: "去 AI 味助手",
    kind: "polisher",
    status: "active",
    contentType: "deai",
    pipelineRole: "attachable",
    filePrefixes: ["11_"],
    bindings: [
      { scope: null, agentIds: ["deai_polish"] },
    ],
  },
  {
    id: "structure_optimize",
    featureId: "2.5.18",
    name: "结构优化助手",
    kind: "generator",
    status: "planned",
    contentType: "structure-optimize",
    pipelineRole: "manual",
    filePrefixes: [],
    bindings: [],
  },
  {
    id: "plot_refine",
    featureId: "2.5.19",
    name: "情节优化助手",
    kind: "polisher",
    status: "active",
    contentType: "plot-refine",
    pipelineRole: "attachable",
    filePrefixes: ["11_"],
    bindings: [
      { scope: null, agentIds: ["plot_refine"] },
    ],
  },
  {
    id: "playability",
    featureId: "2.5.20",
    name: "玩法适配助手",
    kind: "polisher",
    status: "active",
    contentType: "playability",
    pipelineRole: "attachable",
    filePrefixes: ["08_"],
    bindings: [
      { scope: null, agentIds: ["playability_adapt"] },
    ],
  },
  {
    id: "narration",
    featureId: "2.5.21",
    name: "旁白解说助手",
    kind: "polisher",
    status: "planned",
    contentType: "narration",
    pipelineRole: "manual",
    filePrefixes: [],
    bindings: [],
  },
];

const INDEX = new Map(ASSISTANT_SEATS.map((s) => [s.id, s]));

export function getSeat(id: string): SeatView | undefined {
  return INDEX.get(id);
}

/** 该席位在指定作用域下要跑的 agent 序列；无绑定返回空数组。 */
export function resolveSeatAgents(id: string, scope?: string | null): string[] {
  const seat = INDEX.get(id);
  if (!seat) return [];
  if (scope) {
    const exact = seat.bindings.find((b) => b.scope === scope);
    if (exact) return [...exact.agentIds];
  }
  const generic = seat.bindings.find((b) => b.scope === null);
  return generic ? [...generic.agentIds] : [];
}

/** 席位的代表步骤：通用绑定的第一步，用于单节点试跑。 */
export function seatPrimaryStep(id: string): string | undefined {
  return resolveSeatAgents(id)[0];
}

/**
 * 文件名前缀 → 产它的 step id。点一份产物要定位到节点视图的哪个节点，查这张表。
 * 席位的 filePrefixes 只到席位粒度，定位要的是具体那一步，故单列。
 */
export const FILE_PREFIX_STEP: Readonly<Record<string, string>> = {
  "00_": "preference_summary",
  "01_": "preference_analysis",
  "02_": "initial_plan",
  "04_": "worldview",
  "06_": "story_framework",
  "07_": "outline_batch",
  "08_": "detailed_outline",
  "09_": "character_enrichment",
  "10_": "item_database",
  "11_": "plot_generation",
  "12_": "script_generation",
  "13_": "quest_generation",
  "14_": "scene_plan",
  "11a_": "state_ledger",
  "20a_": "scene_evidence",
  "07a_": "structure_validation_l1",
  "08a_": "structure_validation_l2",
  "15_": "lore_generation",
  "17_": "narrative_card",
  "18_": "encyclopedia_retrieval",
  "19_": "structure_check",
  "20_": "content_check",
  "T0_": "tier_detection",
  "T1_": "demand_analysis",
  "01a_": "global_control_params",
  "D0_": "core_concept",
  "D1_": "system_architecture",
  "D2_": "system_detail",
  "D3_": "value_framework",
  "D4_": "design_doc",
  "D4a_": "narrative_requirements",
  "15a_": "item_lore",
  "B0_": "branch_tree",
  "B1_": "dialogue_script",
  "B2_": "cinematic_storyboard",
  "B3_": "region_design",
  "B4_": "emergent_event",
  "B5_": "card_lore",
  "B6_": "event_pool",
  "V0_": "vn_logline",
  "V1_": "vn_outline_acts",
  "V1a_": "vn_character_bios",
  "V1b_": "vn_key_items",
  "V2_": "vn_scenes",
  "V3_": "vn_beats",
  "V4_": "vn_script_normalize",
  "V5_": "vn_segment_confirm",
  "V6_": "vn_branched_beats",
  "V6a_": "vn_state_ledger",
  "V7_": "vn_screenplay",
  "V8_": "vn_storyboard",
  "V9_": "vn_video_prompts"
};

/** 由 `<group>/<路径>` 反查产它的 step id；查不到返回 undefined。 */
export function stepIdForFile(groupedPath: string): string | undefined {
  const base = groupedPath.split("/").pop() ?? groupedPath;
  // 长前缀优先：01a_ 必须先于 01_ 命中，否则全局控制参数会被认成偏好分析。
  const hit = Object.keys(FILE_PREFIX_STEP)
    .filter((p) => base.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? FILE_PREFIX_STEP[hit] : undefined;
}
