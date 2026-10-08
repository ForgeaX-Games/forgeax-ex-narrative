import { describe, it, expect } from "vitest";
import {
  STORY_TYPES,
  STORY_THEMES,
  STORY_STRUCTURES,
  getStoryType,
  getStoryTheme,
  getStoryStructure,
  resolveNarrativeStructure,
  GENRE_STRUCTURE_HINTS,
  getGenreStructureHints,
  isStoryStructureCode,
} from "../index.js";
import type { StoryTypeCode, StoryThemeCode } from "../index.js";
import { GENRE_TAXONOMY } from "../../genre-taxonomy.js";

describe("三轴词表", () => {
  it("词表规模与产品侧清单一致（13 类型 + 19 题材 + 各一个兜底 / 12 结构）", () => {
    expect(STORY_TYPES.filter((t) => !t.catchAll)).toHaveLength(13);
    expect(STORY_THEMES.filter((t) => !t.catchAll)).toHaveLength(19);
    expect(STORY_STRUCTURES).toHaveLength(12);
  });

  it("code 唯一且可反查", () => {
    for (const list of [STORY_TYPES, STORY_THEMES, STORY_STRUCTURES]) {
      const codes = list.map((x) => x.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
    expect(getStoryType("drama")?.name).toBe("剧情");
    expect(getStoryTheme("cyberpunk")?.name).toBe("赛博朋克");
    expect(getStoryStructure("multi-pov")?.name).toBe("多视角交织");
    expect(getStoryType("nope")).toBeNull();
  });

  // 类型轴与题材轴不填 structureHints 就等于没进投票，三轴会静默退化成品类单轴。
  // 这条断言守住新增类型/题材时必须一并给出结构倾向。
  it("除兜底项外，每个类型与题材都给出合法的结构倾向", () => {
    for (const list of [STORY_TYPES, STORY_THEMES]) {
      for (const entry of list) {
        if (entry.catchAll) continue;
        expect(entry.structureHints.length, `${entry.code} 没给结构倾向`).toBeGreaterThan(0);
        for (const h of entry.structureHints) {
          expect(isStoryStructureCode(h), `${entry.code} → ${h}`).toBe(true);
        }
      }
    }
  });

  it("每种结构都给出四个环节的落地指引", () => {
    for (const s of STORY_STRUCTURES) {
      for (const stage of ["demand", "design", "outline", "structure"] as const) {
        expect(s.stageHints[stage], `${s.code}.${stage}`).toBeTruthy();
      }
    }
  });
});

describe("品类结构倾向", () => {
  it("倾向表里的 code 全部合法，且指向已存在的品类", () => {
    const known = new Set(GENRE_TAXONOMY.map((g) => g.code));
    for (const [genreCode, hints] of Object.entries(GENRE_STRUCTURE_HINTS)) {
      expect(known.has(genreCode), `未知品类 ${genreCode}`).toBe(true);
      for (const h of hints) expect(isStoryStructureCode(h), `${genreCode} → ${h}`).toBe(true);
    }
  });

  it("117 个品类全部拿得到倾向（表内命中或按管线形态兜底）", () => {
    for (const g of GENRE_TAXONOMY) {
      expect(getGenreStructureHints(g.code).length, g.code).toBeGreaterThan(0);
    }
  });
});

describe("结构综合", () => {
  it("只给品类时，另两轴是空表，结论等于品类首选", () => {
    const r = resolveNarrativeStructure({ genreCode: "rpg-jrpg" });
    expect(r.structure).toBe(getGenreStructureHints("rpg-jrpg")[0]);
    expect(r.source).toBe("vote");
    expect(r.byAxis.type).toEqual([]);
    expect(r.byAxis.theme).toEqual([]);
  });

  // 结构是多轴比较出来的，不是品类的附属品：补一条轴就该有改写结论的能力。
  it("补上类型轴能改写品类单轴的结论", () => {
    const genreOnly = resolveNarrativeStructure({ genreCode: "rpg-jrpg" });
    const withType = resolveNarrativeStructure({ genreCode: "rpg-jrpg", storyType: "drama" });
    expect(withType.byAxis.type.length).toBeGreaterThan(0);
    expect(withType.structure).not.toBe(genreOnly.structure);
    expect(withType.structure).toBe("tree");
  });

  it("同一品类，只换类型与题材就能换出不同结构", () => {
    const at = (storyType: StoryTypeCode, storyTheme: StoryThemeCode) =>
      resolveNarrativeStructure({ genreCode: "rpg-jrpg", storyType, storyTheme }).structure;
    const outcomes = new Set([
      at("drama", "workplace"),
      at("mystery", "espionage"),
      at("fantasy", "cultivation"),
    ]);
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("三轴各自的倾向都进了 byAxis，票数汇总后才出结论", () => {
    const r = resolveNarrativeStructure({
      genreCode: "rpg-jrpg",
      storyType: "drama",
      storyTheme: "workplace",
    });
    expect(r.byAxis.genre).toEqual(getGenreStructureHints("rpg-jrpg"));
    expect(r.byAxis.type).toEqual(getStoryType("drama")!.structureHints);
    expect(r.byAxis.theme).toEqual(getStoryTheme("workplace")!.structureHints);
    // 结论必须是某条轴真的推荐过的，投票不会凭空造出一个结构。
    const recommended = new Set([...r.byAxis.genre, ...r.byAxis.type, ...r.byAxis.theme]);
    expect(recommended.has(r.structure!)).toBe(true);
  });

  it("首选权重高于次选：开放世界取多线交织", () => {
    expect(resolveNarrativeStructure({ genreCode: "rpg-open-world" }).structure).toBe("multiline");
  });

  it("explicit 短路一切推导", () => {
    const r = resolveNarrativeStructure({ genreCode: "rpg-jrpg", explicit: "loop" });
    expect(r.structure).toBe("loop");
    expect(r.source).toBe("explicit");
  });

  it("非法 explicit 退回投票而不是抛错", () => {
    expect(resolveNarrativeStructure({ genreCode: "rpg-jrpg", explicit: "nope" }).source).toBe(
      "vote",
    );
  });

  it("三轴全空是合法状态，返回 null 而不是兜底猜一个", () => {
    const r = resolveNarrativeStructure({});
    expect(r.structure).toBeNull();
    expect(r.source).toBe("none");
  });

  it("candidates 按位次权重降序，保留全部倾向供 UI 解释", () => {
    const r = resolveNarrativeStructure({ genreCode: "rpg-open-world" });
    expect(r.candidates).toEqual(["multiline", "multi-pov", "tree", "hybrid"]);
    expect(r.byAxis.genre).toEqual(r.candidates);
  });
});
