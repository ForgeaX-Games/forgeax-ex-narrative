import { describe, it, expect } from "vitest";
import { ASSISTANT_SEATS } from "../routing/assistant-seats.js";
import { listSeatDiscovery, resolveSeatRunnableAgentId } from "../core/seat-agents.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * G3：席位粒度调用契约。`/agent/:id/run` 与平台工具面据 resolveSeatRunnableAgentId
 * 把「席位 id」翻译成一个今天真能跑的 AgentDef id；listSeatDiscovery 把这份解析结果
 * 摊平成平台可查询的席位清单（对应新增的 GET /api/narrative/seats 与
 * narrative:list-seats 工具）。
 */
describe("resolveSeatRunnableAgentId", () => {
  it("单步席且 id 与 step 同名：直接就是自己", () => {
    expect(resolveSeatRunnableAgentId("worldview")).toBe("worldview");
  });

  it("单步席但 step 命名与席位不同：解析到通用兜底绑定的那个 step", () => {
    // 故事大纲席（2.3.7）实现是 story_framework，历史命名不一致，正是这层解析要补的缺口。
    expect(resolveSeatRunnableAgentId("outline")).toBe("story_framework");
  });

  it("多步席已建 composite 外壳：解析到席位 id 本身", () => {
    expect(resolveSeatRunnableAgentId("structure")).toBe("structure");
    expect(resolveSeatRunnableAgentId("req_list")).toBe("req_list");
  });

  it("未知席位 id：解析不出来，不能猜一个", () => {
    expect(resolveSeatRunnableAgentId("not-a-real-seat")).toBeUndefined();
  });
});

describe("listSeatDiscovery", () => {
  const entries = listSeatDiscovery();

  it("覆盖全部 20 席，且每个 id 唯一", () => {
    expect(entries).toHaveLength(ASSISTANT_SEATS.length);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it("active 席位在通用兜底绑定下都能被单独调用（G3 的完成判据）", () => {
    const unrunnable = entries
      .filter((e) => e.status === "active" && !e.canRunStandalone)
      .map((e) => e.id);
    expect(unrunnable, "以下 active 席位仍无法按席位 id 单独调用").toEqual([]);
  });

  it("req_list 与 structure 都解析到自己的 composite 外壳", () => {
    const reqList = entries.find((e) => e.id === "req_list");
    const structure = entries.find((e) => e.id === "structure");
    expect(reqList?.runnableAgentId).toBe("req_list");
    expect(structure?.runnableAgentId).toBe("structure");
  });

  it("单步席 outline 报出真正会跑的 step id，而不是席位 id 本身", () => {
    const outline = entries.find((e) => e.id === "outline");
    expect(outline?.runnableAgentId).toBe("story_framework");
    expect(outline?.canRunStandalone).toBe(true);
  });
});
