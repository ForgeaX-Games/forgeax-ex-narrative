/**
 * pipeline/narrative-pipelines.ts —— 新架构叙事管线（四期，SSOT）。
 *
 * 对应产品侧的叙事策划专家组配置表。
 * 那张表里 117 个品类专家、第 7 列「叙事管线」去重之后**只有四条**。四条管线全部
 * 由 assistant-seats.ts 的二十席组合而成——"专家 = 席位的编排"在这里第一次成为
 * 代码事实，而不只是文档说法。
 *
 * ┌─ 四条管线与层级的对应（层级编号方向相反，是历史遗留，语义一致）
 * │  CSV T4 重度叙事(20) = 代码 tier1 ─┬→ 任务线（除影游）
 * │  CSV T3 中度叙事(45) = 代码 tier2 ─┘   影游单独走分镜线
 * │  CSV T2 轻度叙事(34) = 代码 tier3  → 设定集线
 * │  CSV T1 极简叙事(18) = 代码 tier4  → 叙事卡线
 * └─
 *
 * 与旧 PIPELINE_TEMPLATES 的关系：旧表是十一个按品类家族切的 step 序列，
 * 新架构收敛成四条按**叙事层级**切的席位序列。旧表不再作为路由目标，
 * 只保留供历史 checkpoint 读取（见 templates.ts 各条的 legacy 注记）。
 * 新旧解析结果的差异由 narrative-pipelines.test.ts 显式登记，不做静默切换。
 */
import type { TierId } from "../../types/index.js";
import { resolveSeatAgents, getSeat, type SeatScope } from "./assistant-seats.js";

export type NarrativePipelineId = "pl-narrative" | "pl-film-game" | "pl-codex" | "pl-card";

/**
 * 管线的前置阶段：CSV 每条管线都以「需求输入（IP作品提炼）→叙事路由」开头。
 * 这两步不是 agent——前者是用户在创作空间底栏填需求 / 传原作，后者是四轴选轴。
 * 记在这里是为了让"管线定义"与 CSV 逐字对得上，展开成 step 时会跳过。
 */
export const PIPELINE_PREAMBLE = ["需求输入（IP作品提炼）", "叙事路由"] as const;

export interface NarrativePipeline {
  id: NarrativePipelineId;
  /** 展示名（前端专家组卡片上的管线名） */
  name: string;
  /** CSV 第 7 列的环节名序列，逐字保留以便复核 */
  csvStages: readonly string[];
  /** 环节对应的席位 id 序列（与 csvStages 去掉前置阶段后一一对应） */
  seats: readonly string[];
  /**
   * `seats` 里默认不展开的可选终点席（B1）。
   *
   * 登记在这里而不是干脆不放进 `seats`，是为了让 csvStages 校验、席位存在性校验
   * 等结构性测试仍能覆盖到它；`expandPipelineSteps` 默认跳过，只有调用方显式在
   * `ExpandOptions.activateOptionalSeats` 里点名时才展开——`mode-routing.ts` 据
   * `target_endpoint` 反查所属席位后传入。
   */
  optionalSeats?: readonly string[];
  /**
   * CSV 步序之外、可由作者在编排面挂载的席位（默认全关）。
   *
   * 打磨三席属于这一类：它们不生成新东西，而是把已生成的剧本改写成新一版，
   * 产物原位写回同一个字段。CSV 第 7 列没有它们——那张表描述的是"一条管线该
   * 产出什么"，而打磨是"产出之后要不要再过一道"，由作者按需决定。默认全关是
   * 因为三席都作用在情节层，全开等于情节生成完再过三轮 LLM。
   *
   * 与 `optionalSeats` 的区别：那些是 CSV 里就有的可选终点席（在 `seats` 内），
   * 这些根本不在 CSV 步序里，所以要用 `after` 指明挂在哪一席之后——激活后的
   * 步序仍得说得通：打磨在情节之后、质检之前，质检该看的是作者最终要的那一版。
   */
  attachableSeats?: readonly { seatId: string; after: string }[];
  /**
   * 把席位解析成具体 step 时用的作用域。
   * 影游线用 tpl-vn-v2 取到影游专属实现（logline / 三幕 / 剧情树 / 剧本 / 分镜）——
   * 那批 step 本身就是新席位的实现，v2 只是它们的历史作用域名。
   */
  implScope: SeatScope;
  /** 本管线覆盖的层级（tier1 最重 … tier4 最简） */
  tiers: readonly TierId[];
  /** 从层级默认里单独挑出来走本管线的品类 */
  genreOverrides: readonly string[];
}

