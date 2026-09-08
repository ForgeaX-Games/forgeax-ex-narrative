/**
 * NarrativeIpDna —— 统一数据模型（IP DNA）
 *
 * 对应《叙事工坊产品形态蓝图》第四章「统一数据模型与字段规格」。
 *
 * 核心抽象（§1.2 / §3.2）：IP DNA = 三者的抽象集合
 *   ① 叙事层级树（物质基础 / 文件数据管理系统）—— 见 {@link HierarchyNode} / {@link NarrativeIpDna}
 *   ② 叙事模板（骨架）                          —— 见 {@link NarrativeTemplate}（template.json）
 *   ③ 叙事方法 / 算子（组织与表达）              —— 见 {@link NarrativeOperator}（operators.json）
 *
 * 数据关系（§4.1 / §15.1）：全系统只有两套数据——
 *   A = `NarrativeIpDna`（输入理解产物）
 *   B = `NarrativeContext` 其余字段（生成管线产物）
 * A 经"双向映射"喂入 B；`narrativeIpDna` 作为并列字段挂在 `NarrativeContext` 上（见 ./index.ts）。
 *
 * 命名约定（§4.2 命名约定）：概念/类型用驼峰 `NarrativeIpDna`（对齐 `NarrativeContext`），
 * 字段为 `narrativeIpDna`；三件套文件统一命名 `template.json` / `operators.json` / `metadata.json`，
 * 每一层级的每一个文件夹中都必有这三件套。
 */

// ─────────────────────────────────────────────────────────────────
// 0. 公共基础类型
// ─────────────────────────────────────────────────────────────────

/**
 * Schema 版本（§14.2 D5）。IP DNA 顶层携带，预留迁移器、向后兼容。
 */
export const NARRATIVE_IP_DNA_SCHEMA_VERSION = "1.0.0";

/**
 * 单步迁移器：把某一旧版本的 IP DNA 原始对象升级到下一版本（§14.2 D5）。
 * 注册到 {@link IP_DNA_MIGRATIONS}，由 {@link migrateIpDnaSchema} 按版本顺序链式应用。
 */
export type IpDnaMigration = {
  /** 适用的来源版本（迁移前）。 */
  from: string;
  /** 迁移后的目标版本。 */
  to: string;
  /** 迁移函数（原地或返回新对象均可）。 */
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
};

/**
 * 迁移器注册表（§14.2 D5）。当前仅 1.0.0、无历史版本，故为空——
 * 未来引入破坏性 schema 变更时，在此追加 { from, to, migrate } 即可，加载侧自动链式升级。
 */
export const IP_DNA_MIGRATIONS: IpDnaMigration[] = [];

/**
 * IP DNA schema 迁移（§14.2 D5）——加载持久化 IP DNA 时调用，保证向后兼容：
 *   - 无 schema_version（前置版本化的旧 checkpoint）→ 视为 "0.0.0"，链式迁移到当前版本；
 *   - 按注册的迁移器顺序升级，最终标记为 {@link NARRATIVE_IP_DNA_SCHEMA_VERSION}；
 *   - 无适配迁移器时（如已是当前版本）仅补齐版本号，不改动数据。
 */
export function migrateIpDnaSchema<T extends { schema_version?: string }>(raw: T): T {
  if (!raw || typeof raw !== "object") return raw;
  let current = raw.schema_version ?? "0.0.0";
  let data = raw as unknown as Record<string, unknown>;
  // 防御性上限：迁移链长度不超过注册表条数 + 1，避免环路。
  for (let guard = 0; guard <= IP_DNA_MIGRATIONS.length && current !== NARRATIVE_IP_DNA_SCHEMA_VERSION; guard++) {
    const step = IP_DNA_MIGRATIONS.find((m) => m.from === current);
    if (!step) break; // 无匹配迁移器：停止链式升级（下方统一补齐版本号）。
    data = step.migrate(data);
    current = step.to;
  }
  data.schema_version = NARRATIVE_IP_DNA_SCHEMA_VERSION;
  return data as unknown as T;
}

