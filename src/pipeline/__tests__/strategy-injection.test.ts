import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "../runtime/prompt-composer.js";
import type { NarrativeContext } from "../../types/index.js";
import { PREFERENCE_SUMMARY_COMPOSER } from "../steps/user-preference-summary.js";
import { INITIAL_PLAN_COMPOSER } from "../steps/initial-plan.js";
import { OUTLINE_PLAN_COMPOSER } from "../steps/outline-batch.js";
import { DETAIL_PLAN_COMPOSER } from "../steps/detailed-outline-batch.js";
import { WORLDVIEW_COMPOSER } from "../steps/worldview-construction.js";

/**
 * 策略段端到端：四轴 code 进 ctx → 策略库按 code 找 md → 渲染进骨架第 ③ 段。
 * 样例卡（rpg-jrpg / drama / workplace / linear）是链路的活体探针，
 * 换成任何其他 code 只要库里有对应 md 就同样生效。
 */
function ctxWithAxes(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    user_input: "写一个关于职场的成长故事",
    tier_detection: { genre_code: "rpg-jrpg" },
    narrative_axes: { storyType: "drama", storyTheme: "workplace", structure: "linear" },
    ...overrides,
  } as unknown as NarrativeContext;
}

describe("叙事策略段注入", () => {
  it("四轴齐备时，四张策略卡按品类→类型→题材→结构的顺序进提示词", () => {
    const sp = composeSystemPrompt(PREFERENCE_SUMMARY_COMPOSER, ctxWithAxes());
    expect(sp).not.toContain("{{slot:");

    const iGenre = sp.indexOf("游戏品类叙事策略：JRPG");
    const iType = sp.indexOf("叙事类型策略：剧情（Drama）");
    const iTheme = sp.indexOf("叙事题材策略：职场（Workplace）");
    const iStructure = sp.indexOf("叙事结构策略：线性结构");
    expect(iGenre).toBeGreaterThanOrEqual(0);
    expect(iType).toBeGreaterThan(iGenre);
    expect(iTheme).toBeGreaterThan(iType);
    expect(iStructure).toBeGreaterThan(iTheme);

    // 策略段在身份之后、本 step 原有内容之前
    expect(sp.indexOf("叙事需求分析专家")).toBeLessThan(iGenre);
    expect(sp.indexOf("## 提取要素")).toBeGreaterThan(iStructure);
  });

  it("四席环节都拿得到策略卡", () => {
    for (const composer of [
      PREFERENCE_SUMMARY_COMPOSER,
      INITIAL_PLAN_COMPOSER,
      OUTLINE_PLAN_COMPOSER,
      DETAIL_PLAN_COMPOSER,
    ]) {
      const sp = composeSystemPrompt(composer, ctxWithAxes());
      expect(sp, composer.stepId).toContain("叙事结构策略：线性结构");
      expect(sp, composer.stepId).not.toContain("{{slot:");
    }
  });

  it("品类走配置注入的那一轴：管线里没有检测步也拿得到品类策略卡", () => {
    // 品类专家管线（tpl-jrpg 等）不跑 demand_analysis / tier_detection，
    // 品类只能从 narrative_axes.genre 来。这条断言防止品类卡在主管线上静默失踪。
    const sp = composeSystemPrompt(PREFERENCE_SUMMARY_COMPOSER, {
      user_input: "写一个关于职场的成长故事",
      narrative_axes: {
        genre: "rpg-jrpg",
        storyType: "drama",
        storyTheme: "workplace",
        structure: "linear",
      },
    } as unknown as NarrativeContext);
    expect(sp).toContain("游戏品类叙事策略：JRPG");
  });

  it("检测结果只在配置没给品类时兜底", () => {
    const sp = composeSystemPrompt(
      PREFERENCE_SUMMARY_COMPOSER,
      ctxWithAxes({
        narrative_axes: { genre: null, storyType: "drama" },
      } as Partial<NarrativeContext>),
    );
    expect(sp).toContain("游戏品类叙事策略：JRPG");
  });

  it("非四席环节即便四轴齐备也不注入策略卡", () => {
    const sp = composeSystemPrompt(WORLDVIEW_COMPOSER, ctxWithAxes());
    expect(sp).not.toContain("叙事结构策略");
    expect(sp).not.toContain("{{slot:");
  });

  it("缺轴只是该子槽为空，其余三轴照常装配", () => {
    const sp = composeSystemPrompt(
      PREFERENCE_SUMMARY_COMPOSER,
      ctxWithAxes({ narrative_axes: { storyType: "drama", storyTheme: null, structure: null } }),
    );
    expect(sp).toContain("游戏品类叙事策略：JRPG");
    expect(sp).toContain("叙事类型策略：剧情（Drama）");
    expect(sp).not.toContain("叙事题材策略");
    expect(sp).not.toContain("叙事结构策略");
  });

  /**
   * 用**不在词表里**的 code，不用"词表里有但库里缺卡"的 code。
   *
   * 这条断言原先取 tragedy / cyberpunk / network，因为当时那三张卡还没写。那个前提会随
   * 补卡消失：三个轴补齐之后它就红了，而红的原因是库变全了 —— 测试把"库还不全"当成了
   * 被测行为。要守的其实是 loader 的容错（找不到卡就留空，不抛也不留占位），那与词表
   * 补到什么程度无关，所以拿一个永远不会有卡的 code 才问得准。
   */
  it("找不到卡的轴静默留空，不报错也不留占位", () => {
    const sp = composeSystemPrompt(
      PREFERENCE_SUMMARY_COMPOSER,
      ctxWithAxes({
        narrative_axes: {
          storyType: "no-such-type" as never,
          storyTheme: "no-such-theme" as never,
          structure: "no-such-structure" as never,
        },
      }),
    );
    expect(sp).toContain("游戏品类叙事策略：JRPG");
    expect(sp).not.toContain("叙事类型策略");
    expect(sp).not.toContain("叙事题材策略");
    expect(sp).not.toContain("叙事结构策略");
    expect(sp).not.toContain("{{slot:");
  });

  it("三轴都补齐了卡时，三段都注入", () => {
    // 上一条只证明"找不到就留空"。这一条是它的反面：找得到就真的进提示词。
    // 少了它，把策略注入整体关掉也能让上一条绿。
    const sp = composeSystemPrompt(
      PREFERENCE_SUMMARY_COMPOSER,
      ctxWithAxes({
        narrative_axes: { storyType: "tragedy", storyTheme: "cyberpunk", structure: "network" },
      }),
    );
    expect(sp).toContain("叙事类型策略：悲剧（Tragedy）");
    expect(sp).toContain("叙事题材策略：赛博朋克（Cyberpunk）");
    expect(sp).toContain("叙事结构策略");
  });

  it("未换轴的旧条目（无 narrative_axes）行为不变：整段塌缩", () => {
    const legacy = { user_input: "x" } as unknown as NarrativeContext;
    const sp = composeSystemPrompt(PREFERENCE_SUMMARY_COMPOSER, legacy);
    expect(sp).not.toContain("叙事策略");
    expect(sp).not.toContain("{{slot:");
    expect(sp).not.toMatch(/\n{3,}/);
  });
});
