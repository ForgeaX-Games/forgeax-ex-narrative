/**
 * pipeline/prompt/providers.ts —— 片段提供器注册表（蓝图 §7.2b 可插拔）。
 *
 * 把"提示词来自多个来源"显式化为按骨架插槽注册的 fragment provider：
 *
 *   strategy_genre / strategy_type / strategy_theme / strategy_structure
 *                                                ← 约定式策略库 + 品类技能包（见 strategy-slots.ts）
 *   objective_truth / operators / relations / ledger
 *                                                ← IP DNA 注入（运行时已写入 ctx 的结构化分段）
 *   material（{{data:*}} 摘要助手）              ← context-helpers 数据摘要
 *   role / task / constraints / cot / output     ← step 自身的 .md 模板（不在此，由模板提供）
 *
 * 设计：
 *   - provider 在「提示词组装时」运行，必须廉价、无 LLM、无 IO（IP DNA 的重活已在
 *     pipeline 运行时 injectOperatorsForStep 完成并落到 ctx，这里只读取分段）；
 *   - 开关某能力 = 启停对应 provider，step 代码零改动（可插拔）；
 *   - 返回的 slotMap 直接喂给 syntax.renderPlaceholders 的 `slots`。
 */
import type { NarrativeContext } from "../../types/index.js";
import type { PromptSlot } from "./skeleton.js";
import { getStepSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { getInjectedSections } from "../../ip-dna/injection/operator-injection.js";
import {
  buildCharacterDigest,
  buildItemDigest,
  buildStoryArcDigest,
} from "../steps/context-helpers.js";
import { STRATEGY_PROVIDERS } from "./strategy-slots.js";

export interface ProviderInput {
  ctx: NarrativeContext;
  stepId: string;
}

/** 一个片段提供器：负责填充骨架的某个插槽。 */
export interface FragmentProvider {
  /** 目标插槽。 */
  slot: PromptSlot;
  /** provider 名（调试/可观测）。 */
  name: string;
  /** 产出该插槽内容（空串=不填充）。 */
  provide(input: ProviderInput): string;
}

function resolveGenreCode(ctx: NarrativeContext): string | null {
  return ctx.demand_analysis?.genre_code ?? ctx.tier_detection?.genre_code ?? null;
}

// ─────────────────────────────────────────────────────────────────
// 内置 provider
// ─────────────────────────────────────────────────────────────────

/**
 * 品类风格：拼接 skill 的 style_guide / examples / constraints 槽位内容。
 *
 * 三期换轴后归入 strategy_genre 子槽（品类技能包与品类策略卡讲的是同一件事）。
 *
 * ⚠️ 不在 DEFAULT_PROVIDERS 里：现有 composer 已经通过 {{SKILL.style_guide}} 等占位
 * 和 systemPromptAddition 末尾追加拿到了同一份技能包内容，默认注册会造成重复注入。
 * 等 composer 全部迁到八段骨架、撤掉自己的 SKILL 块之后，再把它加回默认集合。
 */
export const genreStyleProvider: FragmentProvider = {
  slot: "strategy_genre",
  name: "skill-genre-style",
  provide({ ctx, stepId }) {
    const genreCode = resolveGenreCode(ctx);
    if (!genreCode) return "";
    const skill = getStepSkill(genreCode, stepId);
    if (!skill) return "";
    const parts = [
      skill.slots?.style_guide,
      skill.slots?.examples,
      skill.slots?.constraints,
      skill.systemPromptAddition,
    ].filter((s): s is string => !!s && s.trim().length > 0);
    return parts.join("\n\n");
  },
};

function makeIpDnaProvider(
  slot: Extract<PromptSlot, "objective_truth" | "operators" | "relations" | "ledger">,
): FragmentProvider {
  return {
    slot,
    name: `ipdna-${slot}`,
    provide({ ctx, stepId }) {
      const sections = getInjectedSections(ctx, stepId);
      return sections?.[slot] ?? "";
    },
  };
}

export const objectiveTruthProvider = makeIpDnaProvider("objective_truth");
export const operatorsProvider = makeIpDnaProvider("operators");
export const relationsProvider = makeIpDnaProvider("relations");
export const ledgerProvider = makeIpDnaProvider("ledger");

/** 默认 provider 集合（按插槽注册；同一插槽可被业务覆盖）。 */
export const DEFAULT_PROVIDERS: readonly FragmentProvider[] = [
  objectiveTruthProvider,
  operatorsProvider,
  relationsProvider,
  ledgerProvider,
  ...STRATEGY_PROVIDERS,
];

// ─────────────────────────────────────────────────────────────────
// 数据摘要助手（{{data:*}}）—— material 插槽的来源
// ─────────────────────────────────────────────────────────────────

/** {{data:FN(ARG)}} 摘要助手注册表（从 ctx 派生 material 文本）。 */
export function buildDataHelpers(ctx: NarrativeContext): Record<string, (arg: string) => string> {
  return {
    characters: () => buildCharacterDigest(ctx.detailed_character_sheets ?? []),
    items: () => buildItemDigest(ctx.item_database ?? []),
    story_arc: () => buildStoryArcDigest(ctx.initial_story_outline),
  };
}

// ─────────────────────────────────────────────────────────────────
// 槽位映射构建：跑 provider → 得到 renderPlaceholders 的 slots
// ─────────────────────────────────────────────────────────────────

/**
 * 运行 provider，得到喂给 syntax.renderPlaceholders 的 slot 映射。
 * 键约定：
 *   - 骨架插槽名直接作键（{{slot:strategy_genre}} / {{slot:operators}}）；
 *   - IP DNA 段额外以 "IP_DNA.<name>" 别名暴露（兼容 {{IP_DNA.operators}} 占位 T2）；
 *   - skill 细分槽以 "SKILL.<slot>" 暴露（兼容 {{SKILL.style_guide}} 旧占位）。
 */
export function buildSlotMap(
  ctx: NarrativeContext,
  stepId: string,
  providers: readonly FragmentProvider[] = DEFAULT_PROVIDERS,
): Record<string, string> {
  const map: Record<string, string> = {};
  const input: ProviderInput = { ctx, stepId };

  for (const provider of providers) {
    const content = provider.provide(input);
    if (!content || content.trim().length === 0) continue;
    // 多个 provider 命中同插槽 → 顺序拼接。
    map[provider.slot] = map[provider.slot] ? `${map[provider.slot]}\n\n${content}` : content;
  }

  // IP DNA 段的 {{IP_DNA.*}} 别名（T2 占位语法）。
  const ipKeys: Array<Extract<PromptSlot, "objective_truth" | "operators" | "relations" | "ledger">> = [
    "objective_truth",
    "operators",
    "relations",
    "ledger",
  ];
  for (const k of ipKeys) {
    if (map[k]) map[`IP_DNA.${k}`] = map[k];
  }

  // skill 细分槽的 {{SKILL.*}} 别名（旧 .md 模板仍用）。
  const genreCode = resolveGenreCode(ctx);
  if (genreCode) {
    const skill = getStepSkill(genreCode, stepId);
    if (skill?.slots) {
      for (const [slotName, val] of Object.entries(skill.slots)) {
        if (val) map[`SKILL.${slotName}`] = val;
      }
    }
  }

  return map;
}
