/**
 * 品类 × 系统 优先级矩阵。
 * 从 GameTypeSystemGuide.md 的"系统优先级总览表"提取为结构化数据。
 * 3=必须(⭐⭐⭐), 2=推荐(⭐⭐), 1=可选(⭐), 0=不需要(➖)
 */

export type SystemPriority = 0 | 1 | 2 | 3;

export const SYSTEM_IDS = [
  "entity", "input", "scene", "event", "save",
  "stats", "combat", "skill", "buff", "ai",
  "inventory", "equipment", "economy", "shop", "crafting",
  "loot", "leveling", "skill_tree", "achievement", "collection",
  "reputation", "stage", "quest", "dialogue", "story",
  "map", "time_weather", "interaction", "building",
  "social_friend", "social_guild", "social_chat",
  "leaderboard", "matchmaking", "card", "pet", "vehicle",
  "roguelike", "tower_defense", "wave", "turn_based",
  "ui_interaction", "ui_feedback", "tutorial",
  "audio", "camera", "particle", "animation",
] as const;

export type SystemId = typeof SYSTEM_IDS[number];

export interface SystemPriorityRow {
  system: SystemId;
  label: string;
  priorities: Record<string, SystemPriority>;
}

const GENRE_COLS = [
  "RPG", "ARPG", "MMO", "ACT", "FTG", "FPS", "RTS", "SRPG", "AVG",
  "SIM", "SURV", "ROGUE", "TD", "CARD", "CASUAL", "PLAT", "RACE", "RHYTHM",
  "OPEN", "PET", "MOBA", "SURVIVOR",
] as const;

type GenreCol = typeof GENRE_COLS[number];

const GENRE_COL_TO_CODES: Record<GenreCol, string[]> = {
  RPG:      ["rpg-jrpg", "rpg-wuxia"],
  ARPG:     ["rpg-arpg", "rpg-soulslike", "rpg-dungeon"],
  MMO:      ["rpg-mmorpg"],
  ACT:      ["act-linear", "act-adventure", "act-character", "act-stealth", "act-survival", "act-beatup"],
  FTG:      ["fgt-traditional", "fgt-platform", "fgt-weapon", "fgt-anime"],
  FPS:      ["fps-story", "fps-tactical", "fps-br", "fps-hero", "tps-adventure", "fps-looter"],
  RTS:      ["str-rts", "str-4x", "str-tbs"],
  SRPG:     ["rpg-srpg", "str-tactics", "str-slg"],
  AVG:      ["adv-vn", "adv-interactive", "adv-text", "adv-otome", "adv-detective", "adv-pointclick", "adv-puzzle", "adv-walking-sim", "adv-horror", "sim-dating"],
  SIM:      ["sim-tycoon", "sim-life", "sim-social", "sim-raising", "sim-creature", "misc-farm", "misc-edu"],
  SURV:     ["sim-survival", "srv-open", "srv-craft", "srv-space", "srv-creative", "act-survival"],
  ROGUE:    ["rpg-roguelike"],
  TD:       ["str-td"],
  CARD:     ["card-ccg", "card-dbg", "card-narrative", "card-boardgame"],
  CASUAL:   ["cas-hyper", "cas-io", "cas-idle", "cas-party", "cas-puzzle", "puz-pure", "puz-physics", "puz-match"],
  PLAT:     ["act-2d-platformer", "act-metroidvania"],
  RACE:     ["race-sim", "race-kart", "spt-sim", "spt-extreme", "spt-fighting"],
  RHYTHM:   ["rhy-pure", "rhy-narrative", "rhy-idol", "rhy-action"],
  OPEN:     ["rpg-open-world"],
  PET:      ["misc-pokemon"],
  MOBA:     ["str-moba"],
  SURVIVOR: ["misc-survivor"],
};

