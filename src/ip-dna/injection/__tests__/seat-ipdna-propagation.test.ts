import { describe, it, expect } from "vitest";
import {
  OPERATOR_SLOT_REGISTRY,
  getSlotSpec,
  seatDerivedSlotSpec,
} from "../slot-registry.js";
import { ASSISTANT_SEATS, getSeatForAgent } from "../../../pipeline/routing/assistant-seats.js";
import { SEAT_SPECS, getSeatSpec } from "../../../pipeline/routing/seat-spec.js";
import "../../../pipeline/core/step-registrations.js";
import "../../../pipeline/blueprint/agent-def-registrations.js";

function implementationsOf(seatId: string): string[] {
  const seat = ASSISTANT_SEATS.find((s) => s.id === seatId);
  return [...new Set(seat?.bindings.flatMap((b) => b.agentIds) ?? [])];
}

/**
 * 席位表说「本席不吃 IP DNA」，但逐步表却给它的实现注入了算子的那几步。
 *
 * 这不是笔误，是两份事实源在同一件事上给出了不同答案，且**两边都有道理**：
 * 席位表的 downstream_derived 说的是「内容由上游产物派生，不该另起一套设定」，
 * 逐步表给的多是风格/对白算子，管的是「怎么写」而非「写什么」。
 *
 * 登记在此的意思是：现状按逐步表执行（它更具体，优先级更高），冲突已知、待人裁决。
 * 裁决方向二选一——要么把这几席的 ipDna 从 none 改成显式口径，要么把逐步条目删掉。
 * 在裁决之前，本表保证不会**新增**这类冲突。
 *
 * C1（2026-08）已移除 vn_storyboard 这一条：随 tpl-vn-v2 绑定一并封存，
 * getSeatForAgent 已查不到它，不再是本表的冲突主体。
 * C2（2026-08）已移除 branch_tree / dialogue_script 两条：随 tpl-vn 绑定
 * 一并封存（vn-v1），getSeatForAgent 已查不到它们，不再是本表的冲突主体。
 */
const KNOWN_SCOPE_CONFLICTS: Readonly<Record<string, string>> = {
  quest_generation: "任务席标 downstream_derived，逐步表给结构+情节算子。",
  script_generation: "分镜席标 downstream_derived，逐步表给对白+情感+风格算子。",
  script_scene_generation: "同上，分镜席的场景实现。",
  narrative_card: "叙事卡席标 downstream_derived，逐步表给风格+情感算子（且是手写 AgentDef）。",
  lore_generation: "设定集席标 downstream_derived，逐步表给风格算子。",
};

describe("席位 IP DNA 口径传播到所有作用域变体", () => {
  it("同一席的所有实现都拿得到注入规格（不再漏掉 template 变体）", () => {
    const uncovered: string[] = [];
    for (const spec of SEAT_SPECS) {
      if (spec.ipDna.mode === "none") continue;
      for (const agentId of implementationsOf(spec.seatId)) {
        if (!getSlotSpec(agentId)) uncovered.push(`${spec.seatId} → ${agentId}`);
      }
    }
    expect(uncovered, "以下实现所属席位声明要吃 IP DNA，但解析不出注入规格").toEqual([]);
  });

  // 原「传播确实补上了此前只有逐步表覆盖不到的那些变体」用例已随 C3（2026-08）
  // 移除：region_design / emergent_event / event_pool 三个作用域变体随四个品类
  // 特化能力一并封存进 `_archive/specialized/`，assistant-seats.ts 里对应的
  // template 绑定已摘除，getSeatForAgent 已查不到它们，不再是本文件的验证对象。

  it("逐步表精调的条目不被派生覆盖（派生只兜底）", () => {
    // 角色席派生只给风格算子，逐步表额外给了情感算子——精调必须赢。
    expect(getSlotSpec("character_enrichment")?.slots).toEqual(["风格算子", "情感算子"]);
    // 情节席派生给结构+情节，逐步表给情节+情感+风格。
    expect(getSlotSpec("plot_generation")?.slots).toEqual(["情节算子", "情感算子", "风格算子"]);
  });

  it("席位标 none 但逐步表仍注入的冲突，只有已登记的那些", () => {
    const conflicts: string[] = [];
    for (const agentId of Object.keys(OPERATOR_SLOT_REGISTRY)) {
      const seat = getSeatForAgent(agentId);
      const spec = seat ? getSeatSpec(seat.id) : undefined;
      if (spec?.ipDna.mode === "none" && !(agentId in KNOWN_SCOPE_CONFLICTS)) {
        conflicts.push(`${agentId} (席位 ${seat?.id})`);
      }
    }
    expect(conflicts, "新增了未登记的口径冲突").toEqual([]);
  });

  it("登记的冲突都还在（表不过期）", () => {
    for (const agentId of Object.keys(KNOWN_SCOPE_CONFLICTS)) {
      const seat = getSeatForAgent(agentId);
      expect(getSeatSpec(seat!.id)?.ipDna.mode, `${agentId} 的席位口径已不是 none`).toBe("none");
      expect(getSlotSpec(agentId), `${agentId} 已不再注入`).toBeDefined();
    }
  });

  it("不属于任何有规格席位的 step 仍然零注入（保持零开销）", () => {
    expect(getSlotSpec("tier_router")).toBeUndefined();
    expect(seatDerivedSlotSpec("tier_router")).toBeUndefined();
  });
});
