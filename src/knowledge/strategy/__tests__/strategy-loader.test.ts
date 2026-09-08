import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  getStrategyRoot,
  getStrategyCard,
  getStrategyCards,
  listStrategyCards,
  getStrategyStats,
  resetStrategyCache,
} from "../strategy-loader.js";
import { GENRE_TAXONOMY } from "../../genre-taxonomy.js";
import {
  STORY_TYPE_CODES,
  STORY_THEME_CODES,
  STORY_STRUCTURE_CODES,
} from "../../narrative-axes/index.js";

beforeEach(() => resetStrategyCache());

/**
 * 在真实库目录里放一张临时卡跑断言，跑完把目录恢复原状。
 *
 * 必须先备份：这些用例借的是真实词表里的 code（loop / comedy），而库是逐张补齐的——
 * 哪天那张卡真的入库了，`fs.rmSync` 就会把它删掉，且测试照样绿。
 * 曾经就这么丢过一张 structure/loop.md。
 */
function withScratchCard(axis: string, code: string, content: string, assert: () => void): void {
  const file = path.join(getStrategyRoot()!, axis, `${code}.md`);
  const original = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
  fs.writeFileSync(file, content, "utf-8");
  try {
    resetStrategyCache();
    assert();
  } finally {
    if (original === null) fs.rmSync(file);
    else fs.writeFileSync(file, original, "utf-8");
    resetStrategyCache();
  }
}

describe("约定式策略库", () => {
  it("能解析到库根目录", () => {
    const root = getStrategyRoot();
    expect(root).toBeTruthy();
    expect(fs.existsSync(path.join(root!, "genre"))).toBe(true);
  });

  it("放进目录的 md 无需注册即被加载", () => {
    const card = getStrategyCard("genre", "rpg-jrpg");
    expect(card).not.toBeNull();
    expect(card!.name).toBe("JRPG");
    expect(card!.body).toContain("队伍即叙事单位");
    expect(card!.body.startsWith("---")).toBe(false);
  });

  it("frontmatter 缺省时 name 取文件名、四个环节全生效", () => {
    withScratchCard("structure", "loop", "循环结构：首尾闭环，结尾必须能重新接回开头。\n", () => {
      const card = getStrategyCard("structure", "loop")!;
      expect(card.name).toBe("loop");
      expect(card.stages).toEqual(["demand", "design", "outline", "structure"]);
    });
  });

  it("stages 能限定生效环节", () => {
    const body = "---\nname: 喜剧\nstages: [outline]\n---\n笑点即情节节点。\n";
    withScratchCard("type", "comedy", body, () => {
      expect(getStrategyCards({ type: "comedy" }, "outline").type?.name).toBe("喜剧");
      expect(getStrategyCards({ type: "comedy" }, "demand").type).toBeNull();
    });
  });

  it("四轴齐备时一次取全，缺卡的轴返回 null 而不是抛错", () => {
    const cards = getStrategyCards(
      { genre: "rpg-jrpg", type: "drama", theme: "workplace", structure: "linear" },
      "design",
    );
    expect(cards.genre?.code).toBe("rpg-jrpg");
    expect(cards.type?.code).toBe("drama");
    expect(cards.theme?.code).toBe("workplace");
    expect(cards.structure?.code).toBe("linear");

    const sparse = getStrategyCards({ genre: "rpg-jrpg", theme: "nonexistent" }, "design");
    expect(sparse.genre).not.toBeNull();
    expect(sparse.theme).toBeNull();
    expect(sparse.type).toBeNull();
  });

  it("下划线开头的草稿文件被跳过", () => {
    const root = getStrategyRoot()!;
    const tmp = path.join(root, "genre", "_draft.md");
    fs.writeFileSync(tmp, "草稿内容，不该被加载。\n", "utf-8");
    try {
      resetStrategyCache();
      expect(listStrategyCards("genre").some((c) => c.code === "_draft")).toBe(false);
    } finally {
      fs.rmSync(tmp);
      resetStrategyCache();
    }
  });

  it("已入库的文件名全部命中词表（拼错就等于静默失效）", () => {
    const valid: Record<string, Set<string>> = {
      genre: new Set(GENRE_TAXONOMY.map((g) => g.code)),
      type: new Set<string>(STORY_TYPE_CODES),
      theme: new Set<string>(STORY_THEME_CODES),
      structure: new Set<string>(STORY_STRUCTURE_CODES),
    };
    for (const axis of ["genre", "type", "theme", "structure"] as const) {
      for (const card of listStrategyCards(axis)) {
        expect(valid[axis].has(card.code), `${axis}/${card.code}.md`).toBe(true);
      }
    }
    expect(getStrategyStats().emptyFiles).toEqual([]);
  });

  /**
   * 结构轴必须张张齐备，缺一张就等于该形态静默退化。
   *
   * 路由归一后所有品类走同一条通用管线，剧情树的形态差异**只**由结构轴策略卡承担
   * （narrative-pipelines.ts:100-104 写明：不给影游另开一条管线）。所以这一轴的缺卡
   * 不是"内容待补"，而是"该形态的项目会拿到线性剧情树且不报错"。
   * 其余三轴仍在逐张补，不在此断言。
   */
  it("结构轴十二种形态张张有卡（缺卡等于该形态静默退化成线性）", () => {
    const present = new Set(listStrategyCards("structure").map((c) => c.code));
    const missing = STORY_STRUCTURE_CODES.filter((c) => !present.has(c));
    expect(missing, `缺结构轴策略卡: ${missing.join(", ")}`).toEqual([]);
  });

  it("结构卡四个环节全覆盖（少一段就是那一环拿不到形态指引）", () => {
    for (const card of listStrategyCards("structure")) {
      expect(card.stages, `structure/${card.code}.md`).toEqual([
        "demand",
        "design",
        "outline",
        "structure",
      ]);
    }
  });
});
