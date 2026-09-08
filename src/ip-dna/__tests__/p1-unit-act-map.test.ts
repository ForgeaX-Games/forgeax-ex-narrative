/**
 * P1-1 回归护栏（章→幕锚定 + 幕内密度展开）：
 *   - resolveVnActCount(unitCount)：开放幕数 = 源单元数（clamp [2, MAX_OPEN_ACTS]）；无 unitCount 回退旧派生。
 *   - buildUnitActMap：单元数 ≤ 上限 1:1 锚定；超上限按序分桶且不丢任何源单元 id。
 * 纯函数确定性断言。
 */
import { describe, it, expect } from "vitest";
import { resolveVnActCount, buildUnitActMap, MAX_OPEN_ACTS } from "../phase2c-gen-adapt.js";

describe("P1-1 resolveVnActCount 开放幕数=单元数", () => {
  it("给定 unitCount → 幕数=单元数（clamp 上限）", () => {
    expect(resolveVnActCount(25, 10)).toBe(10);
    expect(resolveVnActCount(25, 3)).toBe(3);
    expect(resolveVnActCount(25, 100)).toBe(MAX_OPEN_ACTS); // 超上限夹取
    expect(resolveVnActCount(25, 1)).toBe(2); // 下限 2
  });
  it("无 unitCount → 回退按目标节点数派生（旧行为不变）", () => {
    expect(resolveVnActCount(45)).toBe(5);
    expect(resolveVnActCount(25)).toBe(3);
  });
});

describe("P1-1 buildUnitActMap 章→幕锚定", () => {
  const mkUnits = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `u${i + 1}`,
      title: `第${i + 1}章`,
      summary: `事件${i + 1}`,
      characters: [`角色${i + 1}`],
      scene: `场景${i + 1}`,
    }));

  it("单元数 ≤ 上限：1 源单元 = 1 幕（忠实章边界），每幕锚定一个源单元", () => {
    const map = buildUnitActMap(mkUnits(4));
    expect(map.acts.length).toBe(4);
    expect(map.acts.map((a) => a.actId)).toEqual(["一", "二", "三", "四"]);
    expect(map.acts.every((a) => a.sourceUnitIds.length === 1)).toBe(true);
    expect(map.acts[0].summary).toBe("事件1");
  });

  it("单元数 > 上限：分桶到上限个幕，且不丢任何源单元", () => {
    const n = 25;
    const map = buildUnitActMap(mkUnits(n));
    expect(map.acts.length).toBe(MAX_OPEN_ACTS);
    const covered = map.acts.flatMap((a) => a.sourceUnitIds);
    expect(covered.length).toBe(n); // 覆盖全部、无丢失
    expect(new Set(covered).size).toBe(n); // 无重复
  });

  it("空单元 → 空 acts（安全）", () => {
    expect(buildUnitActMap([]).acts.length).toBe(0);
  });
});
