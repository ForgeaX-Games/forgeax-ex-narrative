/**
 * 叙事类型轴（13 项 + 其他）—— 决定故事「怎么跑」：因果逻辑、节拍、预期管理。
 *
 * 命名说明：本文件用 Story* 前缀而非 Narrative*，因为 knowledge/genre-narrative-type.ts
 * 里的 `NarrativeType`（linear / branching / fragmented / emergent / minimal）已经占用了
 * 「叙事类型」这个词，但它指的是**管线形态族**（该品类的叙事怎么生产），
 * 与本文件的文艺类型（剧情 / 喜剧 / 悲剧…）是两回事。两者不可混用。
 */
import type { StoryStructureCode } from "./story-structures.js";

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
   * 该类型倾向的叙事结构，**第一项为首选**（位次即投票权重，见 resolve-structure.ts）。
   *
   * 判据是这一类型靠什么驱动：驱动力是"抉择"的给 tree，是"信息控制"的给 fragmented，
   * 是"宿命"的给 loop。只写站得住的两三项 —— 把 12 个结构都列上等于没投票。
   * 留空（仅「其他」兜底项）是合法状态，综合器跳过空轴而不是报错。
   */
  structureHints: readonly StoryStructureCode[];
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
    /** 抉择即分叉：人物在关系里做的每个决定都该长出一条真实走向 */
    structureHints: ["tree", "multi-pov", "linear"],
  },
  {
    code: "comedy",
    name: "喜剧",
    nameEn: "Comedy",
    summary: "以制造笑点为结构动力",
    traits: "依赖误会、夸张、反转；结局趋向和解；节奏密集，笑点即情节节点",
    /** 笑点即情节节点，主骨清楚、侧骨密集，侧支短而多 */
    structureHints: ["fishbone", "linear", "hybrid"],
  },
  {
    code: "tragedy",
    name: "悲剧",
    nameEn: "Tragedy",
    summary: "主人公走向不可逆失败",
    traits: "宿命感强；缺陷导致毁灭；拒绝爽感补偿；结局沉重",
    /** 宿命感来自闭环：结局的种子必须埋在开场，回环收束 */
    structureHints: ["loop", "linear"],
  },
  {
    code: "action",
    name: "动作",
    nameEn: "Action",
    summary: "以肢体/武力对抗推进",
    traits: "目标单一明确（逃生/夺物）；敌我清晰；场景快速切换；动作即决策外化",
    /** 目标单一、敌我清晰，主链推进不宜多歧路 */
    structureHints: ["linear", "fishbone"],
  },
  {
    code: "adventure",
    name: "冒险",
    nameEn: "Adventure",
    summary: "离开日常环境探索未知",
    traits: "启程—试炼—回归结构；地图式展开；新环境规则逐步揭示",
    /** 地图式展开：主线为骨，各处探索点挂成侧骨 */
    structureHints: ["fishbone", "tree", "linear"],
  },
  {
    code: "scifi",
    name: "科幻",
    nameEn: "Sci-Fi",
    summary: "基于科学假设的推演",
    traits: "先确立“What if”设定；技术变量影响社会/人性；逻辑自洽优先",
    /** 设定推演本身就是分叉：同一个 What if 推出不同社会后果 */
    structureHints: ["tree", "network", "linear"],
  },
  {
    code: "fantasy",
    name: "奇幻",
    nameEn: "Fantasy",
    summary: "引入魔法/超自然法则",
    traits: "双世界或完全架空；力量体系有明确边界；英雄旅程模板高频",
    /** 英雄旅程是线性模板，双世界设定才需要并行线 */
    structureHints: ["linear", "tree", "multiline"],
  },
  {
    code: "horror",
    name: "恐怖",
    nameEn: "Horror",
    summary: "以恐惧体验为核心",
    traits: "信息控制（知情差）；威胁渐进暴露；肉体/精神双重压迫；结局多为惨胜或开放",
    /** 信息控制靠碎片释放，惨胜/开放多结局需要分叉 */
    structureHints: ["tree", "fragmented", "linear"],
  },
  {
    code: "mystery",
    name: "悬疑",
    nameEn: "Mystery",
    summary: "以解开谜团为驱动力",
    traits: "谜面—线索—误导—揭晓结构；重视逻辑闭环；可玩叙述性诡计",
    /** 谜面靠碎片与视角差立住，揭晓前不可被单线说透 */
    structureHints: ["fragmented", "multi-pov", "tree"],
  },
  {
    code: "crime",
    name: "犯罪",
    nameEn: "Crime",
    summary: "围绕违法与惩罚",
    traits: "警匪双线或单线追诉；证据链即情节链；道德灰度高",
    /** 警匪双线或证据链单线；关系网决定谁牵连谁 */
    structureHints: ["multiline", "linear", "network"],
  },
  {
    code: "romance",
    name: "爱情",
    nameEn: "Romance",
    summary: "情感关系的发展与抉择",
    traits: "相遇—阻碍—抉择结构；障碍来自阶级/误会/时机；高潮为告白或放手",
    /** 告白或放手是真抉择，必须有不止一个结局 */
    structureHints: ["tree", "linear"],
  },
  {
    code: "historical",
    name: "历史",
    nameEn: "Historical",
    summary: "依托真实历史背景",
    traits: "受史实/器物/语言约束；大时代挤压小人物；命运受时代洪流支配",
    /** 史实不可改，主链固定；大时代靠多视角承载 */
    structureHints: ["linear", "multi-pov"],
  },
  {
    code: "war",
    name: "战争",
    nameEn: "War",
    summary: "集体暴力下的生存博弈",
    traits: "宏观战略+微观士兵视角；敌我界限模糊；主题常落于反战或兄弟情谊",
    /** 宏观战略与微观士兵必须同时在场，视角轮替是结构 */
    structureHints: ["multi-pov", "multiline", "linear"],
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
