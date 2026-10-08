import { describe, it, expect } from "vitest";
import {
  CONTENT_CHECK_COMPOSER,
  CONTENT_CHECK_CRITERIA,
  contentCheck,
  validateContentCheck,
  normalizeContentCheck,
} from "../steps/content-check.js";
import {
  POLISH_SEAT_SPECS,
  DEAI_SPEC,
  PLAYABILITY_SPEC,
  DEAI_COMPOSER,
  deaiPolish,
  playabilityAdapt,
} from "../steps/polish-seats.js";
import {
  polishTargetNodes,
  mergePolishedIntoBase,
  mergePolishedNode,
  validatePolishOutput,
  buildPolishComposer,
} from "../steps/polish-family.js";
import { composeSystemPrompt, composeUserPrompt } from "../runtime/prompt-composer.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import { getSeat, assertSeatContractComplete } from "../routing/assistant-seats.js";
import { NARRATIVE_PIPELINES, expandPipelineSteps } from "../routing/narrative-pipelines.js";
import { STEP_FILE_MAP, INPLACE_TRANSFORM_STEPS } from "../runtime/step-files.js";
import { isExecutableStep } from "../core/pipeline.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";

/**
 * 质检席（2.5.16）与打磨四席（2.5.17–2.5.20）。
 *
 * 这五席的失败模式都不是抛错，而是**看着跑过了**：
 *   - 内容检查报了一堆 error 却把 verdict 写成 pass，前端红点不亮；
 *   - 打磨席把 next_node 顺手改了，下游按剧情树对齐的一切静默错位；
 *   - 席位登记了却没进 ALL_STEPS，画布上拖了、点了、什么也没跑。
 * 所以断言集中在这三处，而不是"能不能返回结果"。
 */

function plotCtx(count = 3): NarrativeContext {
  return {
    user_input: "悬疑短篇",
    plots_generated: {
      plots: Array.from({ length: count }, (_, i) => ({
        node_id: `n${i + 1}`,
        content: `第 ${i + 1} 节的正文。`,
        next_node: `n${i + 2}`,
      })),
    },
  } as unknown as NarrativeContext;
}

/** 桩 LLM：返回给定 JSON，并记下每次调用的 system/user。 */
function stubLlm(reply: unknown | ((user: string) => unknown)): LLMClient & {
  systems: string[];
  users: string[];
} {
  const systems: string[] = [];
  const users: string[] = [];
  const llm = {
    systems,
    users,
    async callWithRetry(
      system: string,
      user: string,
      _o?: unknown,
      validate?: (raw: string) => void,
    ): Promise<string> {
      systems.push(system);
      users.push(user);
      const body = typeof reply === "function"
        ? (reply as (u: string) => unknown)(user)
        : reply;
      const raw = JSON.stringify(body);
      validate?.(raw);
      return raw;
    },
  };
  return llm as unknown as LLMClient & { systems: string[]; users: string[] };
}

