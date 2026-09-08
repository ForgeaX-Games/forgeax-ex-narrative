/**
 * custom-team/distill-seats.ts — 2.4 的两席契约表
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么不塞进 ASSISTANT_SEATS
 * ─────────────────────────────────────────────────────────────────
 * 那张表是**叙事单品助手团队**的花名册，二十席与 `seat-spec.ts`
 * 的 CSV 行一一对应，且有测试守着"不多不少二十席"。2.4 是另一个产品分类
 * （自定义专属创作团队），它的两席干的也不是同一类活：2.3 各席产出叙事产物，
 * 2.4 两席产出的是**能注入 2.3 各席的团队成员**。
 *
 * 混进同一张表会立刻废掉那条不变量，而且前端两处入口（叙事单品助手团队 /
 * 自定义专属团队）会出现同一个席位。所以另立一表，形状刻意与 AssistantSeat 相近，
 * 便于前端投影时复用同一套渲染。
 */
import type { TeamKind } from "./types.js";

export interface DistillSeat {
  id: string;
  /** 席位编号。 */
  featureId: string;
  name: string;
  /** 职责原文，逐字抄自席位表。 */
  responsibility: string;
  /** 本席蒸馏出哪一种团队成员。 */
  produces: TeamKind;
  /** 复用的现成管线/工具，写清"哪部分是复用、哪部分是本席新增"。 */
  reuses: string[];
  /** 前置依赖席位（跨 2.3/2.4 皆可）。 */
  dependsOnSeats: string[];
}

export const DISTILL_SEATS: readonly DistillSeat[] = [
  {
    id: "book_template_distill",
    featureId: "2.4.1",
    name: "模板创作助手蒸馏专家",
    responsibility:
      "复用IP提炼管线（IP提炼专家）和书籍模板蒸馏工具（模板创作助手蒸馏专家）"
      + "对书籍进行蒸馏，形成<书籍>模板创作助手。",
    produces: "book_template",
    reuses: ["ip-dna: runIngest", "ip-dna: runExtractAndGenerate(runGeneration=false)"],
    dependsOnSeats: [],
  },
  {
    id: "author_advisor_distill",
    featureId: "2.4.2",
    name: "作家创作顾问蒸馏专家",
    responsibility:
      "复用IP提炼管线（IP提炼专家）和作家创作蒸馏工具（作家创作顾问蒸馏专家）"
      + "对书籍以及相关内容文件进行蒸馏，形成<作家>创作顾问。",
    produces: "author_advisor",
    reuses: [
      "ip-dna: runIngest",
      "ip-dna: runExtractAndGenerate(runGeneration=false)",
      "2.3.20 百科娘：检索作者公开资料",
    ],
    // 作者本人的资料不在用户上传里，只能检索——这就是百科娘必须先落地的原因。
    dependsOnSeats: ["encyclopedia"],
  },
];

const INDEX = new Map(DISTILL_SEATS.map((s) => [s.id, s]));

export function getDistillSeat(id: string): DistillSeat | undefined {
  return INDEX.get(id);
}

/** 产出某种团队成员的那一席。 */
export function distillSeatForKind(kind: TeamKind): DistillSeat {
  const seat = DISTILL_SEATS.find((s) => s.produces === kind);
  if (!seat) throw new Error(`没有蒸馏席产出 ${kind}`);
  return seat;
}
