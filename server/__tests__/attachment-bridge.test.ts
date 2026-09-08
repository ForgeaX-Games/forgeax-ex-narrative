import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tools from "../tool-handlers.js";

/**
 * 聊天附件进叙事的那条路：agent 拿到的是**路径**而不是正文。
 *
 * 为什么必须由插件读盘：docx/pdf 是二进制，agent 既读不出正文也做不了 base64；
 * 让它"尽力而为"的结果是摄入一段乱码并照常跑完 —— 拿到一份看着正常、实际不是原著的
 * 改编产物，比直接失败更难发现。
 *
 * 这里只打 `narrative:ip-dna-ingest`（`ip-dna-start` 共用同一段转换）。
 */

const ingest = (tools as Record<string, (a: unknown, c: unknown) => Promise<unknown>>)[
  "narrative:ip-dna-ingest"
]!;

interface CapturedBody {
  files: Array<{
    file_name?: string;
    content?: string;
    content_base64?: string;
    encoding?: string;
    file_type?: string;
    role?: string;
  }>;
  title?: string;
}

describe("聊天附件 → narrative 摄入工具", () => {
  let root: string;
  let captured: CapturedBody | null;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "narrative-attach-"));
    captured = null;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as CapturedBody;
      return { ok: true, json: async () => ({ runId: "ipdna_1" }) } as unknown as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("文本附件按 utf8 正文送出，文件名与 MIME 由路径推断", async () => {
    fs.writeFileSync(path.join(root, "第一章.md"), "# 开场\n她推开门。", "utf-8");
    await ingest({ files: [{ path: "第一章.md" }] }, { cwd: root, toolId: "t", caller: { kind: "test" } });

    expect(captured!.files).toHaveLength(1);
    const f = captured!.files[0]!;
    expect(f.file_name).toBe("第一章.md");
    expect(f.content).toContain("她推开门");
    expect(f.encoding).toBe("utf8");
    expect(f.file_type).toBe("text/markdown");
    expect(f.content_base64).toBeUndefined();
  });

  it("docx 附件转 base64-docx（正文交后端 mammoth 抽，本层只搬字节）", async () => {
    fs.writeFileSync(path.join(root, "全稿.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await ingest({ files: [{ path: "全稿.docx" }] }, { cwd: root, toolId: "t", caller: { kind: "test" } });

    const f = captured!.files[0]!;
    expect(f.encoding).toBe("base64-docx");
    expect(f.content_base64).toBe(Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64"));
    expect(f.content).toBeUndefined();
  });

  it("其他二进制走裸 base64，不冒充 docx", async () => {
    fs.writeFileSync(path.join(root, "封面.png"), Buffer.from([0x89, 0x50]));
    await ingest({ files: [{ path: "封面.png" }] }, { cwd: root, toolId: "t", caller: { kind: "test" } });

    const f = captured!.files[0]!;
    expect(f.encoding).toBeUndefined();
    expect(f.file_type).toBe("image/png");
    expect(f.content_base64).toBeTruthy();
  });

  it("内联正文原样透传，与 path 那一路可以混在同一次调用里", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "盘上的", "utf-8");
    await ingest(
      {
        files: [{ path: "a.txt" }, { fileName: "b.txt", content: "手给的", role: "setting" }],
        title: "混合",
      },
      { cwd: root, toolId: "t", caller: { kind: "test" } },
    );

    expect(captured!.files.map((f) => f.content)).toEqual(["盘上的", "手给的"]);
    expect(captured!.files[1]!.role).toBe("setting");
    expect(captured!.title).toBe("混合");
  });

  it("显式 fileName / fileType 覆盖路径推断（附件重命名后仍按用户说的报）", async () => {
    fs.writeFileSync(path.join(root, "tmp-upload-8821"), "正文", "utf-8");
    await ingest(
      { files: [{ path: "tmp-upload-8821", fileName: "原著节选.txt", fileType: "text/plain" }] },
      { cwd: root, toolId: "t", caller: { kind: "test" } },
    );

    expect(captured!.files[0]!.file_name).toBe("原著节选.txt");
    expect(captured!.files[0]!.file_type).toBe("text/plain");
  });

  it("越出工程根目录的路径直接报错，且一个文件都不送", async () => {
    await expect(
      ingest({ files: [{ path: "../../etc/passwd" }] }, { cwd: root, toolId: "t", caller: { kind: "test" } }),
    ).rejects.toThrow(/escapes the project root/);
    expect(captured).toBeNull();
  });

  it("缺 cwd 时报错而不是猜一个根目录", async () => {
    await expect(
      ingest({ files: [{ path: "a.txt" }] }, { toolId: "t", caller: { kind: "test" } }),
    ).rejects.toThrow(/no project root/);
  });
});
