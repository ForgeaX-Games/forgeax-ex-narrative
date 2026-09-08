/**
 * worldview-ui-style-prompt.test.ts
 * ─────────────────────────────────────────────────────────────────
 * 验证 worldview_construction 输出 ui_style_prompt.zh/en 与 kino-studio UIStyle.prompt 对齐。
 */
import { describe, it, expect } from "vitest";
import { __internal } from "../steps/worldview-construction.js";
import type { WorldviewStructure } from "../../types/index.js";

const { normalizeWorldview } = __internal;

const baseWV: WorldviewStructure = {
  world_name: "近未来东京",
  worldview_title: "K计划",
  基础架构层: {
    WV_01_时空背景: { description: "公元 2045 年，新东京湾区，霓虹潮湿的雨夜城市" },
    WV_06_文化信仰: { description: "东西方融合，神道教与企业崇拜并存" },
    WV_07_科技水平: { description: "脑机接口普及，AI 助手日常化，生命暂停技术初步成熟" },
  },
  交互叙事层: {
    WV_09_历史脉络: { description: "..." },
    WV_10_核心冲突: { description: "..." },
    WV_11_主要人物: { description: "..." },
    WV_12_叙事入口: { description: "..." },
  },
};

describe("worldview ui_style_prompt", () => {
  it("① LLM 给完整 ui_style_prompt → 字段被保留", () => {
    const wv = normalizeWorldview({
      ...baseWV,
      ui_style_prompt: {
        zh: "黑底霓虹蓝绿点缀，毛玻璃半透明面板，等宽像素字体英汉混排",
        en: "black with neon blue/green accents, frosted-glass panels, monospace pixel font",
      },
    });
    expect(wv.ui_style_prompt!.zh).toContain("毛玻璃");
    expect(wv.ui_style_prompt!.en).toContain("frosted-glass");
  });

  it("② LLM 完全没给 → 由 WV_01/WV_06/WV_07 兜底合成", () => {
    const wv = normalizeWorldview({ ...baseWV });
    expect(wv.ui_style_prompt).toBeDefined();
    expect(wv.ui_style_prompt!.zh).toContain("霓虹");
    expect(wv.ui_style_prompt!.zh).toContain("脑机接口");
    expect(wv.ui_style_prompt!.zh).toContain("游戏 UI 视觉基调");
    expect(wv.ui_style_prompt!.en).toContain("UI");
  });

  it("③ 只给中文 → 中文保留，英文 fallback", () => {
    const wv = normalizeWorldview({
      ...baseWV,
      ui_style_prompt: { zh: "民国手绘水墨风" },
    });
    expect(wv.ui_style_prompt!.zh).toBe("民国手绘水墨风");
    expect(wv.ui_style_prompt!.en).toContain("UI visual tone");
  });

  it("空字符串视为未给 → 走 fallback", () => {
    const wv = normalizeWorldview({
      ...baseWV,
      ui_style_prompt: { zh: "  ", en: "" },
    });
    expect(wv.ui_style_prompt!.zh).toContain("游戏 UI 视觉基调");
    expect(wv.ui_style_prompt!.en).toContain("UI visual tone");
  });

  it("世界观槽位完全空时 fallback 不抛错", () => {
    const wv = normalizeWorldview({
      world_name: "空世界",
      基础架构层: {},
      交互叙事层: {},
    });
    expect(wv.ui_style_prompt).toBeDefined();
    expect(typeof wv.ui_style_prompt!.zh).toBe("string");
    expect(typeof wv.ui_style_prompt!.en).toBe("string");
  });
});
