/**
 * step-output.ts — 「某一步产出哪个 ctx 字段」的唯一解析入口
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么要有这个文件
 * ─────────────────────────────────────────────────────────────────
 * 这件事实原先记在四处：`AgentDataContract.outputField`（单席路径消费）、
 * `StepDescriptor.extractOutputKey`（注册表）、`Pipeline.extractStepOutput`
 * 与 `server.ts` 的 `STEP_CTX_KEY`。后两处是手写字面量，注册新步时很容易只
 * 记得写注册表而忘了同步它们。
 *
 * 忘了的后果不是报错，是静默丢产物：管线路径的 SSE 帧由 extractStepOutput
 * 生成，`saveStepIncremental` 的闸门是 `if (!fileDef || data == null) return`，
 * 取不到值就当没这一步——步骤照跑、照烧 LLM 调用，跑完什么都没有。检查席、
 * 打磨席、百科娘七个步就是这么丢的，而结构检查与内容检查还正好是
 * `pl-narrative` 的最后两步。
 *
 * 所以这里把解析收成一处：先查复合表，再查注册表，最后查封存表。注册表是
 * 主路径，新步只要注册就自动通；复合与封存是两张明确列举的小表，加条目要
 * 有理由。`step-output.test.ts` 守着「注册表里每个 extractOutputKey 都取得到」。
 */
import { STEP_REGISTRY } from "./step-registry.js";
import type { NarrativeContext } from "../../types/index.js";

type CtxRecord = Record<string, unknown>;

/**
 * 复合产出：一步写多个 ctx 字段，落盘要的是聚合视图而不是其中某一个字段。
 *
 * 这类步不能用单字段表达，所以显式列举。`read` 给落盘/SSE 用，`write` 给
 * 用户改稿回写用（两者必须对称，否则编辑保存后会把聚合对象整个塞进某个
 * 子字段）。
 */
interface CompositeOutput {
  read: (ctx: CtxRecord) => unknown;
  write: (ctx: CtxRecord, value: unknown) => boolean;
}

const COMPOSITE_OUTPUTS: Record<string, CompositeOutput> = {
  // 初步方案一步直出三段。按单字段取只会拿到 outline 那一段，
  // 前端编辑器会丢掉另外两段。
  initial_plan: {
    read: (ctx) => {
      const outline = ctx.initial_story_outline;
      const cs = ctx.core_settings;
      const ps = ctx.plot_synopsis;
      if (outline == null && cs == null && ps == null) return undefined;
      return { initial_story_outline: outline, core_settings: cs, plot_synopsis: ps };
    },
    write: (ctx, value) => {
      if (typeof value !== "object" || value == null) return false;
      const v = value as CtxRecord;
      if (v.initial_story_outline != null) ctx.initial_story_outline = v.initial_story_outline;
      if (v.core_settings != null) ctx.core_settings = v.core_settings;
      if (v.plot_synopsis != null) ctx.plot_synopsis = v.plot_synopsis;
      return true;
    },
  },

  // 剧本与场景耦合步：一步同时推进两份产物。
  script_scene_generation: {
    read: (ctx) => {
      if (ctx.jrpg_script == null && ctx.scene_map == null) return undefined;
      return { jrpg_script: ctx.jrpg_script, scene_map: ctx.scene_map };
    },
    write: (ctx, value) => {
      if (typeof value !== "object" || value == null) return false;
      const v = value as CtxRecord;
      if (v.jrpg_script != null) ctx.jrpg_script = v.jrpg_script;
      if (v.scene_map != null) ctx.scene_map = v.scene_map;
      return true;
    },
  },

  // 三幕扩写附带人物小传与关键道具：运行期前端 activeResult 还是 null，
  // 靠这一帧把线路2 一并送到画布。
  vn_outline_acts: {
    read: (ctx) => {
      if (ctx.vn_outline_acts == null) return undefined;
      return {
        ...(ctx.vn_outline_acts as CtxRecord),
        character_bios: ctx.vn_character_bios ?? null,
        key_items: ctx.vn_key_items ?? null,
      };
    },
    write: (ctx, value) => {
      if (typeof value !== "object" || value == null) return false;
      ctx.vn_outline_acts = value;
      return true;
    },
  },
};

