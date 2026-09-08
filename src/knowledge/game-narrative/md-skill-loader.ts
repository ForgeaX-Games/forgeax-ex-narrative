/**
 * md-skill-loader.ts  (B-M1)
 * ─────────────────────────────────────────────────────────────────
 * 把 skills/ 目录下的 .md 文件作为 NarrativeSkill 的 fallback 数据源。
 *
 * 现状（"被忽略的金矿"）：
 *   - 生产读取两处源库：全局 step 提示词来自 narrative-USC/skills/{prompts,lab_prompts,
 *     production_prompts}/*.md（GLOBAL_FILES）；题材风格 specialist 来自
 *     narrative-studio/assets/prompts/specialists/specialist_*.md（SPECIALISTS）。
 *     （P2.2 已收敛：删除 narrative-USC 下与 studio 重复的 specialists/；归档删除未加载的 narrative-lab。）
 *   - skill-loader 之前只读 .ts 索引，所有 md 都是空架子
 *   - 80+ long-tail 品类没有 ts skill，导致 buildSkillSystemPrompt 注入率为 0
 *
 * M1 目标（最小可行）：
 *   1. 启动时同步扫描 P0 优先级 md 文件，构建按 stepId 索引的全局 skill 表
 *   2. 同步加载题材风格专家（specialist_*.md），按关键词建立反向索引
 *   3. 暴露 getMdSkillBlock(genreCode, stepId) → 当 ts skill 未命中时返回合成 StepSkillBlock
 *   4. 不破坏现有 ts skill 的优先级（ts 命中即返回，md 仅作 fallback）
 *
 * 加载策略：
 *   - 同步 fs（启动期一次性，缓存到内存）
 *   - 跳过 frontmatter 头部（--- ... ---），保留 markdown 正文作为 prompt 内容
 *   - 文件丢失/解析失败不抛异常，返回空字符串走原 baseline 路径
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StepSkillBlock } from "./skill-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * P0 全局 skill 注入表 — 按 stepId 映射 md 文件路径（相对 skills/ 目录）。
 * 同一 step 可关联多个 md，按数组顺序拼接。
 */
const STEP_TO_MD_GLOBAL: Record<string, string[]> = {
  worldview: [
    "narrative-USC/skills/prompts/world_skill.md",
  ],
  character_enrichment: [
    "narrative-USC/skills/prompts/character_skill.md",
  ],
  initial_plan: [
    "narrative-USC/skills/prompts/premise_skill.md",
    "narrative-USC/skills/lab_prompts/narrative_setup_architect.md",
  ],
  story_framework: [
    "narrative-USC/skills/lab_prompts/narrative_sequence_architect.md",
  ],
  script_generation: [
    "narrative-USC/skills/production_prompts/cinematic_director.md",
    "narrative-USC/skills/production_prompts/dialogue_system_architect.md",
  ],
  quest_generation: [
    "narrative-USC/skills/lab_prompts/mission_designer_skill.md",
  ],
  scene_plan: [
    "narrative-USC/skills/prompts/narrative_space_designer.md",
  ],
  // 策划侧 D0-D4 注入：D13-A 的前置铺垫，先把 GDD 生成器接到 design_doc
  design_doc: [
    "narrative-USC/skills/lab_prompts/gdd_generator_skill.md",
  ],
};

/**
 * 题材风格专家 — 按关键词反向匹配品类（M1 内置 P0 列表）。
 * 当某品类的 ts skill 未提供 worldview/story_framework 的 style_guide 时，
 * 取最佳匹配 specialist 的 md 内容补到 systemPromptAddition。
 */
interface SpecialistMatcher {
  file: string;
  /** 关键词命中 genre.code 或 genre.keywords 中任意一项即匹配 */
  keywords: string[];
  /** 该 specialist 适用的 stepId 列表 */
  appliesTo: string[];
}

