import { describe, it, expect } from "vitest";
import { executeAgent } from "../core/agent-exec.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import { RUNNER_MIGRATIONS } from "../core/runner-migration.js";
import { hasValidator, hasNormalizer } from "../blueprint/processor-registry.js";
import { PromptResolver } from "../blueprint/prompt-resolver.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * 逐席迁到 AgentRunner 的等价性护栏。
 *
 * 迁移的定义是「换执行路径，不换产出」。所以每一席都要正面比对两条路：同一份 ctx、
 * 同一份模型输出，legacy step 函数与 runner 必须写回一模一样的东西（含派生字段）。
 * 只断言"跑通了"没有意义 —— 静默少写一个派生字段正是这类迁移最常见的失败方式。
 */

/** 把固定文本当模型输出的假 LLM；顺带记下真正发出去的提示词。 */
function stubLlm(reply: string): LLMClient & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  const llm = {
    calls,
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
  };
  return llm as unknown as LLMClient & { calls: Array<{ system: string; user: string }> };
}

const CHARACTERS = JSON.stringify([
  { name: "林昭", label: "主角", race: "人类", occupation: "游医" },
  { name: "沈黎", label: "NPC", race: "人类", occupation: "书吏" },
]);

const ITEMS = JSON.stringify({
  item_database: [
    { name: "断刃", type: "武器" },
    { name: "药囊", type: "消耗品" },
    { name: "旧地图", type: "任务道具" },
  ],
});

function baseCtx(): NarrativeContext {
  return {
    user_input: "一个雨季小镇的悬疑故事",
    worldview: { setting: "雨季不停的南方小镇" },
  } as unknown as NarrativeContext;
}

/** 绕开 useNewRunner 走 legacy 那条路，拿它的产出当基准。 */
async function viaLegacy(stepId: string, reply: string): Promise<NarrativeContext> {
  const ctx = baseCtx();
  await STEP_REGISTRY.get(stepId)!.fn!(ctx, stubLlm(reply));
  return ctx;
}

async function viaRunner(stepId: string, reply: string): Promise<NarrativeContext> {
  const ctx = baseCtx();
  const outcome = await executeAgent(stepId, ctx, stubLlm(reply));
  expect(outcome.via, `${stepId} 没走 runner`).toBe("runner");
  return ctx;
}

