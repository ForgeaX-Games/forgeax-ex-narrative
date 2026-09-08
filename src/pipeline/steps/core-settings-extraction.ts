import type { NarrativeContext, CoreSettings } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { appendUserInstructions } from "./design-context-helper.js";

const VALID_TONES = ["romantic", "epic", "mystery", "apocalyptic", "growth", "rivalry", "cozy", "comedy", "horror", "absurd"] as const;
const VALID_THEMES = ["fantasy", "xuanhuan", "urban", "cyberpunk", "wuxia", "school", "mythology", "space_opera", "steampunk", "western"] as const;
const VALID_HOOKS = ["puzzle", "slice_of_life", "competitive"] as const;

const SYSTEM_PROMPT = `你是信息提取专家。请从初步故事大纲中精确提取核心设定信息。所有输出必须使用中文（world_tags除外）。

## 重要原则
1. **精确提取**：从大纲中提取已有的信息，不要新增或修改
2. **名称固化**：如果大纲中有具体名字就用具体名字，如果是占位符则生成一个符合设定的具体名字
3. **世界命名**：从背景设定中提取或推断一个能代表整个故事世界的专有名称
4. **格式严格**：必须输出JSON格式

## 输出格式
{
  "world_name": "世界专有名称",
  "world_setting": "世界背景简述（50-100字）",
  "world_summary": "世界简介（50-200字，有吸引力）",
  "world_tags": {
    "tone": ["氛围标签1-3个，从 romantic/epic/mystery/apocalyptic/growth/rivalry/cozy/comedy/horror/absurd 选"],
    "theme": ["题材标签1-2个，从 fantasy/xuanhuan/urban/cyberpunk/wuxia/school/mythology/space_opera/steampunk/western 选"],
    "hook": ["特色标签0-2个，从 puzzle/slice_of_life/competitive 选"]
  },
  "protagonist": { "name": "主角全名", "identity": "身份", "personality": "性格", "core_conflict": "核心冲突" },
  "key_npcs": [{ "name": "配角全名", "identity": "身份", "personality": "性格", "relationship_to_protagonist": "关系" }],
  "main_theme": "主题",
  "main_conflict": "主线冲突",
  "narrative_perspective": "叙事视角",
  "genre": "题材"
}`;

function buildUserPrompt(ctx: NarrativeContext): string {
  return `## 初步故事大纲
${ctx.initial_story_outline ?? "（无）"}

## 用户原始需求（参考）
${ctx.user_input}

## 任务
请从上述初步大纲中提取核心设定信息。

**注意**：
- 如果主角名字是占位符，请根据故事背景生成合适名字
- world_name必须是世界级规模概念（大陆/王国/宇宙/纪元）
- world_tags必须从给定选项中选择
- world_summary至少50字
- 所有信息从大纲中提取，保持一致性`;
}

function validateAndNormalize(raw: CoreSettings): CoreSettings {
  if (!raw.world_name || raw.world_name.length < 2)
    throw new Error("world_name必须至少2个字符");
  if (!raw.protagonist?.name)
    throw new Error("protagonist.name不能为空");

  const tags = raw.world_tags ?? { tone: [], theme: [], hook: [] };
  tags.tone = (tags.tone ?? []).filter((t) =>
    (VALID_TONES as readonly string[]).includes(t),
  );
  tags.theme = (tags.theme ?? []).filter((t) =>
    (VALID_THEMES as readonly string[]).includes(t),
  );
  tags.hook = (tags.hook ?? []).filter((t) =>
    (VALID_HOOKS as readonly string[]).includes(t),
  );

  if (tags.theme.length === 0 && raw.genre) {
    const genreLower = raw.genre.toLowerCase();
    for (const t of VALID_THEMES) {
      if (genreLower.includes(t)) {
        tags.theme.push(t);
        break;
      }
    }
    if (tags.theme.length === 0) tags.theme.push("fantasy");
  }

  return {
    ...raw,
    world_tags: tags,
    key_npcs: raw.key_npcs ?? [],
    world_setting: raw.world_setting ?? "",
    world_summary: raw.world_summary ?? raw.world_setting ?? "",
  };
}

export async function coreSettingsExtraction(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const raw = await llm.callWithRetry(
    SYSTEM_PROMPT,
    appendUserInstructions(buildUserPrompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => validateAndNormalize(extractJSON<CoreSettings>(r)),
  );

  ctx.core_settings = validateAndNormalize(extractJSON<CoreSettings>(raw));
}
