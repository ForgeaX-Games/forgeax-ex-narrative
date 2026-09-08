/**
 * skill-loader.ts (C4)
 * ─────────────────────────────────────────────────────────────────
 * Skill 解析入口。
 *
 *   loadSkill(genreCode)              → 该品类的完整 NarrativeSkill 或 null
 *   getStepSkill(genreCode, stepId)   → 该品类在某个 step 的内容片段或 null
 *
 * 加载源（按优先级递减）：
 *   1. SKILL_REGISTRY（运行时注册的 ts 索引，由 build-skills.ts 生成或手写）
 *   2. md global / specialist fallback（品类 md 知识 + 题材风格专家）
 *   3. archetype shared baseline（原型族共享 md，7 原型覆盖全品类）
 *   4. null — 走 baseline prompt
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NarrativeSkill, StepSkillBlock, SkillLookupResult } from "./skill-types.js";
import { getMdSkillBlock } from "./md-skill-loader.js";
import { findGenreByCode } from "../genre-taxonomy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 全局 skill 注册表。
 * 由 ts 索引文件（如 tier1/jrpg.skill.ts）在 import 时调用 registerSkill 填充。
 */
const SKILL_REGISTRY = new Map<string, NarrativeSkill>();

/**
 * 关键词到 genreCode 的反向索引，用于按用户输入文本回查品类。
 */
const KEYWORD_INDEX = new Map<string, string>();

/* ─── Archetype 原型族映射 ──────────────────────────────────────────── */

// 6 原型族（生产范式）：epic / branching / fragmented / emergent / lightweight / micro。
type ArchetypeName = "epic" | "branching" | "fragmented" | "emergent" | "lightweight" | "micro";

/**
 * pipelineTemplate → archetype 直接映射。
 * 覆盖大部分品类；未命中的走 category + tier 规则。
 */
const TEMPLATE_ARCHETYPE_MAP: Partial<Record<string, ArchetypeName>> = {
  // JRPG 三个代号同族：tpl-jrpg(V1) / tpl-jrpg-v2(V2) / tpl-rpg(v2 别名)。
  "tpl-jrpg":           "epic",
  "tpl-jrpg-v2":        "epic",
  "tpl-rpg":            "epic",
  "tpl-open-world":     "epic",
  "tpl-vn":             "branching",
  "tpl-vn-v2":          "branching",
  "tpl-fragmented":     "fragmented",
  "tpl-emergent":       "emergent",
  // 卡牌专属链：narrativeSteps 走 tpl-card-game 自有链；prompt 基线取碎片族（卡牌 Lore≈碎片）。
  "tpl-card-game":      "fragmented",
  "tpl-narrative-card": "micro",
};

/**
 * 根据 genreCode 推断所属原型族。
 * 优先查 pipelineTemplate 映射，未命中则用 category + tier 回退规则。
 */
export function getArchetypeForGenre(genreCode: string): ArchetypeName | null {
  const entry = findGenreByCode(genreCode);
  if (!entry) return null;

  const fromTemplate = TEMPLATE_ARCHETYPE_MAP[entry.pipelineTemplate];
  if (fromTemplate) return fromTemplate;

  if (entry.category === "survival") return "emergent";
  if (entry.category === "simulation" && entry.tier !== "tier4") return "emergent";
  if (entry.tier === "tier4") return "micro";
  // 兜底统一归入轻量族（点缀级叙事基线），不再有独立 operational 原型。
  return "lightweight";
}

/** archetype md 内容缓存（启动期按需加载，不重复读磁盘）。 */
const ARCHETYPE_CACHE = new Map<string, string | null>();

/**
 * 读取 archetype-shared/{name}.md，缓存结果。
 * 文件不存在或为空时返回 null（不抛异常）。
 */
function loadArchetypeContent(archetypeName: string): string | null {
  if (ARCHETYPE_CACHE.has(archetypeName)) return ARCHETYPE_CACHE.get(archetypeName)!;

  const absPath = path.resolve(__dirname, "skills", "archetype-shared", `${archetypeName}.md`);
  let content: string | null = null;
  try {
    const raw = fs.readFileSync(absPath, "utf-8");
    content = raw.trim() || null;
  } catch {
    content = null;
  }

  ARCHETYPE_CACHE.set(archetypeName, content);
  return content;
}

/**
 * 将 archetype md 内容包装为 StepSkillBlock。
 * 返回 null 表示该 archetype 无可用内容。
 */
