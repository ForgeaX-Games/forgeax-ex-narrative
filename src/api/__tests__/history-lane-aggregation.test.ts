/**
 * `GET /api/narrative/history` 的条目级多泳道聚合接线（键权层方案 M5）。
 *
 * 只测纯函数不够——真正的风险在接线：`parseDirEntry` 会不会真的去扫
 * `pipelines/<pipelineId>/manifest.json` 并把结果并入条目状态。这里直接落盘一个
 * "主管线已完成、次管线还在跑"的条目，断言 LIST 返回的条目级状态是 running 而非
 * completed——否则用户正在某条次管线上生成，列表却谎称"已完成"。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { app } from "../server.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "history-lane-agg-test-entry";
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

function writeManifest(dir: string, status: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ runId: "r", status, startedAt: new Date().toISOString(), files: [] }),
  );
}

async function fetchHistory(): Promise<any[]> {
  const r = await fetch(`${baseUrl}/api/narrative/history`);
  return (await r.json()) as any[];
}

describe("GET /api/narrative/history 多泳道聚合", () => {
  it("主管线 completed、次管线磁盘残留 running（无活跃进程）：条目级不再谎称已完成", async () => {
    // 没有对应的内存态 RunState，磁盘 running 按同一套决策树判定为 interrupted（僵尸态）——
    // 这里要验证的是接线本身：这条次泳道确实参与了聚合，条目级状态因它而不再是单看
    // 主管线时的 completed。
    writeManifest(ENTRY_DIR, "completed");
    writeManifest(path.join(ENTRY_DIR, "pipelines", "pid-1"), "running");

    const items = await fetchHistory();
    const found = items.find((it) => it.key === ENTRY_KEY);
    expect(found, "条目应出现在列表里").toBeTruthy();
    expect(found.status).toBe("interrupted");
  });

  it("主管线与次管线都 completed：条目级报 completed", async () => {
    writeManifest(ENTRY_DIR, "completed");
    writeManifest(path.join(ENTRY_DIR, "pipelines", "pid-1"), "completed");

    const items = await fetchHistory();
    const found = items.find((it) => it.key === ENTRY_KEY);
    expect(found.status).toBe("completed");
  });

  it("次管线 failed、主管线 completed：条目级报 interrupted（不能被主管线成功糊弄过去）", async () => {
    writeManifest(ENTRY_DIR, "completed");
    writeManifest(path.join(ENTRY_DIR, "pipelines", "pid-1"), "failed");

    const items = await fetchHistory();
    const found = items.find((it) => it.key === ENTRY_KEY);
    expect(found.status).toBe("interrupted");
  });

  it("没有次管线目录：行为与此前一致，只看主管线状态", async () => {
    writeManifest(ENTRY_DIR, "completed");

    const items = await fetchHistory();
    const found = items.find((it) => it.key === ENTRY_KEY);
    expect(found.status).toBe("completed");
  });
});
