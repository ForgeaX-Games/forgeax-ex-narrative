/**
 * 叙事单元「真实序号 + 标题」解析 —— 蓝图 §3.1 锚定最小叙事单元。
 *
 * TS 移植自 agentos 三提取管线的确定性预处理算法：
 *   - MyFile/agents/workflow_book_extraction/chapter_filter_utils.py（中文数字 / 章号提取 / 标题拆分）
 *   - MyFile/agents/workflow_video_extraction/episode_parsing_function_regex_matching_algo.py（集号）
 *   - MyFile/agents/workflow_picture_extraction/page_parsing_function_regex_matching_algo.py（话/页/卷号）
 *
 * 用途：标准化建树时，把标题 / 文件名里写明的**真实叙事序号**（第八章→8、S01E03→3、第03话→3）
 * 提取出来作为节点 index，使锚定名成为 `8_《第八章_一场戏》` 而非按上传位置的 `1_《…》`；
 * 并支持「同序号去重（保留末次）」，剔除用户复制进来的重复同号单元。
 *
 * 设计：纯确定性、无副作用、可单测；只解析「叫法里的数字」，层级抽象仍由建树逻辑决定（§3.1b）。
 */

import type { IpMediaType } from "../types/narrative-ip-dna.js";

// ─────────────────────────────────────────────────────────────────
// 中文数字 → 阿拉伯数字（简繁体 + 单位 + 位值表示法）
// ─────────────────────────────────────────────────────────────────

const CHINESE_DIGIT: Record<string, number> = {
  "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
  "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
  // 繁体
  "壹": 1, "贰": 2, "貳": 2, "叁": 3, "參": 3, "肆": 4,
  "伍": 5, "陆": 6, "陸": 6, "柒": 7, "捌": 8, "玖": 9,
};

const CHINESE_UNIT: Record<string, number> = {
  "十": 10, "拾": 10,
  "百": 100, "佰": 100,
  "千": 1000, "仟": 1000,
  "万": 10000, "萬": 10000,
};

/** 所有中文数字字符（用于正则字符类）。 */
export const CHINESE_NUM_CHARS = "零〇一二两三四五六七八九十百千万壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬";

/**
 * 中文数字转阿拉伯数字（支持简繁体、单位、位值表示法）。
 * 例：一→1、十→10、七十一→71、一千二百六十四→1264、三零四→304、壹仟貳佰陸拾肆→1264。
 * 无法解析返回 0。
 */
export function chineseToArabic(chineseNum: string): number {
  if (!chineseNum) return 0;

  const hasUnit = [...chineseNum].some((c) => c in CHINESE_UNIT);
  if (!hasUnit) {
    // 位值表示法：逐位累加（三零四 → 304）。
    let positional = 0;
    for (const c of chineseNum) {
      if (c in CHINESE_DIGIT) positional = positional * 10 + CHINESE_DIGIT[c];
    }
    return positional > 0 ? positional : 0;
  }

  // 标准中文数字（含单位）。
  let result = 0;
  let temp = 0;
  let current = 0;
  for (const c of chineseNum) {
    if (c in CHINESE_DIGIT) {
      current = CHINESE_DIGIT[c];
    } else if (c in CHINESE_UNIT) {
      const unit = CHINESE_UNIT[c];
      if (unit === 10000) {
        if (current === 0) current = 1;
        temp = (temp + current) * unit;
        result += temp;
        temp = 0;
      } else {
        if (current === 0) current = 1;
        temp += current * unit;
      }
      current = 0;
    }
  }
  result += temp + current;
  return result > 0 ? result : 0;
}

// ─────────────────────────────────────────────────────────────────
// 单元序号提取（按媒体：文字=章/回/节、视频=集、图片=话/页）
// ─────────────────────────────────────────────────────────────────

