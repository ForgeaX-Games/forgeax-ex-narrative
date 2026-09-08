/**
 * pipeline/mode-routing.ts —— mode → 步序的**唯一**解析入口（路由归一）。
 *
 * 归一之前有两条并行的路：
 *   - 动态 narrative_auto / design_auto → resolveSeatStepGroups → 四条席位管线
 *   - 静态 narrative_* / design_* / vn_* → modeConfig.steps → 十一个旧 template 的手写 step 序列
 * 同一个品类在两条路上跑出不同步序，而"哪条才算真"没有答案。
 *
 * 归一之后只有一条：**步序一律来自四条席位管线**，mode 只贡献两件事——
 *   1. 实现作用域（pipeline_template / modeId）：每席取哪个实现；
 *   2. 停止点（target_endpoint）：跑到哪一步收口。
 *
 * 这不是把旧 template 的能力砍掉，而是把它降到它本该在的层：写这段话时，
 * `region_design` 是场景列表席在 tpl-open-world 下的实现，`event_pool` 是故事情节席
 * 在 tpl-card-game 下的实现，`vn_*` 那批是各席在 tpl-vn-v2 下的实现——它们全都
 * 登记在 assistant-seats.ts 的席位×作用域矩阵里，所以归一**一个交付物都不丢**，
 * 丢掉的只是"每个品类各写一条链"这件事本身。（后续 C1/C2/C3 已把这三批模板专属
 * 实现依次吸收进通用席位并封存，此处例子仅保留作历史说明，见各子目录下的
 * `README.md`，如 `_archive/vn-v2/README.md`。）
 *
 * 旧 PIPELINE_TEMPLATES 因此退出**步序**路由（narrative-pipelines.ts:16-19 写明的意图），
 * 仅作为实现作用域名与历史 checkpoint 的读取键继续存在。
 */
import type { ModeId, TierId } from "../../types/index.js";
import { resolveSeatAgents, getSeatForAgent, type SeatScope } from "./assistant-seats.js";
import { getModeConfig } from "./modes.js";
import {
  expandPipelineSteps,
  resolveNarrativePipeline,
  type NarrativePipeline,
} from "./narrative-pipelines.js";

/**
 * 席位管线今天表达不了其交付物的 mode —— 这些继续读 modeConfig.steps。
 *
 * 登记而不是静默降级：四条管线按**叙事层级**切，每席在一个作用域下只能取一个实现，
 * 一个品类若要同时要两个模板特化实现，或停止点在新架构里不存在，就无法无损归一。
 * 硬归一的代价是悄悄少产一份交付物，那比多留一条旧路更糟。
 *
 * C3（2026-08）已清空：原挂号的 fragmented / card_narrative / open_world_narrative /
 * design_fragmented 四条 mode，其"要同时要两个特化实现"的病根——card_lore /
 * event_pool / region_design 三个模板特化 step——已随实现搬进
 * `_archive/specialized/`，业务功能吸收进通用 lore_generation / plot_generation
 * （不再是"某模板下的特化"，无需再跨 template 作用域拼两席）。四条 mode 因此
 * 从 MODE_CONFIGS 摘下（见 modes.ts 对应注记），不再需要在本表登记"归一不了"。
 */
export const LEGACY_STEP_ORDER_MODES: Readonly<Record<string, string>> = {};

/**
 * B1（最轻的一条）：`target_endpoint` 的下标切片对绝大多数 mode 是安全的——它们
 * 声明的停止点在新架构展开后仍然排在"这个 mode 需要的最后一步"。`scene` 是
 * 唯一例外：它的 `target_endpoint`（`scene_plan`）挂在 `scene_list` 席，
 * 该席在新架构里已挪到设定层，位置早于叙事层与交付席（quest）。若仍按
 * `scene_plan` 自己在展开步序里的下标切片，会把叙事层与任务整段切掉——
 * 旧语义「任务 + 场景节点」退化成「只有场景节点」。
 *
 * `scene_plan` 本身作为设定层的强制成员，无论切到哪个位置都已经产出，
 * 所以 `scene` 真正的截断点应与 `quest` 一致。这里登记的是"该 mode 实际要
 * 截断到哪个席位"的白名单，而不是让 `endpoint` 自身的下标决定切到哪——
 * 换个说法：把"下标切片"换成"席位白名单"，只在这一条上生效，不动其余 mode
 * 已验证正确的行为（尤其是 design_* 系列：design 前缀与叙事层可能共享同一个
 * 席位却落在不同 step id 上，若对所有 mode 都改成"按席位过滤全表"会连带吞掉
 * 顺序信息，见 mode-routing.test.ts 的教训）。
 */
