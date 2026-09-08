/**
 * Tier1 skill registry — auto-imported by skill-bootstrap.ts.
 * Each export here triggers the registerSkill side-effect.
 */
export * from "./rpg-jrpg/index.js";
export * from "./visual-novel.skill.js";
export * from "./interactive-drama.skill.js";
export * from "./arpg.skill.js";
export * from "./open-world.skill.js";
export * from "./detective.skill.js";
export * from "./immersive-sim.skill.js";
export * from "./mid-genres.skill.js";
// Phase 4A 史诗叙事型品类叙事包（在 mid-genres stub 之后导入，确保覆盖生效）
export * from "./rpg-crpg/index.js";
export * from "./rpg-wuxia/index.js";
export * from "./act-linear/index.js";
export * from "./fps-story/index.js";
// Phase 4B 分支叙事型品类叙事包（adv-otome 覆盖 mid-genres stub）
export * from "./adv-text/index.js";
export * from "./adv-otome/index.js";
export * from "./adv-pointclick/index.js";
export * from "./adv-puzzle/index.js";
export * from "./sim-dating/index.js";
export * from "./puz-narrative/index.js";
export * from "./hor-psychological/index.js";
// Phase 4C 碎片叙事型品类叙事包（tier1）
export * from "./adv-walking-sim/index.js";
// Phase 5 长尾补全（tier1 分支叙事）
export * from "./adv-horror-vn/index.js";
