import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  assessVolume,
  planDecomposition,
  guessLevelsFromHierarchy,
  buildLightHierarchy,
  DECOMPOSE_THRESHOLD,
} from "../phase1-understanding.js";
import { saveManifest, loadManifest, extractionOutputDir } from "../filesystem.js";
import type { UserAssetManifest } from "../../types/narrative-ip-dna.js";

/**
 * 批4 输入理解对齐：多维体量水准线 + 拆解闭环 + guessed_levels + manifest 落盘/状态更新。
 */
describe("batch4: 多维体量水准线 assessVolume", () => {
  it("小说低于水准线（单元少/字数少）→ 不拆解", () => {
    const v = assessVolume("短篇正文", { mediaType: "book", unitCount: 10 });
    expect(v.needsDecompose).toBe(false);
    expect(v.thresholdBasis).toContain("小说水准线");
  });

  it("小说超线（单元>25 且 字数>25k）→ 需拆解", () => {
    const text = "字".repeat(26_000);
    const v = assessVolume(text, { mediaType: "book", unitCount: 30 });
    expect(v.needsDecompose).toBe(true);
    expect(v.thresholdBasis).toContain("小说水准线");
  });

  it("小说单元多但字数不足 → 不拆解（双维度都要满足）", () => {
    const v = assessVolume("短", { mediaType: "book", unitCount: 30 });
    expect(v.needsDecompose).toBe(false);
  });

  it("视频超 5h → 需拆解", () => {
    const v = assessVolume("视频转写", { mediaType: "video", durationSec: 6 * 3600 });
    expect(v.needsDecompose).toBe(true);
    expect(v.thresholdBasis).toContain("视频水准线");
  });

  it("未知媒体回退字数兜底线（>80k）", () => {
    const v = assessVolume("字".repeat(DECOMPOSE_THRESHOLD + 100));
    expect(v.needsDecompose).toBe(true);
    expect(v.thresholdBasis).toContain("字数兜底水准线");
  });
});

describe("batch4: 拆解闭环 planDecomposition", () => {
  const bigMarkered = "第一章 起\n".concat("字".repeat(DECOMPOSE_THRESHOLD), "\n第二章 承\n", "文".repeat(10));
  const volume = assessVolume(bigMarkered);

  it("默认不开启 → 不拆，整篇单块", () => {
    const plan = planDecomposition(bigMarkered, volume, false);
    expect(plan.decomposed).toBe(false);
    expect(plan.chunks.length).toBe(1);
    expect(plan.chunks[0].title).toBe("整篇");
  });

  it("开启且超线 → 按标记边界拆出多块", () => {
    expect(volume.needsDecompose).toBe(true);
    const plan = planDecomposition(bigMarkered, volume, true);
    expect(plan.decomposed).toBe(true);
    expect(plan.chunks.length).toBeGreaterThan(1);
  });

  it("开启但未超线 → 仍不拆", () => {
    const small = "第一章 A\naaa\n第二章 B\nbbb\n";
    const plan = planDecomposition(small, assessVolume(small), true);
    expect(plan.decomposed).toBe(false);
  });
});

describe("batch4: guessLevelsFromHierarchy", () => {
  it("从层级树推断 part→chapter→unit（去重排序，排除根）", () => {
    const text = "# 卷一\n## 章一\n### 节一\n### 节二\n## 章二\n### 节三\n";
    const dna = buildLightHierarchy({ story_timestamp: "t", title: "T", media_type: "book", text });
    const levels = guessLevelsFromHierarchy(dna);
    expect(levels).toContain("unit");
    expect(levels).not.toContain("complete");
    const depthOk = levels.indexOf("part") < levels.indexOf("chapter");
    if (levels.includes("part") && levels.includes("chapter")) expect(depthOk).toBe(true);
  });
});

describe("batch4: manifest 落盘与状态更新", () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-b4-"));
  afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

  function makeManifest(): UserAssetManifest {
    return {
      story_id: "20260101_0900",
      title: "落盘清单",
      media_type: "book",
      modality: ["text"],
      side: "story",
      source_files: [{ path: "a.txt", file_type: "txt", size: 10 }],
      preliminary_structure: { guessed_levels: [], is_multipart: false, is_short: true },
      processing_status: "archived",
      created_at: new Date().toISOString(),
    };
  }

  it("saveManifest → loadManifest 往返一致", () => {
    const m = makeManifest();
    saveManifest(m, { cwd: TMP });
    const loaded = loadManifest("20260101_0900", "落盘清单", { cwd: TMP });
    expect(loaded?.story_id).toBe("20260101_0900");
    expect(loaded?.processing_status).toBe("archived");
  });

  it("覆盖写入：状态推进到 extracted + guessed_levels 更新", () => {
    const m = makeManifest();
    saveManifest(m, { cwd: TMP });
    m.processing_status = "extracted";
    m.preliminary_structure!.guessed_levels = ["chapter", "unit"];
    saveManifest(m, { cwd: TMP });
    const loaded = loadManifest("20260101_0900", "落盘清单", { cwd: TMP });
    expect(loaded?.processing_status).toBe("extracted");
    expect(loaded?.preliminary_structure?.guessed_levels).toEqual(["chapter", "unit"]);
  });

  it("落盘到主媒体 extraction_output 约定路径（媒体优先 §6.1）", () => {
    const m = makeManifest();
    saveManifest(m, { cwd: TMP });
    const expected = path.join(extractionOutputDir(m.story_id, m.title, m.media_type, { cwd: TMP }), "user_asset_manifest.json");
    expect(fs.existsSync(expected)).toBe(true);
    // 媒体优先：book 落 book/story_book/book_extraction_output。
    expect(expected.replace(/\\/g, "/")).toContain("book/story_book/book_extraction_output");
  });
});
