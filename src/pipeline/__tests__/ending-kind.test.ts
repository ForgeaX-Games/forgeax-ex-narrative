/**
 * 结局分档全仓只有一套。
 *
 * 被守的分裂：曾有三套并行的结局词汇 —— IP DNA 侧的 good/neutral/bad/**open**、结构席
 * 侧的 `H | B | O`、质检侧一张 GOOD/HE/GE/TE/TRUE/BAD/BE/NE/HIDDEN 的别名网。三套各自
 * 能自洽，合起来就答不出"这个结局算哪一档"：一个隐藏的悲剧在第二套里既是 B 也是 O，
 * 落哪档取决于谁来填。
 *
 * 这里守两件事：三值就是三值（open 不是第四档），以及提示词里对模型说的话与类型一致 ——
 * 类型改了而提示词还在要 H/B/O，模型会照着提示词输出，然后被静默丢弃。
 */
import { describe, it, expect } from "vitest";
import { treeSemanticsPromptSpec } from "../graph/outline-tree.js";
import { composeSystemPrompt } from "../runtime/prompt-composer.js";
import { OUTLINE_PLAN_COMPOSER } from "../steps/outline-batch.js";
import { plotTreeToStructureSeat } from "../../ip-dna/plot-tree-to-structure.js";
import type { NarrativeContext } from "../../types/index.js";
import { toEndingType } from "../../types/narrative-ip-dna.js";
import type { PlotTree, EndingType } from "../../types/narrative-ip-dna.js";

const TIERS: EndingType[] = ["good", "bad", "neutral"];

describe("结局分档的唯一一套词汇", () => {
  it("提示词让模型给的字段名与档位就是类型里那一套", () => {
    const contract = treeSemanticsPromptSpec([
      { node_id: "1", prev_node: [], next_node: ["2"] },
      { node_id: "2", prev_node: ["1"], next_node: [] },
    ]);

    expect(contract).toContain('"kind"');
    for (const tier of TIERS) expect(contract).toContain(tier);
    // 旧词汇不得回流：模型照着 H/B/O 输出的值会被类型静默丢掉。
    expect(contract).not.toContain("H 圆满");
    expect(contract).not.toContain("B 悲剧");
  });

  it("L1 规划提示词说的档位与契约同一套", () => {
    const sp = composeSystemPrompt(OUTLINE_PLAN_COMPOSER, {} as unknown as NarrativeContext);
    expect(sp).not.toContain("H 圆满 / B 悲剧");
    expect(sp).toContain("good 圆满");
  });

  it("原作里没标落点的结局记成 neutral，不猜好坏", () => {
    // 落点要读懂剧情才知道，而映射是确定性的。记 neutral 是"没有明确落点"，
    // 猜成好或坏会让下游按一个无出处的判断去写正文。
    const tree: PlotTree = {
      entryNodeId: "1.1",
      nodes: [
        { id: "1.1", sceneId: "1", title: "起", nodeTypes: ["start"], prevNodes: [], nextNodes: [{ to: "1.2", event: "continue" }] },
        { id: "1.2", sceneId: "1", title: "终", nodeTypes: ["end"], prevNodes: ["1.1"], nextNodes: [] },
      ],
      topology: { nodeCount: 2, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 },
    };
    const seat = plotTreeToStructureSeat(tree);
    const ending = seat.outlines.find((o) => o.node_function === "ending");
    expect(ending?.ending?.kind).toBe("neutral");
  });

  /**
   * 归一必须吃得下历史词汇。
   *
   * 写入侧不受类型约束：`endingType` 由提取阶段的模型产出，存量 plot_tree 里还留着
   * `open`（曾是第四个值）与 TAPD 稿的 `true`。类型收窄到三值并不会让那些旧值消失，
   * 只会让它们静默穿透到下游 —— 在那里既匹配不上三档、也不报错。
   */
  it("历史词汇都落进三档：open→neutral，true→good", () => {
    expect(toEndingType("open")).toBe("neutral");
    expect(toEndingType("true")).toBe("good");
    // TAPD 稿里大小写不统一。
    expect(toEndingType("TrueEnd".toLowerCase().slice(0, 4))).toBe("good");
    expect(toEndingType("GOOD")).toBe("good");
    for (const tier of TIERS) expect(toEndingType(tier)).toBe(tier);
  });

  it("认不出来的词归 neutral，不抛错也不猜", () => {
    // 抛错会让一个词把整次改编顶掉；猜好坏会让下游按无出处的判断写正文。
    for (const unknown of ["hidden", "隐藏结局", "", null, undefined, 7, {}]) {
      expect(toEndingType(unknown)).toBe("neutral");
    }
  });
});
