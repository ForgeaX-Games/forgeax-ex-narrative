/**
 * character-enrichment-visual-prompt.test.ts
 * ─────────────────────────────────────────────────────────────────
 * 验证 character_enrichment 输出 visual_prompt.zh/en 与 kino-studio Character.prompt 对齐。
 *
 * 三类输入：
 *   ① LLM 给完整高密度 visual_prompt → 不被覆盖
 *   ② LLM 完全没给（老 entry）→ fallback 由 age/race/gender/appearance 兜底
 *   ③ LLM 只给中文，缺英文 → 中文保留，英文 fallback
 */
import { describe, it, expect } from "vitest";
import { __internal } from "../steps/character-enrichment.js";

const { normalizeCharacter } = __internal;

describe("character_enrichment visual_prompt", () => {
  it("① LLM 给完整高密度 visual_prompt → 字段被保留", () => {
    const sheet = normalizeCharacter(
      {
        name: "宫园薰",
        label: "主角",
        race: "亚洲人", gender: "女", age: "14",
        occupation: "小提琴手",
        description: { appearance_description: "金发翠瞳，校服" },
        visual_prompt: {
          zh: "14岁亚洲女学生，金色卷发，翠绿瞳孔，深色高中校服+蓝丝带，握着小提琴，笑容明亮，电影感写实立绘",
          en: "14-year-old Asian schoolgirl, golden curly hair, emerald-green eyes, dark school uniform with blue ribbon, holding violin, bright smile, cinematic realistic portrait",
        },
      },
      0,
    );
    expect(sheet.visual_prompt).toBeDefined();
    expect(sheet.visual_prompt!.zh).toContain("翠绿瞳孔");
    expect(sheet.visual_prompt!.en).toContain("emerald-green eyes");
  });

  it("② LLM 完全没给 visual_prompt → 由 age/race/gender/occupation/appearance 兜底", () => {
    const sheet = normalizeCharacter(
      {
        name: "未来医者",
        label: "NPC",
        race: "亚洲人", gender: "男", age: "45",
        occupation: "外科医生",
        description: { appearance_description: "银白短发，金属义肢，深蓝手术服" },
      },
      1,
    );
    expect(sheet.visual_prompt).toBeDefined();
    // 中文 fallback：年龄/种族/性别/职业/appearance 都应进入 prompt
    expect(sheet.visual_prompt!.zh).toContain("45");
    expect(sheet.visual_prompt!.zh).toContain("亚洲人");
    expect(sheet.visual_prompt!.zh).toContain("男");
    expect(sheet.visual_prompt!.zh).toContain("外科医生");
    expect(sheet.visual_prompt!.zh).toContain("银白短发");
    expect(sheet.visual_prompt!.zh).toContain("电影感写实立绘");
    // 英文 fallback：粗粒度但结构完整
    expect(sheet.visual_prompt!.en).toContain("45");
    expect(sheet.visual_prompt!.en).toContain("cinematic realistic portrait");
  });

  it("③ LLM 只给中文 → 中文保留，英文走 fallback", () => {
    const sheet = normalizeCharacter(
      {
        name: "K博士",
        label: "Boss",
        race: "亚洲人", gender: "男", age: "60",
        occupation: "科学家",
        description: { appearance_description: "灰白胡须" },
        visual_prompt: { zh: "60岁科学家，灰白胡须，黑框眼镜，白大褂，凝视烧杯，写实立绘" },
      },
      2,
    );
    expect(sheet.visual_prompt!.zh).toBe("60岁科学家，灰白胡须，黑框眼镜，白大褂，凝视烧杯，写实立绘");
    // fallback 不做中→英翻译，occupation 字面进入 en prompt（实际中文）
    expect(sheet.visual_prompt!.en).toContain("60");
    expect(sheet.visual_prompt!.en).toContain("科学家");
    expect(sheet.visual_prompt!.en).toContain("cinematic realistic portrait");
  });

  it("空字符串视为未给 → 走 fallback", () => {
    const sheet = normalizeCharacter(
      {
        name: "测试",
        label: "NPC",
        race: "人类", gender: "女", age: "20",
        description: { appearance_description: "" },
        visual_prompt: { zh: "  ", en: "" },
      },
      0,
    );
    expect(sheet.visual_prompt!.zh).toContain("电影感写实立绘");
    expect(sheet.visual_prompt!.en).toContain("cinematic realistic portrait");
  });
});
