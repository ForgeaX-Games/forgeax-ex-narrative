import type { NarrativeContext, CharacterSheet, CharacterPersonalLife } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, userInstructionsBlock, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";

export const CHARACTER_ENRICHMENT_COMPOSER: PromptComposer = {
  stepId: "character_enrichment",
  skillSlots: ["style_guide", "examples", "constraints", "character_archetype"],
  systemBlockOrder: ["role", "task_requirements", "ip_dna", "character_archetype", "style_guide", "examples", "constraints", "cot", "ip_source", "output_format_hint"],
  // user_instructions 必须列进 composer：runner 只认 composer 装配出的 user prompt，
  // 而重生成时的用户修改意见原先靠 appendUserInstructions 在 step 函数里事后追加，
  // runner 路径没有那个插入点——漏了它，"按我的意见重做"会静默变成"原样再来一遍"。
  userBlockOrder: ["context_inputs", "design_snippet", "output_schema", "user_instructions"],
  blocks: {
    cot: `## 机制与流程
1. 从世界观的张力点反推"哪些人会被卷进这场冲突"，先定角色的存在理由，再定角色本身。
2. 为每个角色确立三件事：外在目标（他要什么）、内在需求（他缺什么）、致命缺陷（他会栽在哪）。
3. 设计"声音指纹"——说话方式、口头禅、句式长短，让读者遮住名字也认得出是谁在说话。
4. 规划角色弧光的起点与可能终点，并让终点与主线的高潮位置对得上。
5. 自检：角色之间是否同质化？反派的立场是否有说服力？每个配角是否都有非他不可的理由？`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    role: "你是大师级角色设计师与心理剖析专家，请输出完整角色档案数组JSON。所有输出使用中文。",
    task_requirements: `要求：
- 至少包含1个主角与2个NPC
- 每个角色必须包含：
  name, label(主角/NPC/Boss), race, gender, age, occupation, role_in_story,
  description.appearance_description, description.location_description,
  archetype_analysis.core_archetype,
  psychological_drivers.core_motivation, psychological_drivers.core_fear,
  character_arc_spectrum, relationships, background_information,
  personal_life（见下方详细说明）,
  game_mechanics.base_stats.{hp, attack, defense, magic, max_hp},
  _is_player(主角为true)

## personal_life 字段要求（极其重要——角色的"血肉"）

每个角色必须是一个独立于主线故事的活人。你需要通过 personal_life 回答以下问题：
  * likes：这个人喜欢什么？必须是具体的、小的东西（如"旧时代的纸质照片"、"雨后泥土的气味"），不要写抽象概念
  * dislikes：讨厌什么？同样要具体（如"酸雨打在金属皮肤上的滋滋声"）
  * habits：日常习惯或怪癖（如"出任务前总要把枪拆了重装一遍"、"紧张时会反复捏手腕"）
  * speech_pattern：说话方式/口头禅（如"没事，有我呢"、"紧张时会用技术术语骂人"）
  * personal_item：随身携带的私人物件及其意义（如"胸口挂着母亲留下的旧齿轮吊坠"）。
    **写这一项之前，先去上面的世界观设定里找一遍**：如果历史脉络等槽位已经明确
    描述过一件属于这个角色（或与他相关的人）的信物/道具并预告了它的剧情用途，
    这一项必须直接沿用世界观里给定的名字与来历，不要另起一个新名字的道具重复
    表达同一层意义（F2，治 docs/quality-baseline-f1.md 缺陷 4.2——F1 基线里出现过
    世界观已经定义了一枚"古董怀表"作为父亲遗物，角色档案又独立发明了一枚
    "黑色皮质石英表"当作同一层意义的父亲遗物，导致下游情节两块表一起混用）。
    只有世界观完全没有预设任何信物时，才可以自己新造一件
  * private_wish：如果没有这个任务/这场战斗，他明天最想做的事是什么？这是一个具体的、温暖的小愿望（如"攒够钱带某人离开这座城市"、"想有一天不用深潜就能看到真正的星空"）。这个字段是叙事"flag"的种子——后续剧情中这个期待可能被打碎，制造情感冲击
  * vulnerability：性格中最矛盾的一面——外表和内心的不一致（如"外表铁汉，但在黑暗中会失眠"、"看起来冷酷无情，但对某个名字会沉默三秒"）
  * independent_bonds：不围绕主角定义的私人关系——在等他的人、他在乎的人（如"下城区有个女朋友，出任务前承诺晚上回去吃饭"）。每个 bond 需要 name（人名）、relationship（关系）、detail（一句话细节）

这些细节会被后续叙事管线用于 Call/Callback 设计（先种下承诺，后续打碎制造共情），必须具体、私人、有温度。禁止抽象空泛。

## 反派/Boss 角色额外要求

对 label 为 "Boss" 的角色，除上述所有字段外，还必须满足：
  * 反派必须有一段观众可以共情的创伤或动机——他做的事是错的，但走到这一步的路径是可以理解的
  * psychological_drivers.decisive_past_event 必须写清楚他在什么时候、因为什么具体事件，得出了现在这个冰冷/极端的人生结论
  * vulnerability 必须体现他"曾经也是人"的那一面——不是纯粹的恶，而是被伤害后选择了错误的方向
  * 不要写"纯粹的静态反派"或"绝对邪恶"，赛博朋克/现实世界中没有人是纯黑或纯白的

- 每个角色必须给出 visual_prompt.zh 和 visual_prompt.en（高密度立绘提示词，可直接喂 GPT-Image / Midjourney / SD）：
  * 包含：年龄、种族/族裔、发色发型、瞳色、面部特征、体型、典型服饰（材质+颜色+剪裁）、标志性配饰、姿态/气质标签
  * 中文版示例："25岁亚洲女性，乌黑长直发，墨色瞳孔冷峻，鹅蛋脸薄唇，挺拔身形，黑色高领立绒西装+银扣腰带，左耳一枚银色长链耳坠，背手而立，气质冷艳带不易察觉的疲惫，电影感写实立绘"
  * 英文版示例："25-year-old Asian woman, jet-black long straight hair, ink-black piercing eyes, oval face with thin lips, slender posture, black high-collar velvet suit with silver belt buckle, single silver long-chain earring on left ear, hands behind back, cold elegant aura with subtle weariness, cinematic realistic portrait"
  * 不要写"美丽"、"帅气"等空洞修饰，用具体的视觉细节代替`,
    ip_dna: IP_DNA_SLOT_BLOCK,
    character_archetype: "{{SKILL.character_archetype}}",
    style_guide: "{{SKILL.style_guide}}",
    examples: "{{SKILL.examples}}",
    constraints: "{{SKILL.constraints}}",
    output_format_hint: "请严格输出JSON数组。",

    context_inputs: (ctx: NarrativeContext): string => {
      const prefDigest = ctx.user_preference_analysis
        ? JSON.stringify(ctx.user_preference_analysis, null, 2)
        : "（无）";
      return `## 用户原始需求⭐
${ctx.user_input}

## 用户偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 偏好分析
${prefDigest}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {}, null, 2)}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 剧情简介
${JSON.stringify(ctx.plot_synopsis ?? {}, null, 2)}

## 核心设定
${JSON.stringify(ctx.core_settings ?? {}, null, 2)}

## 故事框架概要
${ctx.story_framework
    ? JSON.stringify(ctx.story_framework.framework.nodes.map(n => ({ name: n.name, narrative_function: n.narrative_function })), null, 2)
    : "（无）"}`;
    },

    design_snippet: (ctx: NarrativeContext): string => buildDesignContextSnippet(ctx),
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),

    output_schema: `请输出角色档案JSON数组：
[
  {
    "name": "角色全名",
    "label": "主角",
    "race": "种族",
    "gender": "性别",
    "age": "年龄",
    "occupation": "职业",
    "role_in_story": "故事定位",
    "description": {
      "appearance_description": "外貌描述",
      "location_description": { "location_name": "活动地点", "position_description": "位置描述" }
    },
    "visual_prompt": {
      "zh": "高密度中文立绘提示词（年龄+种族+发型+瞳色+面部+体型+服饰材质颜色+配饰+姿态气质）",
      "en": "high-density english visual prompt (age + ethnicity + hair + eyes + face + body + outfit material/color + accessories + pose/aura)"
    },
    "archetype_analysis": { "core_archetype": "核心原型", "surface_archetype": "表面原型" },
    "psychological_drivers": { "core_motivation": "核心动机", "core_fear": "核心恐惧", "decisive_past_event": "关键过去事件" },
    "character_arc_spectrum": "角色弧光描述",
    "relationships": { "family_relationships": [], "social_relationships": [] },
    "background_information": "背景故事",
    "personal_life": {
      "likes": ["具体喜欢的小东西1", "具体喜欢的小东西2"],
      "dislikes": ["具体讨厌的东西1"],
      "habits": ["日常习惯或怪癖1", "怪癖2"],
      "speech_pattern": "说话方式/口头禅描述",
      "personal_item": "随身私人物件及其来历和意义",
      "private_wish": "一个具体的、温暖的小愿望（flag种子）",
      "vulnerability": "性格中最矛盾的一面（外表vs内心）",
      "independent_bonds": [
        { "name": "某人名字", "relationship": "关系", "detail": "一句话细节" }
      ]
    },
    "game_mechanics": { "level": 1, "base_stats": { "hp": 100, "attack": 10, "defense": 10, "magic": 10, "max_hp": 100 } },
    "_is_player": true
  }
]`,
  },
};