/** 前六席：四条管线共用的设定层地基（叙事卡线只取前三席）。 */
const SETTING_SEATS = [
  "req_list",
  "design_doc",
  "worldview",
  "character",
  "item",
  "scene_list",
] as const;

/** 叙事层：大纲 → 结构 → 情节，产出剧情树。 */
const NARRATIVE_SEATS = ["outline", "structure", "plot"] as const;

/**
 * 质检段：结构检查 + 内容检查。
 * CSV 写作「质检（故事、角色、道具、场景）」——四个受检对象，两个检查席分工：
 * 结构检查管剧情树的分支/聚合/结局/节奏，内容检查管吃书防范与世界观、角色弧光适配。
 *
 * 打磨三席不进默认步序，登记成可挂载席（见 POLISH_ATTACHABLE）：跑不跑由作者定。
 */
const QA_SEATS = ["structure_check", "content_check"] as const;

/**
 * 打磨四席的挂载点。跑不跑由作者定，但挂在哪一席之后由它改的是哪一层决定。
 *
 * 前三席改情节正文（`plots_generated`），所以挂在情节席后面而不是管线末尾：下游的
 * 质检、任务、分镜都该看到作者最终要的那一版。
 *
 * 玩法适配（2.5.20）挂在**结构席**后面 —— 它动的是细纲里"玩家做的选择意味着什么"，
 * 基准字段是 `detailed_outlines_generated`。挂到情节席后面会让它去改一份情节已经照着
 * 写完了的细纲：改得再好也没人再读，而且不会有任何一步报错。
 */
const POLISH_ATTACHABLE = [
  { seatId: "playability", after: "structure" },
  { seatId: "deai", after: "plot" },
  { seatId: "plot_refine", after: "plot" },
] as const;

/**
 * VN 家族的十二个品类（B2）：`genre-taxonomy.ts` 的 `GENRE_TEMPLATE_OVERRIDES`
 * 早把它们指去旧架构的 `tpl-vn`，但新架构路由只看层级 + 这里的 `genreOverrides`，
 * 完全不读那张旧表——`narrative_auto` 路径又不传 `templateId`，于是它们全部按
 * 层级默认 fallback 到了 `pl-narrative`（任务线），而不是影游该走的分镜线。
 * 与 `adv-interactive`（走归档 tpl-vn-v2 实现）不同，这十二个走的是
 * `pl-film-game` 的通用席位实现——多迁移一步以后再谈（C1 的范畴）。
 */
const VN_FAMILY_GENRES = [
  "adv-vn",
  "adv-walking-sim",
  "adv-text",
  "adv-pointclick",
  "adv-puzzle",
  "adv-otome",
  "adv-detective",
  "adv-horror-vn",
  "adv-raising",
  "adv-life-sim",
  "sim-dating",
  "puz-narrative",
] as const;

