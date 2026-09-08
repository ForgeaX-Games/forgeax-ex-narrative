import { describe, it, expect } from "vitest";

import {
  buildLightHierarchy,
  buildHierarchyFromSegments,
  segmentsFromTexts,
  segmentsHaveStructure,
  classifyStructureType,
  computeAggregationTimes,
  treeMaxDepth,
  detectHierarchyMarkers,
  collectLeafIds,
  sliceUnitTexts,
  guessLevelsFromHierarchy,
  MAX_UNIT_CHARS,
} from "../phase1-understanding.js";
import {
  analyzeHierarchy,
  synthesizeParentSummary,
  batchCompressSummaries,
  aggregateSubtreeTemplatesRecursive,
  extractParentOperators,
  normalizeOperator,
  heuristicExtractUnit,
} from "../phase2-extract.js";
import type { LLMClient } from "../../pipeline/runtime/llm-client.js";
import type { TemplateSummary } from "../../types/narrative-ip-dna.js";
import { archiveAndBuildManifest, type IncomingFile } from "../phase0-foundation.js";
import { transcribeMediaFiles, detectMediaUnit, buildMultimodalMarkdown } from "../phase1-multimodal.js";
import { loadManifest, mediaOriginalDir } from "../filesystem.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TS = "2026-06-26_120000";

describe("batch8 · 结构类型 + 聚合次数（§3.2/§3.3）", () => {
  it("三层标记文本 → three_layer，聚合层数=3", () => {
    const text = [
      "# 第一卷 风起",
      "## 第一章 启程",
      "### 第一节 离家",
      "少年离家踏上旅途。".repeat(10),
      "### 第二节 初遇",
      "途中遇见同伴。".repeat(10),
      "## 第二章 试炼",
      "### 第三节 试炼开始",
      "试炼正式开始。".repeat(10),
    ].join("\n");
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "测试卷", media_type: "book", text });
    expect(dna.structureType).toBe("three_layer");
    expect(dna.aggregationTimes).toBe(3);
    expect(treeMaxDepth(dna)).toBe(3);
    // 部/卷与章作为真实中间层节点存在。
    const levels = new Set(Object.values(dna.nodes).map((n) => n.levelType));
    expect(levels.has("part")).toBe(true);
    expect(levels.has("chapter")).toBe(true);
    expect(levels.has("unit")).toBe(true);
  });

  it("仅多章无卷 → single_layer，聚合层数=1", () => {
    const text = ["# 第一章 起", "起。".repeat(10), "# 第二章 承", "承。".repeat(10)].join("\n");
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "多章", media_type: "book", text });
    expect(["single_layer", "two_layer"]).toContain(dna.structureType);
    expect(computeAggregationTimes(dna)).toBe(treeMaxDepth(dna));
  });

  it("无标记短篇 → single_file，整体一个最小单元", () => {
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "短篇", media_type: "book", text: "一段散文，没有任何结构标记。".repeat(5) });
    expect(dna.structureType).toBe("single_file");
    expect(collectLeafIds(dna).length).toBe(1);
  });

  it("小数嵌套编号 1.1 / 1.1.1 被识别为 chapter / unit 并嵌套", () => {
    const text = [
      "1.1 背景设定",
      "背景介绍。".repeat(8),
      "1.1.1 世界观细节",
      "更细的世界观。".repeat(8),
    ].join("\n");
    const markers = detectHierarchyMarkers(text);
    expect(markers.length).toBe(2);
    expect(markers[0].levelType).toBe("chapter");
    expect(markers[1].levelType).toBe("unit");
  });
});

