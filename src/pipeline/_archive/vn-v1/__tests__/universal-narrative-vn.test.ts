/**
 * universal-narrative-vn.test.ts (B-M3, archived)
 * ─────────────────────────────────────────────────────────────────
 * C2（2026-08）已封存：本文件是从
 * `agents/__tests__/universal-narrative.test.ts` 中拆出的
 * branchTree / dialogueScript / cinematicStoryboard 三个薄包装用例，
 * 随 tpl-vn 一并搬进 `_archive/vn-v1/`，仅用于回归比对被吸收前的原貌，
 * 不计入活跃测试套件的功能覆盖。
 *
 * 测试范围：
 *   - 正常路径：写入 ctx[outputField]
 *   - branch_tree 缺失时 dialogue/cinematic 走占位
 *   - needs.S=0 时 branchTree 走 emptyFallback（{ nodes: [] }）
 */

import { describe, it, expect, vi } from "vitest";
import type { NarrativeContext } from "../../../../types/index.js";
import type { LLMClient } from "../../../runtime/llm-client.js";
import { branchTree } from "../branch-tree.js";
import { dialogueScript } from "../dialogue-script.js";
import { cinematicStoryboard } from "../cinematic-storyboard.js";

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

describe("universal-narrative / branchTree wrapper", () => {
  it("writes branch_tree to ctx on success (S>=1)", async () => {
    const ctx = makeCtx({ S: 2 });
    const llm = llmReturning({
      branch_tree: {
        root_id: "N1",
        nodes: [
          { id: "N1", next: [{ to: "N2" }] },
          { id: "N2", next: [{ to: "E1" }] },
        ],
        endings: [{ id: "E1", title: "结局" }],
      },
    });

    await branchTree(ctx, llm);

    const tree = (ctx as Record<string, unknown>).branch_tree as {
      nodes: unknown[];
    };
    expect(tree.nodes).toHaveLength(2);
    expect(llm.callWithRetry).toHaveBeenCalledOnce();
  });

  it("falls back to { nodes: [] } when needs.S=0 (capability all skipped)", async () => {
    const ctx = makeCtx({ S: 0, D: 0 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await branchTree(ctx, llm);

    expect((ctx as Record<string, unknown>).branch_tree).toEqual({ nodes: [] });
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });

  it("accepts top-level nodes payload (no branch_tree wrapper)", async () => {
    const ctx = makeCtx({ S: 2 });
    const llm = llmReturning({ nodes: [{ id: "X1" }] });

    await branchTree(ctx, llm);

    const tree = (ctx as Record<string, unknown>).branch_tree as {
      nodes: unknown[];
    };
    expect(tree.nodes).toHaveLength(1);
  });
});

describe("universal-narrative / dialogueScript wrapper", () => {
  it("writes dialogue_script when branch_tree exists and needs.D>=2", async () => {
    const ctx = makeCtx(
      { D: 3 },
      { branch_tree: { nodes: [{ id: "N1" }] } },
    );
    const llm = llmReturning({ scripts: [{ node: "N1", lines: [] }] });

    await dialogueScript(ctx, llm);

    const out = (ctx as Record<string, unknown>).dialogue_script as {
      scripts: unknown[];
    };
    expect(out.scripts).toHaveLength(1);
    expect(llm.callWithRetry).toHaveBeenCalledOnce();
  });

  it("returns empty placeholder when branch_tree missing (preflight skip)", async () => {
    const ctx = makeCtx({ D: 3 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await dialogueScript(ctx, llm);

    expect((ctx as Record<string, unknown>).dialogue_script).toEqual({ scripts: [] });
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });

  it("returns empty placeholder when needs.D<2 (capability skipped)", async () => {
    const ctx = makeCtx(
      { D: 1 },
      { branch_tree: { nodes: [{ id: "N1" }] } },
    );
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await dialogueScript(ctx, llm);

    expect((ctx as Record<string, unknown>).dialogue_script).toEqual({ scripts: [] });
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });
});

describe("universal-narrative / cinematicStoryboard wrapper", () => {
  it("writes cinematic_storyboard when branch_tree exists and needs.D>=2", async () => {
    const ctx = makeCtx(
      { D: 3 },
      { branch_tree: { nodes: [{ id: "N1" }] } },
    );
    const llm = llmReturning({
      storyboards: [{ node_id: "N1", shots: [] }],
    });

    await cinematicStoryboard(ctx, llm);

    const out = (ctx as Record<string, unknown>).cinematic_storyboard as {
      storyboards: unknown[];
    };
    expect(out.storyboards).toHaveLength(1);
    expect(llm.callWithRetry).toHaveBeenCalledOnce();
  });

  it("returns empty placeholder when branch_tree missing", async () => {
    const ctx = makeCtx({ D: 3 });
    const llm = { callWithRetry: vi.fn() } as unknown as LLMClient;

    await cinematicStoryboard(ctx, llm);

    expect((ctx as Record<string, unknown>).cinematic_storyboard).toEqual({ storyboards: [] });
    expect(llm.callWithRetry).not.toHaveBeenCalled();
  });
});
