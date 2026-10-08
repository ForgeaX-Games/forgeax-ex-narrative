import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";

import { normalizeTemplate } from "../phase2-extract.js";
import { saveOperatorSolution, runName } from "../filesystem.js";
import type { NarrativeTemplate, NarrativeOperator, NarrativeIpDna, OperatorSolution } from "../../types/narrative-ip-dna.js";
import type { NarrativeContext } from "../../types/index.js";
import type { OperatorRetriever } from "../phase3-rag.js";
import { fillSlot, precheckConflict } from "../phase3-rag.js";
import type { OperatorPerspective } from "../../types/narrative-ip-dna.js";

import { parseNpyFloat32, cosineTopK, rrfFuse, HybridOperatorRetriever } from "../phase3-vector.js";
import { untar, expandArchives, isArchive } from "../phase0-compress.js";
import { transcribeMediaFiles } from "../phase1-multimodal.js";
import { mapGameUnitToPipeline } from "../phase2c-gen-adapt.js";
import { findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import { analyzeRewriteImpact } from "../phase4-rewrite.js";
import { runIpDnaPipeline, buildGenerationPipelineConfig, DEFAULT_ADAPTATION_GENRE } from "../orchestrator.js";

import {
  buildOperatorInjection,
  buildConflictPredicate,
  setSharedRetriever,
} from "../injection/operator-injection.js";
import { isOperatorConsumingStep, getSlotSpec } from "../injection/slot-registry.js";
import { resolveIpDnaRuntimeAdapters } from "../runtime-adapters.js";
import { loadRetrievalConfig } from "../phase3-vector.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { accumulateOperators } from "../../knowledge/narrative-library/store.js";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-b2-"));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });

const SAMPLE_TEXT = [
  "# 第一卷",
  "## 第一章 开端",
  "主角张三遇见李四。张三与李四并肩作战。",
  "## 第二章 冲突",
  "张三与王五在城外对峙。",
].join("\n");

function sampleTemplate(): NarrativeTemplate {
  return normalizeTemplate({
    worldview: { setting: "末世冰封都市", scene_structure: "安全屋 / 废墟", item_inventory: "求生工具" },
    characters: [
      { name: "张三", profile: "幸存者主角", arc: "从自保到守护", relationships: [{ target: "李四", relation: "盟友" }] },
      { name: "王五", profile: "对立头目", relationships: [{ target: "张三", relation: "敌对" }] },
    ],
    core_elements: { subject: "末世生存", theme: "人性与希望", core_conflict: "资源争夺", literature_style: "暗黑写实", emotion_experience: "紧张" },
    summary: { characters: ["张三"], scene: "冰封都市", events: "遭遇—对峙" },
  });
}

function fakeOp(uid: string, name: string, domain: string): NarrativeOperator {
  return {
    uid, name, definition: `${name}定义`, adaptation: { type: domain, element: "" },
    usage_guide: "用法", example: "", knowledge_location: "测试", knowledge_domain: domain,
  };
}

// ── 槽位注册表 ──
describe("slot-registry", () => {
  it("identifies operator-consuming steps", () => {
    expect(isOperatorConsumingStep("plot_generation")).toBe(true);
    expect(isOperatorConsumingStep("script_generation")).toBe(true);
    expect(isOperatorConsumingStep("tier_router")).toBe(false);
    expect(isOperatorConsumingStep("preference_analysis")).toBe(false);
    expect(getSlotSpec("script_generation")?.slots).toContain("对白算子");
  });
});

// ── 冲突预检（D9）──
describe("conflict predicate", () => {
  it("flags operators opposing user need orientation", () => {
    const pred = buildConflictPredicate("我想要快节奏、强冲突的爽感体验");
    const slowOp = fakeOp("o1", "舒缓铺垫算子", "文学风格");
    slowOp.usage_guide = "通过慢节奏铺垫营造氛围";
    expect(pred(slowOp)).toBe(true);
    const fastOp = fakeOp("o2", "紧凑推进算子", "叙事技巧");
    fastOp.usage_guide = "快节奏紧凑推进";
    expect(pred(fastOp)).toBe(false);
  });
});

