// 类型导入（编译期擦除，不引入运行时依赖边）。
import type { AgentLifecycle } from "../pipeline/core/agent-contract.js";

/**
 * 初步方案的结构化大纲（替代原 Markdown 文本）。
 * 下游步骤通过 JSON.stringify 将其转为 LLM 上下文；
 * 前端按需渲染为可读文本。
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

/**
 * 上传剧本元数据 + 原文。
 *
 * 设计动机：之前 user_input 既装"用户在输入框写的口头需求"又装"上传剧本全文"，
 * 5000 字截断后剧本被砍掉一大半，且各步骤无法区分两者。
 *
 * 这一字段把"上传剧本"独立出来：
 *   - content     原文（mammoth 解析后的 .docx / utf8 .txt；前端保留二进制由后端解析）
 *   - format      script-format-detector 识别出来的格式（json/fountain/markdown/dialogue/prose）
 *   - char_count  字符数，用于 resolveTargetActs 兑底（长篇 → 多幕）
 *   - file_name / size / mime  仅用于存档和 UI 显示
 *
 * 各 step prompt 同时引用 user_input（口头需求）+ uploaded_script.content（剧本素材），
 * 实现"忠实素材原文 + 满足用户额外要求"的双重契约。
 */
export interface UploadedScript {
  content: string;
  format: "json" | "fountain" | "markdown" | "dialogue" | "prose";
  char_count: number;
  estimated_word_count?: number;
  file_name?: string;
  size?: number;
  mime?: string;
  /** detector 给的人类可读说明，可直接拼到 prompt 里 */
  description?: string;
}

export type ContentLocale = "en" | "zh";

/**
 * 三轴路由选择（PRD v1.4 §3.2.2）。
 *
 * 第四轴「游戏品类」不在这里 —— 它由所选叙事策划专家隐式确定，走
 * tier_detection / demand_analysis 的 genre_code。四轴合起来喂提示词的 strategy 段。
 */
export interface NarrativeAxesSelection {
  /**
   * 游戏品类 code，见 knowledge/genre-taxonomy.ts。
   *
   * 与另外三轴放在一起注入，是因为策略段的四个子槽要同时可用：品类专家管线里没有
   * demand_analysis / tier_detection 这类检测步，光靠 ctx 里的检测结果取品类会一直是空，
   * 品类策略卡就永远装不进提示词。选定专家时品类已经确定，直接随配置带进来即可。
   */
  genre?: string | null;
  /** 叙事类型 code，见 knowledge/narrative-axes/story-types.ts */
  storyType?: string | null;
  /** 叙事题材 code，见 knowledge/narrative-axes/story-themes.ts */
  storyTheme?: string | null;
  /** 叙事结构 code：三轴综合推导的结论，或用户显式指定 */
  structure?: string | null;
}

export interface NarrativeContext {
  user_input: string;
  /** 三轴路由选择，运行开始时由 PipelineConfig 注入；缺省表示未换轴的旧条目。 */
  narrative_axes?: NarrativeAxesSelection;
  /** UI locale for generated narrative content (en/zh). Injected from PipelineConfig at run start. */
  content_locale?: ContentLocale;
  /**
   * 前端选定的有效复杂度档位（1-5）。由 pipeline.run 从 PipelineConfig.complexity 注入，
   * 供不跑 preference_analysis（即 global_control_params 为空）的管线（如 tpl-vn-v2）读取节点预算。
   * RPG 仍以 global_control_params.complexity 为权威，此字段仅作兜底来源。
   */
  complexity?: number;
  uploaded_script?: UploadedScript;
  user_preference_summary?: string;
  user_preference_analysis?: PreferenceAnalysis;
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
  item_database?: GameItem[];
  quest_graph?: QuestGraph;
  /** 百科娘（2.3.20）检索总结：目标作品/史实的资料汇编，供下游席位当"外部事实"引用。 */
  encyclopedia_doc?: EncyclopediaDoc;
  player_name?: string;
  global_control_params?: GlobalControlParams;

  // ── IP DNA（输入理解产物，A 套数据，§4.1）──
  // narrativeIpDna 与上述生成字段（B 套数据）并列；A 经双向映射喂入 B。
  // 类型见 ./narrative-ip-dna.ts（NarrativeIpDna = 叙事层级树 × 三件套）。
  narrativeIpDna?: import("./narrative-ip-dna.js").NarrativeIpDna;
  /** 改编指令（§4.4）：改编范围 + 游戏单元规划 + 改编维度。 */
  adaptation_directive?: import("./narrative-ip-dna.js").AdaptationDirective;
  /** 用户资产参考清单（§6.2）。 */
  user_asset_manifest?: import("./narrative-ip-dna.js").UserAssetManifest;
  /** 全局故事/项目标题（§6.5），策划 D0 或叙事首阶段生成，全局传递。 */
  story_title?: string;
  /** 完整故事时间戳（§6.0），贯穿 input→output 的同一主键。 */
  story_timestamp?: import("./narrative-ip-dna.js").StoryTimestamp;
  /** KAG 关系网络注入简报（§8）：角色关系/场景子图压缩文本，供生成节点保持一致性。 */
  relation_network?: string;

  // 策划管线数据 (D0-D4)
  demand_analysis?: import("./game-design.js").DemandAnalysis;
  core_concept?: import("./game-design.js").CoreConcept;
  system_architecture?: import("./game-design.js").SystemArchitecture;
  system_details?: import("./game-design.js").SystemDetails;
  value_framework?: import("./game-design.js").ValueFramework;
  game_design_context?: import("./game-design.js").GameDesignContext;
  narrative_requirements?: import("./game-design.js").NarrativeRequirements;

