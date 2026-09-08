import { describe, it, expect } from "vitest";
import { loadIpDnaPrompt } from "../prompt-loader.js";
import { SYNTHESIS_SYSTEM } from "../phase3-rag.js";

describe("ip-dna prompt externalization (P3)", () => {
  it("loads canonical prompt text from prompts/ip-dna/*.md (not the inline fallback)", () => {
    const text = loadIpDnaPrompt("unit-extract", "FALLBACK");
    // 完整 md 含 JSON 骨架字段；fallback 不含。
    expect(text).toContain("story_structure");
    expect(text).not.toBe("FALLBACK");
  });

  it("SYNTHESIS_SYSTEM is sourced from synthesis.md with conflict priority substituted", () => {
    expect(SYNTHESIS_SYSTEM).toContain("【阶段A·综合裁决】");
    // 占位符已被替换为真实优先级序列。
    expect(SYNTHESIS_SYSTEM).not.toContain("{{conflict_priority}}");
    expect(SYNTHESIS_SYSTEM).toContain(">");
  });

  it("falls back gracefully for a missing prompt name", () => {
    expect(loadIpDnaPrompt("___does_not_exist___", "SAFE_FALLBACK")).toBe("SAFE_FALLBACK");
  });
});
