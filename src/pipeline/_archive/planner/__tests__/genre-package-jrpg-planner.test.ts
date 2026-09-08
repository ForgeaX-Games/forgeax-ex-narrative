/**
 * genre-package-jrpg-planner.test.ts
 * ─────────────────────────────────────────────────────────────────
 * 原 `pipeline/__tests__/genre-package-jrpg.test.ts` 里唯一依赖 `planPipeline`
 * 的一个用例（"Planner 拼出 通用前驱 + 专属叙事段"）。其余三个用例
 * （skill.narrativeSteps 声明、PromptResolver 双层注入）与 planner 无关，
 * 仍留在原文件里继续跑。
 *
 * D1（2026-08）已封存：随 `planner/` 整体搬入 `_archive/planner/__tests__/`，
 * 理由见 `../README.md`——`planPipeline` 全仓零生产调用点，四条席位管线早已
 * 接管路由。仅用于回归比对被吸收前的原貌，不计入活跃测试套件的功能覆盖。
 */
import { describe, it, expect } from "vitest";
import "../../../../knowledge/game-narrative/skill-bootstrap.js";
import { planPipeline } from "../index.js";

describe("Phase 3: rpg-jrpg 品类叙事包闭环（planner 分支，已封存）", () => {
  it("Planner 拼出 通用前驱 + 专属叙事段", () => {
    const out = planPipeline({
      genre_code: "rpg-jrpg",
      tier: "tier1",
      needs: { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3 },
      narrative_type: "linear",
      pipelineTemplate: "tpl-rpg",
    });
    const flat = out.stepGroups.flatMap((g) => (Array.isArray(g) ? g : [g]));
    // 前驱
    expect(flat.slice(0, 3)).toEqual(["preference_summary", "preference_analysis", "initial_plan"]);
    // 专属段拼接
    expect(flat).toContain("worldview");
    expect(flat).toContain("story_framework");
    // 并行组保留。场景步 id 随 2026-08 的场景席方向拆分改名为 scene_plan
    // （见 `../../scene/README.md`），并行组的语义"任务 ∥ 场景"未变。
    expect(out.stepGroups.some((g) => Array.isArray(g) && g.includes("quest_generation") && g.includes("scene_plan"))).toBe(true);
  });
});