export function loadArchetypeSkill(archetypeName: string): StepSkillBlock | null {
  const content = loadArchetypeContent(archetypeName);
  if (!content) return null;
  return { systemPromptAddition: content };
}

/* ─── 注册 / 查询 ──────────────────────────────────────────────────── */

export function registerSkill(skill: NarrativeSkill): void {
  SKILL_REGISTRY.set(skill.genreCode, skill);
  for (const kw of skill.matchKeywords ?? []) {
    KEYWORD_INDEX.set(kw.toLowerCase(), skill.genreCode);
  }
}

export function loadSkill(genreCode: string | undefined | null): NarrativeSkill | null {
  if (!genreCode) return null;
  return SKILL_REGISTRY.get(genreCode) ?? null;
}

/**
 * 查找 (genreCode, stepId) 对应的 skill 块。
 *
 * 优先级（四级回退链）：
 *   1. ts skill 的 stepSkills[stepId]        — 精确匹配，作者维护，最高优先级
 *   2. md global / specialist fallback       — 全局 step 知识 + 题材风格专家拼合
 *   3. archetype shared baseline             — 原型族共享 md（7 原型覆盖全品类）
 *   4. null                                    — 走 baseline prompt
 *
 * 各层互斥：高优先级命中即返回，不与低层合并。
 */
export function getStepSkill(
  genreCode: string | undefined | null,
  stepId: string,
): SkillLookupResult {
  // Layer 1: ts skill registry
  const skill = loadSkill(genreCode);
  if (skill) {
    const block = skill.stepSkills[stepId];
    if (block && hasContent(block)) return block;
  }

  // Layer 2: md global / specialist fallback
  const entry = findGenreByCode(genreCode);
  const mdBlock = getMdSkillBlock(genreCode, stepId, entry?.keywords);
  if (mdBlock) return mdBlock;

  // Layer 3: archetype shared baseline
  if (genreCode) {
    const archetype = getArchetypeForGenre(genreCode);
    if (archetype) return loadArchetypeSkill(archetype);
  }

  // Layer 4: no injection
  return null;
}

function hasContent(block: StepSkillBlock): boolean {
  if (block.systemPromptAddition && block.systemPromptAddition.trim()) return true;
  if (block.slots) {
    for (const v of Object.values(block.slots)) {
      if (typeof v === "string" && v.trim()) return true;
    }
  }
  return false;
}

/**
 * 列出所有已注册的 skill（调试/UI 用）。
 */
export function listRegisteredSkills(): NarrativeSkill[] {
  return Array.from(SKILL_REGISTRY.values());
}

/**
 * 关键词回查：根据用户输入文本找到最匹配的 genreCode。
 * 仅在路由层 / fallback 路径使用；正常路径应通过 ctx.demand_analysis.genre_code 获取。
 */
export function matchSkillByKeyword(userInput: string): string | null {
  const lower = userInput.toLowerCase();
  let best: string | null = null;
  let bestLen = 0;
  for (const [kw, code] of KEYWORD_INDEX) {
    if (lower.includes(kw) && kw.length > bestLen) {
      best = code;
      bestLen = kw.length;
    }
  }
  return best;
}

/**
 * 把一个 StepSkillBlock 拼成可直接接到 system prompt 末尾的字符串（方案 A 形态）。
 * 优先用 systemPromptAddition；如果只有 slots，用约定格式拼接。
 */
export function renderStepSkillForSystemPrompt(block: StepSkillBlock | null): string {
  if (!block) return "";
  if (block.systemPromptAddition) return block.systemPromptAddition;
  if (!block.slots) return "";
  const parts: string[] = [];
  if (block.slots.style_guide) parts.push(`## 品类风格指南\n${block.slots.style_guide}`);
  if (block.slots.worldview_archetype) parts.push(`## 世界观原型\n${block.slots.worldview_archetype}`);
  if (block.slots.character_archetype) parts.push(`## 角色原型\n${block.slots.character_archetype}`);
  if (block.slots.examples) parts.push(`## 示例参考\n${block.slots.examples}`);
  if (block.slots.constraints) parts.push(`## 硬性约束\n${block.slots.constraints}`);
  for (const [k, v] of Object.entries(block.slots)) {
    if (!v) continue;
    if (["style_guide", "worldview_archetype", "character_archetype", "examples", "constraints"].includes(k)) continue;
    parts.push(`## ${k}\n${v}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "";
}
