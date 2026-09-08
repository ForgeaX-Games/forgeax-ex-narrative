/**
 * narrative-scale.ts (Stage C)
 * ─────────────────────────────────────────────────────────────────
 * 长剧 / 短剧规模识别工具。
 *
 * 输入端只关心一个维度：本次成品需要拆成几"幕"。
 *   - 1 幕（含 0 / undefined）→ 短剧模式，capability 走单次 LLM
 *   - >= 2 幕               → 长剧模式，capability 走 chunked execute
 *
 * 触发链路（hybrid 模式）：
 *   user_input 显式声明 > skill.defaultActs > 全局兜底（1 幕短剧）
 *
 * 设计目标：纯函数，无副作用，可独立单测；不引入新 UI / 新 API 字段。
 */
import type { NarrativeSkill } from "../../knowledge/game-narrative/skill-types.js";

const ACT_KEYWORDS = [
  // 中文："N 幕" / "N 章" / "N 章节" / "N 个章节" / "N 个篇章" / "分 N 幕" / "共 N 幕"
  /(?:共|分)?\s*([一二三四五六七八九十两\d]+)\s*(?:个)?\s*(?:幕|章节?|篇章)/g,
  // 英文："5 acts" / "5-act" / "five-act"
  /(\d+)\s*-?\s*acts?/gi,
];

const SHORT_KEYWORDS = ["短剧", "短片", "短篇", "demo", "vertical slice", "片段"];
const LONG_KEYWORDS = ["长剧", "长篇", "完整作品", "全本", "大作"];

/** 把中文数字转 number，失败返 NaN */
function parseChineseNumber(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  const map: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  if (token.length === 1 && map[token] != null) return map[token];
  // "十二" 这类两位中文不展开（互动影游极少 ≥10 幕，超出范围一律按 5 上限处理）
  if (token === "十一") return 11;
  if (token === "十二") return 12;
  return NaN;
}

/** 从用户输入中抽取显式的幕数声明（无则返回 undefined）。 */
export function extractActsFromInput(userInput: string): number | undefined {
  for (const re of ACT_KEYWORDS) {
    re.lastIndex = 0;
    const matches = [...userInput.matchAll(re)];
    for (const m of matches) {
      const n = parseChineseNumber(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
    }
  }
  return undefined;
}

/**
 * 上传剧本字数 → 默认幕数（兜底，仅在用户/skill 都没显式声明时启用）。
 *
 * 经验阈值（可按效果调）：
 *   <= 5k 字   →  1 幕（短剧/单场景；与 .txt 短样本贴合）
 *   <= 15k 字  →  2 幕（中短篇；可拆 2 幕）
 *   <= 35k 字  →  3 幕（中篇；经典三幕）
 *   <= 80k 字  →  4 幕（长篇；多线开始铺）
 *   > 80k 字   →  5 幕（长篇/超长篇；上限）
 */
export function actsFromUploadedCharCount(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 1;
  if (charCount <= 5_000) return 1;
  if (charCount <= 15_000) return 2;
  if (charCount <= 35_000) return 3;
  if (charCount <= 80_000) return 4;
  return 5;
}

/**
 * 解析最终 target_acts。
 *
 * 优先级（hybrid 模式，由 trigger_mode 决策定）：
 *   1. user_input 命中"N 幕"等显式数字 → 直接采用
 *   2. user_input 命中"长剧"关键词且 skill.defaultActs 未声明 → 默认 5
 *   3. user_input 命中"短剧"关键词 → 1
 *   4. M1.7：上传剧本存在且其 char_count 显示是中长篇 → 按 actsFromUploadedCharCount
 *           （仅在 skill.defaultActs 未声明、且用户没显式短/长关键词时启用）
 *   5. skill.defaultActs 显式提供 → 采用
 *   6. 兜底 → 1（短剧）
 */
export function resolveTargetActs(
  userInput: string,
  skill?: Pick<NarrativeSkill, "defaultActs"> | null,
  uploadedCharCount?: number,
): number {
  const explicit = extractActsFromInput(userInput);
  if (explicit != null) return explicit;

  const lower = userInput.toLowerCase();
  const isLongHinted = LONG_KEYWORDS.some((k) => userInput.includes(k) || lower.includes(k));
  const isShortHinted = SHORT_KEYWORDS.some((k) => userInput.includes(k) || lower.includes(k));

  if (isShortHinted && !isLongHinted) return 1;
  if (isLongHinted && (skill?.defaultActs == null || skill.defaultActs < 2)) return 5;

  // M1.7: 上传剧本字数兜底（仅在 skill 未指定且无显式关键词时启用，避免覆盖短/长关键词信号）
  if (
    typeof uploadedCharCount === "number" && uploadedCharCount > 5_000 &&
    (skill?.defaultActs == null || skill.defaultActs < 2)
  ) {
    return actsFromUploadedCharCount(uploadedCharCount);
  }

  return skill?.defaultActs && skill.defaultActs >= 1 ? skill.defaultActs : 1;
}

/** 是否进入长剧分幕模式（>= 2 幕）。 */
export function isLongFormMode(targetActs: number | undefined | null): boolean {
  return typeof targetActs === "number" && targetActs >= 2;
}