describe("内容检查席（2.5.16）", () => {
  it("已转 active 且绑定实现，契约自检通过", () => {
    const seat = getSeat("content_check")!;
    expect(seat.status).toBe("active");
    // 判定在前、场景取证在后：单跑打到 agentIds[0]，用户点"跑内容检查"要的是报告。
    expect(seat.bindings.flatMap((b) => b.agentIds)).toEqual(["content_check", "scene_evidence"]);
    expect(() => assertSeatContractComplete()).not.toThrow();
  });

  it("step 已登记、带 composer、有落盘条目，且实跑真叫得动", () => {
    const desc = STEP_REGISTRY.get("content_check")!;
    expect(desc.composer).toBe(CONTENT_CHECK_COMPOSER);
    expect(desc.outputFields).toEqual(["content_check_report"]);
    expect(STEP_FILE_MAP.content_check).toBeTruthy();
    // 只在 STEP_REGISTRY 登记不够：run() 从 STEP_FNS 取 fn，缺项会被静默丢掉。
    expect(isExecutableStep("content_check")).toBe(true);
  });

  it("场景取证真的进得了管线步序——只登记不进步序等于永不执行", () => {
    for (const id of ["pl-narrative", "pl-film-game"] as const) {
      const steps = expandPipelineSteps(NARRATIVE_PIPELINES[id]);
      expect(steps, `${id} 缺场景取证`).toContain("scene_evidence");
      // 取证在判定之后：判定不读证据，而席位代表步必须是判定本身。
      expect(steps.indexOf("content_check")).toBeLessThan(steps.indexOf("scene_evidence"));
    }
    expect(isExecutableStep("scene_evidence")).toBe(true);
    expect(STEP_FILE_MAP.scene_evidence).toBeTruthy();
  });

  it("八项判据逐字进提示词（少一项就是少查一项）", () => {
    const system = composeSystemPrompt(CONTENT_CHECK_COMPOSER, plotCtx());
    for (const criterion of CONTENT_CHECK_CRITERIA) {
      expect(system, criterion).toContain(criterion);
    }
  });

  it("送检内容逐节点带 id（报告要靠它定位）", () => {
    const user = composeUserPrompt(CONTENT_CHECK_COMPOSER, plotCtx(2));
    expect(user).toContain("节点 n1");
    expect(user).toContain("节点 n2");
  });

  it("缺原文片段的问题条目触发重试", () => {
    const withExcerpt = JSON.stringify({
      findings: [{ criterion: "逻辑自洽", excerpt: "他推开门", issue: "x" }],
      coverage: [],
    });
    expect(() => validateContentCheck(withExcerpt)).not.toThrow();

    const noExcerpt = JSON.stringify({
      findings: [{ criterion: "逻辑自洽", issue: "某处逻辑不通" }],
      coverage: [],
    });
    expect(() => validateContentCheck(noExcerpt)).toThrow();
  });

  it("verdict 由问题严重度重算，不采信模型自述", () => {
    const report = normalizeContentCheck({
      verdict: "pass",
      findings: [{ criterion: "吃书防范", nodeId: "n1", severity: "error", excerpt: "e" }],
      coverage: [],
    });
    expect(report.verdict).toBe("fail");

    const warnOnly = normalizeContentCheck({
      verdict: "fail",
      findings: [{ criterion: "逻辑自洽", nodeId: "n1", severity: "warn", excerpt: "e" }],
      coverage: [],
    });
    expect(warnOnly.verdict).toBe("warn");
  });

  it("模型漏交代的判据按「没查」补齐，不算通过", () => {
    const report = normalizeContentCheck({ findings: [], coverage: [] });
    expect(report.coverage).toHaveLength(CONTENT_CHECK_CRITERIA.length);
    expect(report.coverage.every((c) => c.checked === false)).toBe(true);
    // 没有 findings 时 verdict 仍是 pass —— 覆盖情况另有 coverage 表达，两者不混。
    expect(report.verdict).toBe("pass");
  });

  it("没有情节时不发请求，如实报「没有可检查的内容」", async () => {
    const ctx = { user_input: "x" } as NarrativeContext;
    const llm = stubLlm({});
    await contentCheck(ctx, llm);

    expect(llm.users).toHaveLength(0);
    const report = (ctx as Record<string, unknown>).content_check_report as {
      verdict: string;
      coverage: Array<{ checked: boolean }>;
    };
    expect(report.verdict).toBe("warn");
    expect(report.coverage.every((c) => !c.checked)).toBe(true);
  });

  it("跑通后报告落在席位声明的字段上", async () => {
    const ctx = plotCtx();
    await contentCheck(ctx, stubLlm({
      verdict: "warn",
      summary: "一处待关注",
      findings: [{
        criterion: "世界观适配",
        nodeId: "n2",
        severity: "warn",
        issue: "提到了本世界没有的技术",
        excerpt: "他掏出手机",
        suggestion: "改为信鸽",
      }],
      coverage: CONTENT_CHECK_CRITERIA.map((criterion) => ({ criterion, checked: true })),
    }));

    const field = getSeat("content_check")!.report!.field;
    const report = (ctx as Record<string, unknown>)[field] as { findings: unknown[] };
    expect(report.findings).toHaveLength(1);
  });
});

