/**
 * 标签维 → 叙事类型 / 叙事题材两轴的映射。
 *
 * 为什么需要这张表：标签选择是用户的显式表达，但它选的是**自然语言词**
 * （奇幻 / 赛博朋克 / 人vs科技），而结构综合器吃的是**轴 code**（fantasy /
 * cyberpunk / ai）。没有这张表时，标签只被拼成一句 `主题：成长；世界观类型：赛博朋克`
 * 追加到用户需求里，于是用户认真勾的六维标签对四轴推导、对策略卡装配、
 * 对结构投票一律零影响 —— 「多方维度比较」少了一整个维度的输入。
 *
 * 只映射**确实对应**的词，不硬凑：
 *   - 标签 `theme` 一维是母题（成长 / 救赎 / 复仇），与叙事类型正交，只有
 *     爱情、探索两个词真落在类型轴上；
 *   - 标签 `tone` 一维是风格基调，只有幽默 / 荒诞 / 浪漫能推出类型；
 *   - 都市、武侠、蒸汽朋克、中世纪等词在 19 个题材 code 里没有对应项，留空。
 * 留空是合法状态：轴仍为 null，策略卡该槽留空，投票跳过空轴。
 */
import type { StoryTypeCode } from "./story-types.js";
import type { StoryThemeCode } from "./story-themes.js";

/** 标签选择的落盘形状（与 EntryConfig.tags 同形）。 */
export interface NarrativeTagSelection {
  selections?: Record<string, string>;
  customTexts?: Record<string, string>;
}

/** 标签值 → 叙事类型 code。键是 TAG_DIMENSIONS 各维的选项原文。 */
const TAG_VALUE_TO_STORY_TYPE: Readonly<Record<string, StoryTypeCode>> = {
  // genre 维（世界观底色，与类型重叠最多的一维）
  奇幻: "fantasy",
  科幻: "scifi",
  悬疑: "mystery",
  恐怖: "horror",
  历史: "historical",
  军事: "war",
  // tone 维
  幽默: "comedy",
  荒诞: "comedy",
  浪漫: "romance",
  // theme 维（母题里只有这两个真是类型）
  爱情: "romance",
  探索: "adventure",
  // conflict 维
  "人vs自我": "drama",
  阵营对抗: "war",
  // worldtype 维
  克苏鲁: "horror",
  太空歌剧: "scifi",
  异世界: "fantasy",
};

/** 标签值 → 叙事题材 code。 */
const TAG_VALUE_TO_STORY_THEME: Readonly<Record<string, StoryThemeCode>> = {
  // genre 维
  末日: "apocalypse",
  仙侠: "cultivation",
  // worldtype 维
  赛博朋克: "cyberpunk",
  后启示录: "apocalypse",
  东方仙侠: "cultivation",
  // conflict 维
  "人vs科技": "ai",
  "人vs自然": "eco",
  生存危机: "apocalypse",
};

/**
 * 读标签的维度顺序，即命中优先级。
 *
 * 两轴各有自己的顺序，因为同一个标签维对两轴的说服力不同：
 *   - 类型轴：`genre`（奇幻/科幻/悬疑…）几乎就是类型本身，最靠前；
 *     `theme` 是母题，最弱，垫底；
 *   - 题材轴：`worldtype`（赛博朋克/后启示录）最接近题材领域，最靠前。
 */
const TYPE_DIMENSION_ORDER = ["genre", "tone", "conflict", "worldtype", "theme"] as const;
const THEME_DIMENSION_ORDER = ["worldtype", "genre", "conflict", "theme", "tone"] as const;

export interface TagDerivedAxes {
  storyType: StoryTypeCode | null;
  storyTheme: StoryThemeCode | null;
  /** 命中来源：轴 → 命中的标签维与原文，供 UI 解释「这个类型是怎么来的」。 */
  hits: { storyType?: { dimension: string; value: string }; storyTheme?: { dimension: string; value: string } };
}

function readDimension(tags: NarrativeTagSelection, key: string): string | null {
  const picked = tags.selections?.[key]?.trim();
  if (picked) return picked;
  const custom = tags.customTexts?.[key]?.trim();
  return custom || null;
}

/**
 * 由标签推导类型/题材两轴。
 *
 * 只作**缺省填充**用：调用方应当把用户在轴选择器里直选的值放在前面，
 * 本函数的结果仅在该轴为空时兜底。标签不该盖掉用户直选的轴。
 */
export function deriveAxesFromTags(tags: NarrativeTagSelection | null | undefined): TagDerivedAxes {
  const empty: TagDerivedAxes = { storyType: null, storyTheme: null, hits: {} };
  if (!tags) return empty;

  const result: TagDerivedAxes = { storyType: null, storyTheme: null, hits: {} };

  for (const dim of TYPE_DIMENSION_ORDER) {
    const value = readDimension(tags, dim);
    const code = value ? TAG_VALUE_TO_STORY_TYPE[value] : undefined;
    if (code) {
      result.storyType = code;
      result.hits.storyType = { dimension: dim, value: value! };
      break;
    }
  }

  for (const dim of THEME_DIMENSION_ORDER) {
    const value = readDimension(tags, dim);
    const code = value ? TAG_VALUE_TO_STORY_THEME[value] : undefined;
    if (code) {
      result.storyTheme = code;
      result.hits.storyTheme = { dimension: dim, value: value! };
      break;
    }
  }

  return result;
}

/**
 * 四轴的两个用户可选轴的最终取值：直选优先，标签兜底。
 *
 * 收在这里而不是散在 server 与 manifest builder 两处，是为了让 /plan 的预览
 * 与 /start 的实跑必然同口径 —— 两边曾因各自 `?? null` 而对同一条目算出不同的轴。
 */
export function resolveUserAxes(input: {
  storyType?: string | null;
  storyTheme?: string | null;
  tags?: NarrativeTagSelection | null;
}): { storyType: string | null; storyTheme: string | null; derived: TagDerivedAxes } {
  const derived = deriveAxesFromTags(input.tags);
  return {
    storyType: input.storyType?.trim() || derived.storyType,
    storyTheme: input.storyTheme?.trim() || derived.storyTheme,
    derived,
  };
}