export const NARRATIVE_PIPELINES: Readonly<Record<NarrativePipelineId, NarrativePipeline>> = {
  "pl-narrative": {
    id: "pl-narrative",
    name: "叙事管线（任务）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "角色档案", "道具清单", "场景列表",
      "故事大纲", "故事结构", "故事情节", "剧本（可选终点）", "任务", "质检（故事、角色、道具、场景）",
    ],
    /**
     * B1：storyboard（分镜助手，通用实现即 `script_generation`）作为 RPG 容器的
     * L4 可选终点席补入——旧 `JRPG_PIPELINE_STEPS` 的 L4（剧本）在四期换架构时
     * 被划给了影游线的分镜席，任务线交付席变成 `quest_generation`，`script` mode
     * 因此卡在 `LEGACY_STEP_ORDER_MODES`（见 mode-routing.ts）。默认仍止于 L5
     * 任务，`optionalSeats` 声明它不参与默认展开，只有 target_endpoint 指向它
     * 时才被 mode-routing.ts 临时激活。
     */
    seats: [...SETTING_SEATS, ...NARRATIVE_SEATS, "storyboard", "quest", ...QA_SEATS],
    optionalSeats: ["storyboard"],
    attachableSeats: POLISH_ATTACHABLE,
    implScope: {},
    tiers: ["tier1", "tier2"],
    genreOverrides: [],
  },

  "pl-film-game": {
    id: "pl-film-game",
    name: "叙事管线（分镜）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "角色档案", "道具清单", "场景列表",
      "故事大纲", "故事结构", "故事情节", "分镜", "质检（故事、角色、道具、场景）",
    ],
    /**
     * 与任务线共用**同一批席位实现**，只有交付席不同（分镜替任务）。
     *
     * 这里刻意不接归档的 tpl-vn-v2 实现：那条线以"三幕"为骨架，而新架构里
     * 不管 RPG 还是影游都不再有"幕"——大纲定叙事单元、结构展开为剧情树、
     * 情节填节点内容，三层职责对所有品类同构。剧情树的**形态差异**（线性 /
     * 树状 / 碎片化 / 涌现 / 混合 / 多线交织 / 多视角交织）由叙事策略的结构轴
     * 策略卡决定，不靠给影游另开一条管线来实现。
     *
     * 影游之所以仍单列一条，只因它的下游是生图/生视频模型而非任务系统：
     * 交付物是分镜，不是任务树。
     */
    seats: [...SETTING_SEATS, ...NARRATIVE_SEATS, "storyboard", ...QA_SEATS],
    attachableSeats: POLISH_ATTACHABLE,
    implScope: {},
    tiers: [],
    // 影游是全表唯一走分镜线的一族品类：下游是生图/生视频模型，不是任务系统。
    // B2：VN 家族十二品类原先漏领，误 fallback 到任务线，此处补认领（不新增管线）。
    genreOverrides: ["adv-interactive", ...VN_FAMILY_GENRES],
  },

  "pl-codex": {
    id: "pl-codex",
    name: "叙事管线（设定集）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "角色档案", "道具清单", "场景列表", "设定集",
    ],
    // 轻度叙事不产剧情树：设定齐了就交付设定集，不进大纲/结构/情节。
    seats: [...SETTING_SEATS, "codex"],
    implScope: {},
    tiers: ["tier3"],
    genreOverrides: [],
  },

  "pl-card": {
    id: "pl-card",
    name: "叙事管线（叙事卡）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "叙事卡",
    ],
    // 极简叙事连角色/道具/场景都不单独出：一张叙事卡自成一体。
    seats: ["req_list", "design_doc", "worldview", "narrative_card"],
    implScope: {},
    tiers: ["tier4"],
    genreOverrides: [],
  },
};

export const NARRATIVE_PIPELINE_IDS = Object.keys(
  NARRATIVE_PIPELINES,
) as NarrativePipelineId[];

const OVERRIDE_INDEX = new Map<string, NarrativePipelineId>();
const TIER_INDEX = new Map<TierId, NarrativePipelineId>();
for (const p of Object.values(NARRATIVE_PIPELINES)) {
  for (const code of p.genreOverrides) OVERRIDE_INDEX.set(code, p.id);
  for (const tier of p.tiers) {
    const prev = TIER_INDEX.get(tier);
    if (prev && prev !== p.id) {
      throw new Error(`层级 ${tier} 被 ${prev} 与 ${p.id} 同时认领，层级到管线必须唯一`);
    }
    TIER_INDEX.set(tier, p.id);
  }
}

/**
 * 品类 → 新架构管线。品类特例优先于层级默认。
 *
 * 与旧 resolvePipelineTemplate 的根本差别：旧函数按品类家族逐条列举（117 个品类里
 * 66 个要写 override），新函数按层级归类（只有影游一个特例）。层级本就是"这游戏
 * 有多少叙事"的度量，管线深浅正该由它决定。
 */
