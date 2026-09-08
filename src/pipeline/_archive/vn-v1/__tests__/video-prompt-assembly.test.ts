/**
 * video-prompt-assembly.test.ts (Stage C - D 工作单)
 * ─────────────────────────────────────────────────────────────────
 * assembleVideoPrompts 单测：覆盖正常 / 字段缺失 / 空输入 / 双语输出。
 *
 * C2（2026-08）已封存：随 tpl-vn 一并搬进 `_archive/vn-v1/__tests__/`，
 * 仅用于回归比对被吸收前的原貌，不计入活跃测试套件的功能覆盖。
 */
import { describe, it, expect } from "vitest";
import { assembleVideoPrompts } from "../video-prompt-assembly.js";

describe("assembleVideoPrompts", () => {
  it("空 storyboard → 空 bundle", () => {
    expect(assembleVideoPrompts(null)).toEqual({ keyframes: [], video_segments: [] });
    expect(assembleVideoPrompts({})).toEqual({ keyframes: [], video_segments: [] });
    expect(assembleVideoPrompts({ storyboards: [] })).toEqual({ keyframes: [], video_segments: [] });
  });

  it("正常 shot → 双语并列输出", () => {
    const bundle = assembleVideoPrompts({
      storyboards: [
        {
          node_id: "A1_N03",
          pacing: "tense",
          shots: [
            {
              shot_id: "S1",
              framing: "close",
              angle: "eye_level",
              movement: "tracking",
              lighting: "黄昏侧光，冷色调阴影",
              actor_action: "主角缓慢转身，眼神惊愕",
              duration_sec: 4,
            },
          ],
        },
      ],
    });

    expect(bundle.keyframes).toHaveLength(1);
    expect(bundle.video_segments).toHaveLength(1);

    const kf = bundle.keyframes[0];
    expect(kf.shot_id).toBe("S1");
    expect(kf.node_id).toBe("A1_N03");
    expect(kf.prompt_zh).toContain("特写");
    expect(kf.prompt_zh).toContain("平视");
    expect(kf.prompt_zh).toContain("主角缓慢转身");
    expect(kf.prompt_zh).toContain("电影质感");
    expect(kf.prompt_en).toContain("close-up");
    expect(kf.prompt_en).toContain("eye-level");
    expect(kf.prompt_en).toContain("cinematic");

    const vs = bundle.video_segments[0];
    expect(vs.duration_sec).toBe(4);
    expect(vs.prompt_zh).toContain("跟拍");
    expect(vs.prompt_zh).toContain("时长 4 秒");
    expect(vs.prompt_en).toContain("tracking shot");
    expect(vs.prompt_en).toContain("4s duration");
    expect(vs.prompt_en).toContain("tense pacing");
  });

  it("QTE 字段被纳入 video segment prompt", () => {
    const bundle = assembleVideoPrompts({
      storyboards: [
        {
          node_id: "A2_N01",
          shots: [
            {
              shot_id: "S2",
              actor_action: "主角伸手抓住坠落的钥匙",
              duration_sec: 2,
              qte: { trigger: "按下空格抓住", window_ms: 500, fail_penalty: "钥匙坠落" },
            },
          ],
        },
      ],
    });
    const vs = bundle.video_segments[0];
    expect(vs.prompt_zh).toContain("QTE 节奏点");
    expect(vs.prompt_zh).toContain("按下空格抓住");
    expect(vs.prompt_en).toContain("QTE beat");
    expect(vs.prompt_en).toContain("按下空格抓住");
  });

  it("缺失字段也能产出 prompt（降级）", () => {
    const bundle = assembleVideoPrompts({
      storyboards: [
        {
          node_id: "A1_N01",
          shots: [{ actor_action: "开门" }],
        },
      ],
    });
    expect(bundle.keyframes).toHaveLength(1);
    expect(bundle.keyframes[0].prompt_zh.length).toBeGreaterThan(0);
    expect(bundle.keyframes[0].prompt_en.length).toBeGreaterThan(0);
  });

  it("多节点多 shot 全部展开", () => {
    const bundle = assembleVideoPrompts({
      storyboards: [
        { node_id: "A1_N01", shots: [{ shot_id: "S1", actor_action: "走进房间" }, { shot_id: "S2", actor_action: "环顾四周" }] },
        { node_id: "A1_N02", shots: [{ shot_id: "S3", actor_action: "拿起照片" }] },
      ],
    });
    expect(bundle.keyframes.map((k) => k.shot_id)).toEqual(["S1", "S2", "S3"]);
    expect(bundle.video_segments.map((v) => v.node_id)).toEqual(["A1_N01", "A1_N01", "A1_N02"]);
  });

  it("未知 framing/angle 字符串原样保留", () => {
    const bundle = assembleVideoPrompts({
      storyboards: [
        { node_id: "A1_N01", shots: [{ framing: "custom_special", angle: "fancy_angle", actor_action: "test" }] },
      ],
    });
    expect(bundle.keyframes[0].prompt_zh).toContain("custom_special");
    expect(bundle.keyframes[0].prompt_zh).toContain("fancy_angle");
  });
});
