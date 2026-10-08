/**
 * 道具清单席（2.5.10）的三项职责：基础信息、生命周期、附属关系。
 *
 * 后两项此前只在职责原文里，schema 一个字段都没有。补上之后要防的是另一种失败：
 * 模型给了半截或给了认不出的取值，归一层原样收下，下游把"模型没排"读成
 * "这件道具全程无人持有"。所以断言集中在"缺什么就不落字段"这条边界上。
 */
import { describe, it, expect } from "vitest";
import { normalizeItemDatabase, validateItemDatabase } from "../steps/item-database.js";

function raw(extra: Record<string, unknown>): unknown {
  return {
    item_database: [
      {
        name: "断锋剑",
        category: "weapon",
        rarity: "rare",
        description: "剑身有一道旧缺口。可破甲。",
        effect: "破甲 +12",
        initial_owner: "阿蒙",
        initial_scene: "锻炉",
        related_character: "铁匠",
        value: { buy: 800, sell: 200 },
        max_stack: 1,
        ...extra,
      },
    ],
  };
}

describe("道具生命周期归一", () => {
  it("四项齐全时逐项落到 lifecycle 上", () => {
    const [item] = normalizeItemDatabase(
      raw({
        lifecycle: {
          acquired_at: "3.1 锻炉",
          used_at: ["5.2 城门", "7.1 王座"],
          lost_at: "8.1 深渊",
          final_state: "沉在深渊底",
        },
      }),
    );
    expect(item.lifecycle).toEqual({
      acquired_at: "3.1 锻炉",
      used_at: ["5.2 城门", "7.1 王座"],
      lost_at: "8.1 深渊",
      final_state: "沉在深渊底",
    });
  });

  it("lost_at 显式为 null 是「全程持有」这个结论，要留住", () => {
    const [item] = normalizeItemDatabase(
      raw({ lifecycle: { acquired_at: "3.1 锻炉", lost_at: null } }),
    );
    expect(item.lifecycle).toEqual({ acquired_at: "3.1 锻炉", lost_at: null });
    expect("lost_at" in item.lifecycle!).toBe(true);
  });

  it("整个 lifecycle 没给、或给了空壳，都不落字段", () => {
    expect(normalizeItemDatabase(raw({}))[0].lifecycle).toBeUndefined();
    expect(normalizeItemDatabase(raw({ lifecycle: {} }))[0].lifecycle).toBeUndefined();
    expect(
      normalizeItemDatabase(raw({ lifecycle: { acquired_at: "", used_at: [] } }))[0].lifecycle,
    ).toBeUndefined();
  });

  it("字符串 \"null\" 按没给处理——模型常这么写", () => {
    const [item] = normalizeItemDatabase(
      raw({ lifecycle: { acquired_at: "null", final_state: "锻炉墙上" } }),
    );
    expect(item.lifecycle).toEqual({ final_state: "锻炉墙上" });
    // lost_at 整个字段没给，就不该凭空落成"全程持有"。
    expect("lost_at" in item.lifecycle!).toBe(false);
  });

  it("lost_at 写成字符串 \"null\" 时按「全程持有」收——与 initial_owner 同一口径", () => {
    const [item] = normalizeItemDatabase(raw({ lifecycle: { lost_at: "null" } }));
    expect(item.lifecycle).toEqual({ lost_at: null });
  });
});

describe("道具附属关系归一", () => {
  it("多头关系逐条留住", () => {
    const [item] = normalizeItemDatabase(
      raw({
        affiliations: [
          { target: "铁匠行会", kind: "faction", relation: "行会祖传的锻件" },
          { target: "断锋鞘", kind: "item", relation: "与之成对" },
        ],
      }),
    );
    expect(item.affiliations).toHaveLength(2);
    expect(item.affiliations![0].kind).toBe("faction");
  });

  it("kind 认不出、或缺 target/relation 的整条丢掉", () => {
    const [item] = normalizeItemDatabase(
      raw({
        affiliations: [
          { target: "铁匠行会", kind: "guild", relation: "祖传" },
          { target: "", kind: "character", relation: "属于" },
          { target: "阿蒙", kind: "character", relation: "" },
          { target: "阿蒙", kind: "character", relation: "现持有者" },
        ],
      }),
    );
    expect(item.affiliations).toEqual([
      { target: "阿蒙", kind: "character", relation: "现持有者" },
    ]);
  });

  it("空数组与非数组一律不落字段", () => {
    expect(normalizeItemDatabase(raw({ affiliations: [] }))[0].affiliations).toBeUndefined();
    expect(normalizeItemDatabase(raw({ affiliations: "无" }))[0].affiliations).toBeUndefined();
    expect(normalizeItemDatabase(raw({}))[0].affiliations).toBeUndefined();
  });
});

describe("两项新增不影响既有校验", () => {
  it("没有 lifecycle / affiliations 的旧输出仍然过校验", () => {
    const legacy = JSON.stringify({
      item_database: [
        { name: "a", category: "x", rarity: "common", description: "", effect: "" },
        { name: "b", category: "x", rarity: "common", description: "", effect: "" },
        { name: "c", category: "x", rarity: "common", description: "", effect: "" },
      ],
    });
    expect(() => validateItemDatabase(legacy)).not.toThrow();
    expect(normalizeItemDatabase(JSON.parse(legacy))).toHaveLength(3);
  });
});