/** 去扩展名、去目录、trim，取用于解析的基名。 */
function baseName(nameOrPath: string): string {
  const norm = String(nameOrPath ?? "").replace(/\\/g, "/");
  const last = norm.slice(norm.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return (dot > 0 ? last.slice(0, dot) : last).trim();
}

const CN = CHINESE_NUM_CHARS;

/**
 * 文字：从标题/文件名提取章/回/幕/讲/课/节序号（阿拉伯 + 中文简繁体）。
 * 移植 chapter_filter_utils.extract_chapter_number 的模式集。无法识别返回 undefined。
 */
export function extractChapterNumber(name: string): number | undefined {
  const s = baseName(name);
  if (!s) return undefined;

  // 第X[章回幕讲课堂节](阿拉伯)——原始 chapter_parsing 模式集含 章/讲/课/堂/节。
  let m = s.match(/第\s*(\d+)\s*[章回幕讲课堂节節]/);
  if (m) return Number(m[1]);
  // 第X[章回幕讲课堂节](中文)
  m = s.match(new RegExp(`第\\s*([${CN}]+)\\s*[章回幕讲课堂节節]`));
  if (m) return chineseToArabic(m[1]) || undefined;
  // X章_标题（无"第"，阿拉伯）
  m = s.match(/^(\d+)\s*[章回幕节節][\s_：:]/);
  if (m) return Number(m[1]);
  // X章_标题（无"第"，中文）
  m = s.match(new RegExp(`^([${CN}]+)\\s*[章回幕节節][\\s_：:]`));
  if (m) return chineseToArabic(m[1]) || undefined;
  // Chapter N
  m = s.match(/[Cc]hapter\s*(\d+)/);
  if (m) return Number(m[1]);
  // 纯数字开头 + 空格 + 非数字标题（"001 惊蛰"）；排除日期式"2号/2月/2日"。
  m = s.match(/^(\d+)\s+([^\d].*)$/);
  if (m) {
    const n = Number(m[1]);
    if (n > 0 && n < 100000 && !/^[号月日年更]/.test(m[2].trim())) return n;
  }
  return undefined;
}

/**
 * 视频：从文件名提取集号（S01E03 取集号、第N集、Episode_0N、EpNN、纯数字前缀）。
 * 移植 episode_parsing_function_regex_matching_algo._parse_episode_info。
 */
export function extractEpisodeNumber(name: string): number | undefined {
  const s = baseName(name);
  if (!s) return undefined;
  let m = s.match(/[Ss](\d+)[Ee](\d+)/);
  if (m) return Number(m[2]);
  m = s.match(new RegExp(`第\\s*([0-9${CN}]+)\\s*集`));
  if (m) return /\d/.test(m[1]) ? Number(m[1]) : chineseToArabic(m[1]) || undefined;
  m = s.match(/[Ee]pisode[_\s]*(\d+)/);
  if (m) return Number(m[1]);
  m = s.match(/[Ee]p\.?\s*(\d+)/);
  if (m) return Number(m[1]);
  m = s.match(/^(\d+)[_.\s]/);
  if (m) return Number(m[1]);
  return undefined;
}

/**
 * 图片：从文件名提取"话/章"号（漫画的最小叙事单元边界；卷/页另有维度）。
 * 移植 page_parsing._extract_numbers 的 chapter 维度（[话章节ch]N），中文"第N话"补充。
 */
export function extractComicUnitNumber(name: string): number | undefined {
  const s = baseName(name);
  if (!s) return undefined;
  let m = s.match(new RegExp(`第\\s*([0-9${CN}]+)\\s*[话話章]`));
  if (m) return /\d/.test(m[1]) ? Number(m[1]) : chineseToArabic(m[1]) || undefined;
  m = s.match(/[话話章节節]\s*(\d+)/);
  if (m) return Number(m[1]);
  m = s.match(/[Cc]h\.?\s*(\d+)/);
  if (m) return Number(m[1]);
  // 页码：page_07 / p07 / 第07页；漫画页为最小单元序号（page_parsing._extract_numbers）。
  m = s.match(/(?:page|p|第)[_\s]*(\d+)\s*页?/i);
  if (m) return Number(m[1]);
  // 兜底：文件名末尾数字作页码（漫画上下文，移植 page_parsing 的"最后一个数字"回退）。
  const nums = s.match(/(\d+)/g);
  if (nums && nums.length > 0) return Number(nums[nums.length - 1]);
  return undefined;
}

/**
 * 按媒体类型统一提取「最小叙事单元序号」。文字→章号、视频→集号、图片→话号。
 * 命中返回正整数；无法识别返回 undefined（由调用方回退位置计数）。
 */
export function extractUnitNumber(name: string, media: IpMediaType): number | undefined {
  switch (media) {
    case "video":
      return extractEpisodeNumber(name);
    case "picture":
      return extractComicUnitNumber(name) ?? extractEpisodeNumber(name);
    default:
      // book / mixed / 其它：先试章号，再退英文/纯数字集式（覆盖 Chapter/001）。
      return extractChapterNumber(name) ?? extractEpisodeNumber(name);
  }
}

/**
 * 提取「干净标题」（去掉"第X章/话/集"等序号前缀，保留真正的标题文字）。
 * 例："第八章_一场戏" → "一场戏"；"S01E03 觉醒" → "觉醒"；无标题时返回空串（调用方回退原名）。
 * 注意：这是可选的「显示标题」；节点 title 仍保留原始名以便溯源，displayName 由建树处组合。
 */
export function extractCleanTitle(name: string): string {
  const s = baseName(name);
  if (!s) return "";
  const patterns: RegExp[] = [
    new RegExp(`^第\\s*[0-9${CN}]+\\s*[章回幕话話集讲课堂节節][\\s_：:、.-]*`),
    new RegExp(`^[0-9${CN}]+\\s*[章回幕话話集][\\s_：:、.-]+`),
    /^[Cc]hapter\s*\d+[\s_：:.-]*/,
    /^[Ee]pisode[_\s]*\d+[\s_：:.-]*/,
    /^[Ss]\d+[Ee]\d+[\s_：:.-]*/,
    /^\d+[\s_：:.-]+/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return s.slice(m[0].length).trim();
  }
  return "";
}

/**
 * 同序号去重（保留末次）—— 移植 chapter_parsing._parse_chapters 的 chapter_dict 去重语义。
 * 输入一组带 number 的项（number 为 undefined 表示无法识别，永不去重），返回去重后按原相对顺序的项。
 * 仅当同一批次里出现「重复的可识别序号」才丢弃较早者；无冲突时原样返回（零副作用）。
 */
export function dedupeByNumber<T>(
  items: T[],
  getNumber: (item: T) => number | undefined,
): { kept: T[]; dropped: T[] } {
  const lastIndexByNum = new Map<number, number>();
  items.forEach((it, i) => {
    const n = getNumber(it);
    if (n !== undefined) lastIndexByNum.set(n, i);
  });
  const kept: T[] = [];
  const dropped: T[] = [];
  items.forEach((it, i) => {
    const n = getNumber(it);
    if (n !== undefined && lastIndexByNum.get(n) !== i) dropped.push(it);
    else kept.push(it);
  });
  return { kept, dropped };
}
