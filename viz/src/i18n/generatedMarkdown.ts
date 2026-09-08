import { getLocale, t } from "./index";
import { UI_CATALOGS } from "./ui";

/** Chinese → English for known generated-markdown templates (preference summary, etc.). */
const HEADER_MAP: Record<string, string> = {
  "# 用户偏好总结": "# User preference summary",
  "## 核心要素": "## Core elements",
  "## 期望体验": "## Expected experience",
  "## 特殊要求": "## Special requirements",
  "## 简短概述": "## Brief overview",
  "## 用户原始需求": "## User original request",
  "## 已总结的偏好": "## Summarized preferences",
};

const FIELD_MAP: Record<string, string> = {
  "主角信息": "Protagonist",
  "故事主题": "Story theme",
  "题材类型": "Genre/type",
  "世界背景": "World setting",
  "核心冲突": "Core conflict",
  "风格基调": "Tone",
  "结局倾向": "Ending preference",
  "情感倾向": "Emotional tone",
  "节奏偏好": "Pacing preference",
  "无": "None",
  "未明确": "Unspecified",
  "未指定": "Not specified",
  "（无）": "(none)",
};

const TAG_VALUE_TO_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const loc of ["en", "zh"] as const) {
    for (const [k, v] of Object.entries(UI_CATALOGS[loc])) {
      if (k.startsWith("tagOpt.")) m.set(v, k);
    }
  }
  return m;
})();

function localizeTagValues(text: string): string {
  let out = text;
  for (const [zh, key] of TAG_VALUE_TO_KEY) {
    if (!/[\u4e00-\u9fff]/.test(zh)) continue;
    const en = t(key);
    if (en !== key && out.includes(zh)) {
      out = out.split(zh).join(en);
    }
  }
  return out;
}

/** Display-only localization for backend-generated Chinese markdown when UI locale is en. */
export function localizeGeneratedMarkdown(text: string): string {
  if (!text || getLocale() !== "en" || !/[\u4e00-\u9fff]/.test(text)) return text;
  let out = text;
  for (const [zh, en] of Object.entries(HEADER_MAP)) {
    out = out.split(zh).join(en);
  }
  for (const [zh, en] of Object.entries(FIELD_MAP)) {
    out = out.replace(new RegExp(`([*\\-•]\\s*)?${zh}：`, "g"), `$1${en}: `);
    out = out.replace(new RegExp(`\\*\\*${zh}\\*\\*：`, "g"), `**${en}:**`);
  }
  out = localizeTagValues(out);
  return out;
}
