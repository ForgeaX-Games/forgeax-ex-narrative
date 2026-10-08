import { describe, it, expect } from "vitest";
import {
  ENCYCLOPEDIA_COMPOSER,
  encyclopediaRetrieval,
  encyclopediaTopic,
  buildLocalEvidence,
  validateEncyclopedia,
  normalizeEncyclopedia,
} from "../steps/encyclopedia.js";
import { composeUserPrompt } from "../runtime/prompt-composer.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import { getSeat, assertSeatContractComplete } from "../routing/assistant-seats.js";
import { STEP_FILE_MAP } from "../runtime/step-files.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient, WebSearchResult } from "../runtime/llm-client.js";
import "../core/step-registrations.js";

/**
 * 百科娘（2.5.1）。
 *
 * 本席的唯一失败模式不是"跑不起来"，而是**悄悄退化**：没有联网通道时，
 * 一份凭模型记忆写的作品设定与一份真检索来的在文本上分不出差别，而下游会把它
 * 当外部事实去对齐世界观。所以这里的断言集中在"通道事实是否如实落盘"。
 */

const DOC = JSON.stringify({
  topic: "《雨季手记》",
  summary: "一部以南方小镇雨季为背景的悬疑小说。",
  entries: [{ term: "林昭", detail: "游医，故事的叙述者。", basis: ["用户上传原文"] }],
  conflicts: [],
  sources: [{ kind: "local", label: "用户上传原文" }],
});

/** 桩 LLM：可选地提供联网通道，并记下两轮分别发了什么。 */
function stubLlm(opts: { web?: WebSearchResult | Error } = {}): LLMClient & {
  searchCalls: number;
  users: string[];
} {
  const users: string[] = [];
  let searchCalls = 0;
  const llm = {
    get searchCalls() { return searchCalls; },
    users,
    get supportsWebSearch() { return opts.web !== undefined; },
    async callWithWebSearch(): Promise<WebSearchResult> {
      searchCalls++;
      if (opts.web instanceof Error) throw opts.web;
      return opts.web as WebSearchResult;
    },
    async callWithRetry(
      _system: string,
      user: string,
      _o?: unknown,
      validate?: (raw: string) => void,
    ): Promise<string> {
      users.push(user);
      validate?.(DOC);
      return DOC;
    },
  };
  return llm as unknown as LLMClient & { searchCalls: number; users: string[] };
}

function ctxWithUpload(): NarrativeContext {
  return {
    user_input: "我想做一款改编自《雨季手记》的悬疑游戏",
    uploaded_script: { content: "林昭在雨夜叩门。" },
  } as unknown as NarrativeContext;
}

describe("百科娘席位", () => {
  it("已从 planned 转为 active，且绑定了实现（契约自检通过）", () => {
    const seat = getSeat("encyclopedia")!;
    expect(seat.status).toBe("active");
    expect(seat.bindings.flatMap((b) => b.agentIds)).toEqual(["encyclopedia_retrieval"]);
    expect(() => assertSeatContractComplete()).not.toThrow();
  });

  it("产物有落盘条目（缺了单独跑完前端卡片会是空白）", () => {
    expect(STEP_FILE_MAP.encyclopedia_retrieval).toBeTruthy();
  });

  it("step 已登记且带 composer（切 runner 才不会发空提示词）", () => {
    const desc = STEP_REGISTRY.get("encyclopedia_retrieval")!;
    expect(desc.composer).toBe(ENCYCLOPEDIA_COMPOSER);
    expect(desc.outputFields).toEqual(["encyclopedia_doc"]);
    // 检索外部资料，不吃上游产物 —— 席位 upstreamSeats 也应为空，两处口径一致。
    expect(desc.dependsOn).toEqual([]);
    expect(getSeat("encyclopedia")!.upstreamSeats).toEqual([]);
  });

  it("检索目标优先取显式指定，否则用用户需求", () => {
    expect(encyclopediaTopic(ctxWithUpload())).toContain("雨季手记");
    const explicit = { user_input: "x", encyclopedia_topic: "明代海禁" } as unknown as NarrativeContext;
    expect(encyclopediaTopic(explicit)).toBe("明代海禁");
  });

  it("本地源摘要收上传原文（权威源不能漏进提示词）", () => {
    expect(buildLocalEvidence(ctxWithUpload())).toContain("林昭在雨夜叩门");
    expect(buildLocalEvidence({ user_input: "x" } as NarrativeContext)).toBe("");
  });

  it("无联网通道时如实标注，并明令不得用记忆补充", async () => {
    const ctx = ctxWithUpload();
    const llm = stubLlm();
    await encyclopediaRetrieval(ctx, llm);

    expect(llm.searchCalls).toBe(0);
    expect(ctx.encyclopedia_doc!.channels).toEqual({ local: true, web: false });
    // 提示词里这句是"别拿记忆当检索结果"的唯一约束，删了就没有别的东西挡着。
    expect(llm.users[0]).toContain("不得以记忆补充");
  });

  it("有联网通道时，实检来源并进产物，且 web 通道标 true", async () => {
    const ctx = ctxWithUpload();
    const llm = stubLlm({
      web: {
        text: "据某百科：林昭为虚构人物。",
        citations: [{ uri: "https://example.org/a", title: "某百科" }],
      },
    });
    await encyclopediaRetrieval(ctx, llm);

    expect(llm.searchCalls).toBe(1);
    // 第一轮实检结果必须进第二轮的 user 段，否则等于查了不用。
    expect(llm.users[0]).toContain("林昭为虚构人物");
    expect(ctx.encyclopedia_doc!.channels.web).toBe(true);
    // 模型自己没写这条来源，仍要并进来：漏写来源不等于没检索到。
    expect(ctx.encyclopedia_doc!.sources.some((s) => s.uri === "https://example.org/a")).toBe(true);
  });

  it("联网失败退化为纯本地，不让整步失败", async () => {
    const ctx = ctxWithUpload();
    const llm = stubLlm({ web: new Error("network down") });
    await encyclopediaRetrieval(ctx, llm);
    expect(ctx.encyclopedia_doc!.channels).toEqual({ local: true, web: false });
  });

  it("channels 由执行事实定，不由模型自述定", () => {
    // 模型声称查了网（sources 里塞了 web 条），但本次没有实检来源。
    const claimed = {
      topic: "t",
      summary: "s",
      entries: [],
      conflicts: [],
      sources: [{ kind: "web", label: "我记得的某页", uri: "https://claimed.example" }],
    };
    const doc = normalizeEncyclopedia(claimed, { user_input: "t" } as NarrativeContext, []);
    expect(doc.channels).toEqual({ local: false, web: false });
  });

  it("缺 topic / entries / sources 触发重试", () => {
    expect(() => validateEncyclopedia(DOC)).not.toThrow();
    expect(() => validateEncyclopedia(JSON.stringify({ entries: [], sources: [] }))).toThrow();
    expect(() => validateEncyclopedia(JSON.stringify({ topic: "t", sources: [] }))).toThrow();
    expect(() => validateEncyclopedia(JSON.stringify({ topic: "t", entries: [] }))).toThrow();
  });

  it("user 段四块齐全（目标 / 本地源 / 联网结果 / 修改意见）", () => {
    const ctx = ctxWithUpload();
    (ctx as Record<string, unknown>)._userInstructions = "重点查地理背景";
    const user = composeUserPrompt(ENCYCLOPEDIA_COMPOSER, ctx);
    expect(user).toContain("## 检索目标");
    expect(user).toContain("## 本地源");
    expect(user).toContain("## 联网检索结果");
    expect(user).toContain("重点查地理背景");
  });
});
