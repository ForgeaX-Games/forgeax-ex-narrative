/**
 * chunked-llm-options.ts
 * ─────────────────────────────────────────────────────────────────
 * 长剧 chunked LLM 调用的共享配置 + 严格 JSON prompt 规约。
 *
 * 重要：单一上限来源 = `MODEL_OUTPUT_MAX_TOKENS`（llm-client.ts 中定义 = 65536）。
 *   - 全代码库不再存在第二个"上限"数字
 *   - DEFAULT_MAX_TOKENS / LONG_FORM_MAX_OUTPUT_TOKENS / CHUNKED_LLM_OPTIONS.maxOutputTokens
 *     都引用同一常量
 *   - JSON 截断校验已下沉到 callWithRetry 内部（json 模式默认启用），
 *     `assertJsonNotTruncated` 仍 re-export 供 chunked 路径显式带 label 调用
 */
import {
  type LLMCallOptions,
  MODEL_OUTPUT_MAX_TOKENS,
  assertJsonNotTruncated as _assertJsonNotTruncated,
} from "./llm-client.js";

/** @deprecated 直接用 `MODEL_OUTPUT_MAX_TOKENS`。保留 alias 仅为不破坏外部 import。 */
export const LONG_FORM_MAX_OUTPUT_TOKENS = MODEL_OUTPUT_MAX_TOKENS;

/** Re-export 自 llm-client，供 chunked 路径带自定义 label 显式调用。 */
export const assertJsonNotTruncated = _assertJsonNotTruncated;

/**
 * Chunked LLM 调用通用 options。
 * 调用方可在此基础上 override（如 temperature）。
 *
 * 注意：maxOutputTokens 显式标 65536 主要是文档化意图；即使不传，
 * llm-client 默认值也是 MODEL_OUTPUT_MAX_TOKENS。
 */
export const CHUNKED_LLM_OPTIONS: LLMCallOptions = {
  responseFormat: "json",
  maxOutputTokens: MODEL_OUTPUT_MAX_TOKENS,
  temperature: 0.7,
};

/**
 * 严格 JSON 规约的 system prompt 片段。
 * 所有 chunked step 的 system prompt 末尾应当 append 这段。
 *
 * 规约重点：
 *  - 输出必须是单一合法 JSON 对象/数组（callWithRetry 内部已注入"格式铁律"，
 *    这里再补充长剧场景特有的"宁缺勿断"原则，避免半截 JSON）
 */
export const STRICT_JSON_PROMPT_TAIL = `

【长剧输出硬性约束】
1. 严格 JSON：单一对象，禁止 markdown 代码块 / \`\`\` 围栏 / 注释 / 尾逗号 / 单引号。
2. 宁缺勿断：若输出空间不够，主动按"重要性排序"截掉次要字段，但必须保证 JSON 完整闭合（结尾以 } 或 ] 收尾）。
3. 禁止省略号 / "..." / "rest of the data" / "more nodes here" 等占位文字 — 一旦出现视为格式错误。
4. 数字/字符串/布尔值必须为合法 JSON 类型，不要 NaN / Infinity / undefined。
5. 字符串内的换行必须用 \\n 转义，不能直接换行。
`;

