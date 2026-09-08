/**
 * blueprint/prompt-resolver.ts
 *
 * ⚠️ 生产状态：本文件的**两个入口地位不同**。
 *
 *    resolveFromComposer  在生产路径上。executeAgent 对每个 useNewRunner 的 agent
 *                         都经它把内联 PromptComposer 转成 ResolvedPrompts
 *                         （目前 narrative_card 一席已切；见 agent-exec.resolvePrompts）。
 *    resolveFromTemplate  实验路径。读 prompts/_archive/agents-promptresolver 下的 .md，
 *                         那批模板已归档，多数文件不存在（缺文件返回空串）。
 *
 *    提示词的事实源始终是各 step 的 PromptComposer.blocks——改提示词改那里，勿改本文件。
 *
 * 提示词模板解析器。从 .md 模板文件读取 → 按分区解析 → 填充 skill 槽位 →
 * 渲染 ctx 变量 → 输出最终 system / user prompt。
 *
 * 模板文件格式（每个 step 一个 .md）：
 *
 *   # <Step 名称>
 *
 *   ## System Prompt
 *   ### A. 身份与专业性
 *   ### B. 约束与格式
 *   ### C. 机制与流程
 *   ### D. 品类风格注入（可选）
 *
 *   ## User Prompt
 *   <user prompt 模板，含 {{ctx.*}} 占位符>
 *
 *   ## Output Template
 *   <JSON Schema 或示例>
 *
 * 占位符语法：
 *   {{SKILL.<slotName>}}   — 品类 skill 注入（编译时填充）
 *   {{ctx.<fieldPath>}}    — 运行时 ctx 数据注入
 *
 * 向后兼容：
 *   同时支持从现有 PromptComposer（blocks 内联）解析，
 *   使迁移可以逐步进行。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NarrativeContext } from "../../types/index.js";
import type { StepSkillBlock } from "../../knowledge/game-narrative/skill-types.js";
import type { ResolvedPrompts, AgentPromptConfig } from "./types.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import {
  composeSystemPrompt as legacyComposeSystem,
  composeUserPrompt as legacyComposeUser,
} from "../runtime/prompt-composer.js";
import { findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import { getInjectedFragment } from "../../ip-dna/injection/operator-injection.js";
import {
  renderPlaceholders,
  hasIpDnaPlaceholders,
  buildSlotMap,
  buildDataHelpers,
} from "../prompt/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILL_PLACEHOLDER = /\{\{SKILL\.([\w_]+)\}\}/g;

// ════════════════════════════════════════════════════════
// 模板缓存
// ════════════════════════════════════════════════════════

interface ParsedTemplate {
  systemPrompt: string;
  userPrompt: string;
  outputTemplate: string;
}

const templateCache = new Map<string, ParsedTemplate>();

function resolveDirWithFallback(candidate: string, srcFallback: string): string {
  return fs.existsSync(candidate) ? candidate : srcFallback;
}

// 统一提示词树根：src/prompts/（agents 骨架 / genres 品类覆盖）。
// tsx 模式: __dirname = src/pipeline/blueprint/ → ../../prompts/_archive/agents-promptresolver
// 编译模式: __dirname = dist/pipeline/blueprint/ → 回退到 src/ 路径
//
// 四期归档：这批 md 只有本实验引擎会读，生产走 PromptComposer 内联块。
// 详见 src/prompts/_archive/README.md。路径指向归档目录，实验引擎行为不变。
const TEMPLATES_DIR = resolveDirWithFallback(
  path.resolve(__dirname, "../../prompts/_archive/agents-promptresolver"),
  path.resolve(__dirname, "../../../src/prompts/_archive/agents-promptresolver"),
);

// 新品类覆盖目录：prompts/genres/<tier>/<genre>/<step>.md
const GENRES_DIR = resolveDirWithFallback(
  path.resolve(__dirname, "../../prompts/genres"),
  path.resolve(__dirname, "../../../src/prompts/genres"),
);

// 旧品类专属 prompts（colocated 于 skill 包）：skills/<tier>/<genre>/prompts/<step>.md（回退兼容）
const LEGACY_SKILLS_DIR = resolveDirWithFallback(
  path.resolve(__dirname, "../../knowledge/game-narrative/skills"),
  path.resolve(__dirname, "../../../src/knowledge/game-narrative/skills"),
);

/**
 * 定位品类专属 prompt 文件：优先新树 prompts/genres/<tier>/<genre>/<step>.md，
 * 回退旧位置 skills/<tier>/<genre>/prompts/<step>.md。返回存在的绝对路径，否则 null。
 */
