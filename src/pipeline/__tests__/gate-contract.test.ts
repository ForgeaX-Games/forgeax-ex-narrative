/**
 * gate-contract.test.ts —— 起跑闸门的跨表一致性（防复发）
 *
 * 这组测试守的不是某个功能，而是一次结构性打架的修复结果。
 *
 * 打架的根因是一个"上游"概念被三张表各自表达过：
 *   - `StepDescriptor.dependsOn` 生于排序与重跑影响面；
 *   - `AssistantSeat.upstreamSeats` 生于产品侧的"通常接在谁后面"；
 *   - 单席起跑需要"没它就不能跑"，当时没有字段表达，就地拿 dependsOn 派生成了闸门。
 * 于是十席本该能独立起跑的助手里有六席单跑吃 422，而全量管线又根本不看闸门。
 *
 * 修法是把三个概念拆成三个字段各司其职（见 docs/absorption-filter.md 轴4）。
 * 拆开只修好当下，下次有人再"顺手派生"就会重演，所以要有这组双向断言挡着。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ASSISTANT_SEATS,
  resolveSeatAgents,
  getSeat,
} from "../routing/assistant-seats.js";
import { STEP_REGISTRY, getStepRequiredInputs } from "../core/step-registry.js";
import { producerSeatForField } from "../core/input-provenance.js";
import { NARRATIVE_PIPELINES } from "../routing/narrative-pipelines.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/** 独立席允许出现的唯一输入：用户自己带进来的那句需求。 */
const ALLOWED_INDEPENDENT_INPUTS = new Set(["user_input"]);

/**
 * 一席的起跑入口 step：通用兜底绑定的第一个实现。
 *
 * 取第一个而不是全部，是因为席内多步是一条 workflow（需求提炼→需求分析），
 * 后续步吃的是前一步的产物，闸门只该拦在入口。
 */
function entryStepOf(seatId: string): string | undefined {
  return resolveSeatAgents(seatId)[0];
}

describe("起跑闸门契约：runPolicy 与 requiredInputs 互相印证", () => {
  it("independent 席的入口 step 不得有硬上游", () => {
    const violations: string[] = [];
    for (const seat of ASSISTANT_SEATS) {
      if (seat.runPolicy !== "independent") continue;
      const stepId = entryStepOf(seat.id);
      if (!stepId) {
        violations.push(`${seat.id}: 声明 independent 却解析不到入口实现`);
        continue;
      }
      const required = getStepRequiredInputs(stepId);
      const illegal = required.filter((f) => !ALLOWED_INDEPENDENT_INPUTS.has(f));
      if (illegal.length > 0) {
        violations.push(
          `${seat.id}（入口 ${stepId}）: 声明可独立起跑，却硬要 ${illegal.join(", ")}`,
        );
      }
    }
    expect(violations, "独立席被硬上游挡住了，单跑会吃 422").toEqual([]);
  });

  it("requires-upstream 席的入口 step 必须有能反查到产出席位的硬上游", () => {
    const violations: string[] = [];
    for (const seat of ASSISTANT_SEATS) {
      if (seat.runPolicy !== "requires-upstream") continue;
      const stepId = entryStepOf(seat.id);
      if (!stepId) {
        violations.push(`${seat.id}: 声明 requires-upstream 却解析不到入口实现`);
        continue;
      }
      const required = getStepRequiredInputs(stepId);
      if (required.length === 0) {
        violations.push(`${seat.id}（入口 ${stepId}）: 声明必须有上游，却没有任何 requiredInputs`);
        continue;
      }
      // 反查不到产出席位就没法生成"需先运行【X 助手】"，报错只能甩字段名给用户。
      for (const field of required) {
        if (!producerSeatForField(field)) {
          violations.push(`${seat.id}: requiredInputs 里的 ${field} 查不到产出席位`);
        }
      }
    }
    expect(violations, "依赖席的闸门声明不完整").toEqual([]);
  });

  it("active 席都表过态，planned 席都没表态", () => {
    const problems = ASSISTANT_SEATS.filter(
      (s) => (s.status === "active") !== (s.runPolicy !== undefined),
    ).map((s) => `${s.id}: status=${s.status} runPolicy=${String(s.runPolicy)}`);
    expect(problems, "runPolicy 与 status 不配套").toEqual([]);
  });

  it("按需求分类落表：十席独立 / 九席依赖 / 一席 planned", () => {
    const byPolicy = (policy: string): string[] =>
      ASSISTANT_SEATS.filter((s) => s.runPolicy === policy).map((s) => s.id).sort();

    expect(byPolicy("independent")).toEqual([
      "character", "codex", "design_doc", "encyclopedia", "item",
      "narrative_card", "outline", "req_list", "scene_list", "worldview",
    ]);
    expect(byPolicy("requires-upstream")).toEqual([
      "content_check", "deai", "plot", "plot_polish", "plot_refine",
      "quest", "storyboard", "structure", "structure_check",
    ]);
    expect(ASSISTANT_SEATS.filter((s) => s.status === "planned").map((s) => s.id))
      .toEqual(["playability"]);
  });
});

