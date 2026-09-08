/**
 * E1-02 三幕扩写：单步三输出（三幕 + 人物小传 + 关键道具）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/02_故事梗概扩写.md 对齐。
 *
 * 输入：ctx.vn_logline + ctx.user_input
 * 输出：
 *   - ctx.vn_outline_acts     = { title, central_theme, acts: [一/二/三] }
 *   - ctx.vn_character_bios   = { characters: [...] }
 *   - ctx.vn_key_items        = { items: [...] }
 *
 * 单次 LLM 调用产出三份 JSON 子结构（在同一个根对象里），落地时拆开写入三个字段，
 * 由 STEP_COMPANIONS 一并落盘成独立产物文件。
 */
import type {
  NarrativeContext,
  VnOutlineActs,
  VnCharacterBios,
  VnKeyItems,
} from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions, buildIpSourceReference } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK, STRATEGY_SLOT_BLOCK, type PromptComposer } from "../../runtime/prompt-composer.js";
import { FIVE_ELEMENT_NOTE, getStreamEmit, getVnBudget } from "./_shared.js";

interface CombinedOutput {
  outline_acts: VnOutlineActs;
  character_bios: VnCharacterBios;
  key_items: VnKeyItems;
}

// ── 开放幕数支持（§4.6 VN 适配）──────────────────────────────────────
const CN_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 第 n 幕的汉字编号（1-based）。 */
export function actNumeral(n: number): string {
  return CN_NUMERALS[n - 1] ?? String(n);
}

/** 解析目标幕数：ctx.vn_target_act_count 优先（clamp 2..10），缺省 3 幕（向后兼容）。 */
export function resolveActCount(ctx: NarrativeContext): number {
  const n = ctx.vn_target_act_count;
  if (typeof n === "number" && Number.isFinite(n) && n >= 2) return Math.min(10, Math.round(n));
  return 3;
}

/** 复杂度档位（1-4）→ 建议幕数区间（软约束，仅用于提示引导，不做幕数精确校验）。 */
const ACT_RANGE_BY_LEVEL: Record<number, [number, number]> = {
  1: [2, 3], // 极简
  2: [3, 4], // 短篇
  3: [3, 5], // 标准
  4: [4, 7], // 丰富（史诗已在 resolveVnComplexity 封顶到丰富）
};

/**
 * 解析幕数区间（§4.6 开放幕数 · 软约束）：
 *   - 显式给定 vn_target_act_count（IP 改编：幕数=源单元数）→ 精确区间 [t, t]，须忠实
 *   - 否则按复杂度档位取建议区间 [min, max]，由 LLM 依剧情繁简在区间内自定；缺省档为标准 [3,5]
 */
export function resolveActRange(ctx: NarrativeContext): { min: number; max: number; explicit: boolean } {
  const n = ctx.vn_target_act_count;
  if (typeof n === "number" && Number.isFinite(n) && n >= 2) {
    const t = Math.min(10, Math.round(n));
    return { min: t, max: t, explicit: true };
  }
  const [min, max] = ACT_RANGE_BY_LEVEL[getVnBudget(ctx).level] ?? [3, 5];
  return { min, max, explicit: false };
}

/** 期望的幕编号序列（一..N）。 */
function expectedActIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => actNumeral(i + 1));
}

/** 固定幕数的逐幕"职能"指引（用于 IP 改编等幕数精确场景）。 */
function buildFixedActSpec(count: number): string {
  if (count <= 1) return `- 一（单幕）：完整起承转合，约 400 字。`;
  const lines: string[] = [];
  lines.push(`- ${actNumeral(1)}（建置）：约 150 字。介绍主角处境、关键关系、世界规则、推动主角离开常态的引爆事件`);
  for (let i = 2; i < count; i++) {
    lines.push(`- ${actNumeral(i)}（对抗/发展）：约 300 字。主角的连续尝试与挫折，反派/阻力逐步显影，至少 1 个低谷或反转`);
  }
  lines.push(`- ${actNumeral(count)}（解决）：约 150 字。最终对峙与代价；为后续"剧情树改造"留出可分支的高潮空间`);
  return lines.join("\n");
}

/** 区间幕数的"职能范式"指引（软约束：幕数由 LLM 依剧情在 [min,max] 内自定）。 */
function buildRangeActSpec(min: number, max: number): string {
  const midLo = Math.max(1, min - 2);
  const midHi = Math.max(midLo, max - 2);
  return [
    `- 首幕（建置）：约 150 字。介绍主角处境、关键关系、世界规则、推动主角离开常态的引爆事件`,
    `- 中间幕（对抗 / 发展，共 ${midLo}-${midHi} 幕）：每幕约 300 字。主角连续尝试与挫折、反派/阻力逐步显影，每幕至少 1 个低谷或反转；戏够就收、不足才增`,
    `- 末幕（解决）：约 150 字。最终对峙与代价；为后续"剧情树改造"留出可分支的高潮空间`,
    `- 幕数为**软约束**：建议 ${min}-${max} 幕，依剧情繁简自定——宁精勿凑，既不为凑数注水，也不必硬压成固定三幕`,
  ].join("\n");
}

