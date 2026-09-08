import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { adaptCorpusEntry, loadOperatorCorpus, type CorpusEntry } from "../corpus-loader.js";
import { inferPerspective } from "../phase3-rag.js";
import { buildLightHierarchy, sliceUnitTexts, collectLeafIds } from "../phase1-understanding.js";
import { mapTemplateToContext, buildGenerationInput, normalizeTemplate, heuristicExtractUnit } from "../phase2-extract.js";
import { buildKagFromTemplate, renderRelationInjection } from "../phase3b-kag.js";
import { buildLedgerFromTemplate, queryLedger, renderLedgerInjection, displayName, readIpDnaSummary } from "../phase5-polish.js";
import { runIpDnaPipeline } from "../orchestrator.js";
import type { NarrativeTemplate } from "../../types/narrative-ip-dna.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-e2e-"));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });

const SAMPLE_TEXT = [
  "# 第一卷",
  "## 第一章 开端",
  "主角张三遇见李四。张三与李四并肩作战。",
  "## 第二章 冲突",
  "张三与王五在城外对峙。",
  "# 第二卷",
  "## 第三章 结局",
  "终局之战落幕。",
].join("\n");

function sampleTemplate(): NarrativeTemplate {
  return normalizeTemplate({
    worldview: { setting: "末世冰封都市", scene_structure: "安全屋 / 废墟", item_inventory: "求生工具" },
    characters: [
      { name: "张三", profile: "幸存者主角", arc: "从自保到守护", relationships: [{ target: "李四", relation: "盟友", detail: "并肩作战" }] },
      { name: "王五", profile: "对立势力头目", relationships: [{ target: "张三", relation: "敌对" }] },
    ],
    core_elements: { subject: "末世生存", theme: "人性与希望", core_conflict: "资源争夺", literature_style: "暗黑写实", emotion_experience: "紧张" },
    summary: { characters: ["张三", "李四", "王五"], scene: "冰封都市", events: "遭遇—对峙—终战" },
  });
}

describe("corpus-loader", () => {
  it("adaptCorpusEntry maps rich schema → 8-field operator with perspective routing", () => {
    const entry: CorpusEntry = {
      uid: "METHOD::x::1",
      name: "情感共鸣算子",
      definition: "通过细腻心理描写引发读者共鸣。",
      tags: ["情感", "治愈"],
      sources: [{ book_uid: "BOOK::某书", chapter: "1情感" }],
      applicable_scope: { emotional_experience: { emotional_resonance: ["适用"] }, story_content: { character: [] } },
    };
    const op = adaptCorpusEntry(entry);
    expect(op.uid).toBe("METHOD::x::1");
    expect(op.knowledge_location).toBe("某书");
    expect(op.usage_guide).toContain("情感");
    expect(op.knowledge_domain).toBe("情感体验");
    expect(inferPerspective(op)).toBe("reader");
  });

  it("character-dominant scope routes to character perspective", () => {
    const op = adaptCorpusEntry({
      uid: "METHOD::c::1", name: "人物弧光算子", definition: "刻画角色成长。",
      applicable_scope: { story_content: { character: ["a", "b", "c"] } },
    });
    expect(inferPerspective(op)).toBe("character");
  });

  it("loads a bounded slice of the real corpus", () => {
    const ops = loadOperatorCorpus({ limit: 200 });
    // 语料存在则应加载到上限；不存在时降级为空数组（不报错）。
    expect(Array.isArray(ops)).toBe(true);
    if (ops.length > 0) expect(ops.length).toBeLessThanOrEqual(200);
  });
});

describe("phase1 slicing", () => {
  it("slices unit texts by source range for each leaf", () => {
    const dna = buildLightHierarchy({ story_timestamp: "20260101_0000", title: "样例", media_type: "book", text: SAMPLE_TEXT });
    const leaves = collectLeafIds(dna);
    expect(leaves.length).toBe(3); // 三章作为最小单元
    const texts = sliceUnitTexts(dna, SAMPLE_TEXT);
    expect(texts.size).toBe(3);
    const firstLeafText = texts.get(leaves[0]) ?? "";
    expect(firstLeafText).toContain("张三遇见李四");
    expect(firstLeafText).not.toContain("终局之战"); // 不串到第三章
  });
});

describe("A→B mapping", () => {
  it("mapTemplateToContext fills core_settings / worldview_structure / character sheets", () => {
    const ctx = mapTemplateToContext(sampleTemplate(), { user_input: "", story_title: "冰封" });
    expect(ctx.core_settings?.protagonist.name).toBe("张三");
    expect(ctx.worldview_structure?.world_name).toBe("冰封");
    expect(ctx.detailed_character_sheets?.[0].name).toBe("张三");
    expect(ctx.detailed_character_sheets?.[0].label).toBe("主角");
  });

  it("buildGenerationInput synthesizes a faithful adaptation brief + uploaded script", () => {
    const { userInput, uploadedScript } = buildGenerationInput(sampleTemplate(), { storyTitle: "冰封", sourceText: SAMPLE_TEXT });
    expect(userInput).toContain("人性与希望");
    expect(userInput).toContain("张三");
    expect(uploadedScript?.content).toContain("终局之战");
    expect(uploadedScript?.format).toBe("prose");
  });
});

