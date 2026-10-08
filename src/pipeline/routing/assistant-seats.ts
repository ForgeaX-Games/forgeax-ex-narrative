/**
 * assistant-seats.ts — 叙事单品助手「席位」注册表（编号 2.3.x 的单一事实源）
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么要有这一层
 * ─────────────────────────────────────────────────────────────────
 * 历史上 SSOT 是 STEP_REGISTRY：几轮迭代沉淀了 jrpg-v2 / vn-v2 / tier3-4 / 策划 D 链
 * 等多套管线的 step，同一件产品职责在不同模板下叫不同名字（宏观框架在 jrpg 叫
 * story_framework、在 vn 叫 vn_outline_acts），产品侧无从索引。
 *
 * 产品侧反过来定义：**席位是产品，step 只是它在某模板下的实现**。
 *   - 专家组（2.2）= 席位序列组成的预制工作流
 *   - 单品助手（2.3）= 席位本身，可被单独调用
 * 所以本文件立席位为一等公民。
 *
 * 老 step 的定位是**迁移期实现**，不是终态：每席的形态（四原型）、八段提示词填充
 * 矩阵与产出口径以 seat-spec.ts（即 agent 配置表的入码）为准，老 step 只
 * 提供「这件事以前怎么做的、哪部分机制知识还能用」。凡老实现与配置表冲突，改老实现。
 * 席位与老 step 名字对不上（宏观框架在 jrpg 叫 story_framework、在 vn 叫
 * vn_outline_acts）正是迁移期的表征，binding 表就是这层索引。
 *
 * ─────────────────────────────────────────────────────────────────
 * 与既有契约层的分工
 * ─────────────────────────────────────────────────────────────────
 *   AssistantSeat（本文件） 产品契约：这个助手对用户承诺什么、吃什么、产出什么类别
 *   NarrativeAgent          执行契约：怎么跑（原型/结构/连接能力/生命周期）
 *   StepDescriptor          实现细节：具体哪个函数、prompt、依赖
 *
 * 席位只声明「席位 → 席位」的典型上游与 runPolicy（能否独立起跑）；具体的起跑闸门
 * 字段随管线而变，由 resolveSeatRequiredFields 从实现反查，避免两份会漂移的事实源。
 *
 * ─────────────────────────────────────────────────────────────────
 * 硬不变量（测试守）
 * ─────────────────────────────────────────────────────────────────
 *   1. 20 席与编号 2.5.2–2.5.1 一一对应，featureId 唯一
 *   2. 每个已注册 step 必须且只能归属一个席位——不允许孤儿 step
 *   3. status=active 的席位至少有一条绑定；status=planned 的必须没有绑定
 */
import type { ModeId } from "../../types/index.js";
import { getStepRequiredInputs } from "../core/step-registry.js";
import type { PipelineTemplateId } from "./templates.js";

// ════════════════════════════════════════════════════════
// 一、席位类型
// ════════════════════════════════════════════════════════

/**
 * 席位五类。决定执行器形态与产物写回方式，是 kind 专属字段的判别标签。
 *
 *   generator    产出新产物，写 ctx 主字段（13 席，管线主干）
 *   validator    读已有产物 → 出检查报告，可选自动修正后回写（2 席）
 *   polisher     读已有产物 → **另存打磨分支**，主产物不动，由用户选哪版进下游（4 席）
 *   retriever    检索本地/网络资料 → 产出可检索文档，供其余席位引用（1 席）
 *   coordinator  把用户输入与四轴配置组织成下游可用的形状，**不落叙事产物**
 *
 * 前四类都以"产出哪一类叙事产物"为身份，所以 `contentType` 必然非空。协调席是唯一
 * 不产叙事产物的一类：它的成果是一份配置，进的是运行清单而不是内容库。这条分界让
 * "`contentType` 为 null"从一个说不清的例外变成协调席的定义性特征 —— 契约自检因此
 * 能两向都判（见 `assertSeatContractComplete`）。
 *
 * 用常量数组而不是直接写 union：`seats-projection.ts` 要把这套词渲染进前端模块源码，
 * 而类型在运行时不存在。从前那边手抄了一份同样的 union，后端加一档它不会跟着变。
 */
export const SEAT_KINDS = [
  "generator",
  "validator",
  "polisher",
  "retriever",
  "coordinator",
] as const;

export type SeatKind = (typeof SEAT_KINDS)[number];

/**
 * 单独调用这一席时，上游产物是软输入还是硬门槛。
 *
 * 同一批席位有两种消费方式：专家管线按预置步序串跑，单品助手被画布单节点或平台 chat
 * 直接 @。后者不保证用户按顺序来，所以每席必须明确表态：
 *
 *   independent      上游产物有就吃、没有就只靠 user_input 起跑。绑定 step 的
 *                    requiredInputs 必须为空或只含 user_input（契约测试守）。
 *   requires-upstream 没有上游产物这一席跑出来的东西没有意义，缺了就拦，并告诉
 *                    用户"需先运行【X 助手】"。绑定 step 必须有非空 requiredInputs，
 *                    且每个字段都能反查到产出它的席位。
 *
 * 与另两个易混字段的分界（详见 `docs/absorption-filter.md` 轴4）：
 *   `upstreamSeats`            典型上游，用于展示与排序，**不是**闸门
 *   `StepDescriptor.dependsOn` 排序依赖与重跑影响面，**不是**闸门
 *   `StepDescriptor.requiredInputs` 起跑闸门的唯一真值
 */
