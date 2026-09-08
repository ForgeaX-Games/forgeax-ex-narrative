import { describe, it, expect } from "vitest";
import {
  buildLightHierarchy,
  applyDecompositionClosure,
  collectLeafIds,
  MAX_UNIT_CHARS,
} from "../phase1-understanding.js";
import { buildAdaptationDirective } from "../phase2b-adapt.js";
import { buildIpSourceReference } from "../../pipeline/steps/design-context-helper.js";
import type { NarrativeContext } from "../../types/index.js";
import type { GameUnitPlan } from "../../types/narrative-ip-dna.js";

const TS = "20260101_0000";

describe("算法建树 + 体量等分（去 LLM 拆解）", () => {
  it("无标记散文 → 整篇单 unit（不依赖 LLM）", () => {
    const dna = buildLightHierarchy({
      story_timestamp: TS,
      title: "散文",
      media_type: "book",
      text: "一段没有任何章节标记的散文。".repeat(20),
    });
    const leaves = collectLeafIds(dna);
    expect(leaves.length).toBe(1);
  });

  it("超体量巨型单元 → applyDecompositionClosure 纯算法按体量等分为多个子单元", () => {
    const huge = "无标记长文。".repeat(MAX_UNIT_CHARS); // 远超单单元上限
    const dna = buildLightHierarchy({ story_timestamp: TS, title: "巨", media_type: "book", text: huge });
    expect(collectLeafIds(dna).length).toBe(1);
    const closure = applyDecompositionClosure(dna, huge, true);
    expect(closure.splitUnits).toBeGreaterThan(0);
    expect(collectLeafIds(dna).length).toBeGreaterThan(1);
  });
});

describe("buildAdaptationDirective: adaptation_notes 合并（空=忠实）", () => {
  const dna = buildLightHierarchy({
    story_timestamp: TS,
    title: "测试",
    media_type: "book",
    text: "第一章\n内容一。\n第二章\n内容二。\n第三章\n内容三。",
  });

  it("未填补充 → 无 adaptation_notes（忠实转化）", () => {
    const d = buildAdaptationDirective(dna, {});
    expect(d.adaptation_notes).toBeUndefined();
  });

  it("仅空白补充 → 视为未填（trim 后为空）", () => {
    const d = buildAdaptationDirective(dna, { adaptationNotes: "   \n  " });
    expect(d.adaptation_notes).toBeUndefined();
  });

  it("有补充 → 原样合并（trim）", () => {
    const d = buildAdaptationDirective(dna, { adaptationNotes: "  改成赛博朋克  " });
    expect(d.adaptation_notes).toBe("改成赛博朋克");
  });
});

describe("rows → 显式 game_unit_plan：N 行得 N 个游戏单元", () => {
  const dna = buildLightHierarchy({
    story_timestamp: TS,
    title: "系列",
    media_type: "book",
    text: "第一部\n第一章\n甲。\n第二部\n第二章\n乙。\n第三部\n第三章\n丙。",
  });
  const leaves = collectLeafIds(dna);

  it("显式 gameUnitPlan 被优先采用，单元数 = 行数", () => {
    const plan: GameUnitPlan = {
      mode: "series",
      userSpecified: true,
      units: leaves.map((leaf, i) => ({
        index: i + 1,
        unitRange: { start: leaf, end: leaf },
        boundary: "hard",
      })),
    };
    const d = buildAdaptationDirective(dna, { gameUnitPlan: plan });
    expect(d.game_unit_plan.units.length).toBe(leaves.length);
    expect(d.game_unit_plan.mode).toBe("series");
  });
});

describe("buildIpSourceReference: 显式 IP 原文参考块", () => {
  it("无 uploaded_script → 空串（纯生成行为不变）", () => {
    const ref = buildIpSourceReference({} as NarrativeContext);
    expect(ref).toBe("");
  });

  it("有 uploaded_script.content → 输出忠实改编基准块", () => {
    const ctx = {
      uploaded_script: { content: "原文正文……", format: "prose", char_count: 5 },
    } as unknown as NarrativeContext;
    const ref = buildIpSourceReference(ctx);
    expect(ref).toContain("IP 原文参考");
    expect(ref).toMatch(/忠实/);
  });
});