function genrePromptPath(genreCode: string, stepId: string): string | null {
  const entry = findGenreByCode(genreCode);
  if (!entry) return null;
  const newPath = path.join(GENRES_DIR, entry.tier, genreCode, `${stepId}.md`);
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = path.join(LEGACY_SKILLS_DIR, entry.tier, genreCode, "prompts", `${stepId}.md`);
  return legacyPath;
}

// ════════════════════════════════════════════════════════
// 模板解析
// ════════════════════════════════════════════════════════

/**
 * 从 .md 文件按 ## 标题分区提取内容。
 */
function parseTemplateSections(content: string): ParsedTemplate {
  const sections: Record<string, string> = {};
  let currentSection = "__preamble__";
  const lines = content.split("\n");

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      currentSection = h2Match[1].trim().toLowerCase();
      continue;
    }
    if (!sections[currentSection]) sections[currentSection] = "";
    sections[currentSection] += line + "\n";
  }

  const systemKey = Object.keys(sections).find((k) => k.startsWith("system"));
  const userKey = Object.keys(sections).find((k) => k.startsWith("user"));
  const outputKey = Object.keys(sections).find(
    (k) => k.startsWith("output") || k.startsWith("json"),
  );

  return {
    systemPrompt: (systemKey ? sections[systemKey] : "").trim(),
    userPrompt: (userKey ? sections[userKey] : "").trim(),
    outputTemplate: (outputKey ? sections[outputKey] : "").trim(),
  };
}

/**
 * 加载模板（双层）：
 *   1. 品类专属 skills/<tier>/<genre>/prompts/<step>.md（若 genreCode 提供且文件存在，完全覆盖）
 *   2. 通用骨架 agent-templates/<step>.md（fallback）
 *
 * 缓存键 = `${genreCode ?? "_generic"}:${templateId}`。
 */
