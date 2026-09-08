/**
 * expert-agents-jrpg-legacy.test.ts
 * ─────────────────────────────────────────────────────────────────
 * 原 `pipeline/__tests__/expert-agents.test.ts` 里唯一依赖 `JRPG_PIPELINE_STEPS`
 * 的一个用例（"专家不再摊平老的 JRPG_PIPELINE_STEPS"），验证新架构席位管线
 * 展开结果与老 L0-L5 步序不同（新管线砍掉了 D 链/L4 剧本这类步）。
 *
 * D1（2026-08）已封存：`JRPG_PIPELINE_STEPS` 常量本体随 D1 一并搬进
 * `_archive/jrpg/templates.ts`，本用例跟着迁入 `_archive/jrpg/__tests__/`，
 * 理由见 `../README.md`。仅用于回归比对被吸收前的原貌，不计入活跃测试套件的
 * 功能覆盖。
 */
import { describe, it, expect } from "vitest";
import { getAgentDef } from "../../../blueprint/agent-def-registry.js";
import { JRPG_PIPELINE_STEPS } from "../templates.js";
import "../../../core/step-registrations.js";
import "../../../blueprint/agent-def-registrations.js";

function childrenOf(agentId: string): string[] {
  const def = getAgentDef(agentId);
  expect(def, `${agentId} 未注册`).toBeTruthy();
  expect(def!.structure.type, agentId).toBe("composite");
  return def!.structure.type === "composite" ? def!.structure.config.children : [];
}

describe("品类专家 = 席位管线的编排（JRPG legacy 对照，已封存）", () => {
  it("专家不再摊平老的 JRPG_PIPELINE_STEPS", () => {
    const legacy = JRPG_PIPELINE_STEPS.flatMap((g) => (Array.isArray(g) ? g : [g]));
    expect(childrenOf("expert.jrpg")).not.toEqual(legacy);
    // 老步序带 D 链/剧本这类新管线不走的步，差异应当真实存在
    expect(legacy.some((id) => !childrenOf("expert.jrpg").includes(id))).toBe(true);
  });
});
