import { describe, it, expect } from "vitest";
import type { NarrativeContext } from "../../../types/index.js";
import { assemblePrompt, PROMPT_SLOT_ORDER } from "../skeleton.js";
import { renderPlaceholders, hasPlaceholders, hasIpDnaPlaceholders, resolveCtxPath } from "../syntax.js";
import { buildSlotMap, renderTemplateWithProviders } from "../index.js";

describe("prompt/skeleton", () => {
  it("assembles non-empty slots in fixed §7.2b order", () => {
    const out = assemblePrompt({
      output: "OUT",
      role: "ROLE",
      operators: "OPS",
      objective_truth: "TRUTH",
    });
    // role < objective_truth < operators < output
    expect(out.indexOf("ROLE")).toBeLessThan(out.indexOf("TRUTH"));
    expect(out.indexOf("TRUTH")).toBeLessThan(out.indexOf("OPS"));
    expect(out.indexOf("OPS")).toBeLessThan(out.indexOf("OUT"));
  });

  it("skips empty/missing slots and can wrap headings", () => {
    const out = assemblePrompt({ role: "  ", cot: "step1" }, { wrapHeadings: true });
    expect(out).not.toContain("身份");
    expect(out).toContain("## 机制与流程");
    expect(out).toContain("step1");
  });

  it("does not double-wrap content that already has a heading", () => {
    const out = assemblePrompt({ cot: "## 我的标题\n内容" }, { wrapHeadings: true });
    expect(out).toBe("## 我的标题\n内容");
  });

  it("slot order covers all §7.2b stages", () => {
    expect(PROMPT_SLOT_ORDER[0]).toBe("role");
    expect(PROMPT_SLOT_ORDER).toContain("objective_truth");
    expect(PROMPT_SLOT_ORDER[PROMPT_SLOT_ORDER.length - 1]).toBe("output");
  });
});

describe("prompt/syntax", () => {
  it("resolves slot / IP_DNA / SKILL / data / ctx placeholders", () => {
    const ctx = { user_input: "你好" } as NarrativeContext;
    const tpl = "[{{slot:genre_style}}][{{IP_DNA.operators}}][{{SKILL.style_guide}}][{{data:echo(hi)}}][{{ctx.user_input}}]";
    const out = renderPlaceholders(tpl, {
      ctx,
      slots: { genre_style: "GS", "IP_DNA.operators": "OPS", "SKILL.style_guide": "SG" },
      data: { echo: (a) => `echo:${a}` },
    });
    expect(out).toBe("[GS][OPS][SG][echo:hi][你好]");
  });

  it("replaces unresolved placeholders with empty string", () => {
    const out = renderPlaceholders("[{{slot:missing}}][{{ctx.nope.deep}}]", { ctx: {} as NarrativeContext, slots: {} });
    expect(out).toBe("[][]");
  });

  it("detects placeholder presence", () => {
    expect(hasPlaceholders("plain")).toBe(false);
    expect(hasPlaceholders("{{ctx.x}}")).toBe(true);
    expect(hasIpDnaPlaceholders("{{IP_DNA.operators}}")).toBe(true);
    expect(hasIpDnaPlaceholders("{{slot:operators}}")).toBe(true);
    expect(hasIpDnaPlaceholders("{{slot:genre_style}}")).toBe(false);
  });

  it("resolveCtxPath JSON-stringifies objects", () => {
    const ctx = { tier_detection: { tier: "tier1" } } as unknown as NarrativeContext;
    expect(resolveCtxPath(ctx, "tier_detection.tier")).toBe("tier1");
    expect(resolveCtxPath(ctx, "tier_detection")).toContain("tier1");
  });
});

describe("prompt/providers", () => {
  it("maps IP DNA injected sections to skeleton slots + IP_DNA alias", () => {
    const ctx = { user_input: "x" } as NarrativeContext;
    (ctx as Record<string, unknown>)._operator_injection_sections = {
      plot_generation: { operators: "三视角算子段", relations: "关系段" },
    };
    const slots = buildSlotMap(ctx, "plot_generation");
    expect(slots.operators).toBe("三视角算子段");
    expect(slots["IP_DNA.operators"]).toBe("三视角算子段");
    expect(slots.relations).toBe("关系段");
  });

  it("renderTemplateWithProviders fills slot + ctx placeholders end-to-end", () => {
    const ctx = { user_input: "需求文本" } as NarrativeContext;
    (ctx as Record<string, unknown>)._operator_injection_sections = {
      plot_generation: { operators: "OPS" },
    };
    const tpl = "身份段\n{{slot:operators}}\n用户：{{ctx.user_input}}";
    const out = renderTemplateWithProviders(tpl, ctx, "plot_generation");
    expect(out).toContain("OPS");
    expect(out).toContain("需求文本");
  });
});