/**
 * 完整故事时间戳——贯穿 input→output 的同一主键（§6.0）。
 * 形如 `20260622_2030` 或 `<时间戳>_《题目》` 中的时间戳部分。
 * input 与 output 全程共用同一个，用于数据关联、影响面追溯、精确定点修改。
 */
export type StoryTimestamp = string;

/** 媒体类型（§3.1）；mixed = 混合模态（正文+图片+视频同属一个完整故事，§3.4 第 2 点）。 */
export type IpMediaType = "book" | "comic" | "video" | "picture" | "mixed";

/** 输入侧来源分流（§5.2 / §6.1）：默认 story 侧，保留 theory 入口。 */
export type IpSide = "story" | "theory";

/**
 * 媒体无关的四层级统一抽象（§3.1）：
 *   `完整叙事内容 -[部/卷/册/季] -[章] - 节(最小叙事单元)`
 * 顶层 complete、底层 unit（最小叙事单元）；中间 part / chapter 按实际文件按需匹配（可缺省）。
 * "叫法是实例、层级才是抽象"：小说=节 / 漫画=话 / 影视=集 / 剧本=情节点，统一抽象为 unit。
 */
export type HierarchyLevelType = "complete" | "part" | "chapter" | "unit";

/**
 * 层级结构类型（迁移自 agentos v6 `structure_type`，改造对齐我们四层抽象，§3.0c/§3.2）。
 *   - single_file：无内部结构标记，整体一个最小叙事单元（短篇/散文）；
 *   - single_layer：仅 root→叶子一层（如多章无卷）；
 *   - two_layer：两层中间结构（如 卷-章 或 章-节）；
 *   - three_layer：三层中间结构（部-卷/章-节）。
 * 用于驱动逐层聚合次数（aggregationTimes）与裁剪/聚合策略。
 */
export type HierarchyStructureType =
  | "single_file"
  | "single_layer"
  | "two_layer"
  | "three_layer";

// ─────────────────────────────────────────────────────────────────
// 1. 组件③ 叙事算子（operators.json，8 字段标准，§4.5 / §3.2）
// ─────────────────────────────────────────────────────────────────

/**
 * 叙事算子（与 `knowledge_base` 算子标准化格式、`叙事算子标准化模板.md` 对齐）。
 *
 * 重要（§4.5）：**算子本体只有这 8 个标准字段，不新增任何字段**。
 *   - "视角"是槽位层的分组键（由 `knowledge_location` / `knowledge_domain` 推断），不写进算子；
 *   - "来源 source(extracted/retrieved/generated)"记在槽位 / 算子方案层（见 {@link OperatorSlotCandidate}），不写进算子；
 *   - LLM 生成兜底算子的来源名直接复用既有 `example` / `knowledge_location` 字段填"故事/项目标题"，仍不算新增字段。
 */
export interface NarrativeOperator {
  uid: string;
  name: string;
  definition: string;
  adaptation: {
    /** 适配的算子作用类型。 */
    type: string;
    /** 适配的叙事元素。 */
    element: string;
  };
  usage_guide: string;
  example: string;
  /** 来源位置（知识库中的归属/出处；生成算子可填故事/项目标题作为 source-name）。 */
  knowledge_location: string;
  /** 知识域（五大核心分类：叙事者定位 / 情感体验 / 文学风格 / 故事内容 / 叙事技巧）。 */
  knowledge_domain: string;
}

/** 算子五大核心分类（§3.2）。 */
export type OperatorDomain =
  | "叙事者定位"
  | "情感体验"
  | "文学风格"
  | "故事内容"
  | "叙事技巧";

// ─────────────────────────────────────────────────────────────────
// 2. 组件② 叙事模板（template.json，§4.2c）
// ─────────────────────────────────────────────────────────────────