export type SeatRunPolicy = "independent" | "requires-upstream";

/**
 * 席位在某作用域下的实现绑定。
 *
 * agentIds 有序：长度 >1 表示该席位内部本身是一条 workflow
 * （产品侧原话「叙事单品如有前驱环节依赖，也是由 workflow 组成的 agent」）。
 *
 * 作用域二选一或都不填：
 *   templateId  该管线模板专属实现
 *   modeId      无专属模板、由运行模式决定的实现（如策划+叙事联合的 D 链）
 *   都不填      通用兜底，每席至多一条
 *
 * 解析优先级：modeId 精确 > templateId 精确 > 通用兜底。
 */
export interface SeatBinding {
  templateId?: PipelineTemplateId;
  modeId?: ModeId;
  agentIds: string[];
  /**
   * 本席在该作用域下没有独立 step，产物由另一席的 step 顺带产出（agentIds 必须为空）。
   *
   * 影游侧的典型形态：vn_outline_acts 是单步双输出，三幕骨架之外把人物小传与关键道具
   * 一并产出——角色档案席与道具清单席因此在影游线上"有产物、无实现"。这不是缺失，
   * 而是实现层的合并；照通用兜底再跑一遍 RPG 版的角色/道具步，只会产出与小传打架的第二套设定。
   */
  coveredBy?: string;
  /**
   * 该绑定只在此运行时条件成立时启用（agentIds 非空）。
   * 目前唯一取值 has_uploaded_script：影游 E2 上传剧本入口与 E1 原创入口互斥。
   */
  condition?: "has_uploaded_script";
  /** 该绑定为何这样接（尤其是与 step 历史命名不一致时），供后来者追溯。 */
  note?: string;
}

export interface AssistantSeat {
  /** 席位 id。与前端 composerCatalog 的 `engineer.<id>` 后缀同名。 */
  id: string;
  /** 席位编号，需求可追溯。 */
  featureId: string;
  name: string;
  kind: SeatKind;
  /**
   * 席位职责原文。改需求先改这里，再改实现——
   * 这是席位存在的理由，不是注释。
   */
  responsibility: string;
  /** active = 已有实现可跑；planned = 契约已立、实现待建。 */
  status: "active" | "planned";

  /**
   * 独立起跑能力。active 席必填，planned 席不填（还没有实现可谈起跑）。
   * 取值语义见 SeatRunPolicy。
   */
  runPolicy?: SeatRunPolicy;

  /**
   * 典型上游席位：本席通常接在谁后面，用于画布排序、上下游展示与落差登记。
   *
   * **不是闸门**。闸门只有一处真值：绑定 step 的 `requiredInputs`（由 `runPolicy`
   * 决定该不该非空）。这条分界是上一轮打架的根因——同一个"上游"概念曾同时被
   * 本字段、`dependsOn` 和自动派生的 `requiredInputs` 表达，三处漂移是结构性必然。
   *
   * 声明在席位层而非字段层，是因为同一职责在不同管线落到不同 ctx 字段
   * （故事结构在 jrpg 是 detailed_outlines_generated、在影游是 vn_branched_beats），
   * 只有「席位 → 席位」这层关系跨模板成立。具体字段由
   * resolveSeatRequiredFields 从实现反查。
   *
   * 只写主干上游，不抄「根据 A、B、C…」的完整枚举——那些多数是上下文参考。
   */
  upstreamSeats: string[];
  /** 由用户直接带入、不由任何席位产出的输入。 */
  externalInputs?: string[];
  /** 产物落到哪个内容类别（与前端 lib/contentTypes.ts 的 id 同名；无产物落盘为 null）。 */
  contentType: string | null;
  /**
   * 顺带产出、需要单独落盘的派生产物（STEP_FILE_MAP 里按字段名而非 step id 建的条目）。
   * 归类时和主产物同属本席位，否则它们会掉进"无类别"堆里。
   */
  derivedArtifacts?: string[];

  /**
   * 本席主实现的派生子步：跟着主实现一起跑，但不代表这一席。
   *
   * 与 `bindings` 里多列一个 agentId 的差别是**它说得出关系**。都塞进 agentIds 时，
   * "谁是这一席、谁是它的派生物"只能靠数组顺序猜；而"单独调这一席跑什么"要答得准，
   * 猜不行——情节席单独调应该跑情节生成，不该跑它的账本。
   *
   * 与 `alsoOwns` 的差别是它**真的会跑**：alsoOwns 只为让"每个 step 都有主人"成立，
   * 不进任何步序。
   *
   * 本席被 `coveredBy` 覆盖（产物由另一席顺带产出）时派生子步也不跑——主实现都没跑，
   * 派生物无从派生。
   */
  derivedAgents?: string[];