describe("planned 席不参与运行", () => {
  it("不出现在任何管线的席位序列里", () => {
    const planned = ASSISTANT_SEATS.filter((s) => s.status === "planned").map((s) => s.id);
    const offenders: string[] = [];
    for (const pipeline of Object.values(NARRATIVE_PIPELINES)) {
      for (const seatId of pipeline.seats) {
        if (planned.includes(seatId)) offenders.push(`${pipeline.id} → ${seatId}`);
      }
    }
    expect(offenders, "planned 席被排进了管线").toEqual([]);
  });

  it("不声明上下游，实现只挂 alsoOwns", () => {
    for (const seat of ASSISTANT_SEATS.filter((s) => s.status === "planned")) {
      expect(seat.upstreamSeats, seat.id).toEqual([]);
      expect(seat.bindings, seat.id).toEqual([]);
      expect(resolveSeatAgents(seat.id), seat.id).toEqual([]);
    }
  });
});

describe("dependsOn 不再被当闸门读取", () => {
  /**
   * 唯一合法的消费点是 `getStepRequiredInputs` 里那条显式回退分支（给未接入席位的
   * 历史 step 兜底）。除它之外，凡把 `getStepDependencies` / `.dependsOn` 的结果
   * 拿去做"能不能跑"判断的代码路径都是复发。
   *
   * 这条测试用扫源码的方式守：`dependsOn` 出现在同一表达式里与 missing / required /
   * assert / block 这类闸门词汇挨着，就要被点名。比逐个 mock 调用路径笨，但不会漏。
   */
  const GATE_WORDS = /missing|required|assert|blocked|canRun/i;

  function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "_archive" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full));
      else if (entry.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  it("没有第二处把 dependsOn 当闸门", () => {
    const root = join(import.meta.dirname, "..", "..");
    const offenders: string[] = [];
    for (const file of collectSourceFiles(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/dependsOn|getStepDependencies/.test(line)) return;
        if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
        // step-registry 的显式回退分支：唯一豁免点。
        if (file.endsWith("step-registry.ts")) return;
        if (GATE_WORDS.test(line)) {
          offenders.push(`${file.slice(root.length + 1)}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders, "dependsOn 又被拿去当起跑闸门了；闸门唯一真值是 requiredInputs").toEqual([]);
  });
});

describe("upstreamSeats 与 dependsOn 各自符合自己的语义", () => {
  it("upstreamSeats 只写席位、且都存在（展示与排序用，不是闸门）", () => {
    const bad: string[] = [];
    for (const seat of ASSISTANT_SEATS) {
      for (const up of seat.upstreamSeats) {
        if (!getSeat(up)) bad.push(`${seat.id} → ${up}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("dependsOn 只写 step、且都已注册（拓扑排序与重跑影响面用）", () => {
    const bad: string[] = [];
    for (const [id, desc] of STEP_REGISTRY) {
      for (const dep of desc.dependsOn) {
        if (!STEP_REGISTRY.has(dep)) bad.push(`${id} → ${dep}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("允许两者不一致，但每处不一致都必须能用各自语义解释", () => {
    // codex 席 upstreamSeats 为空（可独立起跑）而其 step lore_generation 的
    // dependsOn 指向 worldview（管线里排在世界观之后）——这不是打架，是两个
    // 概念本就不同。这条用例把它固化成"预期存在的差异"，避免有人为了"对齐"
    // 而把其中一处改错。
    const codex = getSeat("codex")!;
    expect(codex.upstreamSeats).toEqual([]);
    expect(codex.runPolicy).toBe("independent");
    expect(STEP_REGISTRY.get("lore_generation")!.dependsOn).toContain("worldview");
    expect(getStepRequiredInputs("lore_generation")).toEqual([]);
  });
});
