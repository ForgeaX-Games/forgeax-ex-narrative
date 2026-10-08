/**
 * IP 种子骨架不得被重新规划覆盖。
 *
 * phase2-extract 已经把原作的 plot_tree 确定性转成 L0 骨架写进 ctx.story_framework。
 * 但 story_framework 的路由只在带 nodeFilter（局部重跑）时才认既有骨架，IP 改编首跑
 * 没有 nodeFilter，于是落进 full：LLM 重新规划一遍 L0，把原作的章节拓扑换成它自己编的
 * 一套。用户拿原作来，得到的是一个同名新故事。
 *
 * 这里守住第四种模式 seeded：拓扑照抄种子，内容照旧生成。
 *
 * 触发条件是忠实档，不是"有原作"：缺省档（balanced）明确允许重排节奏与支线，照抄拓扑
 * 就把用户没要的约束强加上去了。两个方向都在下面钉住。
 */
import { describe, it, expect } from "vitest";
import { __internal } from "../steps/story-framework.js";
import type { NarrativeContext, FrameworkNode, StoryFramework } from "../../types/index.js";
import type {
  NarrativeIpDna,
  AdaptationDirective,
  ContentFidelity,
} from "../../types/narrative-ip-dna.js";

const { storyFrameworkRoute, normalizeStoryFramework } = __internal;

/** 一条带分叉的三节点原作骨架，形如 phase2-extract 的 plotTreeToStoryFramework 产出。 */
function seedNodes(): FrameworkNode[] {
  return [
    {
      node_id: "1",
      name: "开场",
      narrative_function: "normal",
      main_content: "",
      prev_node: [],
      next_node: ["2a", "2b"],
      sequence_index: 0,
      is_branch: true,
    },
    {
      node_id: "2a",
      name: "分支甲",
      narrative_function: "normal",
      main_content: "",
      prev_node: ["1"],
      next_node: [],
      sequence_index: 1,
    },
    {
      node_id: "2b",
      name: "分支乙",
      narrative_function: "normal",
      main_content: "",
      prev_node: ["1"],
      next_node: [],
      sequence_index: 2,
    },
  ] as FrameworkNode[];
}

/**
 * `fidelity` 缺省 faithful：本文件多数断言讲的是"结构照抄"，而只有忠实档照抄。
 * 缺省档的行为由专门的一组用例验，见文件末尾。
 */
function ctxWith(opts: {
  seeded: boolean;
  framework?: StoryFramework;
  fidelity?: ContentFidelity;
}): NarrativeContext {
  const ctx = {
    user_input: "把原作改成一款 JRPG",
    story_framework: opts.framework,
  } as unknown as NarrativeContext;
  // isIpDnaSeeded 只看 narrativeIpDna 在不在。
  if (opts.seeded) {
    (ctx as { narrativeIpDna?: NarrativeIpDna }).narrativeIpDna = {} as NarrativeIpDna;
    (ctx as { adaptation_directive?: AdaptationDirective }).adaptation_directive = {
      content_fidelity: opts.fidelity ?? "faithful",
    } as AdaptationDirective;
  }
  return ctx;
}

const FILL = {
  node_contents: [
    { node_id: "1", name: "重写的开场", main_content: "开场的正文" },
    { node_id: "2a", name: "重写的甲", main_content: "甲的正文" },
    { node_id: "2b", name: "重写的乙", main_content: "乙的正文" },
  ],
};

