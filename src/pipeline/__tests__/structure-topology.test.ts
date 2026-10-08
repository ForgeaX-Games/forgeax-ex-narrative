import { describe, it, expect } from "vitest";
import {
  STORY_STRUCTURES,
  NEUTRAL_TOPOLOGY,
  getStructureTopology,
} from "../../knowledge/narrative-axes/index.js";
import type { StructureTopology } from "../../knowledge/narrative-axes/index.js";
import {
  getEntropy,
  getLayerEntropy,
  getTargetBranchRatio,
  getMergeTendency,
  enforceBranchInPlan,
  defaultBranchPosition,
  buildBranchPromptSection,
} from "../runtime/layer-threshold-config.js";
import type { StructurePlanItem } from "../runtime/layer-threshold-config.js";

/**
 * 结构必须真的规定树的形状。
 *
 * 三轴综合把结构投票出来之后，它不能只是写在 manifest 里的一个标签 ——
 * 投票出「线性」和投票出「网状」，同一体量下长出来的树必须是肉眼可见的两回事。
 * 这组测试守的就是这件事：体量管「这个规模该有多少分叉」，结构管「这种讲法
 * 该有多少分叉、分了要不要收、一次分几条、分在哪一段」。
 */

/** 固定体量为标准档，把结构之外的变量都钉死。 */
const TIER = 3;
const LAYER = 1;
const layerEntropy = () => getLayerEntropy(getEntropy(TIER), LAYER);

const topo = (code: string): StructureTopology => getStructureTopology(code);

const branchRatio = (code: string) =>
  getTargetBranchRatio(TIER, layerEntropy(), LAYER, topo(code)).target;

/** 一份「LLM 一个分支都没给」的计划，用来观察 enforce 补出来的形状。 */
const flatPlan = (): StructurePlanItem[] =>
  ["p1", "p2", "p3", "p4", "p5"].map((parent_id, i) => ({
    parent_id,
    child_count: 3,
    branch_count: 1,
    narrative_stage: ["opening", "rising", "climax", "falling", "resolution"][i],
  }));

const enforced = (code: string) => {
  const t = topo(code);
  return enforceBranchInPlan(
    flatPlan(),
    getTargetBranchRatio(TIER, layerEntropy(), LAYER, t),
    getMergeTendency(TIER, LAYER, t),
    LAYER,
    t,
  );
};

describe("结构参数契约", () => {
  it("12 种结构全部给出可用的形态参数", () => {
    expect(STORY_STRUCTURES).toHaveLength(12);
    for (const s of STORY_STRUCTURES) {
      const t = s.topology;
      expect(t, s.code).toBeTruthy();
      expect(t.branchDensity, `${s.code}.branchDensity`).toBeGreaterThan(0);
      expect(t.mergeAffinity, `${s.code}.mergeAffinity`).toBeGreaterThan(0);
      // 分叉宽度小于 2 就不叫分叉了。
      expect(t.branchWidth, `${s.code}.branchWidth`).toBeGreaterThanOrEqual(2);
      expect(["single", "parallel", "cyclic", "scattered"]).toContain(t.spine);
      expect(["early", "middle", "late"]).toContain(t.branchPlacement);
      expect(["single", "few", "many"]).toContain(t.endings);
      // shape 要写进结构控制提示词，空的等于这一段没说话。
      expect(t.shape.length, `${s.code}.shape`).toBeGreaterThan(0);
    }
  });

  it("结构未定时取中性参数，而不是抛错或猜一个", () => {
    expect(getStructureTopology(undefined)).toEqual(NEUTRAL_TOPOLOGY);
    expect(getStructureTopology(null)).toEqual(NEUTRAL_TOPOLOGY);
    expect(getStructureTopology("nope")).toEqual(NEUTRAL_TOPOLOGY);
  });

  it("省略 topology 的调用等价于中性，接入结构参数不改变既有行为", () => {
    const e = layerEntropy();
    expect(getTargetBranchRatio(TIER, e, LAYER)).toEqual(
      getTargetBranchRatio(TIER, e, LAYER, NEUTRAL_TOPOLOGY),
    );
    expect(getMergeTendency(TIER, LAYER)).toEqual(getMergeTendency(TIER, LAYER, NEUTRAL_TOPOLOGY));
  });
});

