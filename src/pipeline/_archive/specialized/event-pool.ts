/**
 * event-pool.ts (F3)
 * ─────────────────────────────────────────────────────────────────
 * 卡牌游戏 / 运营叙事的事件池：每日/每周/赛季的随机事件供运行时抽取。
 *
 * 使用 PromptComposer 模式，CCG / 运营驱动品类的 skill 通过
 * event_pool.slots.* 注入运营节奏、奖励曲线、剧情节点规则。
 *
 * C3（2026-08）已封存：不再被任何活跃代码 import。业务功能（运营节奏/奖励
 * 曲线/剧情节点）吸收进通用 `plot_generation`，形态差异交给 `fragmented.md`
 * 结构卡；needs 门控（原 needs.S>=1 或 needs.Q>=1）改由品类 skill 选择承担。
 * 详见 `../README.md` 吸收台账。
 */
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { type PromptComposer } from "../../runtime/prompt-composer.js";
import { runUniversalAgent } from "../universal-agent/index.js";
import { createComposerCapability } from "../universal-agent/universal-narrative.js";

const ROLE = `你是卡牌 / 运营游戏的事件池设计师。基于世界观与势力，输出 20-40 个可被运行时随机抽取的事件。`;

const TASK = `## 任务
- daily / weekly / seasonal / story 四个池都要覆盖
- daily / weekly 偏轻量随机，奖励微小但稳定
- seasonal 配合赛季主题，节奏紧凑（4-8 周）
- story 类有解锁条件、剧情推进、里程碑奖励`;

const STYLE_PLACEHOLDER = `## 运营文学调性
{{SKILL.style_guide}}`;

const PACING_PLACEHOLDER = `## 节奏 / 推送规则
{{SKILL.pacing_rules}}`;

const REWARD_PLACEHOLDER = `## 奖励曲线
{{SKILL.reward_rules}}`;

const CONSTRAINTS_PLACEHOLDER = `## 硬性约束
{{SKILL.constraints}}`;

const OUTPUT_FORMAT = `## 输出格式（严格 JSON）
{
  "pools": {
    "daily": [
      {
        "id": "EV_D_01",
        "name": "事件名",
        "narrative": "事件描述（2 句）",
        "rewards": ["奖励条目"],
        "weight": 数字
      }
    ],
    "weekly": [],
    "seasonal": [],
    "story": [
      { "id": "EV_S_01", "name": "...", "narrative": "...", "unlock": "解锁条件", "rewards": [] }
    ]
  }
}`;

const USER_CONTEXT = (ctx: NarrativeContext): string => {
  const wv = ctx.worldview_structure
    ? JSON.stringify(ctx.worldview_structure).slice(0, 1500)
    : "";
  const ctxRaw = ctx as Record<string, unknown>;
  const cards = ctxRaw.card_lore ? JSON.stringify(ctxRaw.card_lore).slice(0, 1500) : "";
  return `## 世界观\n${wv}\n\n## 已有卡牌 Lore（如有）\n${cards}\n\n## 用户原始需求\n${ctx.user_input}\n\n请输出事件池 JSON。`;
};

const EVENT_POOL_COMPOSER: PromptComposer = {
  stepId: "event_pool",
  blocks: {
    role: ROLE,
    task: TASK,
    style: STYLE_PLACEHOLDER,
    pacing: PACING_PLACEHOLDER,
    reward: REWARD_PLACEHOLDER,
    constraints: CONSTRAINTS_PLACEHOLDER,
    output_format: OUTPUT_FORMAT,
    user_context: USER_CONTEXT,
  },
  systemBlockOrder: [
    "role",
    "task",
    "style",
    "pacing",
    "reward",
    "constraints",
    "output_format",
  ],
  userBlockOrder: ["user_context"],
  skillSlots: ["style_guide", "pacing_rules", "reward_rules", "constraints"],
};

interface EventPools {
  daily: unknown[];
  weekly: unknown[];
  seasonal: unknown[];
  story: unknown[];
}

interface EventPoolOutput {
  pools: EventPools;
}

const EMPTY_POOLS: EventPools = { daily: [], weekly: [], seasonal: [], story: [] };

/**
 * B-M5: 通过 universal-agent 框架执行。
 *
 * 启用条件：needs.S >= 1 或 needs.Q >= 1（CCG / 运营叙事品类）
 * 输出字段：ctx.event_pool（{ pools: { daily, weekly, seasonal, story } }）
 */
export const eventPoolCapability = createComposerCapability<EventPoolOutput>({
  id: "event_pool",
  description: "运营事件池（daily/weekly/seasonal/story）",
  needsKeys: ["S", "Q"],
  minNeed: 1,
  composer: EVENT_POOL_COMPOSER,
  outputField: "event_pool",
  temperature: 0.75,
  parse: (raw) => {
    const parsed = extractJSON<{ pools?: Partial<EventPools> }>(raw);
    if (parsed && parsed.pools && typeof parsed.pools === "object") {
      return {
        pools: {
          daily: Array.isArray(parsed.pools.daily) ? parsed.pools.daily : [],
          weekly: Array.isArray(parsed.pools.weekly) ? parsed.pools.weekly : [],
          seasonal: Array.isArray(parsed.pools.seasonal) ? parsed.pools.seasonal : [],
          story: Array.isArray(parsed.pools.story) ? parsed.pools.story : [],
        },
      };
    }
    return { pools: { ...EMPTY_POOLS } };
  },
});

export async function eventPool(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  await runUniversalAgent(
    {
      stepId: "event_pool",
      name: "EventPoolAgent",
      outputField: "event_pool",
      capabilities: [eventPoolCapability],
      aggregate: (results) =>
        (results[0]?.output as EventPoolOutput) ?? { pools: { ...EMPTY_POOLS } },
      emptyFallback: () => ({ pools: { ...EMPTY_POOLS } }),
      evaluator: { disabled: true },
    },
    ctx,
    llm,
  );
}