describe("IP 种子骨架", () => {
  it("有种子骨架的 IP 改编走 seeded，不落进 full", () => {
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: seedNodes() } } });
    storyFrameworkRoute(ctx);
    expect((ctx as Record<string, unknown>)._sf_mode).toBe("seeded");
  });

  // 判定必须同时看「是 IP」和「有骨架」，只看一个都会误伤：
  // 只看骨架 → 普通条目的整体重跑（用户就是想重新规划）也被冻结；
  // 只看 IP  → 没提炼出 plot_tree 的 IP 会拿着空骨架去填内容。
  it("普通条目的整体重跑仍走 full，不被种子判定误伤", () => {
    const ctx = ctxWith({ seeded: false, framework: { framework: { nodes: seedNodes() } } });
    storyFrameworkRoute(ctx);
    expect((ctx as Record<string, unknown>)._sf_mode).toBe("full");
  });

  it("没提炼出骨架的 IP 仍走 full", () => {
    for (const framework of [undefined, { framework: { nodes: [] } } as StoryFramework]) {
      const ctx = ctxWith({ seeded: true, framework });
      storyFrameworkRoute(ctx);
      expect((ctx as Record<string, unknown>)._sf_mode).toBe("full");
    }
  });

  // 局部重跑要排在种子判定前面：用户点名重跑某个节点时，要的是那个节点，
  // 不是整份种子再填一遍。
  it("带 nodeFilter 时仍是 regen，且只认被点名的节点", () => {
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: seedNodes() } } });
    (ctx as Record<string, unknown>)._nodeFilter = ["2a"];
    storyFrameworkRoute(ctx);
    const c = ctx as Record<string, unknown>;
    expect(c._sf_mode).toBe("regen");
    expect((c._sf_fixed_nodes as FrameworkNode[]).map((n) => n.node_id)).toEqual(["2a"]);
  });

  it("点名的节点不在种子里时走 skip，不改动既有框架", () => {
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: seedNodes() } } });
    (ctx as Record<string, unknown>)._nodeFilter = ["不存在的节点"];
    storyFrameworkRoute(ctx);
    expect((ctx as Record<string, unknown>)._sf_mode).toBe("skip");
    expect(normalizeStoryFramework(FILL, ctx).framework.nodes.map((n) => n.name)).toEqual([
      "开场", "分支甲", "分支乙",
    ]);
  });

  it("归一化照抄种子的节点与拓扑，只把内容盖上去", () => {
    const nodes = seedNodes();
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes } } });
    storyFrameworkRoute(ctx);
    const out = normalizeStoryFramework(FILL, ctx);

    expect(out.framework.nodes.map((n) => n.node_id)).toEqual(["1", "2a", "2b"]);
    expect(out.framework.nodes[0]!.next_node).toEqual(["2a", "2b"]);
    expect(out.framework.nodes[1]!.prev_node).toEqual(["1"]);
    // 内容来自填充，拓扑来自种子。
    expect(out.framework.nodes[0]!.name).toBe("重写的开场");
    expect(out.framework.nodes[0]!.main_content).toBe("开场的正文");
  });

  /**
   * 种子只带 `{framework:{nodes}}`，没有 dynamic_structure。若照 regen 的老路沿用
   * 既有结论，带分叉的原作会被记成 linear，下游于是按线性铺开 —— 分叉在 L0 就被
   * 抹平了，后面各层再怎么算都回不来。
   */
  it("带分叉的种子记成 branching，不被沿用成 linear", () => {
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: seedNodes() } } });
    storyFrameworkRoute(ctx);
    const out = normalizeStoryFramework(FILL, ctx);
    expect(out.dynamic_structure?.structure_type).toBe("branching");
  });

  it("没有分叉的种子记成 linear", () => {
    const flat = seedNodes().map((n) => ({ ...n, is_branch: undefined }));
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: flat } } });
    storyFrameworkRoute(ctx);
    const out = normalizeStoryFramework(FILL, ctx);
    expect(out.dynamic_structure?.structure_type).toBe("linear");
  });

  // 原作的合流关系在 plot_tree 的 merge 边上，还没被带进来。一个 mergedCount 恒为 0
  // 的统计会让下游以为这棵树分了从不收，比读不到更坏，所以这里故意不写。
  it("合流关系未知时不写 L0 分支统计", () => {
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: seedNodes() } } });
    storyFrameworkRoute(ctx);
    normalizeStoryFramework(FILL, ctx);
    expect((ctx as Record<string, unknown>)._l0_branch_stats).toBeUndefined();
  });

  it("填充没覆盖到的节点保留种子原值，不被清空", () => {
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: seedNodes() } } });
    storyFrameworkRoute(ctx);
    const out = normalizeStoryFramework(
      { node_contents: [{ node_id: "1", name: "只填了开场", main_content: "正文" }] },
      ctx,
    );
    expect(out.framework.nodes).toHaveLength(3);
    expect(out.framework.nodes[2]!.node_id).toBe("2b");
  });
});

/**
 * 忠实度决定原作结构能不能改 —— 上面那组的每条断言，换成非忠实档都应当不成立。
 *
 * 这组不是补充，是上一组成立的前提：少了它，"有原作就照抄"与"忠实档才照抄"两种实现
 * 对上一组是同一个结果，读者无从分辨接的是哪一套。
 */
describe("改编忠实度决定结构能不能改", () => {
  it("缺省档不照抄原作拓扑", () => {
    // 指令在场但没写档位 —— 字段刚引入时的存量数据就是这个样子，必须按 balanced 处理。
    const ctx = ctxWith({ seeded: true, framework: { framework: { nodes: seedNodes() } } });
    (ctx as { adaptation_directive?: AdaptationDirective }).adaptation_directive =
      {} as AdaptationDirective;
    storyFrameworkRoute(ctx);
    expect((ctx as Record<string, unknown>)._sf_mode).toBe("full");
  });

  it("balanced 与 bold、creative 都重新规划，只有 faithful 照抄", () => {
    const decide = (fidelity: ContentFidelity): unknown => {
      const ctx = ctxWith({
        seeded: true,
        fidelity,
        framework: { framework: { nodes: seedNodes() } },
      });
      storyFrameworkRoute(ctx);
      return (ctx as Record<string, unknown>)._sf_mode;
    };
    expect(decide("faithful")).toBe("seeded");
    for (const tier of ["balanced", "bold", "creative"] as ContentFidelity[]) {
      expect(decide(tier)).toBe("full");
    }
  });

  /**
   * 局部重跑不受档位影响：nodeFilter 说的是"只重做这几个节点"，与原作改不改无关。
   * 把档位判据加在 nodeFilter 前面就会让非忠实档的局部重跑变成整步重规划。
   */
  it("局部重跑在任何档位下都仍是 regen", () => {
    const ctx = ctxWith({
      seeded: true,
      fidelity: "bold",
      framework: { framework: { nodes: seedNodes() } },
    });
    (ctx as Record<string, unknown>)._nodeFilter = ["2a"];
    storyFrameworkRoute(ctx);
    expect((ctx as Record<string, unknown>)._sf_mode).toBe("regen");
  });
});