  /** 实现绑定；planned 席位为空数组。 */
  bindings: SeatBinding[];
  /**
   * 归属本席、但不参与任何解析路径的 agent：老形态、已被合并的步骤、
   * 或写好了却没接进任何模板的变体。存在的意义是让「每个 step 都有主人」
   * 这条不变量成立，从而任何新增 step 都无法悄悄成为孤儿。
   */
  alsoOwns?: string[];

  /** validator 专属：报告字段与是否自动修正。 */
  report?: { field: string; autoRepair: boolean };
  /**
   * polisher 专属：打磨的基准字段，产物原位写回它。
   *
   * 打磨是同形变换——进去一份剧本，出来还是那一份剧本的新一版，所以不另开字段。
   * 旧版在覆盖前存成版本快照（见 step-files 的 `INPLACE_TRANSFORM_STEPS`），
   * 下游用哪版由用户在前端选版本号。
   */
  branch?: { baseField: string };
  /** retriever 专属：检索来源与落盘文档字段。 */
  retrieval?: { sources: Array<"local" | "web">; outputField: string };
}

// ════════════════════════════════════════════════════════
// 二、20 席注册表
// ════════════════════════════════════════════════════════

/**
 * 席位与 step 的对应按**职责**判定，不按历史命名。两处刻意与旧绑定不同：
 *
 *   - 故事大纲席（2.5.8）= 宏观框架 → jrpg story_framework / vn vn_outline_acts；
 *     旧前端把它接到 outline_batch（L1 故事大纲），是被 step 中文名带偏了。
 *   - 分镜席（2.5.12）vn 侧 = vn_storyboard（G-03 分镜设计），
 *     而 vn_screenplay（G-02 剧本创作）属于故事情节席——「填充剧情树内容」。
 */
