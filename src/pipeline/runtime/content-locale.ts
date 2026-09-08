import type { ContentLocale, NarrativeContext } from "../../types/index.js";

export function contentLocale(ctx: NarrativeContext | null | undefined): ContentLocale {
  return ctx?.content_locale === "en" ? "en" : "zh";
}

const EN_DIRECTIVE =
  "IMPORTANT: All generated output text must be in English — including markdown headings, " +
  "field labels, descriptions, dialogue, JSON string values, and proper nouns " +
  "(unless the user explicitly provided a non-English proper name).";

const ZH_DIRECTIVE =
  "重要：所有生成内容必须使用中文（world_tags 等明确要求英文的字段除外）。";

/** Replace hardcoded Chinese-only language clauses and append the correct directive. */
export function finalizeSystemPrompt(
  systemPrompt: string,
  locale: ContentLocale,
): string {
  if (!systemPrompt?.trim()) return systemPrompt;
  if (locale === "zh") {
    if (/必须使用中文|中文输出/.test(systemPrompt)) return systemPrompt;
    return `${systemPrompt.trim()}\n\n${ZH_DIRECTIVE}`;
  }

  let sp = systemPrompt
    .replace(/所有输出必须使用中文[^。\n]*/g, EN_DIRECTIVE)
    .replace(/所有文本内容必须为中文[^。\n]*/g, EN_DIRECTIVE)
    .replace(/所有内容使用中文[^。\n]*/g, EN_DIRECTIVE)
    .replace(/中文输出[^。\n]*/g, "Output in English.")
    .replace(/请用中文/g, "Use English")
    .replace(/必须使用中文/g, "must be in English");

  if (!/must be in English|Output in English|IMPORTANT: All generated output/i.test(sp)) {
    sp = `${sp.trim()}\n\n${EN_DIRECTIVE}`;
  }
  return sp;
}

export function finalizeUserPrompt(
  userPrompt: string,
  locale: ContentLocale,
): string {
  if (!userPrompt?.trim() || locale === "zh") return userPrompt;
  if (/must be in English|Output in English/i.test(userPrompt)) return userPrompt;
  return `${userPrompt.trim()}\n\n${EN_DIRECTIVE}`;
}
