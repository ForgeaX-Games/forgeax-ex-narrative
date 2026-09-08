import { describe, it, expect } from "vitest";
import { executeAgent } from "../core/agent-exec.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient, WebSource } from "../runtime/llm-client.js";
import type { StructureCheckReport } from "../steps/structure-check.js";
import type { ContentCheckReport } from "../steps/content-check.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/** ctx 的报告类字段是运行时挂载的私有产出，NarrativeContext 类型里没有声明，测试断言前先按实际形状收窄。 */
function structureCheckReportOf(ctx: NarrativeContext): StructureCheckReport | undefined {
  return (ctx as unknown as { structure_check_report?: StructureCheckReport }).structure_check_report;
}
function contentCheckReportOf(ctx: NarrativeContext): ContentCheckReport | undefined {
  return (ctx as unknown as { content_check_report?: ContentCheckReport }).content_check_report;
}

/**
 * M2 原子迁移（12 席）的双路等价护栏。
 *
 * 与 runner-migration.test.ts 同一惯例：同一份 ctx、同一份模型输出，legacy step
 * 函数与 runner 必须写回一模一样的东西（含派生字段），否则迁移只是换了执行路径的
 * 皮，产出可能已经悄悄漂移。
 */

/** 固定文本当模型输出；同时支持流式（preference_summary）与非流式两种调用方式。 */
function stubLlm(
  reply: string,
  opts: { supportsWebSearch?: boolean } = {},
): LLMClient & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  const llm = {
    calls,
    supportsWebSearch: opts.supportsWebSearch ?? false,
    async callWithRetry(
      system: string,
      user: string,
      _opts?: unknown,
      validate?: (raw: string) => void,
    ): Promise<string> {
      calls.push({ system, user });
      validate?.(reply);
      return reply;
    },
    async callStreamFull(
      system: string,
      user: string,
      _opts?: unknown,
      onChunk?: (chunk: string, accumulated: string) => void,
    ): Promise<string> {
      calls.push({ system, user });
      onChunk?.(reply, reply);
      return reply;
    },
    async callWithWebSearch(): Promise<{ text: string; citations: WebSource[] }> {
      throw new Error("test stub does not support web search");
    },
  };
  return llm as unknown as LLMClient & { calls: Array<{ system: string; user: string }> };
}

function baseCtx(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    user_input: "一个雨季小镇的悬疑故事",
    ...overrides,
  } as unknown as NarrativeContext;
}

