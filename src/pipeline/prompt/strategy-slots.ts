/**
 * pipeline/prompt/strategy-slots.ts —— 叙事策略段（骨架第 ③ 段）的四个 provider。
 *
 * 四轴各占一个子槽，内容来自约定式策略库（knowledge/strategy/*.md）。
 * 与 IP DNA 段的差别：IP DNA 的内容是运行时算出来写进 ctx 的，策略卡是静态文件，
 * 这里直接按四轴 code 查库。
 *
 * 生效范围严格限定四个环节 —— 席位表里只有这四席标了 ◐，
 * 其余环节即便声明了 STRATEGY_SLOT_BLOCK 也会拿到空串、整块塌缩。
 */
import type { PromptSlot } from "./skeleton.js";
import type { FragmentProvider } from "./providers.js";
import type { NarrativeContext } from "../../types/index.js";
import type { StrategyAxis } from "../../knowledge/narrative-axes/index.js";
import type { StrategyStage } from "../../knowledge/narrative-axes/story-structures.js";
import { STRATEGY_AXIS_LABELS } from "../../knowledge/narrative-axes/index.js";
import { getStrategyCards } from "../../knowledge/strategy/strategy-loader.js";
import { getSeatForAgent } from "../routing/assistant-seats.js";
import { seatStrategySlots } from "../routing/seat-spec.js";

/**
 * step → 策略环节。表外的 step 不装配策略卡。
 *
 * 本表只管**查哪一档卡**（四环节各有一套卡），不管**吃哪几轴**——后者的唯一事实源
 * 是 seat-spec 的四轴矩阵，由 stepEatsSlot 在装配时查。两表由 strategy-slots.test.ts
 * 双向锁定：登记了 stage 的 step 其席位必须真吃轴，声明了吃轴的席位必须有 step 登记
 * stage，否则策略卡会静默不注入。
 *
 * 环节按**席位**定，不按 step 名：标 ◐ 的是需求清单 / 策划文档 /
 * 故事大纲 / 故事结构四席，一席在不同管线下是不同 step，都要能吃到卡。
 *
 * outline 环节原先挂在 outline_batch，但那是 L1 微观展开、属故事结构席；
 * 宏观框架才是故事大纲席，RPG 侧是 story_framework。
 *
 * C1（2026-08）已封存原 tpl-vn-v2 专属 step（vn_logline / vn_outline_acts /
 * vn_beats / vn_branched_beats）在本表的登记：这四步不再执行，四轴策略对
 * VN 家族品类改由通用 step（initial_plan / story_framework / outline_batch /
 * detailed_outline）承接，与其余品类同一套。
 */
export const STEP_TO_STRATEGY_STAGE: Readonly<Record<string, StrategyStage>> = {
  // 需求清单席
  //   影游侧的 vn_script_normalize 同属本席但**不登记**：它做的是对上传剧本的
  //   忠实抽取，产出须贴原文，注入策略卡只会诱导它改写素材。
  preference_summary: "demand",
  // 策划文档席
  initial_plan: "design",
  // 故事大纲席（宏观框架）
  story_framework: "outline",
  // 故事结构席（微观展开 + 剧情树）
  outline_batch: "structure",
  detailed_outline: "structure",
};

/** 四个策略子槽，顺序与 PROMPT_SLOT_ORDER 一致。 */
export const STRATEGY_SLOTS: readonly Extract<
  PromptSlot,
  "strategy_genre" | "strategy_type" | "strategy_theme" | "strategy_structure"
>[] = ["strategy_genre", "strategy_type", "strategy_theme", "strategy_structure"];

const SLOT_TO_AXIS: Readonly<Record<(typeof STRATEGY_SLOTS)[number], StrategyAxis>> = {
  strategy_genre: "genre",
  strategy_type: "type",
  strategy_theme: "theme",
  strategy_structure: "structure",
};

/**
 * 本次运行是什么品类 —— 全仓唯一的判定。
 *
 * 优先取配置注入的那一份（选专家时就定了），检测结果只作旧条目与自动路由的兜底。
 *
 * 导出是因为 `providers.ts` 曾有一份同名实现，差别只在**不读** `narrative_axes.genre`。
 * 于是同一次运行里两处对"这是什么品类"的答案可以不同：用户显式选了品类，策略卡按选的那个
 * 取，品类技能包却按需求分析猜的那个取 —— 两份内容都进同一份提示词，讲的是两个品类。
 */
export function resolveGenreCode(ctx: NarrativeContext): string | null {
  return (
    ctx.narrative_axes?.genre ??
    ctx.demand_analysis?.genre_code ??
    ctx.tier_detection?.genre_code ??
    null
  );
}

/** 取本次运行的四轴 code；未换轴的旧条目只有品类一轴。 */
export function resolveStrategySelection(ctx: NarrativeContext): Record<StrategyAxis, string | null> {
  const axes = ctx.narrative_axes;
  return {
    genre: resolveGenreCode(ctx),
    type: axes?.storyType ?? null,
    theme: axes?.storyTheme ?? null,
    structure: axes?.structure ?? null,
  };
}

/**
 * 该 step 该吃哪几个策略子槽，以席位表为准。
 *
 * 两张表分工：本文件的 STEP_TO_STRATEGY_STAGE 只回答「这一步落在四环节的哪一环」
 * （即查哪一档策略卡），**吃哪几轴由 seat-spec 的四轴矩阵决定**。所以给某席减轴
 * 只需改 seat-spec 一处，不必回头翻每个 step 的 composer。
 *
 * 查不到席位的 step（元节点，或尚未进 assistant-seats 的实验步）不做限制：
 * 它已经通过登记 stage 明示了要吃卡，此时按四轴全给，行为与接线前一致。
 */
function stepEatsSlot(stepId: string, slot: (typeof STRATEGY_SLOTS)[number]): boolean {
  const seat = getSeatForAgent(stepId);
  if (!seat) return true;
  return seatStrategySlots(seat.id).includes(slot);
}

function makeStrategyProvider(slot: (typeof STRATEGY_SLOTS)[number]): FragmentProvider {
  const axis = SLOT_TO_AXIS[slot];
  return {
    slot,
    name: `strategy-${axis}`,
    provide({ ctx, stepId }) {
      const stage = STEP_TO_STRATEGY_STAGE[stepId];
      if (!stage) return "";
      if (!stepEatsSlot(stepId, slot)) return "";
      const card = getStrategyCards(resolveStrategySelection(ctx), stage)[axis];
      if (!card) return "";
      return `### ${STRATEGY_AXIS_LABELS[axis]}：${card.name}\n\n${card.body}`;
    },
  };
}

export const strategyGenreProvider = makeStrategyProvider("strategy_genre");
export const strategyTypeProvider = makeStrategyProvider("strategy_type");
export const strategyThemeProvider = makeStrategyProvider("strategy_theme");
export const strategyStructureProvider = makeStrategyProvider("strategy_structure");

export const STRATEGY_PROVIDERS: readonly FragmentProvider[] = [
  strategyGenreProvider,
  strategyTypeProvider,
  strategyThemeProvider,
  strategyStructureProvider,
];
