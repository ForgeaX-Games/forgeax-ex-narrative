/**
 * graph-qa.test.ts
 * ─────────────────────────────────────────────────────────────────
 * 验证「算法层」质量门的确定性修复（不触发 LLM）：
 *   - 孤儿非结局节点（无前驱）→ 按 orderOf 重接到紧邻可达前驱（图1 根因）
 *   - 死胡同非结局节点（无后继）→ 接到令牌最近的结局（图2 根因）
 *   - 孤儿结局 → 由死胡同/可达叶子补源
 *   - 干净图 → no-op（semantic 为空）
 *   - 语义修复被正确区分上报（纯去重/删悬空不计语义）
 */
import { describe, it, expect } from "vitest";
import { validateGraph, repairGraph, type QaGraph } from "../graph-qa.js";

/** VN 风格叙事序：「场.序」→ 场*10000+序；非数字 id 视为末端。 */
function beatOrder(id: string): number {
  const m = /^(\d+)\.(\d+)/.exec(id);
  return m ? Number(m[1]) * 10000 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
}

describe("validateGraph — 检测前驱/后继异常", () => {
  it("检出孤儿（无前驱非根）与死胡同（无后继非结局）", () => {
    const g: QaGraph = {
      rootId: "1.1",
      nodes: [
        { id: "1.1", next: ["1.2"] },
        { id: "1.2", next: [] }, // 死胡同
        { id: "2.1", next: ["E_H"] }, // 孤儿（无人指向）
        { id: "E_H", next: [], isEnding: true, tokens: ["H"] },
      ],
    };
    const issues = validateGraph(g, { roots: ["1.1"] });
    const kinds = issues.map((i) => i.kind).sort();
    expect(kinds).toContain("dead_end");
    expect(kinds).toContain("orphan_node");
  });
});

describe("repairGraph — 孤儿重接（图1）", () => {
  it("无前驱的 beat 按 orderOf 重接到紧邻可达前驱", () => {
    const g: QaGraph = {
      rootId: "1.1",
      nodes: [
        { id: "1.1", next: ["1.2"] },
        { id: "1.2", next: ["E_H"] },
        { id: "2.1", next: ["E_H"] }, // 孤儿：序在 1.2 之后，应接到 1.2
        { id: "E_H", next: [], isEnding: true, tokens: ["H"] },
      ],
    };
    const { semantic } = repairGraph(g, { roots: new Set(["1.1"]), orderOf: beatOrder });
    const n12 = g.nodes.find((n) => n.id === "1.2")!;
    expect(n12.next).toContain("2.1"); // 1.2 → 2.1 补回来路
    expect(semantic.some((s) => s.includes("孤儿重接"))).toBe(true);
    // 修复后无 error 残留
    const residual = validateGraph(g, { roots: ["1.1"] }).filter((i) => i.severity === "error");
    expect(residual).toHaveLength(0);
  });

  it("链式孤儿（孤儿指向孤儿）能被反复重接直至全可达", () => {
    const g: QaGraph = {
      rootId: "1.1",
      nodes: [
        { id: "1.1", next: ["E_H"] },
        { id: "2.1", next: ["2.2"] }, // 孤儿
        { id: "2.2", next: ["E_B"] }, // 仅被 2.1 指向，2.1 是孤儿 → 一旦 2.1 接回即可达
        { id: "E_H", next: [], isEnding: true, tokens: ["H"] },
        { id: "E_B", next: [], isEnding: true, tokens: ["B"] },
      ],
    };
    repairGraph(g, { roots: new Set(["1.1"]), orderOf: beatOrder });
    const residual = validateGraph(g, { roots: ["1.1"] }).filter((i) => i.severity === "error");
    expect(residual).toHaveLength(0);
  });
});

describe("repairGraph — 死胡同接结局（图2）", () => {
  it("非结局无后继 → 接到令牌最近的结局", () => {
    const g: QaGraph = {
      rootId: "1.1",
      nodes: [
        { id: "1.1", next: ["1.2"] },
        { id: "1.2", next: [] }, // 死胡同
        { id: "E_H", next: [], isEnding: true, tokens: ["H"] },
      ],
    };
    const { semantic } = repairGraph(g, { roots: new Set(["1.1"]), orderOf: beatOrder });
    const n12 = g.nodes.find((n) => n.id === "1.2")!;
    expect(n12.next.length).toBeGreaterThan(0);
    expect(semantic.length).toBeGreaterThan(0);
  });
});

describe("repairGraph — 干净图 no-op", () => {
  it("合法图无 error、repairGraph 不产语义修复", () => {
    const g: QaGraph = {
      rootId: "1.1",
      nodes: [
        { id: "1.1", next: ["1.2"] },
        { id: "1.2", next: ["E_H", "E_B"] },
        { id: "E_H", next: [], isEnding: true, tokens: ["H"] },
        { id: "E_B", next: [], isEnding: true, tokens: ["B"] },
      ],
    };
    const errorsBefore = validateGraph(g, { roots: ["1.1"] }).filter((i) => i.severity === "error");
    expect(errorsBefore).toHaveLength(0);
    const { semantic } = repairGraph(g, { roots: new Set(["1.1"]), orderOf: beatOrder });
    expect(semantic).toHaveLength(0);
  });
});

describe("repairGraph — 去重/删悬空不计语义", () => {
  it("仅去重与删悬空边时 semantic 为空", () => {
    const g: QaGraph = {
      rootId: "1.1",
      nodes: [
        { id: "1.1", next: ["1.2", "1.2", "ghost"] }, // 重复 + 悬空
        { id: "1.2", next: ["E_H"] },
        { id: "E_H", next: [], isEnding: true, tokens: ["H"] },
      ],
    };
    const { repairs, semantic } = repairGraph(g, { roots: new Set(["1.1"]), orderOf: beatOrder });
    expect(repairs.some((r) => r.includes("去重"))).toBe(true);
    expect(repairs.some((r) => r.includes("悬空"))).toBe(true);
    expect(semantic).toHaveLength(0);
    const n11 = g.nodes.find((n) => n.id === "1.1")!;
    expect(n11.next).toEqual(["1.2"]);
  });
});
