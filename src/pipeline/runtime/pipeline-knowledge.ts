/**
 * Pipeline Knowledge Base — 叙事管线语义元数据
 *
 * 为影响面分析 Agent 提供：
 *  - 每步骤的语义描述（是什么/做什么）
 *  - 数据依赖图（输入/输出/读写字段）
 *  - 节点级字段定义
 *  - 变更传播规则
 *  - 变更分类辅助
 */

import { STEP_IDS } from "../routing/modes.js";

const S = STEP_IDS;

// ════════════════════════════════════════════════════════════════════
//  Step Metadata
// ════════════════════════════════════════════════════════════════════

export interface StepFieldDef {
  key: string;
  type: string;
  semantic: string;
}

export interface StepMeta {
  id: string;
  label: string;
  description: string;
  semanticRole: string;
  inputs: string[];
  outputKey: string;
  nodeLevel: boolean;
  nodeIdField?: string;
  parentIdField?: string;
  keyFields: StepFieldDef[];
  changeImpactRules: string[];
}

export const PIPELINE_KNOWLEDGE: Record<string, StepMeta> = {
  [S.PREFERENCE_SUMMARY]: {
    id: S.PREFERENCE_SUMMARY,
    label: "偏好总结",
    description: "将用户的原始输入（标题、类型、偏好描述）整理为结构化的偏好摘要",
    semanticRole: "全局基调定义 — 决定整个故事的风格方向",
    inputs: ["user_input"],
    outputKey: "user_preference_summary",
    nodeLevel: false,
    keyFields: [],
    changeImpactRules: [
      "偏好改变 → 全部下游重跑（风格/类型/基调变了，所有内容都需要重新适配）",
    ],
  },

  [S.PREFERENCE_ANALYSIS]: {
    id: S.PREFERENCE_ANALYSIS,
    label: "偏好分析",
    description: "将偏好摘要解析为结构化参数：genre, themes, tone, setting, target_audience 等",
    semanticRole: "参数化偏好 — 为后续步骤提供可引用的结构化设定",
    inputs: ["user_preference_summary"],
    outputKey: "user_preference_analysis",
    nodeLevel: false,
    keyFields: [
      { key: "genre", type: "string", semantic: "游戏类型（JRPG/AVG/开放世界等）" },
      { key: "themes", type: "string[]", semantic: "核心主题（复仇/救赎/冒险等）" },
      { key: "tone", type: "string", semantic: "叙事基调（黑暗/轻松/史诗等）" },
      { key: "setting", type: "string", semantic: "背景设定（赛博朋克/奇幻/现代等）" },
    ],
    changeImpactRules: [
      "genre 改变 → 全量重跑",
      "themes/tone 改变 → story_framework 及下游重跑",
      "setting 改变 → worldview 及下游重跑",
    ],
  },

  [S.INITIAL_PLAN]: {
    id: S.INITIAL_PLAN,
    label: "初步方案",
    description: "合并步骤：① 生成初步故事大纲（流式文本）② 结构化提取核心设定（角色/世界/冲突）③ 生成剧情简介。三个子阶段在同一步骤内顺序执行。",
    semanticRole: "创意种子 + 全局约束 — 确立故事方向、角色设定和核心冲突",
    inputs: ["user_preference_summary", "user_preference_analysis"],
    outputKey: "initial_story_outline",
    nodeLevel: false,
    keyFields: [
      { key: "initial_story_outline", type: "string", semantic: "初步大纲（Markdown 文本）" },
      { key: "core_settings.protagonist", type: "object", semantic: "主角基本设定" },
      { key: "core_settings.world_name", type: "string", semantic: "世界名称" },
      { key: "core_settings.main_conflict", type: "string", semantic: "核心冲突" },
      { key: "plot_synopsis.synopsis", type: "string", semantic: "200-300字剧情简介" },
    ],
    changeImpactRules: [
      "角色名/核心冲突改变 → worldview + character_enrichment + story_framework 及全部下游重跑",
      "时空背景改变 → worldview 及下游重跑",
      "仅措辞调整 → 不影响下游（下游基于结构化字段生成）",
    ],
  },

  // 向后兼容：旧存档中 initial_outline / core_settings / plot_synopsis 作为独立步骤存在
  [S.INITIAL_OUTLINE]: {
    id: S.INITIAL_OUTLINE,
    label: "初步大纲（旧）",
    description: "已合并入 initial_plan，向后兼容保留",
    semanticRole: "旧版步骤",
    inputs: ["user_preference_summary", "user_preference_analysis"],
    outputKey: "initial_story_outline",
    nodeLevel: false,
    keyFields: [],
    changeImpactRules: ["已废弃，使用 initial_plan 替代"],
  },

  [S.CORE_SETTINGS]: {
    id: S.CORE_SETTINGS,
    label: "核心设定（旧）",
    description: "已合并入 initial_plan，向后兼容保留",
    semanticRole: "旧版步骤",
    inputs: ["initial_story_outline"],
    outputKey: "core_settings",
    nodeLevel: false,
    keyFields: [],
    changeImpactRules: ["已废弃，使用 initial_plan 替代"],
  },

  [S.WORLDVIEW]: {
    id: S.WORLDVIEW,
    label: "世界观",
    description: "构建完整的世界观：地理、势力、历史、科技/魔法体系、经济、社会结构",
    semanticRole: "空间与规则 — 故事发生的世界背景和运作规则",
    inputs: ["core_settings", "user_preference_analysis"],
    outputKey: "worldview_structure",
    nodeLevel: false,
    keyFields: [
      { key: "geography", type: "object", semantic: "地理结构" },
      { key: "factions", type: "array", semantic: "势力/组织" },
      { key: "history", type: "object", semantic: "历史年表" },
      { key: "magic_system/tech_system", type: "object", semantic: "超自然/科技体系" },
    ],
    changeImpactRules: [
      "地理改变 → scene_plan 重跑",
      "势力改变 → character_enrichment + plot_generation + quest_generation 重跑",
      "体系改变 → item_database + quest_generation 重跑",
    ],
  },

  [S.PLOT_SYNOPSIS]: {
    id: S.PLOT_SYNOPSIS,
    label: "剧情简介（旧）",
    description: "已合并入 initial_plan，向后兼容保留",
    semanticRole: "旧版步骤",
    inputs: ["core_settings", "worldview_structure", "initial_story_outline"],
    outputKey: "plot_synopsis",
    nodeLevel: false,
    keyFields: [],
    changeImpactRules: ["已废弃，使用 initial_plan 替代"],
  },

  [S.STORY_FRAMEWORK]: {
    id: S.STORY_FRAMEWORK,
    label: "故事框架 (L0)",
    description: "将剧情简介展开为 L0 节点树：每个节点代表一个故事主阶段（开端/发展/高潮等），包含 main_content、triggers、branches。Step2 prompt 注入角色摘要和道具清单。",
    semanticRole: "骨架 — 决定故事有多少个主阶段、每个阶段讲什么",
    inputs: ["plot_synopsis", "core_settings", "worldview_structure", "detailed_character_sheets", "item_database"],
    outputKey: "story_framework",
    nodeLevel: true,
    nodeIdField: "node_id",
    keyFields: [
      { key: "node_id", type: "string", semantic: "节点唯一标识（如 1, 2, 3）" },
      { key: "name", type: "string", semantic: "阶段名称" },
      { key: "main_content", type: "string", semantic: "该阶段的核心内容描述" },
      { key: "triggers", type: "array", semantic: "触发条件/前置事件" },
      { key: "branches", type: "array", semantic: "分支可能性" },
    ],
    changeImpactRules: [
      "任何节点的 main_content 改变 → 该节点的子树（outline_batch 中 parent_id 匹配的节点）需要重跑",
      "节点增删 → 全部下游重跑（结构性变更）",
      "branches 改变 → 影响 outline_batch 的分支节点",
      "仅 name 改变 → 不影响下游内容（仅显示标签）",
    ],
  },

  [S.OUTLINE_BATCH]: {
    id: S.OUTLINE_BATCH,
    label: "故事大纲 (L1)",
    description: "对每个 L0 框架节点展开为多个 L1 章节节点，通过 parent_id 关联父节点。每个 L1 节点是一个情节段落。分组填充时注入角色摘要、道具清单、故事弧、跨组邻居上下文。",
    semanticRole: "章节划分 — 每个主阶段包含哪些具体情节段",
    inputs: ["story_framework", "detailed_character_sheets", "item_database", "initial_story_outline", "worldview_structure"],
    outputKey: "outlines_generated",
    nodeLevel: true,
    nodeIdField: "node_id",
    parentIdField: "parent_id",
    keyFields: [
      { key: "node_id", type: "string", semantic: "章节标识（如 1_1, 1_2, 2_1）" },
      { key: "parent_id", type: "string", semantic: "所属 L0 节点 ID" },
      { key: "name", type: "string", semantic: "章节名称" },
      { key: "content", type: "string", semantic: "章节情节概要" },
      { key: "is_branch", type: "boolean", semantic: "是否为分支节点" },
    ],
    changeImpactRules: [
      "content 改变 → 该节点的 detailed_outline 子节点重跑",
      "节点增删 → detailed_outline 对应子树重跑",
      "is_branch 改变 → 可能影响 quest_generation 的任务链",
    ],
  },

  [S.DETAILED_OUTLINE]: {
    id: S.DETAILED_OUTLINE,
    label: "故事细纲 (L2)",
    description: "对每个 L1 章节节点展开为多个 L2 细纲节点，包含具体的事件描述、人物行动、场景提示、风格指引（dialogue_hint/monologue_hint/narration_hint/atmosphere）。分组填充时注入角色摘要、道具清单、故事弧、跨组邻居上下文。",
    semanticRole: "事件细化 — 每个情节段包含哪些具体事件",
    inputs: ["outlines_generated", "story_framework", "core_settings", "detailed_character_sheets", "item_database", "initial_story_outline", "worldview_structure"],
    outputKey: "detailed_outlines_generated",
    nodeLevel: true,
    nodeIdField: "node_id",
    parentIdField: "parent_id",
    keyFields: [
      { key: "node_id", type: "string", semantic: "细纲标识（如 1_1_1, 1_1_2）" },
      { key: "parent_id", type: "string", semantic: "所属 L1 节点 ID" },
      { key: "content", type: "string", semantic: "详细事件描述" },
      { key: "story_elements.dialogue_hint", type: "string", semantic: "对白风格提示（L4 引用）" },
      { key: "story_elements.monologue_hint", type: "string", semantic: "独白方向提示（L4 引用）" },
      { key: "story_elements.narration_hint", type: "string", semantic: "旁白语气提示（L4 引用）" },
      { key: "story_elements.atmosphere", type: "string", semantic: "氛围描述（L4 引用）" },
    ],
    changeImpactRules: [
      "content 改变 → plot_generation 对应节点重跑 + 可能影响 character_enrichment",
      "characters_involved 改变 → character_enrichment 相关角色重跑",
      "location_hint 改变 → scene_plan 相关场景重跑",
    ],
  },

  [S.CHARACTER_ENRICHMENT]: {
    id: S.CHARACTER_ENRICHMENT,
    label: "角色档案",
    description: "从框架+大纲+细纲中提取所有角色，为每个角色生成完整档案：外貌、性格、背景、关系、属性、弧光",
    semanticRole: "角色塑造 — 每个角色是谁、动机是什么、跟谁有关系",
    inputs: ["story_framework", "outlines_generated", "detailed_outlines_generated", "core_settings"],
    outputKey: "detailed_character_sheets",
    nodeLevel: true,
    nodeIdField: "name",
    keyFields: [
      { key: "name", type: "string", semantic: "角色名" },
      { key: "label", type: "string", semantic: "角色定位（主角/配角/NPC）" },
      { key: "role_in_story", type: "string", semantic: "故事中的作用" },
      { key: "character_arc_spectrum", type: "object", semantic: "角色弧光（起点→终点）" },
      { key: "relationships", type: "object", semantic: "人物关系网" },
      { key: "psychological_drivers", type: "object", semantic: "心理动机" },
      { key: "game_mechanics", type: "object", semantic: "游戏属性（HP/ATK/DEF）" },
    ],
    changeImpactRules: [
      "角色名改变 → script_generation/quest_generation 中引用该角色的内容重跑",
      "relationships 改变 → 可能影响 plot_generation 中涉及该关系的情节",
      "game_mechanics 改变 → item_database 中关联该角色的道具可能需要调整",
      "弧光改变 → 不直接影响下游结构，但 script_generation 的情感表达可能偏移",
    ],
  },

  [S.ITEM_DATABASE]: {
    id: S.ITEM_DATABASE,
    label: "道具清单",
    description: "基于角色和情节生成游戏道具列表，每个道具包含属性、效果、关联角色和初始场景",
    semanticRole: "物品系统 — 游戏中有哪些道具、谁拥有、在哪里",
    inputs: ["detailed_character_sheets", "plots_generated", "core_settings", "worldview_structure"],
    outputKey: "item_database",
    nodeLevel: true,
    nodeIdField: "name",
    keyFields: [
      { key: "name", type: "string", semantic: "道具名" },
      { key: "category", type: "string", semantic: "道具分类" },
      { key: "rarity", type: "string", semantic: "稀有度" },
      { key: "effect", type: "string", semantic: "使用效果" },
      { key: "initial_owner", type: "string|null", semantic: "初始拥有者（角色名）" },
      { key: "initial_scene", type: "string", semantic: "初始场景" },
      { key: "related_character", type: "string|null", semantic: "关联角色" },
    ],
    changeImpactRules: [
      "道具改动通常不影响上游",
      "如果道具是关键剧情道具（如触发条件关联的道具），可能需要 quest_generation 重跑",
      "initial_scene 改变不影响 scene_plan（场景独立生成）",
    ],
  },

  [S.PLOT_GENERATION]: {
    id: S.PLOT_GENERATION,
    label: "情节节点 (L3)",
    description: "对每个 L2 细纲节点生成结构化的情节节点：包含戏剧冲突、NPC互动、情绪节拍、决策点。采用拓扑分层执行（分支并行+主干顺序），通过滑动窗口传递前驱摘要。增加祖先链上下文（L0→L1→L2）、用户原始需求、剧情简介。",
    semanticRole: "可玩化 — 把文学叙事转化为可交互的游戏情节",
    inputs: ["detailed_outlines_generated", "outlines_generated", "story_framework", "detailed_character_sheets", "user_input", "plot_synopsis", "worldview_structure"],
    outputKey: "plots_generated",
    nodeLevel: true,
    nodeIdField: "node_id",
    parentIdField: "parent_id",
    keyFields: [
      { key: "node_id", type: "string", semantic: "情节节点 ID（与 L2 相同）" },
      { key: "parent_id", type: "string", semantic: "父节点 ID" },
      { key: "dramatic_question", type: "string", semantic: "戏剧问题" },
      { key: "conflict", type: "object", semantic: "冲突描述" },
      { key: "npc_interactions", type: "array", semantic: "NPC互动" },
      { key: "decision_points", type: "array", semantic: "玩家决策点" },
    ],
    changeImpactRules: [
      "decision_points 改变 → quest_generation 相关任务分支重跑",
      "npc_interactions 改变 → script_generation 对应章节重跑",
      "dramatic_question 改变 → script_generation 对应章节的 conflict 和情绪需要调整",
      "节点增删 → script_generation + quest_generation + scene_plan 对应子树重跑",
    ],
  },

  [S.SCRIPT_GENERATION]: {
    id: S.SCRIPT_GENERATION,
    label: "剧本节点 (L4)",
    description: "对每个情节节点生成可播放的剧本：场景舞台指示、对话、旁白、内心独白、BGM提示。采用拓扑分层执行（分支并行+主干顺序），通过滑动窗口传递前驱摘要。增加 L2 风格指引（dialogue_hint/monologue_hint/narration_hint/atmosphere）和用户原始需求。",
    semanticRole: "台本 — 游戏中实际呈现给玩家的文本内容",
    inputs: ["plots_generated", "detailed_character_sheets", "worldview_structure", "detailed_outlines_generated", "user_input"],
    outputKey: "jrpg_script",
    nodeLevel: true,
    nodeIdField: "chapter_id",
    keyFields: [
      { key: "chapter_id", type: "string", semantic: "章节ID" },
      { key: "node_id", type: "string", semantic: "对应细纲节点" },
      { key: "plot_node_id", type: "string", semantic: "对应情节节点" },
      { key: "title", type: "string", semantic: "章节标题" },
      { key: "scenes", type: "array", semantic: "场景列表（含 dialogue/narration/action）" },
      { key: "conflict", type: "object", semantic: "冲突描述（类型/紧张度/转折点）" },
      { key: "character_arcs", type: "array", semantic: "角色弧光进展" },
    ],
    changeImpactRules: [
      "对话内容改变 → 通常不影响其他步骤（终端输出）",
      "conflict/character_arcs 改变 → 如果与 quest_generation 的触发条件冲突则需要调整",
      "场景 location 改变 → 不影响 scene_plan（场景树独立构建）",
    ],
  },

  [S.QUEST_GENERATION]: {
    id: S.QUEST_GENERATION,
    label: "任务系统 (L5)",
    description: "基于情节节点和剧本生成任务系统：主线/支线/探索任务，包含触发条件、目标、奖励、NPC关联。L4 章节摘要增强：补充场景列表和冲突信息以改善任务触发设计。",
    semanticRole: "可玩性 — 把叙事转化为任务目标和奖励循环",
    inputs: ["plots_generated", "jrpg_script", "detailed_character_sheets", "item_database"],
    outputKey: "quest_graph",
    nodeLevel: true,
    nodeIdField: "quest_id",
    keyFields: [
      { key: "quest_id", type: "string", semantic: "任务ID" },
      { key: "name", type: "string", semantic: "任务名" },
      { key: "type", type: "string", semantic: "任务类型（主线/支线/探索）" },
      { key: "story_node_id", type: "string", semantic: "关联的情节节点" },
      { key: "trigger", type: "object", semantic: "触发条件（NPC/区域/物品/事件）" },
      { key: "objectives", type: "array", semantic: "任务目标" },
      { key: "rewards", type: "object", semantic: "奖励" },
    ],
    changeImpactRules: [
      "任务改动通常不影响上游",
      "如果改动了 main_quest_chain 的顺序 → 可能需要调整其他关联任务的 prerequisites",
      "触发条件改变 → 通常是终端改动，不影响其他",
    ],
  },

  [S.SCENE_PLAN]: {
    id: S.SCENE_PLAN,
    label: "场景生成 (L6)",
    description: "三阶段生成场景树：Phase1 分层骨架提取（从 L0/L1/L2 节点抽取场景）→ Phase2 按情节节点展开（L3-L5数据）→ Phase3 合并去重+UID分配",
    semanticRole: "空间 — 游戏世界的地图/场景/地标结构",
    inputs: ["story_framework", "outlines_generated", "detailed_outlines_generated", "plots_generated", "jrpg_script", "quest_graph"],
    outputKey: "scene_map",
    nodeLevel: true,
    nodeIdField: "_phase2_per_node keys (plot node_id)",
    keyFields: [
      { key: "_phase1_skeleton", type: "SceneNode[]", semantic: "合并骨架（L0+L1+L2提取）" },
      { key: "_phase1_by_layer", type: "{ l0, l1, l2 }", semantic: "分层骨架" },
      { key: "_phase2_per_node", type: "Record<plotNodeId, SceneNode[]>", semantic: "按情节节点展开的场景" },
      { key: "scenes", type: "SceneNode[]", semantic: "最终合并的场景树" },
      { key: "world_name", type: "string", semantic: "世界名" },
    ],
    changeImpactRules: [
      "场景改动通常是终端改动，不影响上游",
      "但如果场景结构与 quest trigger 的 scene 字段冲突 → 需要确认一致性",
    ],
  },

  [S.LORE_GENERATION]: {
    id: S.LORE_GENERATION,
    label: "Lore碎片",
    description: "生成散落在游戏世界中的叙事碎片：物品描述、环境文本、NPC闲聊、文档收集品",
    semanticRole: "世界细节 — 丰富世界观的碎片化叙事",
    inputs: ["worldview_structure", "item_database", "scene_map"],
    outputKey: "lore_fragments",
    nodeLevel: false,
    keyFields: [],
    changeImpactRules: ["终端步骤，改动不影响其他"],
  },

  // ── D0-D4 策划管线 ──

  [S.CORE_CONCEPT]: {
    id: S.CORE_CONCEPT,
    label: "核心概念 (D0)",
    description: "提炼游戏的核心玩法概念：核心循环、差异化卖点、目标玩家群、设计目标",
    semanticRole: "策划根基 — 决定游戏是什么、为谁做、做什么",
    inputs: ["demand_analysis", "user_input"],
    outputKey: "core_concept",
    nodeLevel: false,
    keyFields: [
      { key: "core_loop", type: "string", semantic: "核心玩法循环" },
      { key: "usp", type: "string[]", semantic: "独特卖点" },
      { key: "target_player", type: "string", semantic: "目标玩家" },
      { key: "design_pillars", type: "string[]", semantic: "设计支柱" },
    ],
    changeImpactRules: [
      "核心循环改变 → 全部 D1-D4 + 叙事管线中依赖 core_loop 的步骤重跑",
      "设计支柱改变 → D1-D4 全部重跑，叙事管线的 quest_generation 可能受影响",
      "目标玩家改变 → D1-D4 可能需要调整，叙事偏好方向改变",
    ],
  },

  [S.SYSTEM_ARCHITECTURE]: {
    id: S.SYSTEM_ARCHITECTURE,
    label: "系统架构 (D1)",
    description: "设计游戏系统架构：核心系统模块、系统间关系、技术约束",
    semanticRole: "系统框架 — 游戏由哪些系统组成",
    inputs: ["core_concept"],
    outputKey: "system_architecture",
    nodeLevel: false,
    keyFields: [
      { key: "systems", type: "object[]", semantic: "系统模块列表" },
      { key: "interactions", type: "object[]", semantic: "系统间交互" },
    ],
    changeImpactRules: [
      "系统模块增删 → D2-D4 及相关叙事步骤（item_database/quest_generation）重跑",
    ],
  },

  [S.SYSTEM_DETAIL]: {
    id: S.SYSTEM_DETAIL,
    label: "玩法设计 (D2)",
    description: "详细设计各系统的玩法：具体机制、数值范围、用户流程",
    semanticRole: "玩法细节 — 每个系统如何运作",
    inputs: ["system_architecture", "core_concept"],
    outputKey: "system_details",
    nodeLevel: false,
    keyFields: [],
    changeImpactRules: [
      "机制改变 → D3（数值框架）可能需要同步调整",
      "用户流程改变 → quest_generation 可能受影响",
    ],
  },

  [S.VALUE_FRAMEWORK]: {
    id: S.VALUE_FRAMEWORK,
    label: "数值框架 (D3)",
    description: "建立游戏数值体系：属性定义、平衡参数、经济循环",
    semanticRole: "数值体系 — 游戏的数字规则",
    inputs: ["system_details", "system_architecture"],
    outputKey: "value_framework",
    nodeLevel: false,
    keyFields: [
      { key: "attributes", type: "object[]", semantic: "角色属性定义" },
      { key: "economy", type: "object", semantic: "经济循环参数" },
    ],
    changeImpactRules: [
      "属性改变 → character_enrichment 的 game_mechanics 字段可能需要更新",
      "经济参数改变 → item_database 的 value 字段可能需要重算",
    ],
  },

  [S.DESIGN_DOC]: {
    id: S.DESIGN_DOC,
    label: "策划案整合 (D4)",
    description: "整合 D0-D3 的所有设计，生成完整的 GDD（游戏设计文档）",
    semanticRole: "设计文档 — 完整可执行的策划案",
    inputs: ["core_concept", "system_architecture", "system_details", "value_framework"],
    outputKey: "game_design_context",
    nodeLevel: false,
    keyFields: [],
    changeImpactRules: [
      "D4 是 D0-D3 的整合输出，本身改动通常不直接影响叙事管线",
      "但 D4 包含 narrative_requirements，其改变会触发叙事管线的 preference_summary 及下游重跑",
    ],
  },
};

