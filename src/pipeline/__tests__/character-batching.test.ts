/**
 * 角色席按体量分批。
 *
 * 盯的是分批的两条边界：小体量下必须与从前逐字等价（否则这是一次无谓的行为变更），
 * 大体量下每批要小到让每份档案都拿到完整注意力。以及分批自身的两个代价点——
 * 主角兜底不能按批做，各批要看得见全名单。
 */
import { describe, expect, it } from "vitest";
import {
  characterBatchSize,
  characterBatches,
  characterRoster,
  CHARACTER_ENRICHMENT_COMPOSER,
  normalizeCharacterSheets,
} from "../steps/character-enrichment.js";
import { getSplitter, getMerger } from "../blueprint/processor-registry.js";
import { executableStructureFor } from "../routing/seat-spec.js";
import "../blueprint/migrated-processors.js";
import type { NarrativeContext } from "../../types/index.js";

function ctxWith(npcCount: number, complexity?: number): NarrativeContext {
  return {
    user_input: "测试",
    global_control_params: complexity === undefined ? undefined : { complexity, deviation: 0 },
    core_settings: {
      protagonist: { name: "阿零", identity: "铁匠之子", personality: "", core_conflict: "" },
      key_npcs: Array.from({ length: npcCount }, (_, i) => ({
        name: `配角${i + 1}`,
        identity: "",
        personality: "",
        relationship_to_protagonist: "",
      })),
    },
  } as unknown as NarrativeContext;
}

describe("角色名单", () => {
  it("名单 = 主角 + 关键 NPC，取自核心设定", () => {
    expect(characterRoster(ctxWith(2))).toEqual(["阿零", "配角1", "配角2"]);
  });

  it("没有核心设定时名单为空（调用方据此退回全量单次）", () => {
    expect(characterRoster({} as NarrativeContext)).toEqual([]);
  });

  it("重名只算一个：同一个人写两份档案没有意义", () => {
    const ctx = ctxWith(0);
    ctx.core_settings!.key_npcs = [
      { name: "阿零", identity: "", personality: "", relationship_to_protagonist: "" },
    ];
    expect(characterRoster(ctx)).toEqual(["阿零"]);
  });
});

describe("批大小由体量定", () => {
  it("小体量不分批：一批装下所有人，与从前等价", () => {
    expect(characterBatches(ctxWith(9, 1))).toHaveLength(1);
    expect(characterBatches(ctxWith(9, 2))).toHaveLength(1);
  });

  it("体量越大批越小，每份档案拿到的注意力越足", () => {
    expect(characterBatchSize(ctxWith(0, 3))).toBe(4);
    expect(characterBatchSize(ctxWith(0, 4))).toBe(3);
    expect(characterBatchSize(ctxWith(0, 5))).toBe(2);
  });

  it("没给体量时按默认档走，不报错也不分得过细", () => {
    expect(characterBatches(ctxWith(9))).toHaveLength(1);
  });

  it("角色数少于批大小时仍只有一批（切了也没得切）", () => {
    expect(characterBatches(ctxWith(1, 5))).toEqual([["阿零", "配角1"]]);
  });

  it("大体量多角色切成多批，且每个人只进一批", () => {
    const batches = characterBatches(ctxWith(8, 5)); // 9 人 / 每批 2
    expect(batches).toHaveLength(5);
    const flat = batches.flat();
    expect(flat).toHaveLength(9);
    expect(new Set(flat).size).toBe(9);
  });
});

describe("分片器与合并器", () => {
  it("名单为空时给单片，而不是空数组（空数组等于无事可做）", () => {
    const chunks = getSplitter("character_enrichment_splitter")!({} as NarrativeContext);
    expect(chunks).toHaveLength(1);
  });

  it("每片带上本片要写的角色", () => {
    const chunks = getSplitter("character_enrichment_splitter")!(ctxWith(3, 5));
    expect(chunks).toHaveLength(2);
    expect((chunks[0].data as { names: string[] }).names).toEqual(["阿零", "配角1"]);
  });

  it("主角兜底在合并之后做，不是每批各立一个主角", () => {
    const ctx = ctxWith(3, 5);
    const merged = getMerger("character_enrichment_merger")!(
      [
        { chunkId: "cb1", output: [{ name: "阿零" }, { name: "配角1" }] },
        { chunkId: "cb2", output: [{ name: "配角2" }, { name: "配角3" }] },
      ] as never,
      ctx,
    ) as Array<{ name: string; _is_player?: boolean }>;
    expect(merged).toHaveLength(4);
    expect(merged.filter((c) => c._is_player)).toHaveLength(1);
    expect(ctx.player_name).toBe("阿零");
  });
});

describe("每批的提示词", () => {
  it("分片语境里点明只输出本批这几位", () => {
    const ctx = ctxWith(3, 5);
    (ctx as Record<string, unknown>)._chunk = { names: ["配角2", "配角3"] };
    const user = CHARACTER_ENRICHMENT_COMPOSER.blocks.context_inputs!(ctx);
    expect(user).toContain("本批要写的角色");
    expect(user).toContain("配角2");
  });

  it("全名单仍在提示词里：不让各批各自写出一个同质化的角色", () => {
    const ctx = ctxWith(3, 5);
    (ctx as Record<string, unknown>)._chunk = { names: ["配角2"] };
    const user = CHARACTER_ENRICHMENT_COMPOSER.blocks.context_inputs!(ctx);
    // 不在本批的角色也看得见（它们躺在核心设定里）
    expect(user).toContain("配角1");
    expect(user).toContain("他们由另外几批负责");
  });

  it("不分片时不出这一段（全量跑法不该被本批限定）", () => {
    const user = CHARACTER_ENRICHMENT_COMPOSER.blocks.context_inputs!(ctxWith(3, 1));
    expect(user).not.toContain("本批要写的角色");
  });
});

describe("席位形态", () => {
  it("角色席的执行原语已是 chunked，落差登记随之删掉", () => {
    expect(executableStructureFor("character")).toBe("chunked");
  });

  it("归一化仍在全名单上做主角兜底", () => {
    const ctx = {} as NarrativeContext;
    const sheets = normalizeCharacterSheets([{ name: "甲" }, { name: "乙" }], ctx);
    expect(sheets.filter((s) => s._is_player)).toHaveLength(1);
    expect(ctx.player_name).toBe("甲");
  });
});
