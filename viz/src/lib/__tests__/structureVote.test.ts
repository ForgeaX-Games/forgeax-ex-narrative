import { describe, it, expect } from "vitest";
import { readStructureVote } from "../structureVote";

/**
 * 后端 manifest config 的真实形状见 `buildStructureRationale`：
 * 只在真有内容时写字段，所以这里每一种缺字段的组合都是后端会真的发出来的。
 */
describe("读取结构推导结论", () => {
  it("三轴齐全时带回结论与三条轴的依据", () => {
    const vote = readStructureVote({
      narrativeStructure: "tree",
      structureSource: "vote",
      structureRationale: {
        candidates: ["tree", "linear", "network", "multi-pov"],
        byAxis: {
          genre: ["linear", "tree"],
          type: ["tree", "multi-pov", "linear"],
          theme: ["network", "tree"],
        },
      },
    });
    expect(vote).toEqual({
      structure: "tree",
      source: "vote",
      candidates: ["tree", "linear", "network", "multi-pov"],
      byAxis: {
        genre: ["linear", "tree"],
        type: ["tree", "multi-pov", "linear"],
        theme: ["network", "tree"],
      },
    });
  });

  it("只有品类时依据只剩品类一条轴", () => {
    const vote = readStructureVote({
      narrativeStructure: "linear",
      structureSource: "vote",
      structureRationale: { candidates: ["linear", "tree"], byAxis: { genre: ["linear", "tree"] } },
    });
    expect(vote?.structure).toBe("linear");
    expect(Object.keys(vote!.byAxis!)).toEqual(["genre"]);
  });

  // 显式指定的结构没有"比较过程"可讲，后端不发 candidates。界面据此说"已显式指定"
  // 而不是"由下列轴综合推导"。
  it("显式指定时不伪造候选列表", () => {
    const vote = readStructureVote({
      narrativeStructure: "nested",
      structureSource: "explicit",
      structureRationale: { byAxis: { genre: ["linear", "tree"] } },
    });
    expect(vote?.source).toBe("explicit");
    expect(vote?.candidates).toBeUndefined();
  });

  // 三轴全空是合法状态。返回 null 让整块读数不出现 —— 显示一个"未选"的空壳
  // 会让用户以为哪里漏配了。
  it("没有结论时返回 null", () => {
    expect(readStructureVote({ narrativeStructure: null, structureSource: "none" })).toBeNull();
    expect(readStructureVote({})).toBeNull();
    expect(readStructureVote(undefined)).toBeNull();
    expect(readStructureVote(null)).toBeNull();
  });

  it("空表的轴不进依据，界面不会列出一条空推荐", () => {
    const vote = readStructureVote({
      narrativeStructure: "tree",
      structureSource: "vote",
      structureRationale: { byAxis: { genre: ["tree"], type: [], theme: [] } },
    });
    expect(vote?.byAxis).toEqual({ genre: ["tree"] });
  });

  it("依据整块缺失时只丢依据，不丢结论", () => {
    const vote = readStructureVote({ narrativeStructure: "loop", structureSource: "vote" });
    expect(vote).toEqual({ structure: "loop", source: "vote" });
  });

  it("字段类型不对就当没有，不把脏值透到界面上", () => {
    const vote = readStructureVote({
      narrativeStructure: "tree",
      structureSource: "梦话",
      structureRationale: { candidates: "tree", byAxis: { genre: [1, 2] } },
    });
    expect(vote).toEqual({ structure: "tree", source: "none" });
  });

  it("带回标签兜底推出的轴，供界面解释类型/题材是怎么来的", () => {
    const vote = readStructureVote({
      narrativeStructure: "tree",
      structureSource: "vote",
      structureRationale: { tagDerived: { storyType: { dimension: "genre", value: "奇幻" } } },
    });
    expect(vote?.tagDerived).toEqual({ storyType: { dimension: "genre", value: "奇幻" } });
  });
});
