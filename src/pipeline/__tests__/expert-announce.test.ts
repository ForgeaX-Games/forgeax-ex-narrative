/**
 * 画布上「这是谁在跑、跑的是哪条管线、每步属于哪一席」三件事的守卫。
 *
 * 起因是一次实跑：用户拖的是「互动叙事专家」，生成后容器顶上写着
 * 「叙事管线（分镜）」（管线内部名），组内又是「偏好总结 / 偏好分析」两张卡，
 * 于是判断成「专家选错了 + 还在跑老 agent」。实际路由没错，是三处命名各说各话。
 */
import { describe, it, expect } from "vitest";
import { expertDisplayName } from "../routing/expert-agents.js";
import { seatGroupsForSteps } from "../routing/seat-attribution.js";
import { BANNER_STEP_IDS, stepDisplayNames } from "../core/step-registry.js";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import { GENRE_TAXONOMY, findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import {
  NARRATIVE_PIPELINES,
  resolveNarrativePipeline,
  resolveSeatStepGroups,
} from "../routing/narrative-pipelines.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

const PIPELINE_NAMES = new Set(
  Object.values(NARRATIVE_PIPELINES).map((p) => p.name),
);

describe("专家显示名", () => {
  it("与顶栏调色板同一构词：{品类}专家", () => {
    expect(expertDisplayName("adv-interactive")).toBe("互动叙事专家");
    expect(expertDisplayName("rpg-jrpg")).toBe("JRPG专家");
  });

  it("无品类时退回「其他品类叙事专家」，与无品类专家项同名", () => {
    expect(expertDisplayName(null)).toBe("其他品类叙事专家");
    expect(expertDisplayName("not-a-genre")).toBe("其他品类叙事专家");
  });

  it("不会是管线内部名——容器标题写「叙事管线（分镜）」正是上一版的病", () => {
    for (const genre of GENRE_TAXONOMY) {
      expect(PIPELINE_NAMES.has(expertDisplayName(genre.code)), genre.code).toBe(false);
    }
  });

  it("与注册的品类专家 AgentDef 名字同源", () => {
    for (const genre of GENRE_TAXONOMY) {
      const def = getAgentDef(`expert.genre.${genre.code}`);
      expect(def?.name, genre.code).toBe(expertDisplayName(genre.code));
    }
  });
});

describe("席位归属", () => {
  it("影游走分镜管线，而不是旧的 tpl-vn-v2 模板", () => {
    const entry = findGenreByCode("adv-interactive")!;
    expect(resolveNarrativePipeline(entry.code, entry.tier).id).toBe("pl-film-game");
  });

  it("一席多步的段落被聚到同一席（需求清单席 = 偏好总结 + 偏好分析）", () => {
    const groups = seatGroupsForSteps(["preference_summary", "preference_analysis"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("req_list");
    expect(groups[0].steps).toEqual(["preference_summary", "preference_analysis"]);
  });

  it("管线里每一步都能归到某一席，且席名不是 step 名", () => {
    for (const genre of [findGenreByCode("adv-interactive")!, findGenreByCode("rpg-jrpg")!]) {
      const { stepGroups } = resolveSeatStepGroups(genre.code, genre.tier);
      const groups = seatGroupsForSteps(stepGroups);
      expect(groups.flatMap((g) => g.steps), genre.code).toEqual(stepGroups);
      for (const g of groups) expect(g.name.length, g.id).toBeGreaterThan(0);
    }
  });

  it("元节点不进任何席位段", () => {
    expect(seatGroupsForSteps(["pipeline_config", "tier_router"])).toEqual([]);
  });
});

/**
 * 环节名的真值只有一处：STEP_REGISTRY。
 *
 * 起因同上那次实跑：前端自带一份中文步名表、pipeline.ts 又抄了一列 name，
 * 改名要改三处，漏一处画布上就写着旧名。现在 announce 帧把注册表的名字带下去，
 * 前端那份表退成离线兜底——前提是这一帧真的每步都有名字。
 */
describe("announce 下发的步名", () => {
  it("席位管线的每一步都能从注册表取到名字（前端无须自带步名表）", () => {
    for (const genre of [findGenreByCode("adv-interactive")!, findGenreByCode("rpg-jrpg")!]) {
      const { stepGroups } = resolveSeatStepGroups(genre.code, genre.tier);
      const names = stepDisplayNames(stepGroups);
      const missing = stepGroups.filter((id) => !names[id]);
      expect(missing, `${genre.code} 缺名字的步`).toEqual([]);
    }
  });

  it("运行横幅不是 step，取不到注册表名字，也不该被当成节点", () => {
    for (const id of BANNER_STEP_IDS) {
      expect(stepDisplayNames([id])[id], id).toBeUndefined();
      expect(seatGroupsForSteps([id]), id).toEqual([]);
    }
  });
});
