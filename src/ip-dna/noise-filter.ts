/**
 * 干扰项 / 非目标物过滤 —— 蓝图 §1 引言所指 agentos 三提取管线的「识别非目标物」算法 TS 移植。
 *
 * 参考实现：MyFile/agents/workflow_book_extraction/chapter_filter_utils.py
 *
 * 标准化阶段在建好层级树后，剔除「非正文/干扰」节点（引言/序/前言/作者互动/感言/求月票/
 * 附录/设定/广告/公告等），使这些非主体内容不参与后续提取与生成；保留正文章节 +
 * 特殊章节（后记/番外/尾声/终章/大结局——属于故事内容，序号接在正常章节后）。
 *
 * 设计：确定性、可单测；只看节点标题（标准化后标题=原文件名/标记），不动正文。
 * 多模态（图片画册重复页、视频片头片尾）先留规则接口（isLikelyMediaNoise 占位）。
 */

import type { NarrativeIpDna, HierarchyNode } from "../types/narrative-ip-dna.js";

/** 特殊章节关键词（属于故事内容，保留，序号接在正常章节后）。 */
export const SPECIAL_CHAPTER_KEYWORDS = [
  "后记", "後記", "番外", "尾声", "尾聲", "终章", "終章", "大结局", "大結局",
];

/** 非正文前缀关键词（标题以这些开头则视为干扰项过滤）。 */
export const NON_CONTENT_PREFIXES = [
  "引言", "引子", "楔子", "序言", "序章", "序", "前言", "卷首语", "卷首語",
  "人物志", "完结感言", "完本感言", "完结", "完本",
  "感言", "感谢", "感謝", "致谢", "致謝", "作者", "关于", "關於",
  "请假", "請假", "求月票", "求推荐", "求推薦", "更新", "公告", "通知",
  "上架", "爆更", "加更", "停更", "断更", "斷更",
  "附录", "附錄", "设定", "設定", "世界观", "世界觀",
  "参加", "參加", "沙龙", "沙龍", "活动", "活動",
  "持续", "持續", "厮杀", "廝殺", "郑重", "鄭重", "拜求",
  "广告", "廣告", "推广", "推廣",
];

/**
 * 非正文子串（P2 新增）：即便标题带章节号，命中这些"促销/公告"强信号子串也判为非正文，
 * 修"第8章 月份签名明信片赠送！"这类带号公告绕过白名单（旧逻辑：有章号即视为正文）。
 * 仅收强信号词（正文极少出现），避免误伤（如不收"赠送/签名"这类可能是剧情的泛词）。
 */
export const NON_CONTENT_SUBSTRINGS = [
  "明信片", "月票", "推荐票", "推薦票", "打赏", "打賞", "求订阅", "求訂閱",
  "书友群", "書友群", "抽奖", "抽獎", "红包", "紅包", "签名照", "簽名照",
];

/** 非正文完整匹配模式（标题完全匹配这些则过滤）。 */
const NON_CONTENT_EXACT_PATTERNS: RegExp[] = [
  /^引[言子]$/,
  /^楔子$/,
  /^序[言章]?$/,
  /^前言$/,
  /^人物志$/,
  /^完[结本].*$/,
  /^感[言谢謝].*$/,
  /^作者.*$/,
  /^关于.*$/,
  /^關於.*$/,
];

function normalizeTitle(raw: string): string {
  return String(raw ?? "").trim();
}

/** 是否为特殊章节（后记/番外等，保留为正文）。 */
export function isSpecialChapter(title: string): boolean {
  const t = normalizeTitle(title);
  if (!t) return false;
  return SPECIAL_CHAPTER_KEYWORDS.some((kw) => t.startsWith(kw) || t.includes(kw));
}

// ─────────────────────────────────────────────────────────────────
// 章节号识别（移植 chapter_filter_utils.py 的白名单闸门核心）：
// 参考实现对非黑名单文件还要求「能抽出章节号，否则丢弃」，本 TS 之前只迁了黑名单半边。
// 这里补齐章节号识别，用于「章节结构树」下把抽不出号、又非特殊章节的叶子判为非正文（作者随笔类）。
// ─────────────────────────────────────────────────────────────────

const CHINESE_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  壹: 1, 贰: 2, 貳: 2, 叁: 3, 參: 3, 肆: 4, 伍: 5, 陆: 6, 陸: 6, 柒: 7, 捌: 8, 玖: 9,
};
const CHINESE_UNIT: Record<string, number> = {
  十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000, 萬: 10000,
};
const CHINESE_NUM_CHARS = "零〇一二两三四五六七八九十百千万壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬";

/** 中文数字转阿拉伯（支持简繁体 + 位置表示法），移植自参考实现。 */
export function chineseToArabic(chinese: string): number {
  if (!chinese) return 0;
  const hasUnit = [...chinese].some((c) => c in CHINESE_UNIT);
  if (!hasUnit) {
    let positional = 0;
    for (const c of chinese) if (c in CHINESE_DIGIT) positional = positional * 10 + CHINESE_DIGIT[c];
    return positional;
  }
  let result = 0;
  let temp = 0;
  let cur = 0;
  for (const c of chinese) {
    if (c in CHINESE_DIGIT) {
      cur = CHINESE_DIGIT[c];
    } else if (c in CHINESE_UNIT) {
      const unit = CHINESE_UNIT[c];
      if (cur === 0) cur = 1;
      if (unit === 10000) {
        temp = (temp + cur) * unit;
        result += temp;
        temp = 0;
      } else {
        temp += cur * unit;
      }
      cur = 0;
    }
  }
  return result + temp + cur;
}