  // 影游叙事 v2 管线产出（tpl-vn-v2，9 步专属）
  vn_logline?: VnLogline;                       // E1-01
  /** VN 目标幕数（§4.6 开放幕数）：由复杂度/目标节点数派生（resolveVnActCount）；缺省 3 幕。 */
  vn_target_act_count?: number;
  /** 章→幕锚定映射（P1-1，IP 改编专用）：幕数=源单元数，每幕锚定源单元供密度展开；普通 VN 无此字段。 */
  vn_unit_act_map?: VnUnitActMap;
  vn_outline_acts?: VnOutlineActs;              // E1-02 (开放幕数，默认三幕)
  vn_character_bios?: VnCharacterBios;          // E1-02 (人物小传)
  vn_key_items?: VnKeyItems;                    // E1-02 (关键道具)
  vn_scenes?: VnScenes;                         // E1-03
  vn_beats?: VnBeats;                           // E1-04
  vn_script_normalized?: VnScriptNormalized;    // E2-01
  vn_segment_confirmed?: VnSegmentConfirmed;    // E2-02
  vn_branched_beats?: VnBranchedBeats;          // G-01
  world_state_ledger?: WorldStateLedger;         // G-01.5
  vn_screenplay?: VnScreenplay;                 // G-02
  vn_storyboard?: VnStoryboard;                 // G-03

  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────
// 影游叙事 v2 数据结构（与 MyFile/提示词/影游生成方案.md 对齐）
// 编号体系：场=<数字>，情节点=<数字>.<数字>，分镜=<数字>.<数字>-<数字>
// 三维场状态：location_name + time_of_day(日|夜) + indoor_outdoor(内|外)
// ─────────────────────────────────────────────────────────────────

/** E1-01 一句话故事梗概 */
export interface VnLogline {
  title: string;
  content: string;       // 五要素融合的一段叙述
}

/**
 * 幕↔源最小叙事单元锚定种子（§5.1b / P1-1，IP 改编专用）。
 * 让每一幕忠实对应源作章节（章→幕锚定），并把该源单元的事件脉络作为幕内密度展开的依据，
 * 从而修"E2 自由重切、只取 10-20 场丢弃大量原文"和"per-unit 提取被浪费"。
 * 仅在 IP 改编（有 scoped IP DNA）时由 orchestrator 构建并注入；普通 VN 无此字段、行为不变。
 */
export interface VnActUnitSeed {
  actIndex: number;          // 1-based 幕序
  actId: string;             // 汉字幕号 一/二/…
  sourceUnitIds: string[];   // 源最小叙事单元 id（通常 1 个；单元数超上限时按序分桶多个）
  title: string;             // 幕标题（源单元标题，或分桶合并标题）
  summary: string;           // 该幕对应源单元的事件脉络（供幕内密度展开）
  characters: string[];      // 该幕主要出场角色
  scene: string;             // 该幕主要场景
}
export interface VnUnitActMap {
  acts: VnActUnitSeed[];
}

/** 三幕剧本结构（act_id 用汉字 一/二/三） */
export interface VnOutlineActs {
  title: string;
  acts: VnAct[];
  central_theme?: string;
}

export interface VnAct {
  /**
   * 幕编号。历史上用汉字 一/二/三（固定三幕）；现已开放幕数（§4.6 VN 适配），
   * 类型放宽为 string，仍以汉字数字序列（一/二/…/十）表达，保持序号语义与向后兼容。
   */
  act_id: string;
  act_name: string;      // 建置/对抗/解决（或自定义）
  content: string;       // 五要素融合段落（150/300/150 字建议）
}

/** 人物小传 */
export interface VnCharacterBios {
  characters: VnCharacterBio[];
}

export interface VnCharacterBio {
  name: string;
  role: string;          // 主角/反派/配角…
  identity: string;
  external_motivation: string;   // 外驱
  internal_motivation: string;   // 内驱
  arc?: string;
  voice?: string;
  visual?: string;
}

/** 关键道具（E1-02 与三幕、人物小传同步产出） */
export interface VnKeyItems {
  items: VnKeyItem[];
}

export interface VnKeyItem {
  name: string;
  category?: string;             // 信物/武器/线索/契约物/媒介…
  description: string;           // 外形、来历、质感
  narrative_function: string;    // 在剧情中的作用（推动/转折/揭示/制约）
  bound_character?: string;      // 关联人物（与 character_bios.name 呼应）
  act_appearance?: ("一" | "二" | "三")[];  // 在哪几幕出现/起关键作用
  symbolism?: string;            // 象征意涵
}

/** E1-03 场（Scene）— 数字 ID + 三维状态 */
export interface VnScenes {
  scenes: VnScene[];
}

export interface VnScene {
  scene_id: string;                          // "1", "2", "3"…（纯数字字符串）
  act_id: string;                            // 幕编号（开放幕数，汉字数字序列）
  location_name: string;
  time_of_day: "日" | "夜";
  indoor_outdoor: "内" | "外";
  content: string;                            // 五要素融合段落
  is_main_line?: boolean;                     // 默认 true；G-01 改造后支线场为 false
  branch_origin_beat?: string;                // 支线起源情节点 ID（仅支线场用）
  /** 地点稳定 id（location_name → loc-N，供资产复用）。 */
  location_id?: string;
}

/** E1-04 情节点（Beat）线性版 — 尚未分支 */
export interface VnBeats {
  beats: VnBeat[];
}

export interface VnBeat {
  /**
   * 拓扑序标识（如 "b1"/"b2"）——故事结构由情节点 DAG 承载、不锚定场号。
   * 最终 `场.序` beat_id 由剧情树拓扑定稿后的确定性场号导出统一分配（§4.6c）。
   */
  beat_id: string;
  /** 简短标题（4-14 字概括，供剧情树节点标题位展示；区别于正文 content）。 */
  title?: string;
  content: string;                            // 五要素融合段落
  /** 所属幕（供场号导出时分组/校验；开放幕数，汉字数字序列）。 */
  act_id?: string;
  // 三维 staging（原来自场；现由情节点自身携带，供拓扑定稿后确定性导出场号）
  location_name?: string;
  time_of_day?: "日" | "夜";
  indoor_outdoor?: "内" | "外";
  /** @deprecated 场号改为派生；旧数据/E2 路径可能仍带，读时兼容、写时不再前置分配。 */
  scene_id?: string;
}

/** E2-01 用户剧本预处理（mode + raw + 推断的层级） */
export interface VnScriptNormalized {
  source_format: "json" | "fountain" | "markdown" | "dialogue" | "prose";
  inferred_layers: {
    has_acts: boolean;
    has_scenes: boolean;
    has_beats: boolean;
  };
  acts?: VnAct[];
  scenes?: VnScene[];
  beats?: VnBeat[];
  raw_segments?: Array<{ id: string; text: string }>;
}

/** E2-02 影游化文本段确认（截取 + 重新分幕的子剧本） */
export interface VnSegmentConfirmed {
  selected_range: { start: string; end: string };  // 起止 beat_id 或 scene_id
  acts: VnAct[];        // 重新分幕后的三幕
  scenes: VnScene[];
  beats: VnBeat[];
  preserved: boolean;   // true=已有原文一字不改；false=允许"二创"新增
  /**
   * E2 路径 character_bios：从截取段中抽取的人物小传。
   * E1 路径由 vn_outline_acts 同步产出 vn_character_bios；E2 路径跳过了 vn_outline_acts，
   * 必须在此处补出，否则 G-01 vn_branched_beats / G-02 vn_screenplay 会面对空角色清单。
   */
  character_bios?: VnCharacterBios;
  /**
   * E2 路径 key_items：从截取段中抽取的关键道具（与 E1-02 的 vn_key_items 对齐）。
   * 让 G-01/G-02 在两条入口下都能把"叙事硬抓手"喂入。原文无明显关键道具时可省略。
   */
  key_items?: VnKeyItems;
}

/** G-01 剧情树改造产物 — 含分支与多结局，beat 显式 prev/next + pivot_kind */
export interface VnBranchedBeats {
  acts: VnAct[];
  scenes: VnScene[];          // 含支线新增场（is_main_line=false）
  beats: VnBranchedBeat[];
  endings: VnEnding[];
  branch_summary?: {
    pivot_choice_count: number;
    pivot_branch_qte_count: number;
    ending_h_count: number;
    ending_b_count: number;
    ending_o_count: number;
  };
}

export interface VnBranchedBeat {
  /**
   * 剧情树阶段为**拓扑序稳定 id**（如 "b1"/"b7"）；经确定性场号导出后重写为最终 `场.序`（§4.6c）。
   * 下游（G-02/G-03/前端/落盘）只见导出后的 `场.序` 形态。
   */
  beat_id: string;
  /** 简短标题（4-14 字概括，供剧情树节点标题位展示；区别于正文 content）。 */
  title?: string;
  /** 场号——由确定性场号导出按三维状态分组后回填（LLM 阶段不产、留空/占位）。 */
  scene_id: string;
  content: string;
  /** 所属幕（供场号导出时派生 scene.act_id；LLM 逐 beat 回填，开放幕数汉字序列）。 */
  act_id?: string;
  // 三维 staging（场切分唯一依据；LLM 在剧情树阶段逐 beat 产出，供导出编场号）
  location_name?: string;
  time_of_day?: "日" | "夜";
  indoor_outdoor?: "内" | "外";
  /** 地点稳定 id（location_name → loc-N，场号导出时回填，供资产复用）。 */
  location_id?: string;
  prev_nodes: string[];                      // 上游 beat_id（root 为空）
  next_nodes: VnNextEdge[];                  // 下游链接（含 label/kind）
  is_main_line: boolean;
  is_ending: boolean;
  ending_label?: "H" | "B" | "O";            // 仅 is_ending=true 时给
  pivot_kind?: "choice" | "branch_qte";      // 该 beat 的判定类型（叶子可省）
  branch_origin_beat?: string;               // 该 beat 所在支线起源（main 为空）
  /**
   * 分支代价档（仅 pivot beat 给）——决定这组选项的"分支程度/代价量级"：
   *   - converge：路径不同、结果相同（一般犯错可改正，代价=绕远/损耗，各支走若干代价 beat 后汇回）
   *   - diverge ：路径天壤之别、结局不同（抉择真正分岔人生，长链不汇）
   *   - terminal：分支程度过大 → 直接走向结局（致命错误=局部 bad / 决定性正确=提前圆满）
   */
  branch_type?: "converge" | "diverge" | "terminal";
  /** 该 beat 的时空坐标（G-01 原生输出） */
  spacetime?: BeatSpaceTime;
  /** 该 beat 触发的世界状态变更（无变化的过渡 beat 可省略或给空数组） */
  state_deltas?: StateChange[];
}

export interface VnNextEdge {
  to: string;                                // 目标 beat_id 或 ending_id
  kind: "linear" | "choice" | "branch_qte" | "merge_back";
  label?: string;                            // UI 标签 A/B/C/D（choice 时）
  condition?: string;                        // 触发条件描述（可选）
}

export interface VnEnding {
  ending_id: string;                         // "END_H1", "END_B1"…
  label: "H" | "B" | "O";
  title: string;
  content: string;
  trigger?: string;
  /**
   * 结局作用域：
   *   - global：全局大结局（剧终，通常聚集在最后一幕的终极抉择之后）
   *   - local ：局部结局（中段触发的 game over / 提前圆满，如致命 QTE 失败）
   * 缺省视为 global（向后兼容旧数据）。
   */
  scope?: "local" | "global";
}

/** G-02 剧本（screenplay）— description + dialogue + 互动元件双轨 */
export interface VnScreenplay {
  beats: VnBeatScreenplay[];
  /** 部分场/子批生成失败时的降级告警（非致命；对应 beat 已用占位剧本保留拓扑） */
  warnings?: string[];
}

export interface VnBeatScreenplay {
  beat_id: string;
  scene_id: string;
  description: string;                       // ▲ 视觉动作（画面描写）
  dialogue: VnDialogueLine[];
  options?: VnChoiceOption[];                // 选项型 pivot（与 branch_qte 互斥）
  branch_qte?: VnBranchQTE;                  // 决策 QTE 型 pivot
  /** @deprecated 演出型 QTE 已全局停用（剧情完全靠决策推进）；保留字段仅为向后兼容历史数据，新生成不再产出 */
  performance?: VnPerformanceItem[];
}

export interface VnDialogueLine {
  kind: "dialogue" | "inner_monologue" | "narration" | "sfx";
  speaker?: string;                          // sfx/narration 可空
  text: string;
  emotion?: string;
}

export interface VnChoiceOption {
  label: "A" | "B" | "C" | "D";
  text: string;
  leads_to_beat: string;                     // 目标 beat_id
  cost?: string;                             // 取舍/代价描述
  persona_alignment?: string;                // 人设契合度提示
}

export interface VnBranchQTE {
  visual_action: string;                     // "3 秒内长按拉开衣柜"（未来 QTE 机制预留）
  duration_ms: number;                       // 限时毫秒数（未来 QTE 机制预留）
  /** @deprecated 路由统一由 options[].leads_to_beat 承载 */
  pass_leads_to_beat?: string;
  /** @deprecated 路由统一由 options[].leads_to_beat 承载 */
  fail_leads_to_beat?: string;
  /** @deprecated 文本统一由 options[].text 承载 */
  pass_text?: string;
  /** @deprecated 文本统一由 options[].text 承载 */
  fail_text?: string;
}

/** @deprecated 演出型 QTE 已全局停用；类型保留仅为兼容历史数据 */
export interface VnPerformanceItem {
  kind: "performance_qte" | "touch_hotspot";
  visual_action: string;
  duration_ms: number;
  success_effect: string;
  fail_effect: string;
}

/** G-03 分镜（storyboard）— 分镜挂在 beat 下 */
export interface VnStoryboard {
  storyboards: VnBeatStoryboard[];
  /** 部分场/子批生成失败时的降级告警（非致命；对应 beat 已用占位分镜保留拓扑） */
  warnings?: string[];
}

export interface VnBeatStoryboard {
  beat_id: string;
  shots: VnShot[];
  transition_in?: string;
  transition_out?: string;
  scene_prompt?: { zh?: string; en?: string };
}

export interface VnShot {
  shot_id: string;                           // "1.1-1", "1.1-2"...
  shot_type: "远" | "全" | "中" | "近" | "特";   // 中文景别
  camera_movement: string;                   // 静止/推/拉/摇/移/跟/升/降
  visual_content: string;                    // 画面内容描写
  dialogue_ref?: string[];                   // 对应 dialogue 行号
  sfx?: string;
  voice_over?: string;
  duration_sec: number;
  branch_qte_ref?: boolean;                  // 该镜头承载 beat.branch_qte 的呈现
  /** @deprecated 演出型 QTE 已停用；保留仅兼容历史数据 */
  performance_ref?: number;
  reuse_from?: string;                       // 复用镜头组 ID
  visual_prompt?: { zh?: string; en?: string };
}

// ─────────────────────────────────────────────────────────────────
// 世界状态快照系统（World State Snapshot）
// 用于追踪角色/道具/世界/剧情在每个情节点的状态变更，
// 为下游步骤提供精确的世界状态，防止"吃书"和状态漂移。
// ─────────────────────────────────────────────────────────────────

/** 情节点的时空坐标 */
export interface BeatSpaceTime {
  time: string;
  location: string;
}

/** 角色在某一时刻的完整状态 */
export interface CharacterState {
  name: string;
  psychology: {
    personality: string;
    persona_base: string;
    current_mood?: string;
  };
  physical: {
    body: string;
    attire: string;
  };
  power_level: string;
  relationships: Array<{ target: string; nature: string }>;
}

/** 道具在某一时刻的完整状态 */
export interface ItemState {
  name: string;
  location: string;
  acquired: boolean;
  durability: "permanent" | "multi_use" | "single_use" | "consumed";
  condition: string;
}

/** 单个状态变更事件 */
export interface StateChange {
  dimension: "time" | "location" | "character" | "item" | "world" | "plot";
  subject: string;
  attribute: string;
  from?: string;
  to: string;
}

/** 单个 beat 的时空坐标 + 状态变更声明 */
export interface BeatStateDelta {
  beat_id: string;
  spacetime: BeatSpaceTime;
  changes: StateChange[];
}

/** 世界状态账本（全树 + 基线） */
export interface WorldStateLedger {
  baseline: {
    spacetime: BeatSpaceTime;
    characters: CharacterState[];
    items: ItemState[];
    world_state: string;
    plot_state: string;
  };
  deltas: BeatStateDelta[];
}

/** 世界在某一时刻的完整快照（由 baseline + deltas 累积计算） */
export interface WorldSnapshot {
  spacetime: BeatSpaceTime;
  characters: CharacterState[];
  items: ItemState[];
  world: string;
  plot_progress: string;
}

export interface GlobalControlParams {
  complexity: number;
  deviation: number;
  target_structure?: TargetStructure | null;
  layer_controls?: LayerControls;
  framework_type?: FrameworkType;
  /** @deprecated use getEntropy(complexity) instead */
  entropy_budget?: number;
  /** @deprecated use deviation (continuous number) instead */
  deviation_direction?: "positive" | "negative" | "neutral";
}

export function deviationFromLegacy(
  gcp?: GlobalControlParams,
): number {
  if (gcp?.deviation !== undefined) return gcp.deviation;
  const dir = gcp?.deviation_direction;
  if (dir === "positive") return 0.5;
  if (dir === "negative") return -0.5;
  return 0;
}

export interface LayerControls {
  layer_0: LayerControl;
  layer_1: LayerControl;
  layer_2: LayerControl;
}

export type FrameworkType = "linear" | "dual_climax" | "multi_thread" | "nested" | "spiral";

export interface TargetStructure {
  l0_nodes: number;
  l1_per_parent: number;
  l2_per_parent: number;
  enable_branch: boolean;
  plot_length: number;
}

export interface PreferenceAnalysis {
  全局控制参数: GlobalControlParams;
  世界观维度: Record<string, SlotDimension>;
  框架层维度_L0: Record<string, SlotDimension>;
  大纲层维度_L1: Record<string, SlotDimension>;
  细纲层维度_L2: Record<string, SlotDimension>;
  层级调控参数: Record<string, LayerControl>;
}

export interface SlotDimension {
  slot_name: string;
  user_preference: string;
  description: string;
  search_keywords: string[];
  capacity: number;
  entropy_config: EntropyConfig;
  deviation_config: DeviationConfig;
}

export interface EntropyConfig {
  base_entropy: number;
  entropy_type: "conservative" | "balanced" | "creative";
  complexity_factor: number;
  branch_probability: number;
  detail_density: number;
}

export interface DeviationConfig {
  base_deviation: number;
  deviation_type: "emotional" | "structural" | "character" | "twist";
  deviation_direction: "positive" | "negative" | "neutral";
  deviation_intensity: number;
  anti_cliche_rules: string[];
}

export interface LayerControl {
  layer_name: string;
  entropy_inheritance: number;
  min_nodes: number;
  max_nodes: number;
  /** @deprecated deviation is now a global content-only param, not per-layer */
  deviation_inheritance?: number;
  /** @deprecated use deriveBranchProbability() deterministic calculation */
  branch_probability?: number;
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
  基础架构层: Record<string, Record<string, unknown>>;
  交互叙事层: Record<string, Record<string, unknown>>;
  核心规则?: Array<{ rule_id: number; rule_name: string; rule_content: string }>;
  /**
   * 全局 UI 风格基调（双语）。直接对应 kino-studio UIStyle.prompt：
   *   - 决定 UI 面板/按钮/字幕条/QTE icon 的视觉调性（赛博朋克/民国手绘/极简日漫…）
   *   - LLM 主动产出；缺失时由 normalizeWorldview 从时空背景/文化/科技槽位兜底合成
   */
  ui_style_prompt?: { zh?: string; en?: string };
  [key: string]: unknown;
}

export interface PlotSynopsis {
  synopsis_strategy: string;
  synopsis: string;
  highlight_analysis: string;
}

export interface FrameworkNode {
  node_id: string;
  content_id?: string;
  name: string;
  narrative_function: string;
  main_content: string;
  stage_type?: string;
  is_branch?: boolean;
  prev_node?: string[];
  next_node?: string[];
  sequence_index?: number;
}

export interface StoryFramework {
  framework: { nodes: FrameworkNode[] };
  dynamic_structure?: {
    structure_type: string;
    framework_nodes: FrameworkNode[];
    branch_groups?: Array<{ branch_at: string; branches: string[]; merge_at: string }>;
  };
}

/**
 * 剧情树上节点的功能位（结构席的核心产出之一）。
 *
 * 不管什么品类，剧情都是一棵剧情树，差别只在树的形态（由叙事策略的结构轴决定）。
 * 五种功能位是所有形态共用的原语：
 *   start   起始节点——一个游戏单元的入口
 *   branch  分支节点——玩家在此作答，之后走向分岔
 *   merge   聚合节点——多条分支在此收束回同一条主干
 *   ending  结局节点——本单元/全局的终点，不再有后继
 *   normal  普通节点——单入单出的推进
 *
 * 线性形态只用 start/normal/ending；树状形态四种齐用；碎片化形态大量 normal
 * 而几乎无 merge。形态由策略卡塑造，功能位的语义恒定。
 */
export type NodeFunction = "start" | "branch" | "merge" | "ending" | "normal";

/**
 * 分支 / 聚合 / 结局的触发条件（结构席在此落盘）。
 *
 * 结构层不写正文，但必须把"凭什么走这条路"说清楚，否则下游情节层只能瞎猜，
 * 任务层也无从把它转成玩家可执行的开启/完成条件。
 *
 * 条件**挂在边上而非节点上**（见 NodeEdge）：一个三选分支是三条边各带自己的条件，
 * 若挂在节点上就得再靠一个 related_nodes 数组去关联目标，多一层易错的对应关系。
 * 这一形制取自影游侧已验证的 VnNextEdge。
 */
export interface NodeCondition {
  /** 条件类型：玩家选择 / 状态阈值 / 持有物 / 前置节点已达成 / 无条件 */
  type: "choice" | "state" | "item" | "visited" | "always";
  /** 人类可读的条件描述，供情节层与任务层各自具体化 */
  description: string;
  /**
   * 走这条路要付的代价（取自影游 VnChoiceOption.cost）。
   * 有代价的选择才有分量；无代价的分支等于换套皮的同一条路。
   */
  cost?: string;
  /** 这个选择契合什么样的人设倾向（取自影游 VnChoiceOption.persona_alignment）。 */
  persona_alignment?: string;
}

/**
 * 剧情树的出边。
 *
 * kind 区分四种走向：linear 单线推进、choice 玩家抉择、merge_back 收束回主干、
 * ending 走向结局。merge_back 是关键一项——它让"聚合"成为边上的显式声明，
 * 而不是靠"入度大于一"事后推断出来的拓扑巧合。
 */
export interface NodeEdge {
  /** 目标节点 id（结局也是节点）。 */
  to: string;
  kind: "linear" | "choice" | "merge_back" | "ending";
  /** UI 标签（choice 时给 A/B/C/D）。 */
  label?: string;
  /** 走这条边的条件。linear 边通常省略（等价于无条件推进）。 */
  condition?: NodeCondition;
}

/**
 * 分支代价档——这组分岔的"分支程度"有多大（取自影游 VnBranchedBeat.branch_type）。
 *
 * 这是归档实现里最值得迁的一件设计：它逼着结构席在开分支时就想清楚后果量级，
 * 而不是铺一堆看着热闹、实则殊途同归的假分支。
 *   converge 路径不同、结果相同——一般失误可挽回，代价是绕远或损耗，走几个节点后汇回；
 *   diverge  路径天壤之别、结局不同——抉择真正分岔，长链不汇；
 *   terminal 分支程度过大——直接走向结局（致命错误或决定性正确）。
 */
export type BranchType = "converge" | "diverge" | "terminal";

/**
 * 结局分档（取自影游 VnEnding 的 label + scope）。
 *
 * scope 尤其要紧：中途的 game over 与全剧终是两回事。不分档的话，
 * 一个允许失败的游戏会因为"结局太多"被结构检查误判。
 */
export interface EndingSpec {
  /** H 圆满 / B 悲剧 / O 其他（开放、反转、隐藏）。 */
  label: "H" | "B" | "O";
  /** global 全剧终；local 局部结局（中途 game over、提前圆满）。 */
  scope: "local" | "global";
  /** 达成这个结局要满足什么。 */
  trigger?: string;
}

export interface OutlineNode {
  node_id: string;
  content_id?: string;
  parent_id: string;
  name: string;
  narrative_stage: string;
  prev_node: string[];
  next_node: string[];
  story_elements: {
    plot: { cause: string; process: string; result: string };
  };
  content: string;
  /**
   * 最优路径标记（席位 2.3.8「需要标记最优路径，即最符合用户需求的那一条链路」）。
   * 可选——线性形态（无分支）时全线即最优路径，无须逐点标注。
   */
  on_optimal_path?: boolean;
  /**
   * 本节点在剧情树上的功能位。可选：未标注时可由 prev_node/next_node 的入出度推断
   * （无入=start，无出=ending，多出=branch，多入=merge，其余=normal），
   * 显式标注的意义在于让"这里是让玩家作答的地方"成为结构席的主动决策而非拓扑副产品。
   */
  node_function?: NodeFunction;
  /**
   * 出边（带条件）。与 next_node 并存而非取代它：next_node 是所有下游消费者都在读的
   * 既有字段，edges 是它的带条件加强版。两者都在时以 edges 为准，结构检查会核对二者一致。
   */
  edges?: NodeEdge[];
  /** 本节点若是分支节点，这组分岔的代价档。 */
  branch_type?: BranchType;
  /** 本节点若是结局节点，它的分档与达成条件。 */
  ending?: EndingSpec;
}

export interface OutlinesGenerated {
  outlines: OutlineNode[];
}

export interface DetailedOutlineNode extends OutlineNode {
  story_elements: {
    plot: { cause: string; process: string; result: string };
    dialogue_hint?: string;
    monologue_hint?: string;
    narration_hint?: string;
    atmosphere?: string;
  };
}

export interface DetailedOutlinesGenerated {
  detailed_outlines: DetailedOutlineNode[];
}

export interface CharacterPersonalLife {
  likes?: string[];
  dislikes?: string[];
  habits?: string[];
  speech_pattern?: string;
  personal_item?: string;
  private_wish?: string;
  vulnerability?: string;
  independent_bonds?: Array<{
    name: string;
    relationship: string;
    detail: string;
  }>;
}

export interface CharacterSheet {
  name: string;
  label: "主角" | "NPC" | "Boss";
  race?: string;
  gender?: string;
  age?: string;
  occupation?: string;
  role_in_story?: string;
  description?: Record<string, unknown>;
  /**
   * 高密度立绘视觉提示词（双语）。中文版直接喂 GPT-Image-2/Midjourney/SD，
   * 英文版喂 SD/Flux/Imagen。LLM 主动产出；缺失时由 normalizeCharacter 兜底。
   * 与 kino-studio Character.prompt 字段对齐（kino 直接消费 zh）。
   */
  visual_prompt?: { zh?: string; en?: string };
  archetype_analysis?: Record<string, unknown>;
  psychological_drivers?: Record<string, unknown>;
  character_arc_spectrum?: string;
  relationships?: Record<string, unknown>;
  background_information?: string;
  personal_life?: CharacterPersonalLife;
  game_mechanics?: Record<string, unknown>;
  _is_player?: boolean;
  [key: string]: unknown;
}

// --- L3 情节层 ---

export interface PlotNode {
  node_id: string;
  content_id?: string;
  parent_id: string;
  content: string;
  story_elements: { plot: { cause: string; process: string; result: string } };
  /**
   * 剧本要素——**与品类无关**，键名 jrpg_ 是早期只有 JRPG 一条线时留下的历史包袱。
   * 它就是"情节描写 + 对话"的落盘形态：dialogue_segments 是对话，
   * narration_hints / scene_* 是描写与演出提示。影游、开放世界等品类同样填这里。
   *
   * 不改名是因为它是存量项目产物 JSON 的实际键，改名会让已落盘的 checkpoint 读不回来；
   * 收益仅止于观感，不值当。
   */
  jrpg_elements: {
    scene_location: string;
    scene_locations: string[];
    scene_characters: string[];
    /**
     * `kind` 是 C1（VN v2 吸收）新增的可选字段——区分对话／旁白／心声／音效，
     * 让这些原本只能各写一个独立数组（此处与 `narration_hints`）的内容能落在
     * 同一个按叙事顺序排列的数组里，不丢失交错顺序。归档的 `VnDialogueLine.kind`
     * 只有 dialogue/inner_monologue/narration/sfx 四类且专属影游；这里按
     * `ScriptContentItem.type`（L4 剧本层，已是品类无关设计）收窄取其中与"对白"
     * 语义重叠的子集，两层用同一套值域，读起来是一件事。可选是为了兼容存量
     * checkpoint（缺省按 "dialogue" 处理，见 `plot-generation.ts` 的 `normalizePlot`）。
     */
    dialogue_segments: Array<{
      speaker: string;
      text: string;
      emotion: string;
      kind?: "dialogue" | "inner_monologue" | "narration" | "sfx";
    }>;
    key_items: string[];
    narration_hints: string[];
    bgm_hint: string;
    camera_hint: string;
  };
  boundary_constraints: { cause: string; result: string };
  prev_node: string[];
  next_node: string[];
  narrative_stage: string;
}

export interface PlotsGenerated {
  plots: PlotNode[];
  plot_id_map: Record<string, string>;
}

// --- L4 剧本层 ---

export interface ScriptContentItem {
  type: "stage_direction" | "narration" | "dialogue" | "inner_monologue" | "player_action" | "system_message" | "branch_point";
  speaker?: string;
  text: string;
  emotion?: string;
  action?: string;
  subtext?: string;
}

export interface ScriptScene {
  /**
   * C1（VN v2 吸收）：不再由模型自由分配（曾是每章节内局部编号 "s1","s2"...，
   * 章节之间互不相干、也不保证可复现）。改由 `deriveDeterministicSceneNumbers`
   * （见 `pipeline/scene-numbering.ts`）按全篇场景顺序 + 三维状态确定性派生，
   * 场号从 "1" 起全局递增、绝不复用。
   */
  scene_id: string;
  location: string;
  atmosphere: string;
  camera_direction: string;
  bgm: string;
  /**
   * 三维 staging 中的两维（location 本身即第三维），可选——模型未给时场号派生
   * 退化为只按 location 分组，仍确定性、仍不复用，只是分组粒度更粗。
   */
  time_of_day?: "日" | "夜";
  indoor_outdoor?: "内" | "外";
  content: ScriptContentItem[];
}

export interface ScriptChapter {
  chapter_id: string;
  node_id: string;
  plot_node_id: string;
  chapter_type: "opening" | "rising" | "climax" | "falling" | "resolution";
  title: string;
  conflict: { type: string; tension_level: number; stakes: string; turning_point: string };
  character_arcs: Array<{ character: string; arc_phase: string; emotional_shift: string; growth: string }>;
  scenes: ScriptScene[];
  prev_node?: string[];
  next_node?: string[];
  is_branch?: boolean;
  narrative_stage?: string;
}

export interface JrpgScript {
  title: string;
  chapters: ScriptChapter[];
}

// --- L5 道具清单 ---

/**
 * 道具生命周期（席位 2.3.9 职责第二项）。
 *
 * 一件道具在剧情里的时间轴：什么时候到手、在哪些节点起作用、什么时候脱手、
 * 收场时在谁那儿。有了它，"吃书"这类问题才查得动——第 12 节点用掉的钥匙在第 8 节点
 * 就该已经拿到，而这件事此前没有任何字段记录，只能靠读全文推。
 *
 * 全字段可选：老 checkpoint 没有本结构，且叙事驱动、无道具系统的品类不该硬凑。
 */
export interface ItemLifecycle {
  /** 在哪个故事节点/场景到手。 */
  acquired_at?: string;
  /** 在哪些故事节点里起作用。 */
  used_at?: string[];
  /** 何时脱手、被夺或损毁；全程持有时为 null。 */
  lost_at?: string | null;
  /** 收场时它在哪儿 / 在谁手里。 */
  final_state?: string;
}

/**
 * 道具附属关系（席位 2.3.9 职责第三项）的一条。
 *
 * `initial_owner` / `related_character` 只能各记一个角色，而一件道具的牵连往往是
 * 多头的：属于某个势力、由某人锻造、与另一件道具成对、只在某地生效。这些关系是
 * 设定回收与吃书防范的判据来源，压成两个字符串字段就查不出来了。
 */
export interface ItemAffiliation {
  /** 关系的另一头：角色名 / 势力名 / 场景名 / 道具名。 */
  target: string;
  kind: "character" | "faction" | "scene" | "item";
  /** 关系本身，一句话说清（如"由其锻造"、"与之成对"、"仅在此地生效"）。 */
  relation: string;
}

export interface GameItem {
  name: string;
  category: string;
  rarity: string;
  description: string;
  effect: string;
  initial_owner: string | null;
  initial_scene: string;
  related_character: string | null;
  value: Record<string, number>;
  max_stack: number;
  read_content?: string;
  /** 席位 2.3.9 职责第二项：这件道具在剧情里的时间轴。 */
  lifecycle?: ItemLifecycle;
  /** 席位 2.3.9 职责第三项：与角色 / 势力 / 场景 / 其他道具的牵连。 */
  affiliations?: ItemAffiliation[];
}

// --- L5 任务系统 ---

/**
 * 任务数值（席位 2.3.10「数值系统在此落盘」）。
 *
 * 四类数值全部可选：老 checkpoint 没有本字段，叙事驱动、无数值系统的品类
 * （影游 / 叙事卡）也不该硬凑。模型只填它有依据能填的那几类。
 */
export interface QuestNumbers {
  /** 战斗数值：这场仗打给谁看、打多难 */
  combat?: {
    recommended_level?: number;
    difficulty?: "trivial" | "easy" | "normal" | "hard" | "boss";
    /** 强度依据：为何是这个档位（对标哪场战斗 / 玩家此时应有的能力） */
    rationale?: string;
  };
  /** 养成数值：完成后玩家变强多少 */
  growth?: {
    exp?: number;
    skill_points?: number;
    unlocks?: string[];
  };
  /** 经济数值：进出多少钱、耗材成本量级 */
  economy?: {
    currency_gain?: number;
    currency_cost?: number;
    rationale?: string;
  };
  /** 好感度：本任务改变了与谁的关系、改变多少 */
  affinity?: Array<{
    character: string;
    /** 正负增减值，量纲由品类自定，同一部作品内保持一致 */
    delta: number;
    reason?: string;
  }>;
}

export interface Quest {
  quest_id: string;
  name: string;
  type: "main" | "side" | "exploration" | "collection" | "challenge";
  description: string;
  story_node_id: string;
  chapter_id: string;
  framework_node: string;
  trigger: {
    type: "auto" | "npc" | "area" | "item" | "event" | "quest_complete";
    condition: string;
    npc?: string;
    scene?: string;
  };
  objectives: Array<{
    description: string;
    type: "talk" | "reach" | "collect" | "defeat" | "interact" | "explore" | "escort" | "custom";
    target: string;
    count?: number;
    optional?: boolean;
  }>;
  completion: {
    type: "auto" | "turn_in";
    condition: string;
    npc?: string;
    scene?: string;
  };
  rewards: {
    items?: Array<{ name: string; count: number }>;
    unlock?: string;
    description: string;
  };
  prerequisites: string[];
  next_quests: string[];
  numbers?: QuestNumbers;
}

export interface QuestGraph {
  quests: Quest[];
  main_quest_chain: string[];
  branch_quests: Record<string, string[]>;
}

// --- 场景层 ---

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
  parent_uid: string | null;
  parent_name: string | null;
  parent_level: number | null;
  scene_level: number;
  label: SceneLabel[];
  description: SceneDescription;
  story_units?: string[];
  /** @deprecated use scene_level */
  level?: number;
}

