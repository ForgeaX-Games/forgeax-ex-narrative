/**
 * 叙事四轴词表（PRD v1.4 §3.2.2）。
 *
 *   游戏品类  genre      —— 由所选叙事策划专家隐式确定，词表在 ../genre-taxonomy.ts
 *   叙事类型  storyType  —— 故事怎么跑（结构维度），13 项
 *   叙事题材  storyTheme —— 故事跑什么（内容维度），19 项
 *   叙事结构  structure  —— 由上述三轴综合推导，12 项，非用户直选、非 agent
 *
 * 四轴各自对应提示词骨架 strategy 槽下的一个子槽，策略卡正文放在 knowledge/strategy/ 下
 * 按约定目录加载（见 strategy-loader.ts）；本目录只负责词表、结构倾向与综合规则。
 */

export {
  STORY_TYPE_CODES,
  STORY_TYPES,
  getStoryType,
  isStoryTypeCode,
} from "./story-types.js";
export type { StoryTypeCode, StoryTypeEntry } from "./story-types.js";

export {
  STORY_THEME_CODES,
  STORY_THEMES,
  getStoryTheme,
  isStoryThemeCode,
} from "./story-themes.js";
export type { StoryThemeCode, StoryThemeEntry } from "./story-themes.js";

export {
  STORY_STRUCTURE_CODES,
  STORY_STRUCTURES,
  getStoryStructure,
  isStoryStructureCode,
} from "./story-structures.js";
export type {
  StoryStructureCode,
  StoryStructureEntry,
  StrategyStage,
} from "./story-structures.js";

export { GENRE_STRUCTURE_HINTS, getGenreStructureHints } from "./genre-structure-hints.js";

export { resolveNarrativeStructure, STRUCTURE_VOTING_AXES } from "./resolve-structure.js";
export type {
  ResolveStructureInput,
  ResolvedStructure,
  StructureVotingAxis,
} from "./resolve-structure.js";

/** 策略卡的四个轴，顺序即提示词 strategy 槽下四个子槽的装配顺序。 */
export const STRATEGY_AXES = ["genre", "type", "theme", "structure"] as const;
export type StrategyAxis = (typeof STRATEGY_AXES)[number];

export const STRATEGY_AXIS_LABELS: Readonly<Record<StrategyAxis, string>> = {
  genre: "游戏品类叙事策略",
  type: "叙事类型策略",
  theme: "叙事题材策略",
  structure: "叙事结构策略",
};
