import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { userInstructionsBlock, buildIpSourceReference } from "./design-context-helper.js";
import {
  composeSystemPrompt,
  composeUserPrompt,
  STRATEGY_SLOT_BLOCK,
  type PromptComposer,
} from "../runtime/prompt-composer.js";

function isEnLocale(ctx: NarrativeContext): boolean {
  return ctx.content_locale === "en";
}

/**
 * C1（VN v2 吸收）：归档的 `vn-v2-e2.ts` 曾用运行时改图（`injectVnV2E2Steps`）在
 * "有上传剧本"时把 E1 自主创作步整段替换成 vn_script_normalize + vn_segment_confirm，
 * 这是运行方式，绑死在 `tpl-vn-v2` 一条管线上。业务功能——"用户上传剧本时跳过前段
 * 自主创作、改为预处理加文本段确认"——与品类无关，这里改由本席（需求清单，任何
 * 管线的入口都要过一遍）通用地表达：不新增 step、不做图结构手术，`ctx.uploaded_script`
 * 存在与否只是这两个 block 内部的一个分支，对任意品类同样生效。
 */
function uploadedScriptContext(ctx: NarrativeContext): string {
  const u = ctx.uploaded_script;
  if (!u?.content) return "";
  const excerpt = u.content.length > 6000 ? `${u.content.slice(0, 6000)}\n……（截断）` : u.content;
  return isEnLocale(ctx)
    ? `\n\n## Uploaded script ⭐（authoritative source material）\nFormat: ${u.format}, ~${u.char_count} chars${u.description ? `\nDescription: ${u.description}` : ""}\n\n${excerpt}`
    : `\n\n## 用户上传剧本 ⭐（权威原文，非灵感参考）\n格式：${u.format}，约 ${u.char_count} 字${u.description ? `\n描述：${u.description}` : ""}\n\n${excerpt}`;
}

/**
 * 中英双语块只读 ctx.content_locale 自己分支，composer 本体是单一静态对象——
 * 迁移到 runner 后 agent-exec.resolvePrompts 从 STEP_REGISTRY.composer 现场解析，
 * 拿不到"哪个 locale"的调用参数，只能靠块内部读 ctx 判断。
 */