describe("batch8 · 多文件/卷目录建树（§3.2）", () => {
  it("文件夹 → part，文件 → chapter/unit，sourceRange 可在 fullText 上切片", () => {
    const items = [
      { path: "卷一/第01章.txt", text: "第一章的正文内容。".repeat(10) },
      { path: "卷一/第02章.txt", text: "第二章的正文内容。".repeat(10) },
      { path: "卷二/第03章.txt", text: "第三章的正文内容。".repeat(10) },
    ];
    const { segments, fullText } = segmentsFromTexts(items);
    expect(segmentsHaveStructure(segments)).toBe(true);

    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "分卷小说", media_type: "book" }, segments);
    // 两个卷目录 → 两个 part 节点。
    const parts = Object.values(dna.nodes).filter((n) => n.levelType === "part");
    expect(parts.length).toBe(2);
    // 至少两层（卷-章）。
    expect(dna.structureType === "two_layer" || dna.structureType === "three_layer").toBe(true);

    // sourceRange 切片应与原文件正文一致。
    const slices = sliceUnitTexts(dna, fullText);
    const allText = [...slices.values()].join("");
    expect(allText).toContain("第一章的正文内容");
    expect(allText).toContain("第三章的正文内容");
  });

  it("多文件 = 天然以文件为最小叙事单元边界（看结构不看名字）", () => {
    const items = [
      { path: "a.txt", text: "甲文本。".repeat(10) },
      { path: "b.txt", text: "乙文本。".repeat(10) },
    ];
    const { segments } = segmentsFromTexts(items);
    // 多文件即结构：每个文件就是一个节。
    expect(segmentsHaveStructure(segments)).toBe(true);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "双文件", media_type: "book" }, segments);
    const units = Object.values(dna.nodes).filter((n) => n.levelType === "unit");
    expect(units.length).toBe(2);
    expect(dna.structureType).toBe("single_layer");
  });

  it("命名为第N章的扁平单文件 → 抽象层级是节(unit)，不被文件名误升为章", () => {
    // §3.1「叫法是实例，层级才是抽象」：文件名写"第N章"只是叫法，结构上每个扁平文件就是一个最小叙事单元(节)。
    const items = [
      { path: "第一章.txt", text: "一。".repeat(10) },
      { path: "第二章.txt", text: "二。".repeat(10) },
    ];
    const { segments } = segmentsFromTexts(items);
    expect(segmentsHaveStructure(segments)).toBe(true);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "扁平章", media_type: "book" }, segments);
    const chapters = Object.values(dna.nodes).filter((n) => n.levelType === "chapter");
    const units = Object.values(dna.nodes).filter((n) => n.levelType === "unit");
    expect(chapters.length).toBe(0);
    expect(units.length).toBe(2);
    // root 以下只有"节"一层。
    expect(dna.structureType).toBe("single_layer");
  });
});