describe("已迁席位的双路等价", () => {
  it("角色档案：runner 与 legacy 产出一致（含 player_name 这个派生字段）", async () => {
    const legacy = await viaLegacy("character_enrichment", CHARACTERS);
    const runner = await viaRunner("character_enrichment", CHARACTERS);

    expect(runner.detailed_character_sheets).toEqual(legacy.detailed_character_sheets);
    // 派生字段：runner 只写 io.outputField，player_name 全靠归一化器补。
    expect(runner.player_name).toBe("林昭");
    expect(runner.player_name).toBe(legacy.player_name);
  });

  it("道具清单：runner 与 legacy 产出一致（包在 item_database 键下也要拆开）", async () => {
    const legacy = await viaLegacy("item_database", ITEMS);
    const runner = await viaRunner("item_database", ITEMS);

    expect(Array.isArray(runner.item_database)).toBe(true);
    expect(runner.item_database).toEqual(legacy.item_database);
  });

  it("两条路发出的提示词逐字相同", async () => {
    for (const [stepId, reply] of [
      ["character_enrichment", CHARACTERS],
      ["item_database", ITEMS],
    ] as const) {
      const legacyLlm = stubLlm(reply);
      await STEP_REGISTRY.get(stepId)!.fn!(baseCtx(), legacyLlm);
      const runnerLlm = stubLlm(reply);
      await executeAgent(stepId, baseCtx(), runnerLlm);

      expect(runnerLlm.calls[0]!.system, `${stepId} system 段两路不同`).toBe(
        legacyLlm.calls[0]!.system,
      );
      // user 段是重点：它原先由 step 函数手拼 + appendUserInstructions 事后追加，
      // 迁移时挪进了 composer 的 userBlockOrder。挪漏一块就是模型少看一段上游。
      expect(runnerLlm.calls[0]!.user, `${stepId} user 段两路不同`).toBe(
        legacyLlm.calls[0]!.user,
      );
      expect(runnerLlm.calls[0]!.user.length).toBeGreaterThan(50);
    }
  });

  it("重生成的用户修改意见在 runner 路径下没丢", async () => {
    const ctx = baseCtx() as Record<string, unknown>;
    ctx._userInstructions = "把主角改成女性，年龄下调十岁";
    const llm = stubLlm(CHARACTERS);
    await executeAgent("character_enrichment", ctx as NarrativeContext, llm);
    expect(llm.calls[0]!.user).toContain("把主角改成女性");
  });

  /**
   * 任务席是第一个按分片原语跑的席位，等价性要核四件事：
   * 每片的 user 段（必须是本片节点的材料）、逐片落地、汇总口径、以及全量时的图质量门。
   */
  describe("任务席（分片）", () => {
    const PLOTS = [
      { node_id: "n1", parent_id: "root", content: "雨夜叩门", prev_node: [], next_node: ["n2"] },
      { node_id: "n2", parent_id: "root", content: "灯下对质", prev_node: ["n1"], next_node: [] },
    ];

    /** 每片回一条以本片 node_id 命名的任务，据此看清哪片拿到了哪份材料。 */
    function questReplyFor(userPrompt: string): string {
      const nodeId = userPrompt.includes("n2") && userPrompt.includes("灯下对质") ? "n2" : "n1";
      return JSON.stringify({
        quests: [
          { quest_id: `q_${nodeId}`, name: `任务-${nodeId}`, type: nodeId === "n1" ? "main" : "side" },
        ],
      });
    }

    function questLlm(): LLMClient & { users: string[] } {
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
          const reply = questReplyFor(user);
          validate?.(reply);
          return reply;
        },
      };
      return llm as unknown as LLMClient & { users: string[] };
    }

    function questCtx(): NarrativeContext {
      const saved: Array<{ nodeId: string; data: unknown }> = [];
      const ctx = {
        user_input: "一个雨季小镇的悬疑故事",
        plots_generated: { plots: PLOTS, plot_id_map: {} },
        _saveNode: (_step: string, nodeId: string, data: unknown) => {
          saved.push({ nodeId, data });
        },
        _savedNodes: saved,
      } as unknown as NarrativeContext;
      return ctx;
    }

    it("runner 与 legacy 的 quest_graph 一致", async () => {
      const legacyCtx = questCtx();
      await STEP_REGISTRY.get("quest_generation")!.fn!(legacyCtx, questLlm());

      const runnerCtx = questCtx();
      const outcome = await executeAgent("quest_generation", runnerCtx, questLlm());
      expect(outcome.via).toBe("runner");

      expect(runnerCtx.quest_graph!.quests.map((q) => q.quest_id).sort()).toEqual([
        "q_n1",
        "q_n2",
      ]);
      expect(runnerCtx.quest_graph!.main_quest_chain).toEqual(
        legacyCtx.quest_graph!.main_quest_chain,
      );
      expect(runnerCtx.quest_graph!.branch_quests).toEqual(legacyCtx.quest_graph!.branch_quests);
    });

    it("每片拿到的是本片节点的材料，不是第一片的", async () => {
      const llm = questLlm();
      await executeAgent("quest_generation", questCtx(), llm);
      expect(llm.users).toHaveLength(2);
      // 解析发生在分片之前，若不逐片重装配，两片会拿到同一份 user 段。
      expect(llm.users[0]).not.toBe(llm.users[1]);
      expect(llm.users.some((u) => u.includes("雨夜叩门"))).toBe(true);
      expect(llm.users.some((u) => u.includes("灯下对质"))).toBe(true);
    });

    it("逐片落地：每个节点一完成就写单节点文件并记进已完成集合", async () => {
      const ctx = questCtx();
      await executeAgent("quest_generation", ctx, questLlm());
      const saved = (ctx as unknown as { _savedNodes: Array<{ nodeId: string }> })._savedNodes;
      expect(saved.map((s) => s.nodeId).sort()).toEqual(["n1", "n2"]);
      const completed = (ctx as unknown as { _questCompletedNodes: Set<string> })
        ._questCompletedNodes;
      expect([...completed].sort()).toEqual(["n1", "n2"]);
    });

    it("局部重跑只跑被选节点，且跳过图质量门", async () => {
      const ctx = questCtx();
      (ctx as Record<string, unknown>)._nodeFilter = ["n2"];
      const llm = questLlm();
      await executeAgent("quest_generation", ctx, llm);
      expect(llm.users).toHaveLength(1);
      expect(ctx.quest_graph!.quests.map((q) => q.quest_id)).toEqual(["q_n2"]);
    });
  });

  /**
   * 迁移表点名了、却没有 AgentDef 可切的实现。
   *
   * 唯一成因是所属席位为 planned：`registerSeatAgentDefs` 只认 bindings，planned
   * 席的实现挂在 alsoOwns 上，解析不到就派生不出 AgentDef。这类条目留在迁移表里
   * 是有意的——席位接回来时不必重做迁移——但必须逐条登记，否则"迁了却没切"就会
   * 变成静默漂移。
   */
  const MIGRATED_BUT_SEAT_PLANNED = ["playability_adapt"];

  it("迁移表点名的处理器都真的注册了（名字对不上要到线上才炸）", () => {
    const missing: string[] = [];
    for (const [stepId, m] of Object.entries(RUNNER_MIGRATIONS)) {
      for (const v of m.validators ?? []) {
        if (!hasValidator(v)) missing.push(`${stepId}: validator ${v}`);
      }
      if (m.normalizer && !hasNormalizer(m.normalizer)) {
        missing.push(`${stepId}: normalizer ${m.normalizer}`);
      }
      if (MIGRATED_BUT_SEAT_PLANNED.includes(stepId)) {
        expect(getAgentDef(stepId), `${stepId} 所属席位已 planned，不该还有 AgentDef`)
          .toBeUndefined();
        continue;
      }
      expect(getAgentDef(stepId)?.useNewRunner, `${stepId} 在迁移表里却没走 runner`).toBe(true);
    }
    expect(missing).toEqual([]);
  });
});

/**
 * composer 出来的提示词是终稿，runner 不得再渲染一遍。
 *
 * renderSystemPrompt 判定"模板里没有 IP DNA 占位符"就把算子片段 append 上去，
 * 而占位符恰恰已经被 composer 消费掉了 —— 再渲染一次就等于同一段算子进两遍提示词。
 */
describe("终稿标记", () => {
  it("composer 解析出的提示词标记为 final", () => {
    const composer = STEP_REGISTRY.get("character_enrichment")!.composer!;
    const prompts = PromptResolver.resolveFromComposer(composer, baseCtx());
    expect(prompts.final).toBe(true);
  });

  it("终稿再过一次 systemFor 不变（不会二次追加）", () => {
    const composer = STEP_REGISTRY.get("character_enrichment")!.composer!;
    const ctx = baseCtx();
    const prompts = PromptResolver.resolveFromComposer(composer, ctx);
    expect(PromptResolver.systemFor(prompts, ctx, "character_enrichment")).toBe(
      prompts.systemPrompt,
    );
  });
});
