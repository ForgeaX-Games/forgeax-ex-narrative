/**
 * universal-narrative-specialized.test.ts (B-M4/B-M5, archived)
 * ─────────────────────────────────────────────────────────────────
 * C3（2026-08）已封存：本文件是从
 * `agents/__tests__/universal-narrative.test.ts` 中拆出的
 * regionDesign / emergentEvent / cardLore / eventPool 四个薄包装用例，
 * 随四个品类特化 step 一并搬进 `_archive/specialized/`，仅用于回归比对被
 * 吸收前的原貌，不计入活跃测试套件的功能覆盖。
 *
 * 测试范围：
 *   - 正常路径：写入 ctx[outputField]
 *   - needs 门控不满足时走 emptyFallback（原 needsKeys/minNeed 组合）
 *   - LLM 输出畸形 / 缺字段时归一为空结构
 */

import { describe, it, expect, vi } from "vitest";
import type { NarrativeContext } from "../../../../types/index.js";
import type { LLMClient } from "../../../runtime/llm-client.js";
import { regionDesign } from "../region-design.js";
import { emergentEvent } from "../emergent-event.js";
import { cardLore } from "../card-lore.js";
import { eventPool } from "../event-pool.js";

function makeCtx(needs: Partial<Record<string, number>>, overrides: Record<string, unknown> = {}): NarrativeContext {
  return {
    user_input: "测试用户输入",
    tier_detection: {
      tier: "tier1",
      genre_code: "adv-vn",
      genre_name: "视觉小说",
      reasoning: "",
    },
    demand_analysis: {
      genre_code: "adv-vn",
      genre_name: "视觉小说",
      tier: "tier1",
      narrative_needs: needs as Record<string, number>,
      narrative_routing: { available_modes: [], recommended_mode: "" },
    } as never,
    ...overrides,
  } as NarrativeContext;
}

function llmReturning(payload: unknown): LLMClient {
  return {
    callWithRetry: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  } as unknown as LLMClient;
}

describe("universal-quest / regionDesign wrapper (B-M4)", () => {
  it("writes regions array when E>=2 (open-world category)", async () => {
    const ctx = makeCtx({ E: 3, Q: 2 });
    const llm = llmReturning({
      regions: [
        { id: "REG_01", name: "起点小镇" },
        { id: "REG_02", name: "黑暗森林" },
      ],
    });

    await regionDesign(ctx, llm);

    const regions = (ctx as Record<string, unknown>).regions as unknown[];
    expect(regions).toHaveLength(2);
    expect(llm.callWithRetry).toHaveBeenCalledOnce();
  });

  it("falls back to [] when needs.E<2 and needs.Q<2 (point-quest category)", async () => {
    const ctx = makeCtx({ E: 1, Q: 1 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await regionDesign(ctx, llm);

    expect((ctx as Record<string, unknown>).regions).toEqual([]);
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });

  it("falls back to [] when LLM returns malformed payload", async () => {
    const ctx = makeCtx({ E: 3 });
    const llm = llmReturning({ unrelated: true });

    await regionDesign(ctx, llm);

    expect((ctx as Record<string, unknown>).regions).toEqual([]);
  });
});

describe("universal-quest / emergentEvent wrapper (B-M4)", () => {
  it("writes emergent_events array when needs.Q>=1", async () => {
    const ctx = makeCtx({ Q: 2, S: 1 });
    const llm = llmReturning({
      events: [
        { id: "EV_01", name: "意外遭遇" },
        { id: "EV_02", name: "势力冲突" },
      ],
    });

    await emergentEvent(ctx, llm);

    const events = (ctx as Record<string, unknown>).emergent_events as unknown[];
    expect(events).toHaveLength(2);
    expect(llm.callWithRetry).toHaveBeenCalledOnce();
  });

  it("falls back to [] when needs.S=0 and needs.Q=0", async () => {
    const ctx = makeCtx({ S: 0, Q: 0 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await emergentEvent(ctx, llm);

    expect((ctx as Record<string, unknown>).emergent_events).toEqual([]);
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });
});

describe("universal-scene / cardLore wrapper (B-M5)", () => {
  it("writes card_lore { cards, lore_arcs } when needs.L>=2", async () => {
    const ctx = makeCtx({ L: 3, I: 2 });
    const llm = llmReturning({
      cards: [{ id: "CARD_01", name: "炎之精灵" }],
      lore_arcs: [{ title: "火之诞生", card_ids: ["CARD_01"] }],
    });

    await cardLore(ctx, llm);

    const out = (ctx as Record<string, unknown>).card_lore as {
      cards: unknown[];
      lore_arcs: unknown[];
    };
    expect(out.cards).toHaveLength(1);
    expect(out.lore_arcs).toHaveLength(1);
    expect(llm.callWithRetry).toHaveBeenCalledOnce();
  });

  it("falls back to { cards:[], lore_arcs:[] } when needs.L<2 and needs.I<2", async () => {
    const ctx = makeCtx({ L: 1, I: 1 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await cardLore(ctx, llm);

    expect((ctx as Record<string, unknown>).card_lore).toEqual({ cards: [], lore_arcs: [] });
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });

  it("normalizes missing lore_arcs to []", async () => {
    const ctx = makeCtx({ L: 3 });
    const llm = llmReturning({ cards: [{ id: "C1" }] });

    await cardLore(ctx, llm);

    const out = (ctx as Record<string, unknown>).card_lore as {
      cards: unknown[];
      lore_arcs: unknown[];
    };
    expect(out.cards).toHaveLength(1);
    expect(out.lore_arcs).toEqual([]);
  });
});

describe("universal-scene / eventPool wrapper (B-M5)", () => {
  it("writes event_pool with all 4 pools when needs.Q>=1", async () => {
    const ctx = makeCtx({ Q: 2 });
    const llm = llmReturning({
      pools: {
        daily: [{ id: "EV_D_01" }],
        weekly: [{ id: "EV_W_01" }, { id: "EV_W_02" }],
        seasonal: [],
        story: [{ id: "EV_S_01" }],
      },
    });

    await eventPool(ctx, llm);

    const out = (ctx as Record<string, unknown>).event_pool as {
      pools: { daily: unknown[]; weekly: unknown[]; seasonal: unknown[]; story: unknown[] };
    };
    expect(out.pools.daily).toHaveLength(1);
    expect(out.pools.weekly).toHaveLength(2);
    expect(out.pools.seasonal).toEqual([]);
    expect(out.pools.story).toHaveLength(1);
  });

  it("falls back to empty 4-pool struct when needs.S=0 and needs.Q=0", async () => {
    const ctx = makeCtx({ S: 0, Q: 0 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await eventPool(ctx, llm);

    expect((ctx as Record<string, unknown>).event_pool).toEqual({
      pools: { daily: [], weekly: [], seasonal: [], story: [] },
    });
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });

  it("normalizes partial pools (missing weekly/seasonal) to empty arrays", async () => {
    const ctx = makeCtx({ Q: 2 });
    const llm = llmReturning({
      pools: { daily: [{ id: "X" }], story: [{ id: "Y" }] },
    });

    await eventPool(ctx, llm);

    const out = (ctx as Record<string, unknown>).event_pool as {
      pools: { daily: unknown[]; weekly: unknown[]; seasonal: unknown[]; story: unknown[] };
    };
    expect(out.pools.daily).toHaveLength(1);
    expect(out.pools.weekly).toEqual([]);
    expect(out.pools.seasonal).toEqual([]);
    expect(out.pools.story).toHaveLength(1);
  });
});