const SPECIALIST_MATCHERS: SpecialistMatcher[] = [
  // 题材风格 specialist（仅注入 worldview / story_framework）
  { file: "narrative-studio/assets/prompts/specialists/specialist_souls.md",   keywords: ["souls", "魂", "soulslike", "暗黑之魂"],         appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_fantasy.md", keywords: ["fantasy", "奇幻", "魔法", "中世纪"],          appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_sci_fi.md",  keywords: ["sci-fi", "scifi", "科幻", "赛博", "太空"],   appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_horror.md",  keywords: ["horror", "恐怖", "克苏鲁", "灵异"],            appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_wuxia.md",   keywords: ["wuxia", "武侠", "仙侠", "修仙"],               appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_romance.md", keywords: ["romance", "恋爱", "乙女", "galgame", "约会"], appliesTo: ["worldview", "story_framework", "character_enrichment"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_crime.md",   keywords: ["crime", "侦探", "推理", "黑帮"],                appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_western.md", keywords: ["western", "西部", "牛仔"],                     appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_post_apocalyptic.md", keywords: ["apocalyptic", "末日", "post-apoc", "废土"], appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_cozy.md",    keywords: ["cozy", "治愈", "温馨", "牧场", "农场"],          appliesTo: ["worldview", "story_framework", "character_enrichment"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_suspense.md", keywords: ["suspense", "悬疑", "惊悚"],                    appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_coming_of_age.md", keywords: ["coming-of-age", "成长", "少年"],          appliesTo: ["worldview", "character_enrichment"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_cult.md",    keywords: ["cult", "邪典", "邪教"],                          appliesTo: ["worldview", "story_framework"] },
  { file: "narrative-studio/assets/prompts/specialists/specialist_ensemble.md", keywords: ["ensemble", "群像"],                           appliesTo: ["character_enrichment", "story_framework"] },
];

/**
 * 加载结果：内存索引。
 *  - globalByStep: stepId → 拼接好的全局 prompt 文本
 *  - specialistsByKeyword: 关键词 → 多 step skill 内容（小写化）
 */
interface MdSkillIndex {
  globalByStep: Map<string, string>;
  specialistsByKeyword: Map<string, Map<string, string>>;
  loadedFiles: number;
  failedFiles: string[];
}

let CACHED_INDEX: MdSkillIndex | null = null;

/**
 * 解析 md 文件：剥离 YAML frontmatter，返回正文。
 * 解析失败时返回空串（不抛异常）。
 */
function parseMdBody(absPath: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch {
    return "";
  }
  // YAML frontmatter: 文件开头 --- ... ---（三破折号包围）
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end > 0) {
      const after = raw.slice(end + 4); // skip "\n---"
      return after.trimStart();
    }
  }
  return raw;
}

/**
 * 内部：获取 skills/ 目录的绝对路径。
 * 测试与构建产物中位置不同，统一以本文件位置为锚。
 */
function getSkillsRoot(): string {
  // src/knowledge/game-narrative/md-skill-loader.ts → src/knowledge/game-narrative/skills
  return path.resolve(__dirname, "skills");
}

/**
 * 同步加载 md 索引（启动期一次性）。
 * 重复调用返回缓存。
 */