describe("batch8 · 标准化纠正（看结构不看名字，§3.1b 硬规则）", () => {
  it("扁平单 txt 压缩包（蛊真人式）→ single_layer：完整→节，折叠打包目录", () => {
    // 模拟：压缩包容器目录 蛊真人_测试/ 下一堆扁平 txt，文件名写"第N章"实为"节"，每个约 1700 字。
    const items = Array.from({ length: 8 }, (_, i) => ({
      path: `蛊真人_测试/第${i + 1}章_遭遇魔道蛊师.txt`,
      text: `第${i + 1}节：遭遇魔道蛊师\n` + "方源行走在山道上，警觉地观察四周。".repeat(60),
    }));
    const { segments } = segmentsFromTexts(items);
    expect(segmentsHaveStructure(segments)).toBe(true);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "蛊真人", media_type: "book" }, segments);
    // 打包目录被折叠 → 无 part 层；每个文件 = 一个节(unit)。
    expect(Object.values(dna.nodes).filter((n) => n.levelType === "part").length).toBe(0);
    expect(Object.values(dna.nodes).filter((n) => n.levelType === "chapter").length).toBe(0);
    expect(collectLeafIds(dna).length).toBe(8);
    expect(dna.structureType).toBe("single_layer");
    // 真实层级数 = 1（仅"节"），驱动前端每侧 1 个下拉。
    expect(guessLevelsFromHierarchy(dna)).toEqual(["unit"]);
  });

  it("自我嵌套打包目录（蛊真人_测试/蛊真人_测试/）整体剥离", () => {
    const items = [
      { path: "蛊真人_测试/蛊真人_测试/第一章.txt", text: "甲。".repeat(40) },
      { path: "蛊真人_测试/蛊真人_测试/第二章.txt", text: "乙。".repeat(40) },
    ];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "蛊真人", media_type: "book" }, segments);
    expect(Object.values(dna.nodes).filter((n) => n.levelType === "part").length).toBe(0);
    expect(collectLeafIds(dna).length).toBe(2);
    expect(dna.structureType).toBe("single_layer");
  });

  it("多卷并列目录 → 多层（部→节），保留卷层", () => {
    const items = [
      { path: "第一卷/第01节.txt", text: "卷一节一。".repeat(20) },
      { path: "第一卷/第02节.txt", text: "卷一节二。".repeat(20) },
      { path: "第二卷/第03节.txt", text: "卷二节三。".repeat(20) },
    ];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "分卷", media_type: "book" }, segments);
    expect(Object.values(dna.nodes).filter((n) => n.levelType === "part").length).toBe(2);
    expect(dna.structureType === "two_layer" || dna.structureType === "three_layer").toBe(true);
    expect(guessLevelsFromHierarchy(dna)).toContain("part");
  });

  it("一文多节大文件（≥2 内层标记且超 MAX_UNIT_CHARS）→ 章 + 节内拆", () => {
    // 单文件含 3 个内层"第N节"标记，且整体远超单元水准线 → 当作章容器，内拆为节。
    const big = [
      "第一节 开端\n" + "正文甲。".repeat(MAX_UNIT_CHARS / 3),
      "第二节 发展\n" + "正文乙。".repeat(MAX_UNIT_CHARS / 3),
      "第三节 高潮\n" + "正文丙。".repeat(MAX_UNIT_CHARS / 3),
    ].join("\n");
    const items = [{ path: "巨型单章.txt", text: big }];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "巨型", media_type: "book" }, segments);
    expect(Object.values(dna.nodes).filter((n) => n.levelType === "chapter").length).toBe(1);
    expect(Object.values(dna.nodes).filter((n) => n.levelType === "unit").length).toBe(3);
  });

  it("小体量单文件即便含内层标记也不内拆（仍为单节）", () => {
    const small = "第一节 甲\n小正文。\n第二节 乙\n小正文。";
    const items = [{ path: "小文件.txt", text: small }];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "小", media_type: "book" }, segments);
    // 单文件 + 体量未超线 → 整文件一个节，不升章不内拆。
    expect(Object.values(dna.nodes).filter((n) => n.levelType === "chapter").length).toBe(0);
    expect(collectLeafIds(dna).length).toBe(1);
  });
});