/** 从标题抽章节号（阿拉伯/中文/英文 Chapter），抽不出返回 undefined。 */
export function extractChapterNumber(title: string): number | undefined {
  const t = normalizeTitle(title);
  if (!t) return undefined;
  const m1 = t.match(/第\s*(\d+)\s*[章回幕节话集]/);
  if (m1) return Number(m1[1]);
  const m2 = t.match(new RegExp(`第\\s*([${CHINESE_NUM_CHARS}]+)\\s*[章回幕节话集]`));
  if (m2) return chineseToArabic(m2[1]) || undefined;
  const m3 = t.match(/^(\d+)\s*[章回幕节话集][\s_：:]/);
  if (m3) return Number(m3[1]);
  const m4 = t.match(new RegExp(`^([${CHINESE_NUM_CHARS}]+)\\s*[章回幕节话集][\\s_：:]`));
  if (m4) return chineseToArabic(m4[1]) || undefined;
  const m6 = t.match(/[Cc]hapter\s*(\d+)/);
  if (m6) return Number(m6[1]);
  return undefined;
}

/** 白名单：是否为「有效叙事单元标题」（能抽出章节号 或 特殊章节；但促销/公告子串即便带章号也不算）。 */
export function isValidChapterTitle(title: string): boolean {
  if (isNonContentTitle(title)) return false; // P2：带章号的促销/公告（如"第8章…明信片赠送"）不算有效正文
  return isSpecialChapter(title) || extractChapterNumber(title) !== undefined;
}

/** 是否为非正文/干扰节点（应过滤）。特殊章节优先豁免。 */
export function isNonContentTitle(title: string): boolean {
  const t = normalizeTitle(title);
  if (!t) return false;
  if (isSpecialChapter(t)) return false;
  // P2：促销/公告强信号子串——即便标题带章节号也判为非正文（二次判别，先于前缀/精确匹配）。
  if (NON_CONTENT_SUBSTRINGS.some((s) => t.includes(s))) return true;
  if (NON_CONTENT_PREFIXES.some((p) => t.startsWith(p))) return true;
  if (NON_CONTENT_EXACT_PATTERNS.some((re) => re.test(t))) return true;
  return false;
}

/** 多模态干扰占位（图片重复页/视频片头片尾），当前留接口恒 false，后续按规则补齐。 */
export function isLikelyMediaNoise(_title: string): boolean {
  return false;
}

export interface NoiseFilterResult {
  /** 被过滤掉的节点 id 列表。 */
  filtered: string[];
  /** 被过滤掉的节点标题（供审阅展示）。 */
  filteredTitles: string[];
}

/**
 * 原地过滤层级树中的干扰/非正文节点（连同其子树）：
 *   - 从父节点 children 中摘除；
 *   - 从 dna.nodes 删除该节点及其子孙；
 *   - 保留正文章节与特殊章节（后记/番外）。
 *
 * 仅过滤非根、非 complete 顶层的节点；root 永不删除。
 */
export function filterNoiseNodes(dna: NarrativeIpDna): NoiseFilterResult {
  const filtered: string[] = [];
  const filteredTitles: string[] = [];

  const collectSubtree = (id: string, acc: string[]): void => {
    const node = dna.nodes[id];
    if (!node) return;
    acc.push(id);
    for (const c of node.children ?? []) collectSubtree(c, acc);
  };

  // 白名单闸门预判（移植参考实现）：仅当整棵树「明显是章节结构」（多数叶子能抽出章节号）时，
  // 才对抽不出号、又非特殊章节的叶子按「非正文（作者随笔/前后言）」处置——避免误伤散文/多模态/单元树。
  const leaves = Object.values(dna.nodes).filter(
    (n) => n.id !== dna.rootId && n.levelType !== "complete" && (n.children?.length ?? 0) === 0,
  );
  const numberedLeaves = leaves.filter((n) => extractChapterNumber(n.title) !== undefined).length;
  const chapterStructured = leaves.length >= 3 && numberedLeaves / leaves.length >= 0.6;

  // 收集要删除的顶层干扰节点（自身命中即整棵子树删除）。
  const toRemove: HierarchyNode[] = [];
  for (const node of Object.values(dna.nodes)) {
    if (node.id === dna.rootId) continue;
    if (node.levelType === "complete") continue;
    const blacklisted = isNonContentTitle(node.title) || isLikelyMediaNoise(node.title);
    // 白名单闸门：章节结构树里，叶子既非有效章节标题、也非特殊章节 → 视为非正文随笔。
    const failsWhitelist =
      chapterStructured &&
      (node.children?.length ?? 0) === 0 &&
      !isValidChapterTitle(node.title);
    if (blacklisted || failsWhitelist) {
      // 仅当父节点不也是待删（避免重复），这里简单标记后统一处理。
      toRemove.push(node);
    }
  }

  const removedSet = new Set<string>();
  for (const node of toRemove) {
    if (removedSet.has(node.id)) continue;
    const subtree: string[] = [];
    collectSubtree(node.id, subtree);
    // 从父 children 摘除。
    const parent = node.parent ? dna.nodes[node.parent] : undefined;
    if (parent) parent.children = parent.children.filter((c) => c !== node.id);
    for (const id of subtree) {
      if (removedSet.has(id)) continue;
      removedSet.add(id);
      filtered.push(id);
      filteredTitles.push(dna.nodes[id]?.title ?? id);
      delete dna.nodes[id];
    }
  }

  return { filtered, filteredTitles };
}
