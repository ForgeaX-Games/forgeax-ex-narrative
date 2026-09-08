/**
 * universal-narrative.ts (B-M3)
 * ─────────────────────────────────────────────────────────────────
 * 通用叙事 Agent — 把 branch_tree / dialogue_script / cinematic_storyboard
 * 三个 stub step 用 universal-agent 三件套统一调度。
 *
 * 子能力（capability）：
 *   - branch_tree         needsKeys: [S]   minNeed: 1   永远启用（剧情结构是叙事生产前置）
 *   - dialogue_script     needsKeys: [D]   minNeed: 2   高对话强度品类才跑
 *   - cinematic_storyboard needsKeys: [E,D] minNeed: 3   仅视觉影游 / 高表现品类
 *
 * 兼容策略：
 *   - 保留 3 个原 stub 函数（branch_tree.ts / dialogue_script.ts / cinematic_storyboard.ts）
 *     的 step ID 与导出函数签名 — 它们改为薄包装，内部调用本文件提供的 capability。
 *   - PromptComposer 的 prompt 内容不变，仅把 LLM 调用 + 解析抽到 capability 中。
 *   - 评估器默认开启，但原 stub 单独调用时 capability 仅 1 项 → 评估开销可控。
 */

import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../../runtime/prompt-composer.js";
import type { Capability, CapabilityContext } from "./index.js";

/**
 * Capability factory — 给定一个 PromptComposer 与解析函数，构造对应 capability。
 *
 * 复用 PromptComposer 的好处：
 *   - 现有 stub 已有 composer 定义，capability 只需"挂上去"
 *   - skill block 通过 ctx.tier_detection.genre_code 自动注入 composer 的 skillSlots
 */
export function createComposerCapability<TParsed>(args: {
  id: string;
  description: string;
  needsKeys: Capability["needsKeys"];
  minNeed?: Capability["minNeed"];
  composer: PromptComposer;
  parse: (raw: string) => TParsed;
  /** 写入 ctx 的字段名（可与 capability id 不同） */
  outputField: string;
  /** 前置依赖检查；不通过时返回占位输出而不调 LLM */
  preflight?: (ctx: NarrativeContext) => { skip: true; placeholder: TParsed } | { skip: false } | undefined;
  /** LLM temperature，默认 0.7 */
  temperature?: number;
}): Capability {
  return {
    id: args.id,
    description: args.description,
    needsKeys: args.needsKeys,
    minNeed: args.minNeed,
    execute: async (ctx, llm, capCtx) => {
      // 前置依赖检查：例如 dialogue_script 需要 branch_tree 已存在
      if (args.preflight) {
        const result = args.preflight(ctx);
        if (result?.skip) {
          (ctx as Record<string, unknown>)[args.outputField] = result.placeholder;
          return result.placeholder;
        }
      }
      // attempt > 0 时 ctx 上有 retry hint，capability 把它附加到 user prompt 末尾
      const sp = composeSystemPrompt(args.composer, ctx);
      let up = composeUserPrompt(args.composer, ctx);
      const hint = (ctx as Record<string, unknown>).__universal_agent_retry_hint;
      if (typeof hint === "string" && hint.trim()) {
        up = `${up}\n\n## 评估器修正建议（上次产出未达标，请按此调整）\n${hint}`;
      }
      // Phase 3.5: 非 RPG 模板的复杂度通过 prompt tail 注入（不参数化）。
      // RPG 已通过 ctx.global_control_params.layer_controls / target_structure 参数化驱动；
      // 这里只对通用叙事 capability 生效（branch_tree / dialogue_script / cinematic_storyboard 等）。
      const tail = composeComplexityPromptTail(ctx.global_control_params?.complexity);
      if (tail) up = `${up}\n\n${tail}`;
      const raw = await llm.callWithRetry(sp, up, {
        responseFormat: "json",
        temperature: args.temperature ?? 0.7,
      });
      const parsed = args.parse(raw);
      (ctx as Record<string, unknown>)[args.outputField] = parsed;
      void capCtx; // skill 已通过 PromptComposer 隐式注入，capCtx 仅用于调试
      return parsed;
    },
  };
}

/**
 * 通用解析帮手：拿到 JSON 后返回；解析失败抛错（让 evaluator/runner 捕获）。
 */
export function parseJsonWithFallback<T>(
  raw: string,
  validate: (data: T) => boolean,
  fallbackKey?: string,
): T {
  const parsed = extractJSON<T>(raw);
  if (parsed && validate(parsed)) return parsed;
  if (fallbackKey && parsed && typeof parsed === "object") {
    const inner = (parsed as Record<string, unknown>)[fallbackKey];
    if (inner && validate(inner as T)) return inner as T;
  }
  throw new Error(`universal-narrative: JSON 解析失败 / 校验未通过`);
}

/**
 * Phase 3.5: 复杂度档位 → 提示词尾巴。
 *
 * 用户拍板：除"自动"路由外，所有 tier 任何品类都可自由选 1-5 档复杂度。
 * RPG 模板（tpl-rpg）通过参数化 layer_controls / target_structure 驱动 L0-5 节点数；
 * 非 RPG 模板（VN/影游/卡牌/涌现/Tier4 等）通过 prompt tail 注入控制篇幅，不参数化。
 *
 * 档位映射（与前端 COMPLEXITY_LEVELS 对齐）：
 *   1 极简：5-10 节点；2 短篇：15-25；3 标准：35-50；4 丰富：75-100；5 史诗：100+
 *
 * 节点数仅供 LLM 参考，最终篇幅由 capability 类型 + 模板预设节奏决定。
 */
export function composeComplexityPromptTail(complexity: number | undefined): string {
  if (complexity == null) return "";
  const c = Math.round(Math.max(1, Math.min(5, complexity)));
  const presets: Record<number, { label: string; hint: string }> = {
    1: { label: "极简", hint: "节奏紧凑，仅保留核心冲突与必要枝节，篇幅控制在最短可行范围（约 5-10 节点 / 单场景仅 1-2 段）。避免任何附加铺垫。" },
    2: { label: "短篇", hint: "聚焦主线，少量分支，篇幅约 15-25 节点 / 单场景 2-4 段。可有轻量的支线或闪回，但不展开。" },
    3: { label: "标准", hint: "主线 + 标准量分支，篇幅约 35-50 节点 / 单场景 4-6 段。允许常规的人物刻画与世界观铺设。" },
    4: { label: "丰富", hint: "主线 + 多分支 + 充足支线，篇幅约 75-100 节点 / 单场景 6-10 段。允许完整的人物弧光与世界观深挖。" },
    5: { label: "史诗", hint: "宏大叙事，多线并进，篇幅 100+ 节点 / 单场景可达 10+ 段。鼓励复杂多视角与长篇铺陈。" },
  };
  const preset = presets[c];
  if (!preset) return "";
  return `## 复杂度要求（用户档位 ${c} / ${preset.label}）\n${preset.hint}\n\n请严格按此档位的篇幅与节奏组织产出，避免对当前任务的篇幅做主观加码或缩水。`;
}
