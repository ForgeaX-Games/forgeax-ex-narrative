/**
 * runner-migration.ts —— 哪些席位实现已经交给 AgentRunner 跑，以及它们各自缺的那几样。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么单独一张表，而不是逐个手写 AgentDef
 * ─────────────────────────────────────────────────────────────────
 * AgentDef 的绝大多数字段（io 契约、依赖边、LLM 参数、extractOutputKey）都能从
 * StepDescriptor 派生，seat-agents.ts 已经在派生了。迁移一席真正新增的只有两类信息：
 *   1. 原来写死在 step 函数体里的校验与后处理 —— 提成命名 processor；
 *   2. 分片参数（batch 大小、并发度）—— 提成 ChunkedConfig。
 * 所以这里只登记这两类，其余继续派生。手写整份 AgentDef 会让 io/deps 有两个事实源。
 *
 * ─────────────────────────────────────────────────────────────────
 * 迁移的验收标准
 * ─────────────────────────────────────────────────────────────────
 * `outcome.via` 从 `legacy` 变 `runner`，**且产物逐字节不变**。所以每迁一席都配一条
 * 对照测试：同一份桩 LLM 输出分别喂 legacy step 函数与 runner，断言 ctx 相等
 * （见 runner-migration.test.ts）。提示词也必须是同一个 PromptComposer —— 迁移不是
 * 重写提示词的时机，那会让"产物变了"分不清是迁移引起还是提示词引起。
 */
import type { ChunkedConfig, DeterministicConfig, SequenceConfig, SingleTurnConfig, WaveConfig } from "../blueprint/types.js";
import { QUEST_BATCH_SIZE } from "../steps/quest-generation.js";
import { POLISH_BATCH_SIZE } from "../steps/polish-family.js";

export interface RunnerMigration {
  /** 命名校验器（抛错触发 LLM 重试），原是 step 函数里 callWithRetry 的第四参。 */
  validators?: string[];
  /**
   * 命名归一化器，原是 step 函数在 extractJSON 之后那段落地逻辑。
   * sequence 原语下由 SequenceRunner 在阶段循环结束后调用一次
   * （单次调用/分片/波次原语各自的 runner 也在各自收尾调用同一字段）。
   */
  normalizer?: string;
  /**
   * 分片配置。给了就以 chunked 原语注册，并要求同时登记
   * `<stepId>_splitter` / `<stepId>_merger`（ChunkedRunner 缺一即抛错）。
   */
  chunked?: ChunkedConfig;
  /**
   * 确定性处理器配置。给了就以 deterministic 原语注册——没有 LLM 调用，
   * 直接跑注册的处理器函数（如结构检查：图上的事实，不需要模型）。
   */
  deterministic?: DeterministicConfig;
  /**
   * 多阶段配置。给了就以 sequence 原语注册——阶段列表按顺序跑
   * （llm 阶段查 stage-composer-registry，deterministic 阶段查 PROCESSOR_REGISTRY）。
   */
  sequence?: SequenceConfig;
  /**
   * 波次配置。给了就以 wave 原语注册——拓扑分层 + 层内并发 + 层间滑动窗口摘要 +
   * 单元级约束重试，要求同时登记 `<stepId>_wave_layerer` / `<stepId>_merger`
   * （WaveRunner 缺一即抛错），`_wave_summarizer` / `_wave_constraint_check` 可选。
   */
  wave?: WaveConfig;
  /**
   * 覆盖派生出来的 LLM 参数（如需要流式、起飞前处理器）。
   * `preflight` 走这里而不是单独开一个顶层字段，因为它本就是 SingleTurnConfig 的一员。
   */
  llm?: Partial<SingleTurnConfig>;
}

/**
 * 已迁移席位实现。**只增不改**：某席回退到 legacy 应当是删掉这一行，
 * 而不是把 useNewRunner 改成 false 留在表里 —— 后者读起来像"迁移过但关掉了"。
 */