export const ASSISTANT_SEATS: readonly AssistantSeat[] = [
  {
    id: "entry_config",
    featureId: "2.5.0",
    name: "叙事生成配置助手",
    /**
     * 全表唯一的协调席。它的成果是一份配置 —— 需求、四轴、体量、管线编排，进的是运行
     * 清单而不是内容库，所以 `contentType` 为 null（见 `SeatKind` 的 coordinator 一档）。
     *
     * 归为 generator 会逼它编一个产物类别，而那个类别下永远不会有文件。
     */
    kind: "coordinator",
    responsibility: "将入口节点以助手的方式常驻，用以总起和统领整个任务和管线。",
    /**
     * planned：入口的**功能**早已在跑（需求输入、四轴选择、体量档位、管线编排都在
     * 画布的入口节点上），但它还不是一席"助手" —— 没有自己的 step、提示词与产物。
     * v4 §2.5.0 要的是把它做成常驻助手，那是一份实现工作，不是把现有 UI 改个名。
     *
     * 所以这里只立契约：前端据此可拖可 @、不可单跑。按 planned 席的规矩不声明
     * runPolicy 与上下游 —— 还没有实现可谈起跑。
     */
    status: "planned",
    upstreamSeats: [],
    contentType: null,
    bindings: [],
  },
  {
    id: "encyclopedia",
    featureId: "2.5.1",
    name: "百科娘",
    kind: "retriever",
    responsibility:
      "对用户想要体验的目标，无论是某一作品，抑或是相关历史事实，" +
      "都能够从本地或者网上检索、对比、分析，得出准确信息和设定。",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: [],
    contentType: "encyclopedia",
    retrieval: { sources: ["local", "web"], outputField: "encyclopedia_doc" },
    /**
     * 通用绑定、无作用域：本席检索的是外部资料，与品类/模板无关，任何管线都能挂。
     * 它不在四条席位管线的默认步序里——按需单独跑（自由编排拖它，或 2.4.2 蒸馏调它）。
     */
    bindings: [{ agentIds: ["encyclopedia_retrieval"] }],
  },
  {
    id: "req_list",
    featureId: "2.5.2",
    name: "需求清单助手",
    kind: "generator",
    responsibility:
      "对用户上传的内容进行提炼总结。如果是直接输入或标签选择，则总结即可；" +
      "如果上传的是文件，则直接提炼文件里的内容即可。（格式主要为叙事模板，以及叙事策略）",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: [],
    externalInputs: ["uploaded_files", "user_tags"],
    contentType: "requirement",
    derivedArtifacts: ["global_control_params"],
    bindings: [
      {
        agentIds: ["preference_summary", "preference_analysis"],
        note: "总结与分析是同一件产品职责的两步，合为一席内部 workflow。"
          + "C1（VN v2 吸收）：「有上传剧本时预处理+确认，取代自主创作」这条业务功能"
          + "已通用化进这两步的 composer（见 user-preference-summary.ts 的"
          + "uploadedScriptContext），不再需要归档的 tpl-vn-v2 专属绑定与运行时改图。",
      },
    ],
  },
  {
    id: "design_doc",
    featureId: "2.5.3",
    name: "策划文档助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单，规划关键设定，包括：叙事策略、一句话故事梗概、" +
      "重要事件、重要场景、关键角色、关键道具。",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: ["req_list"],
    contentType: "design-doc",
    derivedArtifacts: ["narrative_requirements"],
    bindings: [
      { agentIds: ["initial_plan"] },
      {
        modeId: "design_auto",
        agentIds: [
          "core_concept",
          "system_architecture",
          "system_detail",
          "value_framework",
          "design_doc",
        ],
        note: "策划+叙事联合模式的 D0-D4 链无专属模板，按运行模式挂。",
      },
    ],
    alsoOwns: [
      // 初步方案合并前的三段老形态，仅历史存档会命中
      "initial_outline",
      "core_settings",
      "plot_synopsis",
    ],
  },
  {
    id: "worldview",
    featureId: "2.5.4",
    name: "世界观设定助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档，构建世界观设定，包括：基础架构层" +
      "（时空背景、物理法则、生物生态、政治体制、经济系统、文化信仰、科技水平、势力组织）、" +
      "交互叙事层（历史脉络、核心冲突、主要人物、叙事入口）以及核心规则。",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: ["design_doc"],
    contentType: "worldview",
    bindings: [{ agentIds: ["worldview"] }],
  },
  {
    id: "character",
    featureId: "2.5.5",
    name: "角色档案助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定，设定角色档案，包括：" +
      "角色基础信息、角色弧光、角色关系。（待叙事生成完毕需二次校验）",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: ["worldview"],
    contentType: "character",
    bindings: [{ agentIds: ["character_enrichment"] }],
  },
  {
    id: "item",
    featureId: "2.5.6",
    name: "道具清单助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、角色档案，设定道具清单，" +
      "包括：道具基础信息、生命周期、附属关系。（待叙事生成完毕需二次校验）",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: ["worldview"],
    contentType: "item",
    derivedArtifacts: ["item_lore"],
    bindings: [{ agentIds: ["item_database"] }],
  },
  {
    id: "scene_list",
    featureId: "2.5.7",
    name: "场景列表助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单，" +
      "设定层级化、结构化的场景列表/场景树。（待叙事生成完毕需二次校验）",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: ["worldview"],
    contentType: "scene",
    bindings: [
      {
        agentIds: ["scene_plan"],
        note:
          "只做前向规划（从世界观推演清单）。旧 scene_generation 的后向提炼那半已迁"
          + "内容检查席的 scene_evidence 子步，见 _archive/scene/README.md。",
      },
      // C3（2026-08）已封存：tpl-open-world 的 region_design 绑定随实现本体搬进
      // `_archive/specialized/`，业务功能（区域地理/势力/危险等级/拓扑关联）
      // 吸收进设定集席的 lore_generation，形态差异交给 network.md 结构卡。
    ],
  },
  {
    id: "outline",
    featureId: "2.5.8",
    name: "故事大纲助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单、场景列表，" +
      "规划宏观故事框架和总体故事走向，为下一环节规划微观故事框架和详细故事走向" +
      "起到了提纲挈领的作用。（叙事策略在此落盘）",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: ["worldview"],
    contentType: "outline",
    bindings: [
      {
        agentIds: ["story_framework"],
        note: "宏观 = L0 故事框架；L1/L2 属微观，归故事结构席。",
      },
    ],
  },
  {
    id: "structure",
    featureId: "2.5.9",
    name: "故事结构助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单、场景列表、故事大纲，" +
      "规划微观故事框架和详细故事走向，为下一环节故事情节的落盘起到了详细指南的作用。" +
      "（叙事策略和剧情树在此落盘，但只有梗概等基础信息，具体内容在下游完善；" +
      "需要标记最优路径，即最符合用户需求的那一条链路）",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["outline"],
    contentType: "structure",
    bindings: [
      {
        agentIds: ["outline_batch", "detailed_outline"],
        note: "L1 故事大纲 + L2 故事细纲同属微观展开，合为一席内部 workflow。",
      },
      // C2（2026-08）已封存：tpl-vn 的 branch_tree 绑定（分支树落盘）随实现本体
      // 搬进 `_archive/vn-v1/`，其「剧情树落盘」职责由本席通用实现 + tree.md
      // 结构卡承接，详见该目录 README。
    ],
  },
  {
    id: "plot",
    featureId: "2.5.10",
    name: "故事情节助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单、场景列表、故事结构，" +
      "填充故事内容。（剧情树的内容在此填充，但只有梗概等基础信息，具体内容在下游完善）",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["structure"],
    contentType: "plot",
    /**
     * 账本折的就是本席节点声明的状态变更，所以归本席；独立成一步是因为情节生成分批
     * 并发，每批只看得见自己那几个节点，而账本要全树——排在生成之后，它才第一次有
     * 全树可看。
     */
    derivedAgents: ["state_ledger"],
    bindings: [
      { agentIds: ["plot_generation"] },
      // C2（2026-08）已封存：tpl-vn 的 dialogue_script 绑定随实现本体搬进
      // `_archive/vn-v1/`，业务功能吸收进 plot_generation。
      // C3（2026-08）已封存：tpl-emergent 的 emergent_event 绑定与 tpl-card-game 的
      // event_pool 绑定随实现本体搬进 `_archive/specialized/`，业务功能（事件模板/
      // 触发条件、运营事件池节奏与奖励）吸收进 plot_generation，形态差异交给
      // emergent.md / fragmented.md 结构卡。
    ],
  },
  {
    id: "quest",
    featureId: "2.5.11",
    name: "任务助手",
    kind: "generator",
    responsibility:
      "根据故事情节，规划任务树，设置任务的开启条件、实现步骤和完成条件。" +
      "（数值系统在此落盘，包括战斗数值、养成数值、经济数值、好感度系统）",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["plot"],
    contentType: "quest",
    bindings: [{ agentIds: ["quest_generation"] }],
  },
  {
    id: "storyboard",
    featureId: "2.5.12",
    name: "分镜助手",
    kind: "generator",
    responsibility: "根据故事情节，规划剧本分镜，设置剧情表演的美术效果。",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["plot"],
    contentType: "storyboard",
    bindings: [
      { agentIds: ["script_generation"] },
      // C2（2026-08）已封存：tpl-vn 的 cinematic_storyboard 绑定随实现本体搬进
      // `_archive/vn-v1/`，业务功能吸收进 script_generation。
    ],
    // 剧本+场景耦合成一步的变体，实现完整但当前未接进任何模板
    alsoOwns: ["script_scene_generation"],
  },
  {
    id: "narrative_card",
    featureId: "2.5.13",
    name: "叙事卡助手",
    kind: "generator",
    responsibility: "根据用户初始需求，对叙事要求极低的游戏品类直接进行叙事包装。",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: [],
    contentType: "narrative-card",
    bindings: [{ agentIds: ["narrative_card"] }],
  },
  {
    id: "codex",
    featureId: "2.5.14",
    name: "设定集助手",
    kind: "generator",
    responsibility: "根据用户初始需求，对叙事要求较低的游戏品类直接进行叙事包装。",
    status: "active",
    runPolicy: "independent",
    upstreamSeats: [],
    contentType: "codex",
    bindings: [
      { agentIds: ["lore_generation"] },
      // C3（2026-08）已封存：tpl-card-game 的 card_lore 绑定随实现本体搬进
      // `_archive/specialized/`，业务功能（势力体系、稀有度文本规则、风味调性）
      // 吸收进 lore_generation，形态差异交给 fragmented.md 结构卡。
    ],
  },
  {
    id: "structure_check",
    featureId: "2.5.15",
    name: "结构检查助手",
    kind: "validator",
    responsibility:
      "检查生成的结构是否正确并修正，包括：分支、聚合、结局节点的设置，以及节奏设置。",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["structure"],
    contentType: "structure-check",
    report: { field: "structure_check_report", autoRepair: true },
    bindings: [{ agentIds: ["structure_check"] }],
    // 生成步内部的修复钩子：跑在 L1/L2/L3 各层之后就地修连接、拆环、补悬挂分支。
    // 「检查并修正」里的修正由它们完成，席位的独立实现只负责通读出报告。
    alsoOwns: [
      "structure_validation_l1",
      "structure_validation_l2",
      "structure_validation_l3",
    ],
  },
  {
    id: "content_check",
    featureId: "2.5.16",
    name: "内容检查助手",
    kind: "validator",
    responsibility:
      "检查生成的内容是否正确并修正，包括：改编还原、创作忠实、逻辑自洽、吃书防范、" +
      "世界观适配、角色弧光适配、世界状态自洽、设定回收。",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["plot"],
    contentType: "content-check",
    /**
     * autoRepair: false —— 八项全是内容判断，同一个问题往往有多种改法，
     * 而且常常要回到上游重生成（世界观本身没交代清楚这类）。检查席顺手改文
     * 会把「哪里出了问题」这个信息埋掉，修由打磨四席或重生成承担。
     */
    report: { field: "content_check_report", autoRepair: false },
    /**
     * 两步：判定（20）在前，场景取证（20a）在后。
     *
     * 取证是本席的子步而不是独立席位——产物是证据不是作品，用户不会单独去"跑一次
     * 取证"。由来见 `_archive/scene/README.md`：这是旧 `scene_generation` 里方向为
     * reconcile 的那一半，在前向席位上永远等不到输入，搬到这里才跑得起来。
     *
     * 排在判定之后而非之前，是因为 content_check 并不读取证报告（八项判据全靠模型
     * 读正文得出），而席位的代表步（单跑打到 agentIds[0]）必须是判定本身——
     * 用户点"跑内容检查"要的是那份报告，不是场景名单。文件序号 20 / 20a 同此序。
     *
     * 此前它只登记在 alsoOwns 里，那个字段只影响产物归类、不进步序，于是这一步
     * 已注册、有实现、有文件名，却从来没被任何管线跑到过。
     */
    bindings: [{ agentIds: ["content_check", "scene_evidence"] }],
  },
  {
    id: "deai",
    featureId: "2.5.17",
    name: "去 AI 味助手",
    kind: "polisher",
    responsibility: "优化表达人机感并修正。",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["plot"],
    contentType: "deai",
    branch: { baseField: "plots_generated" },
    bindings: [{ agentIds: ["deai_polish"] }],
  },
  {
    id: "structure_optimize",
    featureId: "2.5.18",
    name: "结构优化助手",
    /**
     * generator，不是 polisher —— 这一条是本席存在的全部理由。
     *
     * v4 §2.5.18 的职责含「对节点的增删改查」，那是改图。而打磨席的契约明令只许改文字、
     * 不许改图（`polish-family.ts` 开头那段：拓扑是结构席的产出，下游任务/分镜/场景都按
     * 它对齐，一个打磨步顺手改了 next_node 会让整条下游对不上，且没有任何一步会报错）。
     *
     * 所以它不能挂在打磨机制上复用，得新建：同样读已有结构、同样写回结构，但允许重排
     * 拓扑，因此产物要过结构检查那一关，而打磨席的产物不必。
     */
    kind: "generator",
    responsibility:
      "优化生成的故事结构，在原有结构上对结构进行合理调整，包括对节点的增删改查。",
    status: "planned",
    upstreamSeats: [],
    contentType: "structure-optimize",
    bindings: [],
  },
  {
    id: "plot_refine",
    /**
     * 本席现在同时管内容与表达两层。情节润色助手（旧 `plot_polish`）已退役，职责按
     * v4 §2.5.19 的职责原文第二句并进来 —— 主表上本就只有这一行，两席是实现史的产物。
     *
     * 合并有个代价要照看：两层的自检标准原本互斥（优化席允许补内容，润色席要求事实
     * 一条不变）。所以提示词把它们排成先后两遍，而不是并列六条 —— 内容没到位就去雕
     * 句子，雕的是还会被改掉的那一版。
     */
    featureId: "2.5.19",
    name: "情节优化助手",
    kind: "polisher",
    responsibility: "优化生成的情节的人物刻画、剧情推进和环境描写。",
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["plot"],
    contentType: "plot-refine",
    branch: { baseField: "plots_generated" },
    bindings: [{ agentIds: ["plot_refine"] }],
  },
  {
    id: "playability",
    featureId: "2.5.20",
    name: "玩法适配助手",
    kind: "polisher",
    responsibility:
      "优化生成的分支剧情与选项之间的可玩度，例如让选项变得有意义，" +
      "分支能够真正起到推进剧情的作用。",
    /**
     * 转 active（v4 §2.5.20）。此前标 planned 的理由是"上下游口径未定"，而 v4 主表把
     * 职责定死成「让选项变得有意义、分支能真正推进剧情」—— 那是结构层的事，上游就是
     * 结构席，实现 `playability_adapt` 原位改写的也正是它的产物。口径已定，不必再挂在
     * `alsoOwns` 里靠"每个 step 都有主人"那条不变量保着。
     *
     * 上游是 `structure` 而不是 `plot`：另外三席打磨的是情节正文（`plots_generated`），
     * 本席动的是细纲里"玩家做的选择意味着什么"，基准字段是 `detailed_outlines_generated`。
     * 挂载点也跟着在结构席之后（见 `POLISH_ATTACHABLE`）—— 挂在情节席后面会让它去改一份
     * 情节已经照着写完了的细纲，改了也没人再读。
     */
    status: "active",
    runPolicy: "requires-upstream",
    upstreamSeats: ["structure"],
    contentType: "playability",
    branch: { baseField: "detailed_outlines_generated" },
    bindings: [{ agentIds: ["playability_adapt"] }],
  },
  {
    id: "narration",
    featureId: "2.5.21",
    name: "旁白解说助手",
    /**
     * polisher：它改的是同一份情节的叙述口吻，进去一份正文、出来还是那一份正文的新一版，
     * 所以原位写回 `plots_generated`，与另外四席共用打磨机制。
     *
     * 与去 AI 味（2.5.17）的差别在改什么：那一席去的是机器腔，本席调的是"谁在讲这个
     * 故事" —— 旁白解说驱动型叙事（解说体、纪录片式、第二人称）靠的是叙述者的存在感，
     * 而那与句子像不像人写的是两件事。
     */
    kind: "polisher",
    responsibility: "对于旁白解说驱动型叙事进行故事风格的优化。",
    status: "planned",
    upstreamSeats: [],
    contentType: "narration",
    branch: { baseField: "plots_generated" },
    bindings: [],
  },
] as const;

