/**
 * chunked-llm-options.test.ts (Stage C)
 * ─────────────────────────────────────────────────────────────────
 * assertJsonNotTruncated 单测：覆盖
 *   - 正常闭合 JSON 通过
 *   - 末尾不闭合（被截断在中间）抛错
 *   - 字符串内出现 } / ] 不误判
 *   - 转义字符不误判
 *   - 末尾有 markdown 围栏垃圾时仍能识别
 */
import { describe, it, expect } from "vitest";
import {
  assertJsonNotTruncated,
  CHUNKED_LLM_OPTIONS,
  LONG_FORM_MAX_OUTPUT_TOKENS,
} from "../runtime/chunked-llm-options.js";

describe("assertJsonNotTruncated", () => {
  it("正常闭合的 JSON 对象通过", () => {
    expect(() => assertJsonNotTruncated('{"a":1,"b":[2,3]}', "test")).not.toThrow();
  });

  it("正常闭合的 JSON 数组通过", () => {
    expect(() => assertJsonNotTruncated('[1,2,{"a":3}]', "test")).not.toThrow();
  });

  it("末尾被截断 → 抛错", () => {
    expect(() => assertJsonNotTruncated('{"a":1,"b":[2,3', "test")).toThrow(/截断/);
  });

  it("空字符串 → 抛错", () => {
    expect(() => assertJsonNotTruncated("", "test")).toThrow(/空字符串/);
    expect(() => assertJsonNotTruncated("   ", "test")).toThrow(/空字符串/);
  });

  it("字符串内的花括号不误判", () => {
    expect(() => assertJsonNotTruncated('{"text":"hello { world }"}', "test")).not.toThrow();
  });

  it("字符串内的 } 不被误算", () => {
    expect(() => assertJsonNotTruncated('{"a":"x}y","b":1}', "test")).not.toThrow();
  });

  it("转义引号正确处理", () => {
    expect(() => assertJsonNotTruncated('{"text":"he said \\"hi\\""}', "test")).not.toThrow();
  });

  it("括号未配平 → 抛错（{ 多）", () => {
    expect(() => assertJsonNotTruncated('{"a":{"b":1}', "test")).toThrow(/括号未配平|截断/);
  });

  it("括号未配平 → 抛错（] 多）", () => {
    expect(() => assertJsonNotTruncated('{"a":1]}', "test")).toThrow(/括号未配平|截断/);
  });

  it("末尾有 markdown 围栏仍能闭合识别", () => {
    expect(() => assertJsonNotTruncated('{"a":1}\n```', "test")).not.toThrow();
  });

  it("错误信息包含 label", () => {
    try {
      assertJsonNotTruncated("{ broken", "branch_tree.macro_plan");
      expect.fail("应当抛错");
    } catch (e) {
      expect((e as Error).message).toContain("branch_tree.macro_plan");
    }
  });
});

describe("CHUNKED_LLM_OPTIONS", () => {
  it("默认 maxOutputTokens = 65536（Gemini 2.5 Flash 输出硬上限）", () => {
    expect(CHUNKED_LLM_OPTIONS.maxOutputTokens).toBe(LONG_FORM_MAX_OUTPUT_TOKENS);
    expect(LONG_FORM_MAX_OUTPUT_TOKENS).toBe(65536);
  });

  it("强制 responseFormat='json'（触发 callWithRetry 内置格式铁律）", () => {
    expect(CHUNKED_LLM_OPTIONS.responseFormat).toBe("json");
  });
});
