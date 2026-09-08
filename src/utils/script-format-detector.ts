/**
 * 上传剧本格式识别（启发式正则，零依赖）。
 *
 * 输入：原文文本（来自 .txt / mammoth 解析后的 .docx 等）
 * 输出：识别结果（format + 置信度 + 摘要统计）
 *
 * 用途：
 *   1. 在 NarrativeContext.uploaded_script 上挂 format 字段，让各 step prompt 知道
 *      "这是 Fountain 剧本 / 已结构化 JSON / 散文小说"，从而采取不同的改写策略。
 *   2. 为字数 → 幕数自动联动提供 char_count 统计。
 *
 * 设计原则：
 *   - 启发式宁可粗糙也不能误报关键格式（JSON 必须 parseable，Fountain 必须见到关键标记）
 *   - 无法识别 → "prose"（散文/未知）兜底，不会失败
 *   - 不调用 LLM，毫秒级返回
 */

export type ScriptFormat =
  | "json"        // 已是结构化 JSON（可能是别的工具产出的剧本）
  | "fountain"    // Fountain 剧本格式（INT./EXT. + 角色名大写 + 对白）
  | "markdown"    // Markdown 文档（# 标题 + 段落）
  | "dialogue"    // 朴素对白格式（"角色：台词" / "角色: 台词" 占多数行）
  | "prose";      // 散文/小说/未知（兜底）

export interface ScriptFormatDetection {
  format: ScriptFormat;
  confidence: number;         // 0-1，启发式置信度
  charCount: number;          // 字符数（含空格/换行；用于 acts 兑底）
  estimatedWordCount: number; // 估算字数（中文按字符计、英文按空格分词）
  lineCount: number;
  /** JSON 模式下，parse 成功后的 sample 顶层 keys（便于 LLM 直接读懂结构） */
  jsonTopLevelKeys?: string[];
  /** 用于调试：触发 format 判定的关键标记数量 */
  signals?: Record<string, number>;
}

/* ───────────── helpers ───────────── */