// ── 运行时适配器解析（批2 RAG 生产接通）──
describe("ip-dna runtime adapters (shared by CLI + server)", () => {
  // 这条要探本地 e5 模型在不在位（磁盘扫描 + 可能的加载），机器一忙就顶到默认 5s
  // 超时，于是整条 gate 随机变红。给它自己的余量：它验的是"解析不抛错"，不是快。
  it("resolves without throwing; frameSampler always present, embedder iff local e5 model exists", async () => {
    const { queryEmbedder, frameSampler, retrievalConfig } = await resolveIpDnaRuntimeAdapters({});
    expect(typeof frameSampler).toBe("function");
    const modelDir = loadRetrievalConfig().model_path_local;
    const hasLocalModel = !!modelDir && fs.existsSync(modelDir);
    if (hasLocalModel) {
      // 本地 e5 在位 → vector 通道可用。
      expect(typeof queryEmbedder).toBe("function");
    } else {
      // 无模型 → 静默降级（不抛错），由检索器走 scope+tag。
      expect(queryEmbedder).toBeUndefined();
    }
    expect(retrievalConfig).toBeTruthy();
  }, 30_000);
});

// ── 冲突消解接入选取链（h4）──
describe("fillSlot conflict resolution", () => {
  it("re-selects the lowest-priority perspective's operator to clear three-perspective tension", async () => {
    // 提取算子制造对冲：作者视角(文学风格)走"慢/舒缓/铺垫"，读者视角(情感体验)走"快/紧凑/急促"。
    const slowAuthor = fakeOp("ext-slow", "舒缓铺垫算子", "文学风格");
    slowAuthor.usage_guide = "通过慢节奏舒缓铺垫营造氛围";
    const fastReader = fakeOp("ext-fast", "紧凑推进算子", "情感体验");
    fastReader.usage_guide = "快节奏紧凑急促推进";

    // 检索器为被替换视角提供"中性"备选（无对冲词），用于消解张力。
    const neutralRetriever: OperatorRetriever = {
      async retrieve(_q, perspective) {
        const op = fakeOp(`neu-${perspective}`, `中性算子-${perspective}`, "叙事技巧");
        op.usage_guide = "稳健推进剧情，注重因果连贯与角色动机";
        return [op];
      },
    };

    const before = precheckConflict([
      { perspective: "author", operator: slowAuthor, source: "extracted" },
      { perspective: "reader", operator: fastReader, source: "extracted" },
    ]);
    expect(before.hasConflict).toBe(true);

    const slot = await fillSlot({
      slotName: "风格算子",
      query: "风格",
      extracted: [slowAuthor, fastReader],
      retriever: neutralRetriever,
      llm: {} as never,
      storyTitle: "测试",
    });

    // 消解后三视角候选不再对冲，且最低优先视角(author)的算子被重检索替换。
    expect(precheckConflict(slot.candidates).hasConflict).toBe(false);
    const author = slot.candidates.find((c) => c.perspective === "author");
    expect(author?.source).toBe("retrieved");
  });
});