export const VN_OUTLINE_ACTS_COMPOSER: PromptComposer = {
  stepId: "vn_outline_acts",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "strategy", "ip_dna", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    role: (ctx: NarrativeContext): string => {
      const { min, max, explicit } = resolveActRange(ctx);
      const clause = explicit ? `严格 ${min} 幕` : `${min}-${max} 幕（依剧情繁简自定，软约束）`;
      return `你是互动影游主笔。基于 logline，扩写出${clause}剧本骨架、全员人物小传与贯穿剧情的关键道具。`;
    },

    task: (ctx: NarrativeContext): string => {
      const { min, max, explicit } = resolveActRange(ctx);
      const ids = expectedActIds(explicit ? min : max);
      const actStructure = explicit ? buildFixedActSpec(min) : buildRangeActSpec(min, max);
      const headline = explicit
        ? `严格 ${min} 幕，不允许新增或删减幕`
        : `建议 ${min}-${max} 幕（软约束，依剧情繁简在区间内自定；至少 2 幕，首幕建置、末幕解决）`;
      return `## 幕结构（${headline}；幕编号用连续汉字 一/二/三…，从"一"起不跳号）
${actStructure}

## 双轮驱动（必须在各幕中显化）
- 外驱（external_motivation）：来自世界事件、他人压力、时间窗口的外部紧迫
- 内驱（internal_motivation）：主角的性格缺陷、未愈伤口、价值观挣扎
- 两者须在中段交叉、末幕收束

## 人物小传（最少 3 人：主角 + 1 反派/对立 + 1 关键关系人）
每人必须包含：
- name / role（主角/反派/对立/导师/挚友/旁观…）
- identity（社会身份、年龄、外形特征极简描述）
- external_motivation / internal_motivation（双轮驱动）
- arc（人物弧光：从 X 到 Y）
- voice（说话风格描述：节奏 / 词汇偏好 / 情绪基调）
- visual（视觉关键词：服装 / 标志性配饰 / 体态）

## 关键道具（最少 2 件，必须真正驱动剧情而非装饰）
道具是叙事的"硬抓手"——它制造目标、转折与象征。每件必须包含：
- name（道具名）/ category（信物 / 武器 / 线索 / 契约物 / 媒介 / 遗物…）
- description（外形、来历、质感，可被镜头看见）
- narrative_function（在剧情中的具体作用：推动 / 转折 / 揭示真相 / 制造制约 / 完成代价）——必须能与具体幕的事件挂钩
- bound_character（关联人物，需与人物小传中的 name 呼应；若为无主线索可留空）
- act_appearance（出现/起关键作用的幕，用连续汉字幕号的子集，如 ["${ids[0]}"${ids[1] ? `, "${ids[1]}"` : ""}]）
- symbolism（象征意涵：道具如何外化主角的内驱或中心主题）
要求：至少 1 件道具贯穿后半程并在**末幕**的对峙/代价中扮演关键角色。

${FIVE_ELEMENT_NOTE}

## 编号约定（本步骤产出）
- act_id：使用连续汉字数字序列 一 / 二 / 三 …（从"一"起，顺序连续、不跳号、不用英文）
- act_name：建置 / 对抗 / 发展 / 解决（或保留同义中文，不允许英文）`;
    },

    output_format: (ctx: NarrativeContext): string => {
      const { min, max, explicit } = resolveActRange(ctx);
      const sampleCount = explicit ? min : Math.min(max, Math.max(min, 3));
      const ids = expectedActIds(sampleCount);
      const actLines = ids
        .map((id, i) => {
          const name = i === 0 ? "建置" : i === sampleCount - 1 ? "解决" : "对抗";
          const hint = i === 0 ? "约 150 字的五要素融合段落" : i === sampleCount - 1 ? "约 150 字" : "约 300 字";
          return `      { "act_id": "${id}", "act_name": "${name}", "content": "${hint}" }`;
        })
        .join(",\n");
      const countRule = explicit
        ? `acts 恰好 ${min} 幕`
        : `acts 数量依剧情在 ${min}-${max} 幕间自定（下方示例为 ${sampleCount} 幕，仅示意；act_id 须从"一"起连续汉字编号）`;
      const sample = ids.length >= 2 ? [ids[ids.length - 2], ids[ids.length - 1]] : [ids[0]];
      return `## 输出格式（严格 JSON，单一根对象包含三个子结构；${countRule}）
{
  "outline_acts": {
    "title": "故事标题（沿用 logline.title 或微调）",
    "central_theme": "作品中心主题（一句话，如：复仇是否能换回失去的）",
    "acts": [
${actLines}
    ]
  },
  "character_bios": {
    "characters": [
      {
        "name": "...", "role": "主角",
        "identity": "...",
        "external_motivation": "...", "internal_motivation": "...",
        "arc": "从 X 到 Y", "voice": "...", "visual": "..."
      }
    ]
  },
  "key_items": {
    "items": [
      {
        "name": "...", "category": "信物",
        "description": "外形 / 来历 / 质感",
        "narrative_function": "在中段推动主角揭开真相，在末幕成为换取代价的筹码",
        "bound_character": "主角名（与 character_bios 呼应）",
        "act_appearance": [${sample.map((a) => `"${a}"`).join(", ")}],
        "symbolism": "..."
      }
    ]
  }
}`;
    },

    context_inputs: (ctx: NarrativeContext): string => {
      const logline = ctx.vn_logline;
      if (!logline) {
        throw new Error("vn_outline_acts 需要 ctx.vn_logline 已生成（E1-01 未完成）");
      }
      return `## 一句话故事梗概（来自 E1-01）
- 标题：${logline.title}
- 内容：${logline.content}

## 用户原始需求（参考）
${ctx.user_input}
${buildIpSourceReference(ctx)}`;
    },

    task_instruction: (ctx: NarrativeContext): string => {
      const { min, max, explicit } = resolveActRange(ctx);
      const clause = explicit ? `严格 ${min} 幕` : `${min}-${max} 幕（软约束，依剧情繁简自定）`;
      return `## 任务
基于上述 logline 扩写：(1) ${clause} 剧本骨架；(2) 全员人物小传；(3) 贯穿剧情的关键道具。三者在同一份 JSON 中分别落到 outline_acts / character_bios / key_items 三个键。关键道具须与各幕事件、人物驱动真正咬合，不得是可有可无的摆设。`;
    },
  },
};

