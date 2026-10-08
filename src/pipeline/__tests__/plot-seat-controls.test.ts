/**
 * 情节席看到什么、看不到什么。
 *
 * 两件事在这里定死，因为它们看起来像同一个缺陷，实际一个是设计、一个是真缺陷：
 *
 * 1. **不吃策略卡是设计。** 席位表（叙事单品助手团队）里"故事情节助手"那一行，四个叙事
 *    策略列都是 `×`，简介是"填充节点具体情节"。口径是「树在结构层成形，情节层只填内容」
 *    —— 策略卡讲的是怎么造树，对一棵已经造好的树没有用。写成测试是为了让下一个看到
 *    `NO_STRATEGY` 的人不必再去翻一遍 CSV 才敢确认这不是漏接。
 *
 * 2. **拿到一行原始 JSON 是缺陷。** 调控参数从前直接 stringify 进提示词，带着两个
 *    `@deprecated` 字段一起。`deviation_direction` 与 `deviation` 并存最糟：模型同时看到
 *    "positive" 和一个数，两套说法讲同一件事，而废弃那套已经没人维护。
 */
import { describe, it, expect } from "vitest";
import { buildPlotControlPrompt } from "../runtime/layer-threshold-config.js";
import { SEAT_SPECS } from "../routing/seat-spec.js";
import type { GlobalControlParams } from "../../types/index.js";

describe("情节席不吃叙事策略卡（设计如此）", () => {
  it("四轴全为 none", () => {
    const plot = SEAT_SPECS.find((s) => s.seatId === "plot")!;
    expect(plot.strategy).toEqual({
      genre: "none",
      type: "none",
      theme: "none",
      structure: "none",
    });
  });

  it("吃满四轴的只有那四席", () => {
    // 席位表里 ◐ ◐ ◐ ◐ 只给了需求清单、策划文档、故事大纲、故事结构。多出一席就说明
    // 有人按"看着也该吃"的直觉加了，而那正是这条要挡的。
    const all = SEAT_SPECS.filter(
      (s) => Object.values(s.strategy).every((v) => v === "pluggable"),
    ).map((s) => s.seatId);
    expect(all.sort()).toEqual(["design_doc", "outline", "req_list", "structure"].sort());
  });
});

describe("调控参数以可读形式进提示词", () => {
  const base: GlobalControlParams = { complexity: 3, deviation: 0 };

  it("废弃字段不出现", () => {
    const out = buildPlotControlPrompt({
      ...base,
      entropy_budget: 42,
      deviation_direction: "positive",
    });
    expect(out).not.toContain("entropy_budget");
    expect(out).not.toContain("deviation_direction");
    expect(out).not.toContain("positive");
    // 也不该是个 JSON 对象。
    expect(out).not.toContain("{");
  });

  it("三档反套路各给各自的写法指导", () => {
    expect(buildPlotControlPrompt({ ...base, deviation: 0.8 })).toContain("创新突破");
    expect(buildPlotControlPrompt({ ...base, deviation: -0.8 })).toContain("解构颠覆");
    expect(buildPlotControlPrompt(base)).toContain("经典叙事");
  });

  it("只给了旧字段的存量 ctx 仍能读出档位", () => {
    // deviationFromLegacy 的存在就是为了这种数据：deviation 缺席、只有方向。
    const legacy = { complexity: 3, deviation_direction: "negative" } as unknown as GlobalControlParams;
    expect(buildPlotControlPrompt(legacy)).toContain("解构颠覆");
  });

  it("没有调控参数时给一句缺省，不给空段", () => {
    // 空段会让提示词里留一个标题下面什么也没有，模型会去猜那里本该有什么。
    expect(buildPlotControlPrompt(undefined).length).toBeGreaterThan(10);
  });

  it("体量说明里写清它只管单节点写多厚", () => {
    // 体量在结构层已经决定了树的大小。不写清的话，模型会把"体量 5"理解成这一个节点
    // 也要铺开成五档的量。
    expect(buildPlotControlPrompt({ ...base, complexity: 5 })).toContain("单个节点");
  });
});
