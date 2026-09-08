import { describe, it, expect } from "vitest";
import {
  CAMERA_LANGUAGE,
  PROSE_CRAFT,
  TOPOLOGY_DISCIPLINE,
  expansionPrinciples,
} from "../prompt/narrative-craft.js";
import { OUTLINE_PLAN_COMPOSER, OUTLINE_FILL_COMPOSER } from "../steps/outline-batch.js";
import { DETAIL_PLAN_COMPOSER, DETAIL_FILL_COMPOSER } from "../steps/detailed-outline-batch.js";
import { PLOT_GENERATION_COMPOSER } from "../steps/plot-generation.js";
import { SCRIPT_GENERATION_COMPOSER } from "../steps/script-generation.js";
import { composeSystemPrompt } from "../runtime/prompt-composer.js";
import type { NarrativeContext } from "../../types/index.js";

const CTX = { user_input: "测试需求" } as NarrativeContext;

/**
 * 每条手艺条款都必须真的出现在**该席的 system prompt 里**，而不只是被 blocks
 * 收录——漏进 systemBlockOrder 是这里最容易犯且最不容易发现的错。
 */
describe("手艺条款按席位落位", () => {
  it("结构席（两层四个 composer）都吃分支纪律", () => {
    const anchor = "假分支";
    for (const c of [
      OUTLINE_PLAN_COMPOSER,
      OUTLINE_FILL_COMPOSER,
      DETAIL_PLAN_COMPOSER,
      DETAIL_FILL_COMPOSER,
    ]) {
      expect(composeSystemPrompt(c, CTX)).toContain(anchor);
    }
  });

  it("情节席吃正文写法与质量条款，不吃镜头语言", () => {
    const sp = composeSystemPrompt(PLOT_GENERATION_COMPOSER, CTX);
    expect(sp).toContain("每句台词都要有交付物");
    expect(sp).toContain("承载锚");
    expect(sp).not.toContain("正反打");
  });

  it("分镜席吃镜头语言，不重复整套正文条款", () => {
    const sp = composeSystemPrompt(SCRIPT_GENERATION_COMPOSER, CTX);
    expect(sp).toContain("正反打");
    expect(sp).not.toContain("承载锚");
  });

  it("三块条款互不重叠地各管一段", () => {
    expect(TOPOLOGY_DISCIPLINE).toContain("最优路径");
    expect(PROSE_CRAFT).toContain("殊途同归");
    expect(CAMERA_LANGUAGE).toContain("镜头语言");
    // 分镜条款不该混进拓扑判定，否则两席会各自解释一遍同一件事
    expect(CAMERA_LANGUAGE).not.toContain("最优路径");
    expect(TOPOLOGY_DISCIPLINE).not.toContain("正反打");
  });

  it("被剪掉的外部口径不得回流", () => {
    const all = [TOPOLOGY_DISCIPLINE, PROSE_CRAFT, CAMERA_LANGUAGE].join("\n");
    // 逐条对应 narrative-craft.ts 文件头「剪掉了什么」的清单
    for (const alien of [
      "emit_nodes",
      "ScriptNodePlan",
      "length_tier",
      "content_fidelity",
      "<character>",
      "script_input",
    ]) {
      expect(all).not.toContain(alien);
    }
  });

  it("展开原则按层参数化，不再各层抄一份", () => {
    const l1 = expansionPrinciples({
      upstream: "宏观框架",
      here: "大纲层",
      convergence: "不得因此产生新的结局",
    });
    expect(l1).toContain("宏观框架");
    expect(l1).toContain("不得因此产生新的结局");
    // 旧口径的三个术语名与三层脚手架都不该再出现
    for (const stale of ["命运必然论", "有限突变论", "L0", "L1", "L2"]) {
      expect(l1).not.toContain(stale);
    }
  });
});