/**
 * 没有 visual_prompt 时的兜底：从已有字段拼最低限度的 prompt（让生图至少不空）。
 * 中文用 race/gender/age/occupation + appearance_description；
 * 英文是粗粒度回退（无翻译能力，仅做基本结构）。
 *
 * 这是 fallback，质量不如 LLM 主动产出 —— LLM 应该按 prompt 里的高密度示例输出。
 */
function buildFallbackVisualPromptZh(raw: {
  age?: string; gender?: string; race?: string; occupation?: string;
  appearance: string;
}): string {
  const parts: string[] = [];
  if (raw.age) parts.push(raw.age);
  if (raw.race) parts.push(raw.race);
  if (raw.gender) parts.push(raw.gender);
  if (raw.occupation) parts.push(raw.occupation);
  if (raw.appearance) parts.push(raw.appearance);
  parts.push("电影感写实立绘", "8K 高清");
  return parts.filter(Boolean).join("，");
}

function buildFallbackVisualPromptEn(raw: {
  age?: string; gender?: string; race?: string; occupation?: string;
}): string {
  // 英文 fallback 只做结构化最小拼装；真正高密度英文应由 LLM 主动产出
  const parts: string[] = [];
  if (raw.age) parts.push(raw.age);
  if (raw.race) parts.push(raw.race);
  if (raw.gender) parts.push(raw.gender);
  if (raw.occupation) parts.push(raw.occupation);
  parts.push("cinematic realistic portrait", "8k", "high detail");
  return parts.filter(Boolean).join(", ");
}

