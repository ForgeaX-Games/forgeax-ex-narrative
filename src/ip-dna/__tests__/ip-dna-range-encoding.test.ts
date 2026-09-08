import { describe, it, expect } from "vitest";
import {
  buildLightHierarchy,
  collectLeafIds,
  countOversizedUnits,
  assessVolume,
  MAX_UNIT_CHARS,
} from "../phase1-understanding.js";
import { cropByScope } from "../phase2b-adapt.js";
import { decodeArchiveName } from "../phase0-compress.js";

const TS = "20260101_0000";

describe("超大叶子检测 vs 整部体量（点 1：70 章小说不该误判超大文件）", () => {
  it("多章小说：整部体量超线(needsDecompose) 但无单个超大叶子(oversizedUnitCount=0)", () => {
    // 30 章、每章约 1000 字 → 整部 3 万字 + 30 单元（超小说水准线），但每章远小于 MAX_UNIT_CHARS。
    const text = Array.from({ length: 30 }, (_, i) => `第${i + 1}章\n${"情节内容。".repeat(200)}`).join("\n");
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "多章长篇", media_type: "book", text });
    expect(collectLeafIds(dna).length).toBeGreaterThan(25);
    const vol = assessVolume(text, { mediaType: "book", unitCount: collectLeafIds(dna).length });
    expect(vol.needsDecompose).toBe(true); // 整部够大 → 系列化判断
    expect(countOversizedUnits(dna)).toBe(0); // 但没有任何超大叶子 → 不该弹"再标准化"
  });

  it("无标记巨型散文：整篇成单叶且超 MAX_UNIT_CHARS → oversizedUnitCount>0", () => {
    const huge = "无标记长文。".repeat(MAX_UNIT_CHARS); // 单叶远超上限
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "巨", media_type: "book", text: huge });
    expect(collectLeafIds(dna).length).toBe(1);
    expect(countOversizedUnits(dna)).toBeGreaterThan(0);
  });
});

describe("cropByScope: leafRange 闭区间裁剪（每部=一个区间）", () => {
  const dna = buildLightHierarchy({
    story_timestamp: TS,
    title: "区间",
    media_type: "book",
    text: "第一章\n甲。\n第二章\n乙。\n第三章\n丙。\n第四章\n丁。",
  });
  const leaves = collectLeafIds(dna);

  it("取文档序 [start,end] 内的全部叶子", () => {
    expect(leaves.length).toBeGreaterThanOrEqual(3);
    const cropped = cropByScope(dna, {
      full: false,
      selections: [{ leafRange: { start: leaves[0], end: leaves[1] } }],
    });
    expect(cropped.map((n) => n.id)).toEqual([leaves[0], leaves[1]]);
  });

  it("起点在终点之后 → 自动按文档序取小到大（用户误选容错）", () => {
    const cropped = cropByScope(dna, {
      full: false,
      selections: [{ leafRange: { start: leaves[2], end: leaves[0] } }],
    });
    expect(cropped.map((n) => n.id)).toEqual([leaves[0], leaves[1], leaves[2]]);
  });

  it("多部区间并集（系列）→ 各部叶子合并保序", () => {
    const cropped = cropByScope(dna, {
      full: false,
      selections: [
        { leafRange: { start: leaves[0], end: leaves[0] } },
        { leafRange: { start: leaves[2], end: leaves[3] } },
      ],
    });
    expect(cropped.map((n) => n.id)).toEqual([leaves[0], leaves[2], leaves[3]]);
  });
});

describe("decodeArchiveName: 压缩包内中文文件名解码（GBK 兜底）", () => {
  it("EFS/UTF-8 标志位 → 直接 UTF-8 解码", () => {
    const bytes = Buffer.from("第一卷.txt", "utf-8");
    expect(decodeArchiveName(bytes, true)).toBe("第一卷.txt");
  });

  it("无标志位但本身是合法 UTF-8 → 仍正确解码", () => {
    const bytes = Buffer.from("第一卷.txt", "utf-8");
    expect(decodeArchiveName(bytes, false)).toBe("第一卷.txt");
  });

  it("无标志位的 GBK 字节 → 回退 gb18030 解出中文（不再乱码）", () => {
    // "中文" 的 GBK 编码字节：D6 D0 CE C4
    const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeArchiveName(gbkBytes, false)).toBe("中文");
  });
});