export const RUNNER_MIGRATIONS: Readonly<Record<string, RunnerMigration>> = {
  /**
   * 角色档案席。
   *
   * 席位声明 parallel（体量大→多并行），但实现今天是**一次调用出全部角色**：
   * 分批并发从未落地过（见 seat-spec 落差登记）。所以这次迁移是 single-turn 平迁，
   * 搬的是"数组非空校验"与"逐角色归一 + 主角兜底 + player_name 派生"这两段。
   */
  character_enrichment: {
    validators: ["character_enrichment_validator"],
    normalizer: "character_enrichment_normalizer",
  },

  /** 道具清单席。同角色席：单次调用 + 归一，数组可能裸给也可能包在 item_database 里。 */
  item_database: {
    validators: ["item_database_validator"],
    normalizer: "item_database_normalizer",
  },

  /**
   * 任务席 —— 第一个真正按分片原语跑的席位（此前 narrative_card 等都是单轮）。
   *
   * 它能先切，是因为节点之间**互不依赖**：每个情节节点各自出任务，没有滑动窗口摘要
   * 也没有层间顺序。情节席与分镜席同为"逐节点填充"，但它们的分片之间要传前驱实际
   * 内容摘要、还带三重约束的逐节点修正重试，那需要一个能在片间传数据的波次原语，
   * ChunkedConfig 表达不了（见 seat-spec 落差登记）。
   *
   * 每片一次调用，每批 6 片并发，与 legacy 的 chunkArray(plots, 6) + runParallel(…, 6)
   * 同量。逐片落地由 quest_generation_chunk_done 承担。
   */
  quest_generation: {
    validators: ["quest_generation_validator"],
    normalizer: "quest_generation_normalizer",
    chunked: {
      chunkStrategy: "by-batch",
      concurrency: QUEST_BATCH_SIZE,
      // 合并由 quest_generation_merger 做（要汇出主线链与支线归属，不是简单拼接）。
      mergeStrategy: "custom",
    },
  },

  // ════════════════════════════════════════════════════════
  // M2 原子迁移（12 席）
  // ════════════════════════════════════════════════════════

  /** 需求提炼：唯一的流式 + 纯文本席位，legacy 用 callStreamFull 而非 callWithRetry。 */
  preference_summary: {
    llm: { responseFormat: "text", streaming: true },
  },

  preference_analysis: {
    validators: ["preference_analysis_validator"],
    normalizer: "preference_analysis_normalizer",
  },

  initial_plan: {
    validators: ["initial_plan_validator"],
    normalizer: "initial_plan_normalizer",
  },

  worldview: {
    validators: ["worldview_validator"],
    normalizer: "worldview_normalizer",
  },

  lore_generation: {
    validators: ["lore_generation_validator"],
    normalizer: "lore_generation_normalizer",
  },

  /** 结构检查：确定性席位（图上的事实，不需要模型）。 */
  structure_check: {
    deterministic: { processor: "structure_check_processor" },
  },

  /** 内容检查：preflight 短路——没有情节就不发请求，直接给出"无送检内容"报告。 */
  content_check: {
    validators: ["content_check_validator"],
    normalizer: "content_check_normalizer",
    llm: { preflight: "content_check_preflight" },
  },

  /**
   * 百科娘：preflight 做联网实检（side effect 写 ctx 私有键），
   * 不短路——检索完仍走正常的第二轮 LLM 调用装配结构化产物。
   */
  encyclopedia_retrieval: {
    validators: ["encyclopedia_validator"],
    normalizer: "encyclopedia_normalizer",
    llm: { preflight: "encyclopedia_preflight" },
  },

  // ── 打磨家族四席：与 quest_generation 同构，按节点分片，节点间互不依赖 ──

  deai_polish: {
    validators: ["deai_polish_validator"],
    chunked: {
      chunkStrategy: "by-batch",
      concurrency: POLISH_BATCH_SIZE,
      mergeStrategy: "custom",
    },
  },
  plot_refine: {
    validators: ["plot_refine_validator"],
    chunked: {
      chunkStrategy: "by-batch",
      concurrency: POLISH_BATCH_SIZE,
      mergeStrategy: "custom",
    },
  },
  plot_polish: {
    validators: ["plot_polish_validator"],
    chunked: {
      chunkStrategy: "by-batch",
      concurrency: POLISH_BATCH_SIZE,
      mergeStrategy: "custom",
    },
  },
  playability_adapt: {
    validators: ["playability_adapt_validator"],
    chunked: {
      chunkStrategy: "by-batch",
      concurrency: POLISH_BATCH_SIZE,
      mergeStrategy: "custom",
    },
  },

  // ════════════════════════════════════════════════════════
  // M3 结构表达：outline 席内部环拆成 SequenceConfig
  // ════════════════════════════════════════════════════════

  /**
   * 故事框架（outline 席宏观展开）。legacy 内部本是「规划 LLM → 结构修复 →
   * 填充 LLM」一个环，此前只能整体留在 step.fn（描述符故意不登记 composer，
   * 见 step-registrations.ts 顶部说明）。四阶段忠实对应 legacy 的四段：
   *   route（判定 full/regen/skip）→ prepare（regen 或 full 各自的骨架准备，
   *   互斥用 condition 二选一）→ fill（内容填充，两种模式共用同一 LLM 调用）。
   * validators/normalizer 与 legacy 共用同一批函数（story-framework.ts 的
   * storyFrameworkRoute/PrepareRegen/PrepareFull/normalizeStoryFramework），
   * 两条路径逐字节同源，不是各写一份。
   */
  story_framework: {
    normalizer: "story_framework_normalizer",
    sequence: {
      stages: [
        { type: "deterministic", processor: "story_framework_route" },
        {
          type: "llm",
          condition: "ctx._sf_mode === full",
          composerId: "story_framework_plan",
          validator: "story_framework_plan_validator",
          outputKey: "_sf_plan_raw",
        },
        {
          type: "deterministic",
          condition: "ctx._sf_mode === full",
          processor: "story_framework_prepare_full",
        },
        {
          type: "deterministic",
          condition: "ctx._sf_mode === regen",
          processor: "story_framework_prepare_regen",
        },
        {
          type: "llm",
          condition: "ctx._sf_mode !== skip",
          composerId: "story_framework_fill",
          validator: "story_framework_fill_validator",
        },
      ],
    },
  },

  // ════════════════════════════════════════════════════════
  // M4 情节席切波次：plot_generation 是波次原语的第一个落地席位
  // ════════════════════════════════════════════════════════

  /**
   * 情节席。legacy 的核心特征——拓扑分层执行、层间滑动窗口摘要、单元级三重约束
   * 逐片重试——正是 WaveConfig 建模的目标场景（ChunkedConfig 表达不了片间数据流）。
   * 分层/约束校验/摘要/合并/归一化五个处理器与 legacy 共用同一批函数
   * （plot-generation.ts 的 buildPromptForNode/normalizePlot/validateTripleConstraints/
   * structureValidationL3），两条路径逐字节同源。
   */
  plot_generation: {
    validators: ["plot_generation_validator"],
    normalizer: "plot_generation_normalizer",
    wave: {
      // 缺省 = 整层一次性并发，对齐 legacy 的 `Promise.all(layer.map(...))`。
      maxConstraintRetries: 2,
    },
  },

  /**
   * 分镜席。与情节席同构（同一套拓扑分层 + 滑动窗口摘要 + 三重约束逐片重试），
   * 差别只在多带一个跨层累加的全局序号（用于提示词"第 X/Y 个情节节点"与产出
   * title 兜底）——分层时随单元一并算好，见 script-generation.ts 的
   * scriptGenerationWaveLayerer。合并即终稿，没有 L3 那样的收尾结构验证，
   * 故不需要 normalizer。
   */
  script_generation: {
    validators: ["script_generation_validator"],
    wave: {
      maxConstraintRetries: 2,
    },
  },
};

