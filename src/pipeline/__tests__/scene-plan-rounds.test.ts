/**
 * 场景树按层分轮。
 *
 * 盯两件事：第二轮真的看得见第一轮定下来的上层（否则分轮只是多调一次模型），
 * 以及两轮的范围互不重叠（否则聚合器要收拾两份互相打架的树）。
 */
import { describe, expect, it, vi } from "vitest";
import { scenePlan } from "../steps/scene-plan.js";
import type { LLMClient } from "../runtime/llm-client.js";
import type { NarrativeContext } from "../../types/index.js";

const UPPER = JSON.stringify({
  scenes: [
    { name: "苍原", parent: "", level: 0, label: ["narrative"], description: {} },
    { name: "北境", parent: "苍原", level: 1, label: ["narrative"], description: {} },
    { name: "雪原镇", parent: "北境", level: 2, label: ["narrative"], description: {} },
  ],
});

const LOWER = JSON.stringify({
  scenes: [
    { name: "铁匠铺", parent: "雪原镇", level: 3, label: ["narrative"], description: {} },
    { name: "锻造间", parent: "铁匠铺", level: 4, label: ["narrative"], description: {} },
  ],
});

function ctx(): NarrativeContext {
  return {
    user_input: "一个雪原世界",
    core_settings: { world_name: "苍原", genre: "奇幻" },
  } as unknown as NarrativeContext;
}

function recordingLlm(replies: string[]): { llm: LLMClient; users: string[] } {
  const users: string[] = [];
  let i = 0;
  const llm = {
    callWithRetry: vi.fn(async (_system: string, user: string) => {
      users.push(user);
      return replies[Math.min(i++, replies.length - 1)];
    }),
  } as unknown as LLMClient;
  return { llm, users };
}

describe("场景树分两轮", () => {
  it("跑两轮，不是一次出整棵树", async () => {
    const { llm } = recordingLlm([UPPER, LOWER]);
    await scenePlan(ctx(), llm);
    expect(llm.callWithRetry).toHaveBeenCalledTimes(2);
  });

  it("第一轮只要 0-2 层，明说不往下展开", async () => {
    const { llm, users } = recordingLlm([UPPER, LOWER]);
    await scenePlan(ctx(), llm);
    expect(users[0]).toContain("第 0-2 层");
    expect(users[0]).not.toContain("已定的上层场景树");
  });

  it("第二轮拿到第一轮定下来的上层，逐个列名", async () => {
    const { llm, users } = recordingLlm([UPPER, LOWER]);
    await scenePlan(ctx(), llm);
    expect(users[1]).toContain("已定的上层场景树");
    expect(users[1]).toContain("雪原镇");
    expect(users[1]).toContain("第 3-5 层");
  });

  it("两轮的场景都进最终的树", async () => {
    const c = ctx();
    const { llm } = recordingLlm([UPPER, LOWER]);
    await scenePlan(c, llm);
    const names = c.scene_map!.scenes.map((s) => s.name);
    expect(names).toContain("雪原镇");
    expect(names).toContain("锻造间");
  });

  it("下层为空是合法答案：纯野外的世界没有值得进去的室内", async () => {
    const c = ctx();
    const { llm } = recordingLlm([UPPER, JSON.stringify({ scenes: [] })]);
    await scenePlan(c, llm);
    expect(c.scene_map!.scenes.length).toBeGreaterThan(0);
  });

  it("上层为空则重试（校验器抛错），空的上层等于什么也没规划出来", async () => {
    const empty = JSON.stringify({ scenes: [] });
    const llm = {
      callWithRetry: vi.fn(async (_s: string, _u: string, _o: unknown, validate?: (r: string) => void) => {
        validate?.(empty);
        return empty;
      }),
    } as unknown as LLMClient;
    await expect(scenePlan(ctx(), llm)).rejects.toThrow("上层场景");
  });
});