// Each row: [system_id, label, RPG, ARPG, MMO, ACT, FTG, FPS, RTS, SRPG, AVG, SIM, SURV, ROGUE, TD, CARD, CASUAL, PLAT, RACE, RHYTHM, OPEN, PET, MOBA, SURVIVOR]
const RAW: [string, string, ...SystemPriority[]][] = [
  // system_id, label, then 22 genre columns
  ["entity",          "实体系统",   3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],
  ["input",           "输入系统",   3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],
  ["scene",           "场景系统",   3,3,3,3,2,3,3,3,3,3,3,3,3,2,3,3,3,3,3,3,2,2],
  ["event",           "事件系统",   3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],
  ["save",            "存档系统",   3,3,3,2,2,1,2,2,3,3,3,2,2,2,2,2,2,2,3,3,0,2],
  ["stats",           "属性系统",   3,3,3,2,2,2,2,3,0,0,3,3,3,3,0,1,0,0,2,3,3,3],
  ["combat",          "战斗系统",   3,3,3,3,3,3,2,3,0,0,2,3,3,0,0,1,0,0,2,3,3,3],
  ["skill",           "技能系统",   2,3,3,3,2,0,2,2,0,0,0,2,1,0,0,1,0,0,2,2,3,2],
  ["buff",            "Buff系统",   2,3,3,2,2,1,0,2,0,0,0,2,2,3,0,0,0,0,2,2,3,2],
  ["ai",              "AI系统",     2,2,2,3,2,2,3,3,0,2,2,2,3,2,0,0,2,0,2,2,3,2],
  ["inventory",       "背包系统",   3,3,3,1,0,2,0,2,1,1,3,1,0,0,2,1,0,0,2,2,0,0],
  ["equipment",       "装备系统",   3,3,3,1,0,2,0,2,0,0,2,1,0,0,0,0,0,0,2,0,2,0],
  ["economy",         "经济系统",   2,2,2,0,0,1,3,1,0,3,1,0,3,2,2,0,1,1,2,1,2,0],
  ["shop",            "商店系统",   2,2,2,0,0,1,0,1,0,2,1,2,1,2,2,0,1,1,2,1,2,1],
  ["crafting",        "制作系统",   1,1,1,0,0,0,0,0,0,2,3,0,0,0,0,0,0,0,1,0,0,0],
  ["loot",            "掉落系统",   1,3,2,1,0,0,0,0,0,0,2,3,0,0,0,0,0,0,1,0,0,3],
  ["leveling",        "等级系统",   3,2,3,1,0,0,0,2,0,0,0,1,0,0,0,0,0,0,1,2,0,3],
  ["skill_tree",      "技能树系统", 2,2,2,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
  ["achievement",     "成就系统",   1,1,2,1,1,1,1,1,2,2,1,2,2,2,2,2,2,2,1,1,1,2],
  ["collection",      "收集系统",   1,1,1,0,1,0,0,0,2,1,0,2,1,2,1,2,1,2,1,3,1,2],
  ["reputation",      "声望系统",   0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
  ["stage",           "关卡系统",   0,0,0,2,0,0,0,2,0,0,0,1,2,0,3,2,2,3,0,0,0,1],
  ["quest",           "任务系统",   3,1,3,0,0,0,0,2,1,2,1,0,0,1,1,0,0,0,3,2,1,0],
  ["dialogue",        "对话系统",   3,1,2,0,0,0,0,1,3,1,0,0,0,0,0,0,0,0,2,2,0,0],
  ["story",           "剧情系统",   2,1,0,0,1,0,1,2,3,0,0,0,0,0,0,0,0,0,2,0,0,0],
  ["map",             "地图系统",   2,1,2,0,0,2,3,2,1,0,2,1,2,0,0,1,0,0,3,2,3,0],
  ["time_weather",    "时间天气",   0,0,1,0,0,0,0,0,0,3,2,0,0,0,1,0,1,0,2,0,0,0],
  ["interaction",     "交互系统",   2,1,2,0,0,0,0,0,1,1,2,0,0,0,0,2,0,0,3,1,0,0],
  ["building",        "建造系统",   0,0,0,0,0,0,3,0,0,3,3,0,0,0,0,0,0,0,1,0,0,0],
  ["social_friend",   "好友系统",   0,0,3,0,0,1,0,0,0,0,1,0,0,1,2,0,1,1,0,1,2,0],
  ["social_guild",    "公会系统",   0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ["social_chat",     "聊天系统",   0,0,3,0,0,1,0,0,0,0,1,0,0,1,0,0,0,0,0,0,2,0],
  ["leaderboard",     "排行榜",     0,0,2,0,2,2,2,0,0,0,0,0,0,2,2,0,2,2,0,0,2,0],
  ["matchmaking",     "匹配系统",   0,0,2,0,2,2,2,0,0,0,0,0,0,2,0,0,2,1,0,1,3,0],
  ["card",            "卡牌系统",   0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0],
  ["pet",             "宠物系统",   0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0],
  ["vehicle",         "载具系统",   0,0,1,0,0,1,0,0,0,0,1,0,0,0,0,0,3,0,2,0,0,0],
  ["roguelike",       "Roguelike",  0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,3],
  ["tower_defense",   "塔防系统",   0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0],
  ["wave",            "波次系统",   0,0,0,0,0,0,0,0,0,0,1,1,3,0,0,0,0,0,0,0,0,3],
  ["turn_based",      "回合制系统", 2,0,0,0,0,0,0,3,0,0,0,0,0,3,0,0,0,0,0,2,0,0],
  ["ui_interaction",  "UI交互系统", 2,2,3,2,2,2,3,2,3,3,2,2,2,3,2,1,2,2,2,2,2,2],
  ["ui_feedback",     "UI反馈系统", 2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
  ["tutorial",        "教程系统",   1,1,2,1,1,1,1,1,1,2,1,1,2,1,2,1,1,1,1,1,1,1],
  ["audio",           "音频系统",   2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,3,2,2,2,2],
  ["camera",          "相机系统",   2,2,2,3,2,3,3,2,1,2,2,2,2,1,1,3,3,1,2,2,2,2],
  ["particle",        "粒子系统",   1,2,2,2,1,2,1,1,0,1,1,2,1,1,1,1,2,2,2,1,2,2],
  ["animation",       "动画系统",   2,2,2,3,3,2,1,2,2,1,1,2,1,2,2,3,1,2,2,2,2,2],
];

const MATRIX: SystemPriorityRow[] = RAW.map(([sys, label, ...prios]) => {
  const priorities: Record<string, SystemPriority> = {};
  GENRE_COLS.forEach((col, i) => {
    priorities[col] = prios[i] as SystemPriority;
  });
  return { system: sys as SystemId, label, priorities };
});

function findGenreCol(genreCode: string): GenreCol | null {
  for (const [col, codes] of Object.entries(GENRE_COL_TO_CODES)) {
    if (codes.includes(genreCode)) return col as GenreCol;
  }
  return null;
}

export interface SystemRequirement {
  id: SystemId;
  label: string;
  priority: SystemPriority;
}

/**
 * 根据品类代码获取所有系统及其优先级，按优先级降序排列。
 */
export function getSystemsForGenre(genreCode: string): SystemRequirement[] {
  const col = findGenreCol(genreCode);
  if (!col) return MATRIX.map((r) => ({ id: r.system, label: r.label, priority: 1 as SystemPriority }));
  return MATRIX
    .map((r) => ({ id: r.system, label: r.label, priority: r.priorities[col] }))
    .sort((a, b) => b.priority - a.priority);
}

/**
 * 获取必须(3)和推荐(2)的系统列表。
 */
export function getRequiredAndRecommended(genreCode: string): {
  required: SystemRequirement[];
  recommended: SystemRequirement[];
} {
  const all = getSystemsForGenre(genreCode);
  return {
    required: all.filter((s) => s.priority === 3),
    recommended: all.filter((s) => s.priority === 2),
  };
}
