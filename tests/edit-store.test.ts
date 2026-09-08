import { describe, it, expect } from "vitest";
import {
  editKey,
  editedKeys,
  findEdit,
  normalizeEditsState,
  originalFileCandidates,
  originalFileName,
  parseEditKey,
  removeEdit,
  upsertEdit,
  type EditsState,
} from "../src/api/edit-store.js";

const empty = (): EditsState => normalizeEditsState(null);

describe("editKey / parseEditKey — 与前端 editDrafts 同形", () => {
  it("整步与节点级各有各的键", () => {
    expect(editKey("plot_generation")).toBe("plot_generation");
    expect(editKey("plot_generation", "3")).toBe("plot_generation::3");
  });

  it("nodeId 里带冒号也能拆回来：只认第一个分隔符", () => {
    expect(parseEditKey("plot_generation::a::b")).toEqual({
      stepId: "plot_generation",
      nodeId: "a::b",
    });
    expect(parseEditKey("plot_generation")).toEqual({ stepId: "plot_generation" });
  });
});

describe("originalFileName — 原稿存成能直接读的形状", () => {
  it("字符串存 md，结构存 json", () => {
    expect(originalFileName("outline_batch", "1", "正文")).toBe("outline_batch__1.md");
    expect(originalFileName("outline_batch", "1", { a: 1 })).toBe("outline_batch__1.json");
  });

  it("路径分隔符要洗掉，否则会写到目录外去", () => {
    expect(originalFileName("a/b", "../c", "x")).not.toContain("/");
    expect(originalFileName("a/b", "../c", "x")).not.toContain("\\");
  });

  it("读侧两种扩展名都得试：写的时候不知道下次谁来读", () => {
    expect(originalFileCandidates("outline_batch", "1")).toEqual([
      "outline_batch__1.json",
      "outline_batch__1.md",
    ]);
  });
});

describe("normalizeEditsState — 坏账本不该让条目打不开", () => {
  it("空/坏输入归一成可用形状", () => {
    expect(normalizeEditsState(null).edits).toEqual([]);
    expect(normalizeEditsState({ edits: "nope" }).edits).toEqual([]);
    expect(normalizeEditsState(undefined).updatedAt).toBeTypeOf("string");
  });

  it("混着垃圾条目时只留下认得的那些", () => {
    const s = normalizeEditsState({
      edits: [null, 3, { nodeId: "x" }, { stepId: "plot_generation", editedContent: "y" }],
    });
    expect(s.edits).toHaveLength(1);
    expect(s.edits[0].stepId).toBe("plot_generation");
  });
});

describe("upsertEdit — 原稿只认第一次那份", () => {
  it("首次编辑记下改前改后", () => {
    const s = upsertEdit(empty(), {
      stepId: "outline_batch",
      nodeId: "1",
      editedContent: "改后",
      originalContent: "原稿",
    });
    expect(findEdit(s, "outline_batch", "1")).toMatchObject({
      editedContent: "改后",
      originalContent: "原稿",
    });
  });

  it("同一处改第二次：originalContent 仍是最初那份，不能被中间稿顶掉", () => {
    let s = upsertEdit(empty(), {
      stepId: "outline_batch",
      nodeId: "1",
      editedContent: "第一稿",
      originalContent: "原稿",
    });
    s = upsertEdit(s, {
      stepId: "outline_batch",
      nodeId: "1",
      editedContent: "第二稿",
      // 调用方拿的是"当前内容"，也就是第一稿 —— 账本不能把它当原稿。
      originalContent: "第一稿",
    });
    expect(s.edits).toHaveLength(1);
    expect(findEdit(s, "outline_batch", "1")).toMatchObject({
      editedContent: "第二稿",
      originalContent: "原稿",
    });
  });

  it("整步与它下面的节点是两条独立记录", () => {
    let s = upsertEdit(empty(), { stepId: "plot_generation", editedContent: "整步", originalContent: "a" });
    s = upsertEdit(s, { stepId: "plot_generation", nodeId: "3", editedContent: "节点", originalContent: "b" });
    expect(s.edits).toHaveLength(2);
    expect(findEdit(s, "plot_generation")?.editedContent).toBe("整步");
    expect(findEdit(s, "plot_generation", "3")?.editedContent).toBe("节点");
  });
});

describe("removeEdit — 还原原文之后账本上不该再挂着", () => {
  it("只撤指定那条，同步的其他记录留着", () => {
    let s = upsertEdit(empty(), { stepId: "s1", nodeId: "1", editedContent: "a", originalContent: "o" });
    s = upsertEdit(s, { stepId: "s1", nodeId: "2", editedContent: "b", originalContent: "o" });
    s = removeEdit(s, "s1", "1");
    expect(editedKeys(s)).toEqual(["s1::2"]);
  });

  it("撤一条不存在的：不报错也不误删整步那条", () => {
    const s = upsertEdit(empty(), { stepId: "s1", editedContent: "a", originalContent: "o" });
    expect(editedKeys(removeEdit(s, "s1", "9"))).toEqual(["s1"]);
  });
});