/**
 * 世界观（三部分，§4.2c 第 6 点，对齐 rpg 管线三个独立步骤 worldview / scene_plan / item_database）。
 */
export interface TemplateWorldview {
  /** ① 世界观设定（→ NarrativeContext.worldview_structure / core_settings）。 */
  setting: string;
  /** ② 主要场景结构（→ NarrativeContext.scene_map）。 */
  scene_structure: string;
  /** ③ 道具清单（→ NarrativeContext.item_database / item_lore）。 */
  item_inventory: string;
}

/** 角色（含弧光）+ 角色关系（§4.2c；关系图谱细节由第八章 KAG 承载）。 */
export interface TemplateCharacter {
  name: string;
  /** 角色信息（身份/性格/背景概述）。 */
  profile: string;
  /** 角色弧光（→ 对齐 CharacterSheet.arc 概念）。 */
  arc?: string;
  /** 与其他角色的关系（KAG 关系图谱的来源之一）。 */
  relationships?: Array<{
    target: string;
    relation: string;
    detail?: string;
  }>;
}

/**
 * 故事结构（剧情树）维度（§4.2c / §4.3）。
 * 在"节/最小叙事单元"层展开为剧情树，直接对齐 `01_story-tree-and-screenplay.md` 成熟模型。
 * 上层节点只保留拓扑画像（节点/边数量与位置），底层单元展开为完整 {@link PlotTree}。
 */
export interface TemplateStoryStructure {
  /** 剧情树拓扑画像：各类型节点的数量与位置、边连接关系，构成该单元的拓扑形态。 */
  topology: PlotTreeTopology;
  /** 最小叙事单元层：完整剧情树（含每节点正文锚点）。上层节点可缺省。 */
  plot_tree?: PlotTree;
}

/** 核心要素（§4.2c，对齐 summary §6 的 subject/theme/literature_style/emotion_experience）。 */
export interface TemplateCoreElements {
  /** 题材。 */
  subject: string;
  /** 主题。 */
  theme: string;
  /** 核心冲突。 */
  core_conflict: string;
  /** 文学风格。 */
  literature_style: string;
  /** 情感体验。 */
  emotion_experience: string;
}

/**
 * 聚合 summary（§4.2c 关键字段）——**由下至上递归聚合的输入来源**。
 * 探查确认对齐现有提取管线的 `chapter_summaries{unit_id,scene,characters,events}`：
 * 底层节点产出 summary → 上层节点据 N 条下层 summary 聚合出本层 template + 上层 summary。
 */
export interface TemplateSummary {
  /** 主要出场角色。 */
  characters: string[];
  /** 主要场景与道具。 */
  scene: string;
  /** 事件（人物·情景·动机·行为·结果）。 */
  events: string;
}

/**
 * 叙事模板（template.json）——四大维度 + 一个聚合 summary（§4.2c）。
 * 粗细随层级变化：顶层粗（全局世界观/主题），底层细（具体剧情树/对白）。
 */
export interface NarrativeTemplate {
  worldview: TemplateWorldview;
  characters: TemplateCharacter[];
  story_structure: TemplateStoryStructure;
  core_elements: TemplateCoreElements;
  /** 递归聚合的输入来源（每个叙事单元一条）。 */
  summary: TemplateSummary;
}

// ─────────────────────────────────────────────────────────────────
// 3. 剧情树模型（§4.3，对齐 01_story-tree-and-screenplay.md，全字段 camelCase）
// ─────────────────────────────────────────────────────────────────

/** 节点结构维度（由入度/出度推导、可多重）。 */
export type PlotNodeType = "start" | "end" | "pivot" | "merge" | "normal";

/** 边事件（由两端节点度数推导）。 */
export type PlotEdgeEvent = "continue" | "merge" | `choose.${string}`;

/** 结局二维（§4.3）。 */
export type EndingType = "good" | "neutral" | "bad" | "open";
export type EndingPosition = "early" | "mid" | "final";

