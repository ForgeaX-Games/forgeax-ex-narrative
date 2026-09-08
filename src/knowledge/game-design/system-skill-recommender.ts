/**
 * system-skill-recommender.ts (B-M6 / D13-B)
 * ─────────────────────────────────────────────────────────────────
 * 按品类推荐应注入到策划 prompt 的 *System Skill 摘要*。
 *
 * D1 (system_architecture)：注入"该品类必跑/推荐"的所有系统摘要，
 *   帮助 LLM 在设计架构时不漏掉关键系统模块。
 * D3 (value_framework)：从该品类的系统中挑出与"经济/成长/数值"相关的子集，
 *   注入摘要帮助 LLM 设计平衡曲线。
 *
 * 与 D2 (system_detail) 的区别：D2 给单个系统注入摘要（聚焦），
 * D1/D3 给"系统组合"注入摘要（鸟瞰）。
 */

import { getRequiredAndRecommended } from "./system-matrix.js";
import { formatSkillSummaries } from "./system-skill-registry.js";

/**
 * D1：推荐 architecture 阶段需要参考的系统 ID 列表。
 *
 * 策略：取该品类所有 required + recommended 系统，限制 ≤ 14 个（避免 prompt 爆炸）。
 * 缺省时返回空数组（不破坏现有 prompt）。
 */
export function recommendSystemsForArchitecture(genreCode: string): string[] {
  const { required, recommended } = getRequiredAndRecommended(genreCode);
  const ids = [...required.map((s) => s.id), ...recommended.map((s) => s.id)];
  return ids.slice(0, 14);
}

/**
 * D3：推荐 value_framework 阶段需要参考的"数值/经济/成长"相关系统 ID。
 *
 * 策略：在 architecture 推荐结果中过滤出 VALUE_RELATED_SYSTEMS 的子集。
 * 这样能保持"品类驱动"的特征 — 例如三消游戏不会硬塞 equipment 进 prompt。
 */
const VALUE_RELATED_SYSTEMS: ReadonlySet<string> = new Set([
  "stats",
  "combat",
  "leveling",
  "skill_tree",
  "equipment",
  "inventory",
  "economy",
  "shop",
  "crafting",
  "loot",
  "achievement",
  "collection",
  "reputation",
  "stage",
  "wave",
  "tower_defense",
  "turn_based",
  "card",
  "pet",
  "roguelike",
]);

export function recommendValueSystemsForGenre(genreCode: string): string[] {
  const archIds = recommendSystemsForArchitecture(genreCode);
  return archIds.filter((id) => VALUE_RELATED_SYSTEMS.has(id));
}

/**
 * Prompt-ready 文本：D1 用。
 * 当品类无任何 required/recommended 系统时返回空串（caller 自行 fallback）。
 */
export function buildArchitectureSkillSummary(genreCode: string): string {
  const ids = recommendSystemsForArchitecture(genreCode);
  if (ids.length === 0) return "";
  return formatSkillSummaries(ids);
}

/**
 * Prompt-ready 文本：D3 用。
 */
export function buildValueSkillSummary(genreCode: string): string {
  const ids = recommendValueSystemsForGenre(genreCode);
  if (ids.length === 0) return "";
  return formatSkillSummaries(ids);
}