// ════════════════════════════════════════════════════════
// 三、产品意图 × 实现现状的已知落差
// ════════════════════════════════════════════════════════

/**
 * upstreamSeats 是产品意图；实现里的依赖图未必对得上。
 * 对不上的地方在这里逐条登记——每条都是一个明确的产品判断，不是遗漏：
 * 要么承认该品类天生没有这一环，要么它就是待补的接线。
 *
 * 测试双向校验：出现未登记的落差会红（防止悄悄漂移），
 * 登记了却已经不存在的条目也会红（防止清单变成陈年垃圾）。
 */
export interface SeatGraphDivergence {
  seatId: string;
  /** 绑定作用域：模板 id、模式 id 或 "通用"。 */
  scope: string;
  /** 该作用域下实际拿不到的上游席位。 */
  missingUpstream: string[];
  reason: string;
  /** true = 该品类本就不需要这一环；false = 待补的接线缺口。 */
  byDesign: boolean;
}

/**
 * C3（2026-08）已清空 plot 席两条：tpl-emergent 的 emergent_event 与 tpl-card-game 的
 * event_pool 绑定已随实现搬进 `_archive/specialized/`，plot 席现在只剩通用绑定
 * （plot_generation），其依赖闭包摸得到 structure，不再有登记价值的落差——
 * 见 `_archive/specialized/README.md`。
 */
