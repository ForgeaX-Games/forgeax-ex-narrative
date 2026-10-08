/**
 * 内联 composer 的段序契约。
 *
 * 骨架（prompt/skeleton.ts）定的是提示词八段的次序，但那份契约此前只管模板路径；
 * 各 step 内联的 `PromptComposer` 块名自起、顺序自定，没人能说清 `craft` 该排在
 * `constraints` 前还是后。`prompt/block-slots.ts` 把块名归到槽之后，这里把契约
 * 机械化：段序错了、块名没登记、登记了却没人用，三种漂移都当场失败。
 */
import { describe, it, expect } from "vitest";
import "../core/step-registrations.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import { BLOCK_SLOT, findOrderViolation, slotOfBlock } from "../prompt/block-slots.js";

function composers(): Array<[string, NonNullable<ReturnType<typeof composerOf>>]> {
  const out: Array<[string, NonNullable<ReturnType<typeof composerOf>>]> = [];
  for (const [id] of STEP_REGISTRY) {
    const c = composerOf(id);
    if (c) out.push([id, c]);
  }
  return out;
}

function composerOf(stepId: string) {
  return STEP_REGISTRY.get(stepId)?.composer ?? null;
}

describe("提示词块名与骨架槽", () => {
  it("有 composer 的 step 不止一两个（否则下面的遍历等于没跑）", () => {
    expect(composers().length).toBeGreaterThanOrEqual(15);
  });

  it("每个块名都登记了所属槽", () => {
    const unknown: string[] = [];
    for (const [id, c] of composers()) {
      for (const name of Object.keys(c.blocks)) {
        if (!slotOfBlock(name)) unknown.push(`${id}.${name}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("登记表里没有无人使用的块名", () => {
    // 表与代码两边都得对得上：只删代码不删表，表会慢慢退化成历史块名的坟场。
    const used = new Set<string>();
    for (const [, c] of composers()) for (const n of Object.keys(c.blocks)) used.add(n);
    expect(Object.keys(BLOCK_SLOT).filter((n) => !used.has(n))).toEqual([]);
  });

  it("system 段序与骨架同向", () => {
    const bad: string[] = [];
    for (const [id, c] of composers()) {
      const v = findOrderViolation(c.systemBlockOrder);
      if (v) bad.push(`${id}: ${v.block} 排在 ${v.after} 之后`);
    }
    expect(bad).toEqual([]);
  });

  it("user 侧把用户追加的要求压在最后", () => {
    // user 一侧的次序与 system 相反（先材料后指令），所以只校验这一条：
    // 用户临时说的话必须离输出最近，不能被别的段盖过去。
    const bad: string[] = [];
    for (const [id, c] of composers()) {
      const at = c.userBlockOrder.indexOf("user_instructions");
      if (at >= 0 && at !== c.userBlockOrder.length - 1) bad.push(id);
    }
    expect(bad).toEqual([]);
  });
});