function normalizePersonalLife(raw: unknown): CharacterPersonalLife | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const pl = raw as Record<string, unknown>;
  const toStringArray = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const arr = v.map(String).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  };
  const toBonds = (v: unknown): CharacterPersonalLife["independent_bonds"] => {
    if (!Array.isArray(v)) return undefined;
    const bonds = v
      .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
      .map((b) => ({
        name: String(b.name ?? ""),
        relationship: String(b.relationship ?? ""),
        detail: String(b.detail ?? ""),
      }))
      .filter((b) => b.name);
    return bonds.length > 0 ? bonds : undefined;
  };

  const result: CharacterPersonalLife = {};
  const likes = toStringArray(pl.likes);      if (likes) result.likes = likes;
  const dislikes = toStringArray(pl.dislikes); if (dislikes) result.dislikes = dislikes;
  const habits = toStringArray(pl.habits);    if (habits) result.habits = habits;
  if (typeof pl.speech_pattern === "string" && pl.speech_pattern.trim())
    result.speech_pattern = pl.speech_pattern.trim();
  if (typeof pl.personal_item === "string" && pl.personal_item.trim())
    result.personal_item = pl.personal_item.trim();
  if (typeof pl.private_wish === "string" && pl.private_wish.trim())
    result.private_wish = pl.private_wish.trim();
  if (typeof pl.vulnerability === "string" && pl.vulnerability.trim())
    result.vulnerability = pl.vulnerability.trim();
  const bonds = toBonds(pl.independent_bonds); if (bonds) result.independent_bonds = bonds;

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeCharacter(raw: Record<string, unknown>, index: number): CharacterSheet {
  const name = String(raw.name ?? `角色${index + 1}`).replace(/\(.*?\)/g, "").trim();
  let label = String(raw.label ?? "NPC");
  if (!["主角", "NPC", "Boss"].includes(label)) label = "NPC";

  const desc = (raw.description ?? {}) as Record<string, unknown>;
  const stats = ((raw.game_mechanics as Record<string, unknown>)?.base_stats ?? {}) as Record<string, number>;
  const appearance = String(desc.appearance_description ?? "");
  const age = String(raw.age ?? "");
  const gender = String(raw.gender ?? "");
  const race = String(raw.race ?? "人类");
  const occupation = String(raw.occupation ?? "");

  // visual_prompt：优先用 LLM 给的；缺失字段从 appearance/age/gender 等兜底拼接
  const rawVp = (raw.visual_prompt ?? {}) as { zh?: unknown; en?: unknown };
  const vpZh = typeof rawVp.zh === "string" && rawVp.zh.trim()
    ? rawVp.zh.trim()
    : buildFallbackVisualPromptZh({ age, gender, race, occupation, appearance });
  const vpEn = typeof rawVp.en === "string" && rawVp.en.trim()
    ? rawVp.en.trim()
    : buildFallbackVisualPromptEn({ age, gender, race, occupation });

  return {
    name,
    label: label as CharacterSheet["label"],
    race,
    gender,
    age,
    occupation,
    role_in_story: String(raw.role_in_story ?? ""),
    description: {
      appearance_description: appearance,
      location_description: desc.location_description ?? {},
    },
    visual_prompt: { zh: vpZh, en: vpEn },
    archetype_analysis: (raw.archetype_analysis ?? {}) as Record<string, unknown>,
    psychological_drivers: (raw.psychological_drivers ?? {}) as Record<string, unknown>,
    character_arc_spectrum: String(raw.character_arc_spectrum ?? ""),
    relationships: (raw.relationships ?? {}) as Record<string, unknown>,
    background_information: String(raw.background_information ?? ""),
    personal_life: normalizePersonalLife(raw.personal_life),
    game_mechanics: {
      level: 1,
      base_stats: {
        hp: stats.hp ?? 100,
        attack: stats.attack ?? 10,
        defense: stats.defense ?? 10,
        magic: stats.magic ?? 10,
        max_hp: stats.max_hp ?? 100,
      },
    },
    _is_player: Boolean(raw._is_player ?? label === "主角"),
  };
}

