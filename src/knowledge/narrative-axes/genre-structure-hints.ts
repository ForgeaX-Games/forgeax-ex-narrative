import type { StoryStructureCode } from "./story-structures.js";
import { getNarrativeType } from "../genre-narrative-type.js";
import type { NarrativeType } from "../genre-narrative-type.js";

/**
 * 游戏品类 → 叙事结构倾向。
 *
 * 数据源：产品侧叙事策划专家组配置表的「叙事结构」列，
 * 按专家名逐条对到 genre-taxonomy 的 code 上。第一项为该品类的首选结构。
 *
 * 这是三轴里唯一已定稿的结构倾向 —— 叙事类型与叙事题材两轴的对应列在表里还是空的，
 * 所以现阶段结构综合几乎总是由品类单轴决定（见 resolve-structure.ts）。
 */
export const GENRE_STRUCTURE_HINTS: Readonly<Record<string, readonly StoryStructureCode[]>> = {
  // RPG
  "rpg-open-world": ["multiline", "multi-pov", "tree", "hybrid"],
  "rpg-jrpg": ["linear", "tree"],
  "rpg-crpg": ["linear", "tree"],
  "rpg-wuxia": ["linear", "tree"],
  "rpg-srpg": ["linear"],
  "rpg-gacha": ["linear"],
  "rpg-arpg": ["fragmented", "hybrid"],
  "rpg-mmorpg": ["linear"],
  "rpg-sandbox": ["emergent"],
  "rpg-dungeon": ["fragmented", "hybrid"],
  "rpg-roguelike": ["fragmented", "hybrid"],
  "rpg-soulslike": ["hybrid"],
  "rpg-idle": ["fragmented"],

  // 动作
  "act-linear": ["linear"],
  "act-immersive-sim": ["linear"],
  "act-adventure": ["linear"],
  "act-stealth": ["linear"],
  "act-character": ["linear"],
  "act-2d-platformer": ["fragmented", "hybrid"],
  "act-metroidvania": ["fragmented", "hybrid"],
  "act-survival": ["fragmented", "hybrid"],
  "act-beatup": ["fragmented"],
  "act-musou": ["fragmented"],

  // 冒险
  "adv-text": ["tree"],
  "adv-otome": ["tree"],
  "adv-interactive": ["tree"],
  "adv-horror-vn": ["tree"],
  "adv-vn": ["tree"],
  "adv-detective": ["tree"],
  "adv-pointclick": ["tree"],
  "adv-puzzle": ["tree"],
  "adv-life-sim": ["tree"],
  "adv-raising": ["tree"],
  "adv-walking-sim": ["fragmented", "hybrid"],
  "adv-horror": ["fragmented", "hybrid"],

  // 模拟
  "sim-dating": ["tree"],
  "sim-raising": ["emergent"],
  "sim-life": ["emergent"],
  "sim-social": ["emergent"],
  "sim-colony": ["emergent"],
  "sim-survival": ["emergent"],
  "sim-tycoon": ["emergent"],
  "sim-creature": ["emergent"],
  "sim-sandbox": ["fragmented"],

  // 射击
  "fps-story": ["linear"],
  "tps-adventure": ["linear"],
  "fps-tactical": ["linear"],
  "fps-looter": ["fragmented", "hybrid"],
  "fps-extraction": ["fragmented"],
  "fps-hero": ["fragmented"],
  "fps-br": ["fragmented"],
  "stg-bullet": ["fragmented"],

  // 解谜
  "puz-narrative": ["linear"],
  "puz-escape": ["linear"],
  "puz-physics": ["fragmented"],
  "puz-pure": ["fragmented"],
  "puz-tetris": ["fragmented"],
  "puz-merge": ["fragmented"],
  "puz-bubble": ["fragmented"],
  "puz-match": ["fragmented"],
  "puz-word": ["fragmented"],
  "puz-connect": ["fragmented"],

  // 卡牌
  "card-narrative": ["tree"],
  "card-dbg": ["fragmented"],
  "card-ccg": ["fragmented"],
  "card-boardgame": ["fragmented"],

  // 恐怖
  "hor-psychological": ["tree"],
  "hor-cosmic": ["fragmented", "hybrid"],
  "hor-survival": ["fragmented", "hybrid"],
  "hor-chase": ["fragmented", "hybrid"],
  "hor-coop": ["fragmented"],

  // 策略
  "str-tactics": ["linear"],
  "str-tbs": ["emergent"],
  "str-slg": ["emergent"],
  "str-4x": ["emergent"],
  "str-grand": ["emergent"],
  "str-rts": ["fragmented"],
  "str-td": ["fragmented"],
  "str-moba": ["fragmented"],
  "str-autobattle": ["fragmented"],

  // 体育 / 竞速
  "spt-mgmt": ["emergent"],
  "spt-sim": ["fragmented"],
  "spt-fighting": ["fragmented"],
  "spt-extreme": ["fragmented"],
  "race-sim": ["fragmented"],
  "race-kart": ["fragmented"],

  // 音游
  "rhy-narrative": ["linear"],
  "rhy-idol": ["linear"],
  "rhy-action": ["linear"],
  "rhy-pure": ["fragmented"],

  // 生存
  "srv-space": ["emergent"],
  "srv-open": ["emergent"],
  "srv-craft": ["emergent"],
  "srv-creative": ["emergent"],

  // 格斗
  "fgt-weapon": ["fragmented"],
  "fgt-traditional": ["fragmented"],
  "fgt-anime": ["fragmented"],
  "fgt-platform": ["fragmented"],

  // 休闲
  "cas-cozy": ["fragmented"],
  "cas-puzzle": ["fragmented"],
  "cas-idle": ["fragmented"],
  "cas-party": ["fragmented"],
  "cas-io": ["fragmented"],
  "cas-action": ["fragmented"],
  "cas-stack": ["fragmented"],
  "cas-sling": ["fragmented"],
  "cas-spot": ["fragmented"],
  "cas-snake": ["fragmented"],
  "cas-runner": ["fragmented"],
  "cas-timing": ["fragmented"],
  "cas-fishing": ["fragmented"],
  "cas-hyper": ["fragmented"],

  // 其他
  "misc-farm": ["emergent"],
  "misc-pokemon": ["emergent"],
  "misc-edu": ["fragmented"],
  "misc-survivor": ["fragmented"],
  "misc-pinball": ["fragmented"],
};

/** 表里查不到时按管线形态族兜底，保证函数是全函数。 */
const BY_NARRATIVE_TYPE: Readonly<Record<NarrativeType, readonly StoryStructureCode[]>> = {
  linear: ["linear"],
  branching: ["tree"],
  fragmented: ["fragmented", "hybrid"],
  emergent: ["emergent"],
  minimal: ["fragmented"],
};

export function getGenreStructureHints(
  genreCode: string | null | undefined,
): readonly StoryStructureCode[] {
  if (!genreCode) return [];
  const explicit = GENRE_STRUCTURE_HINTS[genreCode];
  if (explicit) return explicit;
  return BY_NARRATIVE_TYPE[getNarrativeType(genreCode)];
}