describe("打磨四席（2.5.17–2.5.20）", () => {
  /**
   * 空了。玩法适配（2.5.20）曾是唯一一席 planned —— 当时的理由是"上下游口径未定"，
   * 而 v4 主表把它的职责定死成「让选项变得有意义、分支能真正推进剧情」，上游就是结构席。
   * 四席现在一律 active，各绑一个实现。
   */
  const PLANNED_POLISH_SEATS: string[] = [];

  it("四席各 active 且各绑一个实现", () => {
    for (const spec of POLISH_SEAT_SPECS) {
      const seat = getSeat(spec.seatId)!;
      if (PLANNED_POLISH_SEATS.includes(spec.seatId)) {
        expect(seat.status, spec.seatId).toBe("planned");
        expect(seat.bindings, spec.seatId).toEqual([]);
        expect(seat.alsoOwns, spec.seatId).toContain(spec.stepId);
        expect(seat.runPolicy, spec.seatId).toBeUndefined();
      } else {
        expect(seat.status, spec.seatId).toBe("active");
        expect(seat.bindings.flatMap((b) => b.agentIds), spec.seatId).toEqual([spec.stepId]);
        expect(seat.runPolicy, spec.seatId).toBe("requires-upstream");
      }
      // 打磨产物原位写回基准字段，两处口径必须一致（planned 席也已立好契约）。
      expect(seat.branch!.baseField, spec.seatId).toBe(spec.baseField);
    }
    expect(() => assertSeatContractComplete()).not.toThrow();
  });

  it("四步全部登记、带 composer、有落盘条目，且实跑真叫得动", () => {
    for (const spec of POLISH_SEAT_SPECS) {
      const desc = STEP_REGISTRY.get(spec.stepId);
      expect(desc, spec.stepId).toBeTruthy();
      expect(desc!.composer, spec.stepId).toBeTruthy();
      expect(desc!.outputFields, spec.stepId).toEqual([spec.baseField]);
      // 同形变换步沿用基准步的文件名——一份剧本换个写法还是那一份剧本。
      expect(STEP_FILE_MAP[spec.stepId], spec.stepId).toEqual(
        STEP_FILE_MAP[INPLACE_TRANSFORM_STEPS[spec.stepId]],
      );
      expect(isExecutableStep(spec.stepId), spec.stepId).toBe(true);
    }
  });

  it("产物原位写回基准字段，形状不变", async () => {
    const ctx = plotCtx(2);
    await deaiPolish(ctx, stubLlm({ content: "改后的正文", changes: ["删了两处总结句"] }));

    const base = (ctx as Record<string, unknown>).plots_generated as {
      plots: Array<{ content: string; node_id: string; next_node: string }>;
      polished_by?: string;
    };
    expect(base.plots).toHaveLength(2);
    expect(base.plots.every((p) => p.content === "改后的正文")).toBe(true);
    // 同形：节点键名、骨架字段一个不少，下游照旧读 plots_generated.plots。
    expect(base.plots.map((p) => p.node_id)).toEqual(["n1", "n2"]);
    expect(base.plots[0].next_node).toBe("n2");
    expect(base.polished_by).toBe("deai");
  });

  it("只重跑单个节点时，其余节点原样留在剧本里", async () => {
    const ctx = plotCtx(3);
    (ctx as Record<string, unknown>)._nodeFilter = ["n2"];
    await deaiPolish(ctx, stubLlm({ content: "只改了 n2" }));

    const base = (ctx as Record<string, unknown>).plots_generated as {
      plots: Array<{ node_id: string; content: string }>;
    };
    expect(base.plots.map((p) => p.node_id)).toEqual(["n1", "n2", "n3"]);
    expect(base.plots[0].content).toBe("第 1 节的正文。");
    expect(base.plots[1].content).toBe("只改了 n2");
    expect(base.plots[2].content).toBe("第 3 节的正文。");
  });

  it("每个节点收到的是自己的材料（不是所有节点共用第一片）", async () => {
    const ctx = plotCtx(3);
    const llm = stubLlm({ content: "x" });
    await deaiPolish(ctx, llm);

    expect(llm.users).toHaveLength(3);
    expect(new Set(llm.users).size).toBe(3);
    for (const id of ["n1", "n2", "n3"]) {
      expect(llm.users.some((u) => u.includes(id)), id).toBe(true);
    }
  });

  it("并发完成顺序不影响产物顺序", async () => {
    const ctx = plotCtx(4);
    await deaiPolish(
      ctx,
      stubLlm((user: string) => ({ content: user.includes("n1") ? "first" : "rest" })),
    );
    const base = (ctx as Record<string, unknown>).plots_generated as {
      plots: Array<{ node_id: string }>;
    };
    expect(base.plots.map((p) => p.node_id)).toEqual(["n1", "n2", "n3", "n4"]);
  });

  it("骨架不可变：模型改了连接关系也不采纳", () => {
    const original = { node_id: "n1", content: "原文", next_node: "n2", parent_id: "root" };
    const merged = mergePolishedNode(original, {
      node_id: "HACKED",
      content: "改后",
      next_node: "n9",
      parent_id: "elsewhere",
      changes: ["改了节奏"],
    });
    expect(merged.node_id).toBe("n1");
    expect(merged.next_node).toBe("n2");
    expect(merged.parent_id).toBe("root");
    expect(merged.content).toBe("改后");
  });

  it("提示词把「不可改动的部分」写进 system（代码兜底之外的第一道）", () => {
    const system = composeSystemPrompt(DEAI_COMPOSER, plotCtx());
    expect(system).toContain("不可改动的部分");
    expect(system).toContain("node_id");
  });

  it("空正文触发重试（打磨把内容删空是最坏的静默失败）", () => {
    expect(() => validatePolishOutput(JSON.stringify({ content: "有内容" }))).not.toThrow();
    expect(() => validatePolishOutput(JSON.stringify({ content: "   " }))).toThrow();
    expect(() => validatePolishOutput(JSON.stringify({ changes: [] }))).toThrow();
  });

  it("基准字段缺失时什么都不写——原位写回没有\"空产物\"这个选项", async () => {
    const ctx = { user_input: "x" } as NarrativeContext;
    const llm = stubLlm({ content: "x" });
    await deaiPolish(ctx, llm);
    expect(llm.users).toHaveLength(0);
    // 写一份空剧本会把基准字段清空，比"这一步没跑"糟得多；由 requiredInputs 闸门记 skipped。
    expect((ctx as Record<string, unknown>).plots_generated).toBeUndefined();
    expect(mergePolishedIntoBase(DEAI_SPEC, ctx, [])).toBeUndefined();
  });

  it("玩法适配打磨的是细纲那一层，不是情节", async () => {
    const ctx = {
      user_input: "x",
      detailed_outlines_generated: {
        detailed_outlines: [{ node_id: "d1", content: "分叉点" }],
      },
      plots_generated: { plots: [{ node_id: "n1", content: "情节" }] },
    } as unknown as NarrativeContext;

    const plotsBefore = (ctx as Record<string, unknown>).plots_generated;
    await playabilityAdapt(ctx, stubLlm({ content: "两条支线代价不同了" }));

    const base = (ctx as Record<string, unknown>).detailed_outlines_generated as {
      detailed_outlines: Array<{ node_id: string; content: string }>;
    };
    expect(base.detailed_outlines.map((n) => n.node_id)).toEqual(["d1"]);
    expect(base.detailed_outlines[0].content).toBe("两条支线代价不同了");
    expect((ctx as Record<string, unknown>).plots_generated).toBe(plotsBefore);
    expect(STEP_REGISTRY.get("playability_adapt")!.dependsOn).toEqual(["detailed_outline"]);
  });

  it("节点过滤器生效（重跑单个节点时不重打磨全篇）", () => {
    const ctx = plotCtx(3);
    (ctx as Record<string, unknown>)._nodeFilter = ["n2"];
    expect(polishTargetNodes(DEAI_SPEC, ctx).map((n) => n.node_id)).toEqual(["n2"]);
  });

  it("四席共用机制、各自提示词不同（否则等于同一席跑四遍）", () => {
    const ctx = plotCtx();
    const systems = POLISH_SEAT_SPECS.map((s) =>
      composeSystemPrompt(buildPolishComposer(s), ctx),
    );
    expect(new Set(systems).size).toBe(POLISH_SEAT_SPECS.length);
  });

  it("打磨四席不进任何默认步序（用哪一版由作者拍板）", async () => {
    const { NARRATIVE_PIPELINES, expandPipelineSteps } = await import("../routing/narrative-pipelines.js");
    for (const pipeline of Object.values(NARRATIVE_PIPELINES)) {
      const steps = expandPipelineSteps(pipeline, { includePlanned: true });
      for (const spec of POLISH_SEAT_SPECS) {
        expect(steps, `${pipeline.id}/${spec.stepId}`).not.toContain(spec.stepId);
      }
    }
  });
});
