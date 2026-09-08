/**
 * 自由编排真执行的守卫。
 *
 * 被守的分歧：`/plan` 早就按 requestedSteps 返回 composition-driven 的 manifest，而
 * 运行时（run / rerunFromStep / getStaleSteps）只按 (tier, mode, genreCode) 路由到预置管线。
 * 于是用户在画布上编排完、看到的预览是自己的链、点开始生成跑的是预置管线，且不报错。
 *
 * 这里断言两件事：
 *   1. 运行时以 config.requestedSteps 为准，优先于任何 mode / 席位路由；
 *   2. 影响面分析（"只重跑受影响环节"）也落在同一条链上 —— 三处不同源就会错位到别的步。
 */
import { describe, it, expect } from "vitest";
import { NarrativePipeline, isExecutableStep } from "../core/pipeline.js";
import { buildRunManifest } from "../runtime/run-manifest-builder.js";
import type { NarrativeContext } from "../../types/index.js";

const CHAIN = ["worldview", "character_enrichment", "item_database"];

/** getStaleSteps 不发请求，但构造器要求有凭据；给个假的即可。 */
const CREDS = { apiKey: "test-key" };

describe("free composition is honored at runtime", () => {
  it("stale-step analysis follows the composed chain, not the preset pipeline", () => {
    const composed = new NarrativePipeline({ ...CREDS, requestedSteps: CHAIN });
    expect(composed.getStaleSteps("character_enrichment", "narrative_auto")).toEqual([
      "character_enrichment",
      "item_database",
    ]);
  });

  it("the composed chain overrides mode routing", () => {
    const preset = new NarrativePipeline({ ...CREDS, genreCode: "rpg-jrpg", tier: "tier1" });
    const composed = new NarrativePipeline({
      ...CREDS,
      genreCode: "rpg-jrpg",
      tier: "tier1",
      requestedSteps: CHAIN,
    });
    // narrative_auto 的预设步序要靠 demand_analysis 才解析得出品类，否则无从对照。
    const ctx = {
      user_input: "x",
      demand_analysis: { genre_code: "rpg-jrpg" },
    } as unknown as NarrativeContext;
    // 预设链里 worldview 之后还有大纲/结构/情节/任务等一长串；编排链到 item_database 就收。
    expect(composed.getStaleSteps("worldview", "narrative_auto", ctx)).toEqual(CHAIN);
    expect(preset.getStaleSteps("worldview", "narrative_auto", ctx).length).toBeGreaterThan(
      CHAIN.length,
    );
  });

  it("dedupes while preserving order, matching the /plan manifest", () => {
    const dup = ["worldview", "character_enrichment", "worldview"];
    const planned = buildRunManifest({ config: {}, requestedSteps: dup }).agents.map(
      (a) => a.agentId,
    );
    const runtime = new NarrativePipeline({ ...CREDS, requestedSteps: dup }).getStaleSteps(
      "worldview",
      "narrative_auto",
    );
    // 两侧同一口径去重：错开一步就意味着预览里的第 N 步不是实跑的第 N 步。
    expect(planned).toEqual(["worldview", "character_enrichment"]);
    expect(runtime).toEqual(["worldview", "character_enrichment"]);
  });

  /**
   * 画布上能拖出来的每个单品助手节点，其 step 都必须真的跑得起来。
   *
   * run() 对没有执行函数的 id 静默丢弃 —— 这对预设管线是对的（planned 席位本该跳过），
   * 但自由编排下就是"用户连的节点一声不响消失、还报成功"。API 层因此用 isExecutableStep
   * 挡在启动前；本断言守住这个判据本身可用（表非空且认得出常见步）。
   */
  it("exposes an executability judgement for the API gate to use", () => {
    for (const id of CHAIN) expect(isExecutableStep(id)).toBe(true);
    expect(isExecutableStep("no_such_step")).toBe(false);
  });
});