export interface SceneMap {
  world_name: string;
  scenes: SceneNode[];
  _phase1_skeleton?: SceneNode[];
  _phase1_by_layer?: {
    l0: { name: string; parent: string; level?: number; label?: unknown; description?: unknown }[];
    l1: { name: string; parent: string; level?: number; label?: unknown; description?: unknown }[];
    l2: { name: string; parent: string; level?: number; label?: unknown; description?: unknown }[];
  };
  _phase2_per_node?: Record<string, SceneNode[]>;
  _phase2_per_node_md?: Record<string, string>;
  _scene_structure_md?: string;
}

// --- Tier / Mode 路由系统 ---

export type TierId = "tier1" | "tier2" | "tier3" | "tier4";
export type ModeId =
  | "character" | "item_lore" | "scene" | "worldview"
  | "initial_outline" | "story_framework"
  | "story_outline" | "detailed_outline"
  | "novel" | "script" | "quest" | "full"
  | "narrative_card"
  | "tier2_enhanced" | "tier3_basic"
  // 新增叙事模式
  | "fragmented" | "emergent" | "narrative_auto"
  // 模板级专属叙事单品（卡牌 / 开放世界）
  | "card_narrative" | "open_world_narrative"
  // 策划+叙事联合模式
  | "design_auto" | "design_full_narrative"
  | "design_fragmented" | "design_emergent"
  | "design_only"
  // 影游 v2 专属入口（tpl-vn-v2）
  | "vn_full" | "design_vn_full"
  | "vn_script" | "vn_storyboard_mode";

