/**
 * 检查到修复的闭环护栏。
 *
 * 两个检查席此前是「只审不修」：报告出得很细，作者看完还得回到对应席位整步重跑。
 * 这条链路补的是「勾哪条修哪条」，而它最容易出的错不是抛异常，是**看着修好了**：
 *
 *   ① 勾了修不了的条目却回 ok，用户以为改过了；
 *   ② 修完不留版本，改坏了回不去；
 *   ③ 修完不重写产物文件，ctx 与盘上那份从此对不上；
 *   ④ 报告不刷新，同一条问题永远还在那里。
 *
 * 所以断言全部经真实 HTTP 打，且落到盘上去看。拓扑修复是确定性的，不需要模型，
 * 这条路径可以完整实跑；定点重写要 LLM，这里只验它的分派与拒绝行为。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { app } from "../server.js";
import { buildStructureCheckReport } from "../../pipeline/steps/structure-check.js";
import type { NarrativeContext } from "../../types/index.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "qa-apply-test-entry";
const ENTRY_DIR = path.join(OUTPUT_DIR, ENTRY_KEY);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  fs.rmSync(ENTRY_DIR, { recursive: true, force: true });
});

/** 一层大纲：b 指向一个不存在的节点，是连接修复认得的那类硬错误。 */
function outlinesWithBrokenEdge(): unknown {
  return {
    outlines: [
      { node_id: "a", parent_id: "act1", name: "a", prev_node: [], next_node: ["b"] },
      { node_id: "b", parent_id: "act1", name: "b", prev_node: [], next_node: ["zzz"] },
    ],
  };
}

function seedEntry(ctxExtra: Record<string, unknown>): NarrativeContext {
  const ctx = { user_input: "测试用条目", ...ctxExtra } as unknown as NarrativeContext;
  fs.mkdirSync(ENTRY_DIR, { recursive: true });
  fs.writeFileSync(path.join(ENTRY_DIR, "_entry.json"), JSON.stringify({ key: ENTRY_KEY }));
  fs.writeFileSync(
    path.join(ENTRY_DIR, "_checkpoint.json"),
    JSON.stringify({
      runId: "seed-run",
      startedAt: new Date().toISOString(),
      lastCompletedStep: "structure_check",
      completedSteps: ["outline_batch", "structure_check"],
      savedAt: new Date().toISOString(),
      ctx,
      userInput: "测试用条目",
    }),
  );
  // 平铺产物：修复要能在覆盖它之前留下版本快照。
  if (ctx.outlines_generated) {
    fs.writeFileSync(
      path.join(ENTRY_DIR, "07_故事大纲.json"),
      JSON.stringify(ctx.outlines_generated, null, 2),
    );
  }
  return ctx;
}

/** 播一条有拓扑问题的大纲，并把结构检查报告一并写进 ctx。 */
function seedWithStructureReport(): { ctx: NarrativeContext; report: ReturnType<typeof buildStructureCheckReport> } {
  const base = { outlines_generated: outlinesWithBrokenEdge() };
  const report = buildStructureCheckReport(base as unknown as NarrativeContext);
  const ctx = seedEntry({ ...base, structure_check_report: report });
  return { ctx, report };
}

async function apply(body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${baseUrl}/api/narrative/qa/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

function readCheckpointCtx(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(ENTRY_DIR, "_checkpoint.json"), "utf-8")).ctx;
}

