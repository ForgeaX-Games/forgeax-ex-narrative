/**
 * 首跑跳步的守卫。
 *
 * 被守的缺口：从前只有 `rerunFromStep` 认 `skipSteps`，首跑不认，于是「这一步的产物
 * 已经由别处给定了」在首跑里无法表达。唯一的近似手段是预填 ctx —— 而预填并不跳步：
 * `requiredInputs` 一满足，step 照跑并把预填值覆盖掉。这里把两件事都钉住：跳步得声明，
 * 预填不算声明。
 */
import { describe, it, expect } from "vitest";
import { NarrativePipeline } from "../core/pipeline.js";
import { MODE_CONFIGS } from "../routing/modes.js";
import type { NarrativeContext, ProgressEvent } from "../../types/index.js";

const CHAIN = ["worldview", "character_enrichment", "item_database"];

/**
 * 全跳的 run() 不发请求，所以假凭据够用。
 *
 * `proxyUrl` 指向必然连不上的端口：万一某步没被跳掉真去调模型，请求会立刻
 * ECONNREFUSED 而不是打到线上，测试也不依赖网络。
 */
const CREDS = {
  apiKey: "test-key",
  proxyUrl: "http://127.0.0.1:1/v1",
  proxyApiKey: "test-proxy-key",
};

function collector(): { frames: ProgressEvent[]; onProgress: (e: ProgressEvent) => void } {
  const frames: ProgressEvent[] = [];
  return { frames, onProgress: (e) => frames.push(e) };
}

/** 某步的帧里是否出现过"正在执行" —— 即它真的被派发了。 */
function ran(frames: ProgressEvent[], stepId: string): boolean {
  return frames.some((f) => f.stepId === stepId && f.status === "running");
}

function messageOf(frames: ProgressEvent[], stepId: string): string {
  return frames.find((f) => f.stepId === stepId && f.status === "completed")?.message ?? "";
}

describe("skipSteps on the first run", () => {
  it("skips the listed steps without dispatching them", async () => {
    const { frames, onProgress } = collector();
    const pipeline = new NarrativePipeline({
      ...CREDS,
      genreCode: "rpg-jrpg",
      requestedSteps: CHAIN,
      skipSteps: CHAIN,
      onProgress,
    });

    const ctx = await pipeline.run("一个测试需求");

    for (const stepId of CHAIN) {
      expect(ran(frames, stepId)).toBe(false);
      // 跳过的步仍然报 completed：对调用方而言这一步是"有着落"的，不是失败。
      expect(messageOf(frames, stepId)).toContain("已跳过");
    }
    // 没执行就没产物：三步的输出字段都不该出现。
    expect(ctx.worldview_structure).toBeUndefined();
    expect(ctx.detailed_character_sheets).toBeUndefined();
    expect(ctx.item_database).toBeUndefined();
  });

  it("keeps pre-filled values of skipped steps intact", async () => {
    const seeded = {
      user_input: "一个测试需求",
      worldview_structure: { world_name: "原作世界" },
    } as unknown as NarrativeContext;

    const pipeline = new NarrativePipeline({
      ...CREDS,
      genreCode: "rpg-jrpg",
      requestedSteps: CHAIN,
      skipSteps: CHAIN,
      resumeCtx: seeded,
    });

    const ctx = await pipeline.run("一个测试需求");
    expect(ctx.worldview_structure?.world_name).toBe("原作世界");
  });

  /**
   * 计划里点名的陷阱，反向钉住：预填不等于跳过。
   *
   * 只有这条断言成立，上面两条才有意义 —— 否则「跳过」可能只是预填的副作用，
   * skipSteps 到底有没有接上无从分辨。
   *
   * run() 在这里注定失败（那一步会去调不可达的模型），所以不等它结束：看见
   * "正在执行"帧就已经证明了预填没能阻止派发。
   */
  it("a pre-filled field does not skip its step", async () => {
    const seeded = {
      user_input: "一个测试需求",
      worldview_structure: { world_name: "原作世界" },
    } as unknown as NarrativeContext;

    const dispatched = new Promise<string>((resolve) => {
      const pipeline = new NarrativePipeline({
        ...CREDS,
        genreCode: "rpg-jrpg",
        requestedSteps: ["worldview"],
        resumeCtx: seeded,
        onProgress: (e) => {
          if (e.status === "running" && e.stepId === "worldview") resolve(e.stepId);
        },
      });
      void pipeline.run("一个测试需求").catch(() => {});
    });

    expect(await dispatched).toBe("worldview");
  }, 30_000);

  it("distinguishes an explicit skip from a resumed step in what it reports", async () => {
    const { frames, onProgress } = collector();
    const pipeline = new NarrativePipeline({
      ...CREDS,
      genreCode: "rpg-jrpg",
      requestedSteps: CHAIN,
      skipSteps: ["worldview"],
      // resume 前缀覆盖后两步：它们该说"已恢复"，worldview 该说"已跳过"。
      resumeCtx: { user_input: "一个测试需求" } as unknown as NarrativeContext,
      resumeAfterStep: "item_database",
      onProgress,
    });

    await pipeline.run("一个测试需求");

    expect(messageOf(frames, "worldview")).toContain("已跳过");
    expect(messageOf(frames, "character_enrichment")).toContain("已恢复");
    expect(messageOf(frames, "item_database")).toContain("已恢复");
  });
});

describe("skipSteps across every execution path", () => {
  /**
   * `runWithBlueprint` 是与 run() 平行的另一条执行路径，有自己的 skip 分支。
   * 少接一条就成了「跳步生不生效看走哪条路径」—— 那比不支持更难查。
   *
   * 这条路径按 (genreCode, mode, tier) 自己组装步序，不认 `requestedSteps`，所以跳过
   * 清单取自 mode 的真实步序而不是 CHAIN。清单从 `MODE_CONFIGS` 读、不手抄：抄漏一步
   * 就会漏出一个真实请求，测试转而去验"请求失败"，本来要验的跳步反倒没验。
   */
  it("holds on the blueprint path too", async () => {
    const mode = "item_lore";
    const steps = MODE_CONFIGS.find((m) => m.id === mode)!.steps;
    const { frames, onProgress } = collector();
    const pipeline = new NarrativePipeline({
      ...CREDS,
      genreCode: "rpg-jrpg",
      mode,
      skipSteps: steps,
      onProgress,
    });

    await pipeline.runWithBlueprint("一个测试需求");

    for (const stepId of steps) {
      expect(ran(frames, stepId)).toBe(false);
      expect(messageOf(frames, stepId)).toContain("已跳过");
    }
  });
});

describe("skipSteps across run and rerun", () => {
  /**
   * 两个来源都要生效：config 是运行级配置，options 是本次重跑的指令。
   * 只认 options 会让「配了 skipSteps 的管线一重跑就又跑起来」—— 这里三步分属两个
   * 来源，合起来才覆盖全链，所以漏掉任一来源都会派发出请求。
   */
  it("merges the pipeline-level skip list with the per-rerun one", async () => {
    const { frames, onProgress } = collector();
    const pipeline = new NarrativePipeline({
      ...CREDS,
      genreCode: "rpg-jrpg",
      requestedSteps: CHAIN,
      skipSteps: ["worldview"],
      onProgress,
    });

    const ctx = { user_input: "一个测试需求" } as unknown as NarrativeContext;
    await pipeline.rerunFromStep(ctx, "worldview", {
      skipSteps: ["character_enrichment", "item_database"],
    });

    for (const stepId of CHAIN) expect(ran(frames, stepId)).toBe(false);
  });
});