/** 剧情树节点（最小叙事单元层）。 */
export interface PlotTreeNode {
  /** DFS 单调递增编号 `<场号>.<场内序号>`（§4.3 编号 + 场号同步律）。 */
  id: string;
  /** 所属场号（纯数字）。 */
  sceneId: string;
  title?: string;
  /** 节点类型（可多重，如 ["merge","pivot"]）。 */
  nodeTypes: PlotNodeType[];
  /** 上游节点 id（入度 = prevNodes.length；root 为空）。 */
  prevNodes: string[];
  /** 下游链接（出度 = nextNodes.length）。 */
  nextNodes: PlotTreeEdge[];
  /** 分支提问（仅 pivot）。 */
  question?: string;
  /** 分支选项（仅 pivot）。 */
  options?: PlotChoiceOption[];
  /** 结局类型（仅含 end 时给）。 */
  endingType?: EndingType;
  /** 结局位置（仅含 end 时给）。 */
  endingPosition?: EndingPosition;
  isMainLine?: boolean;
}

export interface PlotTreeEdge {
  to: string;
  event: PlotEdgeEvent;
  label?: string;
  condition?: string;
}

export interface PlotChoiceOption {
  label: string;
  text: string;
  leadsTo: string;
  cost?: string;
}

/**
 * 剧情树拓扑画像——"故事结构"维度在微观层的精确表达，也是改编可定位的对象（§4.3）。
 */
export interface PlotTreeTopology {
  nodeCount: number;
  startCount: number;
  endCount: number;
  pivotCount: number;
  mergeCount: number;
  /** 各类结局数量统计。 */
  endingCountsByType?: Partial<Record<EndingType, number>>;
  /** 框架形态（对齐 NarrativeContext.GlobalControlParams.framework_type）。 */
  shape?: "linear" | "dual_climax" | "multi_thread" | "nested" | "spiral";
}

export interface PlotTree {
  nodes: PlotTreeNode[];
  entryNodeId: string;
  topology: PlotTreeTopology;
}

// ─────────────────────────────────────────────────────────────────
// 4. 组件①+三件套：叙事层级树节点（§4.2）
// ─────────────────────────────────────────────────────────────────

/** 处理状态机（§4.4c / §6.4，落 metadata.json）。 */
export type ProcessingStatus =
  | "archived"        // 已归档（_original）
  | "processing"      // 标准化中（_processing）
  | "standardized"    // 标准化完成、层级树已落盘、等待裁剪范围确认（阶段门，半自动）
  | "awaiting_scope"  // 同 standardized 语义别名：等待用户/agent 确认改编范围
  | "extracted"       // 已提取（_extraction_output）
  | "failed";

/** 改编状态（§4.4c，支持分阶段续改，类似 Git 跟踪已提交）。 */
export type AdaptationStatus = "未改编" | "改编中" | "已改编" | "已生成";

/**
 * 节点元数据（metadata.json，§4.2 / §4.4c）。
 * 元数据 + 处理/改编状态 + 统计 + 输出文件清单。
 */
export interface NodeMetadata {
  processing_status: ProcessingStatus;
  adaptation_status: AdaptationStatus;
  /** 关联的生成 run / output 引用（分阶段续改追溯）。 */
  related_runs?: string[];
  /** 统计信息（字数/节点数/算子数等）。 */
  stats?: {
    char_count?: number;
    unit_count?: number;
    operator_count?: number;
    [key: string]: number | undefined;
  };
  /** 该节点产出的落盘文件清单。 */
  output_files?: string[];
  created_at?: string;
  updated_at?: string;
}

/**
 * 叙事层级树节点（§4.2）——每个层级节点挂一套三件套。
 * 落盘时层级树本身是索引（§14.2 D4 按层分文件懒加载），三件套按节点目录存放（§6.1）。
 */
