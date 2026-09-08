/**
 * P2 回归护栏：噪音子串二次判别——带章号的促销/公告标题（如"第8章 月份签名明信片赠送！"）
 * 不再因"有章号即视为正文"而绕过白名单；正文章节与特殊章节不受影响。
 */
import { describe, it, expect } from "vitest";
import { isValidChapterTitle, isNonContentTitle } from "../noise-filter.js";

describe("P2 噪音子串二次判别", () => {
  it("带章号的促销/公告 → 非正文（不通过白名单）", () => {
    const t = "第8章 月份蛊真人签名明信片赠送！";
    expect(isNonContentTitle(t)).toBe(true);
    expect(isValidChapterTitle(t)).toBe(false);
  });

  it("月票/打赏/书友群等强信号（即便带号）→ 非正文", () => {
    expect(isValidChapterTitle("第12章 求月票求推荐票")).toBe(false);
    expect(isValidChapterTitle("第3章 书友群福利与打赏答谢")).toBe(false);
  });

  it("正常正文章节不受影响", () => {
    expect(isValidChapterTitle("第五章 问询墨瑶意志")).toBe(true);
    expect(isNonContentTitle("第五章 问询墨瑶意志")).toBe(false);
  });

  it("特殊章节（后记/番外/终章）仍保留为有效正文", () => {
    expect(isValidChapterTitle("后记")).toBe(true);
    expect(isValidChapterTitle("番外一 少年时")).toBe(true);
  });
});
