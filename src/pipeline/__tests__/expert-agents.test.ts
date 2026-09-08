import { describe, it, expect } from "vitest";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import { GENRE_TAXONOMY } from "../../knowledge/genre-taxonomy.js";
import {
  NARRATIVE_PIPELINES,
  resolveSeatStepGroups,
} from "../routing/narrative-pipelines.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

function childrenOf(agentId: string): string[] {
  const def = getAgentDef(agentId);
  expect(def, `${agentId} 未注册`).toBeTruthy();
  expect(def!.structure.type, agentId).toBe("composite");
  return def!.structure.type === "composite" ? def!.structure.config.children : [];
}

describe("品类专家 = 席位管线的编排", () => {
  it("四条管线各有一个 composite，children 就是席位展开", () => {
    for (const pipeline of Object.values(NARRATIVE_PIPELINES)) {
      const tier = pipeline.tiers[0] ?? "tier1";
      const genreCode = pipeline.genreOverrides[0] ?? "";
      const { stepGroups } = resolveSeatStepGroups(genreCode, tier);
      expect(childrenOf(pipeline.id), pipeline.id).toEqual(stepGroups);
    }
  });

  it("117 个品类专家都注册了，且步序与运行时路由同源", () => {
    const mismatched: string[] = [];
    for (const genre of GENRE_TAXONOMY) {
      const { stepGroups } = resolveSeatStepGroups(genre.code, genre.tier);
      const children = childrenOf(`expert.genre.${genre.code}`);
      if (JSON.stringify(children) !== JSON.stringify(stepGroups)) {
        mismatched.push(genre.code);
      }
    }
    expect(mismatched, "专家步序与 resolveSeatStepGroups 不一致").toEqual([]);
    expect(GENRE_TAXONOMY.length).toBeGreaterThan(100);
  });

  it("专家形态是 nested，可嵌子节点", () => {
    expect(getAgentDef("expert.jrpg")?.prototype).toBe("nested");
  });

  it("画布静态专家指向各自品类该走的那条管线", () => {
    const { stepGroups: jrpg } = resolveSeatStepGroups("rpg-jrpg", "tier1");
    expect(childrenOf("expert.jrpg")).toEqual(jrpg);

    // 影游是全表唯一走分镜线的品类：交付分镜而不是任务
    const filmGame = childrenOf("expert.film_game");
    expect(filmGame).toEqual(childrenOf("pl-film-game"));
    expect(filmGame).not.toEqual(jrpg);
  });

  // "专家不再摊平老的 JRPG_PIPELINE_STEPS" 一条已随 D1 迁到
  // `_archive/jrpg/__tests__/expert-agents-jrpg-legacy.test.ts`
  // （`JRPG_PIPELINE_STEPS` 常量本体随 D1 封存进 `_archive/jrpg/templates.ts`）。

  it("历史别名 tpl-jrpg 仍可解析，且与新管线同源", () => {
    expect(childrenOf("tpl-jrpg")).toEqual(childrenOf("pl-narrative"));
  });
});
