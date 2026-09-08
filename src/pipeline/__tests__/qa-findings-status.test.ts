import { describe, it, expect } from "vitest";
import { mergeFindingStatuses, type QaFinding } from "../qa/findings.js";

/**
 * 键权层方案 M3：报告整份重算后，已处置（fixed/dismissed）的 finding 不该在复检里
 * "复活"成待处理。见 `qa/findings.ts` 里 `mergeFindingStatuses` 的文档注释。
 */

function finding(id: string, overrides: Partial<QaFinding> = {}): QaFinding {
  return {
    id,
    criterion: "c",
    nodeId: "n1",
    severity: "warn",
    issue: "issue",
    excerpt: "excerpt",
    suggestion: "suggestion",
    ...overrides,
  };
}

describe("mergeFindingStatuses", () => {
  it("同 id 且旧状态已处置：新条目继承旧的 status/fixedInVersion/lastError", () => {
    const old = [finding("a", { status: "fixed", fixedInVersion: 3 })];
    const next = [finding("a")];
    const merged = mergeFindingStatuses(old, next);
    expect(merged[0]).toMatchObject({ id: "a", status: "fixed", fixedInVersion: 3 });
  });

  it("同 id 且旧状态是 dismissed：同样继承", () => {
    const old = [finding("a", { status: "dismissed" })];
    const merged = mergeFindingStatuses(old, [finding("a")]);
    expect(merged[0].status).toBe("dismissed");
  });

  it("旧状态是 open（或缺省）：不覆盖新条目（新条目保持调用方给的缺省）", () => {
    const old = [finding("a", { status: "open" })];
    const merged = mergeFindingStatuses(old, [finding("a")]);
    expect(merged[0].status).toBeUndefined();
  });

  it("旧报告没有这个 id（全新问题）：保持新条目原样", () => {
    const merged = mergeFindingStatuses([finding("old-only", { status: "fixed" })], [finding("brand-new")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBeUndefined();
  });

  it("旧 id 在新报告里不再出现（问题真的解决了）：不会被凭空加回去", () => {
    const merged = mergeFindingStatuses([finding("gone", { status: "fixed" })], [finding("still-here")]);
    expect(merged.map((f) => f.id)).toEqual(["still-here"]);
  });

  it("空旧报告：新报告原样返回", () => {
    const next = [finding("a"), finding("b")];
    expect(mergeFindingStatuses([], next)).toEqual(next);
  });
});
