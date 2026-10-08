import { describe, it, expect } from "vitest";
import { buildRunManifest } from "../runtime/run-manifest-builder.js";
import { findGenreByCode } from "../../knowledge/genre-taxonomy.js";

/**
 * 三期路由换轴（PRD v1.4 §3.2.2）：
 *   - 叙事层级降级为品类的只读派生属性，客户端传的 tier 不再能覆盖品类
 *   - 叙事结构由品类/类型/题材三轴综合推导，结论写回 manifest.config
 *   - 未换轴的旧条目（只有 tier/mode）照常出管线
 */
describe("路由换轴：tier 降级为派生属性", () => {
  it("给了品类就以品类的 tier 为准，客户端传的 tier 被忽略", () => {
    // rpg-jrpg 在词表里是 tier1；即便客户端硬塞 tier4 也不生效。
    expect(findGenreByCode("rpg-jrpg")?.tier).toBe("tier1");
    const m = buildRunManifest({ config: { genreCode: "rpg-jrpg", tier: "tier4" } });
    expect(m.config.tier).toBe("tier1");
  });

  it("没选专家时才用客户端 tier 兜底预览", () => {
    const m = buildRunManifest({ config: { tier: "tier4" } });
    expect(m.config.tier).toBe("tier4");
    expect(m.agents.length).toBeGreaterThan(0);
  });
});

describe("路由换轴：叙事结构综合", () => {
  it("结构由三轴推导并写回 config", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg", storyType: "drama", storyTheme: "workplace" },
    });
    expect(m.config.narrativeStructure).toBeTruthy();
    expect(m.config.structureSource).toBe("vote");
    expect(m.config.storyType).toBe("drama");
    expect(m.config.storyTheme).toBe("workplace");
  });

  // 结构是三轴比较出来的，不是品类的只读派生属性：另两轴必须有改写结论的能力。
  it("类型与题材真的参与投票，不是只被记录下来", () => {
    const genreOnly = buildRunManifest({ config: { genreCode: "rpg-jrpg" } });
    const allThree = buildRunManifest({
      config: { genreCode: "rpg-jrpg", storyType: "drama", storyTheme: "workplace" },
    });
    expect(allThree.config.narrativeStructure).not.toBe(genreOnly.config.narrativeStructure);
  });

  it("开放世界品类推出多线交织", () => {
    const m = buildRunManifest({ config: { genreCode: "rpg-open-world" } });
    expect(m.config.narrativeStructure).toBe("multiline");
  });

  it("用户显式指定的结构不被推导覆盖", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg", narrativeStructure: "nested" },
    });
    expect(m.config.narrativeStructure).toBe("nested");
    expect(m.config.structureSource).toBe("explicit");
  });

  it("三轴皆空时结构为 null 而不是瞎猜一个", () => {
    const m = buildRunManifest({ config: { mode: "narrative_auto" } });
    expect(m.config.narrativeStructure).toBeNull();
    expect(m.config.structureSource).toBe("none");
  });
});

describe("历史条目兼容", () => {
  it("旧条目（tier + mode，无三轴）照常出管线，新字段落为 null", () => {
    const m = buildRunManifest({
      config: { tier: "tier1", mode: "narrative_auto", complexity: 3 },
    });
    expect(m.agents.length).toBeGreaterThan(0);
    expect(m.config.storyType).toBeNull();
    expect(m.config.storyTheme).toBeNull();
    expect(m.complete).toBe(true);
  });

  // 步序由 tier/mode 决定，结构由三轴决定：补选三轴会改写结构结论，但不该动步序。
  it("旧条目补选三轴只改写结构结论，管线步序不变", () => {
    const before = buildRunManifest({ config: { genreCode: "rpg-jrpg", mode: "narrative_auto" } });
    const after = buildRunManifest({
      config: {
        genreCode: "rpg-jrpg",
        mode: "narrative_auto",
        storyType: "drama",
        storyTheme: "workplace",
      },
    });
    expect(after.agents.map((a) => a.agentId)).toEqual(before.agents.map((a) => a.agentId));
    expect(after.config.narrativeStructure).not.toBe(before.config.narrativeStructure);
  });
});
