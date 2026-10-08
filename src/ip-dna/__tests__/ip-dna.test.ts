import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { computeImpactSet, computeUpstreamSet } from "../data-atlas.js";
import {
  detectHierarchyMarkers,
  buildLightHierarchy,
  assessVolume,
  decomposeByMarkers,
  DECOMPOSE_THRESHOLD,
} from "../phase1-understanding.js";
import {
  flattenMinimalUnits,
  cropByScope,
  planGameUnits,
  buildAdaptationDirective,
  DEFAULT_UNITS_PER_GAME_UNIT,
} from "../phase2b-adapt.js";
import {
  aggregateSummaries,
  aggregateTemplates,
  aggregateSubtreeTemplates,
  normalizeTemplate,
  mapTemplateToContext,
} from "../phase2-extract.js";
import { deriveNodeBudgetOverride, planPipelineRuns, MIN_PLOT_TREE_NODES, buildSeriesEndingDirective, DEFAULT_MAX_ENDINGS_PER_SERIES_UNIT } from "../phase2c-gen-adapt.js";
import { KeywordOperatorRetriever, inferPerspective, precheckConflict, fillSlot } from "../phase3-rag.js";
import { KagGraph } from "../phase3b-kag.js";
import { analyzeRewriteImpact, projectAllPerspectives } from "../phase4-rewrite.js";
import { createEmptyIpDna, saveIpDna, loadHierarchyIndex, loadNodeTriad } from "../filesystem.js";
import type { NarrativeIpDna, NarrativeOperator, NarrativeTemplate, OperatorSlot } from "../../types/narrative-ip-dna.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-"));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });

// 构造一个带 部/章/节 三层的样例层级树
function sampleDna(): NarrativeIpDna {
  const dna = createEmptyIpDna({ story_id: "20260101_0000", title: "测试故事", media_type: "book" });
  const root = dna.nodes[dna.rootId];
  // 2 部，每部 2 章，每章 N 节
  let leafSeq = 0;
  const addNode = (id: string, levelType: any, index: number, parent: string) => {
    dna.nodes[id] = { id, levelType, index, title: id, parent, children: [] };
    dna.nodes[parent].children.push(id);
  };
  for (let p = 1; p <= 2; p++) {
    const partId = `p${p}`;
    addNode(partId, "part", p, root.id);
    for (let c = 1; c <= 2; c++) {
      const chId = `${partId}c${c}`;
      addNode(chId, "chapter", c, partId);
      const unitsInCh = p === 2 && c === 2 ? 10 : 20; // 末章节点少，测合并
      for (let u = 1; u <= unitsInCh; u++) {
        leafSeq++;
        addNode(`${chId}u${u}`, "unit", u, chId);
      }
    }
  }
  return dna;
}

describe("data-atlas", () => {
  it("computeImpactSet 沿 downstream 传播", () => {
    const impact = computeImpactSet(["A.characters"]);
    expect(impact).toContain("B.detailed_character_sheets");
    // 间接下游
    expect(impact).toContain("B.plots_generated");
  });
  it("computeUpstreamSet 反向溯源", () => {
    const up = computeUpstreamSet("B.plots_generated");
    expect(up).toContain("B.detailed_outlines_generated");
    expect(up.length).toBeGreaterThan(0);
  });
});

