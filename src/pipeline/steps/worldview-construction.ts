import type { NarrativeContext, WorldviewStructure, InitialOutline } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, userInstructionsBlock, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";

function outlineToText(outline: InitialOutline | undefined): string {
  if (!outline) return "（无）";
  return [
    outline.theme ? `主题：${outline.theme}` : "",
    outline.background ? `背景：${outline.background}` : "",
    outline.main_conflict ? `主线冲突：${outline.main_conflict}` : "",
    outline.story_structure.opening ? `开端：${outline.story_structure.opening}` : "",
    outline.story_structure.development.length > 0
      ? `中段：\n${outline.story_structure.development.join("\n")}`
      : "",
    outline.story_structure.ending ? `结局：${outline.story_structure.ending}` : "",
  ].filter(Boolean).join("\n\n");
}

export const WORLDVIEW_COMPOSER: PromptComposer = {
  stepId: "worldview",
  skillSlots: ["style_guide", "examples", "constraints", "worldview_archetype"],
  systemBlockOrder: ["role", "task", "ip_dna", "worldview_archetype", "style_guide", "examples", "constraints", "cot", "ip_source", "output_format_hint"],
  userBlockOrder: ["context_inputs", "design_snippet", "task_instruction", "output_schema", "user_instructions"],
  blocks: {
    cot: `## 机制与流程
1. 先从初步方案与题材基调里提取已确立的核心设定，划出本次不可推翻的边界。
2. 确立世界的"第一性原理"——魔法 / 科技 / 社会规则的底层逻辑，其余槽位都由它推演而来。
3. 按第一性原理依次填基础架构层（WV_01-08）：地理影响文化、历史塑造冲突、规则约束行为，不要各写各的。
4. 再落交互叙事层（WV_09-12），并在其中标出可供下游取用的"张力点"：未解之谜、势力矛盾、历史伤痕。
5. 自检：十二槽位是否互相咬合？是否服务本品类玩法？是否给角色 / 道具 / 剧情留出了接口？`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    role: "你是世界观设计大师，擅长构建完整、自洽的虚构世界。所有输出必须使用中文。",
    task: `## 世界观12槽位体系

### 基础架构层(8槽位) — 描述世界的"硬件"
- WV_01 时空背景：时间纪元、历史跨度、地理环境
- WV_02 物理法则：自然规律、特殊法则（魔法/科技）
- WV_03 生物生态：物种设定、生态系统
- WV_04 政治体制：权力结构、治理模式
- WV_05 经济系统：资源分配、经济运作
- WV_06 文化信仰：宗教信仰、风俗习惯
- WV_07 科技水平：技术发展程度、标志性技术
- WV_08 势力组织：主要阵营、派系关系

### 交互叙事层(4槽位) — 描述与叙事直接相关的"软件"
- WV_09 历史脉络：关键历史事件、世界演变
- WV_10 核心冲突：矛盾根源、冲突表现
- WV_11 主要人物：核心角色、人物定位
- WV_12 叙事入口：故事切入点、读者体验目标`,
    ip_dna: IP_DNA_SLOT_BLOCK,
    worldview_archetype: "{{SKILL.worldview_archetype}}",
    style_guide: "{{SKILL.style_guide}}",
    examples: "{{SKILL.examples}}",
    constraints: "{{SKILL.constraints}}",
    output_format_hint: `## 输出要求
每个槽位至少200字详细描述。必须输出JSON格式。

## UI 风格提示词（重要）
请额外输出 ui_style_prompt.zh 和 ui_style_prompt.en，描述这个世界的"游戏 UI 视觉基调"——
将决定面板、按钮、字幕条、QTE 图标等的统一视觉风格。
- 中文示例（近未来赛博）："黑底霓虹蓝绿点缀，毛玻璃半透明面板，等宽像素字体英汉混排，UI 边框带电路纹路"
- 英文示例："black background with neon blue/green accents, frosted-glass translucent panels, monospace pixel font (Latin/CJK), UI borders with circuit patterns"
- 风格应与 WV_01 时空背景 / WV_06 文化信仰 / WV_07 科技水平 严格一致`,

    context_inputs: (ctx: NarrativeContext): string => {
      // ───────────────────────────────────────────────────────────
      // tpl-vn-v2 分支：当 vn_logline / vn_outline_acts / vn_character_bios 已生成时，
      // 它们才是世界观要服从的"叙事锚点"。RPG 范式的 initial_story_outline / core_settings
      // 在 vn-v2 路径下不存在，必须切到 vn-v2 上下文，否则 LLM 只能盲生与剧情脱钩的世界观。
      // ───────────────────────────────────────────────────────────
      if (ctx.vn_logline || ctx.vn_outline_acts || ctx.vn_character_bios) {
        const logline = ctx.vn_logline
          ? `「${ctx.vn_logline.title}」${ctx.vn_logline.content}`
          : "（无）";
        const acts = ctx.vn_outline_acts
          ? `中心主题：${ctx.vn_outline_acts.central_theme ?? "（未填）"}\n` +
            ctx.vn_outline_acts.acts
              .map((a) => `- ${a.act_id}（${a.act_name}）：${a.content}`)
              .join("\n")
          : "（无）";
        const chars = ctx.vn_character_bios?.characters
          ?.map((c) =>
            `- ${c.name}（${c.role}）：${c.identity ?? ""}；外驱=${c.external_motivation ?? "?"}；内驱=${c.internal_motivation ?? "?"}；视觉=${c.visual ?? "?"}`,
          )
          .join("\n") ?? "（无）";
        return `## 模式：互动影游 v2（tpl-vn-v2）
此次世界观服务于具体的影游剧本，必须严格围绕下面的 logline / 三幕 / 人物小传展开。
基础架构层（WV_01-WV_08）应为这些角色和情节的发生场提供合理土壤；
交互叙事层（WV_09-WV_12）的"主要人物"与"叙事入口"必须与人物小传一致。

## 一句话梗概（命题来源）⭐
${logline}

## 三幕骨架（叙事节奏的骨架）⭐
${acts}

## 人物小传（世界观必须解释这些角色为何如此）⭐
${chars}

## 用户原始需求
${ctx.user_input}`;
      }

      // ───────────────────────────────────────────────────────────
      // RPG / 通用范式分支：保留原有行为（initial_story_outline / core_settings 路径）
      // ───────────────────────────────────────────────────────────
      const prefDigest = ctx.user_preference_analysis
        ? JSON.stringify(ctx.user_preference_analysis["世界观维度"] ?? {}, null, 2)
        : "（无）";
      const gcp = ctx.global_control_params
        ? JSON.stringify(ctx.global_control_params)
        : "（无）";
      return `## 用户原始需求⭐
${ctx.user_input}

## 用户偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 用户偏好摘要（世界观维度）
${prefDigest}

## 初步大纲
${outlineToText(ctx.initial_story_outline)}

## 全局调控参数
${gcp}

## 剧情简介
${ctx.plot_synopsis?.synopsis ?? "（无）"}

## 核心设定约束（必须严格遵循！）
- 世界名称：${ctx.core_settings?.world_name ?? "未设定"}
- 主角：${ctx.core_settings?.protagonist?.name ?? "未设定"}
- 主题：${ctx.core_settings?.main_theme ?? "未设定"}`;
    },

    design_snippet: (ctx: NarrativeContext): string => buildDesignContextSnippet(ctx),

    task_instruction: `## 任务
请为每个槽位构建世界观内容。每个槽位至少200字详细描述。`,

    output_schema: `🚨 必须输出JSON格式：
{
  "world_name": "...",
  "worldview_title": "...",
  "基础架构层": {
    "WV_01_时空背景": { "description": "...", "时间纪元": "...", "地理环境": "..." },
    "WV_02_物理法则": { "description": "..." },
    "WV_03_生物生态": { "description": "..." },
    "WV_04_政治体制": { "description": "..." },
    "WV_05_经济系统": { "description": "..." },
    "WV_06_文化信仰": { "description": "..." },
    "WV_07_科技水平": { "description": "..." },
    "WV_08_势力组织": { "description": "..." }
  },
  "交互叙事层": {
    "WV_09_历史脉络": { "description": "...", "关键事件": [...] },
    "WV_10_核心冲突": { "description": "..." },
    "WV_11_主要人物": { "description": "..." },
    "WV_12_叙事入口": { "description": "..." }
  },
  "核心规则": [{ "rule_id": 1, "rule_name": "...", "rule_content": "..." }],
  "ui_style_prompt": {
    "zh": "全局UI视觉基调中文描述（含色彩/材质/字体/装饰元素）",
    "en": "global UI visual prompt (colors / materials / fonts / decorative elements)"
  }
}`,
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
};

/**
 * 当 LLM 没主动给 ui_style_prompt 时的兜底：
 *   从 WV_01 时空背景 + WV_06 文化信仰 + WV_07 科技水平 的 description 提取关键句拼接，
 *   再加固定后缀（"游戏 UI 风格"）。
 *
 * 与 LLM 主动产出的高密度 prompt 比起来粗糙，但保证 kino UIStyle.prompt 字段不为空。
 */
function buildFallbackUiStylePrompt(wv: WorldviewStructure): { zh: string; en: string } {
  const base = wv.基础架构层 ?? {};
  const pickDesc = (key: string): string => {
    const slot = base[key] as Record<string, unknown> | undefined;
    return typeof slot?.description === "string" ? slot.description.slice(0, 60) : "";
  };
  const era = pickDesc("WV_01_时空背景");
  const culture = pickDesc("WV_06_文化信仰");
  const tech = pickDesc("WV_07_科技水平");
  const zh = [era, culture, tech].filter(Boolean).join("；")
    + "（推导出的游戏 UI 视觉基调；面板、按钮、字幕条、QTE 图标统一风格）";
  const en = "Inferred game UI visual tone from worldview era / culture / tech; unified panel, button, subtitle bar, QTE icon styling";
  return { zh, en };
}

/** 输出校验（抛错触发 LLM 重试）。runner 与 legacy 共用。 */
export function validateWorldview(raw: string): void {
  const parsed = extractJSON<Record<string, unknown>>(raw);
  if (!parsed["基础架构层"] || !parsed["交互叙事层"])
    throw new Error('必须同时包含"基础架构层"和"交互叙事层"');
  if (!parsed.world_name || String(parsed.world_name).length < 2)
    throw new Error("world_name必须至少2个字符");
}

export function normalizeWorldview(wv: WorldviewStructure): WorldviewStructure {
  // ui_style_prompt 兜底：LLM 没给就从世界观槽位推导
  const raw = wv.ui_style_prompt ?? {};
  const zh = typeof raw.zh === "string" && raw.zh.trim() ? raw.zh.trim() : null;
  const en = typeof raw.en === "string" && raw.en.trim() ? raw.en.trim() : null;
  if (zh && en) {
    wv.ui_style_prompt = { zh, en };
  } else {
    const fb = buildFallbackUiStylePrompt(wv);
    wv.ui_style_prompt = { zh: zh ?? fb.zh, en: en ?? fb.en };
  }
  return wv;
}

// 仅供测试导出
export const __internal = { normalizeWorldview, buildFallbackUiStylePrompt };

export async function worldviewConstruction(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const sp = composeSystemPrompt(WORLDVIEW_COMPOSER, ctx);
  const up = composeUserPrompt(WORLDVIEW_COMPOSER, ctx);

  const raw = await llm.callWithRetry(
    sp,
    up,
    { responseFormat: "json" },
    validateWorldview,
  );

  ctx.worldview_structure = normalizeWorldview(extractJSON<WorldviewStructure>(raw));
}