export interface HierarchyNode {
  /** 层级 id（树内唯一）。 */
  id: string;
  /** 层级类型。 */
  levelType: HierarchyLevelType;
  /** 序号（同层内顺序）。 */
  index: number;
  /** 标题（"叫法是实例"——按媒体取词，结构对齐）；保留为原始标题/文件名，作溯源源串。 */
  title: string;
  /**
   * 对外展示规范名（§3.1 锚定最小叙事单元）：`序号_《原始标题》`（如 `1_《第一章》`）；
   * root（complete）= `《题目》`（无序号）。展示/落盘命名一律以此为准，title 仅作溯源。
   */
  displayName?: string;
  /**
   * 根→自身的完整嵌套层级链（内部运行/定位用）：按文档序自顶向下，含 root 与自身。
   * 每项为轻量祖先描述，便于下游精确引用"本单元处于 部X>章Y>节Z"的位置。
   */
  lineage?: Array<{ id: string; levelType: HierarchyLevelType; index: number; displayName: string }>;
  /** 父节点 id（root 为 null）。 */
  parent: string | null;
  /** 子节点 id 列表。 */
  children: string[];
  /** 子层区间描述（如"第1-5章"，§3.1 嵌套关联）。 */
  childRange?: string;
  /** 原文字符区间（标准化全文内的 [start,end)），用于按单元切片正文与可追溯回链。 */
  sourceRange?: { start: number; end: number };

  // ── 三件套（每个文件夹必有；上层节点维度/算子可为聚合产物，缺省视为未提取）──
  /** template.json：组件② 叙事模板（维度档案）。 */
  template?: NarrativeTemplate;
  /** operators.json：组件③ 叙事算子（8 字段标准，按层提取，§3.2 三层提炼策略）。 */
  operators?: NarrativeOperator[];
  /** metadata.json：元数据 + 处理/改编状态 + 统计 + 输出清单。 */
  metadata?: NodeMetadata;
}

/**
 * NarrativeIpDna —— 一棵叙事层级树（骨架）+ 各节点三件套（§4.2）。
 *
 * 落盘形态（§6.1）：层级树本身是索引；三件套按节点目录存放。
 * 内存形态：`nodes` 以 id 为键的扁平索引（便于懒加载与父子遍历），`rootId` 指向顶层"完整内容"节点。
 */
export interface NarrativeIpDna {
  /** Schema 版本（§14.2 D5）。 */
  schema_version: string;
  /** 完整故事时间戳（主键，贯穿 input→output，§6.0）。 */
  story_id: StoryTimestamp;
  /** 标题（全局唯一，§6.5）。 */
  title: string;
  media_type: IpMediaType;
  /** 混合模态时的具体模态清单。 */
  modality?: Array<"text" | "image" | "video">;
  side?: IpSide;
  /** 顶层"完整叙事内容"节点 id。 */
  rootId: string;
  /** 层级树节点扁平索引（id → 节点）。 */
  nodes: Record<string, HierarchyNode>;
  /**
   * 层级结构类型（§3.2，迁移自 v6 structure_type，改造对齐四层抽象）。
   * 由 classifyStructureType 据树形深度确定性判定；供裁剪 UI 折叠与逐层聚合复用。
   */
  structureType?: HierarchyStructureType;
  /**
   * 逐层聚合次数（§3.3，迁移自 v6 aggregation_times）。
   * = 中间层数（root 之下到叶子的层数），驱动 Phase2 后序逐层聚合的轮数。
   */
  aggregationTimes?: number;
  /**
   * scoped 标记（§5.1 第③步）：本 IP DNA 是否为"某游戏单元"的 scoped 切片，
   * 以及它对应的游戏单元序号（来自 game_unit_plan）。
   */
  scoped_to_game_unit?: number;
}

// ─────────────────────────────────────────────────────────────────
// 5. 改编指令（§4.4 / §4.4b / §4.4c）
// ─────────────────────────────────────────────────────────────────