describe("phase1 层级识别", () => {
  it("识别中文卷/章/节标记", () => {
    const text = "第一卷 起源\n正文\n第一章 黎明\n第一节 序\n正文\n第二节 醒\n";
    const markers = detectHierarchyMarkers(text);
    expect(markers.map((m) => m.levelType)).toEqual(["part", "chapter", "unit", "unit"]);
  });
  it("识别 markdown 标题", () => {
    const markers = detectHierarchyMarkers("# 卷一\n## 章一\n### 节一\n");
    expect(markers.map((m) => m.levelType)).toEqual(["part", "chapter", "unit"]);
  });
  it("构建轻量层级树并标注 childRange", () => {
    const text = "# 卷一\n## 章一\n### 节一\n### 节二\n## 章二\n### 节三\n";
    const dna = buildLightHierarchy({ story_timestamp: "t", title: "T", media_type: "book", text });
    const units = flattenMinimalUnits(dna);
    expect(units.length).toBe(3);
    const root = dna.nodes[dna.rootId];
    expect(root.children.length).toBeGreaterThan(0);
  });
  it("无标记时整篇作为单一最小单元", () => {
    const dna = buildLightHierarchy({ story_timestamp: "t", title: "T", media_type: "book", text: "纯散文无标记" });
    expect(flattenMinimalUnits(dna).length).toBe(1);
  });
  it("体量判断与拆解", () => {
    const big = "第一章 X\n".concat("字".repeat(DECOMPOSE_THRESHOLD + 10));
    const v = assessVolume(big);
    expect(v.needsDecompose).toBe(true);
    const chunks = decomposeByMarkers("第一章 A\naaa\n第二章 B\nbbb\n");
    expect(chunks.length).toBe(2);
    expect(chunks[0].title).toContain("第一章");
  });
});