/**
 * ════════════════════════════════════════════════════════
 * E1（2026-08）盘点结论：outline_batch / detailed_outline 仍未登记进本表——
 * 不是遗漏，记在这里防止被后来者误判为待清理债务。
 * ════════════════════════════════════════════════════════
 *
 * outline_batch / detailed_outline 内部都是 `plan → skeleton+repair 链 →
 * 按父节点分组的 N 次顺序 LLM 填充 → gap 补漏` 四段（结构与 story_framework 的
 * plan→prepare→fill 同源，唯独多了"按父分组顺序调用 LLM"这一段）。这一段的形状
 * 正是 ChunkedRunner 分片（互不依赖、各喂各的材料）套进 SequenceRunner 某一阶段的
 * 组合——sequence-runner.ts/chunked-runner.ts 的文件头注释已经把这两步列成
 * "覆盖现有多阶段 step"/"outline-batch fill phase"，即框架设计时就预留了这个位置，
 * 但 `SequenceStage.type` 今天只有 "llm"/"deterministic" 两种，没有第三种能表达
 * "sequence 中间嵌一段分片并发"。要接上还需要：
 *   1. 给 SequenceStage 加 "chunked" 类型 + splitter/merger 命名口径（同 ChunkedRunner）；
 *   2. SequenceRunner 新增该类型的执行分支，且必须复刻 legacy 的顺序执行（非并发）与
 *      单组失败仅 warn 跳过（不中断整个 step）两条容错语义，否则 parity test 过不了；
 *   3. detailed_outline 结构与 outline_batch 完全同构，两席同一批新原语。
 *
 * 场景席不再出现在这段结论里：旧 `scene_generation` 的三阶段已按方向拆开——前向
 * `scene_plan` 是单次调用加确定性聚合（本就不需要新原语），后向的 L0→L1→L2 分层提炼
 * 迁往内容检查席的 `scene_evidence`，波次形状的登记随之落在那一侧。
 *
 * 两者都不在 RUNNER_MIGRATIONS 里意味着它们仍完全走 legacy step 函数路径
 * （`useNewRunner` 从未打开），产物与行为不受本表任何登记影响。
 */
export function getRunnerMigration(agentId: string): RunnerMigration | undefined {
  return RUNNER_MIGRATIONS[agentId];
}

export function isRunnerMigrated(agentId: string): boolean {
  return agentId in RUNNER_MIGRATIONS;
}