export type StepOrGroup = string | string[];

export interface ModeConfig {
  id: ModeId;
  label: string;
  tiers: TierId[];
  steps: StepOrGroup[];
  showComplexity: boolean;
  isDynamic?: boolean;
  /**
   * B4: Mode 真实语义二元组。
   *
   *   pipeline_template: 此 mode 对应的管线模板形态
   *     - 决定步骤"长什么样"（RPG / VN / 开放世界 / 卡牌 / 叙事卡 / 轻量 / 碎片 / 涌现）
   *     - undefined 表示该 mode 不绑定特定模板（如 narrative_auto 由 needs 动态决定）
   *
   *   target_endpoint: 此 mode 在管线中"跑到哪一步停止"
   *     - 取值为 STEP_IDS 中的某个 step（如 "character_enrichment" / "outline_batch"）
   *     - undefined 表示跑到模板末尾
   *     - 对"单一产物"型 mode（item_lore 等）也有效，等价于"跑到那一步停"
   *
   * 字段语义虽与 steps[] 重叠，但显式化两个维度方便后续 PipelineTemplate × Endpoint 的任意组合，
   * 不再受限于现有 mode 列表枚举。UI 不变（用户看到的还是一个下拉）。
   */
  pipeline_template?: import("../pipeline/routing/templates.js").PipelineTemplateId;
  target_endpoint?: string;
}

