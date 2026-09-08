import { describe, it, expect } from "vitest";
import { detectScriptFormat, describeScriptFormat } from "../../utils/script-format-detector";

describe("detectScriptFormat", () => {
  it("识别 JSON 结构化剧本", () => {
    const text = JSON.stringify({ scenes: [{ id: "s1", title: "开场" }], characters: [] }, null, 2);
    const r = detectScriptFormat(text);
    expect(r.format).toBe("json");
    expect(r.jsonTopLevelKeys).toContain("scenes");
    expect(r.jsonTopLevelKeys).toContain("characters");
    expect(r.confidence).toBe(1);
  });

  it("识别 Fountain 剧本", () => {
    const text = `INT. COFFEE SHOP - DAY

ALICE
Hi, Bob.

BOB
Long time no see.

CUT TO:

EXT. STREET - NIGHT

ALICE
We need to go.`;
    const r = detectScriptFormat(text);
    expect(r.format).toBe("fountain");
    expect(r.signals?.sluglines).toBeGreaterThanOrEqual(2);
  });

  it("识别 Markdown 文档", () => {
    const text = `# 第一章 开局
人物登场。

## 第一节 苏醒

- 主角醒来
- 发现伤口

\`\`\`
旁白：黎明之前。
\`\`\`

# 第二章 决择`;
    const r = detectScriptFormat(text);
    expect(r.format).toBe("markdown");
    expect(r.signals?.headings).toBeGreaterThanOrEqual(2);
  });

  it("识别朴素对白", () => {
    const text = `林雨：你怎么来了？
陈默：我得跟你说件事。
林雨：好，进来吧。
陈默：其实……
林雨：怎么了？
陈默：算了，没事。`;
    const r = detectScriptFormat(text);
    expect(r.format).toBe("dialogue");
    expect(r.signals?.dialogue_lines).toBeGreaterThanOrEqual(4);
  });

  it("散文/未知格式兜底", () => {
    const text = `那是一个寻常的午后，阳光透过窗棂洒在地板上。
她坐在桌前，凝视着远方，思绪飘忽不定。
桌上的茶水早已凉透，杯壁挂着淡淡的水珠。`;
    const r = detectScriptFormat(text);
    expect(r.format).toBe("prose");
  });

  it("空字符串安全兜底", () => {
    const r = detectScriptFormat("");
    expect(r.format).toBe("prose");
    expect(r.charCount).toBe(0);
    expect(r.estimatedWordCount).toBe(0);
  });

  it("describeScriptFormat 输出非空字符串", () => {
    const r = detectScriptFormat("# 标题\n\n## 子标题\n");
    const desc = describeScriptFormat(r);
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toContain("Markdown");
  });

  it("estimatedWordCount 中文按字符算", () => {
    const r = detectScriptFormat("我是中文字符示例三十字以内的句子用来测试字数估算。");
    expect(r.estimatedWordCount).toBeGreaterThan(0);
    expect(r.charCount).toBeGreaterThanOrEqual(r.estimatedWordCount);
  });
});
