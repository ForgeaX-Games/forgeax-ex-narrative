/**
 * 初步方案（单次 LLM 直出）
 *
 * 一次调用生成全部初始数据，输出纯 JSON：
 *   - initial_story_outline（结构化大纲，非 Markdown 文本）
 *   - core_settings（世界/角色/设定）
 *   - plot_synopsis（剧情简介）
 *
 * 前端负责将 JSON 字段渲染为可读文本，后端只存结构化数据。
 */
import type { NarrativeContext, CoreSettings, PlotSynopsis, InitialOutline } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, userInstructionsBlock, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, STRATEGY_SLOT_BLOCK } from "../runtime/prompt-composer.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import { resolveTargetActs } from "../runtime/narrative-scale.js";
import { loadSkill } from "../../knowledge/game-narrative/skill-loader.js";

const VALID_TONES = ["romantic", "epic", "mystery", "apocalyptic", "growth", "rivalry", "cozy", "comedy", "horror", "absurd"] as const;
const VALID_THEMES = ["fantasy", "xuanhuan", "urban", "cyberpunk", "wuxia", "school", "mythology", "space_opera", "steampunk", "western"] as const;
const VALID_HOOKS = ["puzzle", "slice_of_life", "competitive"] as const;

export const INITIAL_PLAN_COMPOSER: PromptComposer = {
  stepId: "initial_plan",
  blocks: {
    cot: `## 机制与流程
1. 由用户需求确立故事的高概念——一句话就能让人想玩的那个卖点。
2. 由高概念展开核心设定：世界基底、主角、核心冲突，三者互为因果。
3. 按起承转合撰写故事大纲，确保每一转都由前一段的因导出。
4. 浓缩为剧情简介，检验高概念是否真的立得住。
5. 自检：是否服务用户明说的诉求？是否为世界观 / 角色 / 大纲各留出了接口？`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    role: `你是专业故事策划师，请根据用户需求一次性输出初步方案全部数据。所有输出必须使用中文（world_tags 的值除外）。`,
    task_spec: `## 输出要求

输出单一 JSON 对象，包含以下所有字段（禁止省略任何字段）：

\`\`\`json
{
  "theme": "故事核心主旨（一句话）",
  "background": "世界背景与时代环境描述（100-200字）",
  "character_arc": "主角成长轨迹：从XXX到XXX",
  "main_conflict": "核心矛盾描述",
  "story_structure": {
    "opening": "开端（200字以上）：故事起点与触发事件。即使采用热开场（in media res），也必须在动作中嵌入以下要素——①关系展示：角色之间的情感纽带通过行为或对话体现；②行动动机：他们为什么在做这件事、为谁而动、失败了谁受伤；③角色个性：至少一个角色通过独有的反应/对话/习惯展示不可替代的性格；④flag种子：至少一个角色表达对未来的具体期待（这个期待在后续会被打碎，制造情感冲击）",
    "development": ["中段阶段一：XXX", "中段阶段二：XXX"],
    "ending": "结局：矛盾解决与情感落点"
  },
  "key_plot_points": ["转折点1", "转折点2", "转折点3"],
  "world_name": "世界/宇宙/纪元级专有名称",
  "world_setting": "世界背景简述（50-100字）",
  "world_summary": "世界简介（50-200字，有吸引力）",
  "world_tags": {
    "tone": ["从 romantic/epic/mystery/apocalyptic/growth/rivalry/cozy/comedy/horror/absurd 选1-3个"],
    "theme": ["从 fantasy/xuanhuan/urban/cyberpunk/wuxia/school/mythology/space_opera/steampunk/western 选1-2个"],
    "hook": ["从 puzzle/slice_of_life/competitive 选0-2个"]
  },
  "protagonist": {
    "name": "主角全名（非占位符）",
    "identity": "身份",
    "personality": "性格特点",
    "core_conflict": "主角内心核心冲突"
  },
  "key_npcs": [
    { "name": "配角全名", "identity": "身份", "personality": "性格", "relationship_to_protagonist": "与主角关系" }
  ],
  "main_theme": "故事主题",
  "narrative_perspective": "叙事视角（第一人称/第三人称等）",
  "genre": "题材（如奇幻/赛博朋克/武侠等）",
  "synopsis_strategy": "剧情策略（如何设置钩子、如何推进）",
  "synopsis": "200-300字剧情简介（有代入感）",
  "highlight_analysis": "核心亮点分析（吸引力所在）"
}
\`\`\``,
    strategy: STRATEGY_SLOT_BLOCK,
    output_schema: `## 设计原则
- 所有名字必须具体（禁止使用"主角""配角"等占位符）
- story_structure.development 设置2-4个阶段，每阶段有自己的起伏
- key_plot_points 3-5个关键转折点
- synopsis 必须200字以上，有代入感`,
    context_inputs: (ctx: NarrativeContext): string => buildUserPrompt(ctx),
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
  // 策划文档是 stage=design：策略段紧跟任务，四轴策略先落盘，再谈机制与输出约束。
  // 品类风格/约束不再单开 style_guide/constraints 块——genreStyleProvider 已注册进
  // DEFAULT_PROVIDERS，同一份 skill.slots 内容随 strategy 段的 strategy_genre
  // 子槽一起送出，不必（也不该）在这里再用 {{SKILL.*}} 占位符重复注入一遍。
  systemBlockOrder: ["role", "task_spec", "strategy", "cot", "ip_source", "output_schema"],
  userBlockOrder: ["context_inputs", "user_instructions"],
  skillSlots: [],
};

function buildUserPrompt(ctx: NarrativeContext): string {
  const digest = ctx.user_preference_analysis
    ? JSON.stringify(ctx.user_preference_analysis, null, 2)
    : "（无）";

  return `## 用户原始需求（必须严格遵循！）⭐
${ctx.user_input}

## 用户偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 用户偏好分析（42维度槽位参数摘要）
${digest}
${buildDesignContextSnippet(ctx)}
请严格按照系统提示中的 JSON 格式输出初步方案，不要省略任何字段。`;
}

interface InitialPlanRaw {
  // InitialOutline fields
  theme: string;
  background: string;
  character_arc: string;
  main_conflict: string;
  story_structure: { opening: string; development: string[]; ending: string };
  key_plot_points: string[];
  // CoreSettings fields
  world_name: string;
  world_setting: string;
  world_summary: string;
  world_tags: { tone: string[]; theme: string[]; hook: string[] };
  protagonist: { name: string; identity: string; personality: string; core_conflict: string };
  key_npcs: Array<{ name: string; identity: string; personality: string; relationship_to_protagonist: string }>;
  main_theme: string;
  narrative_perspective: string;
  genre: string;
  // PlotSynopsis fields
  synopsis_strategy: string;
  synopsis: string;
  highlight_analysis: string;
}

/** 输出校验（抛错触发 LLM 重试）。runner 与 legacy 共用。 */
export function validateInitialPlan(raw: string): void {
  const parsed = extractJSON<InitialPlanRaw>(raw);
  if (!parsed.theme) throw new Error("缺少 theme 字段");
  if (!parsed.protagonist?.name || parsed.protagonist.name.length < 2)
    throw new Error("protagonist.name 不能为空或占位符");
  if (!parsed.world_name || parsed.world_name.length < 2)
    throw new Error("world_name 不能为空");
  if (!parsed.synopsis || parsed.synopsis.length < 50)
    throw new Error("synopsis 不能为空（需200字以上）");
  if (!parsed.story_structure?.opening)
    throw new Error("story_structure.opening 不能为空");
  if (!Array.isArray(parsed.story_structure?.development) || parsed.story_structure.development.length === 0)
    throw new Error("story_structure.development 不能为空");
}

function normalizeTags(raw: InitialPlanRaw): InitialPlanRaw["world_tags"] {
  const tags = raw.world_tags ?? { tone: [], theme: [], hook: [] };
  tags.tone = (tags.tone ?? []).filter((t) => (VALID_TONES as readonly string[]).includes(t));
  tags.theme = (tags.theme ?? []).filter((t) => (VALID_THEMES as readonly string[]).includes(t));
  tags.hook = (tags.hook ?? []).filter((t) => (VALID_HOOKS as readonly string[]).includes(t));

  if (tags.theme.length === 0 && raw.genre) {
    const genreLower = raw.genre.toLowerCase();
    for (const t of VALID_THEMES) {
      if (genreLower.includes(t)) { tags.theme.push(t); break; }
    }
    if (tags.theme.length === 0) tags.theme.push("fantasy");
  }
  return tags;
}

/**
 * 归一化。runner 只写 io.outputField（initial_story_outline），core_settings /
 * plot_synopsis / target_acts / story_title 都是派生字段，顺带在这里写进 ctx——
 * 与 character_enrichment_normalizer 派生 player_name 同一惯例。
 */
export function normalizeInitialPlan(
  parsed: unknown,
  ctx: NarrativeContext,
): InitialOutline {
  const raw = parsed as InitialPlanRaw;
  const tags = normalizeTags(raw);

  const outline: InitialOutline = {
    theme:          raw.theme,
    background:     raw.background ?? "",
    character_arc:  raw.character_arc ?? "",
    main_conflict:  raw.main_conflict,
    story_structure: {
      opening:     raw.story_structure?.opening ?? "",
      development: raw.story_structure?.development ?? [],
      ending:      raw.story_structure?.ending ?? "",
    },
    key_plot_points: raw.key_plot_points ?? [],
  };

  const coreSettings: CoreSettings = {
    world_name:           raw.world_name,
    world_setting:        raw.world_setting ?? "",
    world_summary:        raw.world_summary ?? raw.world_setting ?? "",
    world_tags:           tags,
    protagonist:          raw.protagonist,
    key_npcs:             raw.key_npcs ?? [],
    main_theme:           raw.main_theme ?? raw.theme,
    main_conflict:        raw.main_conflict,
    narrative_perspective: raw.narrative_perspective ?? "",
    genre:                raw.genre ?? "",
  };
  ctx.core_settings = coreSettings;

  // 全局故事标题（§6.5）：D0 生成的 world_name 即全局唯一 story_title；
  // 若上游（如 IP DNA A→B 种子）已预置 story_title 则尊重之，保证一级标题与算子 source-name 全局统一。
  if (!ctx.story_title?.trim()) ctx.story_title = raw.world_name;

  const synopsis: PlotSynopsis = {
    synopsis_strategy: raw.synopsis_strategy ?? "",
    synopsis:          raw.synopsis,
    highlight_analysis: raw.highlight_analysis ?? "",
  };
  ctx.plot_synopsis = synopsis;

  // Stage C：解析目标幕数（短剧 1 幕 / 长剧 ≥2 幕）。
  // hybrid 触发：user_input 关键词 > skill.defaultActs > 1。
  // 写入 ctx.target_acts，下游 chunked capability 据此切换 single/long-form 模式。
  const genreCode = (ctx as Record<string, unknown>).demand_analysis &&
    typeof (ctx as Record<string, { genre_code?: unknown }>).demand_analysis === "object"
    ? ((ctx as Record<string, { genre_code?: unknown }>).demand_analysis as { genre_code?: string }).genre_code
    : undefined;
  const skill = loadSkill(genreCode);
  // M1.7: 把上传剧本的 char_count 透传，让长篇剧本自动 → 多幕
  const uploadedCharCount = ctx.uploaded_script?.char_count;
  ctx.target_acts = resolveTargetActs(ctx.user_input, skill, uploadedCharCount);

  return outline;
}

export async function initialPlan(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const sp = composeSystemPrompt(INITIAL_PLAN_COMPOSER, ctx);
  const raw = await llm.callWithRetry(
    sp,
    composeUserPrompt(INITIAL_PLAN_COMPOSER, ctx),
    { responseFormat: "json" },
    validateInitialPlan,
  );

  ctx.initial_story_outline = normalizeInitialPlan(extractJSON<InitialPlanRaw>(raw), ctx);
}
