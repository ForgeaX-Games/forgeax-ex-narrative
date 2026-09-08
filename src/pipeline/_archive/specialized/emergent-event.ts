/**
 * emergent-event.ts (F2)
 * ─────────────────────────────────────────────────────────────────
 * 涌现性叙事事件模板：4X / 沙盒 / 开放世界共用。
 * 输出可参数化的事件模板，可在游戏运行时根据上下文动态选取触发。
 *
 * 使用 PromptComposer 模式，4X / 开放世界 / 沙盒类品类的 skill 通过
 * emergent_event.slots.* 注入事件分类策略、触发约束、平衡守则。
 *
 * C3（2026-08）已封存：不再被任何活跃代码 import。业务功能（事件分类/触发
 * 条件/平衡守则）吸收进通用 `plot_generation`，形态差异交给 `emergent.md`
 * 结构卡；needs 门控（原 needs.S>=1 或 needs.Q>=1）改由品类 skill 选择承担。
 * 详见 `../README.md` 吸收台账。
 */
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { type PromptComposer } from "../../runtime/prompt-composer.js";
import { runUniversalAgent } from "../universal-agent/index.js";
import { createComposerCapability } from "../universal-agent/universal-narrative.js";

const ROLE = `你是涌现性叙事事件设计师。基于世界观与势力，输出 15-30 个可在运行时触发的事件模板。`;

const TASK = `## 任务
- 事件类别多样化：encounter / moral_dilemma / faction_clash / discovery / disaster / opportunity 至少各覆盖 2 条
- 至少 30% 是道德困境或势力冲突
- 选项后果具体可量化（资源变动 / 势力关系 / 角色加入或离去 / 解锁区域）
- 触发条件清晰明确，可被游戏引擎读取（区域 + 时间 + 概率 + 前置事件）`;

const STYLE_PLACEHOLDER = `## 涌现叙事风格
{{SKILL.style_guide}}`;

const CATEGORY_PLACEHOLDER = `## 事件分类策略
{{SKILL.category_rules}}`;

const BALANCE_PLACEHOLDER = `## 平衡 / 触发守则
{{SKILL.balance_rules}}`;

const CONSTRAINTS_PLACEHOLDER = `## 硬性约束
{{SKILL.constraints}}`;

const OUTPUT_FORMAT = `## 输出格式（严格 JSON）
{
  "events": [
    {
      "id": "EV_01",
      "name": "事件名",
      "category": "encounter|moral_dilemma|faction_clash|discovery|disaster|opportunity",
      "trigger": "触发条件（如：玩家在 REG_03 区域 + 时间夜间 + 随机概率 30%）",
      "narrative": "事件叙事（2-4 句）",
      "options": [
        { "label": "选项文本", "outcome": "结果描述", "effect": "对资源/势力/角色的影响" }
      ],
      "weight": 1-10,
      "tags": ["标签便于运行时筛选"]
    }
  ]
}`;

const USER_CONTEXT = (ctx: NarrativeContext): string => {
  const wv = ctx.worldview_structure
    ? JSON.stringify(ctx.worldview_structure).slice(0, 1500)
    : "";
  const ctxRaw = ctx as Record<string, unknown>;
  const regions = ctxRaw.regions ? JSON.stringify(ctxRaw.regions).slice(0, 1500) : "";
  return `## 世界观\n${wv}\n\n## 区域\n${regions}\n\n## 用户原始需求\n${ctx.user_input}\n\n请输出事件模板 JSON。`;
};

const EMERGENT_EVENT_COMPOSER: PromptComposer = {
  stepId: "emergent_event",
  blocks: {
    role: ROLE,
    task: TASK,
    style: STYLE_PLACEHOLDER,
    category: CATEGORY_PLACEHOLDER,
    balance: BALANCE_PLACEHOLDER,
    constraints: CONSTRAINTS_PLACEHOLDER,
    output_format: OUTPUT_FORMAT,
    user_context: USER_CONTEXT,
  },
  systemBlockOrder: [
    "role",
    "task",
    "style",
    "category",
    "balance",
    "constraints",
    "output_format",
  ],
  userBlockOrder: ["user_context"],
  skillSlots: ["style_guide", "category_rules", "balance_rules", "constraints"],
};

/**
 * B-M4: 通过 universal-agent 框架执行。
 *
 * 启用条件：needs.S >= 1 或 needs.Q >= 1（4X / 沙盒 / 开放世界）
 * 输出字段：ctx.emergent_events（数组）
 */
export const emergentEventCapability = createComposerCapability<unknown[]>({
  id: "emergent_event",
  description: "涌现性叙事事件模板",
  needsKeys: ["S", "Q"],
  minNeed: 1,
  composer: EMERGENT_EVENT_COMPOSER,
  outputField: "emergent_events",
  temperature: 0.75,
  parse: (raw) => {
    const parsed = extractJSON<{ events?: unknown[] }>(raw);
    return Array.isArray(parsed?.events) ? parsed.events : [];
  },
});

export async function emergentEvent(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  await runUniversalAgent(
    {
      stepId: "emergent_event",
      name: "EmergentEventAgent",
      outputField: "emergent_events",
      capabilities: [emergentEventCapability],
      aggregate: (results) =>
        Array.isArray(results[0]?.output) ? (results[0]?.output as unknown[]) : [],
      emptyFallback: () => [],
      evaluator: { disabled: true },
    },
    ctx,
    llm,
  );
}