export const KNOWN_SEAT_GRAPH_DIVERGENCES: readonly SeatGraphDivergence[] = [
  {
    seatId: "design_doc",
    scope: "design_auto",
    missingUpstream: ["req_list"],
    reason: "策划 D 链以核心概念为入口，需求提炼由策划侧自带。",
    byDesign: true,
  },
];

// ════════════════════════════════════════════════════════
// 四、查询
// ════════════════════════════════════════════════════════

const SEAT_INDEX: ReadonlyMap<string, AssistantSeat> = new Map(
  ASSISTANT_SEATS.map((s) => [s.id, s]),
);

export function getSeat(id: string): AssistantSeat | undefined {
  return SEAT_INDEX.get(id);
}

export interface SeatScope {
  templateId?: PipelineTemplateId;
  modeId?: ModeId;
  /** 是否满足 condition="has_uploaded_script" 的绑定（影游 E2 上传剧本入口）。 */
  hasUploadedScript?: boolean;
}

/** 该条件绑定在本作用域下是否启用。无 condition 的绑定恒启用。 */
function conditionHolds(binding: SeatBinding, scope: SeatScope): boolean {
  if (!binding.condition) return true;
  return binding.condition === "has_uploaded_script" && scope.hasUploadedScript === true;
}

/**
 * 席位在指定作用域下实际要跑的 agent 序列。
 *
 * 优先级：模式精确 > 模板精确 > 通用兜底。同一作用域内可有多条绑定，按声明顺序
 * 取第一条**条件成立**的——影游 req_list 就是靠这一点区分 E2（传了剧本）与 E1（没传，
 * 本席由 logline 覆盖）两种形态。
 *
 * 返回空数组有两种含义，都表示"本席不产生独立 step"：
 *   - 命中 coveredBy 绑定：产物由另一席的 step 顺带产出（影游的角色/道具/场景）；
 *   - 一条都没命中：该品类不设此席。
 * 关键是命中作用域绑定后**不再回落通用兜底**，否则影游会多跑一遍 RPG 版的角色与道具，
 * 产出与人物小传打架的第二套设定。
 */