// ════════════════════════════════════════════════════════════════════
//  Data Dependency Graph
// ════════════════════════════════════════════════════════════════════

export interface DependencyEdge {
  from: string;
  to: string;
  type: "structural" | "content" | "reference";
  description: string;
}

export const DEPENDENCY_GRAPH: DependencyEdge[] = [
  // 偏好 → 基础设定
  { from: S.PREFERENCE_SUMMARY, to: S.PREFERENCE_ANALYSIS, type: "structural", description: "文本偏好 → 结构化参数" },
  { from: S.PREFERENCE_ANALYSIS, to: S.INITIAL_OUTLINE, type: "content", description: "偏好参数指导大纲风格" },
  { from: S.INITIAL_OUTLINE, to: S.CORE_SETTINGS, type: "structural", description: "从大纲提取核心设定" },
  { from: S.CORE_SETTINGS, to: S.WORLDVIEW, type: "structural", description: "设定约束世界观" },

  // 叙事主线
  { from: S.WORLDVIEW, to: S.PLOT_SYNOPSIS, type: "content", description: "世界观约束剧情" },
  { from: S.CORE_SETTINGS, to: S.PLOT_SYNOPSIS, type: "structural", description: "角色/冲突定义剧情方向" },
  { from: S.PLOT_SYNOPSIS, to: S.STORY_FRAMEWORK, type: "structural", description: "剧情展开为框架节点" },
  { from: S.CHARACTER_ENRICHMENT, to: S.STORY_FRAMEWORK, type: "reference", description: "角色摘要注入 L0 Step2 prompt" },
  { from: S.ITEM_DATABASE, to: S.STORY_FRAMEWORK, type: "reference", description: "道具清单注入 L0 Step2 prompt" },
  { from: S.STORY_FRAMEWORK, to: S.OUTLINE_BATCH, type: "structural", description: "L0 → L1 展开" },
  { from: S.CHARACTER_ENRICHMENT, to: S.OUTLINE_BATCH, type: "reference", description: "角色摘要注入 L1 分组填充和补漏" },
  { from: S.ITEM_DATABASE, to: S.OUTLINE_BATCH, type: "reference", description: "道具清单注入 L1 分组填充" },
  { from: S.OUTLINE_BATCH, to: S.DETAILED_OUTLINE, type: "structural", description: "L1 → L2 展开" },
  { from: S.CHARACTER_ENRICHMENT, to: S.DETAILED_OUTLINE, type: "reference", description: "角色摘要注入 L2 分组填充和补漏" },
  { from: S.ITEM_DATABASE, to: S.DETAILED_OUTLINE, type: "reference", description: "道具清单注入 L2 分组填充" },

  // 角色与物品（依赖多层）
  { from: S.STORY_FRAMEWORK, to: S.CHARACTER_ENRICHMENT, type: "content", description: "框架中的角色线索" },
  { from: S.OUTLINE_BATCH, to: S.CHARACTER_ENRICHMENT, type: "content", description: "大纲中的角色互动" },
  { from: S.DETAILED_OUTLINE, to: S.CHARACTER_ENRICHMENT, type: "content", description: "细纲中的角色行为" },
  { from: S.CHARACTER_ENRICHMENT, to: S.ITEM_DATABASE, type: "reference", description: "角色关联道具" },
  { from: S.PLOT_GENERATION, to: S.ITEM_DATABASE, type: "reference", description: "情节引用道具" },

  // 情节→剧本→任务
  { from: S.DETAILED_OUTLINE, to: S.PLOT_GENERATION, type: "structural", description: "L2 → L3 情节展开（拓扑分层执行+滑动窗口）" },
  { from: S.CHARACTER_ENRICHMENT, to: S.PLOT_GENERATION, type: "reference", description: "角色信息用于 NPC 互动" },
  { from: S.OUTLINE_BATCH, to: S.PLOT_GENERATION, type: "reference", description: "L1 节点用于祖先链上下文" },
  { from: S.STORY_FRAMEWORK, to: S.PLOT_GENERATION, type: "reference", description: "L0 节点用于祖先链上下文" },
  { from: S.PLOT_SYNOPSIS, to: S.PLOT_GENERATION, type: "reference", description: "剧情简介注入 L3 prompt" },
  { from: S.PLOT_GENERATION, to: S.SCRIPT_GENERATION, type: "structural", description: "情节 → 剧本（拓扑分层执行+滑动窗口）" },
  { from: S.CHARACTER_ENRICHMENT, to: S.SCRIPT_GENERATION, type: "reference", description: "角色语气/口头禅" },
  { from: S.DETAILED_OUTLINE, to: S.SCRIPT_GENERATION, type: "reference", description: "L2 风格指引（dialogue_hint/monologue_hint/narration_hint/atmosphere）" },
  { from: S.PLOT_GENERATION, to: S.QUEST_GENERATION, type: "structural", description: "情节决策点 → 任务" },
  { from: S.SCRIPT_GENERATION, to: S.QUEST_GENERATION, type: "reference", description: "剧本场景 → 任务触发" },
  { from: S.ITEM_DATABASE, to: S.QUEST_GENERATION, type: "reference", description: "道具 → 任务奖励/条件" },

  // 场景（多源输入）
  { from: S.STORY_FRAMEWORK, to: S.SCENE_PLAN, type: "content", description: "L0 → Phase1 骨架" },
  { from: S.OUTLINE_BATCH, to: S.SCENE_PLAN, type: "content", description: "L1 → Phase1 骨架" },
  { from: S.DETAILED_OUTLINE, to: S.SCENE_PLAN, type: "content", description: "L2 → Phase1 骨架" },
  { from: S.PLOT_GENERATION, to: S.SCENE_PLAN, type: "structural", description: "情节节点 → Phase2 展开" },
  { from: S.SCRIPT_GENERATION, to: S.SCENE_PLAN, type: "reference", description: "剧本场景位置参考" },
  { from: S.QUEST_GENERATION, to: S.SCENE_PLAN, type: "reference", description: "任务触发场景" },
];

