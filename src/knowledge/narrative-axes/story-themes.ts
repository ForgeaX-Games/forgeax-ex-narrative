/**
 * 叙事题材轴（19 项 + 其他）—— 决定故事「跑什么内容」：世界、职业、符号、话题。
 *
 * 与标签选择里的 TAG_DIMENSIONS.genre（奇幻/科幻/武侠…）不是一回事：
 * 那一维描述世界观底色，本轴描述题材领域。两者暂时并存，合并与否留待后续；
 * 标签值到本轴 code 的换算见 tag-axis-mapping.ts。
 */
import type { StoryStructureCode } from "./story-structures.js";

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
   * 该题材倾向的叙事结构，**第一项为首选**（位次即投票权重）。
   *
   * 判据是这一题材的舞台形态：舞台是"一张关系网"的给 network，
   * 是"一串单元事件"的给 fishbone，机制本身就是结构的（时间循环）直接给同名结构。
   */
  structureHints: readonly StoryStructureCode[];
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
    /** 办公室政治是一张关系网，晋升抉择才是分叉点 */
    structureHints: ["network", "tree"],
  },
  {
    code: "campus",
    name: "校园",
    nameEn: "Campus",
    summary: "教育机构为封闭舞台",
    traits: "年龄过渡仪式（升学/毕业）；师生关系、同侪压力；怀旧或疼痛二选一",
    /** 学年是天然时间轴，关系抉择挂在轴上 */
    structureHints: ["linear", "tree"],
  },
  {
    code: "family",
    name: "家庭",
    nameEn: "Family",
    summary: "血缘/婚姻关系为核心",
    traits: "代际冲突、赡养、遗产；饭桌/客厅为主要场景；秘密易引发爆发",
    /** 同一个家事各代各有一套说法，视角差即结构 */
    structureHints: ["multi-pov", "linear"],
  },
  {
    code: "gangster",
    name: "黑帮",
    nameEn: "Gangster",
    summary: "地下犯罪组织生态",
    traits: "忠诚与背叛循环；等级森严；暴力即仲裁手段",
    /** 组织是网，忠诚与背叛沿网传导 */
    structureHints: ["network", "multiline"],
  },
  {
    code: "medical",
    name: "医疗",
    nameEn: "Medical",
    summary: "医院/诊所为场域",
    traits: "生死压缩至极短时间；职业准则vs人情；病例即单元事件",
    /** 病例即单元事件，主骨是医者自身的线 */
    structureHints: ["fishbone", "linear"],
  },
  {
    code: "sports",
    name: "体育",
    nameEn: "Sports",
    summary: "竞技比赛为核心事件",
    traits: "训练—挫折—突破弧光；身体极限外化意志；规则边界清晰",
    /** 训练—挫折—突破是单向弧光，赛事挂成侧骨 */
    structureHints: ["linear", "fishbone"],
  },
  {
    code: "food",
    name: "美食",
    nameEn: "Food",
    summary: "食物制作/享用为媒介",
    traits: "食谱/店铺传承=人际关系；味觉承载记忆；慢节奏，感官描写密集",
    /** 一道菜一个单元，人情自下而上长出来 */
    structureHints: ["fishbone", "emergent"],
  },
  {
    code: "eco",
    name: "生态",
    nameEn: "Eco",
    summary: "人与自然关系",
    traits: "自然灾害、物种灭绝、环保抗争；人类中心主义受挑战",
    /** 生态是系统：结果从要素互动里涌现，不由主角决定 */
    structureHints: ["emergent", "network"],
  },
  {
    code: "palace",
    name: "宫廷",
    nameEn: "Palace",
    summary: "皇室/贵族权力中心",
    traits: "座位图即权力图；言语即刀；联姻/废立为常见事件；信息战",
    /** 座位图即权力图，信息战要多视角才成立 */
    structureHints: ["network", "multi-pov", "tree"],
  },
  {
    code: "espionage",
    name: "谍战",
    nameEn: "Espionage",
    summary: "情报人员秘密活动",
    traits: "多重伪装身份；信仰与生存拉扯；一句谎言影响全局",
    /** 多重身份天然是多视角；一句谎言沿关系网扩散 */
    structureHints: ["multi-pov", "network", "tree"],
  },
  {
    code: "tomb-raiding",
    name: "盗墓",
    nameEn: "Tomb-Raiding",
    summary: "探索古墓遗迹",
    traits: "地图+机关+诅咒；死者口述历史；贪婪驱动；团队内讧高发",
    /** 机关与墓室是串接单元，内讧处才分叉 */
    structureHints: ["fishbone", "tree"],
  },
  {
    code: "apocalypse",
    name: "末日",
    nameEn: "Apocalypse",
    summary: "文明崩溃后的世界",
    traits: "资源极度匮乏；社会秩序瓦解；人性极端测试；封闭空间求生",
    /** 人性测试要有真实的两难分叉，资源博弈自下而上涌现 */
    structureHints: ["tree", "emergent", "fragmented"],
  },
  {
    code: "supernatural",
    name: "灵异",
    nameEn: "Supernatural",
    summary: "鬼魂/超自然现象",
    traits: "阴阳两界信息不对称；怨念驱动事件；驱魔/和解为结局方向",
    /** 怨念的来历靠碎片拼；生者与亡者是内外两层 */
    structureHints: ["fragmented", "nested", "tree"],
  },
  {
    code: "time-travel",
    name: "穿越",
    nameEn: "Time Travel",
    summary: "跨越时间线移动",
    traits: "蝴蝶效应显著；历史改变牵动现实；常伴身份错位",
    /** 蝴蝶效应就是分叉本身，改动与原时间线并行 */
    structureHints: ["tree", "multiline", "loop"],
  },
  {
    code: "cultivation",
    name: "修仙",
    nameEn: "Cultivation",
    summary: "东方修炼升级体系",
    traits: "等级化力量体系（筑基/金丹等）；渡劫=心魔考验；宗门即官场",
    /** 境界是单向阶梯，宗门关系另成一网 */
    structureHints: ["linear", "fishbone", "network"],
  },
  {
    code: "cyberpunk",
    name: "赛博朋克",
    nameEn: "Cyberpunk",
    summary: "高科技低生活反差",
    traits: "身体可改造；资本/算法掌控一切；霓虹美学；底层反抗巨头",
    /** 资本与算法是网，底层视野天然碎片 */
    structureHints: ["network", "fragmented", "tree"],
  },
  {
    code: "ai",
    name: "AI",
    nameEn: "Artificial Intelligence",
    summary: "人工智能觉醒/应用",
    traits: "意识边界模糊；工具翻身为主语；恐惧源于“似人非人”",
    /** 觉醒与否是真分叉；训练回环带来宿命感 */
    structureHints: ["tree", "network", "loop"],
  },
  {
    code: "time-loop",
    name: "时间循环",
    nameEn: "Time Loop",
    summary: "时间重置机制",
    traits: "死亡/失败即存档点；信息累积突破困局；宿命与自由意志博弈",
    /** 机制即结构：回环是硬要求，累积的信息才开出分叉 */
    structureHints: ["loop", "tree"],
  },
  {
    code: "identity",
    name: "性别/身份",
    nameEn: "Identity",
    summary: "性别/身份认同议题",
    traits: "性转；身体与社会标签错位；出柜/自我接纳为关键转折；社会偏见为阻力",
    /** 自我接纳是抉择，社会标签需要他者视角 */
    structureHints: ["tree", "multi-pov"],
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
