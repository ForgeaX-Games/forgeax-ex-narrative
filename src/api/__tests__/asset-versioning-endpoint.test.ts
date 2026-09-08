/**
 * G5：定稿版本快照的端到端护栏。
 *
 * 覆盖三件事，且必须经真实 HTTP（不是直接调纯函数）—— 这条链路的价值恰恰在于
 * "编辑/还原会不会正确地在覆盖前补一张快照"，纯函数单测（version-store.test.ts）
 * 验证不了 server.ts 里调用时机是否搞反：
 *
 *   ① save-step-edit 每次真改动都在覆盖前补一张快照，版本号递增
 *   ② restore-original 还原前也补一张快照（被还原掉的那一稿不会凭空消失）
 *   ③ confirm-asset 的 pinCurrent 就地读出当下版本号，不需要调用方自己先查
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { app } from "../server.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENTRY_KEY = "g5-asset-version-test-entry";
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

function seedEntry(worldview: unknown): void {
  fs.mkdirSync(ENTRY_DIR, { recursive: true });
  fs.writeFileSync(path.join(ENTRY_DIR, "_entry.json"), JSON.stringify({ key: ENTRY_KEY }));
  fs.writeFileSync(
    path.join(ENTRY_DIR, "_checkpoint.json"),
    JSON.stringify({
      runId: "seed-run",
      startedAt: new Date().toISOString(),
      lastCompletedStep: "worldview",
      completedSteps: ["worldview"],
      savedAt: new Date().toISOString(),
      ctx: { user_input: "测试用条目", worldview_structure: worldview },
      userInput: "测试用条目",
    }),
  );
}

async function post<T>(path_: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}/api/narrative/${path_}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

describe("G5：save-step-edit / restore-original 在覆盖前补版本快照", () => {
  it("两次真改动各补一张快照，版本号从 1 递增；快照内容是改前而不是改后", async () => {
    seedEntry({ title: "初稿世界观" });

    const r1 = await post<{ ok: boolean }>("save-step-edit", {
      sourceDir: ENTRY_KEY,
      stepId: "worldview",
      editedContent: { title: "改过一次" },
      userInput: "换个名字",
    });
    expect(r1.ok).toBe(true);

    const v1Path = path.join(ENTRY_DIR, "04_世界观", "04_世界观_1.json");
    expect(fs.existsSync(v1Path)).toBe(true);
    expect(JSON.parse(fs.readFileSync(v1Path, "utf-8"))).toEqual({ title: "初稿世界观" });

    const r2 = await post<{ ok: boolean }>("save-step-edit", {
      sourceDir: ENTRY_KEY,
      stepId: "worldview",
      editedContent: { title: "改过两次" },
    });
    expect(r2.ok).toBe(true);

    const v2Path = path.join(ENTRY_DIR, "04_世界观", "04_世界观_2.json");
    expect(fs.existsSync(v2Path)).toBe(true);
    expect(JSON.parse(fs.readFileSync(v2Path, "utf-8"))).toEqual({ title: "改过一次" });

    // "当前"内容（平铺文件，rewriteStepArtifacts 维护）反映的是最后一次改动，不参与编号。
    const flatPath = path.join(ENTRY_DIR, "04_世界观.json");
    expect(JSON.parse(fs.readFileSync(flatPath, "utf-8"))).toEqual({ title: "改过两次" });
  });

  it("editedContent 省略（只读一次）不产生任何快照", async () => {
    seedEntry({ title: "初稿世界观" });
    await post("save-step-edit", { sourceDir: ENTRY_KEY, stepId: "worldview" });
    expect(fs.existsSync(path.join(ENTRY_DIR, "04_世界观"))).toBe(false);
  });

  it("restore-original 还原前也补一张快照——被还原掉的那一稿留在历史里", async () => {
    seedEntry({ title: "初稿世界观" });
    await post("save-step-edit", {
      sourceDir: ENTRY_KEY,
      stepId: "worldview",
      editedContent: { title: "改过一次" },
    });
    // 到这里已有 1 张快照（初稿），"当前"是"改过一次"。
    const restoreRes = await post<{ ok: boolean; restoredContent: unknown }>("restore-original", {
      sourceDir: ENTRY_KEY,
      stepId: "worldview",
    });
    expect(restoreRes.ok).toBe(true);
    expect(restoreRes.restoredContent).toEqual({ title: "初稿世界观" });

    // 还原前的"改过一次"要能在历史快照里找到，不能因为还原就永久丢失。
    const v2Path = path.join(ENTRY_DIR, "04_世界观", "04_世界观_2.json");
    expect(fs.existsSync(v2Path)).toBe(true);
    expect(JSON.parse(fs.readFileSync(v2Path, "utf-8"))).toEqual({ title: "改过一次" });

    const flatPath = path.join(ENTRY_DIR, "04_世界观.json");
    expect(JSON.parse(fs.readFileSync(flatPath, "utf-8"))).toEqual({ title: "初稿世界观" });
  });

  /**
   * 逐节点落盘的步（大纲、情节这些）把单节点文件写进 `<主干名>/`，而版本快照住的
   * 是同一个目录。清理残留节点文件的那一步曾经不认版本快照，于是每改一次就把
   * 历史清一次——快照存在过，只是活不过下一次产物重写。上面那几条用的是世界观
   * （没有单节点文件），碰不到这条路径。
   */
  it("逐节点落盘的步：版本快照活得过产物重写，不会被当成残留节点文件删掉", async () => {
    const outlines = (title: string) => ({
      outlines: [
        { node_id: "a", parent_id: "act1", name: title, prev_node: [], next_node: [] },
      ],
    });
    seedEntry({ title: "无关" });
    // 复用同一个条目，只是把 ctx 换成带大纲的。
    const cpPath = path.join(ENTRY_DIR, "_checkpoint.json");
    const cp = JSON.parse(fs.readFileSync(cpPath, "utf-8"));
    cp.ctx.outlines_generated = outlines("初稿");
    fs.writeFileSync(cpPath, JSON.stringify(cp));

    await post("save-step-edit", {
      sourceDir: ENTRY_KEY,
      stepId: "outline_batch",
      editedContent: outlines("改过一次"),
    });

    const v1Path = path.join(ENTRY_DIR, "07_故事大纲", "07_故事大纲_1.json");
    expect(fs.existsSync(v1Path), "第一张快照该在").toBe(true);

    await post("save-step-edit", {
      sourceDir: ENTRY_KEY,
      stepId: "outline_batch",
      editedContent: outlines("改过两次"),
    });

    // 第二次改动会重写产物并清理单节点目录——第一张快照必须还在。
    expect(fs.existsSync(v1Path), "第一张快照被第二次重写清掉了").toBe(true);
    expect(fs.existsSync(path.join(ENTRY_DIR, "07_故事大纲", "07_故事大纲_2.json"))).toBe(true);
    // 单节点文件照常写，两者共用一个目录互不干扰。
    expect(fs.existsSync(path.join(ENTRY_DIR, "07_故事大纲", "a.json"))).toBe(true);
  });
});

