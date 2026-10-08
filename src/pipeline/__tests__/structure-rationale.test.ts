import { describe, it, expect } from "vitest";
import { buildRunManifest } from "../runtime/run-manifest-builder.js";

/**
 * 投票的可解释性要落盘。
 *
 * 结构由品类/类型/题材三轴投票得出，然后去规定整棵剧情树的形状。结论落盘但依据
 * 不落盘，用户就只能接受一个看不到来路的结果，出了问题也无从判断是哪条轴带偏的。
 */
const rationaleOf = (config: Record<string, unknown>) =>
  buildRunManifest({ config }).config.structureRationale;

describe("结构投票依据落盘", () => {
  it("三轴齐全时每条轴的推荐都落下来", () => {
    const r = rationaleOf({ genreCode: "rpg-jrpg", storyType: "drama", storyTheme: "workplace" });
    expect(Object.keys(r!.byAxis!).sort()).toEqual(["genre", "theme", "type"]);
    expect(r!.candidates!.length).toBeGreaterThan(1);
  });

  it("候选按票数降序，头一个就是结论", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg", storyType: "drama", storyTheme: "workplace" },
    });
    expect(m.config.structureRationale!.candidates![0]).toBe(m.config.narrativeStructure);
  });

  it("空表的轴不落盘，不制造一条空推荐", () => {
    const r = rationaleOf({ genreCode: "rpg-jrpg" });
    expect(Object.keys(r!.byAxis!)).toEqual(["genre"]);
  });

  // 显式指定的结构没有"比较过程"可讲。塞一个只含自己的 candidates 会让界面
  // 误以为发生过一次投票，把"你自己定的"说成"综合推导的"。
  it("显式指定时不写候选列表", () => {
    const r = rationaleOf({ genreCode: "rpg-jrpg", narrativeStructure: "nested" });
    expect(r?.candidates).toBeUndefined();
  });

  it("三轴全空时整块依据都不出现", () => {
    expect(rationaleOf({ mode: "narrative_auto" })).toBeUndefined();
  });

  it("依据里的候选与结论都取自真的被推荐过的结构", () => {
    const m = buildRunManifest({
      config: { genreCode: "adv-detective", storyType: "mystery", storyTheme: "palace" },
    });
    const r = m.config.structureRationale!;
    const recommended = new Set(Object.values(r.byAxis!).flat());
    for (const c of r.candidates!) expect(recommended.has(c), c).toBe(true);
    expect(recommended.has(m.config.narrativeStructure!)).toBe(true);
  });
});
