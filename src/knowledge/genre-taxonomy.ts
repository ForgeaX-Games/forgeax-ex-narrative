import type { TierId } from "../types/index.js";
import type { NarrativeType } from "./genre-narrative-type.js";
import { getNarrativeType } from "./genre-narrative-type.js";
import type { PipelineTemplateId } from "../pipeline/routing/templates.js";
import type { NarrativePipelineId } from "../pipeline/routing/narrative-pipelines.js";
import { resolveNarrativePipeline } from "../pipeline/routing/narrative-pipelines.js";
import { GENRE_NAME_EN } from "./genre-names-en.js";

export type ContentLocale = "en" | "zh";

/**
 * 15 大游戏品类大类（A2-1: 二级品类折叠分组用）。
 * 顺序对应 RAW_TAXONOMY 中的 // === XXX === 注释分组。
 */
export const GENRE_CATEGORIES = [
  "rpg", "action", "strategy", "adventure", "simulation",
  "shooter", "puzzle", "sports-racing", "card", "fighting",
  "rhythm", "horror", "casual", "survival", "misc",
] as const;
export type GenreCategory = typeof GENRE_CATEGORIES[number];

export const GENRE_CATEGORY_LABELS: Record<GenreCategory, string> = {
  rpg: "RPG",
  action: "动作",
  strategy: "策略",
  adventure: "冒险",
  simulation: "模拟",
  shooter: "射击",
  puzzle: "解谜",
  "sports-racing": "体育/竞速",
  card: "卡牌",
  fighting: "格斗",
  rhythm: "音游",
  horror: "恐怖",
  casual: "休闲",
  survival: "生存",
  misc: "其他",
};

export const GENRE_CATEGORY_LABELS_EN: Record<GenreCategory, string> = {
  rpg: "RPG",
  action: "Action",
  strategy: "Strategy",
  adventure: "Adventure",
  simulation: "Simulation",
  shooter: "Shooter",
  puzzle: "Puzzle",
  "sports-racing": "Sports / Racing",
  card: "Card",
  fighting: "Fighting",
  rhythm: "Rhythm",
  horror: "Horror",
  casual: "Casual",
  survival: "Survival",
  misc: "Other",
};

export function getCategoryLabel(category: GenreCategory, locale: ContentLocale = "zh"): string {
  return locale === "en" ? GENRE_CATEGORY_LABELS_EN[category] : GENRE_CATEGORY_LABELS[category];
}

export function getGenreDisplayName(entry: GenreEntry, locale: ContentLocale = "zh"): string {
  if (locale === "zh") return entry.name;
  return GENRE_NAME_EN[entry.code] ?? entry.name;
}

export interface GenreEntry {
  code: string;
  name: string;
  /**
   * 叙事层级，**品类自带的只读派生属性**（PRD v1.4 §3.2.2）。
   *
   * 用户不再直接选择层级：选定某位叙事策划专家即选定品类，tier 由品类查表得到。
   * 它仍是模板选择、needs 兜底、skill 目录与断点续跑的输入，所以字段保留、语义不变，
   * 只是不再出现在路由 UI 上。注意本表的 tier1 是**叙事最重**的一档，
   * 与专家组表格里 T4=重度叙事 的编号方向相反。
   */
  tier: TierId;
  /** A2-1: 二级品类大类（用于前端 UI 折叠分组） */
  category: GenreCategory;
  narrative_ratio: string;
  needs: Record<string, 0 | 1 | 2 | 3>;
  keywords: string[];
  narrative_type: NarrativeType;
  /**
   * @deprecated 旧架构的按品类家族切分的 step 模板（B2）。
   * 四期起路由目标是 narrativePipeline（席位序列），本字段只为历史 checkpoint
   * 与归档管线（tpl-jrpg-v2 / tpl-vn-v2 / tpl-narrative-card）保留可解析性。
   */
  pipelineTemplate: PipelineTemplateId;
  /**
   * 新架构管线（四期）：由二十席组合而成的四条之一，按叙事层级归类。
   * 事实源见 pipeline/narrative-pipelines.ts 与专家组 CSV 第 7 列。
   */
  narrativePipeline: NarrativePipelineId;
}

type RawGenreEntry = Omit<
  GenreEntry,
  "narrative_type" | "pipelineTemplate" | "narrativePipeline"
>;

/**
 * 从 GENRE_TAXONOMY_FULL.md 转化的结构化品类知识库。
 * needs 中: W=世界观, C=角色, S=剧情结构, D=对话, Q=支线, E=环境叙事, I=物品叙事, U=UI文案, L=Lore碎片
 * 3=核心必需(★★★), 2=重要推荐(★★), 1=可选点缀(★), 0=不需要(—)
 */
