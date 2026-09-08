import { describe, it, expect } from "vitest";

import {
  chineseToArabic,
  extractChapterNumber,
  extractEpisodeNumber,
  extractComicUnitNumber,
  extractUnitNumber,
  extractCleanTitle,
  dedupeByNumber,
} from "../unit-identity.js";
import {
  buildHierarchyFromSegments,
  buildLightHierarchy,
  segmentsFromTexts,
  collectLeafIds,
} from "../phase1-understanding.js";

const TS = "2026-07-01_120000";

describe("unit-identity · 中文数字转换", () => {
  it("简繁体 + 单位 + 位值", () => {
    expect(chineseToArabic("一")).toBe(1);
    expect(chineseToArabic("十")).toBe(10);
    expect(chineseToArabic("七十一")).toBe(71);
    expect(chineseToArabic("一千二百六十四")).toBe(1264);
    expect(chineseToArabic("一百零一")).toBe(101);
    expect(chineseToArabic("三零四")).toBe(304); // 位值
    expect(chineseToArabic("壹仟貳佰陸拾肆")).toBe(1264); // 繁体
  });
});

describe("unit-identity · 序号提取（文字）", () => {
  it("第X章 阿拉伯 / 中文", () => {
    expect(extractChapterNumber("第八章_一场戏")).toBe(8);
    expect(extractChapterNumber("第八百八十八章_收取凶魂")).toBe(888);
    expect(extractChapterNumber("第一章_山边小村")).toBe(1);
    expect(extractChapterNumber("Chapter 5 Title")).toBe(5);
    expect(extractChapterNumber("001 惊蛰")).toBe(1);
    expect(extractChapterNumber('第二十八章_强化"吸掌"')).toBe(28);
  });
  it("无法识别 → undefined", () => {
    expect(extractChapterNumber("完结感言")).toBeUndefined();
    expect(extractChapterNumber("人物志")).toBeUndefined();
    expect(extractChapterNumber("2号更新完毕")).toBeUndefined();
  });
});

describe("unit-identity · 序号提取（视频/图片）", () => {
  it("视频集号", () => {
    expect(extractEpisodeNumber("S01E03.mp4")).toBe(3);
    expect(extractEpisodeNumber("第12集.mp4")).toBe(12);
    expect(extractEpisodeNumber("Episode_07")).toBe(7);
    expect(extractEpisodeNumber("Ep05")).toBe(5);
    expect(extractEpisodeNumber("08_大结局.mp4")).toBe(8);
  });
  it("图片话/页号", () => {
    expect(extractComicUnitNumber("第03话_封面")).toBe(3);
    expect(extractComicUnitNumber("page_07.png")).toBe(7);
    expect(extractComicUnitNumber("ch12_p05")).toBe(12); // 章号优先于页码
    expect(extractComicUnitNumber("无号插画_05")).toBe(5); // 无话/章 → 末尾数字作页
  });
  it("按媒体分派", () => {
    expect(extractUnitNumber("第八章_一场戏", "book")).toBe(8);
    expect(extractUnitNumber("第12集.mp4", "video")).toBe(12);
    expect(extractUnitNumber("第03话.jpg", "picture")).toBe(3);
  });
});

describe("unit-identity · 干净标题 + 去重", () => {
  it("去序号前缀保留标题", () => {
    expect(extractCleanTitle("第八章_一场戏")).toBe("一场戏");
    expect(extractCleanTitle("S01E03 觉醒")).toBe("觉醒");
    expect(extractCleanTitle("Chapter 5 Title")).toBe("Title");
  });
  it("同号去重保留末次", () => {
    const items = [
      { id: "a", n: 8 },
      { id: "b", n: 8 },
      { id: "c", n: 9 },
      { id: "d", n: undefined as number | undefined },
    ];
    const { kept, dropped } = dedupeByNumber(items, (x) => x.n);
    expect(kept.map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(dropped.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("unit-identity · 接入建树（真实序号 + 去重）", () => {
  it('乱序上传的"第八章"按真实号定名 8_《第八章_一场戏》', () => {
    const items = [
      { path: "第八章_一场戏.txt", text: "八。".repeat(40) },
      { path: "第三章_序幕.txt", text: "三。".repeat(40) },
    ];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "作", media_type: "book" }, segments);
    const byTitle = Object.values(dna.nodes);
    const eight = byTitle.find((n) => n.title === "第八章_一场戏");
    const three = byTitle.find((n) => n.title === "第三章_序幕");
    expect(eight?.index).toBe(8);
    expect(eight?.displayName).toBe("8_《第八章_一场戏》");
    expect(three?.index).toBe(3);
    // collectLeafIds 按 index 排序 → 第三章在前、第八章在后（无视上传顺序）。
    const leaves = collectLeafIds(dna).map((id) => dna.nodes[id].title);
    expect(leaves).toEqual(["第三章_序幕", "第八章_一场戏"]);
  });

  it("复制进来的同号章节被去重（保留末次）", () => {
    const items = [
      { path: "第一章_旧稿.txt", text: "旧。".repeat(40) },
      { path: "第一章_新稿.txt", text: "新。".repeat(40) },
      { path: "第二章.txt", text: "二。".repeat(40) },
    ];
    const { segments } = segmentsFromTexts(items);
    const dna = buildHierarchyFromSegments({ story_timestamp: TS, title: "去重作", media_type: "book" }, segments);
    const leaves = collectLeafIds(dna).map((id) => dna.nodes[id]);
    // 第一章仅保留末次（新稿），第二章保留 → 共 2 个叶子。
    expect(leaves.length).toBe(2);
    expect(leaves.some((n) => n.title === "第一章_旧稿")).toBe(false);
    expect(leaves.some((n) => n.title === "第一章_新稿")).toBe(true);
  });

  it("扫标记路径也用真实章号（buildLightHierarchy）", () => {
    const text = ["# 第八章 一场戏", "戏。".repeat(10), "# 第三章 序幕", "幕。".repeat(10)].join("\n");
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "标记作", media_type: "book", text });
    const eight = Object.values(dna.nodes).find((n) => n.title === "第八章 一场戏");
    expect(eight?.index).toBe(8);
    expect(eight?.displayName).toBe("8_《第八章 一场戏》");
  });
});
