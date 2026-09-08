import { describe, it, expect } from "vitest";
import { PREFERENCE_SUMMARY_COMPOSER } from "../steps/user-preference-summary.js";
import { composeUserPrompt } from "../runtime/prompt-composer.js";
import type { NarrativeContext } from "../../types/index.js";

/**
 * C1（VN v2 吸收）：归档的 vn-v2-e2.ts 曾用运行时改图（`injectVnV2E2Steps`）表达
 * "上传剧本时跳过自主创作、改为预处理加文本段确认"，且只在 tpl-vn-v2 一条管线上
 * 生效。业务功能已改由需求清单席（preference_summary）的 composer 通用表达，
 * 与品类无关——这里守住"有上传剧本"与"没有"两种输入各自的提示词形状。
 */
function baseCtx(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    user_input: "写一个关于骑士的故事",
    ...overrides,
  } as NarrativeContext;
}

describe("需求清单席：上传剧本入口（通用，不绑定任何品类/模板）", () => {
  it("没有上传剧本时，提示词不提及上传剧本、不含「不要编造」以外的额外分支", () => {
    const up = composeUserPrompt(PREFERENCE_SUMMARY_COMPOSER, baseCtx());
    expect(up).not.toContain("用户上传剧本");
    expect(up).not.toContain("权威原文");
  });

  it("有上传剧本时，原文被注入且模型被要求以原文为权威来源、不得另编故事", () => {
    const ctx = baseCtx({
      uploaded_script: {
        content: "第一幕：骑士里昂在破晓时分离开了故乡的城堡。",
        format: "prose",
        char_count: 24,
      },
    });
    const up = composeUserPrompt(PREFERENCE_SUMMARY_COMPOSER, ctx);
    expect(up).toContain("用户上传剧本 ⭐");
    expect(up).toContain("骑士里昂在破晓时分离开了故乡的城堡");
    expect(up).toContain("权威原文");
    expect(up).toContain("不要脱离原文另编一个故事");
  });

  it("上传剧本过长时按 6000 字截断，避免把提示词撑爆", () => {
    const longContent = "字".repeat(7000);
    const ctx = baseCtx({
      uploaded_script: { content: longContent, format: "prose", char_count: 7000 },
    });
    const up = composeUserPrompt(PREFERENCE_SUMMARY_COMPOSER, ctx);
    expect(up).toContain("（截断）");
    expect(up.length).toBeLessThan(longContent.length + 2000);
  });

  it("uploaded_script 存在但 content 为空时视同没有上传剧本", () => {
    const ctx = baseCtx({ uploaded_script: { content: "", format: "prose", char_count: 0 } });
    const up = composeUserPrompt(PREFERENCE_SUMMARY_COMPOSER, ctx);
    expect(up).not.toContain("用户上传剧本");
  });
});
