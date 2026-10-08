/**
 * 叙事库的积累与去重。
 *
 * 盯的是"积累"与"堆积"的分界线：同一条手法重复入库要合成一条并记下印证，
 * 而印证只能按作品计。这两条任一失守，库就长成一个越跑越长、哪条可靠说不出来的清单。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accumulateOperators,
  accumulateTemplates,
  borrowOperators,
  libraryStats,
  operatorFingerprint,
  templateFingerprint,
} from "../store.js";
import type { NarrativeOperator, NarrativeTemplate } from "../../../types/narrative-ip-dna.js";

let cwd: string;
const roots = () => ({ cwd });

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "narrative-library-"));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function op(over: Partial<NarrativeOperator> = {}): NarrativeOperator {
  return {
    uid: `op_${Math.random().toString(36).slice(2)}`,
    name: "以物代言",
    definition: "用一件反复出现的物件承担角色说不出口的情绪",
    adaptation: { type: "情感表达", element: "道具" },
    usage_guide: "在转折前后各出现一次",
    example: "怀表在父亲死后第二次出现",
    knowledge_location: "某作品·第三章",
    knowledge_domain: "情感体验",
    ...over,
  };
}

function tpl(structure: unknown): NarrativeTemplate {
  return {
    worldview: {},
    characters: [],
    story_structure: structure,
    core_elements: {},
    summary: {},
  } as unknown as NarrativeTemplate;
}

describe("指纹取语义，不取 uid", () => {
  it("同一条手法两次提炼（uid 不同）算同一个指纹", () => {
    expect(operatorFingerprint(op())).toBe(operatorFingerprint(op()));
  });

  it("举的例子不同不影响指纹——那是同一条手法的两份用法样本", () => {
    expect(operatorFingerprint(op({ example: "另一个例子", usage_guide: "另一种用法" })))
      .toBe(operatorFingerprint(op()));
  });

  it("定义不同就是另一条手法", () => {
    expect(operatorFingerprint(op({ definition: "别的定义" }))).not.toBe(operatorFingerprint(op()));
  });

  it("键序不同算同一个指纹（稳定序列化）", () => {
    const a = templateFingerprint(tpl({ acts: 3, turns: ["a", "b"] }));
    const b = templateFingerprint(tpl({ turns: ["a", "b"], acts: 3 }));
    expect(a).toBe(b);
  });

  it("模板只按故事结构算指纹：世界观与角色是作品的具体内容", () => {
    const a = tpl({ acts: 3 });
    const b = { ...tpl({ acts: 3 }), characters: [{ name: "谁" }] } as NarrativeTemplate;
    expect(templateFingerprint(a)).toBe(templateFingerprint(b));
  });
});

describe("入库：去重不是丢弃", () => {
  it("首次入库落为新条目", () => {
    const stats = accumulateOperators([op()], { storyId: "t1", title: "甲作" }, roots());
    expect(stats).toEqual({ added: 1, corroborated: 0 });
    expect(libraryStats(roots()).operator.entries).toBe(1);
  });

  it("另一部作品提出同一条手法：合成一条，印证加一", () => {
    accumulateOperators([op()], { storyId: "t1", title: "甲作" }, roots());
    const stats = accumulateOperators([op()], { storyId: "t2", title: "乙作" }, roots());
    expect(stats).toEqual({ added: 0, corroborated: 1 });

    const s = libraryStats(roots()).operator;
    expect(s.entries).toBe(1);
    expect(s.multiSourced).toBe(1);
  });

  it("同一部作品重跑不加印证：那只说明它跑了两遍", () => {
    accumulateOperators([op()], { storyId: "t1", title: "甲作" }, roots());
    const stats = accumulateOperators([op()], { storyId: "t1", title: "甲作" }, roots());
    expect(stats).toEqual({ added: 0, corroborated: 0 });
    expect(libraryStats(roots()).operator.multiSourced).toBe(0);
  });

  it("重复入库仍追加来源——'这条手法在哪儿见过'不该丢", () => {
    accumulateOperators([op()], { storyId: "t1", title: "甲作" }, roots());
    accumulateOperators([op()], { storyId: "t2", title: "乙作" }, roots());
    const file = path.join(cwd, "library", "operators.json");
    const entries = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{ sources: unknown[] }>;
    expect(entries[0].sources).toHaveLength(2);
  });

  it("空批次不建文件：没提炼出东西就不该留下痕迹", () => {
    expect(accumulateOperators([], { storyId: "t1", title: "甲作" }, roots()))
      .toEqual({ added: 0, corroborated: 0 });
    expect(fs.existsSync(path.join(cwd, "library"))).toBe(false);
  });

  it("模板走同一套机制", () => {
    accumulateTemplates([tpl({ acts: 3 })], { storyId: "t1", title: "甲作" }, roots());
    const stats = accumulateTemplates([tpl({ acts: 3 })], { storyId: "t2", title: "乙作" }, roots());
    expect(stats).toEqual({ added: 0, corroborated: 1 });
  });

  it("库文件坏了当空库继续，不让创作停下", () => {
    const file = path.join(cwd, "library", "operators.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ 这不是 JSON", "utf-8");
    expect(accumulateOperators([op()], { storyId: "t1", title: "甲作" }, roots()))
      .toEqual({ added: 1, corroborated: 0 });
  });
});

describe("借用：印证多的先出", () => {
  beforeEach(() => {
    const common = op({ name: "以物代言" });
    const rare = op({ name: "视角错置", definition: "让叙述者知道得比角色少" });
    accumulateOperators([common, rare], { storyId: "t1", title: "甲作" }, roots());
    accumulateOperators([common], { storyId: "t2", title: "乙作" }, roots());
    accumulateOperators([common], { storyId: "t3", title: "丙作" }, roots());
  });

  it("被更多作品印证的排在前面", () => {
    expect(borrowOperators({ roots: roots() }).map((o) => o.name))
      .toEqual(["以物代言", "视角错置"]);
  });

  it("按知识域筛：席位只要与它那一段有关的手法", () => {
    accumulateOperators(
      [op({ name: "留白", definition: "该说的不说", knowledge_domain: "文学风格" })],
      { storyId: "t4", title: "丁作" },
      roots(),
    );
    expect(borrowOperators({ domain: "文学风格", roots: roots() }).map((o) => o.name))
      .toEqual(["留白"]);
  });

  it("limit 截断", () => {
    expect(borrowOperators({ limit: 1, roots: roots() })).toHaveLength(1);
  });

  it("空库借不到东西，也不报错", () => {
    fs.rmSync(path.join(cwd, "library"), { recursive: true, force: true });
    expect(borrowOperators({ roots: roots() })).toEqual([]);
  });
});
