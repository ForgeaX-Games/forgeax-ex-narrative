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
  it("类型与题材轴留空时，结论由品类单轴决定", () => {
    const r = resolveNarrativeStructure({ genreCode: "rpg-jrpg", storyType: "drama" });
    expect(r.structure).toBe("linear");
    expect(r.source).toBe("vote");
    expect(r.byAxis.type).toEqual([]);
    expect(r.candidates).toEqual(["linear", "tree"]);
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