export function resolveSeatAgents(seatId: string, scope: SeatScope = {}): string[] {
  const seat = SEAT_INDEX.get(seatId);
  if (!seat) return [];
  const pick = (match: (b: SeatBinding) => boolean): SeatBinding | undefined =>
    seat.bindings.find((b) => match(b) && conditionHolds(b, scope));

  if (scope.modeId) {
    const byMode = pick((b) => b.modeId === scope.modeId);
    if (byMode) return withDerived(seat, [...byMode.agentIds]);
  }
  if (scope.templateId) {
    const byTemplate = pick((b) => b.templateId === scope.templateId);
    if (byTemplate) return withDerived(seat, [...byTemplate.agentIds]);
  }
  const generic = pick((b) => !b.templateId && !b.modeId);
  const agentIds = generic ? [...generic.agentIds] : [];
  return withDerived(seat, agentIds);
}

/**
 * 派生子步接在主实现之后。主实现一个都没解析到时（coveredBy 或该品类不设此席）
 * 不追加：主实现没跑，派生物无从派生。
 */
function withDerived(seat: AssistantSeat, agentIds: string[]): string[] {
  if (agentIds.length === 0 || !seat.derivedAgents?.length) return agentIds;
  return [...agentIds, ...seat.derivedAgents];
}

/** 本席的主实现（不含派生子步）；用于回答"单独调这一席跑什么"。 */
export function resolveSeatPrimaryAgents(seatId: string, scope: SeatScope = {}): string[] {
  const derived = new Set(SEAT_INDEX.get(seatId)?.derivedAgents ?? []);
  return resolveSeatAgents(seatId, scope).filter((id) => !derived.has(id));
}

/** 本席在该作用域下由哪一席顺带产出；没有则返回 undefined。 */
export function seatCoveredBy(seatId: string, scope: SeatScope = {}): string | undefined {
  const seat = SEAT_INDEX.get(seatId);
  if (!seat) return undefined;
  const candidates = seat.bindings.filter((b) => conditionHolds(b, scope));
  const byScope =
    (scope.modeId ? candidates.find((b) => b.modeId === scope.modeId) : undefined) ??
    (scope.templateId ? candidates.find((b) => b.templateId === scope.templateId) : undefined) ??
    candidates.find((b) => !b.templateId && !b.modeId);
  return byScope?.coveredBy;
}

/** 反查：某个 agent/step 归属哪个席位。全局唯一，由测试守。 */
const AGENT_TO_SEAT: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const seat of ASSISTANT_SEATS) {
    const owned = [
      ...seat.bindings.flatMap((b) => b.agentIds),
      ...(seat.derivedAgents ?? []),
      ...(seat.alsoOwns ?? []),
    ];
    for (const agentId of owned) {
      if (!map.has(agentId)) map.set(agentId, seat.id);
    }
  }
  return map;
})();