describe("phase2b 游戏单元切分", () => {
  it("flatten + 全量裁剪", () => {
    const dna = sampleDna();
    const all = flattenMinimalUnits(dna);
    expect(all.length).toBe(20 + 20 + 20 + 10); // 70
    const cropped = cropByScope(dna, { full: true });
    expect(cropped.length).toBe(70);
  });

  it("嵌套裁剪 adaptation_scope（选 p1 整部）", () => {
    const dna = sampleDna();
    const cropped = cropByScope(dna, { full: false, selections: [{ nodeId: "p1" }] });
    expect(cropped.length).toBe(40);
    expect(cropped.every((u) => u.id.startsWith("p1"))).toBe(true);
  });

  it("childRange 裁剪（p1 仅第1章）", () => {
    const dna = sampleDna();
    const cropped = cropByScope(dna, { full: false, selections: [{ nodeId: "p1", childRange: [1, 1] }] });
    expect(cropped.length).toBe(20);
    expect(cropped.every((u) => u.id.startsWith("p1c1"))).toBe(true);
  });

  it("single 模式整段为一个游戏单元", () => {
    const dna = sampleDna();
    const all = flattenMinimalUnits(dna);
    const plan = planGameUnits(dna, all, { mode: "single" });
    expect(plan.units.length).toBe(1);
    expect(plan.units[0].unitRange.start).toBe(all[0].id);
    expect(plan.units[0].unitRange.end).toBe(all[all.length - 1].id);
  });

  it("series 模式按硬区间(部)强制断 + 默认25切分", () => {
    const dna = sampleDna();
    const all = flattenMinimalUnits(dna);
    const plan = planGameUnits(dna, all, { mode: "series" });
    // 每部40节点 → 跨部不可合并；末部仅30(20+10)
    expect(plan.mode).toBe("series");
    // 不应出现跨部的游戏单元
    for (const u of plan.units) {
      const start = u.unitRange.start;
      const end = u.unitRange.end;
      expect(start.slice(0, 2)).toBe(end.slice(0, 2)); // 同部前缀 pX
    }
    expect(plan.units.length).toBeGreaterThanOrEqual(2);
  });

  it("末单元 < 25 并入前一单元（同部内）", () => {
    const dna = createEmptyIpDna({ story_id: "t", title: "T", media_type: "book" });
    const root = dna.nodes[dna.rootId];
    dna.nodes["c1"] = { id: "c1", levelType: "chapter", index: 1, title: "c1", parent: root.id, children: [] };
    root.children.push("c1");
    // 30 个最小单元在同一章（软区间），默认25切 → 25 + 5 → 末单元5<25并入 → 1 个单元
    for (let i = 1; i <= 30; i++) {
      const id = `u${i}`;
      dna.nodes[id] = { id, levelType: "unit", index: i, title: id, parent: "c1", children: [] };
      dna.nodes["c1"].children.push(id);
    }
    const all = flattenMinimalUnits(dna);
    const plan = planGameUnits(dna, all, { mode: "series" });
    expect(plan.units.length).toBe(1);
    expect(plan.units[0].targetNodeCount).toBeGreaterThanOrEqual(DEFAULT_UNITS_PER_GAME_UNIT);
  });

  it("buildAdaptationDirective 默认全量+多部体量→series", () => {
    const dna = sampleDna();
    const dir = buildAdaptationDirective(dna);
    expect(dir.adaptation_scope.full).toBe(true);
    // sampleDna 多部 >25 节点 → 默认切出多个游戏单元 → series
    expect(dir.game_unit_plan.mode).toBe("series");
    expect(dir.game_unit_plan.units.length).toBeGreaterThanOrEqual(2);
    expect(dir.dimensions.templateFields).toContain("story_structure");
  });

  // §4.4「按体量」：短单 IP 默认降档为单品（无"部"层），不强套 series。
  it("buildAdaptationDirective 默认对短单 IP 降档为 single（无部层）", () => {
    const dna = createEmptyIpDna({ story_id: "t", title: "T", media_type: "book" });
    const root = dna.nodes[dna.rootId];
    dna.nodes["c1"] = { id: "c1", levelType: "chapter", index: 1, title: "c1", parent: root.id, children: [] };
    root.children.push("c1");
    // 30 个最小单元在同一章 → series 默认切分会因末单元合并退化为 1 个单元
    for (let i = 1; i <= 30; i++) {
      const id = `u${i}`;
      dna.nodes[id] = { id, levelType: "unit", index: i, title: id, parent: "c1", children: [] };
      dna.nodes["c1"].children.push(id);
    }
    const dir = buildAdaptationDirective(dna);
    expect(dir.game_unit_plan.mode).toBe("single");
    expect(dir.game_unit_plan.units.length).toBe(1);
  });

  it("显式 series 即使只得 1 个单元也尊重，不降档", () => {
    const dna = createEmptyIpDna({ story_id: "t", title: "T", media_type: "book" });
    const root = dna.nodes[dna.rootId];
    dna.nodes["c1"] = { id: "c1", levelType: "chapter", index: 1, title: "c1", parent: root.id, children: [] };
    root.children.push("c1");
    for (let i = 1; i <= 30; i++) {
      const id = `u${i}`;
      dna.nodes[id] = { id, levelType: "unit", index: i, title: id, parent: "c1", children: [] };
      dna.nodes["c1"].children.push(id);
    }
    const dir = buildAdaptationDirective(dna, { mode: "series" });
    expect(dir.game_unit_plan.mode).toBe("series");
  });

  it("buildAdaptationDirective 回填三步对话产物（scope/plan/dimensions 全可覆盖）", () => {
    const dna = sampleDna();
    // §4.4 第①步裁剪范围 + 第②步游戏单元规划 + 第③步改编维度，均由平台对话回填。
    const dir = buildAdaptationDirective(dna, {
      scope: { full: false, selections: [{ nodeId: "p1" }] },
      gameUnitPlan: { mode: "single", userSpecified: true, units: [
        { index: 1, unitRange: { start: "p1", end: "p1" }, boundary: "hard", targetNodeCount: 30 },
      ] },
      dimensions: { templateFields: ["worldview.item_inventory"] },
    });
    expect(dir.adaptation_scope.full).toBe(false);
    expect(dir.game_unit_plan.mode).toBe("single");
    expect(dir.game_unit_plan.userSpecified).toBe(true);
    expect(dir.dimensions.templateFields).toEqual(["worldview.item_inventory"]);
  });
});