export function ensureMdSkillsLoaded(): MdSkillIndex {
  if (CACHED_INDEX) return CACHED_INDEX;
  const skillsRoot = getSkillsRoot();
  const globalByStep = new Map<string, string>();
  const specialistsByKeyword = new Map<string, Map<string, string>>();
  let loadedFiles = 0;
  const failedFiles: string[] = [];

  // ─── Step 1: 全局 step → md 拼接 ───────────────────────────────────────
  for (const [stepId, files] of Object.entries(STEP_TO_MD_GLOBAL)) {
    const parts: string[] = [];
    for (const rel of files) {
      const abs = path.resolve(skillsRoot, rel);
      const body = parseMdBody(abs);
      if (body.trim()) {
        parts.push(body.trim());
        loadedFiles++;
      } else {
        failedFiles.push(rel);
      }
    }
    if (parts.length > 0) {
      globalByStep.set(stepId, parts.join("\n\n---\n\n"));
    }
  }

  // ─── Step 2: 题材风格 specialist 反向索引 ───────────────────────────────
  for (const matcher of SPECIALIST_MATCHERS) {
    const abs = path.resolve(skillsRoot, matcher.file);
    const body = parseMdBody(abs);
    if (!body.trim()) {
      failedFiles.push(matcher.file);
      continue;
    }
    loadedFiles++;
    for (const kw of matcher.keywords) {
      const normalized = kw.toLowerCase();
      let perStep = specialistsByKeyword.get(normalized);
      if (!perStep) {
        perStep = new Map<string, string>();
        specialistsByKeyword.set(normalized, perStep);
      }
      for (const stepId of matcher.appliesTo) {
        // 同一关键词同一 step 仅保留首个匹配（避免覆盖）
        if (!perStep.has(stepId)) perStep.set(stepId, body.trim());
      }
    }
  }

  CACHED_INDEX = { globalByStep, specialistsByKeyword, loadedFiles, failedFiles };

  if (failedFiles.length > 0) {
    console.warn(`[md-skill-loader] ${failedFiles.length} md file(s) missing/empty:`, failedFiles.slice(0, 5).join(", "));
  }
  console.log(`[md-skill-loader] Loaded ${loadedFiles} md skill files (${globalByStep.size} step globals, ${specialistsByKeyword.size} specialist keywords)`);

  return CACHED_INDEX;
}

/** 强制重置缓存（仅测试使用）。 */
export function _resetMdSkillCacheForTest(): void {
  CACHED_INDEX = null;
}

/**
 * 主入口：当 ts skill 未命中时调用，尝试从 md 索引返回合成 StepSkillBlock。
 *
 * @param genreCode  品类代码（用于关键词匹配 specialist）
 * @param stepId     pipeline step ID
 * @param genreKeywords 该品类的 keywords 列表（来自 GENRE_TAXONOMY），可空
 * @returns 合成的 block 或 null（无任何 md 内容时）
 */
export function getMdSkillBlock(
  genreCode: string | undefined | null,
  stepId: string,
  genreKeywords?: string[],
): StepSkillBlock | null {
  const idx = ensureMdSkillsLoaded();
  const segments: string[] = [];

  // 全局 step 注入（与品类无关）
  const globalText = idx.globalByStep.get(stepId);
  if (globalText) segments.push(globalText);

  // 风格专家注入：按 genreCode 与 keywords 匹配
  if (genreCode || (genreKeywords && genreKeywords.length > 0)) {
    const tokens = new Set<string>();
    if (genreCode) tokens.add(genreCode.toLowerCase());
    for (const kw of genreKeywords ?? []) tokens.add(kw.toLowerCase());

    const seen = new Set<string>();
    for (const token of tokens) {
      // 全部子串扫描：避免精确匹配带来的低召回（如 "rpg-soulslike" 想匹配 "souls"）
      for (const [matcherKw, perStep] of idx.specialistsByKeyword) {
        if (seen.has(matcherKw)) continue;
        if (token.includes(matcherKw) || matcherKw.includes(token)) {
          const stepText = perStep.get(stepId);
          if (stepText) {
            segments.push(stepText);
            seen.add(matcherKw);
            break;
          }
        }
      }
    }
  }

  if (segments.length === 0) return null;

  return {
    systemPromptAddition: segments.join("\n\n---\n\n"),
  };
}

/** 调试/监控用：返回当前加载状态摘要。 */
export function getMdSkillStats(): { loadedFiles: number; failedFiles: string[]; stepGlobals: number; specialists: number } {
  const idx = ensureMdSkillsLoaded();
  return {
    loadedFiles: idx.loadedFiles,
    failedFiles: [...idx.failedFiles],
    stepGlobals: idx.globalByStep.size,
    specialists: idx.specialistsByKeyword.size,
  };
}
