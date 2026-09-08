import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createJob, updateJob, getJob, listJobs } from "../job.js";
import {
  buildLedgerFromTemplate,
  mergeLedger,
  upsertLedger,
  harvestLedgerFromGenerated,
  loadLedger,
  saveLedger,
} from "../phase5-polish.js";
import { analyzeRewriteImpact, nodeCarriesAtlasField } from "../phase4-rewrite.js";
import { runIpDnaPipeline } from "../orchestrator.js";
import { normalizeTemplate } from "../phase2-extract.js";
import type { NarrativeContext } from "../../types/index.js";
import type { HierarchyNode, NarrativeIpDna } from "../../types/narrative-ip-dna.js";

const SAMPLE = ["第一章 起", "张三登场。", "第二章 终", "终局之战。"].join("\n");

describe("batch6: 异步任务契约（job store）", () => {
  it("create→update→get 反映 status/progress/stage", () => {
    const job = createJob({ story_timestamp: "20260101_0000" });
    expect(job.status).toBe("pending");
    updateJob(job.jobId, { status: "running", stage: "phase2_extract", progress: 50 });
    const got = getJob(job.jobId);
    expect(got?.status).toBe("running");
    expect(got?.stage).toBe("phase2_extract");
    expect(got?.progress).toBe(50);
    expect(listJobs().some((j) => j.jobId === job.jobId)).toBe(true);
  });

  it("update 不存在的 job 返回 undefined", () => {
    expect(updateJob("nope", { progress: 1 })).toBeUndefined();
  });
});

describe("batch6: 账本回写 + 续跑合并", () => {
  it("upsertLedger 同 ref 幂等去重", () => {
    const l = buildLedgerFromTemplate("20260101_0000", "t", normalizeTemplate({}));
    const before = l.entries.length;
    upsertLedger(l, { ref: "x", kind: "fact", content: "a" });
    upsertLedger(l, { ref: "x", kind: "fact", content: "b" });
    expect(l.entries.length).toBe(before + 1);
  });

  it("harvestLedgerFromGenerated 把生成产物沉淀回账本", () => {
    const l = buildLedgerFromTemplate("20260101_0000", "t", normalizeTemplate({}));
    const generated: NarrativeContext = {
      user_input: "",
      story_title: "冰封",
      core_settings: { world_name: "冰封都市", main_theme: "希望" } as NarrativeContext["core_settings"],
      detailed_character_sheets: [{ name: "张三", label: "主角", role_in_story: "幸存者" }] as NarrativeContext["detailed_character_sheets"],
      story_framework: { framework: { nodes: [{ node_id: "n1", name: "抉择", narrative_function: "pivot", main_content: "", is_branch: true, prev_node: [], next_node: [] }] } },
    } as NarrativeContext;
    harvestLedgerFromGenerated(l, generated, { unitRef: "gu1" });
    const contents = l.entries.map((e) => e.content).join(" | ");
    expect(contents).toContain("冰封都市");
    expect(contents).toContain("张三");
    expect(l.entries.some((e) => e.kind === "decision")).toBe(true);
  });

  it("mergeLedger 按 ref 去重并入历史条目", () => {
    const a = buildLedgerFromTemplate("20260101_0000", "t", normalizeTemplate({}));
    upsertLedger(a, { ref: "only-in-a", kind: "fact", content: "A" });
    const b = buildLedgerFromTemplate("20260101_0000", "t", normalizeTemplate({}));
    upsertLedger(b, { ref: "only-in-b", kind: "fact", content: "B" });
    mergeLedger(a, b);
    expect(a.entries.some((e) => e.ref === "only-in-b")).toBe(true);
  });
});

describe("batch6: data-atlas 字段级影响面反向追溯", () => {
  function node(id: string, status: "已改编" | "未改编", template: HierarchyNode["template"]): HierarchyNode {
    return {
      id, levelType: "unit", index: 1, title: id, parent: "root", children: [],
      template,
      metadata: { processing_status: "extracted", adaptation_status: status, stats: { char_count: 0, operator_count: 0 }, updated_at: "" },
    };
  }

  it("只标记承载该字段且已改编的节点（非粗标全部）", () => {
    const dna = {
      story_id: "20260101_0000", title: "t", media_type: "book", rootId: "root",
      nodes: {
        root: { id: "root", levelType: "complete", index: 0, title: "t", parent: null, children: ["u1", "u2", "u3"] },
        // u1：已改编 + 有角色 → 受 A.characters 影响
        u1: node("u1", "已改编", normalizeTemplate({ characters: [{ name: "张三", profile: "p" }] })),
        // u2：已改编但无角色 → 不受 A.characters 影响
        u2: node("u2", "已改编", normalizeTemplate({ worldview: { setting: "城", scene_structure: "", item_inventory: "" } })),
        // u3：有角色但未改编 → 不标脏
        u3: node("u3", "未改编", normalizeTemplate({ characters: [{ name: "李四", profile: "p" }] })),
      },
    } as unknown as NarrativeIpDna;

    const impact = analyzeRewriteImpact(["A.characters"], dna);
    expect(impact.affectedInputNodes).toEqual(["u1"]);
    expect(impact.affectedDownstream).toContain("B.detailed_character_sheets");
  });

  it("nodeCarriesAtlasField 字段级断言", () => {
    const n = node("u1", "已改编", normalizeTemplate({ worldview: { setting: "城", scene_structure: "", item_inventory: "" } }));
    expect(nodeCarriesAtlasField(n, "A.worldview.setting")).toBe(true);
    expect(nodeCarriesAtlasField(n, "A.worldview.item_inventory")).toBe(false);
    expect(nodeCarriesAtlasField(n, "A.characters")).toBe(false);
  });
});

describe("batch6: 断点续传（resume 跳过提取并懒加载）", () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-b6-"));
  afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

  it("resume 复用持久化 IP DNA，节点三件套懒加载回内存", async () => {
    const first = await runIpDnaPipeline({
      files: [{ fileName: "s.md", data: SAMPLE, fileType: "text/markdown" }],
      title: "续跑",
      cwd: TMP,
      runGeneration: false,
    });
    const ts = first.story_timestamp;

    const resumed = await runIpDnaPipeline({
      files: [{ fileName: "s.md", data: SAMPLE, fileType: "text/markdown" }],
      title: "续跑",
      story_timestamp: ts,
      cwd: TMP,
      runGeneration: false,
      resume: true,
    });
    // 续跑应得到等量节点，且最小单元三件套已 hydrate（template 存在）。
    const leaves = Object.values(resumed.dna.nodes).filter((n) => n.children.length === 0);
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((n) => !!n.template)).toBe(true);
    // 账本落盘存在（续跑加载入口可读）。
    expect(loadLedger(ts, "续跑", { cwd: TMP })).toBeDefined();
  });
});