/**
 * 已封存步骤的 ctx 字段。
 *
 * 实现本体在 `_archive/` 下、不在注册表里，所以派生不到。留着只为让旧存档
 * 还能被读出来回放——新步不该往这张表加东西。
 */
const ARCHIVED_CTX_KEYS: Record<string, string> = {
  // C2 封存：tpl-vn 专属三步
  branch_tree: "branch_tree",
  dialogue_script: "dialogue_script",
  cinematic_storyboard: "cinematic_storyboard",
  // C3 封存：特化四步
  region_design: "regions",
  emergent_event: "emergent_events",
  card_lore: "card_lore",
  event_pool: "event_pool",
  // tpl-vn-v2 专属步
  vn_logline: "vn_logline",
  vn_character_bios: "vn_character_bios",
  vn_key_items: "vn_key_items",
  vn_scenes: "vn_scenes",
  vn_beats: "vn_beats",
  vn_script_normalize: "vn_script_normalized",
  vn_segment_confirm: "vn_segment_confirmed",
  vn_branched_beats: "vn_branched_beats",
  vn_state_ledger: "world_state_ledger",
  vn_screenplay: "vn_screenplay",
  vn_storyboard: "vn_storyboard",
  vn_video_prompts: "vn_video_prompts",
  // 旧独立步：现已并进 initial_plan，仍可能出现在旧存档的编辑记录里
  initial_outline: "initial_story_outline",
  core_settings: "core_settings",
  plot_synopsis: "plot_synopsis",
  // 换实现时改了 id 但产物是同一份，落盘文件名也共用（见 STEP_FILE_MAP 的两处同名条目）
  scene_generation: "scene_map",
  vn_structure_check: "structure_check_report",
};

/**
 * 伴生字段与路由元数据的落盘键。
 *
 * 这些不是 step，是「跟着某一步一起写出去的附加产物」（见 server 的
 * STEP_COMPANIONS）与路由阶段的元数据。它们各有 STEP_FILE_MAP 条目，
 * 所以也要能按 id 取值。键名与字段名同名，列出来是为了显式而非兜底。
 */
const COMPANION_CTX_KEYS: Record<string, string> = {
  tier_detection: "tier_detection",
  demand_analysis: "demand_analysis",
  global_control_params: "global_control_params",
  narrative_requirements: "narrative_requirements",
  item_lore: "item_lore",
};

/**
 * 某一步对应的单个 ctx 字段名。复合产出返回 undefined——它们没有「一个字段」。
 *
 * 优先级：注册表 → 封存表 → 伴生表。注册表排第一，是为了让新步「注册即通」。
 */
export function stepOutputCtxKey(stepId: string): string | undefined {
  if (COMPOSITE_OUTPUTS[stepId]) return undefined;
  const desc = STEP_REGISTRY.get(stepId);
  if (desc) return desc.extractOutputKey ?? desc.outputFields[0];
  return ARCHIVED_CTX_KEYS[stepId] ?? COMPANION_CTX_KEYS[stepId];
}

/**
 * 取某一步产物的完整内容（落盘文件与 SSE data 帧用的是同一份）。
 *
 * 取不到返回 undefined。调用方一律按 `== null` 判断，不区分 undefined 与 null。
 */
export function resolveStepOutput(stepId: string, ctx: NarrativeContext): unknown {
  const ctxRaw = ctx as CtxRecord;
  const composite = COMPOSITE_OUTPUTS[stepId];
  if (composite) return composite.read(ctxRaw);
  const key = stepOutputCtxKey(stepId);
  if (!key) return undefined;
  return ctxRaw[key];
}

/**
 * 把内容写回 ctx。与 resolveStepOutput 对称——用户改稿保存走这条路。
 *
 * 返回 false 表示这一步没有可写的落点（未知 step），调用方据此拒绝改稿。
 */
export function applyStepOutput(
  stepId: string,
  ctx: NarrativeContext,
  value: unknown,
): boolean {
  const ctxRaw = ctx as CtxRecord;
  const composite = COMPOSITE_OUTPUTS[stepId];
  if (composite) return composite.write(ctxRaw, value);
  const key = stepOutputCtxKey(stepId);
  if (!key) return false;
  ctxRaw[key] = value;
  return true;
}

/** 契约测试用：复合产出的 step id 清单。 */
export function compositeOutputStepIds(): string[] {
  return Object.keys(COMPOSITE_OUTPUTS);
}