const FOUNTAIN_SLUGLINE = /^(INT|EXT|EST|INT\.\/EXT|I\/E)\.\s+.+/m;
const FOUNTAIN_TRANSITION = /^(CUT TO:|FADE OUT\.?|FADE IN:?|DISSOLVE TO:)$/m;
const FOUNTAIN_CHARACTER = /^([A-Z][A-Z0-9 .'-]{1,40})$/m; // 全大写角色行（独占一行）

const MD_HEADING = /^#{1,6}\s+\S/m;
const MD_LIST = /^\s*[-*+]\s+\S/m;
const MD_FENCE = /^```/m;

// 中文/英文混合的 "角色：台词" / "角色: 台词" — 半角全角都要兼容
const DIALOGUE_LINE = /^\s*[\u4e00-\u9fa5A-Za-z0-9_·\-\s]{1,20}[：:]\s*\S/;

const CJK_RANGE = /[\u4e00-\u9fa5]/g;

function estimateWordCount(text: string): number {
  // 中文按字符 + 英文按空格分词，简单累加
  const cjk = (text.match(CJK_RANGE) ?? []).length;
  const stripped = text.replace(CJK_RANGE, " ");
  const en = stripped.split(/\s+/).filter((w) => w.length >= 2).length;
  return cjk + en;
}

function tryParseJson(text: string): { ok: boolean; topKeys?: string[] } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, topKeys: Object.keys(parsed as Record<string, unknown>).slice(0, 20) };
    }
    return { ok: true, topKeys: [] };
  } catch {
    return { ok: false };
  }
}

function countMatches(text: string, re: RegExp): number {
  // 单行 anchor 的正则，需要逐行扫
  if (!re.flags.includes("m") && !re.flags.includes("g")) {
    return re.test(text) ? 1 : 0;
  }
  // m 标志的多行正则用 matchAll 不直接支持；用 split 行扫
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    const single = new RegExp(re.source);
    if (single.test(line)) count += 1;
  }
  return count;
}

/* ───────────── 主入口 ───────────── */

export function detectScriptFormat(rawText: string): ScriptFormatDetection {
  const text = rawText ?? "";
  const charCount = text.length;
  const lineCount = text.split(/\r?\n/).length;
  const estimatedWordCount = estimateWordCount(text);

  // 1) JSON：必须能 parse
  const jsonProbe = tryParseJson(text);
  if (jsonProbe.ok) {
    return {
      format: "json",
      confidence: 1.0,
      charCount,
      estimatedWordCount,
      lineCount,
      jsonTopLevelKeys: jsonProbe.topKeys,
      signals: { json_parsed: 1 },
    };
  }

  // 2) Fountain：slugline + transition + 全大写角色行
  const slugCount = countMatches(text, FOUNTAIN_SLUGLINE);
  const transCount = countMatches(text, FOUNTAIN_TRANSITION);
  const charCapCount = countMatches(text, FOUNTAIN_CHARACTER);
  const fountainScore = slugCount * 3 + transCount * 2 + Math.min(charCapCount, 10);
  if (slugCount >= 2 || (slugCount >= 1 && transCount >= 1)) {
    return {
      format: "fountain",
      confidence: Math.min(1, fountainScore / 10),
      charCount,
      estimatedWordCount,
      lineCount,
      signals: { sluglines: slugCount, transitions: transCount, character_caps: charCapCount },
    };
  }

  // 3) Markdown：# 标题 / 列表 / 代码块
  const mdHead = countMatches(text, MD_HEADING);
  const mdList = countMatches(text, MD_LIST);
  const mdFence = countMatches(text, MD_FENCE);
  const mdScore = mdHead * 2 + mdList + mdFence * 2;
  if (mdHead >= 2 || (mdHead >= 1 && (mdList >= 1 || mdFence >= 1))) {
    return {
      format: "markdown",
      confidence: Math.min(1, mdScore / 8),
      charCount,
      estimatedWordCount,
      lineCount,
      signals: { headings: mdHead, lists: mdList, code_fences: mdFence },
    };
  }

  // 4) 对白格式：超过 30% 行命中"角色：台词"
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const dialogueLines = lines.filter((l) => DIALOGUE_LINE.test(l)).length;
  if (lines.length >= 4 && dialogueLines / lines.length >= 0.3) {
    return {
      format: "dialogue",
      confidence: dialogueLines / lines.length,
      charCount,
      estimatedWordCount,
      lineCount,
      signals: { dialogue_lines: dialogueLines, total_nonempty_lines: lines.length },
    };
  }

  // 5) 兜底：散文/未知
  return {
    format: "prose",
    confidence: 0.5,
    charCount,
    estimatedWordCount,
    lineCount,
    signals: {},
  };
}

/**
 * 给 LLM 的人类可读说明（贴在 prompt 里），帮助下游步骤理解上传剧本的结构。
 */
export function describeScriptFormat(detection: ScriptFormatDetection): string {
  const { format, charCount, estimatedWordCount, lineCount } = detection;
  const stats = `约 ${estimatedWordCount} 字 / ${charCount} 字符 / ${lineCount} 行`;
  switch (format) {
    case "json":
      return `JSON 结构化剧本（${stats}；顶层字段：${(detection.jsonTopLevelKeys ?? []).join(", ") || "未知"}）—— 请直接读懂其结构并对齐到当前 step 的输出 schema`;
    case "fountain":
      return `Fountain 剧本格式（${stats}）—— 已含 INT./EXT. 场景标题 / 角色名 / 对白，请保留原文场景命名与角色称呼`;
    case "markdown":
      return `Markdown 文档（${stats}）—— 已分章节，请按 # 标题层级理解结构`;
    case "dialogue":
      return `朴素对白格式（${stats}）—— 大量"角色：台词"行，请保留角色名与口吻`;
    case "prose":
    default:
      return `散文/小说/未知格式（${stats}）—— 请按情节顺序读懂，保留关键人物、场景、情感转折`;
  }
}