describe("KAG from template", () => {
  it("builds character relation graph and renders injection", () => {
    const g = buildKagFromTemplate(sampleTemplate());
    expect(g.allCharacters().length).toBeGreaterThanOrEqual(2);
    expect(g.edgeCount).toBeGreaterThanOrEqual(2);
    const brief = renderRelationInjection(g);
    expect(brief).toContain("张三");
    expect(brief).toContain("盟友");
  });
});

describe("long-memory ledger", () => {
  it("builds ledger from template and queries by kind", () => {
    const ledger = buildLedgerFromTemplate("20260101_0000", "冰封", sampleTemplate());
    expect(ledger.entries.length).toBeGreaterThan(0);
    expect(queryLedger(ledger, { kind: "relationship" }).length).toBeGreaterThanOrEqual(1);
    expect(renderLedgerInjection(ledger)).toContain("一致性账本");
  });
});

describe("naming alias", () => {
  it("maps tpl-vn-v2 to display name without touching id", () => {
    expect(displayName("tpl-vn-v2")).toBe("互动影游");
    expect(displayName("tpl-rpg")).toBe("RPG");
    expect(displayName("unknown-id")).toBe("unknown-id");
  });
});

describe("orchestrator dry-run (no LLM, heuristic extract)", () => {
  it("runs phase0→2b→mapping end-to-end and persists IP DNA + ledger", async () => {
    const result = await runIpDnaPipeline({
      files: [{ fileName: "story.md", data: SAMPLE_TEXT, fileType: "text/markdown" }],
      title: "冰封纪元",
      cwd: TMP,
      runGeneration: false,
    });
    expect(result.title).toBe("冰封纪元");
    expect(Object.keys(result.dna.nodes).length).toBeGreaterThan(1);
    expect(result.directive.game_unit_plan.units.length).toBeGreaterThanOrEqual(1);
    expect(result.gameUnits.length).toBe(result.directive.game_unit_plan.units.length);
    // seed ctx 已 A→B 映射 + 注入生成 brief
    const gu = result.gameUnits[0];
    expect(gu.seedContext.user_input.length).toBeGreaterThan(0);
    expect(gu.seedContext.vn_target_act_count).toBeGreaterThanOrEqual(2);
    // 落盘：层级索引可只读回读
    const summary = readIpDnaSummary(result.story_timestamp, "冰封纪元", { cwd: TMP });
    expect(summary?.node_count).toBe(Object.keys(result.dna.nodes).length);
    // 账本落盘
    const ledgerFile = path.join(TMP, "output", `${result.story_timestamp}_冰封纪元`, "_long_memory_ledger.json");
    expect(fs.existsSync(ledgerFile)).toBe(true);
  });

  it("runs generation seam and writes per-game-unit output", async () => {
    const result = await runIpDnaPipeline({
      files: [{ fileName: "s.md", data: SAMPLE_TEXT, fileType: "text/markdown" }],
      title: "测试生成",
      cwd: TMP,
      runGeneration: true,
      maxGameUnits: 1,
      generate: async ({ seedCtx }) => ({ ...seedCtx, user_preference_summary: "mock-generated" }),
    });
    const gu = result.gameUnits[0];
    expect(gu.generated?.user_preference_summary).toBe("mock-generated");
    expect(gu.outputDir).toBeTruthy();
    const outFile = path.join(gu.outputDir!, "game_unit_1.json");
    expect(fs.existsSync(outFile)).toBe(true);
  });

  it("§4.6b 系列：结局收束约束注入 + 跨部账本承接", async () => {
    const calls: { index: number; userInput: string; ledger: unknown }[] = [];
    const result = await runIpDnaPipeline({
      files: [{ fileName: "s.md", data: SAMPLE_TEXT, fileType: "text/markdown" }],
      title: "系列承接",
      cwd: TMP,
      mode: "series",
      runGeneration: true,
      generate: async ({ userInput, seed, seedCtx }) => {
        calls.push({ index: calls.length, userInput, ledger: seed.ledger });
        return { ...seedCtx, user_preference_summary: "mock" };
      },
    });

    expect(result.directive.game_unit_plan.mode).toBe("series");
    const n = result.gameUnits.length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBe(n);

    // 结局收束：每部注入约束；非末部含"承接结局"，末部标记"最后一部"。
    expect(calls[0].userInput).toContain("系列结局收束约束");
    expect(calls[0].userInput).toContain("承接结局");
    expect(calls[n - 1].userInput).toContain("最后一部");

    // 跨部承接：第 2 部起收到的账本 = 累积账本对象（与第 1 部自身单元账本不是同一引用）。
    expect(calls[1].ledger).not.toBe(calls[0].ledger);
  });
});