describe("G5：POST /api/narrative/assets/:key 的 pinCurrent", () => {
  it("就地读出当下版本号并钉住，不需要调用方自己先查", async () => {
    seedEntry({ title: "初稿世界观" });
    await post("save-step-edit", {
      sourceDir: ENTRY_KEY,
      stepId: "worldview",
      editedContent: { title: "改过一次" },
    });
    // 此刻：1 张历史快照（初稿）+ 当前（改过一次）→ 当前版本号 = 2。
    const res = await post<{ assets: Array<{ path: string; version?: number }> }>(
      `assets/${ENTRY_KEY}`,
      { path: "output/04_世界观.json", pinCurrent: true },
    );
    const pinned = res.assets.find((a) => a.path === "output/04_世界观.json");
    expect(pinned?.version).toBe(2);
  });

  it("未给 pinCurrent 也未给 version 时维持老语义：跟随最新（不存版本号）", async () => {
    seedEntry({ title: "初稿世界观" });
    const res = await post<{ assets: Array<{ path: string; version?: number }> }>(
      `assets/${ENTRY_KEY}`,
      { path: "output/04_世界观.json" },
    );
    const pinned = res.assets.find((a) => a.path === "output/04_世界观.json");
    expect(pinned?.version).toBeUndefined();
  });
});
