/**
 * integration-stage-c.test.ts (Stage C - 长剧能力集成验收)
 * ─────────────────────────────────────────────────────────────────
 * 覆盖：
 *   ① ctx.target_acts >= 2 → branch_tree 走 chunked 三段式（macro / micro × N / check）
 *   ② chunked branch_tree 把 cross-act patches 应用到 nodes
 *   ③ chunked dialogue_script / cinematic_storyboard 按 acts 切分调 LLM
 *   ④ video_prompts 在 cinematic_storyboard 完成后被自动拼装并写入 ctx
 *   ⑤ ctx.target_acts <= 1 → 短剧路径，只调一次 LLM
 *   ⑥ initial_plan 解析 user_input 关键词写入 ctx.target_acts
 *
 * C2（2026-08）已封存：随 tpl-vn 一并搬进 `_archive/vn-v1/__tests__/`，
 * 仅用于回归比对被吸收前的原貌，不计入活跃测试套件的功能覆盖。
 */
import { describe, it, expect, vi } from "vitest";
import "../../../../knowledge/game-narrative/skill-bootstrap.js";
import type { NarrativeContext } from "../../../../types/index.js";
import type { LLMClient } from "../../../runtime/llm-client.js";
import { branchTree } from "../branch-tree.js";
import { dialogueScript } from "../dialogue-script.js";
import { cinematicStoryboard } from "../cinematic-storyboard.js";

function makeQueueLLM(payloads: unknown[]): LLMClient {
  let i = 0;
  return {
    callWithRetry: vi.fn().mockImplementation(() => {
      if (i >= payloads.length) {
        return Promise.reject(new Error(`LLM 调用次数超出预期，第 ${i + 1} 次无 mock 回应`));
      }
      const p = payloads[i++];
      return Promise.resolve(JSON.stringify(p));
    }),
  } as unknown as LLMClient;
}

function makeAdvCtx(targetActs: number | undefined): NarrativeContext {
  return {
    user_input: "smoke",
    tier_detection: { tier: "tier1", genre_code: "adv-interactive", genre_name: "互动叙事", reasoning: "" },
    demand_analysis: {
      genre_code: "adv-interactive",
      genre_name: "互动叙事",
      tier: "tier1",
      narrative_needs: { S: 3, D: 3, E: 3, C: 3, W: 2, L: 1, I: 1, U: 2, Q: 2 },
      narrative_routing: { available_modes: [], recommended_mode: "" },
    } as never,
    target_acts: targetActs,
    worldview_structure: { name: "test world" },
    detailed_character_sheets: [{ name: "主角", role: "protagonist" }],
    initial_story_outline: { theme: "test" },
  } as unknown as NarrativeContext;
}

describe("C-INTEG ① chunked branch_tree (3-act long form)", () => {
  it("target_acts=3 时调 1 macro + 3 micro + 1 check = 5 次 LLM", async () => {
    const ctx = makeAdvCtx(3);
    const llm = makeQueueLLM([
      // 1) macro
      {
        acts: [
          { act_id: "A1", title: "幕一", summary: "...", emotional_arc: "", key_events: [] },
          { act_id: "A2", title: "幕二", summary: "...", emotional_arc: "", key_events: [] },
          { act_id: "A3", title: "幕三", summary: "...", emotional_arc: "", key_events: [] },
        ],
        global_pivots: [{ act_from: "A1", act_to: "A3", type: "foreshadow", note: "..." }],
      },
      // 2) micro A1（连向 A2，确保结构质量门为 no-op）
      { act_id: "A1", nodes: [{ id: "A1_N01", title: "n1", next: [{ to: "A2_N01" }] }] },
      // 3) micro A2（连向 A3）
      { act_id: "A2", nodes: [{ id: "A2_N01", title: "n2", next: [{ to: "A3_N01" }] }] },
      // 4) micro A3 (末幕带 endings；分别通向两个结局)
      { act_id: "A3", nodes: [{ id: "A3_N01", title: "n3", next: [{ to: "E1" }, { to: "E2" }] }], endings: [{ id: "E1", title: "结局1" }, { id: "E2", title: "结局2" }] },
      // 5) consistency check
      {
        score: 0.9,
        issues: [],
        patches: [{ type: "rewrite_summary", node_id: "A2_N01", new_summary: "REPLACED" }],
      },
    ]);

    await branchTree(ctx, llm);

    expect(llm.callWithRetry).toHaveBeenCalledTimes(5);
    const tree = (ctx as Record<string, unknown>).branch_tree as {
      nodes: Array<{ id: string; summary?: string; act_id?: string }>;
      acts?: Array<{ act_id: string }>;
      consistency?: { score: number };
      endings: Array<{ id: string }>;
    };
    expect(tree.acts).toHaveLength(3);
    expect(tree.nodes).toHaveLength(3);
    expect(tree.nodes.every((n) => n.act_id)).toBe(true); // act_id 自动填充
    expect(tree.endings).toHaveLength(2);
    expect(tree.consistency?.score).toBe(0.9);
    // patch 已被应用
    expect(tree.nodes.find((n) => n.id === "A2_N01")?.summary).toBe("REPLACED");
  });

  it("consistency check LLM 失败时降级（不抛错，patches 为空）", async () => {
    const ctx = makeAdvCtx(2);
    let i = 0;
    const llm: LLMClient = {
      callWithRetry: vi.fn().mockImplementation(() => {
        i++;
        if (i === 1) {
          return Promise.resolve(JSON.stringify({
            acts: [
              { act_id: "A1", title: "幕一", summary: "", emotional_arc: "", key_events: [] },
              { act_id: "A2", title: "幕二", summary: "", emotional_arc: "", key_events: [] },
            ],
            global_pivots: [],
          }));
        }
        if (i === 2 || i === 3) {
          return Promise.resolve(JSON.stringify({
            act_id: i === 2 ? "A1" : "A2",
            nodes: [{ id: i === 2 ? "A1_N01" : "A2_N01" }],
          }));
        }
        // 第 4 次（consistency check）失败
        return Promise.reject(new Error("LLM 故障"));
      }),
    } as unknown as LLMClient;

    await branchTree(ctx, llm);
    const tree = (ctx as Record<string, unknown>).branch_tree as {
      consistency: { score: number; patches: unknown[] };
    };
    expect(tree.consistency.patches).toEqual([]);
    expect(tree.consistency.score).toBe(0.7); // fallback
  });
});

