import { describe, it, expect } from "vitest";
import {
  insertNode,
  removeNode,
  validateNodeLinks,
  type GraphNode,
} from "../src/api/node-crud.js";

/** A → B → C 一条线。 */
const line = (): GraphNode[] => [
  { node_id: "A", prev_node: [], next_node: ["B"] },
  { node_id: "B", prev_node: ["A"], next_node: ["C"] },
  { node_id: "C", prev_node: ["B"], next_node: [] },
];

/** A 分成 B / C 两支，在 D 汇合。 */
const diamond = (): GraphNode[] => [
  { node_id: "A", prev_node: [], next_node: ["B", "C"] },
  { node_id: "B", prev_node: ["A"], next_node: ["D"] },
  { node_id: "C", prev_node: ["A"], next_node: ["D"] },
  { node_id: "D", prev_node: ["B", "C"], next_node: [] },
];

describe("insertNode — 串进去而不是并上去", () => {
  it("插在 A 与 B 之间：A→B 那条直连要断，变成 A→X→B", () => {
    const { nodes } = insertNode(line(), {
      node: { node_id: "X" },
      prev: ["A"],
      next: ["B"],
    });
    const by = new Map(nodes.map((n) => [n.node_id, n]));
    expect(by.get("A")!.next_node).toEqual(["X"]);
    expect(by.get("X")!.prev_node).toEqual(["A"]);
    expect(by.get("X")!.next_node).toEqual(["B"]);
    expect(by.get("B")!.prev_node).toEqual(["X"]);
    expect(validateNodeLinks(nodes)).toEqual([]);
  });

  it("只给 prev：接在末尾，成为新的结尾", () => {
    const { nodes, warnings } = insertNode(line(), { node: { node_id: "X" }, prev: ["C"] });
    const by = new Map(nodes.map((n) => [n.node_id, n]));
    expect(by.get("C")!.next_node).toEqual(["X"]);
    expect(by.get("X")!.next_node).toEqual([]);
    expect(warnings).toEqual([]);
    expect(validateNodeLinks(nodes)).toEqual([]);
  });

  it("谁都不接：允许，但要说出来它是孤立的", () => {
    const { nodes, warnings } = insertNode(line(), { node: { node_id: "X" } });
    expect(warnings.join()).toContain("孤立节点");
    // 孤立节点自己没有上游，所以"有入口"这条仍然成立，不该被判成不变式破了。
    expect(validateNodeLinks(nodes)).toEqual([]);
  });

  it("连接对象不存在：忽略并说明，而不是造一条悬空边", () => {
    const { nodes, warnings } = insertNode(line(), {
      node: { node_id: "X" },
      prev: ["A"],
      next: ["nope"],
    });
    expect(warnings.join()).toContain("nope");
    expect(validateNodeLinks(nodes)).toEqual([]);
  });

  it("node_id 撞车或缺失都得拦住", () => {
    expect(() => insertNode(line(), { node: { node_id: "B" } })).toThrow(/已存在/);
    expect(() => insertNode(line(), { node: { node_id: "" } })).toThrow(/node_id/);
  });

  it("不原地改入参：失败与成功都不该动调用方手里那份", () => {
    const original = line();
    insertNode(original, { node: { node_id: "X" }, prev: ["A"], next: ["B"] });
    expect(original.find((n) => n.node_id === "A")!.next_node).toEqual(["B"]);
  });
});

describe("removeNode — 先缝合再摘掉", () => {
  it("删中间：A 直接接到 C", () => {
    const { nodes } = removeNode(line(), "B");
    const by = new Map(nodes.map((n) => [n.node_id, n]));
    expect(nodes.map((n) => n.node_id)).toEqual(["A", "C"]);
    expect(by.get("A")!.next_node).toEqual(["C"]);
    expect(by.get("C")!.prev_node).toEqual(["A"]);
    expect(validateNodeLinks(nodes)).toEqual([]);
  });

  it("删汇聚点：两条支线各自接上后续，不能少连一条", () => {
    const withTail = diamond().map((n) =>
      n.node_id === "D" ? { ...n, next_node: ["E"] } : n,
    );
    const { nodes } = removeNode(
      [...withTail, { node_id: "E", prev_node: ["D"], next_node: [] }],
      "D",
    );
    const by = new Map(nodes.map((n) => [n.node_id, n]));
    expect(by.get("B")!.next_node).toEqual(["E"]);
    expect(by.get("C")!.next_node).toEqual(["E"]);
    expect(by.get("E")!.prev_node).toEqual(["B", "C"]);
    expect(validateNodeLinks(nodes)).toEqual([]);
  });

  it("删入口：下游成为新入口，且要说出来（这改了故事开头）", () => {
    const { nodes, warnings } = removeNode(line(), "A");
    expect(warnings.join()).toContain("入口");
    expect(nodes.find((n) => n.node_id === "B")!.prev_node).toEqual([]);
    expect(validateNodeLinks(nodes)).toEqual([]);
  });

  it("删结尾：上游成为新结尾", () => {
    const { warnings, nodes } = removeNode(line(), "C");
    expect(warnings.join()).toContain("结尾");
    expect(nodes.find((n) => n.node_id === "B")!.next_node).toEqual([]);
  });

  it("不存在的节点、以及删到空树，都要拦住", () => {
    expect(() => removeNode(line(), "nope")).toThrow(/不存在/);
    expect(() => removeNode([{ node_id: "only" }], "only")).toThrow(/最后一个/);
  });

  it("摘掉之后没人再引用它", () => {
    const { nodes } = removeNode(diamond(), "B");
    for (const n of nodes) {
      expect(n.prev_node).not.toContain("B");
      expect(n.next_node).not.toContain("B");
    }
  });
});

describe("validateNodeLinks — 落盘前的不变式", () => {
  it("悬空边要报", () => {
    expect(validateNodeLinks([{ node_id: "A", next_node: ["ghost"] }]).join()).toContain("ghost");
  });

  it("单向不一致要报：A 说下一个是 B，B 却不认 A", () => {
    // 这一侧从 prev 循环里永远看不见（B.prev 是空的），必须靠 next 侧那趟检查兜住。
    const problems = validateNodeLinks([
      { node_id: "A", prev_node: [], next_node: ["B"] },
      { node_id: "B", prev_node: [], next_node: [] },
    ]);
    expect(problems.join()).toContain("单向");
  });

  it("反向的单向也要报：B 说上一个是 A，A 却不认 B", () => {
    const problems = validateNodeLinks([
      { node_id: "A", prev_node: [], next_node: [] },
      { node_id: "B", prev_node: ["A"], next_node: [] },
    ]);
    expect(problems.join()).toContain("单向");
  });

  it("成环导致没有入口：跑起来无从开始，必须报", () => {
    const problems = validateNodeLinks([
      { node_id: "A", prev_node: ["B"], next_node: ["B"] },
      { node_id: "B", prev_node: ["A"], next_node: ["A"] },
    ]);
    expect(problems.join()).toContain("入口");
  });
});