export function resolveNarrativePipeline(
  genreCode: string,
  tier: TierId,
): NarrativePipeline {
  const byOverride = OVERRIDE_INDEX.get(genreCode);
  if (byOverride) return NARRATIVE_PIPELINES[byOverride];
  const byTier = TIER_INDEX.get(tier);
  if (!byTier) throw new Error(`层级 ${tier} 没有对应管线`);
  return NARRATIVE_PIPELINES[byTier];
}

export interface ExpandOptions {
  /** 是否把 status=planned 的席位也展开（默认 false：只跑已实现的） */
  includePlanned?: boolean;
  /**
   * 覆盖管线自带的 implScope。
   *
   * 管线定的是**席位序列**（步序），作用域定的是**每席取哪个实现**——两件事正交。
   * 静态 mode 归一到席位路由后，就靠这个参数把 mode 自己的 template/modeId 作为
   * 实现作用域传进来：步序仍来自四条管线，形态差异由作用域挑实现承担。
   */
  scope?: SeatScope;
  /**
   * 本次要一并展开的可选终点席 id（B1）。未列出的可选席仍按默认跳过。
   * 由 `mode-routing.ts` 依据 `target_endpoint` 反查所属席位后传入。
   */
  activateOptionalSeats?: readonly string[];
}

/**
 * 席位序列 → step 序列。
 *
 * 一席可能对应多个 step（如需求清单席 = 偏好总结 + 偏好分析），席内顺序即
 * 席位绑定里声明的顺序。未实现的席位（planned）默认跳过，让四条管线今天就能跑，
 * 而不是等六个 planned 席全部落地才通电。
 */
export function expandPipelineSteps(
  pipeline: NarrativePipeline,
  options: ExpandOptions = {},
): string[] {
  const scope = options.scope ?? pipeline.implScope;
  const activated = new Set(options.activateOptionalSeats ?? []);
  const steps: string[] = [];

  const appendSeat = (seatId: string): void => {
    const seat = getSeat(seatId);
    if (!seat) throw new Error(`管线 ${pipeline.id} 引用了不存在的席位 ${seatId}`);
    if (seat.status === "planned" && !options.includePlanned) return;
    steps.push(...resolveSeatAgents(seatId, scope));
  };

  for (const seatId of pipeline.seats) {
    if (pipeline.optionalSeats?.includes(seatId) && !activated.has(seatId)) continue;
    appendSeat(seatId);
    // 挂载席跟在它的锚点席之后展开，激活后的步序才说得通
    //（打磨在情节之后、质检之前）。
    for (const a of pipeline.attachableSeats ?? []) {
      if (a.after === seatId && activated.has(a.seatId)) appendSeat(a.seatId);
    }
  }
  return steps;
}

/** 本管线可挂载但默认不跑的席位 id（编排面据此给勾选项）。 */
export function attachableSeatIds(pipeline: NarrativePipeline): string[] {
  return (pipeline.attachableSeats ?? []).map((a) => a.seatId);
}

/** 本管线里尚未落地的席位（planned），用于前端标灰与进度统计。 */
export function pendingSeats(pipeline: NarrativePipeline): string[] {
  return pipeline.seats.filter((id) => getSeat(id)?.status === "planned");
}

/**
 * 品类 + 层级 → 该跑的步序。运行时（pipeline.run）与预览（/plan）共用的唯一入口。
 *
 * 这是四期路由的落地点：PRD v1.4 §3.2.3 规定所有品类走同一条通用流程，品类差异
 * 来自提示词槽位 / 策略卡 / 产出模板，不来自各写一条链。所以这里不再按 needs 或
 * 原型族现算步序，只按（层级 + 影游特例）取四条之一。
 *
 * 步序是纯串行的：CSV 的环节本就一环接一环，并行组由具体 agent 内部的批处理承担，
 * 不在管线层展开。
 */
export function resolveSeatStepGroups(
  genreCode: string | null | undefined,
  tier: TierId,
  /** 作者在编排面勾选启用的默认关席位（可选终点席 / 可挂载席）。 */
  activateSeats?: readonly string[],
): { pipeline: NarrativePipeline; stepGroups: string[] } {
  const pipeline = resolveNarrativePipeline(genreCode ?? "", tier);
  return {
    pipeline,
    stepGroups: expandPipelineSteps(pipeline, { activateOptionalSeats: activateSeats }),
  };
}
