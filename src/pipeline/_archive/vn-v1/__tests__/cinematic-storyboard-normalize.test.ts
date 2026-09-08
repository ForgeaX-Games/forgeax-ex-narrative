/**
 * cinematic-storyboard-normalize.test.ts
 * ─────────────────────────────────────────────────────────────────
 * 验证 cinematic_storyboard 输出 schema 与 kino-studio QTECue / Scene.prompts 对齐。
 *
 * 三类输入：
 *   ① LLM 给出完整 kino-ready 字段 → 不被覆盖
 *   ② LLM 完全没给新字段（老 entry 兼容）→ fallback 自动补齐
 *   ③ LLM 给 hold/sweep 但缺时序与 sweep_dir → 用合理默认补齐
 *
 * C2（2026-08）已封存：随 tpl-vn 一并搬进 `_archive/vn-v1/__tests__/`，
 * 仅用于回归比对被吸收前的原貌，不计入活跃测试套件的功能覆盖。
 */
import { describe, it, expect } from "vitest";
import { __internal } from "../cinematic-storyboard.js";

const { normalizeStoryboards } = __internal;

describe("cinematic_storyboard normalize", () => {
  it("① LLM 给完整字段 → 字段被保留不被覆盖", () => {
    const out = normalizeStoryboards({
      storyboards: [
        {
          node_id: "N_07_QTE",
          shots: [
            {
              shot_id: "S1",
              framing: "close",
              angle: "low",
              movement: "static",
              lighting: "冷蓝手术灯",
              actor_action: "凝神操作",
              duration_sec: 4,
              qte: {
                trigger: "神经偏差", window_ms: 800, fail_penalty: "失败",
                shape: "tap", x: 0.42, y: 0.61,
                appear_ms: 2800, target_ms: 3600, label: "敲!",
              },
              visual_prompt: { zh: "用户中文", en: "user english" },
            },
          ],
          scene_prompt: { zh: "用户场景中文", en: "user scene en" },
        },
      ],
    });
    const sb = out.storyboards[0];
    const q = sb.shots[0].qte!;
    expect(q.x).toBe(0.42);
    expect(q.y).toBe(0.61);
    expect(q.appear_ms).toBe(2800);
    expect(q.target_ms).toBe(3600);
    expect(q.label).toBe("敲!");
    expect(sb.shots[0].visual_prompt?.zh).toBe("用户中文");
    expect(sb.shots[0].visual_prompt?.en).toBe("user english");
    expect(sb.scene_prompt?.zh).toBe("用户场景中文");
    expect(sb.scene_prompt?.en).toBe("user scene en");
  });

  it("② LLM 完全没给新字段 → fallback 自动补齐 kino-ready 字段", () => {
    const out = normalizeStoryboards({
      storyboards: [
        {
          node_id: "N_07_QTE",
          shots: [
            {
              shot_id: "S1",
              framing: "close",
              angle: "low",
              movement: "static",
              lighting: "冷蓝手术灯",
              actor_action: "凝神操作",
              duration_sec: 4,
              qte: { trigger: "神经偏差", window_ms: 800, fail_penalty: "失败" },
            },
          ],
        },
      ],
    });
    const sb = out.storyboards[0];
    const q = sb.shots[0].qte!;
    // QTE 字段全部补齐
    expect(q.shape).toBe("tap");
    expect(q.x).toBe(0.5);
    expect(q.y).toBe(0.55);
    expect(typeof q.target_ms).toBe("number");
    expect(typeof q.appear_ms).toBe("number");
    expect(q.appear_ms!).toBeLessThan(q.target_ms!);
    expect(q.target_ms!).toBeLessThanOrEqual(4000); // 不超出镜头时长
    expect(q.label).toBe("敲!");
    // visual_prompt 由 framing/angle/lighting 合成
    expect(sb.shots[0].visual_prompt?.zh).toContain("特写");
    expect(sb.shots[0].visual_prompt?.en).toContain("close-up");
    // scene_prompt 由所有 shot 的 visual_prompt 合并
    expect(sb.scene_prompt?.zh).toContain("特写");
    expect(sb.scene_prompt?.en).toContain("close-up");
  });

  it("③ hold/sweep 缺时序与方向 → 自动补合理默认", () => {
    const out = normalizeStoryboards({
      storyboards: [
        {
          node_id: "N_07_QTE",
          shots: [
            {
              shot_id: "S1",
              framing: "wide", angle: "eye_level", movement: "tracking",
              lighting: "黄昏侧光", actor_action: "推门", duration_sec: 3,
              qte: { trigger: "推门", window_ms: 600, fail_penalty: "失败", shape: "hold" },
            },
            {
              shot_id: "S2",
              framing: "medium", angle: "eye_level", movement: "pan",
              lighting: "霓虹冷光", actor_action: "侧身躲避", duration_sec: 5,
              qte: { trigger: "躲避", window_ms: 700, fail_penalty: "失败", shape: "sweep" },
            },
          ],
        },
      ],
    });
    const sb = out.storyboards[0];
    const hold = sb.shots[0].qte!;
    expect(hold.shape).toBe("hold");
    expect(typeof hold.duration_ms).toBe("number");
    expect(hold.duration_ms!).toBeGreaterThanOrEqual(400);
    expect(hold.label).toBe("按住");

    const sweep = sb.shots[1].qte!;
    expect(sweep.shape).toBe("sweep");
    expect(sweep.sweep_dir).toBe("right"); // 默认方向
    expect(sweep.label).toBe("滑!");

    // 跨镜头 cursorMs 累加：S2 的 target_ms 应该在 [3000, 8000] 范围（S1 结束=3000ms 后）
    expect(sweep.target_ms!).toBeGreaterThan(3000);
    expect(sweep.target_ms!).toBeLessThanOrEqual(8000);
    expect(sweep.appear_ms!).toBeGreaterThanOrEqual(3000);
  });

  it("空输入兜底", () => {
    expect(normalizeStoryboards({ storyboards: [] })).toEqual({ storyboards: [] });
    // @ts-expect-error - 故意传非法值
    expect(normalizeStoryboards(null)).toEqual({ storyboards: [] });
    // @ts-expect-error - 故意传非法值
    expect(normalizeStoryboards({})).toEqual({ storyboards: [] });
  });
});
