/**
 * 叙事题材轴（19 项 + 其他）—— 决定故事「跑什么内容」：世界、职业、符号、话题。
 *
 * 与标签选择里的 TAG_DIMENSIONS.genre（奇幻/科幻/武侠…）不是一回事：
 * 那一维描述世界观底色，本轴描述题材领域。两者暂时并存，合并与否留待后续。
 */

export const STORY_THEME_CODES = [
  "workplace",
  "campus",
  "family",
  "gangster",
  "medical",
  "sports",
  "food",
  "eco",
  "palace",
  "espionage",
  "tomb-raiding",
  "apocalypse",
  "supernatural",
  "time-travel",
  "cultivation",
  "cyberpunk",
  "ai",
  "time-loop",
  "identity",
  "other",
] as const;

export type StoryThemeCode = (typeof STORY_THEME_CODES)[number];

export interface StoryThemeEntry {
  code: StoryThemeCode;
  name: string;
  nameEn: string;
  /** 一句话简介：这一题材的舞台是什么 */
  summary: string;
  /** 叙事特点：常见冲突源、事件单元、场景 */
  traits: string;
  /**
   * 该题材倾向的叙事结构。
   * 同 story-types.ts：题材轴的结构倾向尚未定稿，全部留空，综合器跳过空轴。
   */
  structureHints: readonly string[];
  catchAll?: boolean;
}

/** 词表顺序即 UI 展示顺序，与 Skill-叙事题材清单.csv 一致。 */
export const STORY_THEMES: readonly StoryThemeEntry[] = [
  {
    code: "workplace",
    name: "职场",
    nameEn: "Workplace",
    summary: "现代职业环境为背景",
    traits: "冲突源于KPI、晋升、办公室政治；规则明确；对话驱动",
    structureHints: [],
  },
  {
    code: "campus",
    name: "校园",
    nameEn: "Campus",
    summary: "教育机构为封闭舞台",
    traits: "年龄过渡仪式（升学/毕业）；师生关系、同侪压力；怀旧或疼痛二选一",
    structureHints: [],
  },
  {
    code: "family",
    name: "家庭",
    nameEn: "Family",
    summary: "血缘/婚姻关系为核心",
    traits: "代际冲突、赡养、遗产；饭桌/客厅为主要场景；秘密易引发爆发",
    structureHints: [],
  },
  {
    code: "gangster",
    name: "黑帮",
    nameEn: "Gangster",
    summary: "地下犯罪组织生态",
    traits: "忠诚与背叛循环；等级森严；暴力即仲裁手段",
    structureHints: [],
  },
  {
    code: "medical",
    name: "医疗",
    nameEn: "Medical",
    summary: "医院/诊所为场域",
    traits: "生死压缩至极短时间；职业准则vs人情；病例即单元事件",
    structureHints: [],
  },
  {
    code: "sports",
    name: "体育",
    nameEn: "Sports",
    summary: "竞技比赛为核心事件",
    traits: "训练—挫折—突破弧光；身体极限外化意志；规则边界清晰",
    structureHints: [],
  },
  {
    code: "food",
    name: "美食",
    nameEn: "Food",
    summary: "食物制作/享用为媒介",
    traits: "食谱/店铺传承=人际关系；味觉承载记忆；慢节奏，感官描写密集",
    structureHints: [],
  },
  {
    code: "eco",
    name: "生态",
    nameEn: "Eco",
    summary: "人与自然关系",
    traits: "自然灾害、物种灭绝、环保抗争；人类中心主义受挑战",
    structureHints: [],
  },
  {
    code: "palace",
    name: "宫廷",
    nameEn: "Palace",
    summary: "皇室/贵族权力中心",
    traits: "座位图即权力图；言语即刀；联姻/废立为常见事件；信息战",
    structureHints: [],
  },
  {
    code: "espionage",
    name: "谍战",
    nameEn: "Espionage",
    summary: "情报人员秘密活动",
    traits: "多重伪装身份；信仰与生存拉扯；一句谎言影响全局",
    structureHints: [],
  },
  {
    code: "tomb-raiding",
    name: "盗墓",
    nameEn: "Tomb-Raiding",
    summary: "探索古墓遗迹",
    traits: "地图+机关+诅咒；死者口述历史；贪婪驱动；团队内讧高发",
    structureHints: [],
  },
  {
    code: "apocalypse",
    name: "末日",
    nameEn: "Apocalypse",
    summary: "文明崩溃后的世界",
    traits: "资源极度匮乏；社会秩序瓦解；人性极端测试；封闭空间求生",
    structureHints: [],
  },
  {
    code: "supernatural",
    name: "灵异",
    nameEn: "Supernatural",
    summary: "鬼魂/超自然现象",
    traits: "阴阳两界信息不对称；怨念驱动事件；驱魔/和解为结局方向",
    structureHints: [],
  },
  {
    code: "time-travel",
    name: "穿越",
    nameEn: "Time Travel",
    summary: "跨越时间线移动",
    traits: "蝴蝶效应显著；历史改变牵动现实；常伴身份错位",
    structureHints: [],
  },
  {
    code: "cultivation",
    name: "修仙",
    nameEn: "Cultivation",
    summary: "东方修炼升级体系",
    traits: "等级化力量体系（筑基/金丹等）；渡劫=心魔考验；宗门即官场",
    structureHints: [],
  },
  {
    code: "cyberpunk",
    name: "赛博朋克",
    nameEn: "Cyberpunk",
    summary: "高科技低生活反差",
    traits: "身体可改造；资本/算法掌控一切；霓虹美学；底层反抗巨头",
    structureHints: [],
  },
  {
    code: "ai",
    name: "AI",
    nameEn: "Artificial Intelligence",
    summary: "人工智能觉醒/应用",
    traits: "意识边界模糊；工具翻身为主语；恐惧源于“似人非人”",
    structureHints: [],
  },
  {
    code: "time-loop",
    name: "时间循环",
    nameEn: "Time Loop",
    summary: "时间重置机制",
    traits: "死亡/失败即存档点；信息累积突破困局；宿命与自由意志博弈",
    structureHints: [],
  },
  {
    code: "identity",
    name: "性别/身份",
    nameEn: "Identity",
    summary: "性别/身份认同议题",
    traits: "性转；身体与社会标签错位；出柜/自我接纳为关键转折；社会偏见为阻力",
    structureHints: [],
  },
  {
    code: "other",
    name: "其他",
    nameEn: "Other",
    summary: "不落入上述任一题材",
    traits: "",
    structureHints: [],
    catchAll: true,
  },
];

const BY_CODE = new Map<string, StoryThemeEntry>(STORY_THEMES.map((t) => [t.code, t]));

export function getStoryTheme(code: string | null | undefined): StoryThemeEntry | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

export function isStoryThemeCode(code: string): code is StoryThemeCode {
  return BY_CODE.has(code);
}
