/**
 * 改编忠实度：原作在这次改编里算什么。
 *
 * 被守的混淆：从前"有原作"直接等于"照原作的结构生成"。但原作结构完整、有现成的分叉，
 * 说明的是素材成熟度，不是用户想照搬 —— 缺省档（balanced）明确允许重排节奏、合并次要
 * 情节、调整支线与结局实现，照搬把这些自由全部取消了。档位是这件事的唯一判定源，
 * 素材成熟度与目标品类都不参与。
 */
import { describe, it, expect } from "vitest";
import {
  parseContentFidelity,
  contentFidelityOf,
  sourceStructureIsBinding,
  isIpDnaSeeded,
} from "../fidelity.js";
import { mapTemplateToContext, normalizeTemplate } from "../phase2-extract.js";
import { buildAdaptationDirective } from "../phase2b-adapt.js";
import { createEmptyIpDna } from "../filesystem.js";
import type { NarrativeContext } from "../../types/index.js";
import type {
  NarrativeTemplate,
  PlotTree,
  NarrativeIpDna,
  AdaptationDirective,
  ContentFidelity,
} from "../../types/narrative-ip-dna.js";
import { DEFAULT_CONTENT_FIDELITY } from "../../types/narrative-ip-dna.js";

const ALL_TIERS: ContentFidelity[] = ["faithful", "balanced", "bold", "creative"];

function plotTree(): PlotTree {
  return {
    entryNodeId: "1.1",
    nodes: [
      { id: "1.1", sceneId: "1", title: "起", nodeTypes: ["start"], prevNodes: [], nextNodes: [{ to: "1.2", event: "continue" }] },
      { id: "1.2", sceneId: "1", title: "终", nodeTypes: ["end"], prevNodes: ["1.1"], nextNodes: [], endingType: "open", endingPosition: "final" },
    ],
    topology: { nodeCount: 2, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 },
  };
}

function template(): NarrativeTemplate {
  const t = normalizeTemplate({
    worldview: { setting: "末世冰封", scene_structure: "安全屋", item_inventory: "求生刀" },
    characters: [{ name: "张三", profile: "幸存者", arc: "成长" }],
    core_elements: { subject: "末世", theme: "希望", core_conflict: "资源", literature_style: "写实", emotion_experience: "紧张" },
    summary: { characters: ["张三"], scene: "都市", events: "遭遇" },
  });
  t.story_structure.plot_tree = plotTree();
  t.story_structure.topology = plotTree().topology;
  return t;
}

function ctxWith(fidelity?: ContentFidelity): NarrativeContext {
  return {
    user_input: "改编",
    narrativeIpDna: {} as NarrativeIpDna,
    adaptation_directive: (fidelity
      ? { content_fidelity: fidelity }
      : {}) as AdaptationDirective,
  } as unknown as NarrativeContext;
}

describe("档位解析", () => {
  it("认四个档位，拒别的一切", () => {
    for (const tier of ALL_TIERS) expect(parseContentFidelity(tier)).toBe(tier);
    // 不抛错而是返回 undefined：拼错档位不该让整次改编起不来。
    for (const bad of ["FAITHFUL", "忠实", "", null, undefined, 3, {}]) {
      expect(parseContentFidelity(bad)).toBeUndefined();
    }
  });

  it("读不到指令就是缺省档，不必先判是不是 IP", () => {
    expect(contentFidelityOf({ user_input: "x" } as NarrativeContext)).toBe(
      DEFAULT_CONTENT_FIDELITY,
    );
    expect(contentFidelityOf(ctxWith())).toBe("balanced");
    expect(contentFidelityOf(ctxWith("bold"))).toBe("bold");
  });

  it("缺省档是 balanced，不是 faithful", () => {
    // 这条单独立着：缺省档若是 faithful，下面"只有忠实档照抄"就等于"一律照抄"。
    expect(DEFAULT_CONTENT_FIDELITY).toBe("balanced");
  });
});

