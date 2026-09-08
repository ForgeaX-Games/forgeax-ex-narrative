import { describe, it, expect } from "vitest";
import { executeAgent } from "../core/agent-exec.js";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient, WebSource } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * G3 结构表达（req_list 席）的席位级 composite 外壳护栏，与 structure-seat-workflow
 * 同一套校验点：declared 形态是 composite、子步按 edges 声明顺序执行、产出落到
 * 未改动的两个子 agent 各自的 ctx 字段（零漂移）。
 *
 * req_list 是 G3 新补的一席（此前只有 structure 一席有 composite 外壳）：
 * `/agent/req_list/run` 此前会撞"未注册"，只能改传第一个子 step id
 * `preference_summary`，席位粒度对平台代理不可见。
 *
 * 与 structure 席不同：preference_summary / preference_analysis 都已是 M2 迁移的
 * runner 实现，不是走 legacy bridge 直调 step 函数，这里用 stub LLM 而非 monkey-patch
 * step.fn。SingleTurnRunner 统一走 callWithRetry（流式与否只影响是否额外传 onChunk），
 * 按 opts.responseFormat 分流两个子步各自要的回复。
 */
function stubLlm(
  textReply: string,
  jsonReply: string,
): LLMClient & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  const llm = {
    calls,
    supportsWebSearch: false,
    async callWithRetry(
      system: string,
      user: string,
      opts?: { responseFormat?: string },
      validate?: (raw: string) => void,
    ): Promise<string> {
      calls.push({ system, user });
      const reply = opts?.responseFormat === "json" ? jsonReply : textReply;
      validate?.(reply);
      return reply;
    },
    async callStreamFull(): Promise<string> {
      throw new Error("test stub does not expect callStreamFull for this path");
    },
    async callWithWebSearch(): Promise<{ text: string; citations: WebSource[] }> {
      throw new Error("test stub does not support web search");
    },
  };
  return llm as unknown as LLMClient & { calls: Array<{ system: string; user: string }> };
}

describe("req_list 席：席位级 composite 外壳", () => {
  it("AgentDef 声明为 composite，children 按 preference_summary → preference_analysis 串联", () => {
    const def = getAgentDef("req_list");
    expect(def).toBeTruthy();
    expect(def?.structure.type).toBe("composite");
    const config = def?.structure.config as {
      children: string[];
      edges: Array<{ source: string; target: string }>;
    };
    expect(config.children).toEqual(["preference_summary", "preference_analysis"]);
    expect(config.edges).toEqual([
      { source: "preference_summary", target: "preference_analysis" },
    ]);
  });

  it("执行 req_list 时按序跑两个子 agent，产出落到各自未改动的 ctx 字段", async () => {
    const summaryReply = "# 用户偏好总结\n主角信息：一位年轻侦探";
    const analysisReply = JSON.stringify({
      全局控制参数: { complexity: 3, deviation: 0.2, story_title: "雨季悬疑" },
      层级调控参数: { layer0_control: { min_nodes: 5, max_nodes: 6 } },
    });
    const llm = stubLlm(summaryReply, analysisReply);
    const ctx = { user_input: "一个雨季小镇的悬疑故事" } as unknown as NarrativeContext;

    const outcome = await executeAgent("req_list", ctx, llm);

    expect(outcome.via).toBe("runner"); // composite 本身走 runner，子步各走各的 runner
    expect(llm.calls.length).toBe(2); // 两个子 agent 各调一次模型
    expect((ctx as Record<string, unknown>).user_preference_summary).toBe(summaryReply);
    expect((ctx as Record<string, unknown>).global_control_params).toMatchObject({
      complexity: 3,
    });
    expect((ctx as Record<string, unknown>).story_title).toBe("雨季悬疑");
  });
});