/**
 * 改编范围（adaptation_scope）= 第①步裁剪结果，嵌套格式（§4.4 第 2 点）。
 * 因层级嵌套关联，范围用"嵌套选择"表达（外层=部/卷，内层=章/节区间），裁剪出层级树的一棵连通子树。
 *
 * 表达为对层级树节点的选择项：每项指向一个节点，可选 childRange 限定其子层区间；
 * 递归 children 表达更深层的嵌套选择。整体即蓝图所述 `[[...],...],[...]...` 的结构化形态。
 */
export interface AdaptationScopeSelection {
  /** 选中的层级节点 id（leafRange 形态可省略,直接给最小单元闭区间）。 */
  nodeId?: string;
  /** 限定该节点下的子层区间（如 [1, 5] 表示第 1-5 章）；缺省=全选其子树。 */
  childRange?: [number, number];
  /**
   * 最小单元（叶子）闭区间 [start, end]（文档序），用于"每部=一个区间"的区间裁剪。
   * 与 nodeId/childRange 互斥使用：给 leafRange 时直接取文档序中该闭区间内的全部叶子。
   */
  leafRange?: { start: string; end: string };
  /** 更深层嵌套选择。 */
  children?: AdaptationScopeSelection[];
}

export interface AdaptationScope {
  /** 是否全量（默认全量时为 true，无需用户裁剪）。 */
  full: boolean;
  /** 嵌套裁剪选择（full=false 时给）。 */
  selections?: AdaptationScopeSelection[];
}

/** 游戏单元边界类型（§4.4b）。 */
export type GameUnitBoundary = "hard" | "soft";

/** 完整游戏模式（§3.1c / §4.6）。 */
export type GameMode = "single" | "series";

/**
 * 单个游戏单元（§4.4 / §4.6）。
 * 恒等关系：游戏单元 = 一棵剧情树；游戏叙事节点 = L2/P1；每单元剧情树 ≥ ≈25 节点。
 */
export interface GameUnit {
  /** 序号。 */
  index: number;
  /** 系列模式下所属"部"（对应 rpg L0 框架节点 / vn P0 幕节点）。 */
  partId?: string;
  /** 最小叙事单元范围（裁剪范围内的连续单元区间，以最小叙事单元为基础单位）。 */
  unitRange: { start: string; end: string };
  /** 边界类型：硬区间(部/卷/册不可跨) / 软区间(章内外可灵活切)。 */
  boundary: GameUnitBoundary;
  /** 目标复杂度档（喂 §4.6 管线节点控制）。 */
  targetComplexity?: number;
  /** 目标节点数（默认 ≥25，喂 vn 开放幕数 + 节点数量控制）。 */
  targetNodeCount?: number;
}

/**
 * 目标输出形态（target_output，§4.4d）——把"这次要做什么形态的游戏"变成一等契约，
 * 避免 IP 改编默认漂移到 rpg/design_auto（互动叙事产物缺席）。来源=叙事第二步 ROUTING；
 * 子仓库无对话时缺省 = 互动叙事(vn_full + tpl-vn-v2 + adv-interactive)，是 IP 改编旗舰场景。
 */
export interface TargetOutput {
  /** 目标品类编码（如 adv-interactive 互动电影/影游 / rpg-jrpg）。 */
  genre_code?: string;
  /** 目标管线模板（tpl-vn-v2 / tpl-rpg / ...）。 */
  pipeline_template?: string;
  /** 目标生成模式（vn_full / design_vn_full / design_auto / ...）。 */
  generation_mode?: string;
  /** 复杂度档（节点数/规模控制，对齐 §4.6 global_control_params）。 */
  complexity?: number;
}

/**
 * 游戏单元规划（game_unit_plan）= 第②步分配结果（§4.4 / §4.4b / §3.1c）。
 * 默认体量 ≈25 节点 / 25000 字 / 20 分钟；末单元 < 25 节并入前一单元。
 */
