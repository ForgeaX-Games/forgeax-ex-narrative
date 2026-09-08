import { describe, it, expect } from "vitest";
import { MODE_CONFIGS, getModeConfig } from "../routing/modes.js";
import {
  LEGACY_STEP_ORDER_MODES,
  CUTOFF_SEAT_OVERRIDE,
  isSeatRoutedMode,
  resolveModeStepGroups,
} from "../routing/mode-routing.js";
import { getSeatForAgent } from "../routing/assistant-seats.js";
import type { ModeId, TierId } from "../../types/index.js";
import "../core/step-registrations.js";

function tierOf(mode: { tiers: readonly TierId[] }): TierId {
  return mode.tiers[0] ?? "tier1";
}

/** 影游家族按品类特例走分镜线，其余按层级。 */
function genreOf(modeId: string): string {
  return modeId.includes("vn") ? "adv-interactive" : "rpg-jrpg";
}

function oldStepOrder(modeId: ModeId): string[] {
  return getModeConfig(modeId).steps.flatMap((e) => (Array.isArray(e) ? e : [e]));
}

function newStepOrder(modeId: ModeId): string[] {
  const cfg = getModeConfig(modeId);
  return resolveModeStepGroups({
    mode: modeId,
    genreCode: genreOf(modeId),
    tier: tierOf(cfg),
  }).stepGroups;
}

/**
 * 归一后每个 mode 相对旧手写步序**丢掉**的步。
 *
 * 空表意味着"归一只加不减"。非空项必须在此逐条登记原因——静默少产一份交付物是
 * 这次归一唯一真正的风险，登记表就是那道闸。
 */
const ACCEPTED_LOSSES: Readonly<Record<string, readonly string[]>> = {
  // script_generation 是分镜席（storyboard）的通用实现，而任务线（pl-narrative）的
  // 交付席是任务，不含分镜席。新架构里 RPG 的"剧本层"已被情节席吸收：plot_generation
  // 的产出 schema 本身就带 dialogue_segments / 演出要素，不再单出一份剧本。
  quest: ["script_generation"],
  full: ["script_generation"],
  design_full_narrative: ["script_generation"],
  // B1：scene 的截断点从"scene_plan 自己的下标"改为"席位白名单，与 quest
  // 截断到同一处"（见 mode-routing.ts 的 CUTOFF_SEAT_OVERRIDE）。理由与上面三条
  // 一致——script_generation 不再重复出，scene_plan 本身作为设定层强制
  // 成员早已产出，不受这次改动影响。
  scene: ["script_generation"],
};