describe("phase2 聚合与映射", () => {
  const mkTpl = (over: Partial<NarrativeTemplate>): NarrativeTemplate =>
    normalizeTemplate({
      summary: { characters: over.summary?.characters ?? [], scene: over.summary?.scene ?? "", events: over.summary?.events ?? "" },
      characters: over.characters,
      worldview: over.worldview,
      core_elements: over.core_elements,
    });

  it("aggregateSummaries 去重角色、拼接", () => {
    const agg = aggregateSummaries([
      { characters: ["A", "B"], scene: "城", events: "相遇" },
      { characters: ["B", "C"], scene: "野", events: "决裂" },
    ]);
    expect(agg.characters.sort()).toEqual(["A", "B", "C"]);
    expect(agg.scene).toContain("城");
    expect(agg.events).toContain("决裂");
  });

  it("aggregateTemplates 合并角色与关系", () => {
    const t1 = mkTpl({ characters: [{ name: "甲", profile: "p", relationships: [{ target: "乙", relation: "友" }] }] });
    const t2 = mkTpl({ characters: [{ name: "甲", profile: "p", arc: "成长", relationships: [{ target: "丙", relation: "敌" }] }] });
    const agg = aggregateTemplates([t1, t2]);
    expect(agg.characters.length).toBe(1);
    expect(agg.characters[0].arc).toBe("成长");
    expect(agg.characters[0].relationships?.length).toBe(2);
  });

  it("aggregateSubtreeTemplates 由下至上上卷", () => {
    const dna = createEmptyIpDna({ story_id: "t", title: "T", media_type: "book" });
    const root = dna.nodes[dna.rootId];
    for (let i = 1; i <= 2; i++) {
      const id = `u${i}`;
      dna.nodes[id] = {
        id, levelType: "unit", index: i, title: id, parent: root.id, children: [],
        template: mkTpl({ summary: { characters: [`角${i}`], scene: `场${i}`, events: `事${i}` } }),
      };
      root.children.push(id);
    }
    const agg = aggregateSubtreeTemplates(dna, dna.rootId);
    expect(agg?.summary.characters.sort()).toEqual(["角1", "角2"]);
    expect(dna.nodes[dna.rootId].template).toBeDefined();
  });

  it("mapTemplateToContext 填 core_settings", () => {
    const tpl = mkTpl({
      characters: [{ name: "主角", profile: "勇者" }, { name: "反派", profile: "魔王", relationships: [{ target: "主角", relation: "宿敌" }] }],
      core_elements: { subject: "奇幻", theme: "成长", core_conflict: "光暗", literature_style: "史诗", emotion_experience: "热血" },
    });
    const ctx = mapTemplateToContext(tpl, { user_input: "" } as any);
    expect(ctx.core_settings?.protagonist.name).toBe("主角");
    expect(ctx.core_settings?.key_npcs.length).toBe(1);
    expect(ctx.core_settings?.genre).toBe("奇幻");
  });
});

describe("phase2c 管线适配", () => {
  it("节点预算 ≥25 节点", () => {
    const b = deriveNodeBudgetOverride(10); // 低于25会被抬到25
    expect(b.l0_nodes * b.l1_per_parent * b.l2_per_parent).toBeGreaterThanOrEqual(
      MIN_PLOT_TREE_NODES,
    );
  });
  it("planPipelineRuns 给每个游戏单元一份节点预算", () => {
    const plan = { mode: "series" as const, userSpecified: false, units: [
      { index: 1, unitRange: { start: "a", end: "b" }, boundary: "hard" as const, targetNodeCount: 30 },
      { index: 2, unitRange: { start: "c", end: "d" }, boundary: "hard" as const, targetNodeCount: 30 },
    ]};
    const runs = planPipelineRuns(plan);
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r.nodeBudgetOverride).toBeDefined();
    // 曾按 rpg / vn 分出 topLevelMapping 与 tpl-vn-v2 两种映射；两者都没有运行时读取者，
    // 已随 family 一并删除（见 GameUnitPipelinePlan 注释）。
  });

  it("buildSeriesEndingDirective：系列结局收束约束（§4.6b）", () => {
    // 单品/单部 → 不注入。
    expect(buildSeriesEndingDirective("single", 1, 1)).toBe("");
    expect(buildSeriesEndingDirective("series", 1, 1)).toBe("");
    // 系列非末部：承接结局 + 数量上限 + 禁跨部连边。
    const mid = buildSeriesEndingDirective("series", 1, 3);
    expect(mid).toContain("承接结局");
    expect(mid).toContain(String(DEFAULT_MAX_ENDINGS_PER_SERIES_UNIT));
    expect(mid).toContain("禁止");
    // 系列末部：全部就地收束、不留钩子。
    const last = buildSeriesEndingDirective("series", 3, 3);
    expect(last).toContain("最后一部");
    expect(last).toContain("就地收束");
    expect(last).not.toContain("承接结局");
    // 自定义上限透传。
    expect(buildSeriesEndingDirective("series", 2, 3, 4)).toContain("4 个以内");
  });
});