export interface GameUnitPlan {
  /** 完整游戏模式：单品(顶层即游戏单元) / 系列(部=游戏单元)。 */
  mode: GameMode;
  units: GameUnit[];
  /** 是否用户精确选填（覆盖默认体量与软硬区间）。 */
  userSpecified: boolean;
  /** 目标输出形态（§4.4d）：决定对接哪条生成管线；缺省 = 互动叙事(VN)。 */
  target_output?: TargetOutput;
}

/** 改编维度（dimensions）= 叙事层级数 + 叙事模板（§4.4 第 3 点）。 */
export interface AdaptationDimensions {
  /**
   * 叙事层级数（改哪些层/哪几个单元）——由 adaptation_scope 的嵌套选择确定。
   * 这里冗余记录选中的节点 id 便于消费。
   */
  levelNodeIds: string[];
  /**
   * 叙事模板（改哪些维度字段）——在 template.json 四大维度上定点。
   * 可细到具体字段（某角色/某场景/某情节点/某分支）。
   */
  templateFields: Array<
    | "worldview"
    | "worldview.setting"
    | "worldview.scene_structure"
    | "worldview.item_inventory"
    | "characters"
    | "story_structure"
    | "core_elements"
  >;
  /** 字段级定点（可选，进一步细化到具体子项，如某角色名/某情节点 id）。 */
  fieldTargets?: string[];
}

/**
 * 改编指令（adaptation_directive，§4.4）——IP DNA 上的结构化指令。
 * 由"改编范围 + 游戏单元规划 + 改编维度"构成（详见 §5.1 三步确认流程）。
 * 叙事算子不在改编指令内（§3.3）——算子随生成注入，不作为改编 target。
 */
export interface AdaptationDirective {
  story_id: StoryTimestamp;
  /** 第①步：裁剪范围。 */
  adaptation_scope: AdaptationScope;
  /** 第②步：游戏单元分配。 */
  game_unit_plan: GameUnitPlan;
  /** 改编维度（层级数 + 模板字段）。 */
  dimensions: AdaptationDimensions;
  /**
   * 作者自定义改编补充说明（§5.1「自定义补充」自由文本，可选）。
   * 承载作者对所选范围"想怎么改"的意图：下游据此分析改哪些维度并定点替换；
   * 为空＝忠实把原 IP 转化为目标品类叙事（不做额外维度改写）。
   */
  adaptation_notes?: string;
}

// ─────────────────────────────────────────────────────────────────
// 6. 三视角槽位 + 算子方案（§4.5 / §7.2 / §7.2b）
// ─────────────────────────────────────────────────────────────────

/** 三对象视角（§1.3 / §9）。视角是槽位层分组键，不是算子字段。 */
export type OperatorPerspective = "author" | "reader" | "character";

/** 算子来源（记在槽位/算子方案层，不进算子本体，§4.5）。 */
export type OperatorSource = "extracted" | "retrieved" | "generated";

/**
 * 提取层级（§3.2 三层提炼策略 + 全局贯穿）——决定该算子注入到"哪一级生成环节"（§3.1c/§4.6）。
 *   - top   顶层（完整叙事内容）：世界观/角色弧光/关系/情感/叙事者定位/表达 → worldview/logline/框架L0
 *   - mid   中层（章/部/卷/季）：文学风格/主题/整体情节/框架-节奏-策略/情节技巧 → 大纲L1/细纲L2/vn幕P0
 *   - leaf  底层（节/话/集/PLOT）：对白/独白/语气/局部情节/腔调 → 情节L3/剧本/分镜/vn情节点P1
 *   - global 全局贯穿（人称/认知/情感/关系/环境）：所有消费算子的环节贯穿注入
 */
export type ExtractionLayer = "top" | "mid" | "leaf" | "global";

/** 分层算子桶（§3.2）：一个游戏单元按提取层归好的算子池，供生成期按环节所属层取用。 */
export interface LayeredOperators {
  top: NarrativeOperator[];
  mid: NarrativeOperator[];
  leaf: NarrativeOperator[];
  global: NarrativeOperator[];
}

