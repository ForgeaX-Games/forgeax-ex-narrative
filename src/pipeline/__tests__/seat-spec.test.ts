import { describe, it, expect } from "vitest";
import {
  ALWAYS_GENERIC_SLOTS,
  assertSeatSpecComplete,
  executableStructureFor,
  getSeatSpec,
  SEAT_SPECS,
  SHAPE_DIVERGENCES,
  SHAPE_PROTOTYPE,
  PROTOTYPE_PRIMITIVE,
  seatStrategySlots,
} from "../routing/seat-spec.js";
import { ASSISTANT_SEATS } from "../routing/assistant-seats.js";
import { PROMPT_SLOT_ORDER } from "../prompt/skeleton.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import "../core/step-registrations.js";

/**
 * 席位名在两份事实源里的已知差异。
 *
 * 比对用 id 而不是 name：CSV 是人写的表格，名字带「工」「（吃书）」这类修饰，
 * 与代码里的展示名不必逐字相同。但差异要登记——否则某天有人把 storyboard 改成
 * 别的产品职责，只改了 name 也不会有人发现。
 */
const KNOWN_NAME_ALIASES: Readonly<Record<string, string>> = {
  content_check: "内容检查助手",
  deai: "去 AI 味助手",
};

describe("seat spec（agent 配置表入码）", () => {
  it("表格自洽（形态映射集中、非原子席必有落差登记）", () => {
    expect(() => assertSeatSpecComplete()).not.toThrow();
  });

  it("与 assistant-seats 的 20 席一一对应", () => {
    const specIds = [...SEAT_SPECS.map((s) => s.seatId)].sort();
    const seatIds = [...ASSISTANT_SEATS.map((s) => s.id)].sort();
    expect(specIds).toEqual(seatIds);
  });

  it("席位名与代码展示名一致，不一致的都已登记", () => {
    const seatNames = new Map(ASSISTANT_SEATS.map((s) => [s.id, s.name]));
    const unlisted = SEAT_SPECS.filter((spec) => {
      const codeName = seatNames.get(spec.seatId);
      if (codeName === spec.csvName) return false;
      return KNOWN_NAME_ALIASES[spec.seatId] !== codeName;
    }).map((spec) => `${spec.seatId}: CSV「${spec.csvName}」≠ 代码「${seatNames.get(spec.seatId)}」`);
    expect(unlisted, "出现未登记的席位名差异").toEqual([]);

    // 反向：登记了却已对齐的别名该清理
    const stale = Object.keys(KNOWN_NAME_ALIASES).filter(
      (id) => getSeatSpec(id)?.csvName === seatNames.get(id),
    );
    expect(stale, "别名登记已失效，请清理").toEqual([]);
  });

  it("四原型齐全：表里确实出现了原子/串行/并行/嵌套四类", () => {
    const used = new Set(SEAT_SPECS.map((s) => s.prototype));
    expect([...used].sort()).toEqual(["atomic", "nested", "parallel", "serial"]);
  });

  it("形态判读只有一处：每席 prototype 都由 csvShape 推出", () => {
    for (const spec of SEAT_SPECS) {
      expect(spec.prototype, spec.seatId).toBe(SHAPE_PROTOTYPE[spec.csvShape]);
    }
  });

  /**
   * 尚未对齐声明形态的席位名册（人工台账）。
   *
   * 这份名单必须手写：一席"实际按什么原语跑"是实现事实，代码里推不出来，
   * 推得出来它就不是台账了。迁移到位的席位从这里与 SHAPE_DIVERGENCES 一并删除
   * —— 两边都删才算迁完，只删一边测试会红。
   *
   * 已对齐并移出名册的：quest（分片参数上移 ChunkedConfig，按 chunked 原语跑）；
   * outline（C1：唯一实现 story_framework 已显式登记 RUNNER_MIGRATIONS.sequence，
   * 原第二实现 vn_outline_acts 随 vn-v2 一并封存后本席已无落差主体）；
   * storyboard（C2：唯一实现 script_generation 已显式登记 RUNNER_MIGRATIONS.wave，
   * 原第二实现 cinematic_storyboard 随 vn-v1 一并封存后本席已无落差主体）；
   * plot（C3：唯一实现 plot_generation 已显式登记 RUNNER_MIGRATIONS.wave，
   * 原另两个实现 emergent_event / event_pool 随四个品类特化能力于 C3 一并
   * 封存后本席已无落差主体）。
   */
  const STILL_DIVERGING = [
    "character", "item", "scene_list", "structure",
  ];

  it("落差登记与未对齐名册逐字对齐（两边都删才算迁完）", () => {
    const registered = [...SHAPE_DIVERGENCES.map((d) => d.seatId)].sort();
    expect(registered).toEqual([...STILL_DIVERGING].sort());
  });

  it("未登记落差的非原子席，其可执行原语就是声明形态对应的原语", () => {
    const aligned = SEAT_SPECS.filter(
      (s) => s.prototype !== "atomic" && !STILL_DIVERGING.includes(s.seatId),
    );
    // 空数组会让这条断言无声通过，故先确认名册之外真有已对齐的非原子席。
    expect(aligned.length).toBeGreaterThan(0);
    for (const spec of aligned) {
      expect(executableStructureFor(spec.seatId), spec.seatId).toBe(
        PROTOTYPE_PRIMITIVE[spec.prototype],
      );
    }
  });

  it("可执行原语落在真实的 structure 类型上", () => {
    const runnable = new Set([
      "single-turn",
      "chunked",
      "sequence",
      "conditional",
      "deterministic",
      "composite",
    ]);
    for (const spec of SEAT_SPECS) {
      expect(runnable.has(executableStructureFor(spec.seatId)), spec.seatId).toBe(true);
    }
  });

  it("四轴全可插拔的只有需求清单/策划文档/故事大纲/故事结构", () => {
    const allFour = SEAT_SPECS.filter(
      (s) => seatStrategySlots(s.seatId).length === 4,
    ).map((s) => s.seatId);
    expect(allFour.sort()).toEqual(["design_doc", "outline", "req_list", "structure"].sort());
  });

  it("策略插槽名都是骨架里真实存在的槽", () => {
    for (const spec of SEAT_SPECS) {
      for (const slot of seatStrategySlots(spec.seatId)) {
        expect(PROMPT_SLOT_ORDER, `${spec.seatId} → ${slot}`).toContain(slot);
      }
    }
  });

  it("全表通用的六段是骨架真实插槽，且与策略/IP DNA 段不重叠", () => {
    for (const slot of ALWAYS_GENERIC_SLOTS) {
      expect(PROMPT_SLOT_ORDER).toContain(slot);
      expect(slot.startsWith("strategy_")).toBe(false);
    }
    expect(new Set(ALWAYS_GENERIC_SLOTS).size).toBe(ALWAYS_GENERIC_SLOTS.length);
  });

  it("IP DNA 口径分档合理：字段级带合集名，下游派生的标明原因", () => {
    expect(getSeatSpec("worldview")!.ipDna).toEqual({
      mode: "field",
      coverage: "partial",
      collection: "世界观合集",
    });
    // 角色/道具/场景要跨层全量，世界观只要跨层要点
    for (const id of ["character", "item", "scene_list"]) {
      const scope = getSeatSpec(id)!.ipDna;
      expect(scope.mode, id).toBe("field");
      if (scope.mode === "field") expect(scope.coverage, id).toBe("full");
    }
    // 大纲吃游戏单元级顶层算子，结构与情节吃故事单元级底层算子
    expect(getSeatSpec("outline")!.ipDna).toEqual({
      mode: "layer",
      unit: "game_unit",
      operators: "top",
    });
    for (const id of ["structure", "plot"]) {
      expect(getSeatSpec(id)!.ipDna, id).toEqual({
        mode: "layer",
        unit: "story_unit",
        operators: "bottom",
      });
    }
    for (const id of ["quest", "storyboard", "narrative_card", "codex"]) {
      expect(getSeatSpec(id)!.ipDna, id).toEqual({
        mode: "none",
        reason: "downstream_derived",
      });
    }
  });

  it("迁移来源都指向真实注册过的老 step", () => {
    const bogus = SEAT_SPECS.flatMap((spec) =>
      (spec.migrateFrom ?? [])
        .filter((id) => !STEP_REGISTRY.has(id))
        .map((id) => `${spec.seatId} → ${id}`),
    );
    expect(bogus, "迁移来源指向了不存在的 step").toEqual([]);
  });
});