describe("结构调制分支率", () => {
  it("同一体量下，线性的目标分支率显著低于纯树状与网状", () => {
    expect(branchRatio("linear")).toBeLessThan(branchRatio("tree"));
    expect(branchRatio("tree")).toBeLessThan(branchRatio("network"));
  });

  it("意识流几乎不分叉，网状分叉最密，差距在数量级上可辨", () => {
    expect(branchRatio("network")).toBeGreaterThan(branchRatio("stream") * 2);
  });

  it("分支率的上下限跟着一起缩放，不会出现 min 高过 target 的倒挂", () => {
    for (const s of STORY_STRUCTURES) {
      const r = getTargetBranchRatio(TIER, layerEntropy(), LAYER, s.topology);
      expect(r.min, `${s.code}.min<=target`).toBeLessThanOrEqual(r.target + 1e-9);
      expect(r.target, `${s.code}.target<=max`).toBeLessThanOrEqual(r.max + 1e-9);
      expect(r.max, `${s.code}.max<=1`).toBeLessThanOrEqual(1);
    }
  });
});

describe("结构调制聚合倾向", () => {
  it("环形与多视角分了要收回来，纯树状与涌现分了不回头", () => {
    const cyclic = getMergeTendency(TIER, LAYER, topo("loop"));
    const povs = getMergeTendency(TIER, LAYER, topo("multi-pov"));
    const tree = getMergeTendency(TIER, LAYER, topo("tree"));
    const emergent = getMergeTendency(TIER, LAYER, topo("emergent"));
    expect(cyclic).toBeGreaterThan(tree);
    expect(cyclic).toBeGreaterThan(emergent);
    expect(povs).toBeGreaterThan(tree);
    expect(povs).toBeGreaterThan(emergent);
  });

  it("纯树状是全表最不愿意聚合的那个 —— 分了不合流就是它的定义", () => {
    const lowest = Math.min(...STORY_STRUCTURES.map((s) => s.topology.mergeAffinity));
    expect(topo("tree").mergeAffinity).toBe(lowest);
  });

  it("聚合倾向始终是个概率，不会被系数推出 0-1 之外", () => {
    for (const s of STORY_STRUCTURES) {
      for (const layer of [0, 1, 2]) {
        const m = getMergeTendency(TIER, layer, s.topology);
        expect(m, `${s.code}.L${layer}`).toBeGreaterThanOrEqual(0);
        expect(m, `${s.code}.L${layer}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("结构调制分叉宽度与位置", () => {
  it("补分支时开几条路线由结构说，不是一律两条", () => {
    // 多视角与网状天然宽于两条：一律补成 2 会把「视角轮替」压成「二选一」。
    expect(topo("multi-pov").branchWidth).toBeGreaterThan(2);
    const widths = (code: string) =>
      enforced(code).filter((p) => p.branch_count >= 2).map((p) => p.branch_count);
    expect(widths("multi-pov").every((w) => w === topo("multi-pov").branchWidth)).toBe(true);
    expect(widths("linear").every((w) => w === 2)).toBe(true);
  });

  it("分叉该早该晚由结构说：Y 型速决靠前，胖尾靠后", () => {
    const childCount = 6;
    const early = defaultBranchPosition(childCount, "early");
    const middle = defaultBranchPosition(childCount, "middle");
    const late = defaultBranchPosition(childCount, "late");
    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
    // 分叉点不可能落在第一个孩子身上 —— 那不是分叉，是起点。
    expect(early).toBeGreaterThanOrEqual(2);
  });

  it("只有一个孩子时没有分叉位可言", () => {
    for (const placement of ["early", "middle", "late"] as const) {
      expect(defaultBranchPosition(1, placement)).toBe(1);
    }
  });
});

describe("结构端到端决定树的形状", () => {
  it("同一体量、同一份 LLM 计划，换结构就长出不同的树", () => {
    const shapeOf = (code: string) =>
      enforced(code)
        .map((p) => `${p.branch_count}${p.should_merge ? "M" : "-"}`)
        .join("|");
    const shapes = new Set(
      ["linear", "tree", "multi-pov", "network", "emergent", "stream"].map(shapeOf),
    );
    // 六种讲法至少长出三种不同的树，才叫结构真的管事。
    expect(shapes.size).toBeGreaterThanOrEqual(3);
  });

  it("线性长出的分支节点数少于网状", () => {
    const branchNodes = (code: string) =>
      enforced(code).reduce((s, p) => s + (p.branch_count >= 2 ? p.branch_count : 0), 0);
    expect(branchNodes("linear")).toBeLessThan(branchNodes("network"));
  });

  it("结构控制提示词里带上本作的结构画像，模型不必猜", () => {
    const section = buildBranchPromptSection(LAYER, TIER, layerEntropy(), topo("tree"));
    expect(section).toContain("本作的叙事结构");
    expect(section).toContain(topo("tree").shape);
  });

  it("结构未定时提示词不编造结构画像", () => {
    const section = buildBranchPromptSection(LAYER, TIER, layerEntropy(), NEUTRAL_TOPOLOGY);
    expect(section).not.toContain("本作的叙事结构");
  });
});