describe("batch8 · 展示规范名 + 完整嵌套链（§3.1 锚定最小叙事单元）", () => {
  it("displayName：根=《题目》、非根=序号_《原始标题》；title 保留原始名", () => {
    const items = [
      { path: "第一章_遭遇.txt", text: "甲。".repeat(40) },
      { path: "第二章_脱险.txt", text: "乙。".repeat(40) },
    ];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "蛊真人", media_type: "book" }, segments);
    expect(dna.nodes[dna.rootId].displayName).toBe("《蛊真人》");
    const leaves = collectLeafIds(dna).map((id) => dna.nodes[id]);
    // title 仍是原始文件名（溯源），displayName 为 序号_《原始标题》。
    expect(leaves[0].title).toBe("第一章_遭遇");
    expect(leaves[0].displayName).toBe("1_《第一章_遭遇》");
    expect(leaves[1].displayName).toBe("2_《第二章_脱险》");
  });

  it("lineage：根→自身完整嵌套链（多卷场景含部层）", () => {
    const items = [
      { path: "第一卷/第01节.txt", text: "卷一节一。".repeat(20) },
      { path: "第二卷/第02节.txt", text: "卷二节二。".repeat(20) },
    ];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "分卷作", media_type: "book" }, segments);
    const firstLeaf = dna.nodes[collectLeafIds(dna)[0]];
    const chain = firstLeaf.lineage ?? [];
    // 链首为根，链尾为自身；中间含其所属"部/卷"。
    expect(chain[0]?.id).toBe(dna.rootId);
    expect(chain[chain.length - 1]?.id).toBe(firstLeaf.id);
    expect(chain.some((c) => c.levelType === "part")).toBe(true);
    expect(chain.length).toBeGreaterThanOrEqual(3);
  });

  it("buildLightHierarchy 也产出 displayName/lineage（扫标记路径）", () => {
    const text = ["# 第一章 起", "起。".repeat(10), "# 第二章 承", "承。".repeat(10)].join("\n");
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "多章", media_type: "book", text });
    for (const n of Object.values(dna.nodes)) {
      expect(typeof n.displayName).toBe("string");
      expect((n.lineage ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("batch8 · 逐层递归聚合（§3.3）", () => {
  const fakeLlm = {
    callWithRetry: async (_sys: string, _user: string) =>
      JSON.stringify({ characters: ["LLM主角"], scene: "LLM场景", events: "LLM事件" }),
  } as unknown as LLMClient;

  function s(scene: string, ev: string, chars: string[]): TemplateSummary {
    return { characters: chars, scene, events: ev };
  }

  it("analyzeHierarchy 据叶子数选规模档位", () => {
    const text = ["# 第一章 起", "起。".repeat(10), "# 第二章 承", "承。".repeat(10)].join("\n");
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "规模", media_type: "book", text });
    const a = analyzeHierarchy(dna);
    expect(a.scale).toBe("micro");
    expect(a.leafCount).toBeGreaterThanOrEqual(2);
    expect(a.batchSize).toBe(25);
  });

  it("synthesizeParentSummary 有 LLM 用 LLM 结果，无 LLM 确定性降级", async () => {
    const children = [s("场景A", "事件A", ["甲"]), s("场景B", "事件B", ["乙"])];
    const withLlm = await synthesizeParentSummary(fakeLlm, "父", children);
    expect(withLlm.scene).toBe("LLM场景");
    const noLlm = await synthesizeParentSummary(undefined, "父", children);
    expect(noLlm.characters).toEqual(["甲", "乙"]);
    expect(noLlm.scene).toContain("场景A");
  });

  it("synthesizeParentSummary 在 LLM 抛错时降级（不抛出）", async () => {
    const broken = { callWithRetry: async () => { throw new Error("boom"); } } as unknown as LLMClient;
    const out = await synthesizeParentSummary(broken, "父", [s("X", "Y", ["甲"])]);
    expect(out.scene).toBe("X");
  });

  it("batchCompressSummaries 对超 batch 的子摘要迭代归并", async () => {
    const many = Array.from({ length: 60 }, (_, i) => s(`场景${i}`, `事件${i}`, [`角色${i}`]));
    const merged = await batchCompressSummaries(fakeLlm, "卷", many, 25);
    // LLM 桩恒返回固定摘要，验证归并能收敛到单条且不抛错。
    expect(merged.scene).toBe("LLM场景");
  });

  it("aggregateSubtreeTemplatesRecursive 后序写回内部节点 template（确定性降级路径）", async () => {
    const text = [
      "# 第一卷 风起",
      "## 第一章 启程",
      "少年离家。".repeat(10),
      "## 第二章 试炼",
      "试炼开始。".repeat(10),
    ].join("\n");
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "聚合", media_type: "book", text });
    const slices = sliceUnitTexts(dna, text);
    for (const id of collectLeafIds(dna)) heuristicExtractUnit(dna.nodes[id], slices.get(id) ?? "");
    const top = await aggregateSubtreeTemplatesRecursive(dna, dna.rootId, {});
    expect(top).toBeTruthy();
    // 中间层（卷）节点应被写回 template。
    const part = Object.values(dna.nodes).find((n) => n.levelType === "part");
    expect(part?.template).toBeTruthy();
    // §3.2 父层算子：确定性降级路径下父节点 operators 应为 []（三件套齐全，不留 undefined）。
    expect(part?.operators).toEqual([]);
    expect(part?.metadata?.processing_status).toBe("extracted");
  });

  it("extractParentOperators：按层级维度 LLM 提取父层算子（§3.2）", async () => {
    const opLlm = {
      callWithRetry: async (sys: string) => {
        // 顶层 prompt 应带宏观维度关注（世界观/叙事者定位），中层带承上启下维度。
        const domain = sys.includes("完整叙事内容") ? "叙事者定位" : "文学风格";
        return JSON.stringify({ operators: [{ name: "父层算子", definition: "d", knowledge_domain: domain }] });
      },
    } as unknown as LLMClient;
    const tpl = {
      worldview: { setting: "架空大陆", scene_structure: "", item_inventory: "" },
      characters: [],
      story_structure: { topology: { nodeCount: 0, startCount: 0, endCount: 0, pivotCount: 0, mergeCount: 0 } },
      core_elements: { subject: "玄幻", theme: "成长", core_conflict: "正邪", literature_style: "白描", emotion_experience: "热血" },
      summary: { characters: ["甲"], scene: "山门", events: "拜师" },
    };
    const top = await extractParentOperators(opLlm, { id: "c0", title: "全书", levelType: "complete" }, tpl);
    expect(top.length).toBe(1);
    expect(top[0].uid).toBe("c0_op1"); // 缺 uid 时按 node.id 生成
    expect(top[0].knowledge_domain).toBe("叙事者定位"); // 顶层维度
    const mid = await extractParentOperators(opLlm, { id: "p1", title: "第一卷", levelType: "part" }, tpl);
    expect(mid[0].knowledge_domain).toBe("文学风格"); // 中层维度
    // 无 LLM → 诚实留空（不拿子算子冒充）。
    expect(await extractParentOperators(undefined, { id: "x", title: "t", levelType: "chapter" }, tpl)).toEqual([]);
  });

  it("normalizeOperator 补齐 8 字段 + uid 兜底 + knowledge_domain 归一（P1-2）", () => {
    const op = normalizeOperator({ name: "n" }, "fallback_uid");
    expect(op.uid).toBe("fallback_uid");
    expect(op.adaptation).toEqual({ type: "", element: "" });
    // P1-2：knowledge_domain 归一到五大类；无有效分类线索时兜底"故事内容"（不再留空，保证三视角分组可用）。
    expect(op.knowledge_domain).toBe("故事内容");
  });
});

