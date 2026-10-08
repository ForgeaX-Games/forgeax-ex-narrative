/**
 * 结构可覆盖（B11）与「结论不得落盘成输入」两件事的回归。
 *
 * 覆盖必须真的短路投票：否则界面上那个下拉框是个安慰剂。
 * 而结论必须**不**落进条目配置：落了会在下一次被当成显式指定读回去，
 * 于是用户改了类型或题材、结构却永远锁在第一次的结论上 —— 这正是投票机制
 * 最容易被静默架空的那条路，且 B6 补齐 structureHints 之后才真正致命
 * （在那之前投票几乎总是同一个结论，锁死看不出来）。
 */
import { describe, it, expect } from "vitest";
import {
  resolveNarrativeStructure,
  STORY_STRUCTURES,
  STORY_TYPES,
  getStructureTopology,
} from "../../knowledge/narrative-axes/index.js";
import { getTargetBranchRatio } from "../runtime/layer-threshold-config.js";

describe("结构覆盖", () => {
  it("显式覆盖短路投票，source 报 explicit", () => {
    const voted = resolveNarrativeStructure({
      genreCode: "rpg-jrpg",
      storyType: "mystery",
      storyTheme: "sci-fi",
    });
    const forced = resolveNarrativeStructure({
      genreCode: "rpg-jrpg",
      storyType: "mystery",
      storyTheme: "sci-fi",
      explicit: "linear",
    });
    expect(voted.source).toBe("vote");
    expect(forced.source).toBe("explicit");
    expect(forced.structure).toBe("linear");
  });

  // 覆盖时候选里只有结论自己：没有发生过投票，就没有"第二名"。
  // 界面据此说「已显式指定」而不是「由下列轴综合推导」，不能列出一串假的候选。
  it("覆盖时不编造候选，候选表里只有结论自己", () => {
    const forced = resolveNarrativeStructure({
      genreCode: "rpg-jrpg",
      storyType: "mystery",
      explicit: "network",
    });
    expect(forced.candidates).toEqual(["network"]);
  });

  it("撤掉覆盖就回到投票结论，不残留上一次的选择", () => {
    const base = { genreCode: "rpg-jrpg", storyType: "mystery", storyTheme: "sci-fi" } as const;
    const pure = resolveNarrativeStructure(base);
    // 故意覆盖成一个与投票结论不同的结构，再释放。
    const other = STORY_STRUCTURES.find((s) => s.code !== pure.structure)!.code;
    const forced = resolveNarrativeStructure({ ...base, explicit: other });
    const released = resolveNarrativeStructure({ ...base, explicit: null });
    expect(forced.structure).toBe(other);
    expect(released.source).toBe("vote");
    expect(released.structure).toBe(pure.structure);
  });

  it("12 个结构都能被覆盖选中，没有哪个是选了不认的", () => {
    for (const s of STORY_STRUCTURES) {
      const r = resolveNarrativeStructure({ genreCode: "rpg-jrpg", explicit: s.code });
      expect(r.structure, s.code).toBe(s.code);
      expect(r.source, s.code).toBe("explicit");
    }
  });

  it("覆盖会换掉整棵树的形状 —— 下拉框不是个装饰", () => {
    const shapeOf = (explicit: string) => {
      const r = resolveNarrativeStructure({ genreCode: "rpg-jrpg", explicit });
      return getTargetBranchRatio(3, 1, 1, getStructureTopology(r.structure)).target;
    };
    // 同一品类同一体量，只把结构从线性改成网状，分支率必须跟着变。
    expect(shapeOf("network")).toBeGreaterThan(shapeOf("linear"));
  });

  /**
   * 落盘策略的哨兵。
   *
   * 条目配置里的 `narrativeStructure` 只能是用户覆盖。若把推导结论也写进去，
   * 下一次读回来就成了 `explicit`：这里模拟那条错误回路，说明它为什么致命 ——
   * 用户把类型从悬疑改成日常，结构却还是第一次悬疑推出来的那个。
   */
  it("结论若被当成覆盖回灌，换轴就再也改不动结构", () => {
    const first = resolveNarrativeStructure({ genreCode: "rpg-jrpg", storyType: "mystery" });
    // 找一个换上去就能改写结论的类型：B6 补齐 structureHints 之后必然存在这样的轴。
    const swayed = STORY_TYPES.find(
      (ty) =>
        !ty.catchAll &&
        resolveNarrativeStructure({ genreCode: "rpg-jrpg", storyType: ty.code }).structure !==
          first.structure,
    );
    expect(swayed, "没有任何类型能改写结论，三轴已退化成品类单轴").toBeTruthy();

    // 一旦把上一次的结论当覆盖回灌，这条轴的影响就被整个抹掉。
    const relocked = resolveNarrativeStructure({
      genreCode: "rpg-jrpg",
      storyType: swayed!.code,
      explicit: first.structure,
    });
    expect(relocked.structure).toBe(first.structure);
    expect(relocked.source).toBe("explicit");
  });

  it("不认识的覆盖值不当显式指定，退回投票而不是把结构设成垃圾值", () => {
    const r = resolveNarrativeStructure({
      genreCode: "rpg-jrpg",
      storyType: "mystery",
      explicit: "我要一个很棒的结构",
    });
    expect(r.source).toBe("vote");
    expect(STORY_STRUCTURES.map((s) => s.code)).toContain(r.structure);
  });
});