describe("phase3 三视角 RAG", () => {
  const op = (uid: string, domain: string, kw: string): NarrativeOperator => ({
    uid, name: kw, definition: `${kw}的定义`, adaptation: { type: "结构", element: "节奏" },
    usage_guide: `${kw}用法`, example: "例", knowledge_location: "知识库", knowledge_domain: domain,
  });

  it("inferPerspective 按 domain 分组", () => {
    expect(inferPerspective(op("1", "情感体验", "代入"))).toBe("reader");
    expect(inferPerspective(op("2", "角色动机", "弧光"))).toBe("character");
    expect(inferPerspective(op("3", "叙事技巧", "悬念"))).toBe("author");
  });

  it("KeywordOperatorRetriever 命中", async () => {
    const r = new KeywordOperatorRetriever([op("a", "叙事技巧", "悬念铺垫"), op("b", "叙事技巧", "无关")]);
    const got = await r.retrieve("如何制造悬念铺垫", "author", 1);
    expect(got[0]?.uid).toBe("a");
  });

  it("precheckConflict 检出对冲", () => {
    const c = precheckConflict([
      { perspective: "author", source: "extracted", operator: { ...op("a", "叙事技巧", "x"), usage_guide: "节奏舒缓铺垫" } },
      { perspective: "reader", source: "extracted", operator: { ...op("b", "情感体验", "y"), usage_guide: "节奏紧凑急促" } },
    ]);
    expect(c.hasConflict).toBe(true);
  });

  it("fillSlot 三视角满员（含 LLM 生成兜底）", async () => {
    const fakeLlm: any = {
      callWithRetry: async () => JSON.stringify({ uid: "", name: "生成算子", definition: "d", adaptation: { type: "t", element: "e" }, usage_guide: "g", example: "x", knowledge_location: "", knowledge_domain: "故事内容" }),
    };
    const retriever = new KeywordOperatorRetriever([op("r1", "情感体验", "代入感")]);
    const slot = await fillSlot({
      slotName: "节奏",
      query: "代入感",
      extracted: [op("e1", "叙事技巧", "技巧")], // author 提取
      retriever,
      llm: fakeLlm,
      storyTitle: "我的故事",
    });
    expect(slot.candidates.length).toBe(3);
    const byPersp = Object.fromEntries(slot.candidates.map((c) => [c.perspective, c]));
    expect(byPersp.author.source).toBe("extracted");
    expect(byPersp.reader.source).toBe("retrieved");
    expect(byPersp.character.source).toBe("generated");
    // 生成算子来源名 = 标题
    expect(byPersp.character.operator.knowledge_location).toBe("我的故事");
  });
});

describe("phase3b KAG 图谱", () => {
  it("CRUD + 关系/场景/最短路径 + JSONL 往返", () => {
    const g = new KagGraph();
    g.upsertNode({ id: "甲", type: "character", name: "甲" });
    g.upsertNode({ id: "乙", type: "character", name: "乙" });
    g.upsertNode({ id: "丙", type: "character", name: "丙" });
    g.upsertNode({ id: "s1", type: "scene", name: "广场" });
    g.addEdge({ from: "甲", to: "乙", relation: "盟友", directed: false });
    g.addEdge({ from: "乙", to: "丙", relation: "敌对", directed: false });
    g.addEdge({ from: "甲", to: "s1", relation: "位于" });

    expect(g.characterRelations("甲").map((r) => r.to.id)).toContain("乙");
    expect(g.charactersInScene("s1").map((n) => n.id)).toEqual(["甲"]);
    const path = g.shortestPath("甲", "丙");
    expect(path?.map((p) => p.node)).toEqual(["甲", "乙", "丙"]);

    const dir = path ? `${TMP}/kag` : `${TMP}/kag`;
    g.saveJsonl(dir);
    const g2 = KagGraph.loadJsonl(dir);
    expect(g2.findByType("character").length).toBe(3);
    expect(g2.shortestPath("甲", "丙")?.length).toBe(3);
  });
});

