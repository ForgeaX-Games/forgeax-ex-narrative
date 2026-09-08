import { describe, it, expect } from "vitest";
import { STEP_TO_STRATEGY_STAGE, STRATEGY_SLOTS } from "../prompt/strategy-slots.js";
import { getSeatForAgent } from "../routing/assistant-seats.js";
import { SEAT_SPECS, seatStrategySlots } from "../routing/seat-spec.js";
import "../core/step-registrations.js";

/**
 * 策略注入两张表的双向锁。
 *
 * 单向失效都是静默的：登记了 stage 但席位一轴不吃 → 查了卡不注入；席位声明吃轴但
 * 没有 step 登记 stage → 声明了却永远拿不到卡。两种都不报错，只会让模型少看一段。
 */
describe("策略注入以席位表为唯一事实源", () => {
  it("登记了 stage 的 step，其席位真的吃至少一轴", () => {
    const offenders: string[] = [];
    for (const stepId of Object.keys(STEP_TO_STRATEGY_STAGE)) {
      const seat = getSeatForAgent(stepId);
      if (!seat) continue; // 未进席位表的实验步不受约束（见 stepEatsSlot）
      if (seatStrategySlots(seat.id).length === 0) {
        offenders.push(`${stepId} → 席位 ${seat.id} 四轴全 ×`);
      }
    }
    expect(offenders, "以下 step 登记了策略环节，但席位表说它不吃任何一轴").toEqual([]);
  });

  it("声明吃轴的席位，至少有一个实现登记了 stage", () => {
    const eating = SEAT_SPECS.filter((s) => seatStrategySlots(s.seatId).length > 0);
    const registeredSeats = new Set(
      Object.keys(STEP_TO_STRATEGY_STAGE)
        .map((stepId) => getSeatForAgent(stepId)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    const starved = eating.map((s) => s.seatId).filter((seatId) => !registeredSeats.has(seatId));
    expect(starved, "以下席位声明吃策略轴，但没有任何实现登记环节，卡永远注入不到").toEqual([]);
  });

  it("席位表给出的策略槽都在四子槽之内", () => {
    for (const spec of SEAT_SPECS) {
      for (const slot of seatStrategySlots(spec.seatId)) {
        expect(STRATEGY_SLOTS, `${spec.seatId} → ${slot}`).toContain(slot);
      }
    }
  });
});
