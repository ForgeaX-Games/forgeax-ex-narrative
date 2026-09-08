/**
 * G3：GET /api/narrative/seats 的端到端护栏。
 *
 * 不用 supertest（仓库未依赖它）：`app` 本身不在 VITEST 环境下 listen
 * （见 server.ts 底部 `if (!process.env.VITEST) app.listen(...)`），这里自己在
 * 临时端口起一次，验证平台工具实际会拿到的 HTTP 响应形状，而不仅是内部函数。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { app } from "../server.js";

interface SeatDiscoveryEntry {
  id: string;
  canRunStandalone: boolean;
  runnableAgentId?: string;
}

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

describe("GET /api/narrative/seats", () => {
  it("返回二十席，且 req_list / structure 报出各自的 composite 外壳 id", async () => {
    const res = await fetch(`${baseUrl}/api/narrative/seats`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seats: SeatDiscoveryEntry[] };
    expect(body.seats.length).toBe(20);

    const byId = new Map(body.seats.map((s) => [s.id, s]));
    expect(byId.get("req_list")?.canRunStandalone).toBe(true);
    expect(byId.get("req_list")?.runnableAgentId).toBe("req_list");
    expect(byId.get("structure")?.runnableAgentId).toBe("structure");
    expect(byId.get("outline")?.runnableAgentId).toBe("story_framework");
  });
});
