import { describe, it, expect } from "vitest";
import {
  ASSISTANT_SEATS,
  assertSeatContractComplete,
  boundAgentIds,
  getSeatForAgent,
  KNOWN_SEAT_GRAPH_DIVERGENCES,
  resolveSeatAgents,
  resolveSeatRequiredFields,
} from "../routing/assistant-seats.js";
import {
  getStepRequiredInputs,
  missingStepInputs,
  STEP_REGISTRY,
} from "../core/step-registry.js";
import { getNarrativeAgentOrThrow } from "../core/agent-registry.js";
import "../core/step-registrations.js";

/** step 的传递依赖闭包（含自身）。 */
function depClosure(stepId: string): Set<string> {
  const seen = new Set<string>([stepId]);
  const queue = [stepId];
  while (queue.length > 0) {
    for (const dep of STEP_REGISTRY.get(queue.shift()!)?.dependsOn ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

/**
 * 逐个绑定比对：该绑定的依赖闭包里，是否真的能摸到席位声明的每个上游席位。
 * 摸不到就是一处落差。
 */
function actualDivergences(): Array<{
  seatId: string;
  scope: string;
  missingUpstream: string[];
}> {
  const out: Array<{ seatId: string; scope: string; missingUpstream: string[] }> = [];
  for (const seat of ASSISTANT_SEATS) {
    if (seat.upstreamSeats.length === 0) continue;
    for (const binding of seat.bindings) {
      // coveredBy 绑定本席没有自己的 step，也就没有依赖图可比——它的上游满足情况
      // 由承接席的绑定去检。在此处比对只会把「有意合并实现」误报成「缺上游」。
      if (binding.coveredBy) continue;
      const closure = new Set<string>();
      for (const agentId of binding.agentIds) {
        for (const s of depClosure(agentId)) closure.add(s);
      }
      const reachableSeats = new Set(
        [...closure].map((s) => getSeatForAgent(s)?.id).filter(Boolean) as string[],
      );
      const missing = seat.upstreamSeats.filter((u) => !reachableSeats.has(u));
      if (missing.length > 0) {
        out.push({
          seatId: seat.id,
          scope: binding.templateId ?? binding.modeId ?? "通用",
          missingUpstream: missing,
        });
      }
    }
  }
  return out;
}

/**
 * 席位契约守卫。
 *
 * 最要紧的一条是「全局无孤儿」：任何注册进 STEP_REGISTRY 的 step 都必须能
 * 回答「你是哪个单品助手的实现」。以前 step 是 SSOT，新增一个谁也不知道它
 * 对应什么产品；现在加 step 而不认领席位会直接红，逼着实现回到产品视角。
 */
describe("assistant seats", () => {
  it("契约自洽（kind 专属字段、状态与绑定、通用绑定唯一）", () => {
    expect(() => assertSeatContractComplete()).not.toThrow();
  });

  /**
   * 编号与顺序都照 v4 主表 §2.5，逐个写出来而不用 `2.5.${i+1}` 生成。
   *
   * 生成式的期望曾是这条断言的写法，它成立的前提是"编号连续且与表序同步递增" ——
   * 而对齐主表时这个前提并不成立：百科娘在主表里是 2.5.1，代码里它原本排在末位。
   *
   * 逐个写出来也让这张表成为"代码与主表对不上时先看哪儿"的地方。
   */
  it("编号与顺序对齐 v4 主表 §2.5", () => {
    expect(ASSISTANT_SEATS.map((s) => s.featureId)).toEqual([
      "2.5.0", // 配置助手（入口）
      "2.5.1", // 百科娘
      "2.5.2", // 需求清单
      "2.5.3", // 策划文档
      "2.5.4", // 世界观
      "2.5.5", // 角色档案
      "2.5.6", // 道具清单
      "2.5.7", // 场景列表
      "2.5.8", // 故事大纲
      "2.5.9", // 故事结构
      "2.5.10", // 故事情节
      "2.5.11", // 任务
      "2.5.12", // 分镜
      "2.5.13", // 叙事卡
      "2.5.14", // 设定集
      "2.5.15", // 结构检查
      "2.5.16", // 内容检查
      "2.5.17", // 去 AI 味
      "2.5.18", // 结构优化
      "2.5.19", // 情节优化（含旧情节润色席的职责）
      "2.5.20", // 玩法适配
      "2.5.21", // 旁白解说
    ]);
  });

  it("主表 §2.5 的 22 个号全部就位，一个不多一个不少", () => {
    // 曾多出一席 plot_polish（情节润色）：主表上没有它的位置，它的号只能带 -legacy
    // 后缀说明自己是实现史的产物。随本轮退役，代码与主表现在逐席对齐。
    const ids = ASSISTANT_SEATS.map((s) => s.featureId);
    expect(ids).toHaveLength(22);
    expect(new Set(ids).size).toBe(22);
    expect(ids.filter((id) => id.includes("-"))).toEqual([]);
  });

  it("席位 id 唯一", () => {
    const ids = ASSISTANT_SEATS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个已注册 step 都归属某个席位（无孤儿）", () => {
    const orphans = [...STEP_REGISTRY.keys()].filter((id) => !getSeatForAgent(id));
    expect(orphans, `以下 step 没有认领席位：${orphans.join(", ")}`).toEqual([]);
  });

  it("每个 step 只归属一个席位（无双主）", () => {
    const owners = new Map<string, string[]>();
    for (const seat of ASSISTANT_SEATS) {
      const owned = [
        ...seat.bindings.flatMap((b) => b.agentIds),
        ...(seat.alsoOwns ?? []),
      ];
      for (const agentId of owned) {
        owners.set(agentId, [...(owners.get(agentId) ?? []), seat.id]);
      }
    }
    const conflicts = [...owners.entries()].filter(([, seats]) => seats.length > 1);
    expect(
      conflicts.map(([agentId, seats]) => `${agentId} → ${seats.join(" / ")}`),
    ).toEqual([]);
  });

  it("席位绑定指向的 agent 都真实注册过", () => {
    const missing = boundAgentIds().filter((id) => !STEP_REGISTRY.has(id));
    expect(missing, `席位绑了不存在的 agent：${missing.join(", ")}`).toEqual([]);
  });

  it("作用域解析：模式 > 模板 > 通用兜底", () => {
    // 通用兜底
    expect(resolveSeatAgents("scene_list")).toEqual(["scene_plan"]);
    // C3（2026-08）已封存：tpl-open-world 原有的 region_design 模板专属绑定已
    // 随实现本体搬进 `_archive/specialized/`，现两个模板都回落通用 scene_plan。
    expect(resolveSeatAgents("scene_list", { templateId: "tpl-open-world" })).toEqual([
      "scene_plan",
    ]);
    // 未声明该模板 → 回落通用
    expect(resolveSeatAgents("scene_list", { templateId: "tpl-card-game" })).toEqual([
      "scene_plan",
    ]);
    // 模式绑定优先于模板
    expect(resolveSeatAgents("design_doc", { modeId: "design_auto" })).toEqual([
      "core_concept",
      "system_architecture",
      "system_detail",
      "value_framework",
      "design_doc",
    ]);
  });

  it("一席多步的内部 workflow 保序", () => {
    expect(resolveSeatAgents("req_list")).toEqual([
      "preference_summary",
      "preference_analysis",
    ]);
    expect(resolveSeatAgents("structure")).toEqual(["outline_batch", "detailed_outline"]);
  });

  it("上游席位都指向真实席位", () => {
    const ids = new Set(ASSISTANT_SEATS.map((s) => s.id));
    const bad = ASSISTANT_SEATS.flatMap((s) =>
      s.upstreamSeats.filter((u) => !ids.has(u)).map((u) => `${s.id} → ${u}`),
    );
    expect(bad).toEqual([]);
  });

  it("产品意图与实现依赖图的落差，恰好等于已登记的那几条", () => {
    const actual = actualDivergences();
    const asKey = (d: { seatId: string; scope: string; missingUpstream: string[] }) =>
      `${d.seatId}[${d.scope}] 缺 ${[...d.missingUpstream].sort().join("+")}`;

    const found = actual.map(asKey).sort();
    const known = KNOWN_SEAT_GRAPH_DIVERGENCES.map(asKey).sort();

    // 新冒出来的落差 = 有人改了接线却没交代
    expect(found.filter((k) => !known.includes(k)), "出现未登记的落差").toEqual([]);
    // 已消失的落差 = 清单该清理了
    expect(known.filter((k) => !found.includes(k)), "登记了但已不存在的落差").toEqual([]);
  });

  it("桥接出来的 agent 带上了输入契约与席位归属，不再是空壳", () => {
    const worldview = getNarrativeAgentOrThrow("worldview");
    expect(worldview.seatId).toBe("worldview");
    expect(worldview.roleCategory).toBe("engineer");

    // 依赖席的契约非空（故事情节没有细纲跑不了）
    expect(getNarrativeAgentOrThrow("plot_generation").io.requiredInputs)
      .toContain("detailed_outlines_generated");

    // 独立席的契约为空：世界观助手可以只带 user_input 起跑，
    // 上游产物是软输入（runPolicy: independent，见 assistant-seats.ts）
    expect(worldview.io.requiredInputs).toEqual([]);
    expect(getNarrativeAgentOrThrow("preference_summary").io.requiredInputs).toEqual([]);
  });

  it("输入体检报告缺失字段，而不是闷头跑空", () => {
    // 拿依赖席举例：独立席的 requiredInputs 一律为空，体检自然无话可报
    expect(getStepRequiredInputs("plot_generation")).toContain("detailed_outlines_generated");
    expect(missingStepInputs("plot_generation", {})).toContain("detailed_outlines_generated");
    expect(
      missingStepInputs("plot_generation", { detailed_outlines_generated: { a: 1 } }),
    ).toEqual([]);
  });

  // 原「同一席位在不同管线下反查到各自的具体字段」用例已随 C3（2026-08）移除：
  // plot 席最后一条模板专属覆盖（tpl-emergent 的 emergent_event）随实现本体
  // 搬进 `_archive/specialized/`，此后 assistant-seats.ts 里再无任何
  // `templateId:` 场景化覆盖，所有模板一律回落通用绑定，不再有可反查的场景差异。
  it("plot 席字段反查（现已无场景化覆盖，通用绑定即最终结果）", () => {
    expect(resolveSeatRequiredFields("plot")).toContain("detailed_outlines_generated");
  });

  it("职责判定优先于历史命名：宏观归大纲席、微观归结构席", () => {
    expect(getSeatForAgent("story_framework")?.id).toBe("outline");
    expect(getSeatForAgent("outline_batch")?.id).toBe("structure");
    expect(getSeatForAgent("script_generation")?.id).toBe("storyboard");
  });
});
