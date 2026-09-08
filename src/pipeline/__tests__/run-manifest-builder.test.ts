import { describe, it, expect } from "vitest";
import { buildRunManifest, buildEntryManifests } from "../runtime/run-manifest-builder.js";
import { splitCompositionByStartNodes } from "../../types/run-manifest.js";
import { MODE_CONFIGS } from "../routing/modes.js";

describe("buildRunManifest", () => {
  it("plans jrpg preset into ordered agents with pending lifecycle", () => {
    const m = buildRunManifest({
      entryKey: "test-jrpg",
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "planning",
      },
    });
    expect(m.status).toBe("planned");
    expect(m.complete).toBe(true);
    expect(m.agents.length).toBeGreaterThan(3);
    expect(m.agents.every((a) => a.lifecycle.status === "pending")).toBe(true);
    expect(m.agents[0]!.agentId).toBeTruthy();
    expect(m.promptLibrary).toBe("v1"); // 已退役字段，新建 manifest 固定写 v1（见 pipeline/_archive/jrpg/README.md §4）
  });

  it("honors requestedSteps over preset (free composition wins)", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg" },
      requestedSteps: ["worldview", "character_enrichment"],
    });
    expect(m.agents.map((a) => a.agentId)).toEqual([
      "worldview",
      "character_enrichment",
    ]);
  });

  /**
   * 专家组的默认步序 = 该品类的席位管线，**不含** D0-D4。
   * D0-D4 是游戏策划案（核心概念/系统架构/玩法设计/价值框架/策划文档整合），
   * 不在 PRD v1.4 §3.2.3 的通用流程里；它只在调用方显式选 design_* 时出现。
   */
  it("planning route runs the seat pipeline, with no D0-D4 prefix", () => {
    const ids = buildRunManifest({
      config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    // 与专家组 CSV 第 7 列逐环节对应：需求清单 → 策划文档 → 世界观设定 → 角色档案
    // → 道具清单 → 场景列表 → 故事大纲 → 故事结构 → 故事情节 → 任务 → 质检
    expect(ids).toEqual([
      "preference_summary",
      "preference_analysis",
      "initial_plan",
      "worldview",
      "character_enrichment",
      "item_database",
      "scene_plan",
      "story_framework",
      "outline_batch",
      "detailed_outline",
      "plot_generation",
      "quest_generation",
      // 质检两席：结构检查（图上的确定性判据）+ 内容检查（八项内容判据），
      // 内容检查席带场景取证子步（从剧情倒推场景，与前向清单对账）。
      "structure_check",
      "content_check",
      "scene_evidence",
    ]);
    for (const d of ["core_concept", "system_architecture", "value_framework", "design_doc"]) {
      expect(ids).not.toContain(d);
    }
  });

  it("design_* still prefixes D0-D4, then joins the same seat pipeline", () => {
    const ids = buildRunManifest({
      config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning", mode: "design_auto" },
    }).agents.map((a) => a.agentId);
    expect(ids.slice(0, 5)).toEqual([
      "core_concept",
      "system_architecture",
      "system_detail",
      "value_framework",
      "design_doc",
    ]);
    // 叙事段与纯叙事路径同源：两条路不该跑出不同步序
    expect(ids.slice(5)).toEqual(
      buildRunManifest({
        config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning" },
      }).agents.map((a) => a.agentId),
    );
  });

  // 选了层级但没选品类时，按层级归到四条之一（层级本就是"这游戏有多少叙事"的度量）。
  it("tier-only planning preview routes by tier alone", () => {
    const t4 = buildRunManifest({
      config: { tier: "tier4", genreCode: null, routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    expect(t4).toEqual([
      "preference_summary",
      "preference_analysis",
      "initial_plan",
      "worldview",
      "narrative_card",
    ]);

    const t3 = buildRunManifest({
      config: { tier: "tier3", genreCode: null, routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    // 设定集线不产剧情树，交付物是设定集
    expect(t3).not.toContain("quest_generation");
    expect(t3).not.toContain("plot_generation");
    expect(t3).toContain("worldview");
    expect(t3).toContain("lore_generation");
  });

  it("static narrative mode routes through the seat pipeline and stops at its endpoint", () => {
    const m = buildRunManifest({
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "narrative",
        mode: "worldview",
      },
    });
    const ids = m.agents.map((a) => a.agentId);
    expect(ids).not.toContain("core_concept");
    expect(ids[ids.length - 1]).toBe("worldview");
  });

  /**
   * C1（VN v2 吸收与封存）：`vn_script` / `vn_full` 等 tpl-vn-v2 专属 mode 已整体
   * 退役（见 modes.ts C1 注释）——影游品类（含 `adv-interactive`）现在与其余
   * VN 家族一样，靠 genreCode 路由到 `pl-film-game`，用通用的 `script` mode
   * 止于分镜助手的通用实现 `script_generation`。上传剧本不再靠运行时改图
   * 替换步骤（`hasUploadedScript` 对步序不再有任何影响，业务功能已下沉进
   * `preference_summary` 席的 composer），因此这里断言步序对它保持不变。
   */
  it("VN family genres now route through pl-film-game's generic script mode; hasUploadedScript no longer reshapes the step sequence", () => {
    // vn_script 已随 tpl-vn-v2 一并退役，MODE_CONFIGS 里不再有这个 id——
    // mode 字符串本身只是路由的一个可选提示，传一个不存在的 id 不会抛错，
    // 只会拿不到任何专属覆盖，落回 genreCode+tier 驱动的通用席位管线。
    expect(MODE_CONFIGS.some((m) => m.id === "vn_script")).toBe(false);

    const cfg = {
      genreCode: "adv-interactive",
      tier: "tier1" as const,
      routeGroup: "narrative" as const,
      mode: "script" as const,
    };
    const withoutScript = buildRunManifest({ config: cfg }).agents.map((a) => a.agentId);
    const withScript = buildRunManifest({ config: cfg, hasUploadedScript: true }).agents.map(
      (a) => a.agentId,
    );
    expect(withoutScript).toEqual(withScript);
    expect(withoutScript[withoutScript.length - 1]).toBe("script_generation");
    for (const legacy of ["vn_outline_acts", "vn_beats", "vn_script_normalize", "vn_segment_confirm"]) {
      expect(withoutScript).not.toContain(legacy);
    }
  });

  it("narrative_auto stays planner-driven (no mode step list to mirror)", () => {
    const m = buildRunManifest({
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "narrative",
        mode: "narrative_auto",
      },
    });
    const ids = m.agents.map((a) => a.agentId);
    expect(ids).not.toContain("core_concept");
    expect(ids[0]).toBe("preference_summary");
  });

  it("builds multi-pipeline entry from canvas starts", () => {
    const graphs = splitCompositionByStartNodes(
      [
        { id: "in1", catalogId: "input.text", category: "input", config: {} },
        { id: "in2", catalogId: "input.tags", category: "input", config: {} },
        { id: "ex", catalogId: "expert.jrpg", category: "expert", config: {} },
      ],
      [{ id: "e", source: "in1", target: "ex" }],
    );
    const manifests = buildEntryManifests("entry-multi", graphs, {
      genreCode: "rpg-jrpg",
    });
    expect(manifests).toHaveLength(2);
    expect(manifests.every((m) => m.entryKey === "entry-multi")).toBe(true);
    const complete = manifests.find((m) => m.compositionGraph?.startNodeId === "in1");
    const incomplete = manifests.find((m) => m.compositionGraph?.startNodeId === "in2");
    expect(complete?.complete).toBe(true);
    expect(incomplete?.complete).toBe(false);
  });
});

/**
 * 自由编排：画布编排的链必须真的成为步序，且必须被标记出来。
 *
 * 这组断言守的是一个静默 bug：曾经 /plan 认 requestedSteps 而 /start 不认，用户在画布上
 * 编排完看到的预览是自己的链、点开始生成跑的是预置管线，全程不报错。修法是让后端从画布
 * 拓扑推导步序（唯一推导点）并用 stepSource 标出来，前端据此把链原样带去 /entry/start。
 */
describe("free composition step order", () => {
  const entryNode = { id: "in1", catalogId: "input.entry", category: "input" as const, config: {} };

  it("derives the ordered chain from engineer nodes on the canvas", () => {
    const graphs = splitCompositionByStartNodes(
      [
        entryNode,
        {
          id: "n2",
          catalogId: "engineer.character",
          category: "engineer",
          agentId: "character_enrichment",
          config: {},
          position: { x: 200, y: 0 },
        },
        {
          id: "n1",
          catalogId: "engineer.worldview",
          category: "engineer",
          agentId: "worldview",
          config: {},
          position: { x: 100, y: 0 },
        },
      ],
      [
        { id: "e1", source: "in1", target: "n1" },
        { id: "e2", source: "n1", target: "n2" },
      ],
    );
    const m = buildEntryManifests("entry-compose", graphs, { genreCode: "rpg-jrpg" })[0]!;
    expect(m.stepSource).toBe("composition");
    // 声明序是 n2 在前，但连线是 n1 → n2：以拓扑序为准，不以数组序为准。
    expect(m.agents.map((a) => a.agentId)).toEqual(["worldview", "character_enrichment"]);
  });

  it("leaves expert-only canvases on the preset route", () => {
    const graphs = splitCompositionByStartNodes(
      [
        entryNode,
        { id: "ex", catalogId: "expert.jrpg", category: "expert", config: { genreCode: "rpg-jrpg" } },
      ],
      [{ id: "e", source: "in1", target: "ex" }],
    );
    const m = buildEntryManifests("entry-preset", graphs, {
      genreCode: "rpg-jrpg",
      tier: "tier1",
    })[0]!;
    // 只有输入 + 专家的图恰好就是预设路径本身，走席位管线（保留并行组），不当自由编排。
    expect(m.stepSource).toBe("preset");
    expect(m.agents.map((a) => a.agentId)).toEqual(
      buildRunManifest({
        config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning" },
      }).agents.map((a) => a.agentId),
    );
  });

  it("expands a mixed canvas: expert contributes its whole seat pipeline", () => {
    const graphs = splitCompositionByStartNodes(
      [
        entryNode,
        {
          id: "ex",
          catalogId: "expert.jrpg",
          category: "expert",
          config: { genreCode: "rpg-jrpg", tier: "tier1" },
          position: { x: 100, y: 0 },
        },
        {
          id: "eng",
          catalogId: "engineer.lore",
          category: "engineer",
          agentId: "lore_generation",
          config: {},
          position: { x: 200, y: 0 },
        },
      ],
      [
        { id: "e1", source: "in1", target: "ex" },
        { id: "e2", source: "ex", target: "eng" },
      ],
    );
    const ids = buildEntryManifests("entry-mixed", graphs, { genreCode: "rpg-jrpg" })[0]!.agents.map(
      (a) => a.agentId,
    );
    expect(ids).toContain("worldview");
    // 专家那一段整体在前，用户接在其后的单品助手收尾。
    expect(ids[ids.length - 1]).toBe("lore_generation");
  });

  it("keeps explicit requestedSteps above graph derivation", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg" },
      compositionGraph: {
        startNodeId: "in1",
        nodes: [
          entryNode,
          { id: "n1", catalogId: "engineer.worldview", category: "engineer", agentId: "worldview", config: {} },
        ],
        edges: [{ id: "e1", source: "in1", target: "n1" }],
      },
      requestedSteps: ["item_database"],
    });
    expect(m.agents.map((a) => a.agentId)).toEqual(["item_database"]);
    expect(m.stepSource).toBe("composition");
  });
});
