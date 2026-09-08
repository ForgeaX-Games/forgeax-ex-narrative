import { describe, it, expect } from "vitest";
import { ASSISTANT_SEATS } from "../routing/assistant-seats.js";
import { getAgentDef, getAllAgentDefs } from "../blueprint/agent-def-registry.js";
import { getNarrativeAgentOrThrow } from "../core/agent-registry.js";
import { getSeatSpec } from "../routing/seat-spec.js";
import { seatAgentPrototype } from "../core/seat-agents.js";
import { isRunnerMigrated } from "../core/runner-migration.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/** 有规格的席位在所有作用域下的实现。 */
function speccedSeatImplementations(): Array<{ seatId: string; agentId: string }> {
  return ASSISTANT_SEATS.filter((s) => getSeatSpec(s.id)).flatMap((seat) =>
    seat.bindings.flatMap((b) => b.agentIds.map((agentId) => ({ seatId: seat.id, agentId }))),
  );
}

describe("seat agents（按配置表注册）", () => {
  it("每个席位实现都有自己的 AgentDef，不再靠硬编码桥接", () => {
    const missing = speccedSeatImplementations()
      .filter(({ agentId }) => !getAgentDef(agentId))
      .map(({ seatId, agentId }) => `${seatId} → ${agentId}`);
    expect(missing, "以下席位实现没注册 AgentDef").toEqual([]);
  });

  it("席位形态下沉到独任实现，一席多实现的各阶是原子", () => {
    // 独自承担席位职责 → 继承席位声明的形态
    expect(seatAgentPrototype("character_enrichment")).toBe("parallel");
    expect(seatAgentPrototype("item_database")).toBe("parallel");
    expect(seatAgentPrototype("scene_plan")).toBe("nested");
    expect(seatAgentPrototype("story_framework")).toBe("serial");
    expect(seatAgentPrototype("quest_generation")).toBe("parallel");
    expect(seatAgentPrototype("plot_generation")).toBe("parallel");

    // 故事结构席是 outline_batch → detailed_outline 两阶串成，单阶是原子
    expect(getSeatSpec("structure")!.prototype).toBe("serial");
    expect(seatAgentPrototype("outline_batch")).toBe("atomic");
    expect(seatAgentPrototype("detailed_outline")).toBe("atomic");
  });

  it("声明的形态真的落进了注册表（不是只算不存）", () => {
    expect(getAgentDef("character_enrichment")?.prototype).toBe("parallel");
    expect(getAgentDef("scene_plan")?.prototype).toBe("nested");
    expect(getNarrativeAgentOrThrow("scene_plan").prototype).toBe("nested");
  });

  /** 手写 AgentDef（不经 buildSeatAgentDef 派生）：可以显式切 runner，不受这条检查约束。 */
  const HAND_WRITTEN_AGENT_DEFS = ["narrative_card"];

  it("派生的 AgentDef 一律不开新 runner——注册形态不改变产出", () => {
    // 手写 AgentDef 可以显式切（narrative_card 已切），派生的只有登记进
    // RUNNER_MIGRATIONS 的才能切：那张表才是"已迁移"的唯一名单，不是有没有
    // validators——preference_summary 无校验、structure_check 是确定性席位，
    // 都不带 validators 但确实迁移过。
    const flipped = speccedSeatImplementations()
      .filter(({ agentId }) => !isRunnerMigrated(agentId) && !HAND_WRITTEN_AGENT_DEFS.includes(agentId))
      .filter(({ agentId }) => getAgentDef(agentId)?.useNewRunner === true)
      .map(({ agentId }) => agentId);
    expect(flipped, "有派生 AgentDef 被切到新 runner").toEqual([]);
  });

  it("手写 AgentDef 不被派生的覆盖", () => {
    const card = getAgentDef("narrative_card");
    expect(card?.validators).toEqual(["narrative_card_validator"]);
    expect(card?.io.consumesIpDna?.slots).toContain("风格算子");
    // 手写的 templateId 指向真实存在的模板，派生的只用 step id 作标识
    expect(card?.prompts.templateId).toBe("narrative-card");
    expect(getAgentDef("worldview")?.prompts.templateId).toBe("worldview");
  });

  it("走 AgentDef 也带席位归属，不比桥接的少信息", () => {
    const worldview = getNarrativeAgentOrThrow("worldview");
    expect(worldview.seatId).toBe("worldview");
    expect(worldview.roleCategory).toBe("engineer");
    // 依赖席才有非空输入契约；worldview 是 independent 席，契约为空是正确状态
    expect(getNarrativeAgentOrThrow("plot_generation").io.requiredInputs.length)
      .toBeGreaterThan(0);
  });

  it("io 契约从 StepDescriptor 派生，不是空壳", () => {
    // 角色档案席是 independent：requiredInputs 为空，但 dependsOn 仍表达排序依赖，
    // 两者分工正是这一轮拆开的口径（闸门只看 requiredInputs）
    const character = getAgentDef("character_enrichment")!;
    expect(character.io.requiredInputs).toEqual([]);
    expect(character.dependencies).toContain("worldview");
    expect(character.io.outputField).toBeTruthy();

    const plot = getAgentDef("plot_generation")!;
    expect(plot.io.requiredInputs).toContain("detailed_outlines_generated");
    expect(plot.io.outputField).toBeTruthy();
    expect(plot.dependencies.length).toBeGreaterThan(0);
  });

  it("四原型在注册表里都有实例（4.3 的四类抽象在运行层可见）", () => {
    const prototypes = new Set(
      getAllAgentDefs()
        .map((d) => d.prototype)
        .filter(Boolean),
    );
    for (const p of ["atomic", "serial", "parallel", "nested"]) {
      expect(prototypes.has(p as never), `注册表里没有 ${p} 形态的 agent`).toBe(true);
    }
  });
});