// ── 注入适配器（D1/D4/D10）──
describe("operator injection adapter", () => {
  const mockRetriever: OperatorRetriever = {
    async retrieve(_q: string, perspective: OperatorPerspective): Promise<NarrativeOperator[]> {
      return [fakeOp(`ret-${perspective}`, `检索算子-${perspective}`, "叙事技巧")];
    },
  };

  function scopedDna(): NarrativeIpDna {
    return {
      schema_version: "1.0.0",
      story_id: "20260101_0000",
      title: "冰封",
      media_type: "book",
      rootId: "r",
      nodes: {
        r: {
          id: "r", levelType: "complete", index: 0, title: "冰封", parent: null, children: [],
          template: sampleTemplate(),
          operators: [fakeOp("ext1", "提取风格算子", "文学风格")],
        },
      },
      scoped_to_game_unit: 1,
    };
  }

  it("returns null for a non-consuming step, and for missing IP DNA with an empty library", async () => {
    setSharedRetriever(mockRetriever);
    /**
     * 没有 IP DNA 也不再直接空手而归——算子与它出自哪部作品无关，原创作品可以从
     * 积累下来的算子库里借。所以"没 DNA 就是 null"只在库也空的时候成立，
     * 这里把库指到一个空目录，让断言说的是那一种情况。
     *
     * 不指的话这条用例会读到本机跑过的真实库（库按工作目录定位），于是同一份代码
     * 在跑过生成的机器上失败、在干净机器上通过——那种红不说明任何事。
     */
    const emptyLibrary = mkdtempSync(path.join(tmpdir(), "narrative-lib-"));
    const ctxNoDna: NarrativeContext = { user_input: "x" };
    expect(
      await buildOperatorInjection(ctxNoDna, "plot_generation", {} as never, { cwd: emptyLibrary }),
    ).toBeNull();
    const ctxWithDna: NarrativeContext = { user_input: "x", narrativeIpDna: scopedDna() };
    expect(await buildOperatorInjection(ctxWithDna, "tier_router", {} as never)).toBeNull();
    setSharedRetriever(null);
  });

  it("borrows from the accumulated library when there is no IP DNA", async () => {
    setSharedRetriever(mockRetriever);
    const lib = mkdtempSync(path.join(tmpdir(), "narrative-lib-"));
    accumulateOperators(
      [{
        uid: "op-borrow-1",
        name: "延迟揭示",
        definition: "把关键信息压到读者以为已经错过它的那一刻再给",
        adaptation: { type: "plot", element: "揭示时机" },
      } as never],
      { storyId: "s1", title: "别的作品" },
      { cwd: lib },
    );
    const fragment = await buildOperatorInjection(
      { user_input: "原创" },
      "plot_generation",
      {} as never,
      { cwd: lib },
    );
    expect(fragment).not.toBeNull();
    expect(JSON.stringify(fragment)).toContain("延迟揭示");
    setSharedRetriever(null);
  });

  it("builds fragment with three-perspective slots + KAG + ledger", async () => {
    setSharedRetriever(mockRetriever);
    const ledger = { story_id: "20260101_0000", storyTitle: "冰封", entries: [
      { ref: "core.theme", kind: "setting" as const, content: "人性与希望", created_at: "" },
    ] };
    const ctx: NarrativeContext = {
      user_input: "忠实改编",
      story_title: "冰封",
      story_timestamp: "20260101_0000",
      narrativeIpDna: scopedDna(),
    };
    (ctx as Record<string, unknown>)._long_memory_ledger = ledger;
    const result = await buildOperatorInjection(ctx, "plot_generation", {} as never);
    expect(result).not.toBeNull();
    expect(result!.slotCount).toBeGreaterThanOrEqual(1);
    expect(result!.fragment).toContain("三视角");
    expect(result!.fragment).toContain("关系网络");
    expect(result!.fragment).toContain("一致性账本");
    expect(result!.solution.node).toBe("plot_generation");
    // h2：creative_directive 落盘非空（确定性合成镜像）+ adoption_notes 记录三视角采纳。
    expect(result!.solution.creative_directive.length).toBeGreaterThan(0);
    expect(result!.solution.creative_directive).toContain("综合裁决方针");
    expect(Object.keys(result!.solution.adoption_notes ?? {}).length).toBeGreaterThan(0);
    setSharedRetriever(null);
  });
});