// ════════════════════════════════════════════════════════════════════
//  Change Classification
// ════════════════════════════════════════════════════════════════════

export type ChangeCategory = "structural" | "content" | "cosmetic";

export interface ChangeClassification {
  category: ChangeCategory;
  confidence: number;
  signals: string[];
}

/**
 * Pre-classify change type based on heuristics before LLM analysis.
 * Structural: affects story direction/architecture.
 * Content: changes meaningful info but not structure.
 * Cosmetic: only formatting/typos.
 */
export function preClassifyChange(
  stepId: string,
  userInput?: string,
  diffText?: string,
): ChangeClassification {
  const signals: string[] = [];
  let structural = 0;
  let content = 0;
  let cosmetic = 0;

  const input = (userInput ?? "").toLowerCase();
  const diff = (diffText ?? "").toLowerCase();
  const combined = input + " " + diff;

  // Structural signals
  const structuralKeywords = [
    "结局", "ending", "主线", "删除", "新增", "添加", "角色命运",
    "be", "he", "改为", "变成", "世界观", "设定", "核心", "循环",
    "分支", "时间线", "时代", "背景", "去掉", "加入",
  ];
  for (const kw of structuralKeywords) {
    if (combined.includes(kw)) {
      structural += 2;
      signals.push(`structural keyword: "${kw}"`);
    }
  }

  // Content signals
  const contentKeywords = [
    "修改", "改善", "优化", "丰富", "补充", "扩展", "细化", "加强",
    "调整", "改进", "更新", "融入", "融合",
  ];
  for (const kw of contentKeywords) {
    if (combined.includes(kw)) {
      content += 1;
      signals.push(`content keyword: "${kw}"`);
    }
  }

  // Cosmetic signals
  const cosmeticKeywords = [
    "错别字", "typo", "格式", "标点", "空格", "排版", "大小写",
  ];
  for (const kw of cosmeticKeywords) {
    if (combined.includes(kw)) {
      cosmetic += 3;
      signals.push(`cosmetic keyword: "${kw}"`);
    }
  }

  // Step-based heuristic: changes to early steps are more likely structural
  const earlySteps: string[] = [S.PREFERENCE_SUMMARY, S.INITIAL_OUTLINE, S.CORE_SETTINGS, S.WORLDVIEW, S.PLOT_SYNOPSIS];
  if (earlySteps.includes(stepId)) {
    structural += 1;
    signals.push("early pipeline step (likely structural)");
  }

  const total = structural + content + cosmetic;
  if (total === 0) {
    return { category: "content", confidence: 0.3, signals: ["no clear signals, defaulting to content"] };
  }

  if (structural >= content && structural >= cosmetic) {
    return { category: "structural", confidence: Math.min(structural / total, 0.95), signals };
  }
  if (cosmetic > structural && cosmetic > content) {
    return { category: "cosmetic", confidence: Math.min(cosmetic / total, 0.9), signals };
  }
  return { category: "content", confidence: Math.min(content / total, 0.85), signals };
}

