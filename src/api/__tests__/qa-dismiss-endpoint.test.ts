/**
 * `/qa/dismiss`：把勾选的 finding 标 `dismissed`，不碰内容、不留版本快照。
 *
 * 与 `qa-apply-endpoint.test.ts` 断言"真的改了内容"相对，这里要断言"确实什么
 * 都没改"——只有 status 字段变了，产物文件、版本目录都保持原样。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { app } from "../server.js";
import { buildStructureCheckReport } from "../../pipeline/steps/structure-check.js";
import type { NarrativeContext } from "../../types/index.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "qa-dismiss-test-entry";
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

function outlinesWithBrokenEdge(): unknown {
  return {
    outlines: [
      { node_id: "a", parent_id: "act1", name: "a", prev_node: [], next_node: ["b"] },
      { node_id: "b", parent_id: "act1", name: "b", prev_node: [], next_node: ["zzz"] },
    ],
  };
}

function seedWithStructureReport(): { ctx: NarrativeContext; report: ReturnType<typeof buildStructureCheckReport> } {
  const outlines = outlinesWithBrokenEdge();
  const base = { outlines_generated: outlines } as unknown as NarrativeContext;
  const report = buildStructureCheckReport(base);
  const ctx = {
    outlines_generated: outlines,
    user_input: "测试用条目",
    structure_check_report: report,
  } as unknown as NarrativeContext;
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
  fs.writeFileSync(path.join(ENTRY_DIR, "07_故事大纲.json"), JSON.stringify(base.outlines_generated, null, 2));
  return { ctx, report };
}

async function dismiss(body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${baseUrl}/api/narrative/qa/dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

function readCheckpointCtx(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(ENTRY_DIR, "_checkpoint.json"), "utf-8")).ctx;
}

describe("POST /api/narrative/qa/dismiss", () => {
  it("参数不全直接 400", async () => {
    seedWithStructureReport();
    expect((await dismiss({ sourceDir: ENTRY_KEY, stepId: "structure_check" })).status).toBe(400);
  });

  it("拿不到报告的 stepId 回 404", async () => {
    seedWithStructureReport();
    const { status } = await dismiss({ sourceDir: ENTRY_KEY, stepId: "content_check", findingIds: ["x"] });
    expect(status).toBe(404);
  });

  it("勾选的 finding 标 dismissed，其余原样，且不新增版本快照", async () => {
    const { report } = seedWithStructureReport();
    const topo = report.findings.find((f) => f.repairKind === "topology")!;

    const { status, json } = await dismiss({
      sourceDir: ENTRY_KEY,
      stepId: "structure_check",
      findingIds: [topo.id],
    });

    expect(status).toBe(200);
    expect(json.dismissed).toBe(1);
    const found = json.report.findings.find((f: any) => f.id === topo.id);
    expect(found.status).toBe("dismissed");

    // 内容完全没动——这是"看过了不用管"，不是修复。
    const ctx = readCheckpointCtx();
    const b = ctx.outlines_generated.outlines.find((n: any) => n.node_id === "b");
    expect(b.next_node).toContain("zzz");

    // 没有版本目录：忽略不产生快照。
    const versionDir = path.join(ENTRY_DIR, "07_故事大纲");
    expect(fs.existsSync(versionDir)).toBe(false);
  });

  it("已经 dismissed 的条目重复忽略：findingGuards 挡住，不重复计数", async () => {
    const { report } = seedWithStructureReport();
    const topo = report.findings.find((f) => f.repairKind === "topology")!;
    await dismiss({ sourceDir: ENTRY_KEY, stepId: "structure_check", findingIds: [topo.id] });

    const { json } = await dismiss({ sourceDir: ENTRY_KEY, stepId: "structure_check", findingIds: [topo.id] });
    expect(json.dismissed).toBe(0);
  });
});