const RAW_TAXONOMY: RawGenreEntry[] = [
  // === RPG ===
  { code: "rpg-jrpg", name: "JRPG", tier: "tier1", category: "rpg", narrative_ratio: "60-85%", needs: { W: 3, C: 3, S: 3, D: 3, Q: 2, E: 2, I: 2, U: 2, L: 2 }, keywords: ["jrpg", "日式rpg", "回合制rpg", "最终幻想", "勇者斗恶龙", "女神异闻录"] },
  { code: "rpg-crpg", name: "WRPG/CRPG", tier: "tier1", category: "rpg", narrative_ratio: "70-90%", needs: { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3, U: 2, L: 3 }, keywords: ["crpg", "wrpg", "西式rpg", "博德之门", "神界原罪", "辐射"] },
  { code: "rpg-arpg", name: "ARPG", tier: "tier2", category: "rpg", narrative_ratio: "30-55%", needs: { W: 3, C: 2, S: 2, D: 2, Q: 2, E: 3, I: 3, U: 2, L: 3 }, keywords: ["arpg", "动作rpg", "暗黑之魂", "艾尔登法环", "巫师"] },
  { code: "rpg-mmorpg", name: "MMORPG", tier: "tier2", category: "rpg", narrative_ratio: "35-55%", needs: { W: 3, C: 3, S: 2, D: 3, Q: 3, E: 2, I: 3, U: 3, L: 3 }, keywords: ["mmorpg", "网游", "ff14", "魔兽世界", "逆水寒"] },
  { code: "rpg-srpg", name: "SRPG/战棋RPG", tier: "tier2", category: "rpg", narrative_ratio: "45-65%", needs: { W: 3, C: 3, S: 3, D: 2, Q: 2, E: 1, I: 2, U: 2, L: 2 }, keywords: ["srpg", "trpg", "战棋", "火焰纹章", "三角战略"] },
  { code: "rpg-gacha", name: "抽卡RPG", tier: "tier2", category: "rpg", narrative_ratio: "40-60%", needs: { W: 3, C: 3, S: 2, D: 3, Q: 3, E: 2, I: 2, U: 3, L: 3 }, keywords: ["抽卡", "gacha", "原神", "明日方舟", "崩坏", "星穹铁道"] },
  { code: "rpg-open-world", name: "开放世界RPG", tier: "tier1", category: "rpg", narrative_ratio: "50-75%", needs: { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 3, I: 3, U: 2, L: 3 }, keywords: ["开放世界", "open world", "塞尔达", "上古卷轴", "巫师3", "gta", "荒野大镖客", "赛博朋克2077", "侠盗猎车", "类gta"] },
  { code: "rpg-roguelike", name: "Roguelike RPG", tier: "tier2", category: "rpg", narrative_ratio: "20-40%", needs: { W: 2, C: 2, S: 1, D: 1, Q: 1, E: 2, I: 3, U: 2, L: 3 }, keywords: ["roguelike", "肉鸽", "哈迪斯", "以撒", "暗黑地牢"] },
  { code: "rpg-wuxia", name: "仙侠/武侠RPG", tier: "tier1", category: "rpg", narrative_ratio: "55-80%", needs: { W: 3, C: 3, S: 3, D: 3, Q: 3, E: 2, I: 2, U: 2, L: 2 }, keywords: ["仙侠", "武侠", "修仙", "仙剑", "古剑", "太吾"] },
  { code: "rpg-soulslike", name: "Souls-like", tier: "tier2", category: "rpg", narrative_ratio: "25-40%", needs: { W: 3, C: 1, S: 1, D: 1, Q: 1, E: 3, I: 3, U: 1, L: 3 }, keywords: ["魂like", "soulslike", "魂系", "黑暗之魂", "只狼"] },
  { code: "rpg-idle", name: "放置/挂机RPG", tier: "tier3", category: "rpg", narrative_ratio: "15-30%", needs: { W: 2, C: 2, S: 1, D: 1, Q: 1, E: 0, I: 1, U: 2, L: 1 }, keywords: ["放置rpg", "挂机rpg", "剑与远征"] },
  { code: "rpg-dungeon", name: "Dungeon Crawler", tier: "tier2", category: "rpg", narrative_ratio: "20-40%", needs: { W: 2, C: 2, S: 1, D: 1, Q: 1, E: 3, I: 3, U: 2, L: 3 }, keywords: ["dungeon crawler", "地牢", "暗黑破坏神", "世界树迷宫"] },
  { code: "rpg-sandbox", name: "沙盒RPG", tier: "tier2", category: "rpg", narrative_ratio: "30-50%", needs: { W: 3, C: 3, S: 2, D: 2, Q: 3, E: 3, I: 3, U: 2, L: 3 }, keywords: ["沙盒rpg", "骑马与砍杀", "剑士", "mount and blade", "kenshi"] },

  // === Action ===
  { code: "act-linear", name: "3A线性动作", tier: "tier1", category: "action", narrative_ratio: "50-75%", needs: { W: 3, C: 3, S: 3, D: 2, Q: 1, E: 3, I: 1, U: 2, L: 2 }, keywords: ["3a", "线性动作", "战神", "最后生还者", "鬼泣"] },
  { code: "act-adventure", name: "动作冒险", tier: "tier2", category: "action", narrative_ratio: "40-60%", needs: { W: 3, C: 2, S: 3, D: 2, Q: 2, E: 3, I: 2, U: 2, L: 2 }, keywords: ["动作冒险", "神秘海域", "古墓丽影"] },
  { code: "act-2d-platformer", name: "2D横版动作", tier: "tier2", category: "action", narrative_ratio: "20-45%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 1, E: 3, I: 1, U: 1, L: 2 }, keywords: ["横版", "2d平台", "空洞骑士", "奥日", "蔚蓝"] },
  { code: "act-metroidvania", name: "银河恶魔城", tier: "tier2", category: "action", narrative_ratio: "25-45%", needs: { W: 2, C: 1, S: 2, D: 1, Q: 1, E: 3, I: 2, U: 1, L: 3 }, keywords: ["银河恶魔城", "metroidvania", "恶魔城", "银河战士"] },
  { code: "act-beatup", name: "Beat'em Up", tier: "tier3", category: "action", narrative_ratio: "10-25%", needs: { W: 1, C: 1, S: 1, D: 1, Q: 0, E: 1, I: 1, U: 1, L: 1 }, keywords: ["清版动作", "怒之铁拳"] },
  { code: "act-character", name: "Character Action", tier: "tier2", category: "action", narrative_ratio: "25-40%", needs: { W: 2, C: 2, S: 2, D: 1, Q: 1, E: 2, I: 1, U: 1, L: 1 }, keywords: ["角色动作", "猎天使魔女", "尼尔"] },
  { code: "act-stealth", name: "潜行动作", tier: "tier2", category: "action", narrative_ratio: "40-55%", needs: { W: 3, C: 2, S: 2, D: 2, Q: 2, E: 3, I: 2, U: 2, L: 2 }, keywords: ["潜行", "合金装备", "杀手", "耻辱"] },
  { code: "act-survival", name: "生存动作", tier: "tier2", category: "action", narrative_ratio: "20-40%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 1, E: 3, I: 3, U: 2, L: 2 }, keywords: ["生存动作", "方舟", "森林", "绿色地狱"] },
  { code: "act-immersive-sim", name: "沉浸式模拟", tier: "tier1", category: "action", narrative_ratio: "50-75%", needs: { W: 3, C: 3, S: 3, D: 2, Q: 3, E: 3, I: 3, U: 2, L: 3 }, keywords: ["沉浸模拟", "immersive sim", "杀出重围", "耻辱", "掠食", "prey", "deus ex", "dishonored"] },
  { code: "act-musou", name: "无双动作", tier: "tier3", category: "action", narrative_ratio: "15-25%", needs: { W: 2, C: 3, S: 1, D: 1, Q: 1, E: 1, I: 1, U: 2, L: 1 }, keywords: ["无双", "musou", "真三国无双", "塞尔达无双", "dynasty warriors"] },

  // === Strategy ===
  { code: "str-tbs", name: "回合制策略", tier: "tier2", category: "strategy", narrative_ratio: "25-45%", needs: { W: 3, C: 2, S: 2, D: 1, Q: 1, E: 1, I: 2, U: 2, L: 3 }, keywords: ["回合制策略", "tbs", "文明", "全面战争", "xcom"] },
  { code: "str-rts", name: "即时策略", tier: "tier3", category: "strategy", narrative_ratio: "15-30%", needs: { W: 3, C: 2, S: 2, D: 1, Q: 1, E: 1, I: 1, U: 2, L: 2 }, keywords: ["rts", "即时策略", "星际争霸", "帝国时代", "红警"] },
  { code: "str-slg", name: "SLG策略手游", tier: "tier2", category: "strategy", narrative_ratio: "25-40%", needs: { W: 3, C: 3, S: 2, D: 2, Q: 2, E: 1, I: 2, U: 3, L: 3 }, keywords: ["slg", "策略手游", "率土之滨", "万国觉醒", "三国志战略版"] },
  { code: "str-tactics", name: "战棋", tier: "tier2", category: "strategy", narrative_ratio: "35-55%", needs: { W: 3, C: 3, S: 3, D: 2, Q: 2, E: 1, I: 2, U: 2, L: 2 }, keywords: ["战棋", "tactics", "陷阵之志"] },
  { code: "str-td", name: "塔防", tier: "tier3", category: "strategy", narrative_ratio: "10-25%", needs: { W: 2, C: 2, S: 1, D: 1, Q: 1, E: 1, I: 1, U: 2, L: 1 }, keywords: ["塔防", "tower defense", "王国保卫战", "保卫萝卜"] },
  { code: "str-4x", name: "4X策略", tier: "tier2", category: "strategy", narrative_ratio: "20-35%", needs: { W: 3, C: 2, S: 1, D: 1, Q: 1, E: 1, I: 2, U: 2, L: 3 }, keywords: ["4x", "群星", "无尽空间", "旧世界"] },
  { code: "str-autobattle", name: "自走棋", tier: "tier3", category: "strategy", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 0, D: 0, Q: 0, E: 0, I: 1, U: 2, L: 1 }, keywords: ["自走棋", "云顶之弈", "刀塔霸业"] },
  { code: "str-moba", name: "MOBA", tier: "tier3", category: "strategy", narrative_ratio: "10-20%", needs: { W: 2, C: 3, S: 0, D: 1, Q: 0, E: 1, I: 1, U: 2, L: 2 }, keywords: ["moba", "王者荣耀", "lol", "dota"] },
  { code: "str-grand", name: "大战略", tier: "tier2", category: "strategy", narrative_ratio: "20-35%", needs: { W: 3, C: 3, S: 2, D: 1, Q: 2, E: 1, I: 1, U: 2, L: 3 }, keywords: ["大战略", "grand strategy", "钢铁雄心", "十字军之王", "欧陆风云", "p社", "crusader kings", "hearts of iron"] },

  // === Adventure ===
  { code: "adv-vn", name: "视觉小说/AVG", tier: "tier1", category: "adventure", narrative_ratio: "80-95%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 2, E: 1, I: 1, U: 2, L: 1 }, keywords: ["视觉小说", "avg", "galgame", "命运石之门", "逆转裁判"] },
  { code: "adv-interactive", name: "互动叙事", tier: "tier1", category: "adventure", narrative_ratio: "85-95%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 2, E: 2, I: 1, U: 2, L: 1 }, keywords: ["互动叙事", "互动电影", "底特律", "隐形守护者", "暴雨"] },
  { code: "adv-walking-sim", name: "步行模拟", tier: "tier1", category: "adventure", narrative_ratio: "75-90%", needs: { W: 2, C: 2, S: 2, D: 2, Q: 1, E: 3, I: 2, U: 1, L: 3 }, keywords: ["步行模拟", "walking sim", "伊迪芬奇", "壁炉之下"] },
  { code: "adv-text", name: "文字冒险", tier: "tier1", category: "adventure", narrative_ratio: "90-98%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 2, E: 1, I: 1, U: 1, L: 1 }, keywords: ["文字冒险", "text adventure", "生命线", "80天"] },
  { code: "adv-pointclick", name: "点击冒险", tier: "tier1", category: "adventure", narrative_ratio: "60-80%", needs: { W: 2, C: 2, S: 3, D: 2, Q: 2, E: 3, I: 3, U: 2, L: 2 }, keywords: ["点击冒险", "point and click", "猴岛", "锈湖"] },
  { code: "adv-puzzle", name: "解谜冒险", tier: "tier1", category: "adventure", narrative_ratio: "50-75%", needs: { W: 2, C: 2, S: 3, D: 2, Q: 1, E: 3, I: 2, U: 2, L: 2 }, keywords: ["解谜冒险", "传送门", "braid", "见证者"] },
  { code: "adv-otome", name: "乙女游戏", tier: "tier1", category: "adventure", narrative_ratio: "80-95%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 2, E: 1, I: 1, U: 2, L: 1 }, keywords: ["乙女", "恋与制作人", "光与夜之恋"] },
  { code: "adv-horror", name: "恐怖冒险", tier: "tier2", category: "adventure", narrative_ratio: "40-65%", needs: { W: 2, C: 2, S: 3, D: 2, Q: 1, E: 3, I: 2, U: 1, L: 3 }, keywords: ["恐怖冒险", "生化危机", "寂静岭", "逃生"] },
  { code: "adv-detective", name: "侦探/推理", tier: "tier1", category: "adventure", narrative_ratio: "70-90%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 2, E: 3, I: 3, U: 2, L: 2 }, keywords: ["侦探", "推理", "弹丸论破", "夏洛克"] },
  { code: "adv-horror-vn", name: "恐怖视觉小说", tier: "tier1", category: "adventure", narrative_ratio: "80-95%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 1, E: 3, I: 1, U: 1, L: 3 }, keywords: ["恐怖视觉小说", "寒蝉鸣泣", "尸体派对", "saya之歌", "when they cry", "corpse party"] },
  { code: "adv-raising", name: "养成冒险", tier: "tier2", category: "adventure", narrative_ratio: "60-80%", needs: { W: 2, C: 3, S: 2, D: 3, Q: 2, E: 1, I: 1, U: 2, L: 1 }, keywords: ["养成冒险", "养成avg", "美少女梦工厂avg", "心跳回忆"] },
  { code: "adv-life-sim", name: "生活叙事冒险", tier: "tier2", category: "adventure", narrative_ratio: "70-85%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 2, E: 2, I: 1, U: 2, L: 1 }, keywords: ["生活叙事", "clannad", "air", "kanon", "日常系", "slice of life"] },

  // === Simulation ===
  { code: "sim-life", name: "生活模拟", tier: "tier2", category: "simulation", narrative_ratio: "40-55%", needs: { W: 2, C: 3, S: 2, D: 3, Q: 3, E: 2, I: 2, U: 2, L: 1 }, keywords: ["生活模拟", "星露谷", "动物之森", "牧场物语"] },
  { code: "sim-tycoon", name: "经营管理", tier: "tier2", category: "simulation", narrative_ratio: "25-40%", needs: { W: 2, C: 2, S: 1, D: 2, Q: 2, E: 2, I: 2, U: 3, L: 1 }, keywords: ["经营", "管理", "缺氧", "城市天际线", "双点医院"] },
  { code: "sim-raising", name: "养成模拟", tier: "tier2", category: "simulation", narrative_ratio: "40-60%", needs: { W: 2, C: 3, S: 2, D: 3, Q: 2, E: 1, I: 1, U: 2, L: 1 }, keywords: ["养成", "美少女梦工厂", "公主连接"] },
  { code: "sim-sandbox", name: "沙盒建造", tier: "tier3", category: "simulation", narrative_ratio: "10-25%", needs: { W: 1, C: 1, S: 0, D: 1, Q: 1, E: 2, I: 2, U: 2, L: 1 }, keywords: ["沙盒", "minecraft", "我的世界", "泰拉瑞亚", "戴森球"] },
  { code: "sim-survival", name: "生存建造", tier: "tier2", category: "simulation", narrative_ratio: "20-40%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 1, E: 3, I: 3, U: 2, L: 2 }, keywords: ["生存建造", "英灵神殿", "腐蚀"] },
  { code: "sim-social", name: "社交模拟", tier: "tier2", category: "simulation", narrative_ratio: "40-55%", needs: { W: 2, C: 3, S: 2, D: 3, Q: 3, E: 1, I: 1, U: 2, L: 1 }, keywords: ["社交模拟", "模拟人生", "梦想小镇"] },
  { code: "sim-dating", name: "恋爱模拟", tier: "tier1", category: "simulation", narrative_ratio: "70-90%", needs: { W: 2, C: 3, S: 3, D: 3, Q: 3, E: 1, I: 1, U: 2, L: 1 }, keywords: ["恋爱模拟", "约会", "未定事件簿"] },
  { code: "sim-creature", name: "宠物/生物模拟", tier: "tier3", category: "simulation", narrative_ratio: "15-30%", needs: { W: 2, C: 2, S: 1, D: 1, Q: 1, E: 1, I: 2, U: 2, L: 1 }, keywords: ["宠物", "数码宝贝"] },
  { code: "sim-colony", name: "殖民模拟", tier: "tier2", category: "simulation", narrative_ratio: "25-45%", needs: { W: 2, C: 3, S: 1, D: 2, Q: 2, E: 3, I: 3, U: 2, L: 2 }, keywords: ["殖民模拟", "环世界", "矮人要塞", "rimworld", "dwarf fortress", "缺氧"] },

  // === Shooter ===
  { code: "fps-story", name: "剧情FPS", tier: "tier1", category: "shooter", narrative_ratio: "45-70%", needs: { W: 3, C: 2, S: 3, D: 2, Q: 1, E: 3, I: 1, U: 2, L: 2 }, keywords: ["剧情fps", "半条命", "生化奇兵", "光环"] },
  { code: "fps-tactical", name: "战术射击", tier: "tier3", category: "shooter", narrative_ratio: "10-25%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 0, E: 1, I: 1, U: 2, L: 1 }, keywords: ["战术射击", "彩虹六号", "cs"] },
  { code: "fps-br", name: "大逃杀", tier: "tier3", category: "shooter", narrative_ratio: "5-15%", needs: { W: 1, C: 2, S: 0, D: 1, Q: 0, E: 1, I: 1, U: 2, L: 2 }, keywords: ["大逃杀", "吃鸡", "apex", "堡垒之夜", "pubg"] },
  { code: "fps-hero", name: "英雄射击", tier: "tier3", category: "shooter", narrative_ratio: "10-20%", needs: { W: 2, C: 3, S: 0, D: 1, Q: 0, E: 1, I: 1, U: 2, L: 2 }, keywords: ["英雄射击", "守望先锋", "valorant"] },
  { code: "tps-adventure", name: "TPS冒险", tier: "tier2", category: "shooter", narrative_ratio: "40-60%", needs: { W: 3, C: 2, S: 3, D: 2, Q: 2, E: 3, I: 2, U: 2, L: 2 }, keywords: ["tps", "第三人称射击", "控制", "心灵杀手", "地平线"] },
  { code: "fps-looter", name: "掠夺射击", tier: "tier2", category: "shooter", narrative_ratio: "20-35%", needs: { W: 2, C: 2, S: 1, D: 1, Q: 2, E: 1, I: 3, U: 2, L: 3 }, keywords: ["掠夺射击", "looter shooter", "命运2", "全境封锁"] },
  { code: "stg-bullet", name: "弹幕射击", tier: "tier3", category: "shooter", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 1, D: 0, Q: 0, E: 1, I: 0, U: 1, L: 1 }, keywords: ["弹幕", "stg", "东方", "雷电"] },
  { code: "fps-extraction", name: "撤离射击", tier: "tier3", category: "shooter", narrative_ratio: "10-20%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 2, E: 3, I: 3, U: 2, L: 3 }, keywords: ["撤离射击", "extraction shooter", "逃离塔科夫", "tarkov", "dmz", "暗区突围"] },

  // === Puzzle ===
  { code: "puz-narrative", name: "叙事解谜", tier: "tier1", category: "puzzle", narrative_ratio: "50-75%", needs: { W: 2, C: 2, S: 3, D: 2, Q: 1, E: 3, I: 2, U: 2, L: 2 }, keywords: ["叙事解谜", "limbo", "braid"] },
  { code: "puz-escape", name: "密室逃脱", tier: "tier2", category: "puzzle", narrative_ratio: "35-55%", needs: { W: 2, C: 2, S: 2, D: 2, Q: 1, E: 3, I: 3, U: 2, L: 2 }, keywords: ["密室逃脱", "极限脱出", "锈湖", "迷失岛"] },
  { code: "puz-pure", name: "纯机制解谜", tier: "tier3", category: "puzzle", narrative_ratio: "5-15%", needs: { W: 1, C: 0, S: 0, D: 0, Q: 0, E: 1, I: 0, U: 1, L: 0 }, keywords: ["纯解谜", "见证者", "opus magnum"] },
  { code: "puz-physics", name: "物理解谜", tier: "tier3", category: "puzzle", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 1, D: 1, Q: 0, E: 1, I: 0, U: 1, L: 0 }, keywords: ["物理解谜", "人类一败涂地", "割绳子"] },
  { code: "puz-match", name: "消除/匹配", tier: "tier4", category: "puzzle", narrative_ratio: "0-5%", needs: { W: 0, C: 1, S: 1, D: 1, Q: 0, E: 0, I: 0, U: 2, L: 0 }, keywords: ["消除", "三消", "消消乐"] },

  // === Sports/Racing ===
  { code: "spt-sim", name: "体育模拟", tier: "tier3", category: "sports-racing", narrative_ratio: "10-20%", needs: { W: 1, C: 2, S: 1, D: 1, Q: 1, E: 1, I: 1, U: 2, L: 1 }, keywords: ["体育模拟", "fifa", "nba2k", "实况足球"] },
  { code: "spt-mgmt", name: "体育管理", tier: "tier2", category: "sports-racing", narrative_ratio: "20-35%", needs: { W: 1, C: 2, S: 2, D: 1, Q: 2, E: 0, I: 1, U: 2, L: 1 }, keywords: ["体育管理", "足球经理"] },
  { code: "race-sim", name: "赛车/竞速", tier: "tier3", category: "sports-racing", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 1, D: 1, Q: 1, E: 2, I: 1, U: 2, L: 1 }, keywords: ["赛车", "竞速", "极限竞速", "gt赛车"] },
  { code: "race-kart", name: "卡丁车/休闲竞速", tier: "tier3", category: "sports-racing", narrative_ratio: "5-10%", needs: { W: 1, C: 1, S: 0, D: 0, Q: 0, E: 1, I: 1, U: 1, L: 0 }, keywords: ["卡丁车", "马里奥赛车", "跑跑卡丁车"] },
  { code: "spt-extreme", name: "极限运动", tier: "tier3", category: "sports-racing", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 1, D: 1, Q: 1, E: 2, I: 1, U: 2, L: 1 }, keywords: ["极限运动", "tony hawk"] },
  { code: "spt-fighting", name: "拳击/格斗体育", tier: "tier3", category: "sports-racing", narrative_ratio: "10-20%", needs: { W: 1, C: 2, S: 1, D: 1, Q: 1, E: 0, I: 0, U: 1, L: 1 }, keywords: ["拳击", "ufc"] },

  // === Card ===
  { code: "card-ccg", name: "CCG/TCG", tier: "tier3", category: "card", narrative_ratio: "15-25%", needs: { W: 2, C: 2, S: 1, D: 1, Q: 1, E: 0, I: 3, U: 2, L: 2 }, keywords: ["ccg", "tcg", "集换式", "炉石传说", "万智牌", "游戏王"] },
  { code: "card-dbg", name: "DBG构筑式", tier: "tier2", category: "card", narrative_ratio: "20-35%", needs: { W: 2, C: 2, S: 2, D: 1, Q: 1, E: 2, I: 3, U: 2, L: 2 }, keywords: ["dbg", "构筑", "杀戮尖塔", "怪物火车", "邪恶冥刻"] },
  { code: "card-narrative", name: "叙事卡牌", tier: "tier1", category: "card", narrative_ratio: "50-70%", needs: { W: 2, C: 3, S: 3, D: 2, Q: 2, E: 1, I: 3, U: 2, L: 2 }, keywords: ["叙事卡牌", "卡牌之声"] },
  { code: "card-boardgame", name: "桌游数字化", tier: "tier3", category: "card", narrative_ratio: "10-25%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 0, E: 0, I: 2, U: 2, L: 2 }, keywords: ["桌游", "board game"] },

  // === Fighting ===
  { code: "fgt-traditional", name: "传统格斗", tier: "tier3", category: "fighting", narrative_ratio: "10-20%", needs: { W: 2, C: 3, S: 1, D: 1, Q: 0, E: 1, I: 0, U: 1, L: 2 }, keywords: ["格斗", "街霸", "铁拳", "拳皇"] },
  { code: "fgt-platform", name: "平台格斗", tier: "tier3", category: "fighting", narrative_ratio: "5-15%", needs: { W: 1, C: 2, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 1 }, keywords: ["平台格斗", "大乱斗", "brawlhalla"] },
  { code: "fgt-weapon", name: "武器格斗", tier: "tier3", category: "fighting", narrative_ratio: "15-25%", needs: { W: 2, C: 2, S: 2, D: 1, Q: 0, E: 1, I: 1, U: 1, L: 2 }, keywords: ["武器格斗", "灵魂能力", "荣耀战魂"] },
  { code: "fgt-anime", name: "动漫格斗", tier: "tier3", category: "fighting", narrative_ratio: "10-20%", needs: { W: 2, C: 3, S: 1, D: 1, Q: 1, E: 0, I: 0, U: 1, L: 1 }, keywords: ["动漫格斗", "龙珠斗士z", "火影忍者"] },

  // === Rhythm ===
  { code: "rhy-narrative", name: "叙事音游", tier: "tier2", category: "rhythm", narrative_ratio: "30-50%", needs: { W: 2, C: 3, S: 2, D: 2, Q: 1, E: 2, I: 1, U: 2, L: 1 }, keywords: ["叙事音游", "hi-fi rush", "节奏医生"] },
  { code: "rhy-idol", name: "偶像/乐团音游", tier: "tier2", category: "rhythm", narrative_ratio: "25-40%", needs: { W: 2, C: 3, S: 2, D: 2, Q: 2, E: 1, I: 1, U: 2, L: 1 }, keywords: ["偶像音游", "bang dream", "世界计划"] },
  { code: "rhy-pure", name: "纯节奏", tier: "tier4", category: "rhythm", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 1, I: 0, U: 1, L: 0 }, keywords: ["纯节奏", "osu", "太鼓达人"] },
  { code: "rhy-action", name: "音乐动作", tier: "tier2", category: "rhythm", narrative_ratio: "20-35%", needs: { W: 2, C: 2, S: 2, D: 1, Q: 1, E: 2, I: 1, U: 2, L: 1 }, keywords: ["音乐动作", "节奏地牢"] },

  // === Horror ===
  { code: "hor-survival", name: "生存恐怖", tier: "tier2", category: "horror", narrative_ratio: "40-60%", needs: { W: 2, C: 2, S: 3, D: 2, Q: 1, E: 3, I: 3, U: 2, L: 3 }, keywords: ["生存恐怖", "生化危机", "死亡空间"] },
  { code: "hor-psychological", name: "心理恐怖", tier: "tier1", category: "horror", narrative_ratio: "55-80%", needs: { W: 2, C: 3, S: 3, D: 2, Q: 1, E: 3, I: 2, U: 1, L: 3 }, keywords: ["心理恐怖", "层层恐惧", "小小噩梦"] },
  { code: "hor-chase", name: "跑酷恐怖", tier: "tier2", category: "horror", narrative_ratio: "25-40%", needs: { W: 2, C: 1, S: 2, D: 1, Q: 0, E: 3, I: 1, U: 1, L: 2 }, keywords: ["跑酷恐怖", "逃生", "恐惧之间"] },
  { code: "hor-coop", name: "多人恐怖", tier: "tier3", category: "horror", narrative_ratio: "10-25%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 0, E: 3, I: 1, U: 2, L: 2 }, keywords: ["多人恐怖", "恐鬼症", "gtfo"] },
  { code: "hor-cosmic", name: "克苏鲁/宇宙恐怖", tier: "tier2", category: "horror", narrative_ratio: "40-60%", needs: { W: 3, C: 2, S: 2, D: 2, Q: 1, E: 3, I: 3, U: 1, L: 3 }, keywords: ["克苏鲁", "宇宙恐怖", "沉没之城"] },

  // === Casual ===
  { code: "cas-party", name: "派对游戏", tier: "tier3", category: "casual", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 0, D: 1, Q: 0, E: 0, I: 0, U: 2, L: 0 }, keywords: ["派对", "胡闹厨房", "it takes two"] },
  { code: "cas-puzzle", name: "休闲解谜", tier: "tier3", category: "casual", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 1, D: 1, Q: 0, E: 0, I: 0, U: 2, L: 0 }, keywords: ["休闲解谜", "纪念碑谷", "candy crush"] },
  { code: "cas-hyper", name: "超休闲", tier: "tier4", category: "casual", narrative_ratio: "0-3%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["超休闲", "flappy bird", "跳一跳"] },
  { code: "cas-io", name: "IO游戏", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 1, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["io", "大作战", "agar", "slither"] },
  { code: "cas-idle", name: "放置/挂机", tier: "tier3", category: "casual", narrative_ratio: "5-15%", needs: { W: 1, C: 1, S: 1, D: 1, Q: 1, E: 0, I: 1, U: 2, L: 1 }, keywords: ["放置", "挂机", "idle", "cookie clicker"] },
  { code: "cas-cozy", name: "治愈系", tier: "tier3", category: "casual", narrative_ratio: "15-30%", needs: { W: 2, C: 2, S: 1, D: 2, Q: 1, E: 2, I: 1, U: 2, L: 1 }, keywords: ["治愈", "cozy", "cozy game", "unpacking", "短途旅行", "a short hike"] },

  // === Survival ===
  { code: "srv-open", name: "开放世界生存", tier: "tier2", category: "survival", narrative_ratio: "20-40%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 2, E: 3, I: 3, U: 2, L: 2 }, keywords: ["开放生存", "rust", "dayz"] },
  { code: "srv-craft", name: "生存建造", tier: "tier2", category: "survival", narrative_ratio: "15-30%", needs: { W: 2, C: 1, S: 1, D: 1, Q: 1, E: 2, I: 3, U: 2, L: 2 }, keywords: ["生存建造", "饥荒", "七日杀"] },
  { code: "srv-space", name: "太空生存", tier: "tier2", category: "survival", narrative_ratio: "20-40%", needs: { W: 2, C: 1, S: 2, D: 1, Q: 2, E: 3, I: 2, U: 2, L: 3 }, keywords: ["太空生存", "无人深空", "星际拓荒", "深岩银河"] },
  { code: "srv-creative", name: "创意沙盒", tier: "tier3", category: "survival", narrative_ratio: "5-15%", needs: { W: 1, C: 0, S: 0, D: 0, Q: 0, E: 1, I: 2, U: 2, L: 1 }, keywords: ["创意沙盒", "roblox"] },

  // === Misc ===
  { code: "misc-pokemon", name: "宝可梦-like", tier: "tier2", category: "misc", narrative_ratio: "35-50%", needs: { W: 3, C: 3, S: 2, D: 2, Q: 3, E: 2, I: 3, U: 2, L: 3 }, keywords: ["宝可梦", "幻兽帕鲁", "pokemon"] },
  { code: "misc-pinball", name: "弹珠/弹球", tier: "tier4", category: "misc", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 1, I: 0, U: 1, L: 0 }, keywords: ["弹珠", "弹球", "pinball"] },
  { code: "misc-edu", name: "教育游戏", tier: "tier2", category: "misc", narrative_ratio: "25-40%", needs: { W: 2, C: 2, S: 2, D: 2, Q: 1, E: 1, I: 1, U: 3, L: 1 }, keywords: ["教育", "人生游戏", "大航海时代"] },
  { code: "misc-farm", name: "农场/庄园", tier: "tier2", category: "misc", narrative_ratio: "35-50%", needs: { W: 2, C: 3, S: 2, D: 3, Q: 3, E: 2, I: 2, U: 2, L: 1 }, keywords: ["农场", "庄园", "符文工房"] },
  { code: "misc-survivor", name: "吸血鬼幸存者-like", tier: "tier3", category: "misc", narrative_ratio: "10-20%", needs: { W: 1, C: 1, S: 1, D: 0, Q: 0, E: 1, I: 2, U: 2, L: 1 }, keywords: ["幸存者", "弹壳特攻队", "vampire survivors"] },

  // === T4 微叙事扩展（叙事卡预设升格品类，统一走 tpl-narrative-card 单步叙事卡）===
  // Puzzle 系
  { code: "puz-merge", name: "合成/2048", tier: "tier4", category: "puzzle", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["合成", "merge", "2048", "合并", "大西瓜"] },
  { code: "puz-connect", name: "连连看", tier: "tier4", category: "puzzle", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["连连看", "配对连线", "连线"] },
  { code: "puz-tetris", name: "俄罗斯方块", tier: "tier4", category: "puzzle", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["俄罗斯方块", "tetris", "方块消除"] },
  { code: "puz-bubble", name: "泡泡龙", tier: "tier4", category: "puzzle", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["泡泡龙", "泡泡射击", "泡泡"] },
  { code: "puz-word", name: "猜词/填字", tier: "tier4", category: "puzzle", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["猜词", "wordle", "填字", "成语"] },
  // Casual 系
  { code: "cas-runner", name: "跑酷", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["跑酷", "runner", "躲避", "flappy bird", "神庙逃亡"] },
  { code: "cas-snake", name: "贪食蛇", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["贪食蛇", "蛇", "吃变长"] },
  { code: "cas-stack", name: "堆叠/叠高高", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["堆叠", "叠高高", "平衡", "stack"] },
  { code: "cas-timing", name: "跳跃/接物", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["跳一跳", "跳跃", "接东西", "doodle jump"] },
  { code: "cas-sling", name: "弹弓/投掷", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["弹弓", "愤怒的小鸟", "投篮", "高尔夫"] },
  { code: "cas-fishing", name: "钓鱼/捕鱼", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["钓鱼", "捕鱼", "钓鱼大亨"] },
  { code: "cas-action", name: "切水果/打砖块", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["切水果", "飞刀", "打砖块"] },
  { code: "cas-spot", name: "找茬/找不同", tier: "tier4", category: "casual", narrative_ratio: "0-5%", needs: { W: 0, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 }, keywords: ["找茬", "找不同", "找隐藏", "大家来找茬"] },
];

/**
 * Per-genre pipeline template overrides (B2).
 * Only list entries that DON'T match the default-by-tier rule.
 * Default rule (see resolvePipelineTemplate): tier4 → tpl-narrative-card,
 * tier3 → tpl-light, tier2/tier1 → tpl-rpg.
 */
const GENRE_TEMPLATE_OVERRIDES: Record<string, PipelineTemplateId> = {
  // 互动影游主品类 → tpl-vn-v2 专属管线（E1+E2+G 9 步 + 三步借用）
  "adv-interactive":   "tpl-vn-v2",
  // 其余 VN 家族继续使用 tpl-vn（旧），可后续逐个迁移到 v2
  "adv-vn":            "tpl-vn",
  "adv-walking-sim":   "tpl-vn",
  "adv-text":          "tpl-vn",
  "adv-pointclick":    "tpl-vn",
  "adv-puzzle":        "tpl-vn",
  "adv-otome":         "tpl-vn",
  "adv-detective":     "tpl-vn",
  "adv-horror-vn":     "tpl-vn",
  "adv-raising":       "tpl-vn",
  "adv-life-sim":      "tpl-vn",
  "sim-dating":        "tpl-vn",
  "puz-narrative":     "tpl-vn",

  // 开放世界 RPG → tpl-open-world
  "rpg-open-world":    "tpl-open-world",

  // 卡牌家族 → tpl-card-game
  "card-ccg":          "tpl-card-game",
  "card-narrative":    "tpl-card-game",
  "card-dbg":          "tpl-card-game",
  "card-boardgame":    "tpl-card-game",

  // 碎片化叙事家族 → tpl-fragmented
  "rpg-soulslike":     "tpl-fragmented",
  "rpg-dungeon":       "tpl-fragmented",
  "act-metroidvania":  "tpl-fragmented",
  "act-2d-platformer": "tpl-fragmented",
  "hor-survival":      "tpl-fragmented",
  "hor-psychological": "tpl-fragmented",
  "hor-cosmic":        "tpl-fragmented",

  // 涌现叙事家族 → tpl-emergent
  "str-4x":            "tpl-emergent",
  "str-tbs":           "tpl-emergent",
  "str-grand":         "tpl-emergent",
  "sim-sandbox":       "tpl-emergent",
  "sim-survival":      "tpl-emergent",
  "sim-colony":        "tpl-emergent",
  "srv-open":          "tpl-emergent",
  "srv-craft":         "tpl-emergent",
  "srv-space":         "tpl-emergent",
  "srv-creative":      "tpl-emergent",

  // tier1 但更适合 light 的（解谜/侦探/线性已在 tpl-vn 处理；其余 tier1 默认走 tpl-rpg）
  // tier2 强叙事但是 RPG 思路 → 保持 tpl-rpg 默认
  // Phase-1：JRPG 走新架构朴素代号 tpl-jrpg（V1）；其余 RPG 暂仍走归档族 tpl-rpg(=tpl-jrpg-v2)
  "rpg-jrpg":          "tpl-jrpg",
  "rpg-crpg":          "tpl-rpg",
  "rpg-arpg":          "tpl-rpg",
  "rpg-mmorpg":        "tpl-rpg",
  "rpg-srpg":          "tpl-rpg",
  "rpg-gacha":         "tpl-rpg",
  "rpg-wuxia":         "tpl-rpg",
  "rpg-roguelike":     "tpl-rpg",
  "act-linear":        "tpl-rpg",
  "act-adventure":     "tpl-rpg",
  "act-character":     "tpl-rpg",
  "act-stealth":       "tpl-rpg",
  "act-survival":      "tpl-fragmented",
  "fps-story":         "tpl-rpg",
  "tps-adventure":     "tpl-rpg",
  "fps-looter":        "tpl-rpg",
  "act-immersive-sim": "tpl-rpg",
  "rpg-sandbox":       "tpl-rpg",
  "misc-pokemon":      "tpl-rpg",

  // tier3 显式走 light 而非默认（确保覆盖默认即可，多数 tier3 默认就是 light）
  // tier4 默认 narrative-card，无需覆盖
};

function resolvePipelineTemplate(code: string, tier: TierId): PipelineTemplateId {
  const explicit = GENRE_TEMPLATE_OVERRIDES[code];
  if (explicit) return explicit;
  // Default-by-tier
  switch (tier) {
    case "tier4": return "tpl-narrative-card";
    case "tier3": return "tpl-light";
    case "tier2": return "tpl-rpg";       // tier2 多数仍是 RPG 思路（动作/模拟）
    case "tier1": return "tpl-rpg";
  }
}

export const GENRE_TAXONOMY: GenreEntry[] = RAW_TAXONOMY.map((raw) => ({
  ...raw,
  narrative_type: getNarrativeType(raw.code),
  pipelineTemplate: resolvePipelineTemplate(raw.code, raw.tier),
  narrativePipeline: resolveNarrativePipeline(raw.code, raw.tier).id,
}));

/** A2-2: 根据 genre_code 精确查找品类条目；找不到返回 null */
export function findGenreByCode(code: string | null | undefined): GenreEntry | null {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  if (!normalized) return null;
  return GENRE_TAXONOMY.find((g) => g.code.toLowerCase() === normalized) ?? null;
}

/**
 * A2-1: 按二级品类大类（GenreCategory）分组返回 GENRE_TAXONOMY，供前端折叠面板使用。
 * 大类顺序与 GENRE_CATEGORIES 一致；同一大类内按 tier 升序、name 字典序排列。
 */
export function getGenresByCategory(locale: ContentLocale = "zh"): Array<{
  category: GenreCategory;
  label: string;
  genres: GenreEntry[];
}> {
  const buckets = new Map<GenreCategory, GenreEntry[]>();
  for (const cat of GENRE_CATEGORIES) buckets.set(cat, []);
  for (const g of GENRE_TAXONOMY) {
    const list = buckets.get(g.category);
    if (list) list.push(g);
  }
  return GENRE_CATEGORIES.map((category) => ({
    category,
    label: getCategoryLabel(category, locale),
    genres: (buckets.get(category) ?? []).slice().sort((a, b) => {
      const tierDiff = a.tier.localeCompare(b.tier);
      return tierDiff !== 0 ? tierDiff : a.name.localeCompare(b.name);
    }),
  })).filter((bucket) => bucket.genres.length > 0);
}

/** 根据关键词在用户输入中进行模糊匹配，返回最佳匹配的品类 */
export function matchGenre(userInput: string): GenreEntry | null {
  const lower = userInput.toLowerCase();
  let best: GenreEntry | null = null;
  let bestScore = 0;

  for (const entry of GENRE_TAXONOMY) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return best;
}