export const CUTOFF_SEAT_OVERRIDE: Readonly<Record<string, string>> = {
  scene_plan: "quest",
};

/** 数组里最后一个满足 `set` 的下标；找不到时为 -1。 */
function lastIndexWhere(arr: readonly string[], set: ReadonlySet<string>): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (set.has(arr[i]!)) return i;
  }
  return -1;
}

export interface ModeRoutingInput {
  mode: ModeId;
  genreCode?: string | null;
  tier: TierId;
  /** 影游 E2 上传剧本入口：决定需求清单席取 vn_script_normalize 还是被 logline 覆盖。 */
  hasUploadedScript?: boolean;
  /** 是否把 status=planned 的席位也展开（预览用，跑不动）。 */
  includePlanned?: boolean;
  /**
   * 作者在编排面勾选启用的席位 id（可选终点席与可挂载席都走这里）。
   *
   * 默认关的席位若没有这条入口，就只能靠在画布上手工连一条自定义链才跑得到，
   * 而"勾一下就多过一道打磨"本该是一次点击的事。
   */
  activateSeats?: readonly string[];
}

export interface ModeRouting {
  /** 步序来源：四条席位管线之一。 */
  pipeline: NarrativePipeline;
  /** 每席取哪个实现。 */
  scope: SeatScope;
  stepGroups: string[];
  /**
   * target_endpoint 命中的截断点。
   *
   * mode 声明了停止点但席位管线里没有那一步时为 undefined —— 这种情况不静默放过，
   * 由 mode-routing.test.ts 逐 mode 断言，否则"止于剧本"会悄悄变成"跑到质检"。
   */
  truncatedAt?: string;
}

/** 本 mode 的步序是否已能由席位管线无损表达。 */
export function isSeatRoutedMode(mode: ModeId): boolean {
  return !(mode in LEGACY_STEP_ORDER_MODES);
}

/**
 * D0-D4 策划前缀：直接取策划文档席在 design_auto 作用域下的实现链。
 *
 * 不写死一份常量，是为了让席位表继续当唯一事实源。前缀而非"把 design_auto 当作用域
 * 传进去"，是因为后者会让策划文档席**替换掉**它在本管线下本来的实现——影游线的
 * vn_logline、任务线的 initial_plan 都会因此消失。策划案是叙事之前的一段，不是叙事的一环。
 */
function designPrefix(): string[] {
  return resolveSeatAgents("design_doc", { modeId: "design_auto" });
}

/**
 * mode + 品类 + 层级 → 真正要跑的步序。
 *
 * run() / rerunFromStep() / getStaleSteps() 三处必须共用本函数：它们一旦各算一次，
 * "只重跑受影响环节"就会错位到别的步上，而这类错位在产物里看不出来。
 */
export function resolveModeStepGroups(input: ModeRoutingInput): ModeRouting {
  const modeConfig = getModeConfig(input.mode);
  const pipeline = resolveNarrativePipeline(input.genreCode ?? "", input.tier);

  const scope: SeatScope = { hasUploadedScript: input.hasUploadedScript === true };
  if (modeConfig.pipeline_template) scope.templateId = modeConfig.pipeline_template;

  const endpoint = modeConfig.target_endpoint;
  /**
   * B1：target_endpoint 落在某个默认不展开的可选终点席（如 RPG 的 storyboard=L4
   * 剧本）实现步上时，反查所属席位并临时激活——不然 full 步序里根本没有这一步，
   * 下面按 endpoint 找截断点永远落空，只能悄悄跑到质检收尾。
   */
  const endpointSeatId = endpoint ? getSeatForAgent(endpoint)?.id : undefined;
  const activateOptionalSeats = [
    ...(input.activateSeats ?? []),
    ...(endpointSeatId && pipeline.optionalSeats?.includes(endpointSeatId) ? [endpointSeatId] : []),
  ];

  const narrative = expandPipelineSteps(pipeline, {
    scope,
    includePlanned: input.includePlanned,
    activateOptionalSeats,
  });

  const full = input.mode.startsWith("design_")
    ? [...designPrefix(), ...narrative.filter((s) => !designPrefix().includes(s))]
    : narrative;

  if (!endpoint) return { pipeline, scope, stepGroups: full };

  const cutoffSeatId = CUTOFF_SEAT_OVERRIDE[endpoint];
  const cut = cutoffSeatId
    ? lastIndexWhere(full, new Set(resolveSeatAgents(cutoffSeatId, scope)))
    : full.indexOf(endpoint);
  if (cut < 0) return { pipeline, scope, stepGroups: full };
  return {
    pipeline,
    scope,
    stepGroups: full.slice(0, cut + 1),
    truncatedAt: endpoint,
  };
}
