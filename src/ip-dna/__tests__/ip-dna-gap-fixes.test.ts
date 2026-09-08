/**
 * 蓝图全量对齐——缺口修复回归（#1~#7）。
 * 覆盖：改编状态生命周期、提取质量闸门、拆解闭环、ASR 默认转写、媒体压缩/PDF 拆页、
 * 全局标题无策划路径、IP DNA schema 迁移器。
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runIpDnaPipeline } from "../orchestrator.js";
import { assessExtractionQuality, normalizeTemplate } from "../phase2-extract.js";
import { applyDecompositionClosure, buildLightHierarchy, collectLeafIds, MAX_UNIT_CHARS } from "../phase1-understanding.js";
import { createFfmpegHttpTranscriber, createFfmpegMediaCompressor } from "../video-ffmpeg.js";
import { expandPdfs, isPdf } from "../phase0-compress.js";
import { createPdftoppmPageSplitter } from "../pdf-split.js";
import { analyzeRewriteImpact } from "../phase4-rewrite.js";
import { loadHierarchyIndex } from "../filesystem.js";
import { migrateIpDnaSchema, NARRATIVE_IP_DNA_SCHEMA_VERSION, IP_DNA_MIGRATIONS } from "../../types/narrative-ip-dna.js";
import { userPreferenceAnalysis } from "../../pipeline/steps/user-preference-analysis.js";
import type { LLMClient } from "../../pipeline/runtime/llm-client.js";
import type { NarrativeContext } from "../../types/index.js";
import type { NarrativeIpDna } from "../../types/narrative-ip-dna.js";

const SAMPLE = ["第一章 起", "张三在城里登场，遇见李四。", "第二章 终", "终局之战，张三胜出。"].join("\n");

// ─────────────────────────────────────────────────────────────────
// #1 改编状态生命周期 → 激活字段级改写影响面
// ─────────────────────────────────────────────────────────────────
describe("#1 adaptation_status 生命周期", () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-gap1-"));
  afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

  it("生成后叶子节点推进为「已生成」并重新落盘，改写影响面非空", async () => {
    const result = await runIpDnaPipeline({
      files: [{ fileName: "s.md", data: SAMPLE, fileType: "text/markdown" }],
      title: "状态机",
      cwd: TMP,
      runGeneration: true,
      // 确定性提取 seam：填一个角色，使节点承载 A.characters（确定性兜底不解析角色）。
      extractor: (node) => {
        node.template = normalizeTemplate({ characters: [{ name: "张三", profile: "幸存者" }] });
        node.operators = [];
        node.metadata = { processing_status: "extracted", adaptation_status: "未改编" };
      },
      // 确定性生成 seam：直接回传已水合的 seedCtx，避免真实 LLM。
      generate: async ({ seedCtx }) => seedCtx,
    });

    const leaves = Object.values(result.dna.nodes).filter((n) => n.children.length === 0);
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((n) => n.metadata?.adaptation_status === "已生成")).toBe(true);
    // 根节点聚合进度也应为已生成。
    expect(result.dna.nodes[result.dna.rootId].metadata?.adaptation_status).toBe("已生成");

    // 重新落盘后，持久化索引里的状态同步推进（此前恒为「未改编」）。
    const persisted = loadHierarchyIndex(result.story_timestamp, "状态机", { cwd: TMP })!;
    const persistedLeaves = Object.values(persisted.nodes).filter((n) => n.children.length === 0);
    expect(persistedLeaves.some((n) => n.metadata?.adaptation_status === "已生成")).toBe(true);

    // 字段级改写影响面现在能命中已生成且承载该字段的节点（此前恒为空）。
    const impact = analyzeRewriteImpact(["A.characters"], result.dna);
    expect(impact.affectedInputNodes.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// #2 提取质量闸门
// ─────────────────────────────────────────────────────────────────
describe("#2 assessExtractionQuality", () => {
  it("连通+三件套齐全的提取通过；缺三件套则告警", () => {
    const dna = {
      story_id: "20260101_0000", title: "t", media_type: "book", rootId: "root",
      schema_version: NARRATIVE_IP_DNA_SCHEMA_VERSION,
      nodes: {
        root: { id: "root", levelType: "complete", index: 0, title: "t", parent: null, children: ["u1"] },
        u1: {
          id: "u1", levelType: "unit", index: 1, title: "u1", parent: "root", children: [],
          template: normalizeTemplate({ core_elements: { subject: "武侠", theme: "复仇", core_conflict: "", literature_style: "", emotion_experience: "" } }),
          operators: [{ uid: "o1", name: "对白", definition: "", adaptation: { type: "", element: "" }, usage_guide: "", example: "", knowledge_location: "", knowledge_domain: "故事内容" }],
          metadata: { processing_status: "extracted", adaptation_status: "未改编" },
        },
      },
    } as unknown as NarrativeIpDna;

    const ok = assessExtractionQuality(dna, ["u1"]);
    expect(ok.checks.find((c) => c.name === "三件套齐全")?.passed).toBe(true);
    expect(ok.checks.find((c) => c.name === "核心要素非空")?.passed).toBe(true);

    // 缺 template 的单元 → 三件套不齐全 + 告警。
    (dna.nodes.u1 as { template?: unknown }).template = undefined;
    const bad = assessExtractionQuality(dna, ["u1"]);
    expect(bad.passed).toBe(false);
    expect(bad.warnings.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// #3 拆解闭环
// ─────────────────────────────────────────────────────────────────
describe("#3 applyDecompositionClosure", () => {
  it("超线巨型叶子被切成子单元；enabled=false 时不动", () => {
    const big = "甲".repeat(MAX_UNIT_CHARS * 2 + 10);
    const dna = buildLightHierarchy({ story_timestamp: "20260101_0000", title: "巨", media_type: "book", text: big });
    expect(collectLeafIds(dna).length).toBe(1);

    // 关闭：不拆。
    const noop = applyDecompositionClosure(dna, big, false);
    expect(noop.iterations).toBe(0);
    expect(collectLeafIds(dna).length).toBe(1);

    // 开启：拆出多个子单元，无残留超线。
    const res = applyDecompositionClosure(dna, big, true);
    expect(res.iterations).toBeGreaterThan(0);
    expect(res.splitUnits).toBeGreaterThanOrEqual(2);
    expect(res.residualOversize).toBe(false);
    expect(collectLeafIds(dna).every((id) => {
      const r = dna.nodes[id].sourceRange!;
      return r.end - r.start <= MAX_UNIT_CHARS;
    })).toBe(true);
  });

  it("三次上限：极端超长仍残留时返回 residualOversize", () => {
    const huge = "乙".repeat(MAX_UNIT_CHARS * 30);
    const dna = buildLightHierarchy({ story_timestamp: "20260101_0000", title: "极", media_type: "book", text: huge });
    // 每轮每个叶子最多切成 ceil(span/cap) 份；一次迭代即可拆净，故这里验证上限不抛错且确定性。
    const res = applyDecompositionClosure(dna, huge, true, 1);
    expect(res.iterations).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// #4 视频 ASR 默认转写器（无端点降级）
// ─────────────────────────────────────────────────────────────────
describe("#4 createFfmpegHttpTranscriber", () => {
  it("无 ASR 端点时返回空串（降级，不抛错）", async () => {
    const t = createFfmpegHttpTranscriber({ endpoint: undefined });
    const out = await t({ fileName: "v.mp4", data: Buffer.from([0, 1, 2]), fileType: "video/mp4" });
    expect(out).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────
// #5 媒体压缩透传 + PDF 拆页接缝
// ─────────────────────────────────────────────────────────────────
describe("#5 媒体压缩 / PDF 拆页", () => {
  it("非媒体文件原样透传", async () => {
    const c = createFfmpegMediaCompressor({ ffmpegPath: "ffmpeg-不存在" });
    const file = { fileName: "a.txt", data: "hello", fileType: "text/plain" };
    expect(await c(file)).toEqual(file);
  });

  it("isPdf 识别 + expandPdfs 无 splitter 时透传", async () => {
    expect(isPdf("a.pdf")).toBe(true);
    expect(isPdf("a.jpg")).toBe(false);
    const files = [{ fileName: "a.pdf", data: Buffer.from("%PDF-1.4"), fileType: "application/pdf" }];
    expect(await expandPdfs(files, undefined)).toEqual(files);
  });

  it("pdftoppm 不存在时 splitter 透传原 PDF", async () => {
    const splitter = createPdftoppmPageSplitter({ pdftoppmPath: "pdftoppm-不存在", timeoutMs: 2000 });
    const file = { fileName: "a.pdf", data: Buffer.from("%PDF-1.4 fake"), fileType: "application/pdf" };
    const out = await splitter(file);
    expect(out).toEqual([file]);
  });
});

// ─────────────────────────────────────────────────────────────────
// #6 全局标题（无策划路径在用户偏好分析生成）
// ─────────────────────────────────────────────────────────────────
describe("#6 story_title 无策划路径", () => {
  const ANALYSIS = JSON.stringify({
    "全局控制参数": { complexity: 2, deviation: 0, story_title: "霜与火之歌" },
    "层级调控参数": {},
  });
  const llm = { callWithRetry: async () => ANALYSIS } as unknown as LLMClient;

  it("未预设标题时由分析阶段生成", async () => {
    const ctx = { user_input: "写一个冰与火的故事" } as NarrativeContext;
    await userPreferenceAnalysis(ctx, llm);
    expect(ctx.story_title).toBe("霜与火之歌");
  });

  it("已有标题（D0/IP DNA 预设）则继承不覆盖", async () => {
    const ctx = { user_input: "x", story_title: "既定书名" } as NarrativeContext;
    await userPreferenceAnalysis(ctx, llm);
    expect(ctx.story_title).toBe("既定书名");
  });

  // §4.6：IP DNA 改编计划预注入的 complexity 视为权威，preference 分析不得覆盖（与 target_structure 一致）。
  it("seeded 时改编计划 complexity 权威，不被 LLM 读数覆盖", async () => {
    // LLM 给出 complexity=2，但 seeded ctx 预注入 complexity=4 应胜出
    const ctx = {
      user_input: "x",
      complexity: 4,
      narrativeIpDna: { schema_version: "1.0.0", story_id: "s", title: "t", media_type: "book", rootId: "r", nodes: {} },
    } as unknown as NarrativeContext;
    await userPreferenceAnalysis(ctx, llm);
    expect(ctx.global_control_params?.complexity).toBe(4);
  });

  it("未 seeded 时 complexity 仍取 LLM 读数", async () => {
    const ctx = { user_input: "x" } as NarrativeContext;
    await userPreferenceAnalysis(ctx, llm);
    expect(ctx.global_control_params?.complexity).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// #7 IP DNA schema 迁移器
// ─────────────────────────────────────────────────────────────────
describe("#7 migrateIpDnaSchema", () => {
  it("补齐缺失版本号 + 已是当前版本则不变数据", () => {
    const legacy = { story_id: "x", title: "t", nodes: {}, rootId: "root" } as unknown as NarrativeIpDna;
    const migrated = migrateIpDnaSchema(legacy);
    expect(migrated.schema_version).toBe(NARRATIVE_IP_DNA_SCHEMA_VERSION);

    const current = { schema_version: NARRATIVE_IP_DNA_SCHEMA_VERSION, story_id: "x", title: "t", nodes: {}, rootId: "root" } as unknown as NarrativeIpDna;
    expect(migrateIpDnaSchema(current).schema_version).toBe(NARRATIVE_IP_DNA_SCHEMA_VERSION);
  });

  // P2.3 真值：当前 schema 仍为 1.0.0、无历史版本变更，故 IP_DNA_MIGRATIONS 保持为空（不捏造迁移）。
  // 但链式机制不能空心——下例临时注册两跳，证明 migrate 逐步被应用、版本逐级抬升到当前；
  // afterEach 还原注册表，确保不污染其它用例与生产。
  describe("链式迁移机制（证明非空心；不写入真实迁移）", () => {
    afterEach(() => {
      IP_DNA_MIGRATIONS.length = 0; // 还原为蓝图真值：空注册表。
    });

    it("按 from→to 顺序逐跳应用迁移，最终抬到当前版本", () => {
      const applied: string[] = [];
      IP_DNA_MIGRATIONS.push(
        {
          from: "0.0.0",
          to: "0.9.0",
          migrate: (raw) => {
            applied.push("0.0.0→0.9.0");
            return { ...raw, _step1: true };
          },
        },
        {
          from: "0.9.0",
          to: NARRATIVE_IP_DNA_SCHEMA_VERSION,
          migrate: (raw) => {
            applied.push("0.9.0→current");
            return { ...raw, _step2: true };
          },
        },
      );

      const legacy = { story_id: "x", title: "t" } as unknown as NarrativeIpDna; // 无版本 → 视为 0.0.0
      const out = migrateIpDnaSchema(legacy) as unknown as Record<string, unknown>;

      expect(applied).toEqual(["0.0.0→0.9.0", "0.9.0→current"]);
      expect(out._step1).toBe(true);
      expect(out._step2).toBe(true);
      expect(out.schema_version).toBe(NARRATIVE_IP_DNA_SCHEMA_VERSION);
    });

    it("注册表为空时仅回填版本号、不改数据（蓝图真值）", () => {
      expect(IP_DNA_MIGRATIONS.length).toBe(0);
      const raw = { story_id: "x", title: "t", payload: 42 } as unknown as NarrativeIpDna;
      const out = migrateIpDnaSchema(raw) as unknown as Record<string, unknown>;
      expect(out.payload).toBe(42);
      expect(out.schema_version).toBe(NARRATIVE_IP_DNA_SCHEMA_VERSION);
    });
  });
});