describe("POST /api/narrative/qa/apply", () => {
  it("参数不全直接 400，不做半截修复", async () => {
    seedWithStructureReport();
    expect((await apply({ sourceDir: ENTRY_KEY, stepId: "structure_check" })).status).toBe(400);
    expect((await apply({ sourceDir: ENTRY_KEY, findingIds: ["x"] })).status).toBe(400);
  });

  it("拿过期报告来修会 404，而不是静默什么也不改", async () => {
    seedWithStructureReport();
    const { status, json } = await apply({
      sourceDir: ENTRY_KEY,
      stepId: "structure_check",
      findingIds: ["structure-deadbeef"],
    });
    expect(status).toBe(404);
    expect(String(json.error)).toContain("过期");
  });

  it("拓扑问题真的被修掉，且改前留了版本快照", async () => {
    const { report } = seedWithStructureReport();
    const topo = report.findings.find((f) => f.repairKind === "topology");
    expect(topo, "播的数据本该有拓扑问题").toBeTruthy();

    const { status, json } = await apply({
      sourceDir: ENTRY_KEY,
      stepId: "structure_check",
      findingIds: [topo!.id],
    });

    expect(status).toBe(200);
    expect(json.applied).toBe(1);
    expect(json.outcomes[0].status).toBe("applied");

    // 指向不存在节点的那条边被清掉，b 与 a 的关系补成双向。
    const ctx = readCheckpointCtx();
    const a = ctx.outlines_generated.outlines.find((n: any) => n.node_id === "a");
    const b = ctx.outlines_generated.outlines.find((n: any) => n.node_id === "b");
    expect(b.next_node).not.toContain("zzz");
    expect(a.next_node).toContain("b");
    expect(b.prev_node).toContain("a");

    // 旧版进了版本目录——改坏了要回得去。
    const versionDir = path.join(ENTRY_DIR, "07_故事大纲");
    expect(fs.existsSync(path.join(versionDir, "07_故事大纲_1.json"))).toBe(true);

    // 平铺产物按修完的 ctx 重写过，盘上与 ctx 不会各说各话。
    const onDisk = JSON.parse(fs.readFileSync(path.join(ENTRY_DIR, "07_故事大纲.json"), "utf-8"));
    expect(onDisk.outlines.find((n: any) => n.node_id === "a").next_node).toContain("b");
  });

  it("修完报告按修复后的 ctx 重算，那条问题不再挂着", async () => {
    const { report } = seedWithStructureReport();
    const topo = report.findings.find((f) => f.repairKind === "topology")!;

    const { json } = await apply({
      sourceDir: ENTRY_KEY,
      stepId: "structure_check",
      findingIds: [topo!.id],
    });

    expect(json.report.findings.map((f: any) => f.id)).not.toContain(topo.id);
  });

  it("只报不修的条目如实回 skipped，不假装修过", async () => {
    // 8 个节点全线性：报"过于线性"，这得靠加分支解决，连接修复办不到。
    const outlines = Array.from({ length: 8 }, (_, i) => ({
      node_id: `n${i}`,
      parent_id: "act1",
      name: `n${i}`,
      prev_node: i === 0 ? [] : [`n${i - 1}`],
      next_node: i === 7 ? [] : [`n${i + 1}`],
    }));
    const base = { outlines_generated: { outlines } };
    const report = buildStructureCheckReport(base as unknown as NarrativeContext);
    seedEntry({ ...base, structure_check_report: report });

    const linear = report.findings.find((f) => f.issue.includes("完全线性"))!;
    const { json } = await apply({
      sourceDir: ENTRY_KEY,
      stepId: "structure_check",
      findingIds: [linear.id],
    });

    expect(json.applied).toBe(0);
    expect(json.outcomes[0].status).toBe("skipped");
    expect(String(json.outcomes[0].detail)).toContain("只报不修");
  });

  it("找不到节点的内容修复报 failed 并说清原因", async () => {
    const contentReport = {
      verdict: "fail",
      summary: "一处硬伤",
      checkedAt: new Date().toISOString(),
      findings: [
        {
          id: "content-testid1",
          criterion: "逻辑自洽",
          nodeId: "不存在的节点",
          severity: "error",
          issue: "角色凭空知道了这件事",
          excerpt: "他早就知道",
          suggestion: "补一句信息来源",
          repairKind: "content",
          targetField: "plots_generated",
        },
      ],
    };
    seedEntry({ plots_generated: { plots: [] }, content_check_report: contentReport });

    const { json } = await apply({
      sourceDir: ENTRY_KEY,
      stepId: "content_check",
      findingIds: ["content-testid1"],
    });

    expect(json.applied).toBe(0);
    expect(json.outcomes[0].status).toBe("failed");
    expect(String(json.outcomes[0].detail)).toContain("找不到节点");
  });
});
