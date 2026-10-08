/**
 * 协调席这一类，以及它带出的 `contentType` 两向规则。
 *
 * 加这一类是为了让「不落叙事产物的席位」有个正当身份。v4 主表里的叙事生成配置助手
 * （入口）就是这样一席：它的成果是一份配置，进运行清单，不进内容库。塞进 generator
 * 会逼它编一个 `contentType`，而那个类别下永远不会有文件。
 *
 * 规则本身用**构造的假席位**验证，不靠全表。全表恰好合规时，一条写错方向的规则与一条
 * 正确的规则同样是绿的 —— 所以 `assertSeatContractComplete` 这一轮改成可传参。
 */
import { describe, it, expect } from "vitest";
import {
  ASSISTANT_SEATS,
  SEAT_KINDS,
  assertSeatContractComplete,
  type AssistantSeat,
} from "../routing/assistant-seats.js";

/** 一席恰好合规的 generator，各条规则在它身上各改一处来验。 */
function baseSeat(over: Partial<AssistantSeat> = {}): AssistantSeat {
  return {
    id: "probe",
    featureId: "9.9.9",
    name: "探针席",
    kind: "generator",
    responsibility: "只为验证契约规则而存在。",
    status: "planned",
    upstreamSeats: [],
    contentType: "outline",
    bindings: [],
    ...over,
  };
}

describe("协调席进入席位类型", () => {
  it("coordinator 在 kind 词表里", () => {
    expect(SEAT_KINDS).toContain("coordinator");
  });

  it("前端投影的 union 与后端同源", () => {
    // 那份 union 从前是手抄的字面量，后端加一档它不会跟着变 —— 现在从 SEAT_KINDS 渲染。
    // 忘了跑 gen:seats 由 seats-generated.test.ts 拦；这里只守"同源"这件事本身。
    const generated = SEAT_KINDS.map((k) => JSON.stringify(k)).join(" | ");
    expect(generated).toContain('"coordinator"');
    expect(generated.split(" | ")).toHaveLength(SEAT_KINDS.length);
  });

  it("现役全表仍然合规", () => {
    expect(() => assertSeatContractComplete()).not.toThrow();
  });

  it("全表恰有一席协调席：叙事生成配置助手（入口）", () => {
    // 协调席是为它而加的一类。多出第二席要先想清楚"谁统领谁"——入口之上没有别的总起。
    const coordinators = ASSISTANT_SEATS.filter((s) => s.kind === "coordinator");
    expect(coordinators.map((s) => s.id)).toEqual(["entry_config"]);
    expect(coordinators[0]!.contentType).toBeNull();
  });
});

describe("contentType 两向都判", () => {
  it("协调席带了 contentType 就不成立", () => {
    expect(() =>
      assertSeatContractComplete([baseSeat({ kind: "coordinator", contentType: "outline" })]),
    ).toThrow(/contentType 必须为 null/);
  });

  it("协调席的 contentType 为 null 时成立", () => {
    expect(() =>
      assertSeatContractComplete([baseSeat({ kind: "coordinator", contentType: null })]),
    ).not.toThrow();
  });

  it("其余四类缺 contentType 就不成立", () => {
    // 缺了的后果很安静：产物落盘后掉进"无类别"堆，两库都归不进去，不报错。
    for (const kind of SEAT_KINDS.filter((k) => k !== "coordinator")) {
      const extra: Partial<AssistantSeat> =
        kind === "validator"
          ? { report: { field: "r", autoRepair: false } }
          : kind === "polisher"
            ? { branch: { baseField: "b" } }
            : kind === "retriever"
              ? { retrieval: { sources: ["local"], field: "f" } }
              : {};
      expect(
        () => assertSeatContractComplete([baseSeat({ kind, contentType: null, ...extra })]),
        `${kind} 缺 contentType 应被拦下`,
      ).toThrow(/必须声明 contentType/);
    }
  });

  it("协调席不该借用其他 kind 的专属字段", () => {
    expect(() =>
      assertSeatContractComplete([
        baseSeat({ kind: "coordinator", contentType: null, branch: { baseField: "b" } }),
      ]),
    ).toThrow(/不该带其他 kind 的专属字段/);
  });
});
