/**
 * P2 分层算子注入护栏（§3.2）：
 *   - collectLayeredOperators 按 top/mid/leaf/global 归桶；
 *   - selectOperatorsForStep 按步声明层选池、mid 空回退 top、global 恒注入；
 *   - assessExtractionQuality 统计全层算子覆盖。
 */
import { describe, it, expect } from "vitest";
import {
  collectLayeredOperators,
  selectOperatorsForStep,
  flattenLayeredOperators,
  assessExtractionQuality,
  classifyOperatorDomain,
} from "../phase2-extract.js";
import type { NarrativeIpDna, NarrativeOperator } from "../../types/narrative-ip-dna.js";

function op(uid: string, domain: string): NarrativeOperator {
  return {
    uid,
    name: uid,
    definition: domain,
    adaptation: { type: "", element: "" },
    usage_guide: "",
    example: "",
    knowledge_location: "",
    knowledge_domain: domain,
  };
}

function miniDna(): NarrativeIpDna {
  return {
    schema_version: "1.0.0",
    story_id: "t1",
    title: "测试",
    media_type: "book",
    rootId: "root",
    nodes: {
      root: {
        id: "root",
        levelType: "complete",
        index: 0,
        title: "全书",
        parent: null,
        children: ["ch1", "u1", "u2"],
        operators: [op("top1", "叙事者定位")],
      },
      ch1: {
        id: "ch1",
        levelType: "chapter",
        index: 1,
        title: "第一章",
        parent: "root",
        children: ["u1", "u2"],
        operators: [op("mid1", "文学风格")],
      },
      u1: {
        id: "u1",
        levelType: "unit",
        index: 1,
        title: "第一节",
        parent: "ch1",
        children: [],
        operators: [op("leaf1", "故事内容"), op("glob1", "情感体验")],
        template: {
          worldview: { setting: "", scene_structure: "", item_inventory: "" },
          characters: [],
          story_structure: {
            topology: { nodeCount: 0, startCount: 0, endCount: 0, pivotCount: 0, mergeCount: 0 },
          },
          core_elements: {
            subject: "玄幻",
            theme: "成长",
            core_conflict: "命运",
            literature_style: "冷峻",
            emotion_experience: "燃",
          },
          summary: { characters: [], scene: "", events: "" },
        },
        metadata: { processing_status: "extracted", adaptation_status: "未改编" },
      },
      u2: {
        id: "u2",
        levelType: "unit",
        index: 2,
        title: "第二节",
        parent: "ch1",
        children: [],
        operators: [op("leaf2", "叙事技巧")],
        template: {
          worldview: { setting: "", scene_structure: "", item_inventory: "" },
          characters: [],
          story_structure: {
            topology: { nodeCount: 0, startCount: 0, endCount: 0, pivotCount: 0, mergeCount: 0 },
          },
          core_elements: {
            subject: "",
            theme: "",
            core_conflict: "",
            literature_style: "",
            emotion_experience: "",
          },
          summary: { characters: [], scene: "", events: "" },
        },
        metadata: { processing_status: "extracted", adaptation_status: "未改编" },
      },
    },
  };
}

describe("collectLayeredOperators", () => {
  it("按层级归桶 top/mid/leaf，global 含情感体验类", () => {
    const dna = miniDna();
    const extraTop = [op("extra_top", "叙事者定位")];
    const layers = collectLayeredOperators(dna, ["u1", "u2"], extraTop);
    expect(layers.top.map((o) => o.uid)).toEqual(expect.arrayContaining(["top1", "extra_top"]));
    expect(layers.mid.map((o) => o.uid)).toEqual(["mid1"]);
    expect(layers.leaf.map((o) => o.uid)).toEqual(expect.arrayContaining(["leaf1", "leaf2"]));
    expect(layers.global.some((o) => o.uid === "glob1")).toBe(true);
    expect(flattenLayeredOperators(layers).length).toBeGreaterThanOrEqual(5);
  });

  it("单层输入无中层 → mid 桶空", () => {
    const dna = miniDna();
    // 叶子直接挂 root，无章/部祖先
    dna.nodes.u1.parent = "root";
    dna.nodes.u2.parent = "root";
    const layers = collectLayeredOperators(dna, ["u1", "u2"]);
    expect(layers.mid).toEqual([]);
  });
});

describe("selectOperatorsForStep", () => {
  const layered = collectLayeredOperators(miniDna(), ["u1", "u2"], [op("extra_top", "叙事者定位")]);
  const fallback = flattenLayeredOperators(layered);

  it("顶层步只取 top + global", () => {
    const { pool } = selectOperatorsForStep(layered, ["top"], fallback);
    const uids = pool.map((o) => o.uid);
    expect(uids).toContain("top1");
    expect(uids).toContain("extra_top");
    expect(uids).not.toContain("leaf1");
    expect(uids).not.toContain("mid1");
    expect(uids).toContain("glob1"); // global 恒注入
  });

  it("中层步取 mid；mid 空时回退 top", () => {
    const emptyMid = { ...layered, mid: [] as NarrativeOperator[] };
    const { pool, layerByUid } = selectOperatorsForStep(emptyMid, ["mid"], fallback);
    expect(pool.some((o) => o.uid === "top1")).toBe(true);
    expect(layerByUid.get("top1")).toBe("top");
  });

  it("底层步只取 leaf + global", () => {
    const { pool } = selectOperatorsForStep(layered, ["leaf"], fallback);
    const uids = pool.map((o) => o.uid);
    expect(uids).toContain("leaf1");
    expect(uids).toContain("leaf2");
    expect(uids).not.toContain("mid1");
  });

  it("无分层桶时回退整池", () => {
    const { pool } = selectOperatorsForStep(undefined, ["top"], fallback);
    expect(pool).toEqual(fallback);
  });
});

describe("assessExtractionQuality 全层覆盖", () => {
  it("统计 top+mid+leaf 算子，叙事者定位/文学风格可被计入", () => {
    const dna = miniDna();
    const q = assessExtractionQuality(dna, ["u1", "u2"]);
    const domains = new Set(
      flattenLayeredOperators(collectLayeredOperators(dna, ["u1", "u2"])).map((o) =>
        classifyOperatorDomain(o),
      ),
    );
    expect(domains.has("叙事者定位")).toBe(true);
    expect(domains.has("文学风格")).toBe(true);
    expect(q.checks.find((c) => c.name === "算子分类覆盖")?.detail).toMatch(/覆盖 4\/5|覆盖 5\/5/);
  });
});
