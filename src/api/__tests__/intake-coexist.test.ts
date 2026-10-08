/**
 * 需求输入、标签设置、体量选择**并存** —— v4 §1 的 "与"，不是 "或"。
 *
 * 这不是个新功能，是拆掉一个旧的互斥。`EntryConfig` 一直同时有 `userInput` / `tags` /
 * `complexity` 三个字段，数据层从来容得下三者同时有值；把它们说成三选一的只有
 * `inputType` 那个三值字段和跟着它走的 UI。代价是真实的数据丢失：用户勾完六维标签再去
 * 写一段需求描述，落盘时标签整份被丢掉（写入侧按当前那一档带字段）。
 *
 * 三值里真正被读到的区分只有一个 —— 是不是上传原作。所以收成两条入口，text 与 tags
 * 归进同一条。
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toIntakeSource, loadEntry, writeEntry } from "../entry-store.js";

const dirs: string[] = [];
function tmpOut(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "intake-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("入口归一成两条", () => {
  it("退役的三值折进两条入口", () => {
    // 存量 `_entry.json` 里写的就是这三个词，MCP 旧调用方也可能还在传。
    expect(toIntakeSource("works")).toBe("adapted");
    expect(toIntakeSource("text")).toBe("authored");
    expect(toIntakeSource("tags")).toBe("authored");
  });

  it("新词原样通过", () => {
    expect(toIntakeSource("authored")).toBe("authored");
    expect(toIntakeSource("adapted")).toBe("adapted");
  });

  it("认不出来的归自己描述，不抛错", () => {
    // 猜成 adapted 会让任务面板去找一份不存在的上传媒体。
    for (const raw of ["", "  ", "upload", null, undefined, 7, {}]) {
      expect(toIntakeSource(raw)).toBe("authored");
    }
  });

  it("读盘即归一，下游只见两值", () => {
    const out = tmpOut();
    fs.mkdirSync(path.join(out, "e1"), { recursive: true });
    fs.writeFileSync(
      path.join(out, "e1", "_entry.json"),
      JSON.stringify({ inputType: "works", userInput: "旧条目" }),
      "utf-8",
    );
    expect(loadEntry(out, "e1")?.inputType).toBe("adapted");
  });

  it("没写过这个字段的条目保持没写", () => {
    // 凭空补一个 authored 会把"作者没说"记成"作者说了自己描述"。
    const out = tmpOut();
    fs.mkdirSync(path.join(out, "e2"), { recursive: true });
    fs.writeFileSync(path.join(out, "e2", "_entry.json"), JSON.stringify({ userInput: "x" }), "utf-8");
    const cfg = loadEntry(out, "e2")!;
    expect(cfg.inputType).toBeUndefined();
    expect("inputType" in cfg).toBe(false);
  });

  it("写盘也归一，旧词不会再落进盘里", () => {
    // 不归一的话，旧调用方写进去的 "text" 下一次读出来又是一份要归一的存量。
    const out = tmpOut();
    const saved = writeEntry(out, "e3", { inputType: "tags" as never, userInput: "x" });
    expect(saved.inputType).toBe("authored");
    expect(JSON.parse(fs.readFileSync(path.join(out, "e3", "_entry.json"), "utf-8")).inputType).toBe(
      "authored",
    );
  });
});

describe("入口标记不取决于哪条路径先落盘", () => {
  /**
   * v4 §1.5 说条目在用户确认输入那一刻建立，而实际会首次落盘的路径不止那一条：单席
   * 直跑的兜底建、`/start` 与 `/entry/start` 的配置回写，各自拼自己那份 patch，都不带
   * `inputType`（chat 与 MCP 直接开跑，压根没过 UI 的确认动作）。于是从前谁先到、条目
   * 就是谁的形状 —— 先确认的有入口标记，先开跑的永远没有。
   */
  it("兜底路径建的条目也有入口标记", () => {
    const out = tmpOut();
    // 这就是 `ensureEntryConfigForAgentRun` 交的那份 patch：只有一段需求文本。
    expect(writeEntry(out, "e6", { userInput: "单席直跑" }).inputType).toBe("authored");
  });

  it("带上传名单的首次落盘判成改编", () => {
    const out = tmpOut();
    expect(writeEntry(out, "e7", { uploadedFileNames: ["原作.txt"] }).inputType).toBe("adapted");
    expect(writeEntry(out, "e8", { ipRunKey: "2026-09-01_10-00-00-000_书名" }).inputType).toBe(
      "adapted",
    );
  });

  it("调用方给了就用它的，不倒推", () => {
    // 上传名单在场也不改判：调用方是确认那条路径，它知道用户点的是哪个入口。
    const out = tmpOut();
    expect(
      writeEntry(out, "e9", { inputType: "authored", uploadedFileNames: ["参考.txt"] }).inputType,
    ).toBe("authored");
  });

  it("存量条目没写过就继续没写", () => {
    // 事后按当下字段倒推一个标记，是在替一次已经发生的操作编说法。
    const out = tmpOut();
    fs.mkdirSync(path.join(out, "e10"), { recursive: true });
    fs.writeFileSync(path.join(out, "e10", "_entry.json"), JSON.stringify({ userInput: "旧" }), "utf-8");
    expect(writeEntry(out, "e10", { complexity: 3 }).inputType).toBeUndefined();
  });
});

describe("三者并存落盘", () => {
  it("需求文本 + 标签 + 体量同时落，互不挤掉", () => {
    const out = tmpOut();
    const saved = writeEntry(out, "e4", {
      inputType: "authored",
      userInput: "想做个赛博朋克侦探故事",
      tags: { selections: { genre: "悬疑" }, customTexts: { custom: "雨夜" } },
      complexity: 4,
      storyType: "mystery",
      storyTheme: "cyberpunk",
    });
    expect(saved.userInput).toBe("想做个赛博朋克侦探故事");
    expect(saved.tags?.selections?.genre).toBe("悬疑");
    expect(saved.complexity).toBe(4);

    const back = loadEntry(out, "e4")!;
    expect(back.userInput).toBeTruthy();
    expect(back.tags?.selections?.genre).toBe("悬疑");
    expect(back.tags?.customTexts?.custom).toBe("雨夜");
    expect(back.complexity).toBe(4);
  });

  it("先只给标签、后补需求文本，标签不会被后一次写掉", () => {
    // 这是那个数据丢失的原形：UI 从前按当前那一档带字段，切到文本档再保存，
    // tags 带的是 undefined —— writeEntry 的 undefined 不覆盖语义救不了它，因为
    // 丢失发生在更早：UI 压根没把 tags 交出来。这条钉住落盘层的并存语义。
    const out = tmpOut();
    writeEntry(out, "e5", { inputType: "authored", tags: { selections: { mood: "阴郁" } } });
    writeEntry(out, "e5", { userInput: "后补的一段需求" });
    const back = loadEntry(out, "e5")!;
    expect(back.tags?.selections?.mood).toBe("阴郁");
    expect(back.userInput).toBe("后补的一段需求");
  });
});