// ════════════════════════════════════════════════════════════════════
//  Knowledge Base -> Prompt Builder
// ════════════════════════════════════════════════════════════════════

/**
 * Generate the full knowledge context for the Impact Analysis Agent.
 */
export function buildKnowledgePromptSection(
  relevantStepIds: string[],
  includeFullGraph: boolean = false,
): string {
  const sections: string[] = [];

  sections.push("## 管线步骤详解\n");
  const stepsToInclude = includeFullGraph
    ? Object.values(PIPELINE_KNOWLEDGE)
    : relevantStepIds
        .map(id => PIPELINE_KNOWLEDGE[id])
        .filter(Boolean);

  for (const meta of stepsToInclude) {
    sections.push(`### ${meta.label} (\`${meta.id}\`)`);
    sections.push(`- 描述: ${meta.description}`);
    sections.push(`- 语义定位: ${meta.semanticRole}`);
    sections.push(`- 输入依赖: ${meta.inputs.join(", ")}`);
    sections.push(`- 输出字段: \`${meta.outputKey}\``);
    if (meta.nodeLevel) {
      sections.push(`- 节点级: 是 (nodeId: \`${meta.nodeIdField}\`${meta.parentIdField ? `, parentId: \`${meta.parentIdField}\`` : ""})`);
    }
    if (meta.keyFields.length > 0) {
      sections.push(`- 关键字段:`);
      for (const f of meta.keyFields) {
        sections.push(`  - \`${f.key}\` (${f.type}): ${f.semantic}`);
      }
    }
    sections.push(`- 改动影响规则:`);
    for (const rule of meta.changeImpactRules) {
      sections.push(`  - ${rule}`);
    }
    sections.push("");
  }

  sections.push("\n## 数据依赖关系\n");
  const relevantEdges = includeFullGraph
    ? DEPENDENCY_GRAPH
    : DEPENDENCY_GRAPH.filter(e =>
        relevantStepIds.includes(e.from) || relevantStepIds.includes(e.to)
      );

  sections.push("```");
  for (const edge of relevantEdges) {
    const typeTag = edge.type === "structural" ? "[结构]"
      : edge.type === "content" ? "[内容]"
      : "[引用]";
    sections.push(`${edge.from} → ${edge.to} ${typeTag} ${edge.description}`);
  }
  sections.push("```\n");

  sections.push("依赖类型说明:");
  sections.push("- [结构]: 下游的结构/节点直接从上游派生，上游改动必然导致下游重跑");
  sections.push("- [内容]: 下游内容参考上游，上游重大改动影响下游质量");
  sections.push("- [引用]: 下游引用上游的具体数据（如角色名），仅在引用值改变时影响");

  return sections.join("\n");
}