// ── 向量检索（D5）──
describe("vector retrieval primitives", () => {
  it("parses a synthetic float32 NPY (v1)", () => {
    // 构造 2×3 float32 NPY
    const headerStr = "{'descr': '<f4', 'fortran_order': False, 'shape': (2, 3), }";
    const pad = (10 + headerStr.length + 1) % 64;
    const padded = headerStr + " ".repeat(pad === 0 ? 0 : 64 - pad - 0) + "\n";
    const header = Buffer.from(padded, "latin1");
    const magic = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
    const lenBuf = Buffer.alloc(2); lenBuf.writeUInt16LE(header.length, 0);
    const data = Buffer.alloc(2 * 3 * 4);
    [1, 0, 0, 0, 1, 0].forEach((v, i) => data.writeFloatLE(v, i * 4));
    const npy = Buffer.concat([magic, lenBuf, header, data]);
    const m = parseNpyFloat32(npy);
    expect(m.rows).toBe(2);
    expect(m.dim).toBe(3);
    const top = cosineTopK(m, new Float32Array([1, 0, 0]), 2);
    expect(top[0]).toBe(0);
  });

  it("rrfFuse fuses multi-channel rankings", () => {
    const fused = rrfFuse(
      [
        { ranking: ["a", "b", "c"], weight: 0.5 },
        { ranking: ["b", "a", "d"], weight: 0.5 },
      ],
      60,
      3,
    );
    expect(fused).toContain("a");
    expect(fused).toContain("b");
    expect(fused.length).toBe(3);
  });

  it("HybridOperatorRetriever degrades to scope+tag without embedder", async () => {
    const corpus = [
      fakeOp("h1", "情感共鸣算子", "情感体验"),
      fakeOp("h2", "结构编排算子", "叙事技巧"),
    ];
    const r = new HybridOperatorRetriever(corpus, {});
    expect(r.vectorEnabled).toBe(false);
    const out = await r.retrieve("情感共鸣 体验", "reader", 2);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });
});

// ── 压缩包（D12）──
describe("archive expansion", () => {
  it("detects archives and untars a synthetic tar", async () => {
    expect(isArchive("a.tar")).toBe(true);
    expect(isArchive("a.txt")).toBe(false);
    // 构造一个含单文件的 tar
    const content = Buffer.from("hello tar", "utf-8");
    const header = Buffer.alloc(512);
    header.write("note.txt", 0);
    header.write("000644 ", 100);
    header.write(content.length.toString(8).padStart(11, "0") + "\0", 124);
    header[156] = "0".charCodeAt(0);
    const dataBlock = Buffer.alloc(512);
    content.copy(dataBlock, 0);
    const tar = Buffer.concat([header, dataBlock, Buffer.alloc(1024)]);
    const members = untar(tar);
    expect(members.length).toBe(1);
    expect(members[0].name).toBe("note.txt");
    expect(members[0].data.toString("utf-8")).toBe("hello tar");
  });

  it("expandArchives gunzips .gz members", async () => {
    const gz = zlib.gzipSync(Buffer.from("解压后的正文", "utf-8"));
    const out = await expandArchives([{ fileName: "story.txt.gz", data: gz, fileType: "application/gzip" }]);
    expect(out.length).toBe(1);
    expect(out[0].fileName).toBe("story.txt");
    expect((out[0].data as Buffer).toString("utf-8")).toBe("解压后的正文");
  });
});

// ── 多模态（D6）──
describe("multimodal transcription", () => {
  it("describes images via mock multimodal LLM", async () => {
    const mockLlm = {
      async callWithImages() { return "画面：张三在废墟中前行。"; },
    };
    const result = await transcribeMediaFiles(
      [{ fileName: "page1.jpg", data: Buffer.from([1, 2, 3]), fileType: "image/jpeg" }],
      { llm: mockLlm as never },
    );
    expect(result.segments.length).toBe(1);
    expect(result.combinedText).toContain("张三");
  });
});