export interface TierDetectionResult {
  tier: TierId;
  genre_code: string;
  genre_name: string;
  reasoning: string;
}

// --- Tier4 叙事卡 ---

// ─────────────────────────────────────────────────────────────────
// 百科娘（2.3.20 encyclopedia）
// ─────────────────────────────────────────────────────────────────

/** 一条资料条目。 */
export interface EncyclopediaEntry {
  /** 条目名（人物/地点/事件/术语/设定）。 */
  term: string;
  /** 该条目的准确信息与设定。 */
  detail: string;
  /**
   * 该条目的依据来自哪些来源（对应 EncyclopediaDoc.sources 的下标或 URI）。
   *
   * 无依据的条目应当**不写进来**而不是写空依据：百科娘的产品价值就是"准确"，
   * 一条没来源的设定混进资料汇编，下游会把它当外部事实用。
   */
  basis: string[];
}

/** 多源之间的冲突（检索到的说法不一致时如实登记，不擅自裁定）。 */
export interface EncyclopediaConflict {
  term: string;
  /** 各来源分别怎么说。 */
  claims: Array<{ claim: string; basis: string }>;
  /** 采信哪一说及其理由；无法判定则写明无法判定。 */
  resolution: string;
}

export interface EncyclopediaDoc {
  /** 检索目标（作品名 / 史实主题）。 */
  topic: string;
  /** 全局概述。 */
  summary: string;
  entries: EncyclopediaEntry[];
  conflicts: EncyclopediaConflict[];
  /** 用到的来源清单。本地源写文件名/字段名，网络源写 URI。 */
  sources: Array<{ kind: "local" | "web"; label: string; uri?: string }>;
  /**
   * 本次实际用到的通道。
   *
   * 必须落盘：联网通道只在直连 Gemini 的部署下可用（代理是 OpenAI 兼容口，
   * 表达不了 googleSearch 工具），退化成纯本地时读者要能看出来 ——
   * 否则一份凭模型记忆写的资料会与真检索来的长得一模一样。
   */
  channels: { local: boolean; web: boolean };
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

// --- Tier2 Lore 碎片 ---

export interface LoreFragment {
  id: string;
  type: "inscription" | "journal" | "npc_whisper" | "item_description" | "codex_entry";
  title: string;
  content: string;
  source_location?: string;
  related_characters?: string[];
  related_worldview?: string;
}

// --- Tier2/3 物品叙事 ---

export interface ItemLore {
  item_name: string;
  item_type: string;
  rarity: string;
  lore_text: string;
  flavor_text: string;
}

// --- Pipeline 进度 & 配置 ---

/**
 * announce 帧里的一段「同属一个专家的连续步骤」。
 * id/label 取席位管线本身（如 pl-narrative / 叙事管线（任务）），画布用它画容器标题。
 */
/** 组内的一段席位归属：这几步同属 2.3.x 的哪一席。 */
export interface AnnounceSeatGroup {
  id: string;
  name: string;
  steps: string[];
}

export interface AnnounceStepGroup {
  id: string;
  /**
   * 画布容器标题。用的是**专家显示名**（如「互动叙事专家」），不是管线内部名：
   * 用户拖进来的那张卡叫什么，生成后的容器就该叫什么。管线名另走 pipelineName。
   */
  label: string;
  steps: string[];
  /** 本组跑的是哪条席位管线（新架构四条之一，如 pl-film-game）。 */
  pipelineId?: string;
  /** 管线内部名（如「叙事管线（分镜）」），作为副标题/悬浮说明用。 */
  pipelineName?: string;
  /** 组内 step 的席位归属，供画布在卡上标注「这一步属于哪一席」。 */
  seats?: AnnounceSeatGroup[];
}

export interface PipelineProgress {
  stage: string;
  stepId?: string;
  step: number;
  totalSteps: number;
  /**
   * skipped：这一步因缺上游产物没有执行。
   *
   * 与 completed 分开是必须的——此前缺上游的步骤在函数体里直接 return，画布上
   * 照样点亮成"完成"，用户以为跑过了，实际零产物。见 `core/step-skip.ts`。
   */
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  message?: string;
  data?: unknown;
  /** status=skipped 时说明缺什么、该先跑谁（真值来自 core/input-provenance）。 */
  skipInfo?: {
    missing: string[];
    blockedBy: string[];
    hint: string;
  };
  nodeId?: string;
  nodeDone?: number;
  nodeTotal?: number;
  /**
   * Special event types:
   *   - "streaming": LLM streaming chunk update (uses chunk/accumulated)
   *   - "pipeline_steps_announce": (D4) the very first SSE frame, advertising
   *     the full ordered list of step IDs the run will execute, the chosen
   *     pipeline_template, and the effective complexity. The frontend uses
   *     this to initialise all step rows to "pending" before any progress
   *     event arrives, instead of guessing from hardcoded route tables.
   */
  type?: "streaming" | "pipeline_steps_announce";
  chunk?: string;
  accumulated?: string;
  /**
   * 本帧只是「运行横幅」，不对应任何 agent（如管线配置：报 Tier/Mode/总步数）。
   *
   * 画布据此判断"这一帧不该画成节点"，而不是去认 stepId 字符串——
   * 元帧的名单只有后端知道，前端硬编码 id 就会随后端加减元帧而漂移。
   */
  meta?: boolean;
  // pipeline_steps_announce payload
  steps?: string[];
  /**
   * 步序里每个 step 的显示名（step id → 名称），真值来自 STEP_REGISTRY。
   *
   * 有了它，前端在任何一步开跑之前就能把待跑节点的标题写对，
   * 不必自带一份中文步名表去和后端对赌（对赌的结果就是后端改了名、画布还是旧名）。
   */
  stepNames?: Record<string, string>;
  /** 步序里哪些 id 只是运行横幅（见 BANNER_STEP_IDS）：画布据此不为它们建节点。 */
  metaSteps?: string[];
  /**
   * 步骤的专家归属。`steps` 是扁平步序，画布无从得知哪几步同属一个专家席位管线，
   * 只能把它们摊成一排同级节点；有了这个，画布才能把它们收进专家容器里逐个点亮。
   * 归属真值只在后端（narrative-pipelines.ts），故随 announce 一起下发而非前端猜。
   */
  stepGroups?: AnnounceStepGroup[];
  pipelineTemplate?: string;
  complexity?: number;
  /** @deprecated A1: derived from (tier, mode, genreCode). Kept for replay/log only. */
  routingMode?: "auto" | "semi" | "manual";
  /** A2-4: explicit genre_code (when frontend specified one). Empty in auto/semi mode. */
  genreCode?: string;
}

export type ProgressCallback = (progress: PipelineProgress) => void;

export interface PipelineConfig {
  apiKey?: string;
  proxyUrl?: string;
  proxyApiKey?: string;
  model?: string;
  fastModel?: string;
  maxRetries?: number;
  timeout?: number;
  onProgress?: ProgressCallback;
  onStepComplete?: (stepId: string, ctx: NarrativeContext) => void;
  /**
   * 叙事层级。三期起由 genreCode 派生，前端不再直接选；显式传值只在无 genreCode 时生效。
   */
  tier?: TierId;
  mode?: ModeId;
  /** 三轴路由选择；run() 会注入 ctx.narrative_axes 供提示词的叙事策略段装配。 */
  narrativeAxes?: NarrativeAxesSelection;
  /** 前端选定的复杂度档位（1-5，UI 上即「叙事体量」）；run() 会注入 ctx.complexity 供节点预算派生使用 */
  complexity?: number;
  autoDetectTier?: boolean;
  /**
   * A2-2: explicit genre code (e.g. "rpg-jrpg") from frontend selection.
   * When provided, the pipeline skips LLM detectGenre / detectTier and uses
   * the corresponding GenreEntry's tier + needs matrix directly.
   */
  genreCode?: string;
  resumeCtx?: NarrativeContext;
  /**
   * @deprecated Phase-2 M7: 线性前缀跳过。仅在缺 agentLifecycle 时兜底，
   * 并用于 resume 的提示文案。新路径请传 agentLifecycle。
   */
  resumeAfterStep?: string;
  /**
   * Phase-2 M7: per-agent lifecycle = resume 的事实源。
   * 提供时逐 agent 查 shouldSkipByLifecycle，支持跳过非连续的已完成步、
   * 以及只重跑失败的那一步。
   */
  agentLifecycle?: Record<string, AgentLifecycle>;
  /**
   * When true (default), the pipeline uses the Planner engine to determine
   * step sequence based on genre needs matrix. Set to false to use the
   * legacy static mode-based step list.
   */
  usePlanner?: boolean;
  /** UI locale — controls generated narrative text language (en/zh). */
  locale?: ContentLocale;
  /**
   * 自由编排的显式步序（画布上用户自己连的那条链）。
   *
   * 给了就**以它为准**，优先于 mode 路由与席位管线——这正是"自由编排"的含义。
   * 归一之前 /plan 认这个字段、/start 不认，于是画布能编排、点开始生成却静默跑预置管线，
   * 且不报错。比报错更糟的是这种：用户看到的预览是真的，跑出来的东西不是他编排的。
   *
   * 去重保序由 run() 负责，与 buildRunManifest 的 composition-driven 分支同口径。
   */
  requestedSteps?: string[];
  /**
   * 作者在编排面勾选启用的默认关席位 id（可选终点席与可挂载席都走这里）。
   *
   * 与 `requestedSteps` 是两件事：那个字段是"我自己连了一整条链"，这个是
   * "预置管线照跑，但多过一道打磨"。没有它，勾选一席就得让用户把整条链手工连一遍。
   */
  activateSeats?: string[];
  /**
   * 用户选中的自定义专属创作团队蒸馏产物。
   *
   * 只传 profile 本体而非团队 id：管线不该知道 profile 存在哪、怎么读——加载与鉴权
   * 归 API 层，管线只负责把它注入到对应席位（见 custom-team/injection.ts）。
   */
  customTeamProfile?: import("../custom-team/types.js").DistilledProfile;
}

// ── Step modification metadata (stored in checkpoint.step_meta, NOT in ctx) ──

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

export interface Checkpoint {
  ctx: NarrativeContext;
  step_meta?: Record<string, StepMeta>;
  lastCompletedStep?: string;
  tier?: TierId;
  mode?: ModeId;
  userInput?: string;
  completedSteps?: string[];
  /** Blueprint 快照（Blueprint 模式时由 runWithBlueprint 落盘，resume 时恢复） */
  blueprint?: import("../pipeline/blueprint/types.js").PipelineBlueprint;
}