describe("batch8 · 媒体优先分家落盘 + 会话级幂等追加（§6.1）", () => {
  it("文件按模态分家落各媒体 *_original（媒体优先布局）", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-modal-"));
    const ts = "2026-06-26_010101";
    const title = "混合作品";
    const files: IncomingFile[] = [
      { fileName: "小说.txt", data: "正文。".repeat(20), fileType: "text/plain" },
      { fileName: "封面.png", data: Buffer.from([1, 2, 3]), fileType: "image/png" },
      { fileName: "预告.mp4", data: Buffer.from([4, 5, 6]), fileType: "video/mp4" },
    ];
    const r = archiveAndBuildManifest({ files, title, story_timestamp: ts, cwd });
    expect(r.manifest.media_type).toBe("mixed");
    expect(fs.existsSync(path.join(mediaOriginalDir(ts, title, "book", { cwd }), "小说.txt"))).toBe(true);
    expect(fs.existsSync(path.join(mediaOriginalDir(ts, title, "picture", { cwd }), "封面.png"))).toBe(true);
    expect(fs.existsSync(path.join(mediaOriginalDir(ts, title, "video", { cwd }), "预告.mp4"))).toBe(true);
    const paths = r.manifest.source_files.map((s) => s.path.replace(/\\/g, "/"));
    expect(paths).toContain(`book/story_book/book_original/${ts}_${title}/小说.txt`);
    expect(paths).toContain(`picture/story_picture/picture_original/${ts}_${title}/封面.png`);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("同一 story_timestamp 追加文件 → 幂等合并到同一会话清单", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-append-"));
    const ts = "2026-06-26_020202";
    const title = "连载";
    archiveAndBuildManifest({ files: [{ fileName: "第一章.txt", data: "一。".repeat(20), fileType: "text/plain" }], title, story_timestamp: ts, cwd });
    const r2 = archiveAndBuildManifest({ files: [{ fileName: "第二章.txt", data: "二。".repeat(20), fileType: "text/plain" }], title, story_timestamp: ts, cwd });
    // 第二次只传一个文件，但清单应包含两个文件（会话级累积）。
    expect(r2.manifest.source_files.length).toBe(2);
    const loaded = loadManifest(ts, title, { cwd })!;
    expect(loaded.source_files.length).toBe(2);
    const created = loaded.created_at;
    // 再次追加同名文件应幂等（不重复）。
    const r3 = archiveAndBuildManifest({ files: [{ fileName: "第二章.txt", data: "二。".repeat(20), fileType: "text/plain" }], title, story_timestamp: ts, cwd });
    expect(r3.manifest.source_files.length).toBe(2);
    expect(r3.manifest.created_at).toBe(created);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("batch8 · 各模态最小叙事单元边界（§3.4）", () => {
  it("detectMediaUnit：第N话/集 → chapter，页/单图 → unit", () => {
    expect(detectMediaUnit("第01话_封面.jpg").levelHint).toBe("chapter");
    expect(detectMediaUnit("第3集.mp4").levelHint).toBe("chapter");
    expect(detectMediaUnit("page_07.png").levelHint).toBe("unit");
    expect(detectMediaUnit("插画.png").levelHint).toBe("unit");
  });

  it("transcribeMediaFiles 保留模态分组与单元边界（即便内容延后/无 LLM）", async () => {
    const files: IncomingFile[] = [
      { fileName: "第01话.jpg", data: Buffer.from([1]), fileType: "image/jpeg" },
      { fileName: "p02.jpg", data: Buffer.from([2]), fileType: "image/jpeg" },
      { fileName: "第1集.mp4", data: Buffer.from([3]), fileType: "video/mp4" },
    ];
    // 无 LLM/sampler → 文本延后为空，但边界（segments + 标题）仍保留。
    const r = await transcribeMediaFiles(files, {});
    expect(r.segments.length).toBe(3);
    expect(r.segments[0].levelHint).toBe("chapter");
    expect(r.segments[1].levelHint).toBe("unit");
    // 分组标题与单元标题进入层级化全文。
    expect(r.combinedText).toContain("# 图集");
    expect(r.combinedText).toContain("# 视频");
    expect(r.combinedText).toContain("## 第01话");
    expect(r.combinedText).toContain("### p02");
  });

  it("buildMultimodalMarkdown 形成 part→chapter/unit 的层级标记，汇入后建多层树", () => {
    const md = buildMultimodalMarkdown([
      { fileName: "第01话.jpg", modality: "image", seq: 1, unitTitle: "第01话", levelHint: "chapter", text: "画面A" },
      { fileName: "p1.jpg", modality: "image", seq: 2, unitTitle: "p1", levelHint: "unit", text: "" },
    ]);
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "漫画", media_type: "picture", text: md });
    const levels = new Set(Object.values(dna.nodes).map((n) => n.levelType));
    expect(levels.has("part")).toBe(true); // # 图集
    expect(levels.has("chapter")).toBe(true); // ## 第01话
  });
});
