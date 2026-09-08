/**
 * P1-2 回归护栏：算子五大分类归一（classifyOperatorDomain / normalizeOperator）。
 * 修"叶子算子 knowledge_domain 是自由文本 → 覆盖 0/5 类 → 三视角分组失效"。
 */
import { describe, it, expect } from "vitest";
import { classifyOperatorDomain, normalizeOperator } from "../phase2-extract.js";

describe("P1-2 classifyOperatorDomain 归一到五大类", () => {
  it("规范分类原样返回", () => {
    expect(classifyOperatorDomain({ knowledge_domain: "情感体验" })).toBe("情感体验");
    expect(classifyOperatorDomain({ knowledge_domain: "叙事技巧" })).toBe("叙事技巧");
  });

  it("自由文本按关键词归一：网文结构/开局法 → 叙事技巧", () => {
    expect(
      classifyOperatorDomain({ knowledge_domain: "网文叙事结构 / 黄金三章开局法", adaptation: { type: "plot_structure", element: "prologue" } }),
    ).toBe("叙事技巧");
  });

  it("视角/人称 → 叙事者定位；角色/弧光 → 故事内容；文风/修辞 → 文学风格", () => {
    expect(classifyOperatorDomain({ name: "第一人称限知视角", knowledge_domain: "" })).toBe("叙事者定位");
    expect(classifyOperatorDomain({ name: "角色塑造", definition: "人物弧光与关系" })).toBe("故事内容");
    expect(classifyOperatorDomain({ name: "冷峻文风", definition: "修辞与意象营造" })).toBe("文学风格");
  });

  it("情绪/共鸣/爽点 → 情感体验", () => {
    expect(classifyOperatorDomain({ name: "爽点铺陈", definition: "读者情绪张力与共鸣" })).toBe("情感体验");
  });

  it("无任何线索 → 兜底故事内容", () => {
    expect(classifyOperatorDomain({})).toBe("故事内容");
  });

  it("normalizeOperator 把自由文本 knowledge_domain 归一为规范分类，并补齐 uid", () => {
    const op = normalizeOperator(
      { name: "绝境自爆开局", knowledge_domain: "网文开局法", adaptation: { type: "plot_structure", element: "prologue" } },
      "fallback_uid",
    );
    expect(op.knowledge_domain).toBe("叙事技巧");
    expect(op.uid).toBe("fallback_uid");
  });
});