// 仅供测试导出
export const __internal = { normalizeCharacter };

/**
 * 输出格式校验（抛错即触发 LLM 重试）。
 *
 * 提成命名函数是为了让 runner 路径与 legacy step 函数校验同一份规则：
 * 两处各写一份的话，迁移后"重试条件变松了"不会有任何征兆。
 */
export function validateCharacterEnrichment(raw: string): void {
  const parsed = extractJSON(raw);
  if (!Array.isArray(parsed)) throw new Error("输出必须是JSON数组");
  if (parsed.length === 0) throw new Error("角色列表不能为空");
}

/**
 * 逐角色归一 + 主角兜底，并派生 ctx.player_name。
 *
 * 写 ctx 是刻意的：player_name 是本步的派生字段（io.derivedFields），而 runner 只把
 * 主产出写回 io.outputField。归一化器是它唯一能落地的地方 —— 少了这一句，
 * 下游取玩家名会拿到 undefined，且不报错。
 */
export function normalizeCharacterSheets(
  parsed: unknown,
  ctx: NarrativeContext,
): CharacterSheet[] {
  const chars = parsed as Array<Record<string, unknown>>;
  const sheets = chars.map((c, i) => normalizeCharacter(c, i));

  if (!sheets.some((s) => s._is_player)) {
    if (sheets.length > 0) {
      sheets[0].label = "主角";
      sheets[0]._is_player = true;
    }
  }

  ctx.player_name = sheets.find((s) => s._is_player)?.name ?? sheets[0]?.name;
  return sheets;
}

export async function characterEnrichment(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const raw = await llm.callWithRetry(
    composeSystemPrompt(CHARACTER_ENRICHMENT_COMPOSER, ctx),
    composeUserPrompt(CHARACTER_ENRICHMENT_COMPOSER, ctx),
    { responseFormat: "json" },
    validateCharacterEnrichment,
  );

  ctx.detailed_character_sheets = normalizeCharacterSheets(
    extractJSON<Array<Record<string, unknown>>>(raw),
    ctx,
  );
}