function loadTemplate(templateId: string, genreCode?: string): ParsedTemplate {
  const cacheKey = `${genreCode ?? "_generic"}:${templateId}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  // Layer 1: 品类专属 prompt（完全独立提示词，优先）
  if (genreCode) {
    const gPath = genrePromptPath(genreCode, templateId);
    if (gPath && fs.existsSync(gPath)) {
      const parsed = parseTemplateSections(fs.readFileSync(gPath, "utf-8"));
      templateCache.set(cacheKey, parsed);
      return parsed;
    }
  }

  // Layer 2: 通用骨架
  const filePath = path.join(TEMPLATES_DIR, `${templateId}.md`);
  if (!fs.existsSync(filePath)) {
    const empty: ParsedTemplate = { systemPrompt: "", userPrompt: "", outputTemplate: "" };
    templateCache.set(cacheKey, empty);
    return empty;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parseTemplateSections(raw);
  templateCache.set(cacheKey, parsed);
  return parsed;
}

// ════════════════════════════════════════════════════════
// Skill 槽位填充
// ════════════════════════════════════════════════════════

function fillSkillSlots(
  text: string,
  skill: StepSkillBlock | null,
  allowedSlots: string[],
): string {
  let result = text.replace(SKILL_PLACEHOLDER, (_, slotName: string) => {
    if (!skill?.slots) return "";
    if (allowedSlots.length > 0 && !allowedSlots.includes(slotName)) return "";
    return skill.slots[slotName] ?? "";
  });

  if (skill?.systemPromptAddition && allowedSlots.length > 0) {
    result += `\n\n${skill.systemPromptAddition}`;
  }

  return result;
}

// ════════════════════════════════════════════════════════
// Ctx 变量渲染（统一委托 prompt/syntax，支持 {{ctx.*}} + {{data:*}}）
// ════════════════════════════════════════════════════════

function fillCtxPlaceholders(text: string, ctx: NarrativeContext): string {
  return renderPlaceholders(text, { ctx, data: buildDataHelpers(ctx) });
}

// ════════════════════════════════════════════════════════
// 公共 API
// ════════════════════════════════════════════════════════

export class PromptResolver {
  /**
   * 从 .md 模板文件解析提示词。
   *
   * System prompt 在 Blueprint 组装时调用（注入 skill，不依赖 ctx 数据）。
   * User prompt 返回含 {{ctx.*}} 的模板字符串，运行时再渲染。
   */
  static resolveFromTemplate(
    promptConfig: AgentPromptConfig,
    skill: StepSkillBlock | null,
    genreCode?: string,
  ): ResolvedPrompts {
    const tpl = loadTemplate(promptConfig.templateId, genreCode);

    const systemPrompt = fillSkillSlots(
      tpl.systemPrompt,
      skill,
      promptConfig.skillSlots,
    );

    return {
      systemPrompt,
      userPromptTemplate: tpl.userPrompt,
      outputSchema: tpl.outputTemplate ? tryParseSchema(tpl.outputTemplate) : undefined,
    };
  }

  /**
   * 从现有 PromptComposer 解析提示词（向后兼容桥接）。
   *
   * 过渡期使用：尚未迁移到 .md 模板的 step 仍用 PromptComposer 内联 blocks。
   * 将 PromptComposer 的 blocks 包装为 ResolvedPrompts 格式。
   */
  static resolveFromComposer(
    composer: PromptComposer,
    ctx: NarrativeContext,
    opts: { deferUser?: boolean } = {},
  ): ResolvedPrompts {
    return {
      systemPrompt: legacyComposeSystem(composer, ctx),
      // deferUser：分片席位的 user 段铺的是单片材料，此刻 `_chunk` 还不存在，
      // 现在装配只有两种结局——拿第 0 片当所有片，或者（正确地）抛错。
      // 两者都不该发生在"派发前统一解析"这一步，故留空，交给 ChunkedRunner 逐片装配。
      userPromptTemplate: opts.deferUser ? "" : legacyComposeUser(composer, ctx),
      // composer 出来的是终稿：占位符已填、IP DNA 已按插槽注入。标记它，
      // 免得 runner 再 render 一次把算子片段追加第二遍。
      final: true,
      composer,
    };
  }

  /**
   * runner 侧取 system prompt：终稿直接用，模板才渲染。
   *
   * 两个 runner 各写一遍 `final ? ... : render(...)` 迟早漏一个，故收在这里。
   */
  static systemFor(prompts: ResolvedPrompts, ctx: NarrativeContext, stepId?: string): string {
    return prompts.final
      ? prompts.systemPrompt
      : PromptResolver.renderSystemPrompt(prompts.systemPrompt, ctx, stepId);
  }

  /**
   * runner 侧取 user prompt。
   *
   * 带 composer 就用给定 ctx 重新装配一次 —— 分片执行靠的就是这一句：每片传进来的是
   * 含 `_chunk` 的 ctx，不重装配的话每片都会收到解析时那份（`_chunk` 尚不存在）的
   * 提示词，即"每个节点都拿着第一个节点的材料写"，且不报错。
   */
  static userFor(prompts: ResolvedPrompts, ctx: NarrativeContext): string {
    if (prompts.composer) return legacyComposeUser(prompts.composer, ctx);
    return prompts.final
      ? prompts.userPromptTemplate
      : PromptResolver.renderUserPrompt(prompts.userPromptTemplate, ctx);
  }

  /**
   * 运行时渲染 user prompt 模板。
   * 将 {{ctx.*}} 占位符替换为实际 ctx 数据。
   */
  static renderUserPrompt(template: string, ctx: NarrativeContext): string {
    return fillCtxPlaceholders(template, ctx);
  }

  /**
   * 运行时渲染 system prompt（§7.2b）。
   *
   * IP DNA 注入采用两种形态：
   *   - 模板已声明结构化占位（{{IP_DNA.*}} / {{slot:operators}} 等）→ 由 provider 按骨架插槽
   *     精确填充（位置正确、与 step 角色设定融合）；
   *   - 模板未声明占位 → 退回"末尾 append"兼容（保持旧行为）。
   * 同时统一填充 {{ctx.*}} / {{data:*}}。
   *
   * @param stepId 提供时启用 IP DNA 注入。
   */
  static renderSystemPrompt(template: string, ctx: NarrativeContext, stepId?: string): string {
    if (!stepId) return fillCtxPlaceholders(template, ctx);

    if (hasIpDnaPlaceholders(template)) {
      const slots = buildSlotMap(ctx, stepId);
      // 空插槽渲染为空串后塌缩多余空行（结构化骨架内未命中的插槽不留痕迹）。
      return renderPlaceholders(template, { ctx, slots, data: buildDataHelpers(ctx) })
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const base = fillCtxPlaceholders(template, ctx);
    const injected = getInjectedFragment(ctx, stepId);
    return injected ? `${base}\n\n${injected}` : base;
  }

  /** 清除模板缓存（用于热重载/测试） */
  static clearCache(): void {
    templateCache.clear();
  }
}

function tryParseSchema(raw: string): Record<string, unknown> | undefined {
  const jsonMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      return undefined;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
