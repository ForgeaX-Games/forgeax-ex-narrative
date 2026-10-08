/**
 * 策略卡的覆盖率与实质性。
 *
 * 这套库是**约定式**的：文件名取词表 code，放进对应轴的目录即刻生效，不改任何 ts。好处是
 * 补卡零成本，代价是缺卡也零成本 —— loader 对缺失、解析失败、code 不在词表内都不抛异常，
 * 一律当"该轴留空"。所以四个轴里少了谁，运行时没有任何声响：产出照样出来，只是少了一层
 * 倾向，而那一层的缺失从结果上看与"模型自己没想到"无法区分。
 *
 * 这里只对已经补齐的轴要求全覆盖。品类轴 117 个 code 是长期工程，按已有张数守一个下界，
 * 防的是回退而不是催进度。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  listStrategyCards,
  getStrategyStats,
  resetStrategyCache,
} from "../strategy-loader.js";
import {
  STORY_TYPE_CODES,
  STORY_THEME_CODES,
  STORY_STRUCTURE_CODES,
} from "../../narrative-axes/index.js";

beforeEach(() => resetStrategyCache());

function missing(axis: "type" | "theme" | "structure", codes: readonly string[]): string[] {
  const have = new Set(listStrategyCards(axis).map((c) => c.code));
  return codes.filter((c) => !have.has(c));
}

describe("三条已补齐的轴要求全覆盖", () => {
  it("14 个叙事类型每个都有卡", () => {
    expect(missing("type", STORY_TYPE_CODES)).toEqual([]);
  });

  it("20 个叙事题材每个都有卡", () => {
    expect(missing("theme", STORY_THEME_CODES)).toEqual([]);
  });

  it("12 个叙事结构每个都有卡", () => {
    expect(missing("structure", STORY_STRUCTURE_CODES)).toEqual([]);
  });
});

describe("卡不是空壳", () => {
  it("没有空文件", () => {
    // loader 自己就统计 emptyFiles：一张只有 frontmatter 的卡会被认到、计入张数、
    // 注入空内容。覆盖率数字好看而效果为零，是补卡这件事最容易出的假账。
    expect(getStrategyStats().emptyFiles).toEqual([]);
  });

  it("每张卡都是分小节写的，不是一行占位", () => {
    /**
     * 只抓占位，不评质量。
     *
     * 第一版拿"字数 ≥ 400 且小节 ≥ 2"当判据，结果把十三张四小节、三百九十来字的实心卡
     * 判成了空壳 —— 中文卡的信息密度高，字数是个很差的代理。留着那条断言的后果比没有它
     * 更坏：下一个人会去给正常的卡注水来迁就阈值。
     *
     * "有 markdown 小节"这条是可靠的：占位与草稿不会分节。至于"卡有没有给出词表之外的
     * 增量"，那是评审要读的，机械检查判不了，不假装判得了。
     */
    const placeholders: string[] = [];
    for (const axis of ["type", "theme", "structure", "genre"] as const) {
      for (const card of listStrategyCards(axis)) {
        const headings = (card.body.match(/^##\s/gm) ?? []).length;
        if (headings < 1 || card.body.length < 120) {
          placeholders.push(`${axis}/${card.code}（${card.body.length} 字、${headings} 节）`);
        }
      }
    }
    expect(placeholders).toEqual([]);
  });
});

describe("品类轴只守下界", () => {
  it("已有的品类卡不回退", () => {
    // 117 个品类是长期工程，这里不催进度；但已经写好的卡被误删要立刻知道。
    expect(getStrategyStats().counts.genre).toBeGreaterThanOrEqual(5);
  });
});
