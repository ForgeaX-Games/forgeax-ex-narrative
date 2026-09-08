import { describe, it, expect } from "vitest";
import { STEP_REGISTRY } from "../core/step-registry.js";
import {
  resolveStepOutput,
  applyStepOutput,
  stepOutputCtxKey,
  compositeOutputStepIds,
} from "../core/step-output.js";
import { STEP_FILE_MAP } from "../runtime/step-files.js";
import {
  NARRATIVE_PIPELINES,
  expandPipelineSteps,
  type NarrativePipelineId,
} from "../routing/narrative-pipelines.js";
import type { NarrativeContext } from "../../types/index.js";
import "../core/step-registrations.js";

/**
 * 「这一步产出哪个 ctx 字段」的防复发闸门。
 *
 * 这件事实曾经分记在四处，其中两处是手写字面量：管线的 extractStepOutput 与
 * server 的 STEP_CTX_KEY。新注册一个 step 时忘了同步它们不会报错——步会照跑、
 * 照烧 LLM 调用，只是产物取不出来、落不了盘，前端"已生成"卡片打开是空白。
 * 结构检查、内容检查、打磨三席、玩法适配、百科娘七席就是这么丢的。
 *
 * 收敛成从注册表派生之后，这组断言守的是「派生真的覆盖得住」：注册表里每个
 * step 都必须能被落盘路径取到值，且取的就是它自己声明的那个字段。
 */

const composites = new Set(compositeOutputStepIds());

function ctxWith(fields: Record<string, unknown>): NarrativeContext {
  return fields as unknown as NarrativeContext;
}

describe("step-output：注册表派生覆盖", () => {
  it("注册表里每个 step 都能派生出 ctx 键", () => {
    const missing: string[] = [];
    for (const [id] of STEP_REGISTRY) {
      if (composites.has(id)) continue;
      if (!stepOutputCtxKey(id)) missing.push(id);
    }
    expect(missing).toEqual([]);
  });

  it("派生出的键就是注册表自己声明的 extractOutputKey", () => {
    const drift: string[] = [];
    for (const [id, desc] of STEP_REGISTRY) {
      if (composites.has(id)) continue;
      const declared = desc.extractOutputKey ?? desc.outputFields[0];
      if (stepOutputCtxKey(id) !== declared) drift.push(id);
    }
    expect(drift).toEqual([]);
  });

  it("注册表里每个 step 的产出都能被 resolveStepOutput 真取到", () => {
    const unreachable: string[] = [];
    for (const [id, desc] of STEP_REGISTRY) {
      if (composites.has(id)) continue;
      const key = desc.extractOutputKey ?? desc.outputFields[0];
      const probe = { __probe: id };
      if (resolveStepOutput(id, ctxWith({ [key]: probe })) !== probe) unreachable.push(id);
    }
    expect(unreachable).toEqual([]);
  });

  it("有落盘文件名的 step 都取得到数据——取不到就是跑完不落盘", () => {
    const noKey: string[] = [];
    for (const id of Object.keys(STEP_FILE_MAP)) {
      if (composites.has(id)) continue;
      if (!stepOutputCtxKey(id)) noKey.push(id);
    }
    expect(noKey).toEqual([]);
  });

  it("此前静默丢产物的七席现在都在覆盖内", () => {
    const regressed = [
      "structure_check",
      "content_check",
      "deai_polish",
      "plot_refine",
      "plot_polish",
      "playability_adapt",
      "encyclopedia_retrieval",
    ];
    for (const id of regressed) {
      const key = stepOutputCtxKey(id);
      expect(key, `${id} 派生不到 ctx 键`).toBeTruthy();
      const probe = { __probe: id };
      expect(resolveStepOutput(id, ctxWith({ [key!]: probe }))).toBe(probe);
    }
  });
});

/**
 * 上面几组守的是「注册表里的步都取得到」，这一组换个方向问：真实管线展开后的
 * 每一步，是不是都落得出一个文件？
 *
 * 两者不是同一件事。注册表覆盖全但不代表某条管线的步序里没有夹着一个没有文件名
 * 的步；而用户看得见的恰恰是"跑完左栏该多几份产物"。`pl-narrative` 末尾两个检查席
 * 此前跑完不落盘，就是这一层没人守。
 */
