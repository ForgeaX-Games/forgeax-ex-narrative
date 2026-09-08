/**
 * Phase 4 骨干验证：全品类 Planner Step 0 覆盖。
 *
 * 验证「用户选品类 → Planner 第一步即可定位完整管线」对全部品类成立：
 *   - 除 tpl-vn-v2 / tpl-narrative-card（各自固定 preset 链）外，
 *     每个品类的 skill 都带 narrativeSteps，planPipeline 直接拼出
 *     通用前驱 + 专属叙事段，无需 needs 兜底。
 *
 * D1（2026-08）已封存：随 `planner/` 整体搬入 `_archive/planner/__tests__/`，
 * 理由见 `../README.md`——`planPipeline` 全仓零生产调用点，四条席位管线早已
 * 接管路由。仅用于回归比对被吸收前的原貌，不计入活跃测试套件的功能覆盖。
 */
import { describe, it, expect } from "vitest";
import "../../../../knowledge/game-narrative/skill-bootstrap.js";
import { GENRE_TAXONOMY } from "../../../../knowledge/genre-taxonomy.js";
import { loadSkill } from "../../../../knowledge/game-narrative/skill-loader.js";
import { planPipeline } from "../index.js";

const PRESET_FIXED = new Set(["tpl-vn-v2", "tpl-narrative-card"]);

describe("Phase 4 骨干：全品类 narrativeSteps 覆盖", () => {
  it("非 vn-v2 / 非 narrative-card 品类均带 narrativeSteps", () => {
    const missing: string[] = [];
    for (const entry of GENRE_TAXONOMY) {
      if (PRESET_FIXED.has(entry.pipelineTemplate)) continue;
      const skill = loadSkill(entry.code);
      if (!skill?.narrativeSteps || skill.narrativeSteps.length === 0) {
        missing.push(entry.code);
      }
    }
    expect(missing).toEqual([]);
  });

  it("planPipeline 对每个品类都拼出 通用前驱 + 专属段（首三步为偏好三件套）", () => {
    const bad: string[] = [];
    for (const entry of GENRE_TAXONOMY) {
      const out = planPipeline({
        genre_code: entry.code,
        tier: entry.tier,
        needs: entry.needs as Record<string, 0 | 1 | 2 | 3>,
        narrative_type: entry.narrative_type,
        pipelineTemplate: entry.pipelineTemplate,
      });
      const flat = out.stepGroups.flatMap((g) => (Array.isArray(g) ? g : [g]));
      if (flat.length === 0) bad.push(`${entry.code}:empty`);
      // narrativeSteps 路径首三步必为偏好三件套
      const skill = loadSkill(entry.code);
      if (skill?.narrativeSteps && skill.narrativeSteps.length > 0) {
        if (
          flat[0] !== "preference_summary" ||
          flat[1] !== "preference_analysis" ||
          flat[2] !== "initial_plan"
        ) {
          bad.push(`${entry.code}:bad-prelude`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("tpl-vn-v2（adv-interactive）preset 链含 vn_state_ledger 且与 templates.ts 规范链对齐", () => {
    const out = planPipeline({
      genre_code: "adv-interactive",
      tier: "tier1",
      needs: { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3 },
      narrative_type: "branching",
      pipelineTemplate: "tpl-vn-v2",
    });
    const flat = out.stepGroups.flatMap((g) => (Array.isArray(g) ? g : [g]));
    // G-01.5 世界状态账本必须存在（修复前 preset 漏此步）
    expect(flat).toContain("vn_state_ledger");
    // 必须排在分支节拍之后、剧本之前，与 templates.ts 规范链严格一致
    expect(flat.indexOf("vn_state_ledger")).toBeGreaterThan(flat.indexOf("vn_branched_beats"));
    expect(flat.indexOf("vn_state_ledger")).toBeLessThan(flat.indexOf("vn_screenplay"));
  });

  it("史诗品类（rpg-crpg）拼出完整 RPG 七单品链", () => {
    const out = planPipeline({
      genre_code: "rpg-crpg",
      tier: "tier1",
      needs: { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3 },
      narrative_type: "linear",
      pipelineTemplate: "tpl-rpg",
    });
    const flat = out.stepGroups.flatMap((g) => (Array.isArray(g) ? g : [g]));
    for (const s of ["worldview", "item_database", "story_framework", "script_generation"]) {
      expect(flat).toContain(s);
    }
  });
});