// ── Phase2c 节点控制（D3）──
describe("phase2c pipeline mapping", () => {
  /**
   * 节点预算不分品类。
   *
   * 这一组曾按"管线家族"分两套断言（rpg 要 tpl-rpg + 层级预算，vn 要 tpl-vn-v2 + 开放幕数）。
   * 幕那一侧的读取者已随 tpl-vn-v2 封存，而 `pipelineTemplate` / `topLevelMapping` 两个字段
   * 从来没有运行时读取者 —— 于是那些断言验的是"算出来的值等于预期"，而那个值没人用。
   */
  it("derives a node budget whose three layers cover the target node count", () => {
    const plan = mapGameUnitToPipeline(
      { index: 1, unitRange: { start: "u1", end: "u3" }, boundary: "soft", targetNodeCount: 40 },
      { defaultComplexity: 3 },
    );
    // 契约是三层乘积覆盖目标节点数，不是某个字段等于它。
    const b = plan.nodeBudgetOverride!;
    expect(b.l0_nodes * b.l1_per_parent * b.l2_per_parent).toBeGreaterThanOrEqual(40);
  });

  it("gives the same shape of budget regardless of the target genre", () => {
    // 影游与 JRPG 的差别在节点怎么连（叙事结构轴的事），不在每层开几个节点。
    const mk = (targetNodeCount: number) =>
      mapGameUnitToPipeline(
        { index: 1, unitRange: { start: "u1", end: "u3" }, boundary: "soft", targetNodeCount },
        { defaultComplexity: 3 },
      );
    expect(mk(45).nodeBudgetOverride).toBeTruthy();
    expect(mk(45)).toEqual(mk(45));
  });

  // 生成期 PipelineConfig 装配：直接验证 defaultGenerationRunner 真把品类接进 genreCode，
  // 闭合「真实生成 runner 未被 e2e 覆盖（被 mock）」的置信度缺口。
  it("buildGenerationPipelineConfig：未指定品类时给缺省品类，显式品类不被覆盖", () => {
    const cfg = buildGenerationPipelineConfig({});
    expect(cfg.genreCode).toBe(DEFAULT_ADAPTATION_GENRE);
    // 缺省品类必须真实存在，否则下游模板解析会落空。
    expect(findGenreByCode(cfg.genreCode!)).toBeTruthy();

    // 调用方显式指定品类时不被覆盖 —— 117 个品类都是平等的目标形态。
    expect(
      buildGenerationPipelineConfig({ pipelineConfig: { genreCode: "rpg-crpg" } }).genreCode,
    ).toBe("rpg-crpg");

    // tier / mode 覆盖优先级：generationMode > pipelineConfig.mode
    const moded = buildGenerationPipelineConfig({
      pipelineConfig: { mode: "design_auto" },
      generationMode: "narrative_auto",
      tier: "tier2",
    });
    expect(moded.mode).toBe("narrative_auto");
    expect(moded.tier).toBe("tier2");
  });
});

// ── 改写影响面（D13）──
describe("rewrite impact", () => {
  it("traces downstream + upstream + affected input nodes", () => {
    const dna: NarrativeIpDna = {
      schema_version: "1.0.0", story_id: "t", title: "t", media_type: "book", rootId: "r",
      nodes: {
        r: { id: "r", levelType: "complete", index: 0, title: "t", parent: null, children: ["n1"] },
        n1: { id: "n1", levelType: "unit", index: 1, title: "u", parent: "r", children: [],
          template: normalizeTemplate({ characters: [{ name: "张三", profile: "主角" }] }),
          metadata: { processing_status: "extracted", adaptation_status: "已生成" } },
      },
    };
    const impact = analyzeRewriteImpact(["A.characters"], dna);
    expect(impact.changed).toContain("A.characters");
    expect(impact.affectedInputNodes).toContain("n1");
  });
});

