/**
 * universal-agent/evaluator.ts  (B-M2)
 * ─────────────────────────────────────────────────────────────────
 * 评估器：对 Executor 的聚合输出打分，决定是否重试。
 *
 * 简易版（M2）：
 *   - 默认接 narrative-USC/skills/lab_prompts/evaluator_skill.md 作为 system prompt
 *   - 输出格式：{ score: 0-1, reasoning: string, improvement?: string }
 *   - score < minScore 触发 retry，retry 时把 improvementHint 拼到下次 user prompt
 *
 * 当 evaluator.disabled=true 或环境变量 NARRATIVE_DISABLE_EVAL=1 时跳过评估。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import type { EvaluatorSpec, EvaluatorVerdict } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EVALUATOR_MD_PATH = path.resolve(
  __dirname,
  "../../../knowledge/game-narrative/skills/narrative-USC/skills/lab_prompts/evaluator_skill.md",
);

const FALLBACK_SYSTEM_PROMPT = `你是叙事内容质量评估器。基于下列产出评估"创意爆点 + 生产可行性"双维度。
输出严格 JSON：
{
  "score": 0-1 浮点数（0.6 为及格线）,
  "reasoning": "一段 50-150 字的诊断（指出强项 + 主要弱点）",
  "improvement": "若 score < 0.6，必须给出 1-3 条可执行的修正建议"
}
仅当输入明显违反硬性约束（脱离题材、空洞重复、违反世界观）时才低分；通常给 0.6-0.85 之间的分数。`;

let CACHED_SYSTEM_PROMPT: string | null = null;

/**
 * 加载评估器系统提示词（一次性）。
 */
function loadEvaluatorSystemPrompt(): string {
  if (CACHED_SYSTEM_PROMPT) return CACHED_SYSTEM_PROMPT;
  try {
    const raw = fs.readFileSync(EVALUATOR_MD_PATH, "utf-8");
    // 跳过 YAML frontmatter
    let body = raw;
    if (raw.startsWith("---")) {
      const end = raw.indexOf("\n---", 3);
      if (end > 0) body = raw.slice(end + 4).trimStart();
    }
    if (body.trim().length < 50) {
      CACHED_SYSTEM_PROMPT = FALLBACK_SYSTEM_PROMPT;
    } else {
      // 在 md 后追加 JSON 输出格式约束（md 本身不强制格式）
      CACHED_SYSTEM_PROMPT = `${body}\n\n## 强制输出格式\n${FALLBACK_SYSTEM_PROMPT}`;
    }
  } catch {
    CACHED_SYSTEM_PROMPT = FALLBACK_SYSTEM_PROMPT;
  }
  return CACHED_SYSTEM_PROMPT;
}

/**
 * 调用 LLM 评估一段叙事产出。
 *
 * 失败安全：任何异常都返回"通过"（避免评估器把好内容卡掉）。
 */
export async function evaluateOutput<TOutput>(
  output: TOutput,
  spec: EvaluatorSpec | undefined,
  llm: LLMClient,
  contextHint: string,
): Promise<EvaluatorVerdict> {
  if (spec?.disabled || process.env.NARRATIVE_DISABLE_EVAL === "1") {
    return { score: 1, passed: true, reasoning: "evaluator disabled" };
  }

  const minScore = spec?.minScore ?? 0.6;
  const systemPrompt = spec?.systemPrompt ?? loadEvaluatorSystemPrompt();
  const userPrompt = `## 上下文\n${contextHint}\n\n## 待评估产出\n${truncateForEval(output)}\n\n请输出 JSON 评估。`;

  try {
    const raw = await llm.callWithRetry(systemPrompt, userPrompt, {
      responseFormat: "json",
      temperature: 0.2,
    });
    const parsed = extractJSON<{ score?: number; reasoning?: string; improvement?: string }>(raw);
    const score = clampScore(parsed.score);
    const reasoning = parsed.reasoning ?? "";
    const improvementHint = parsed.improvement;
    return {
      score,
      passed: score >= minScore,
      reasoning,
      improvementHint,
    };
  } catch (err) {
    // 评估器自身失败：开放通过，避免卡死管线
    console.warn(`[universal-agent/evaluator] evaluation failed, fail-open:`, (err as Error).message);
    return { score: 1, passed: true, reasoning: `evaluator error: ${(err as Error).message}` };
  }
}

function clampScore(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0.6;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function truncateForEval(output: unknown): string {
  let text: string;
  try {
    text = typeof output === "string" ? output : JSON.stringify(output);
  } catch {
    text = String(output);
  }
  const MAX = 4000;
  if (text.length <= MAX) return text;
  return text.slice(0, MAX) + `\n\n…（已截断 ${text.length - MAX} 字符）`;
}
