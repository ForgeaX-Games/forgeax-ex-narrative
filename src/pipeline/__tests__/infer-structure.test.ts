/**
 * 从拓扑数字反推结构，以及 IP 改编把它接进结构轴。
 *
 * 这条链路是真实跑里发现断掉的：八段线性的原作，改编出来是带分叉合流的树。
 * 这里把断点两端都钉住——反推本身要准，接线也要真的接上。
 */
import { describe, it, expect } from "vitest";
import { inferStructureFromTopology } from "../../knowledge/narrative-axes/infer-structure.js";
import { hydrateContextFromSeed } from "../../ip-dna/generation-seed.js";
import { normalizeTemplate } from "../../ip-dna/phase2-extract.js";

describe("从拓扑反推结构", () => {
  it("一条道走到黑是线性", () => {
    expect(
      inferStructureFromTopology({ nodeCount: 8, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 }),
    ).toBe("linear");
  });

  it("分了不回头、多结局是纯树状", () => {
    expect(
      inferStructureFromTopology({ nodeCount: 12, startCount: 1, endCount: 4, pivotCount: 3, mergeCount: 0 }),
    ).toBe("tree");
  });

  it("分了必回、结局收敛是鱼骨", () => {
    expect(
      inferStructureFromTopology({ nodeCount: 14, startCount: 1, endCount: 1, pivotCount: 3, mergeCount: 3 }),
    ).toBe("fishbone");
  });

  it("多个起点各走各的是多线并行", () => {
    expect(
      inferStructureFromTopology({ nodeCount: 10, startCount: 3, endCount: 3, pivotCount: 0, mergeCount: 0 }),
    ).toBe("multiline");
  });

  it("太小的树不猜：三个节点看不出形状", () => {
    expect(
      inferStructureFromTopology({ nodeCount: 3, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 }),
    ).toBeNull();
  });

  it("数字分不清时宁可不给：一处分叉一处合流，鱼骨与环形同形", () => {
    expect(
      inferStructureFromTopology({ nodeCount: 9, startCount: 1, endCount: 1, pivotCount: 1, mergeCount: 1 }),
    ).toBeNull();
  });

  it("没有拓扑就没有结论", () => {
    expect(inferStructureFromTopology(undefined)).toBeNull();
  });
});

function seedWith(topology: Record<string, number>, axes?: { structure?: string }) {
  // 用生产侧的补齐函数造模板，免得这里手抄一份字段清单——抄漏一个就是空指针，
  // 而那种失败说的是测试写得不全，不是被测代码有问题。
  const topTemplate = normalizeTemplate({ story_structure: { topology } as never });
  return {
    storyTitle: "t",
    storyTimestamp: "2026-01-01_00-00-00-000",
    topTemplate,
    scopedDna: { rootId: "r", nodes: {} } as never,
    ledger: {} as never,
    userInput: "改编它",
    ...(axes ? { axes } : {}),
  };
}

describe("IP 改编把原作结构接进结构轴", () => {
  it("原作线性，生成侧的结构轴就是线性", () => {
    const ctx = hydrateContextFromSeed(
      seedWith({ nodeCount: 8, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 }) as never,
    );
    expect(ctx.narrative_axes?.structure).toBe("linear");
  });

  it("形状看不出来时不写结构轴，留给投票", () => {
    const ctx = hydrateContextFromSeed(
      seedWith({ nodeCount: 9, startCount: 1, endCount: 1, pivotCount: 1, mergeCount: 1 }) as never,
    );
    expect(ctx.narrative_axes?.structure).toBeUndefined();
  });
});
