/**
 * universal-agent/chunked-capability.ts (Stage C - 重构 R)
 * ─────────────────────────────────────────────────────────────────
 * 把"长剧分幕"工作模式从 step 文件下沉到 universal-agent 框架，作为标准件。
 *
 * 原本 branch_tree / dialogue_script / cinematic_storyboard 各自实现一份 chunked 流程
 * （macro → micro × N → cross-act check → merge），现在统一抽象为：
 *
 *   createAdaptiveCapability({
 *     singleShot: {...},     // 短剧路径（必需）
 *     chunked: {             // 长剧路径（可选）
 *       enable, actsPlan, perAct, crossActCheck, merge,
 *     }
 *   })
 *
 * 工作模式判定（运行时自路由）：
 *   chunked && chunked.enable(ctx) === true → 走长剧 chunked
 *   否则                                     → 走短剧 single-shot
 *
 * 设计原则：
 *  - 与 createComposerCapability 接口对齐（短剧端不动）
 *  - 长剧端把 prompt 构建权交给调用方（每个 step 业务上下文不同）
 *  - 截断检测、64K maxTokens、严格 JSON tail 由本框架统一注入
 *  - LLM 失败仍走 callWithRetry 内置重试（300s × 3）
 */
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { type PromptComposer, composeSystemPrompt, composeUserPrompt } from "../../runtime/prompt-composer.js";
import {
  CHUNKED_LLM_OPTIONS,
  STRICT_JSON_PROMPT_TAIL,
  assertJsonNotTruncated,
} from "../../runtime/chunked-llm-options.js";
import type { Capability, CapabilityContext } from "./types.js";

/* ───────────── Chunking 框架级类型 ───────────── */

/**
 * 标准幕数据。每幕由长剧 macro 生成或从 ctx 消费。
 * 必填字段：act_id / title。其它字段由 step 自行扩展（如 emotional_arc / key_events / duration_minutes）。
 */
export interface ActPlan {
  act_id: string;
  title: string;
  summary?: string;
  [key: string]: unknown;
}

/** Chunking 阶段结果，用于内部 logging 和 errors。 */
export interface ChunkedPhaseLog {
  phase: "actsPlan" | "perAct" | "crossActCheck" | "merge";
  detail?: string;
}

/* ───────────── Spec 接口 ───────────── */

interface PromptPair {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * 长剧 chunked 配置。所有字段中，actsPlan / perAct / merge 是必需的；crossActCheck 可选。
 */
export interface ChunkedConfig<TFinal, TPerActOutput, TActsList = unknown, TCheckResult = unknown> {
  /** 何时启用 chunked 模式（短剧/不支持的品类返回 false 走 singleShot） */
  enable: (ctx: NarrativeContext) => boolean;

  /**
   * Phase 1：决定 acts 列表。
   *  - "produce" 模式：本 capability 自己跑一次 LLM 生成幕骨架（如 branch_tree.macro_plan）
   *  - "consume" 模式：从 ctx 上读取（如 dialogue / storyboard 从 ctx.branch_tree.acts 取）
   */
  actsPlan:
    | {
        mode: "produce";
        buildPrompt: (ctx: NarrativeContext) => PromptPair;
        parse: (raw: string) => TActsList;
        /** 截断检测 label，会出现在日志中 */
        truncationLabel: string;
        temperature?: number;
      }
    | {
        mode: "consume";
        /** 从 ctx 读取 acts list；返回 undefined → 直接走 emptyOnMissingActs 兜底 */
        source: (ctx: NarrativeContext) => TActsList | undefined;
        /** 缺 acts 时的兜底输出（避免抛错），通常是空集合 */
        emptyOnMissingActs: () => TFinal;
      };

  /** 从 actsList 提取 ActPlan[]（用于 micro 循环和日志） */
  extractActs: (actsList: TActsList) => ActPlan[];

  /**
   * Phase 2：每幕一次 LLM。
   * buildPrompt 接收当前幕、索引、总数、完整 ctx 和 actsList（含跨幕 pivot 等元数据）。
   */
  perAct: {
    buildPrompt: (
      act: ActPlan,
      idx: number,
      total: number,
      ctx: NarrativeContext,
      actsList: TActsList,
    ) => PromptPair;
    parse: (raw: string, act: ActPlan, idx: number) => TPerActOutput;
    truncationLabel: (act: ActPlan, idx: number) => string;
    temperature?: number;
    /** 单幕 LLM 失败时是否吞掉返回 null（true）还是抛出（false）。默认 true，跳过该幕继续。 */
    swallowError?: boolean;
  };

  /**
   * Phase 3（可选）：跨幕一致性检查 + patch 应用。
   * 仅 producer 模式（branch_tree）使用；consumer 模式（dialogue / storyboard）通常不需要。
   */
  crossActCheck?: {
    buildPrompt: (
      actsList: TActsList,
      micros: TPerActOutput[],
      ctx: NarrativeContext,
    ) => PromptPair;
    parse: (raw: string) => TCheckResult;
    apply: (micros: TPerActOutput[], check: TCheckResult) => TPerActOutput[];
    /** LLM 失败时降级输出（如返回空 patches）；不提供则失败时抛出。 */
    onFailure?: () => TCheckResult;
    truncationLabel: string;
    temperature?: number;
  };

