import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { mapTemplateToContext, aggregateTemplates, normalizeTemplate } from "../phase2-extract.js";
import { buildLightHierarchy } from "../phase1-understanding.js";
import { runIpDnaPipeline } from "../orchestrator.js";
import type { NarrativeTemplate, PlotTree } from "../../types/narrative-ip-dna.js";

/**
 * 批5 scoped 提取时机重排 + A→B 映射补全 + plot_tree 实质保留。
 */

const SAMPLE = [
  "# 第一部",
  "## 第一章",
  "### 第一节",
  "张三在安全屋醒来，发现物资告急。",
  "### 第二节",
  "李四带来废墟探索的消息。",
  "## 第二章",
  "### 第三节",
  "王五率众围攻，终局之战爆发。",
].join("\n");

function leafPlotTree(entry: string): PlotTree {
  return {
    entryNodeId: entry,
    nodes: [
      { id: entry, sceneId: entry.split(".")[0], title: `起-${entry}`, nodeTypes: ["start"], prevNodes: [], nextNodes: [{ to: `${entry}b`, event: "continue" }] },
      { id: `${entry}b`, sceneId: entry.split(".")[0], title: `终-${entry}`, nodeTypes: ["end"], prevNodes: [entry], nextNodes: [], endingType: "open", endingPosition: "final" },
    ],
    topology: { nodeCount: 2, startCount: 1, endCount: 1, pivotCount: 0, mergeCount: 0 },
  };
}

function templateWithPlot(entry: string): NarrativeTemplate {
  const t = normalizeTemplate({
    worldview: { setting: "末世冰封", scene_structure: "安全屋 / 废墟", item_inventory: "求生刀、急救包、信号枪" },
    characters: [{ name: "张三", profile: "幸存者", arc: "成长" }],
    core_elements: { subject: "末世", theme: "希望", core_conflict: "资源", literature_style: "写实", emotion_experience: "紧张" },
    summary: { characters: ["张三"], scene: "都市", events: "遭遇" },
  });
  t.story_structure.plot_tree = leafPlotTree(entry);
  t.story_structure.topology = leafPlotTree(entry).topology;
  return t;
}

describe("batch5: A→B 映射补全 scene_map/item_database/story_framework", () => {
  it("mapTemplateToContext 填充 scene_map（场景结构种子）", () => {
    const ctx = mapTemplateToContext(templateWithPlot("1.1"), { user_input: "", story_title: "冰封" });
    expect(ctx.scene_map?.world_name).toBe("冰封");
    expect(ctx.scene_map?._scene_structure_md).toContain("安全屋");
    expect(ctx.scene_map?.scenes).toEqual([]);
  });

  it("mapTemplateToContext 把道具清单切成 item_database 种子条目", () => {
    const ctx = mapTemplateToContext(templateWithPlot("1.1"), { user_input: "", story_title: "冰封" });
    const names = (ctx.item_database ?? []).map((i) => i.name);
    expect(names).toContain("求生刀");
    expect(names).toContain("急救包");
    expect(names).toContain("信号枪");
  });

  it("mapTemplateToContext 由 plot_tree 构建 story_framework + 初始大纲结构", () => {
    const ctx = mapTemplateToContext(templateWithPlot("1.1"), { user_input: "", story_title: "冰封" });
    expect(ctx.story_framework?.framework.nodes.length).toBe(2);
    expect(ctx.story_framework?.framework.nodes[0].node_id).toBe("1.1");
    expect(ctx.initial_story_outline?.story_structure.opening).toContain("起");
    expect(ctx.initial_story_outline?.story_structure.ending).toContain("终");
  });
});

describe("batch5: 聚合保留 plot_tree（§4.3）", () => {
  it("aggregateTemplates 合并子单元 plot_tree 而非丢弃", () => {
    const agg = aggregateTemplates([templateWithPlot("1.1"), templateWithPlot("2.1")]);
    expect(agg.story_structure.plot_tree).toBeDefined();
    // 两棵子树各 2 节点 → 合并后 4 节点（id 不冲突）。
    expect(agg.story_structure.plot_tree!.nodes.length).toBe(4);
    expect(agg.story_structure.topology.nodeCount).toBe(4);
  });
});

describe("batch5: scoped 提取时机重排（仅提取选中单元）", () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-b5-"));
  afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

  it("仅对改编范围内的最小单元提取，范围外不提取", async () => {
    // 用同一文本预构层级树定位"第一章"节点 id（orchestrator 内部构树确定性一致）。
    const probe = buildLightHierarchy({ story_timestamp: "20260101_0000", title: "范围", media_type: "book", text: SAMPLE });
    const chapter1 = Object.values(probe.nodes).find((n) => n.levelType === "chapter" && n.index === 1);
    expect(chapter1).toBeDefined();

    const result = await runIpDnaPipeline({
      files: [{ fileName: "s.md", data: SAMPLE, fileType: "text/markdown" }],
      title: "范围",
      cwd: TMP,
      runGeneration: false,
      scope: { full: false, selections: [{ nodeId: chapter1!.id }] },
    });

    const leaves = Object.values(result.dna.nodes).filter((n) => n.children.length === 0);
    const extracted = leaves.filter((n) => n.metadata?.processing_status === "extracted");
    const notExtracted = leaves.filter((n) => !n.metadata);
    // 第一章下两节被提取，第二章下一节未提取。
    expect(extracted.length).toBe(2);
    expect(notExtracted.length).toBe(1);
  });

  it("默认全量范围：所有最小单元都被提取", async () => {
    const result = await runIpDnaPipeline({
      files: [{ fileName: "s2.md", data: SAMPLE, fileType: "text/markdown" }],
      title: "全量",
      cwd: TMP,
      runGeneration: false,
    });
    const leaves = Object.values(result.dna.nodes).filter((n) => n.children.length === 0);
    expect(leaves.every((n) => n.metadata?.processing_status === "extracted")).toBe(true);
  });
});