export const PREFERENCE_SUMMARY_COMPOSER: PromptComposer = {
  stepId: "preference_summary",
  skillSlots: [],
  // 需求清单是四个吃策略卡的环节之一（stage=demand）：先让四轴各自做结构适配性预判，
  // 再进入提取要素，避免要素提完了才发现方向与本轴不合。
  systemBlockOrder: ["role", "strategy", "extraction_guide", "cot", "ip_source", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction", "user_instructions"],
  blocks: {
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    strategy: STRATEGY_SLOT_BLOCK,

    role: (ctx: NarrativeContext): string => isEnLocale(ctx)
      ? "You are a narrative requirements analyst. Extract key elements from user descriptions and summarize them structurally. All output must be in English."
      : "你是叙事需求分析专家，擅长从用户描述中提取关键要素并进行结构化总结。所有输出必须使用中文。",

    extraction_guide: (ctx: NarrativeContext): string => isEnLocale(ctx)
      ? `## Elements to extract

From the user description, extract:
1. Protagonist: name, gender, age, race, occupation, etc.
2. Story theme: core theme (growth, revenge, redemption, love, sacrifice, etc.)
3. Genre/type: mystery, romance, adventure, growth, etc.
4. World setting: realistic, sci-fi, fantasy, historical, etc.
5. Core conflict: what problem the protagonist faces
6. Tone: epic, heartwarming, dark, humorous, etc.
7. Desired ending: happy / bad / open
8. Emotional tone: warm, tense, sad, surprising
9. Special requirements: user preferences or constraints`
      : `## 提取要素

从用户描述中提取以下关键信息：
1. 主角信息：姓名、性别、年龄、种族、职业身份等
2. 故事主题：核心主旨与思想内核（如复仇、成长、救赎、爱与牺牲等）
3. 题材类型：悬疑/爱情/冒险/成长等
4. 世界背景：现实/科幻/奇幻/历史等
5. 核心冲突：主角面临什么问题
6. 风格基调：叙事风格与整体氛围（如史诗恢宏、温馨治愈、暗黑压抑、轻松幽默等）
7. 期望结局：Happy/Bad/Open
8. 情感倾向：温馨/紧张/悲伤/惊喜
9. 特殊要求：用户的特殊偏好或禁忌`,

    cot: (ctx: NarrativeContext): string => isEnLocale(ctx)
      ? `## How to work
1. Read the user's input end to end and pull out genre, tone, reference works and gameplay leanings.
2. Separate what the user asked for outright from what they only implied — do not promote a guess into a stated requirement.
3. Flag the gaps: dimensions downstream steps will need that the user never specified.`
      : `## 机制与流程
1. 通读用户输入，提取题材、基调、参考作品与玩法倾向。
2. 区分明确诉求与隐含偏好——用户没说的不要写成他说过的。
3. 标记缺口：下游需要、但用户这次没有指定的维度。`,

    output_format: (ctx: NarrativeContext): string => isEnLocale(ctx)
      ? "## Output format\n\nStructured Markdown, clear and readable."
      : "## 输出格式\n\n结构化Markdown格式，清晰易读。",

    context_inputs: (ctx: NarrativeContext): string => (isEnLocale(ctx)
      ? `## User original request ⭐\n${ctx.user_input}`
      : `## 用户原始需求⭐\n${ctx.user_input}`) + uploadedScriptContext(ctx),

    task_instruction: (ctx: NarrativeContext): string => isEnLocale(ctx)
      ? `## Task

**Important**:
1. Base your analysis on the user's original request!
2. Do not invent details the user did not mention!
3. If a field is unspecified, infer reasonably from the genre/theme.
${ctx.uploaded_script?.content ? "4. An uploaded script was provided above: extract from its actual content (setting, characters, plot already written), do not re-imagine a different story. Treat it as authoritative source material to confirm and structure, not as loose inspiration.\n" : ""}
Summarize user preferences.

Output Markdown directly (do not wrap in code fences):

# User preference summary

## Core elements
- Protagonist: XXX
- Story theme: XXX
- Genre/type: XXX
- World setting: XXX
- Core conflict: XXX
- Tone: XXX

## Expected experience
- Ending preference: XXX
- Emotional tone: XXX
- Pacing preference: XXX

## Special requirements
- XXX

## Brief overview
One sentence summarizing the story the user wants.`
      : `## 任务

**重要**：
1. 必须基于用户原始需求进行分析！
2. 不要编造用户未提及的内容！
3. 如果用户未明确某项，根据题材合理推断。
${ctx.uploaded_script?.content ? "4. 上面提供了用户上传的剧本原文：请从其真实内容（已写好的设定、角色、情节）里提取，不要脱离原文另编一个故事。把它当作要确认与结构化的权威原文，而不是随意发挥的灵感来源。\n" : ""}
请总结用户偏好。

直接输出Markdown格式（不要用代码块包裹）：

# 用户偏好总结

## 核心要素
- 主角信息：XXX
- 故事主题：XXX
- 题材类型：XXX
- 世界背景：XXX
- 核心冲突：XXX
- 风格基调：XXX

## 期望体验
- 结局倾向：XXX
- 情感倾向：XXX
- 节奏偏好：XXX

## 特殊要求
- XXX

## 简短概述
一句话总结用户想要什么样的故事。`,

    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
};

export async function userPreferenceSummary(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const sp = composeSystemPrompt(PREFERENCE_SUMMARY_COMPOSER, ctx);
  const up = composeUserPrompt(PREFERENCE_SUMMARY_COMPOSER, ctx);

  const result = await llm.callStreamFull(sp, up, {}, streamEmit);
  ctx.user_preference_summary = result.trim();
}