export function getSeatForAgent(agentId: string): AssistantSeat | undefined {
  const seatId = AGENT_TO_SEAT.get(agentId);
  return seatId ? SEAT_INDEX.get(seatId) : undefined;
}

/**
 * 席位在指定作用域下的具体输入字段：取该席位实现链首个 agent 的输入契约。
 * 前端单跑一个助手时据此提示「还缺什么」。
 */
export function resolveSeatRequiredFields(seatId: string, scope: SeatScope = {}): string[] {
  const [first] = resolveSeatPrimaryAgents(seatId, scope);
  return first ? getStepRequiredInputs(first) : [];
}

/** 所有被席位登记的 agent id（用于孤儿 step 检测）。 */
export function boundAgentIds(): string[] {
  return [...AGENT_TO_SEAT.keys()];
}

/**
 * 契约自检：kind 专属字段齐全、状态与绑定自洽。
 * 抛错即表示席位声明本身不成立，应在启动/测试期暴露而非运行期。
 *
 * 收一个 seats 参数（缺省为全表），好让每条规则本身可以被单独验证。从前它只读全表，
 * 于是"规则写对了没有"无从回答：全表恰好合规时，一条写错方向的规则与一条正确的规则
 * 同样是绿的。加规则最怕的就是这个 —— 规则看着对、实际什么也没判。
 */
export function assertSeatContractComplete(
  seats: readonly AssistantSeat[] = ASSISTANT_SEATS,
): void {
  const problems: string[] = [];
  const seenFeatureIds = new Set<string>();
  const index = new Set(seats.map((s) => s.id));

  for (const seat of seats) {
    if (seenFeatureIds.has(seat.featureId)) {
      problems.push(`${seat.id}: featureId ${seat.featureId} 重复`);
    }
    seenFeatureIds.add(seat.featureId);

    if (seat.status === "active" && seat.bindings.length === 0) {
      problems.push(`${seat.id}: 标为 active 却没有任何实现绑定`);
    }
    if (seat.status === "planned" && seat.bindings.length > 0) {
      problems.push(`${seat.id}: 标为 planned 却已有实现绑定，应改为 active`);
    }
    if (seat.status === "active" && !seat.runPolicy) {
      problems.push(`${seat.id}: active 席必须声明 runPolicy（能否只带 user_input 独立起跑）`);
    }
    if (seat.status === "planned" && seat.runPolicy) {
      problems.push(`${seat.id}: planned 席不该声明 runPolicy——还没有实现可谈起跑`);
    }
    if (seat.status === "planned" && seat.upstreamSeats.length > 0) {
      problems.push(`${seat.id}: planned 席不该声明上游——上下游口径未定才标 planned`);
    }
    const generics = seat.bindings.filter((b) => !b.templateId && !b.modeId);
    if (generics.length > 1) {
      problems.push(`${seat.id}: 有 ${generics.length} 条通用绑定，解析会二义；请加作用域或移入 alsoOwns`);
    }
    if (seat.kind === "validator" && !seat.report) {
      problems.push(`${seat.id}: validator 席位缺 report 字段`);
    }
    if (seat.kind === "polisher" && !seat.branch) {
      problems.push(`${seat.id}: polisher 席位缺 branch 字段（打磨必须指明基准字段）`);
    }
    if (seat.kind === "retriever" && !seat.retrieval) {
      problems.push(`${seat.id}: retriever 席位缺 retrieval 字段`);
    }
    // contentType 两向都判。协调席的成果是一份配置，进运行清单、不进内容库，所以
    // 必须为 null；其余四类都以"产出哪一类叙事产物"为身份，缺了这一项就没有身份，
    // 而后果很安静：产物落盘后掉进"无类别"堆，两库都归不进去。
    if (seat.kind === "coordinator" && seat.contentType !== null) {
      problems.push(`${seat.id}: coordinator 席不落叙事产物，contentType 必须为 null`);
    }
    if (seat.kind !== "coordinator" && seat.contentType === null) {
      problems.push(`${seat.id}: ${seat.kind} 席必须声明 contentType（无产物类别只属于协调席）`);
    }
    if (seat.kind === "coordinator" && (seat.report || seat.branch || seat.retrieval)) {
      problems.push(`${seat.id}: coordinator 席不该带其他 kind 的专属字段`);
    }
    for (const binding of seat.bindings) {
      // 空 agentIds 只在「产物由他席顺带产出」时合法，且必须指名是哪一席——
      // 否则就是接线漏了，而不是有意合并实现
      if (binding.agentIds.length === 0 && !binding.coveredBy) {
        problems.push(`${seat.id}: 存在空的 agentIds 绑定，却未交代由哪一席顺带产出`);
      }
      if (binding.coveredBy) {
        if (binding.agentIds.length > 0) {
          problems.push(`${seat.id}: coveredBy 绑定不该同时给 agentIds（既合并又独立跑，产物会打架）`);
        }
        if (!index.has(binding.coveredBy)) {
          problems.push(`${seat.id}: coveredBy 指向不存在的席位 ${binding.coveredBy}`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`AssistantSeat 契约不成立：\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}