// ── 编排器：scoped DNA + 账本 + Phase2c 注入种子 ──
describe("orchestrator wiring (D1d/D3/D8)", () => {
  it("seeds scoped narrativeIpDna + ledger + pipeline plan + node budget on seed ctx", async () => {
    const result = await runIpDnaPipeline({
      files: [{ fileName: "s.md", data: SAMPLE_TEXT, fileType: "text/markdown" }],
      title: "接线验证",
      cwd: TMP,
      runGeneration: false,
    });
    const gu = result.gameUnits[0];
    // D1d：scoped DNA 注入种子
    expect(gu.seedContext.narrativeIpDna?.scoped_to_game_unit).toBe(gu.index);
    // D10：账本挂在种子 ctx
    expect((gu.seedContext as Record<string, unknown>)._long_memory_ledger).toBeTruthy();
    // D3：节点预算覆盖写入 global_control_params —— 不分品类，缺省路径也要拿到。
    expect(gu.seedContext.global_control_params?.node_budget_override?.l0_nodes).toBeGreaterThan(0);
    // D8：中间层（卷/章）节点 template 被递归回填
    const internal = Object.values(result.dna.nodes).find((n) => n.children.length > 0 && n.levelType !== "complete");
    expect(internal?.template).toBeTruthy();
  });
});

// ── 算子方案落盘（§6 第1点）+ 全局标题作为 generated 算子 source-name（§6.5）──
describe("operator solution persistence (§6 第1点 / §6.5)", () => {
  function makeOp(over: Partial<NarrativeOperator> = {}): NarrativeOperator {
    return {
      uid: "METHOD::demo::x1",
      name: "悲剧基调算子",
      definition: "以代价与失去推进情感张力",
      adaptation: { type: "tone", element: "ending" },
      usage_guide: "用于结局收束",
      example: "示例文本",
      knowledge_location: "知识库",
      knowledge_domain: "情感体验",
      ...over,
    };
  }

  it("writes <node>_operator_solution.json under output/<ts>_<title>/算子方案 (no timestamp in filename), round-trips", () => {
    const story_id = "20260101_0000";
    const title = "冰封纪元";
    const node = "vn.beat.1.2";
    // generated 算子：source-name 复用 knowledge_location/example 填全局标题（§6.5）。
    const genOp = makeOp({ uid: "GEN::char::1", knowledge_location: title, example: title });
    const solution: OperatorSolution = {
      story_id,
      node,
      slots: [
        {
          slot_name: "结构算子",
          candidates: [
            { perspective: "author", operator: makeOp(), source: "extracted" },
            { perspective: "reader", operator: makeOp({ uid: "RET::r1" }), source: "retrieved" },
            { perspective: "character", operator: genOp, source: "generated" },
          ],
        },
      ],
      creative_directive: "以悲剧收束统合三视角",
      adoption_notes: { "GEN::char::1": "角色视角缺口由 LLM 生成兜底采纳" },
    };

    const written = saveOperatorSolution(solution, title, { cwd: TMP });

    // 文件名不带时间戳，外层目录已含时间戳（§6 第1点）。
    expect(path.basename(written).endsWith("_operator_solution.json")).toBe(true);
    expect(path.basename(written)).not.toContain(story_id);
    expect(written).toContain(path.join("output", runName(story_id, title), "算子方案"));
    expect(fs.existsSync(written)).toBe(true);

    const loaded = JSON.parse(fs.readFileSync(written, "utf-8")) as OperatorSolution;
    expect(loaded.node).toBe(node);
    expect(loaded.slots[0].candidates).toHaveLength(3);
    // §6.5：generated 算子的 source-name 即全局标题。
    const gen = loaded.slots[0].candidates.find((c) => c.source === "generated");
    expect(gen?.operator.knowledge_location).toBe(title);
    expect(gen?.operator.example).toBe(title);
    // 算子本体不混入 perspective/source 字段（§4.5）。
    expect(gen?.operator).not.toHaveProperty("perspective");
    expect(gen?.operator).not.toHaveProperty("source");
  });
});