async function viaLegacy(
  stepId: string,
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<NarrativeContext> {
  await STEP_REGISTRY.get(stepId)!.fn!(ctx, llm);
  return ctx;
}

async function viaRunner(
  stepId: string,
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<NarrativeContext> {
  const outcome = await executeAgent(stepId, ctx, llm);
  expect(outcome.via, `${stepId} 没走 runner`).toBe("runner");
  return ctx;
}

describe("M2 原子迁移：双路等价", () => {
  it("需求提炼（preference_summary）：流式纯文本产出一致", async () => {
    const reply = "# 用户偏好总结\n主角信息：一位年轻侦探";
    const legacy = await viaLegacy("preference_summary", baseCtx(), stubLlm(reply));
    const runner = await viaRunner("preference_summary", baseCtx(), stubLlm(reply));
    expect(runner.user_preference_summary).toBe(legacy.user_preference_summary);
    expect(runner.user_preference_summary).toBe(reply);
  });

  it("需求分析（preference_analysis）：全局控制参数与 story_title 派生一致", async () => {
    const reply = JSON.stringify({
      全局控制参数: { complexity: 3, deviation: 0.2, story_title: "雨季悬疑" },
      层级调控参数: {
        layer0_control: { min_nodes: 5, max_nodes: 6 },
      },
    });
    const legacy = await viaLegacy("preference_analysis", baseCtx(), stubLlm(reply));
    const runner = await viaRunner("preference_analysis", baseCtx(), stubLlm(reply));

    expect(runner.user_preference_analysis).toEqual(legacy.user_preference_analysis);
    expect(runner.global_control_params).toEqual(legacy.global_control_params);
    expect(runner.story_title).toBe(legacy.story_title);
    expect(runner.story_title).toBe("雨季悬疑");
    expect(runner.global_control_params?.complexity).toBe(3);
  });

  it("初步方案（initial_plan）：结构化大纲/核心设定/剧情简介/目标幕数全部一致", async () => {
    const reply = JSON.stringify({
      theme: "复仇与救赎",
      main_conflict: "侦探与凶手的心理博弈",
      world_name: "雨镇",
      protagonist: { name: "林昭", identity: "游医" },
      synopsis:
        "一个雨季小镇里，游医林昭卷入了一桩尘封多年的命案，随着调查深入，他发现真相牵连着自己早已遗忘的过去，必须在暴雨与谎言中找到唯一的出路。",
      story_structure: {
        opening: "林昭在雨夜出诊时目睹了一场命案",
        development: ["林昭暗中调查线索", "旧日恩怨浮出水面"],
      },
    });
    const legacy = await viaLegacy("initial_plan", baseCtx(), stubLlm(reply));
    const runner = await viaRunner("initial_plan", baseCtx(), stubLlm(reply));

    expect(runner.initial_story_outline).toEqual(legacy.initial_story_outline);
    expect(runner.core_settings).toEqual(legacy.core_settings);
    expect(runner.plot_synopsis).toEqual(legacy.plot_synopsis);
    expect(runner.story_title).toBe(legacy.story_title);
    expect(runner.story_title).toBe("雨镇");
    expect(runner.target_acts).toBe(legacy.target_acts);
  });

  it("世界观构建（worldview）：含 ui_style_prompt 兜底逻辑一致", async () => {
    const reply = JSON.stringify({
      world_name: "雨镇纪元",
      基础架构层: { WV_01_时空背景: { description: "常年阴雨的近现代小镇" } },
      交互叙事层: { WV_10_核心冲突: { description: "真相与掩盖的对抗" } },
    });
    const legacy = await viaLegacy("worldview", baseCtx(), stubLlm(reply));
    const runner = await viaRunner("worldview", baseCtx(), stubLlm(reply));

    expect(runner.worldview_structure).toEqual(legacy.worldview_structure);
    // 兜底 ui_style_prompt 两路都应生成（LLM 没给）
    expect(runner.worldview_structure?.ui_style_prompt?.zh).toBeTruthy();
  });

  it("设定集（lore_generation）：碎片与物品叙事一致，item_lore 派生字段不丢", async () => {
    const reply = JSON.stringify({
      lore_fragments: [{ id: "lore_001", type: "inscription", title: "石碑残文", content: "……" }],
      item_lore: [{ item_name: "断刃", item_type: "weapon", rarity: "rare" }],
    });
    const legacy = await viaLegacy("lore_generation", baseCtx(), stubLlm(reply));
    const runner = await viaRunner("lore_generation", baseCtx(), stubLlm(reply));

    expect(runner.lore_fragments).toEqual(legacy.lore_fragments);
    expect(runner.item_lore).toEqual(legacy.item_lore);
  });

  it("结构检查（structure_check）：确定性席位，legacy 与 runner 产出的报告一致", async () => {
    const ctx = () =>
      baseCtx({
        detailed_outlines_generated: {
          detailed_outlines: [
            { node_id: "n1", parent_id: "u1", prev_node: [], next_node: ["n2"] },
            { node_id: "n2", parent_id: "u1", prev_node: ["n1"], next_node: [] },
          ],
        },
      } as unknown as Partial<NarrativeContext>);

    const legacy = await viaLegacy("structure_check", ctx(), stubLlm(""));
    const runner = await viaRunner("structure_check", ctx(), stubLlm(""));

    // checkedAt 是时间戳，逐字段比对其余部分即可。
    expect(structureCheckReportOf(runner)?.verdict).toBe(structureCheckReportOf(legacy)?.verdict);
    expect(structureCheckReportOf(runner)?.layers).toEqual(structureCheckReportOf(legacy)?.layers);
    expect(structureCheckReportOf(runner)?.summary).toBe(structureCheckReportOf(legacy)?.summary);
  });

  describe("内容检查（content_check）：preflight 短路", () => {
    it("没有情节时两路都不发请求，给出同一份空报告", async () => {
      const legacyLlm = stubLlm("{}");
      const runnerLlm = stubLlm("{}");
      const legacy = await viaLegacy("content_check", baseCtx(), legacyLlm);
      const runner = await viaRunner("content_check", baseCtx(), runnerLlm);

      expect(legacyLlm.calls).toHaveLength(0);
      expect(runnerLlm.calls).toHaveLength(0);
      expect(contentCheckReportOf(runner)?.summary).toBe(contentCheckReportOf(legacy)?.summary);
      expect(contentCheckReportOf(runner)?.coverage).toEqual(contentCheckReportOf(legacy)?.coverage);
    });

    it("有情节时两路都真的发请求，报告一致", async () => {
      const withPlots = () =>
        baseCtx({
          plots_generated: { plots: [{ node_id: "n1", content: "雨夜叩门" }] },
        } as unknown as Partial<NarrativeContext>);
      const reply = JSON.stringify({
        verdict: "pass",
        summary: "未见硬伤",
        findings: [],
        coverage: [{ criterion: "逻辑自洽", checked: true }],
      });
      const legacyLlm = stubLlm(reply);
      const runnerLlm = stubLlm(reply);
      const legacy = await viaLegacy("content_check", withPlots(), legacyLlm);
      const runner = await viaRunner("content_check", withPlots(), runnerLlm);

      expect(legacyLlm.calls).toHaveLength(1);
      expect(runnerLlm.calls).toHaveLength(1);
      // checkedAt 是各自调用时的时间戳，逐字段比对其余部分即可。
      const { checkedAt: _l, ...legacyRest } = contentCheckReportOf(legacy) ?? ({} as ContentCheckReport);
      const { checkedAt: _r, ...runnerRest } = contentCheckReportOf(runner) ?? ({} as ContentCheckReport);
      expect(runnerRest).toEqual(legacyRest);
    });
  });

  it("百科娘（encyclopedia_retrieval）：preflight 不短路，两路装配出同一份资料汇编", async () => {
    const reply = JSON.stringify({
      topic: "雨季小镇悬疑故事",
      summary: "本地设定摘要",
      entries: [{ term: "雨镇", detail: "常年阴雨的小镇", basis: ["用户上传原文"] }],
      sources: [{ kind: "local", label: "用户上传原文" }],
    });
    const legacyLlm = stubLlm(reply);
    const runnerLlm = stubLlm(reply);
    const legacy = await viaLegacy("encyclopedia_retrieval", baseCtx(), legacyLlm);
    const runner = await viaRunner("encyclopedia_retrieval", baseCtx(), runnerLlm);

    // 无联网通道（supportsWebSearch=false），两路都只走一轮 LLM 调用。
    expect(legacyLlm.calls).toHaveLength(1);
    expect(runnerLlm.calls).toHaveLength(1);
    expect(runner.encyclopedia_doc).toEqual(legacy.encyclopedia_doc);
    expect(runner.encyclopedia_doc?.channels).toEqual({ local: false, web: false });
  });

  describe("打磨家族（deai_polish 代表四席共用机制）", () => {
    const PLOTS = [
      { node_id: "n1", parent_id: "root", content: "雨夜叩门", prev_node: [], next_node: ["n2"] },
      { node_id: "n2", parent_id: "root", content: "灯下对质", prev_node: ["n1"], next_node: [] },
    ];

    function polishReplyFor(userPrompt: string): string {
      const nodeId = userPrompt.includes("n2") ? "n2" : "n1";
      return JSON.stringify({
        content: `打磨后的${nodeId}`,
        changes: [`去掉了${nodeId}的命名情绪`],
      });
    }

    function polishLlm(): LLMClient & { users: string[] } {
      const users: string[] = [];
      const llm = {
        users,
        async callWithRetry(
          _system: string,
          user: string,
          _opts?: unknown,
          validate?: (raw: string) => void,
        ): Promise<string> {
          users.push(user);
          const reply = polishReplyFor(user);
          validate?.(reply);
          return reply;
        },
      };
      return llm as unknown as LLMClient & { users: string[] };
    }

    function polishCtx(): NarrativeContext {
      const saved: Array<{ nodeId: string; data: unknown }> = [];
      return {
        user_input: "一个雨季小镇的悬疑故事",
        plots_generated: { plots: PLOTS, plot_id_map: {} },
        _saveNode: (_step: string, nodeId: string, data: unknown) => {
          saved.push({ nodeId, data });
        },
        _savedNodes: saved,
      } as unknown as NarrativeContext;
    }

    it("runner 与 legacy 的打磨产物一致（骨架字段、changes 一并核对）", async () => {
      const legacyCtx = polishCtx();
      await STEP_REGISTRY.get("deai_polish")!.fn!(legacyCtx, polishLlm());

      const runnerCtx = polishCtx();
      const outcome = await executeAgent("deai_polish", runnerCtx, polishLlm());
      expect(outcome.via).toBe("runner");

      const legacyOut = (legacyCtx as unknown as Record<string, unknown>).plots_generated;
      const runnerOut = (runnerCtx as unknown as Record<string, unknown>).plots_generated;
      expect(runnerOut).toEqual(legacyOut);
    });

    it("逐片落地：每个节点一完成就调用 _saveNode", async () => {
      const ctx = polishCtx();
      await executeAgent("deai_polish", ctx, polishLlm());
      const saved = (ctx as unknown as { _savedNodes: Array<{ nodeId: string }> })._savedNodes;
      expect(saved.map((s) => s.nodeId).sort()).toEqual(["n1", "n2"]);
    });
  });
});
