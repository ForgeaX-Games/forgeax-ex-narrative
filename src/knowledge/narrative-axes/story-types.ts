/**
 * 叙事类型轴（13 项 + 其他）—— 决定故事「怎么跑」：因果逻辑、节拍、预期管理。
 *
 * 命名说明：本文件用 Story* 前缀而非 Narrative*，因为 knowledge/genre-narrative-type.ts
 * 里的 `NarrativeType`（linear / branching / fragmented / emergent / minimal）已经占用了
 * 「叙事类型」这个词，但它指的是**管线形态族**（该品类的叙事怎么生产），
 * 与本文件的文艺类型（剧情 / 喜剧 / 悲剧…）是两回事。两者不可混用。
 */

export const STORY_TYPE_CODES = [
  "drama",
  "comedy",
  "tragedy",
  "action",
  "adventure",
  "scifi",
  "fantasy",
  "horror",
  "mystery",
  "crime",
  "romance",
  "historical",
  "war",
  "other",
] as const;

export type StoryTypeCode = (typeof STORY_TYPE_CODES)[number];

export interface StoryTypeEntry {
  code: StoryTypeCode;
  /** 中文名 */
  name: string;
  /** 英文名（UI 副标题与 md 文件名对照） */
  nameEn: string;
  /** 一句话简介：这一类型靠什么驱动 */
  summary: string;
  /** 叙事特点：节拍、冲突源、结局倾向 */
  traits: string;
  /**
   * 该类型倾向的叙事结构。
   * 目前全部留空 —— 类型轴的结构倾向尚未定稿（产品侧叙事类型清单的
   * 「叙事结构」列同样留空）。留空是合法状态，结构综合器会跳过空轴而不是报错。
   */
  structureHints: readonly string[];
  /** 是否为兜底项（用户选「其他」时不加载任何策略卡） */
  catchAll?: boolean;
}

/** 词表顺序即 UI 展示顺序，与 Skill-叙事类型清单.csv 一致。 */
export const STORY_TYPES: readonly StoryTypeEntry[] = [
  {
    code: "drama",
    name: "剧情",
    nameEn: "Drama",
    summary: "以人物抉择与关系变化驱动",
    traits: "冲突源于性格/价值观差异；高潮为认知转变；结局不依赖物理胜负",
    structureHints: [],
  },
  {
    code: "comedy",
    name: "喜剧",
    nameEn: "Comedy",
    summary: "以制造笑点为结构动力",
    traits: "依赖误会、夸张、反转；结局趋向和解；节奏密集，笑点即情节节点",
    structureHints: [],
  },
  {
    code: "tragedy",
    name: "悲剧",
    nameEn: "Tragedy",
    summary: "主人公走向不可逆失败",
    traits: "宿命感强；缺陷导致毁灭；拒绝爽感补偿；结局沉重",
    structureHints: [],
  },
  {
    code: "action",
    name: "动作",
    nameEn: "Action",
    summary: "以肢体/武力对抗推进",
    traits: "目标单一明确（逃生/夺物）；敌我清晰；场景快速切换；动作即决策外化",
    structureHints: [],
  },
  {
    code: "adventure",
    name: "冒险",
    nameEn: "Adventure",
    summary: "离开日常环境探索未知",
    traits: "启程—试炼—回归结构；地图式展开；新环境规则逐步揭示",
    structureHints: [],
  },
  {
    code: "scifi",
    name: "科幻",
    nameEn: "Sci-Fi",
    summary: "基于科学假设的推演",
    traits: "先确立“What if”设定；技术变量影响社会/人性；逻辑自洽优先",
    structureHints: [],
  },
  {
    code: "fantasy",
    name: "奇幻",
    nameEn: "Fantasy",
    summary: "引入魔法/超自然法则",
    traits: "双世界或完全架空；力量体系有明确边界；英雄旅程模板高频",
    structureHints: [],
  },
  {
    code: "horror",
    name: "恐怖",
    nameEn: "Horror",
    summary: "以恐惧体验为核心",
    traits: "信息控制（知情差）；威胁渐进暴露；肉体/精神双重压迫；结局多为惨胜或开放",
    structureHints: [],
  },
  {
    code: "mystery",
    name: "悬疑",
    nameEn: "Mystery",
    summary: "以解开谜团为驱动力",
    traits: "谜面—线索—误导—揭晓结构；重视逻辑闭环；可玩叙述性诡计",
    structureHints: [],
  },
  {
    code: "crime",
    name: "犯罪",
    nameEn: "Crime",
    summary: "围绕违法与惩罚",
    traits: "警匪双线或单线追诉；证据链即情节链；道德灰度高",
    structureHints: [],
  },
  {
    code: "romance",
    name: "爱情",
    nameEn: "Romance",
    summary: "情感关系的发展与抉择",
    traits: "相遇—阻碍—抉择结构；障碍来自阶级/误会/时机；高潮为告白或放手",
    structureHints: [],
  },
  {
    code: "historical",
    name: "历史",
    nameEn: "Historical",
    summary: "依托真实历史背景",
    traits: "受史实/器物/语言约束；大时代挤压小人物；命运受时代洪流支配",
    structureHints: [],
  },
  {
    code: "war",
    name: "战争",
    nameEn: "War",
    summary: "集体暴力下的生存博弈",
    traits: "宏观战略+微观士兵视角；敌我界限模糊；主题常落于反战或兄弟情谊",
    structureHints: [],
  },
  {
    code: "other",
    name: "其他",
    nameEn: "Other",
    summary: "不落入上述任一类型",
    traits: "",
    structureHints: [],
    catchAll: true,
  },
];

const BY_CODE = new Map<string, StoryTypeEntry>(STORY_TYPES.map((t) => [t.code, t]));

export function getStoryType(code: string | null | undefined): StoryTypeEntry | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

export function isStoryTypeCode(code: string): code is StoryTypeCode {
  return BY_CODE.has(code);
}