describe("C-INTEG ③ chunked dialogue_script", () => {
  it("按 acts 切分，每幕一次 LLM", async () => {
    const ctx = makeAdvCtx(2);
    // 预先注入 chunked branch_tree 的输出
    (ctx as Record<string, unknown>).branch_tree = {
      acts: [
        { act_id: "A1", title: "幕一", summary: "", emotional_arc: "", key_events: [] },
        { act_id: "A2", title: "幕二", summary: "", emotional_arc: "", key_events: [] },
      ],
      nodes: [
        { id: "A1_N01", act_id: "A1" },
        { id: "A1_N02", act_id: "A1" },
        { id: "A2_N01", act_id: "A2" },
      ],
    };
    const llm = makeQueueLLM([
      { scripts: [{ node_id: "A1_N01", lines: [] }, { node_id: "A1_N02", lines: [] }] },
      { scripts: [{ node_id: "A2_N01", lines: [] }] },
    ]);

    await dialogueScript(ctx, llm);

    expect(llm.callWithRetry).toHaveBeenCalledTimes(2);
    const ds = (ctx as Record<string, unknown>).dialogue_script as { scripts: Array<{ node_id: string }> };
    expect(ds.scripts.map((s) => s.node_id)).toEqual(["A1_N01", "A1_N02", "A2_N01"]);
  });
});

describe("C-INTEG ④ chunked cinematic_storyboard + video_prompts auto-assembly", () => {
  it("按 acts 切分调 LLM，并在末尾自动拼装 video_prompts", async () => {
    const ctx = makeAdvCtx(2);
    (ctx as Record<string, unknown>).branch_tree = {
      acts: [
        { act_id: "A1", title: "幕一", summary: "", emotional_arc: "", key_events: [] },
        { act_id: "A2", title: "幕二", summary: "", emotional_arc: "", key_events: [] },
      ],
      nodes: [
        { id: "A1_N01", act_id: "A1" },
        { id: "A2_N01", act_id: "A2" },
      ],
    };
    const llm = makeQueueLLM([
      {
        storyboards: [
          {
            node_id: "A1_N01",
            shots: [{ shot_id: "S1", framing: "close", actor_action: "测试动作", duration_sec: 4 }],
          },
        ],
      },
      {
        storyboards: [
          {
            node_id: "A2_N01",
            shots: [{ shot_id: "S2", framing: "wide", actor_action: "另一个动作", duration_sec: 6 }],
          },
        ],
      },
    ]);

    await cinematicStoryboard(ctx, llm);

    expect(llm.callWithRetry).toHaveBeenCalledTimes(2);
    const sb = (ctx as Record<string, unknown>).cinematic_storyboard as { storyboards: unknown[] };
    expect(sb.storyboards).toHaveLength(2);

    // D 工作单：video_prompts 自动拼装
    const vp = (ctx as Record<string, unknown>).video_prompts as {
      keyframes: Array<{ shot_id: string; prompt_zh: string; prompt_en: string }>;
      video_segments: Array<{ shot_id: string; duration_sec: number }>;
    };
    expect(vp.keyframes.map((k) => k.shot_id)).toEqual(["S1", "S2"]);
    expect(vp.keyframes[0].prompt_zh).toContain("特写");
    expect(vp.keyframes[0].prompt_en).toContain("close-up");
    expect(vp.video_segments[1].duration_sec).toBe(6);
  });
});

describe("C-INTEG ⑤ short-form path: target_acts<=1 走单次 LLM", () => {
  it("target_acts=1 时 branch_tree 只调一次 LLM", async () => {
    const ctx = makeAdvCtx(1);
    const llm = makeQueueLLM([
      { branch_tree: { root_id: "N1", nodes: [{ id: "N1", next: [{ to: "E1" }] }], endings: [{ id: "E1", title: "结局" }] } },
    ]);
    await branchTree(ctx, llm);
    expect(llm.callWithRetry).toHaveBeenCalledTimes(1);
  });

  it("target_acts=undefined 时 branch_tree 仍走短剧路径", async () => {
    const ctx = makeAdvCtx(undefined);
    const llm = makeQueueLLM([
      { branch_tree: { root_id: "N1", nodes: [{ id: "N1", next: [{ to: "E1" }] }], endings: [{ id: "E1", title: "结局" }] } },
    ]);
    await branchTree(ctx, llm);
    expect(llm.callWithRetry).toHaveBeenCalledTimes(1);
  });
});