describe("step-output：真实管线步序逐步落得出文件", () => {
  // 纯路由步：不产内容，产物由 companion 拆开落（tier_router → T0/T1 两份），
  // 或压根不该有文件（pipeline_config 只是把路由决定记进 manifest）。
  const ROUTING_ONLY = new Set(["tier_router", "pipeline_config"]);

  function assertEveryStepLands(
    pipelineId: NarrativePipelineId,
    activate: string[] = [],
  ): string[] {
    const p = NARRATIVE_PIPELINES[pipelineId];
    expect(p, pipelineId).toBeTruthy();
    const steps = expandPipelineSteps(p, { activateOptionalSeats: activate });
    const noFile: string[] = [];
    for (const id of steps) {
      if (ROUTING_ONLY.has(id)) continue;
      const hasFile = STEP_FILE_MAP[id] != null;
      const reachable = composites.has(id) || stepOutputCtxKey(id) != null;
      if (!hasFile || !reachable) noFile.push(id);
    }
    expect(noFile, `${pipelineId} 有步落不出文件`).toEqual([]);
    return steps;
  }

  it("pl-narrative 默认步序每一步都有落盘去处", () => {
    const steps = assertEveryStepLands("pl-narrative");
    // 此前静默丢产物的末尾两席，必须真在默认步序里。
    expect(steps).toContain("structure_check");
    expect(steps).toContain("content_check");
  });

  it("其余三条管线同样逐步落得出文件", () => {
    for (const id of ["pl-film-game", "pl-codex", "pl-card"] as NarrativePipelineId[]) {
      assertEveryStepLands(id);
    }
  });

  it("挂上打磨席后新增的那步也落得出文件，且沿用基准步的文件名", () => {
    const steps = assertEveryStepLands("pl-narrative", ["deai", "plot_refine", "plot_polish"]);
    for (const id of ["deai_polish", "plot_refine", "plot_polish"]) {
      expect(steps, id).toContain(id);
      // 同形变换：打磨完还是那份情节节点，不该多出一个文件名。
      expect(STEP_FILE_MAP[id], id).toEqual(STEP_FILE_MAP.plot_generation);
    }
  });
});

describe("step-output：读写对称", () => {
  it("普通步写进去能原样读出来", () => {
    const ctx = ctxWith({});
    expect(applyStepOutput("worldview", ctx, { a: 1 })).toBe(true);
    expect(resolveStepOutput("worldview", ctx)).toEqual({ a: 1 });
  });

  it("复合步 initial_plan 按子字段拆写，不会把聚合对象误当 outline", () => {
    const ctx = ctxWith({});
    applyStepOutput("initial_plan", ctx, {
      initial_story_outline: "o",
      core_settings: { c: 1 },
      plot_synopsis: "p",
    });
    const raw = ctx as unknown as Record<string, unknown>;
    expect(raw.initial_story_outline).toBe("o");
    expect(raw.core_settings).toEqual({ c: 1 });
    expect(raw.plot_synopsis).toBe("p");
    expect(resolveStepOutput("initial_plan", ctx)).toEqual({
      initial_story_outline: "o",
      core_settings: { c: 1 },
      plot_synopsis: "p",
    });
  });

  it("三段全空的 initial_plan 不产出半成品对象", () => {
    expect(resolveStepOutput("initial_plan", ctxWith({}))).toBeUndefined();
  });

  it("复合步 script_scene_generation 同时带出剧本与场景", () => {
    const ctx = ctxWith({ jrpg_script: { s: 1 }, scene_map: { m: 2 } });
    expect(resolveStepOutput("script_scene_generation", ctx)).toEqual({
      jrpg_script: { s: 1 },
      scene_map: { m: 2 },
    });
  });

  it("未知 step 取不到值也写不进去", () => {
    const ctx = ctxWith({});
    expect(resolveStepOutput("no_such_step", ctx)).toBeUndefined();
    expect(applyStepOutput("no_such_step", ctx, 1)).toBe(false);
  });

  it("封存步仍可读，旧存档回放不会开天窗", () => {
    expect(resolveStepOutput("branch_tree", ctxWith({ branch_tree: [1] }))).toEqual([1]);
    expect(resolveStepOutput("emergent_event", ctxWith({ emergent_events: [2] }))).toEqual([2]);
  });
});