/**
 * 一个视角对某槽位的候选算子（§7.2 / §7.2b）。
 * 选取优先级：不与新需求冲突的提取算子 > 检索算子 > LLM 生成算子 >（冲突的提取算子作废）。
 */
export interface OperatorSlotCandidate {
  perspective: OperatorPerspective;
  operator: NarrativeOperator;
  /** 来源类型（不写进算子本体）。 */
  source: OperatorSource;
  /** 提取层来源（§3.2，哪一提取层的算子被注入本步；显式可查）。 */
  sourceLayer?: ExtractionLayer;
}

/**
 * 三视角算子槽位（§7.2）——同结构、视角不同；三视角各填一个算子（满员，不可缺失）。
 * 缺口由 LLM 生成兜底（source=generated，来源名复用 example/knowledge_location 填标题）。
 */
export interface OperatorSlot {
  /** 槽位名（如"对白算子""结构算子"）。 */
  slot_name: string;
  /** 三视角各一个候选（满员）。 */
  candidates: OperatorSlotCandidate[];
}

/**
 * 算子方案（operator_solution，§7.2b）——一步法"三视角同台"的产物。
 *
 * 落盘（§6.4）：每次消费算子的调用单独写一个 JSON 到
 *   `output/<时间戳>_<故事名>/算子方案/<节点>_operator_solution.json`
 * （文件名不带时间戳，外层目录已有）。
 *
 * slot_best_solution 重定义：不是预生成的单一算子，而是"生成调用内融合三视角形成的创作方针 + 产出"。
 */
export interface OperatorSolution {
  story_id: StoryTimestamp;
  /** 消费算子的生成节点标识（如 "rpg.plot.3" / "vn.beat.1.2"）。 */
  node: string;
  /** 本次调用涉及的三视角满员槽位（含 generated 算子全文 + 各算子 source）。 */
  slots: OperatorSlot[];
  /** 阶段A：综合三视角形成的创作方针 / 导演笔记。 */
  creative_directive: string;
  /** 阶段B：采纳/取舍说明（each_operator_uid → 如何被采纳/取舍）。 */
  adoption_notes?: Record<string, string>;
  /** 本步声明消费的提取层（§3.2，显式记录"哪些层→本步"）。 */
  step_layers?: ExtractionLayer[];
}

/**
 * 三视角张力预检结果（§7.2b 廉价预检，常态零额外 LLM 调用）。
 * 用算子 adaptation{type,element} / knowledge_domain 标签或向量相似度判断是否对冲。
 */
export interface PerspectiveConflictCheck {
  hasConflict: boolean;
  /** 对冲描述（如"节奏:慢 vs 快"）。 */
  detail?: string;
}

/** 默认冲突优先级（§7.2b）。生成提示词据此在阶段A裁决并记录取舍。 */
export const DEFAULT_CONFLICT_PRIORITY: ReadonlyArray<string> = [
  "与用户改编需求一致",
  "角色合理性/不吃书",
  "读者体验",
  "作者技法/风格",
];

// ─────────────────────────────────────────────────────────────────
// 7. 用户资产参考清单（§6.2）
// ─────────────────────────────────────────────────────────────────

/**
 * 用户资产参考清单（§6.2）——记录"用户提交了什么"。
 * 双重身份：① 后端中间产物（驱动 Phase1 处理）；② 未来资产库前端的数据契约。
 */
export interface UserAssetManifest {
  /** 完整故事时间戳（主键）。 */
  story_id: StoryTimestamp;
  title: string;
  media_type: IpMediaType;
  modality: Array<"text" | "image" | "video">;
  side: IpSide;
  source_files: Array<{
    path: string;
    file_type: string;
    size: number;
    role?: string;
  }>;
  /** 初步组织方式判断（Phase0 粗判，Phase1 细化）。 */
  preliminary_structure?: {
    guessed_levels: string[];
    is_multipart: boolean;
    is_short: boolean;
  };
  processing_status: ProcessingStatus;
  created_at: string;
}