describe("结构是否可改的单一判据", () => {
  it("只有忠实档把原作结构当成不可改的蓝本", () => {
    expect(sourceStructureIsBinding(ctxWith("faithful"))).toBe(true);
    for (const tier of ["balanced", "bold", "creative"] as ContentFidelity[]) {
      expect(sourceStructureIsBinding(ctxWith(tier))).toBe(false);
    }
    expect(sourceStructureIsBinding(ctxWith())).toBe(false);
  });

  it("没有原作时任何档位都不成立", () => {
    // faithful 是对某个原作忠实。没有原作，这句话没有指称对象。
    const noSource = {
      user_input: "x",
      adaptation_directive: { content_fidelity: "faithful" } as AdaptationDirective,
    } as unknown as NarrativeContext;
    expect(isIpDnaSeeded(noSource)).toBe(false);
    expect(sourceStructureIsBinding(noSource)).toBe(false);
  });
});

describe("结构席种子按档在源头产出", () => {
  /**
   * 按档产不产，而不是产了再让消费点忽略。
   *
   * `injected_structure_seed` 在场的含义是「这棵树已经定了」（见 StructureSeatSeed
   * 注释），L1/L2 的注入路由据此跳过规划。产了再忽略会让"在场"同时表示两件相反的事，
   * 下一个读 ctx 的人无从判断这棵树到底定没定。
   */
  it("忠实档产出 L1/L2 骨架", () => {
    const ctx = mapTemplateToContext(template(), {
      user_input: "",
      story_title: "冰封",
      adaptation_directive: { content_fidelity: "faithful" } as AdaptationDirective,
    } as unknown as NarrativeContext);
    expect(ctx.injected_structure_seed?.outlines.length).toBeGreaterThan(0);
    expect(ctx.injected_structure_seed?.detailedOutlines.length).toBeGreaterThan(0);
  });

  it("其余三档都不产出", () => {
    for (const tier of ["balanced", "bold", "creative"] as ContentFidelity[]) {
      const ctx = mapTemplateToContext(template(), {
        user_input: "",
        story_title: "冰封",
        adaptation_directive: { content_fidelity: tier } as AdaptationDirective,
      } as unknown as NarrativeContext);
      expect(ctx.injected_structure_seed).toBeUndefined();
    }
  });

  it("没有指令时按缺省档不产出", () => {
    const ctx = mapTemplateToContext(template(), { user_input: "", story_title: "冰封" });
    expect(ctx.injected_structure_seed).toBeUndefined();
  });

  /**
   * L0 骨架不分档产出：转换是确定性的、零模型成本，而"原作分了几场"对读它的人有用。
   * 非忠实档它会被 story_framework 的 full 模式重新规划覆盖，那是路由的事，不是这里的事。
   */
  it("L0 骨架四档都产出", () => {
    for (const tier of ALL_TIERS) {
      const ctx = mapTemplateToContext(template(), {
        user_input: "",
        story_title: "冰封",
        adaptation_directive: { content_fidelity: tier } as AdaptationDirective,
      } as unknown as NarrativeContext);
      expect(ctx.story_framework?.framework.nodes.length).toBeGreaterThan(0);
    }
  });
});

describe("改编指令带上档位", () => {
  /** 最小层级树：一章一节。档位与切分无关，够 buildAdaptationDirective 跑通即可。 */
  function dnaFixture(): NarrativeIpDna {
    const dna = createEmptyIpDna({ story_id: "20260101_0000", title: "测试", media_type: "book" });
    const rootId = dna.rootId;
    dna.nodes.c1 = { id: "c1", levelType: "chapter", index: 1, title: "第一章", parent: rootId, children: [] };
    dna.nodes[rootId]!.children.push("c1");
    dna.nodes.u1 = { id: "u1", levelType: "unit", index: 1, title: "第一节", parent: "c1", children: [], text: "正文" };
    dna.nodes.c1.children.push("u1");
    return dna;
  }

  it("未选时写实为缺省档，而不是留空", () => {
    // 留空会让读的人分不清"用户选了 balanced"与"这份指令还没有档位概念"，
    // 而两者对下游是同一个行为。
    expect(buildAdaptationDirective(dnaFixture()).content_fidelity).toBe(DEFAULT_CONTENT_FIDELITY);
  });

  it("选了就照写", () => {
    for (const tier of ALL_TIERS) {
      expect(buildAdaptationDirective(dnaFixture(), { contentFidelity: tier }).content_fidelity).toBe(tier);
    }
  });
});