/**
 * Build a node tree summary for inclusion in the prompt.
 */
export function buildNodeTreeSummary(ctx: unknown): string {
  const c = ctx as Record<string, unknown>;
  const lines: string[] = ["## 当前节点树结构\n"];

  const fw = (c.story_framework as Record<string, unknown>)?.framework as Record<string, unknown> | undefined;
  const fwNodes = (fw?.nodes ?? []) as Array<{ node_id: string; name?: string }>;
  if (fwNodes.length) {
    lines.push(`L0 框架 (${fwNodes.length} 节点): ${fwNodes.map(n => `${n.node_id}:${n.name ?? ""}`).join(", ")}`);
  }

  const ol = (c.outlines_generated as Record<string, unknown>)?.outlines as Array<{ node_id: string; parent_id: string; name?: string }> | undefined;
  if (ol?.length) {
    lines.push(`L1 大纲 (${ol.length} 节点): ${ol.slice(0, 10).map(n => `${n.node_id}(←${n.parent_id})`).join(", ")}${ol.length > 10 ? "..." : ""}`);
  }

  const dt = (c.detailed_outlines_generated as Record<string, unknown>)?.detailed_outlines as Array<{ node_id: string; parent_id: string }> | undefined;
  if (dt?.length) {
    lines.push(`L2 细纲 (${dt.length} 节点): ${dt.slice(0, 8).map(n => `${n.node_id}(←${n.parent_id})`).join(", ")}${dt.length > 8 ? "..." : ""}`);
  }

  const plots = (c.plots_generated as Record<string, unknown>)?.plots as Array<{ node_id: string; parent_id?: string }> | undefined;
  if (plots?.length) {
    lines.push(`L3 情节 (${plots.length} 节点): ${plots.slice(0, 8).map(n => n.node_id).join(", ")}${plots.length > 8 ? "..." : ""}`);
  }

  const script = (c.jrpg_script as Record<string, unknown>)?.chapters as Array<{ chapter_id: string; plot_node_id?: string }> | undefined;
  if (script?.length) {
    lines.push(`L4 剧本 (${script.length} 章节): ${script.slice(0, 6).map(n => n.chapter_id).join(", ")}${script.length > 6 ? "..." : ""}`);
  }

  const quests = (c.quest_graph as Record<string, unknown>)?.quests as Array<{ quest_id: string; story_node_id: string }> | undefined;
  if (quests?.length) {
    lines.push(`L5 任务 (${quests.length} 任务): ${quests.slice(0, 6).map(n => `${n.quest_id}→${n.story_node_id}`).join(", ")}${quests.length > 6 ? "..." : ""}`);
  }

  const chars = c.detailed_character_sheets as Array<{ name: string; label?: string }> | undefined;
  if (chars?.length) {
    lines.push(`角色 (${chars.length}): ${chars.map(c => `${c.name}(${c.label ?? "NPC"})`).join(", ")}`);
  }

  const items = c.item_database as Array<{ name: string }> | undefined;
  if (items?.length) {
    lines.push(`道具 (${items.length}): ${items.slice(0, 8).map(it => it.name).join(", ")}${items.length > 8 ? "..." : ""}`);
  }

  return lines.join("\n");
}