  /**
   * Phase 4：合并 actsList + 全部 micros + check 为最终输出。
   * 写入 ctx[outputField]。
   */
  merge: (
    actsList: TActsList,
    micros: TPerActOutput[],
    check: TCheckResult | undefined,
    ctx: NarrativeContext,
  ) => TFinal;
}

/**
 * 短剧 single-shot 路径。复用 createComposerCapability 的接口形态。
 */
export interface SingleShotConfig<TFinal> {
  composer: PromptComposer;
  parse: (raw: string) => TFinal;
  temperature?: number;
}

/**
 * 自适应 capability spec：单 spec 描述短剧 + 长剧两条路径。
 */
export interface AdaptiveCapabilitySpec<TFinal, TPerActOutput = unknown, TActsList = unknown, TCheckResult = unknown> {
  id: string;
  description: string;
  needsKeys: Capability["needsKeys"];
  minNeed?: Capability["minNeed"];
  outputField: string;

  /**
   * 前置依赖检查：未通过时直接写占位输出，不调任何 LLM。
   */
  preflight?: (ctx: NarrativeContext) => { skip: true; placeholder: TFinal } | { skip: false } | undefined;

  /** 短剧路径（必需） */
  singleShot: SingleShotConfig<TFinal>;

  /** 长剧路径（可选；不提供 → 永远走短剧） */
  chunked?: ChunkedConfig<TFinal, TPerActOutput, TActsList, TCheckResult>;
}

/* ───────────── 内部：执行单次 LLM 调用（带截断检测 + 严格 JSON tail） ───────────── */

async function runChunkedLLMCall(
  llm: LLMClient,
  prompt: PromptPair,
  truncationLabel: string,
  temperature: number,
): Promise<string> {
  const sp = prompt.systemPrompt + STRICT_JSON_PROMPT_TAIL;
  return llm.callWithRetry(
    sp,
    prompt.userPrompt,
    { ...CHUNKED_LLM_OPTIONS, temperature },
    (raw) => assertJsonNotTruncated(raw, truncationLabel),
  );
}

/* ───────────── 内部：长剧 chunked 主流程 ───────────── */

async function runChunkedFlow<TFinal, TPerActOutput, TActsList, TCheckResult>(
  ctx: NarrativeContext,
  llm: LLMClient,
  cfg: ChunkedConfig<TFinal, TPerActOutput, TActsList, TCheckResult>,
  capabilityId: string,
): Promise<TFinal> {
  const debug = process.env.NARRATIVE_AGENT_DEBUG === "1";
  const log = (msg: string): void => {
    if (debug) console.log(`[adaptive-capability:${capabilityId}] ${msg}`);
    // 即使非 debug 也输出 phase 级粗粒度日志，方便长剧场景观察进度
  };

  // ── Phase 1: actsPlan ──
  let actsList: TActsList;
  if (cfg.actsPlan.mode === "produce") {
    log(`Phase 1: produce acts plan`);
    const prompt = cfg.actsPlan.buildPrompt(ctx);
    const raw = await runChunkedLLMCall(
      llm,
      prompt,
      cfg.actsPlan.truncationLabel,
      cfg.actsPlan.temperature ?? 0.7,
    );
    actsList = cfg.actsPlan.parse(raw);
  } else {
    const consumed = cfg.actsPlan.source(ctx);
    if (consumed == null) {
      log(`Phase 1: consume acts plan — MISSING, falling back to empty`);
      return cfg.actsPlan.emptyOnMissingActs();
    }
    log(`Phase 1: consume acts plan (from ctx)`);
    actsList = consumed;
  }

  const acts = cfg.extractActs(actsList);
  log(`acts resolved: ${acts.length} acts (${acts.map((a) => a.act_id).join(", ")})`);

  // ── Phase 2: perAct micros ──
  // 用 let 而不是 const，方便 Phase 3 整体重新赋值（避免 patched === micros 自身导致 splice 自吃）
  let micros: TPerActOutput[] = [];
  const swallow = cfg.perAct.swallowError !== false; // 默认 true
  for (let i = 0; i < acts.length; i++) {
    const act = acts[i];
    log(`Phase 2: perAct micro ${i + 1}/${acts.length} act=${act.act_id}`);
    try {
      const prompt = cfg.perAct.buildPrompt(act, i, acts.length, ctx, actsList);
      const raw = await runChunkedLLMCall(
        llm,
        prompt,
        cfg.perAct.truncationLabel(act, i),
        cfg.perAct.temperature ?? 0.7,
      );
      micros.push(cfg.perAct.parse(raw, act, i));
    } catch (e) {
      if (swallow) {
        console.warn(
          `[adaptive-capability:${capabilityId}] perAct ${act.act_id} failed: ${(e as Error).message} — skipping`,
        );
      } else {
        throw e;
      }
    }
  }

  // ── Phase 3: crossActCheck (可选) ──
  let check: TCheckResult | undefined;
  if (cfg.crossActCheck) {
    log(`Phase 3: crossActCheck`);
    try {
      const prompt = cfg.crossActCheck.buildPrompt(actsList, micros, ctx);
      const raw = await runChunkedLLMCall(
        llm,
        prompt,
        cfg.crossActCheck.truncationLabel,
        cfg.crossActCheck.temperature ?? 0.3,
      );
      check = cfg.crossActCheck.parse(raw);
      // apply 可以返回新数组或同引用都行：直接整体重新赋值更安全
      micros = cfg.crossActCheck.apply(micros, check);
    } catch (e) {
      const msg = (e as Error).message;
      if (cfg.crossActCheck.onFailure) {
        console.warn(`[adaptive-capability:${capabilityId}] crossActCheck failed: ${msg} — applying onFailure fallback`);
        check = cfg.crossActCheck.onFailure();
      } else {
        throw e;
      }
    }
  }

  // ── Phase 4: merge ──
  log(`Phase 4: merge`);
  return cfg.merge(actsList, micros, check, ctx);
}

/* ───────────── 内部：短剧 single-shot ───────────── */

async function runSingleShot<TFinal>(
  ctx: NarrativeContext,
  llm: LLMClient,
  cfg: SingleShotConfig<TFinal>,
  capabilityId: string,
): Promise<TFinal> {
  // 与 chunked 路径对齐：
  //   1. system prompt 追加 STRICT_JSON_PROMPT_TAIL，强化"无 markdown / 无注释 / 无尾逗号"
  //   2. 使用 CHUNKED_LLM_OPTIONS（maxOutputTokens=65536，避免 16K 默认上限造成 26K 处截断）
  //   3. 通过 assertJsonNotTruncated 触发 callWithRetry 的 3 次自动重试
  const sp = composeSystemPrompt(cfg.composer, ctx) + STRICT_JSON_PROMPT_TAIL;
  let up = composeUserPrompt(cfg.composer, ctx);
  const hint = (ctx as Record<string, unknown>).__universal_agent_retry_hint;
  if (typeof hint === "string" && hint.trim()) {
    up = `${up}\n\n## 评估器修正建议（上次产出未达标，请按此调整）\n${hint}`;
  }
  const raw = await llm.callWithRetry(
    sp,
    up,
    { ...CHUNKED_LLM_OPTIONS, temperature: cfg.temperature ?? 0.7 },
    (raw) => assertJsonNotTruncated(raw, `singleShot.${capabilityId}`),
  );
  return cfg.parse(raw);
}

/* ───────────── 主入口：createAdaptiveCapability ───────────── */

/**
 * 自适应 capability 工厂：单 spec 同时描述短剧 single-shot 与长剧 chunked 路径。
 *
 * 路由逻辑：
 *   1. preflight 命中 skip → 写占位，不调 LLM
 *   2. chunked 提供 + chunked.enable(ctx) 返回 true → 走长剧 chunked 流程
 *   3. 否则 → 走短剧 singleShot
 *
 * 写 ctx[spec.outputField] 由本函数完成，调用方无需手动赋值。
 */
export function createAdaptiveCapability<
  TFinal,
  TPerActOutput = unknown,
  TActsList = unknown,
  TCheckResult = unknown,
>(spec: AdaptiveCapabilitySpec<TFinal, TPerActOutput, TActsList, TCheckResult>): Capability {
  return {
    id: spec.id,
    description: spec.description,
    needsKeys: spec.needsKeys,
    minNeed: spec.minNeed,
    execute: async (ctx, llm, capCtx: CapabilityContext) => {
      // 前置检查
      if (spec.preflight) {
        const result = spec.preflight(ctx);
        if (result?.skip) {
          (ctx as Record<string, unknown>)[spec.outputField] = result.placeholder;
          return result.placeholder;
        }
      }

      // 路由决策
      const useChunked = !!spec.chunked && spec.chunked.enable(ctx);
      if (process.env.NARRATIVE_AGENT_DEBUG === "1") {
        console.log(`[adaptive-capability:${spec.id}] route → ${useChunked ? "chunked (long-form)" : "single-shot (short-form)"}`);
      }

      let output: TFinal;
      if (useChunked && spec.chunked) {
        output = await runChunkedFlow(ctx, llm, spec.chunked, spec.id);
      } else {
        output = await runSingleShot(ctx, llm, spec.singleShot, spec.id);
      }

      (ctx as Record<string, unknown>)[spec.outputField] = output;
      void capCtx; // skill 通过 PromptComposer 隐式注入；capCtx 仅作日志/调试
      return output;
    },
  };
}
