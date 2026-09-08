import { describe, it, expect } from "vitest";
import {
  ENTRY_CATALOG_ID,
  computeAnchoredPipelines,
  findCatalogItem,
  instantiateComposerNode,
  isEntryNode,
  type ComposerEdgeData,
  type ComposerNodeData,
} from "../viz/src/composer/composerCatalog.js";

/**
 * 需求入口节点作为锚点的不变式。
 *
 * 入口是整张图的锚点：后端拿它的 id 当 `compositionGraph.startNodeId` 切分子图，
 * 产物地址的头两元（entryKey / pipelineId）都挂在它这条泳道上。所以"独立形态下
 * 开始节点仍是一条可跑的管线"不是 UI 细节，而是这套寻址的前提——它一旦不成立，
 * 用户在空画布上填完需求点开始会得到"没有可跑的管线"。
 */

function entryNode(id = "entry-1"): ComposerNodeData {
  const item = findCatalogItem(ENTRY_CATALOG_ID);
  if (!item) throw new Error("entry catalog item missing");
  return instantiateComposerNode(item, { x: 0, y: 0 }, id);
}

describe("需求入口节点 · 锚点不变式", () => {
  it("目录里有入口条目，且它被认作 entry", () => {
    expect(isEntryNode(entryNode())).toBe(true);
  });

  it("三输入模式与三轴的 config 键齐备（默认直接输入、三轴自动）", () => {
    const cfg = entryNode().config;
    expect(cfg.inputTab).toBe("text");
    expect(cfg).toHaveProperty("userInput");
    expect(cfg).toHaveProperty("tagSelections");
    expect(cfg).toHaveProperty("tagCustomTexts");
    expect(cfg.storyType).toBeNull();
    expect(cfg.storyTheme).toBeNull();
    expect(cfg.complexity).toBeUndefined();
  });

  it("独立形态：孤零零一枚入口也是一条管线，且它自己兼任路由", () => {
    const pipes = computeAnchoredPipelines([entryNode()], []);
    expect(pipes).toHaveLength(1);
    expect(pipes[0]!.orderedNodes.map((n) => n.id)).toEqual(["entry-1"]);
    // 入口自带三轴，所以不必再往后接一枚路由节点才算"配全了"。
    expect(pipes[0]!.routingNode?.id).toBe("entry-1");
  });

  it("接了显式路由节点时以那一枚为准（显式编排优先于入口自带默认值）", () => {
    const routing = findCatalogItem("routing.narrative");
    if (!routing) throw new Error("routing.narrative catalog item missing");
    const routeNode = instantiateComposerNode(routing, { x: 200, y: 0 }, "route-1");
    const edges: ComposerEdgeData[] = [
      { id: "e1", source: "entry-1", target: "route-1" },
    ];
    const pipes = computeAnchoredPipelines([entryNode(), routeNode], edges);
    expect(pipes[0]!.routingNode?.id).toBe("route-1");
  });

  it("多枚入口 → 多条泳道，各以自己那枚为锚点", () => {
    const pipes = computeAnchoredPipelines([entryNode("a"), entryNode("b")], []);
    expect(pipes.map((p) => p.inputNode.id)).toEqual(["a", "b"]);
  });
});