describe("路由归一：mode 步序的唯一来源是席位管线", () => {
  it("例外表里的 mode 都真实存在，且理由非空", () => {
    for (const [modeId, reason] of Object.entries(LEGACY_STEP_ORDER_MODES)) {
      expect(MODE_CONFIGS.some((m) => m.id === modeId), `未知 mode: ${modeId}`).toBe(true);
      expect(reason.trim().length, `${modeId} 的例外理由为空`).toBeGreaterThan(20);
    }
  });

  it("例外之外的 mode 全部可由席位管线解析出非空步序", () => {
    const empty: string[] = [];
    for (const m of MODE_CONFIGS) {
      if (!isSeatRoutedMode(m.id)) continue;
      if (newStepOrder(m.id).length === 0) empty.push(m.id);
    }
    expect(empty, "以下 mode 归一后解析出空步序").toEqual([]);
  });

  it("归一只加不减，减了的必须登记在 ACCEPTED_LOSSES", () => {
    const unregistered: string[] = [];
    for (const m of MODE_CONFIGS) {
      if (!isSeatRoutedMode(m.id)) continue;
      const nu = new Set(newStepOrder(m.id));
      const lost = oldStepOrder(m.id).filter((s) => !nu.has(s));
      const accepted = new Set(ACCEPTED_LOSSES[m.id] ?? []);
      const surprise = lost.filter((s) => !accepted.has(s));
      if (surprise.length) unregistered.push(`${m.id}: ${surprise.join(", ")}`);
    }
    expect(unregistered, "以下 mode 归一后少产交付物且未登记").toEqual([]);
  });

  it("登记的损失都还在发生（表本身不过期）", () => {
    for (const [modeId, losses] of Object.entries(ACCEPTED_LOSSES)) {
      const nu = new Set(newStepOrder(modeId as ModeId));
      for (const step of losses) {
        expect(nu.has(step), `${modeId} 已不再丢 ${step}，请从 ACCEPTED_LOSSES 删掉`).toBe(false);
      }
    }
  });

  it("声明了停止点的 mode 都真的截断在那一步", () => {
    const notTruncated: string[] = [];
    for (const m of MODE_CONFIGS) {
      if (!isSeatRoutedMode(m.id) || !m.target_endpoint) continue;
      const routed = resolveModeStepGroups({
        mode: m.id,
        genreCode: genreOf(m.id),
        tier: tierOf(m),
      });
      if (routed.truncatedAt !== m.target_endpoint) {
        notTruncated.push(`${m.id} → ${m.target_endpoint}`);
      } else if (routed.stepGroups[routed.stepGroups.length - 1] !== m.target_endpoint) {
        // CUTOFF_SEAT_OVERRIDE 登记的 endpoint（如 scene_plan）是有意
        // 重定向截断点的例外——真实末位换成了另一个席位（如 quest），只要末位
        // 落在那个被重定向到的席位上就算数，不是"截断点不在末位"的意外情况。
        const redirectSeat = CUTOFF_SEAT_OVERRIDE[m.target_endpoint];
        const lastStepSeat = getSeatForAgent(routed.stepGroups[routed.stepGroups.length - 1] ?? "")?.id;
        if (!redirectSeat || lastStepSeat !== redirectSeat) {
          notTruncated.push(`${m.id} 截断点不在末位`);
        }
      }
    }
    expect(notTruncated, "以下 mode 的 target_endpoint 在席位步序里落不到实处").toEqual([]);
  });

  it("解析出的每一步都归属某个席位（没有游离步）", () => {
    for (const m of MODE_CONFIGS) {
      if (!isSeatRoutedMode(m.id)) continue;
      for (const stepId of newStepOrder(m.id)) {
        expect(getSeatForAgent(stepId), `${m.id} 的 ${stepId} 不属于任何席位`).toBeDefined();
      }
    }
  });

  it("design_* 保留 D0-D4 前缀，不吞掉后续叙事层步骤", () => {
    // C1 封存 tpl-vn-v2 后，design_doc 席已无按品类特化的第二实现（原影游线的
    // vn_logline 随之退役）——D0-D4 前缀链与叙事层通用实现的共存关系，改由
    // "前缀不顶掉 initial_plan" 这条通用断言来守。
    const full = newStepOrder("design_full_narrative");
    expect(full.slice(0, 5)).toEqual([
      "core_concept",
      "system_architecture",
      "system_detail",
      "value_framework",
      "design_doc",
    ]);
    // 任务线同理：initial_plan 是通用策划文档实现，不该被 D 链顶掉。
    expect(full).toContain("initial_plan");
  });

  it("design_only 止于策划文档，不进叙事层", () => {
    const steps = newStepOrder("design_only");
    expect(steps[steps.length - 1]).toBe("design_doc");
    expect(steps).not.toContain("story_framework");
  });

  it("B1：script mode 已从 LEGACY_STEP_ORDER_MODES 摘除，止于 L4 剧本（storyboard 临时激活）", () => {
    expect(LEGACY_STEP_ORDER_MODES).not.toHaveProperty("script");
    expect(isSeatRoutedMode("script")).toBe(true);

    const routed = resolveModeStepGroups({ mode: "script", genreCode: "rpg-jrpg", tier: "tier1" });
    expect(routed.pipeline.id).toBe("pl-narrative");
    expect(routed.truncatedAt).toBe("script_generation");
    expect(routed.stepGroups[routed.stepGroups.length - 1]).toBe("script_generation");
    expect(routed.stepGroups).not.toContain("quest_generation");

    // 品类没选剧本终点的默认跑法（如 narrative_auto）仍止于 L5 任务，可选终点不外溢。
    const auto = resolveModeStepGroups({ mode: "narrative_auto", genreCode: "rpg-jrpg", tier: "tier1" });
    expect(auto.stepGroups).not.toContain("script_generation");
  });

  it("B2：scene 已从 LEGACY_STEP_ORDER_MODES 摘除，截断点重定向到 quest 席而非 scene_plan 自身下标", () => {
    expect(LEGACY_STEP_ORDER_MODES).not.toHaveProperty("scene");
    expect(isSeatRoutedMode("scene")).toBe(true);

    const routed = resolveModeStepGroups({ mode: "scene", genreCode: "rpg-jrpg", tier: "tier1" });
    expect(routed.pipeline.id).toBe("pl-narrative");
    // truncatedAt 仍如实报告 mode 自己声明的 endpoint；真正的切点由
    // CUTOFF_SEAT_OVERRIDE 重定向到 quest 席（见上面「截断点不在末位」的豁免逻辑）。
    expect(routed.truncatedAt).toBe("scene_plan");
    expect(routed.stepGroups[routed.stepGroups.length - 1]).toBe("quest_generation");
    // scene_plan 自己是设定层强制成员，仍然在产出集合里，只是不在末位。
    expect(routed.stepGroups).toContain("scene_plan");
    expect(routed.stepGroups).toContain("worldview");
    expect(routed.stepGroups).toContain("plot_generation");
    expect(routed.stepGroups).not.toContain("script_generation");
    expect(routed.stepGroups).not.toContain("structure_check");
  });

  it("同一品类在静态 mode 与 narrative_auto 下步序同源（归一的目的）", () => {
    // full 是 tier1 的全量静态入口，narrative_auto 是动态入口，两者应解析到同一条管线。
    const staticFull = resolveModeStepGroups({
      mode: "full",
      genreCode: "rpg-jrpg",
      tier: "tier1",
    });
    const auto = resolveModeStepGroups({
      mode: "narrative_auto",
      genreCode: "rpg-jrpg",
      tier: "tier1",
    });
    expect(staticFull.pipeline.id).toBe(auto.pipeline.id);
    expect(staticFull.stepGroups).toEqual(auto.stepGroups);
  });
});
