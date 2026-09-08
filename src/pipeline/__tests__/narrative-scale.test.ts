/**
 * narrative-scale.test.ts (Stage C)
 * ─────────────────────────────────────────────────────────────────
 * resolveTargetActs / extractActsFromInput / isLongFormMode 单测。
 */
import { describe, it, expect } from "vitest";
import {
  extractActsFromInput,
  resolveTargetActs,
  isLongFormMode,
  actsFromUploadedCharCount,
} from "../runtime/narrative-scale.js";

describe("extractActsFromInput", () => {
  it("识别中文阿拉伯数字 + 幕", () => {
    expect(extractActsFromInput("我想要一个 5 幕长剧")).toBe(5);
  });

  it("识别中文小写数字 + 幕", () => {
    expect(extractActsFromInput("分三幕推进")).toBe(3);
  });

  it("识别 章/篇章 关键字", () => {
    expect(extractActsFromInput("分 4 章节展开")).toBe(4);
    expect(extractActsFromInput("共五个篇章")).toBe(5);
  });

  it("识别英文 acts", () => {
    expect(extractActsFromInput("a 5-act drama")).toBe(5);
    expect(extractActsFromInput("3 acts story")).toBe(3);
  });

  it("无幕数关键词 → undefined", () => {
    expect(extractActsFromInput("一个故事")).toBeUndefined();
  });

  it("数字超出 [1, 20] 范围 → undefined", () => {
    expect(extractActsFromInput("100 幕")).toBeUndefined();
  });
});

describe("resolveTargetActs", () => {
  it("user_input 显式声明 优先于 skill defaultActs", () => {
    expect(resolveTargetActs("5 幕长剧", { defaultActs: 1 })).toBe(5);
  });

  it("user_input 包含'短剧' 关键词 → 1", () => {
    expect(resolveTargetActs("一个 2-3 分钟的短剧 demo", { defaultActs: 5 })).toBe(1);
  });

  it("user_input 包含'长剧' 但无显式数字 → 默认 5", () => {
    expect(resolveTargetActs("做一部长剧大作", null)).toBe(5);
  });

  it("无关键词 → fallback 到 skill.defaultActs", () => {
    expect(resolveTargetActs("一个故事", { defaultActs: 4 })).toBe(4);
  });

  it("无关键词 + 无 skill → 1（兜底短剧）", () => {
    expect(resolveTargetActs("一个故事")).toBe(1);
  });

  it("'长剧' + skill defaultActs >= 2 → 取 skill 值", () => {
    expect(resolveTargetActs("一个长剧", { defaultActs: 6 })).toBe(6);
  });

  // M1.7: 上传剧本字数 → 自动决定幕数
  it("上传剧本短篇（≤5k）→ 1 幕", () => {
    expect(resolveTargetActs("一个故事", null, 3_000)).toBe(1);
  });

  it("上传剧本中短篇（5k-15k）→ 2 幕", () => {
    expect(resolveTargetActs("一个故事", null, 10_000)).toBe(2);
  });

  it("上传剧本中篇（15k-35k）→ 3 幕", () => {
    expect(resolveTargetActs("一个故事", null, 25_000)).toBe(3);
  });

  it("上传剧本长篇（35k-80k）→ 4 幕", () => {
    expect(resolveTargetActs("一个故事", null, 60_000)).toBe(4);
  });

  it("上传剧本超长篇（>80k）→ 5 幕", () => {
    expect(resolveTargetActs("一个故事", null, 120_000)).toBe(5);
  });

  it("用户显式声明 N 幕 优先于上传剧本字数", () => {
    expect(resolveTargetActs("分 3 幕", null, 100_000)).toBe(3);
  });

  it("用户显式'短剧' 关键词 优先于上传剧本字数", () => {
    expect(resolveTargetActs("做个短剧", null, 100_000)).toBe(1);
  });

  it("skill.defaultActs >=2 优先于上传剧本字数", () => {
    expect(resolveTargetActs("一个故事", { defaultActs: 7 }, 10_000)).toBe(7);
  });
});

describe("actsFromUploadedCharCount", () => {
  it.each([
    [0, 1],
    [-100, 1],
    [3_000, 1],
    [5_000, 1],
    [5_001, 2],
    [15_000, 2],
    [15_001, 3],
    [35_000, 3],
    [35_001, 4],
    [80_000, 4],
    [80_001, 5],
    [200_000, 5],
  ])("char_count=%d → acts=%d", (cc, expected) => {
    expect(actsFromUploadedCharCount(cc)).toBe(expected);
  });
});

describe("isLongFormMode", () => {
  it.each([
    [undefined, false],
    [null, false],
    [0, false],
    [1, false],
    [2, true],
    [5, true],
    [10, true],
  ])("targetActs=%s → %s", (acts, expected) => {
    expect(isLongFormMode(acts as number | null | undefined)).toBe(expected);
  });
});
