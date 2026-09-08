import { describe, it, expect } from "vitest";
import { pickIpGenRunOutcome } from "../server.js";
import type { NarrativeContext } from "../../types/index.js";

type GameUnits = Parameters<typeof pickIpGenRunOutcome>[0];

function unit(index: number, userInput?: string, outputDir?: string): GameUnits[number] {
  const generated = userInput != null ? ({ user_input: userInput } as Partial<NarrativeContext>) : undefined;
  return { index, generated, outputDir } as unknown as GameUnits[number];
}

describe("pickIpGenRunOutcome（C1：ipgen run 完成收尾）", () => {
  it("多单元：result = 末个已生成单元的 generated，outputDir = 首个有值单元", () => {
    const units = [unit(1, "u1", "/out/run"), unit(2, "u2", "/out/run")] as unknown as GameUnits;
    const o = pickIpGenRunOutcome(units);
    expect((o.result as NarrativeContext).user_input).toBe("u2");
    expect(o.outputDir).toBe("/out/run");
  });

  it("maxGameUnits 截断致末单元未生成：回退到最后一个真正 generated 的单元", () => {
    const units = [unit(1, "u1", "/out/run"), unit(2)] as unknown as GameUnits;
    const o = pickIpGenRunOutcome(units);
    expect((o.result as NarrativeContext).user_input).toBe("u1");
    expect(o.outputDir).toBe("/out/run");
  });

  it("全未生成：result 与 outputDir 均为 undefined（不误报也不乱填）", () => {
    const units = [unit(1), unit(2)] as unknown as GameUnits;
    const o = pickIpGenRunOutcome(units);
    expect(o.result).toBeUndefined();
    expect(o.outputDir).toBeUndefined();
  });
});