describe("phase4 改写影响面 + 投影", () => {
  it("analyzeRewriteImpact 标脏下游与输入节点", () => {
    const dna = createEmptyIpDna({ story_id: "t", title: "T", media_type: "book" });
    // 字段级反向追溯：节点须实际承载被改字段（此处 A.characters）且已改编/已生成才标脏。
    dna.nodes["u1"] = {
      id: "u1", levelType: "unit", index: 1, title: "u1", parent: dna.rootId, children: [],
      template: normalizeTemplate({ characters: [{ name: "张三", profile: "主角" }] }),
      metadata: { processing_status: "extracted", adaptation_status: "已生成", stats: { char_count: 0, operator_count: 0 }, updated_at: "" },
    };
    dna.nodes[dna.rootId].children.push("u1");
    const impact = analyzeRewriteImpact(["A.characters"], dna);
    expect(impact.affectedDownstream).toContain("B.detailed_character_sheets");
    expect(impact.affectedInputNodes).toContain("u1");
  });

  it("projectAllPerspectives 切片展示", () => {
    const slots: OperatorSlot[] = [{
      slot_name: "节奏",
      candidates: [
        { perspective: "author", source: "extracted", operator: { uid: "a", name: "作者算子", definition: "d", adaptation: { type: "t", element: "e" }, usage_guide: "g", example: "x", knowledge_location: "", knowledge_domain: "" } },
        { perspective: "reader", source: "retrieved", operator: { uid: "b", name: "读者算子", definition: "d", adaptation: { type: "t", element: "e" }, usage_guide: "g", example: "x", knowledge_location: "", knowledge_domain: "" } },
        { perspective: "character", source: "generated", operator: { uid: "c", name: "角色算子", definition: "d", adaptation: { type: "t", element: "e" }, usage_guide: "g", example: "x", knowledge_location: "", knowledge_domain: "" } },
      ],
    }];
    const all = projectAllPerspectives(slots);
    expect(all.length).toBe(3);
    expect(all.find((p) => p.perspective === "reader")?.slots[0].operatorName).toBe("读者算子");
  });
});

describe("filesystem 落盘往返", () => {
  it("saveIpDna → loadHierarchyIndex + loadNodeTriad 懒加载", () => {
    const dna = createEmptyIpDna({ story_id: "20260101_1200", title: "落盘测试", media_type: "book" });
    dna.nodes[dna.rootId].displayName = "《落盘测试》";
    dna.nodes["u1"] = {
      id: "u1", levelType: "unit", index: 1, title: "单元1", parent: dna.rootId, children: [],
      displayName: "1_《单元1》",
      lineage: [
        { id: dna.rootId, levelType: "complete", index: 0, displayName: "《落盘测试》" },
        { id: "u1", levelType: "unit", index: 1, displayName: "1_《单元1》" },
      ],
      template: normalizeTemplate({ summary: { characters: ["甲"], scene: "城", events: "事" } }),
      operators: [{ uid: "o1", name: "算子", definition: "d", adaptation: { type: "t", element: "e" }, usage_guide: "g", example: "x", knowledge_location: "l", knowledge_domain: "故事内容" }],
      metadata: { processing_status: "extracted", adaptation_status: "未改编" },
    };
    dna.nodes[dna.rootId].children.push("u1");

    saveIpDna(dna, { cwd: TMP });
    const idx = loadHierarchyIndex("20260101_1200", "落盘测试", { cwd: TMP });
    expect(idx?.nodes["u1"]).toBeDefined();
    // 索引不含三件套正文
    expect(idx?.nodes["u1"].template).toBeUndefined();
    // 懒加载三件套（按 lineage 嵌套 displayName 目录写入/读取，路径对称）
    const triad = loadNodeTriad("20260101_1200", "落盘测试", idx!.nodes["u1"], { cwd: TMP });
    expect(triad.template?.summary.characters).toEqual(["甲"]);
    expect(triad.operators?.[0].uid).toBe("o1");
  });
});