function validateOutput(
  parsed: CombinedOutput,
  range: { min: number; max: number; explicit: boolean } = { min: 2, max: 10, explicit: false },
): void {
  const oa = parsed.outline_acts;
  if (!oa?.title?.trim()) throw new Error("缺少 outline_acts.title");
  if (!Array.isArray(oa.acts) || oa.acts.length < 2) {
    throw new Error("acts 至少 2 幕");
  }
  // 幕数软约束：普通路径不因落在建议区间外而失败（只保证 ≥2 幕、编号连续、内容非空 + 防跑飞上限）；
  // IP 改编（explicit）幕数=源单元数，须精确校验。
  if (range.explicit && oa.acts.length !== range.min) {
    throw new Error(`IP 改编需恰好 ${range.min} 幕（幕数=源单元数）`);
  }
  if (oa.acts.length > 10) {
    throw new Error(`acts 幕数过多（${oa.acts.length}），至多 10 幕`);
  }
  const expected = expectedActIds(oa.acts.length);
  oa.acts.forEach((act, idx) => {
    if (act.act_id !== expected[idx]) {
      throw new Error(`acts[${idx}].act_id 必须为 "${expected[idx]}"（幕号须从"一"起连续汉字）`);
    }
    if (!act.content?.trim()) throw new Error(`acts[${idx}].content 不能为空`);
  });

  const cb = parsed.character_bios;
  if (!Array.isArray(cb?.characters) || cb.characters.length < 1) {
    throw new Error("character_bios.characters 至少 1 人");
  }
  cb.characters.forEach((c, idx) => {
    if (!c.name?.trim()) throw new Error(`characters[${idx}].name 不能为空`);
    if (!c.external_motivation?.trim() || !c.internal_motivation?.trim()) {
      throw new Error(`characters[${idx}] 必须包含 external_motivation 与 internal_motivation`);
    }
  });

  const ki = parsed.key_items;
  if (!Array.isArray(ki?.items) || ki.items.length < 1) {
    throw new Error("key_items.items 至少 1 件关键道具");
  }
  ki.items.forEach((it, idx) => {
    if (!it.name?.trim()) throw new Error(`key_items[${idx}].name 不能为空`);
    if (!it.description?.trim()) throw new Error(`key_items[${idx}].description 不能为空`);
    if (!it.narrative_function?.trim()) {
      throw new Error(`key_items[${idx}].narrative_function 不能为空（道具必须驱动剧情）`);
    }
  });
}

export async function vnOutlineActs(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);
  const actRange = resolveActRange(ctx);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_OUTLINE_ACTS_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_OUTLINE_ACTS_COMPOSER, ctx), ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => validateOutput(extractJSON<CombinedOutput>(r), actRange),
    streamEmit,
  );

  const parsed = extractJSON<CombinedOutput>(raw);
  ctx.vn_outline_acts = parsed.outline_acts;
  ctx.vn_character_bios = parsed.character_bios;
  ctx.vn_key_items = parsed.key_items;
}
