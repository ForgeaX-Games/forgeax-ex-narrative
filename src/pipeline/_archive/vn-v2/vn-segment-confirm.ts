/**
 * E2-02：影游化文本段确认（截取 + 重新分幕）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/06_影游化文本段确认.md 对齐。
 *
 * 仅在 E2 路径（ctx.vn_script_normalized 已生成）时执行。
 *
 * 职责：
 *   1. 从 vn_script_normalized 中截取适合影游单次体验的文本段（约 10-20 场）
 *   2. 把截取段视为"完整剧本"，按三幕式重新分幕（幕的判定以截取段为锚点）
 *   3. 已有原文一字不改地保留；新增"幕"标号或场补全可视为预处理操作
 *   4. 完成后将 acts/scenes/beats 落到 ctx.vn_segment_confirmed
 *      并把对应 acts/scenes/beats 同步覆盖写入 ctx.vn_outline_acts/vn_scenes/vn_beats
 *      使后续 G-01 ~ G-03 像走 E1 路径一样无缝衔接。
 */
import type {
  NarrativeContext,
  VnSegmentConfirmed,
  VnOutlineActs,
  VnScenes,
  VnBeats,
  VnCharacterBios,
  VnKeyItems,
  VnUnitActMap,
} from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../../runtime/prompt-composer.js";
import { NUMBERING_NOTE, ORIGINALITY_NOTE, getStreamEmit } from "./_shared.js";

// ── 分段策略（两种，视是否有章→幕锚定映射切换）────────────────────────────
/** 自由截取分幕（默认/普通 VN 无 IP 单元锚定时）：截 10-20 场 + 重新三幕。 */
const FREE_SEGMENT_TASK = `## 截取原则
- 单次影游体验：约 10-20 场（具体看节奏密度，但不要超过 25 场）
- 优先选择"主角面临关键抉择 / 高冲突 / 强情绪曲线"的段落
- 截取段必须能独立成戏（自有起点 / 中段 / 落点；不要从大事件中段截断）
- 原文一字不改地保留（preserved=true）；如必须新增承接句以保证截取段独立成立，preserved=false 并明确标注

## 重新分幕（关键）
- 以"截取段"作为新的完整剧本，重新按三幕式划分（一/二/三）
- 这意味着原文可能有一个"幕"概念，截取后这个旧的幕概念失效，需要在新边界上重新划幕
- 同步重新归并场（保留 location_name / 日夜 / 内外 三维状态）
- 同步重新编号 beat_id（从 1.1 起重排，不复用上传剧本的旧编号）`;

/** 章→幕锚定分幕（P1-1，IP 改编有 vn_unit_act_map 时）：忠实源单元边界、覆盖全部、密度展开。 */
function unitAnchoredTask(map: VnUnitActMap): string {
  const n = map.acts.length;
  const ids = map.acts.map((a) => a.actId).join("/");
  return `## 章→幕锚定（IP 改编：忠实源作章节边界，覆盖全部源内容）
本剧本已按 IP 提取的最小叙事单元规划为 **${n} 幕**，每一幕锚定给定的源单元（见下方用户块[幕锚定映射]）。请：
- **恰好产出 ${n} 幕**（幕号 ${ids}），逐幕忠实展开其对应源单元的事件脉络；
- **保留源作章节边界作为幕边界**（一个源单元 = 一幕；不要合并或拆散给定的幕锚定）；
- **覆盖全部源内容，严禁"只取 10-20 场"式截断丢弃**任何源单元（selected_range 覆盖首末幕全域）；
- 每幕内**按信息密度**产出情节点：事件多/冲突强的幕多产出情节点、平淡的幕少产出（scenes/beats 数量随之变化，不要平均摊派）；
- 原文一字不改地保留（preserved=true）；同步归并场（location_name/日夜/内外 三维），beats 从 1.1 起按幕内顺序重排。`;
}

/** [幕锚定映射] 用户块：逐幕给出源单元标题/角色/场景/事件脉络，供 LLM 忠实展开。 */
function buildUnitActScaffold(ctx: NarrativeContext): string {
  const map = ctx.vn_unit_act_map;
  if (!map || map.acts.length === 0) return "";
  const lines = map.acts.map(
    (a) =>
      `### 第${a.actId}幕 ← 源单元《${a.title}》\n- 主要角色：${a.characters.join("、") || "（见原文）"}\n- 主要场景：${a.scene || "（见原文）"}\n- 事件脉络：${a.summary || "（见原文）"}`,
  );
  return `## [幕锚定映射]（每幕忠实对应以下源单元，逐幕展开、覆盖全部；勿新增/丢弃幕）\n${lines.join("\n\n")}`;
}

const VN_SEGMENT_CONFIRM_COMPOSER: PromptComposer = {
  stepId: "vn_segment_confirm",
  skillSlots: [],
  systemBlockOrder: ["role", "task", "output_format"],
  userBlockOrder: ["unit_act_scaffold", "context_inputs", "task_instruction"],
  blocks: {
    role: `你是互动影游"剧本截取与改编"工程师。从用户上传的非标准剧本中切出"影游化"的子剧本，并同步抽取人物小传。`,

    // P1-1：章→幕锚定映射（仅 IP 改编有 vn_unit_act_map 时非空；普通 VN 为空串、行为不变）。
    unit_act_scaffold: (ctx: NarrativeContext) => buildUnitActScaffold(ctx),

    task: (ctx: NarrativeContext) => {
      const map = ctx.vn_unit_act_map;
      const seg = map && map.acts.length > 0 ? unitAnchoredTask(map) : FREE_SEGMENT_TASK;
      return `${seg}

## 人物小传抽取（E2 路径补 E1-02 的产物）
- 从截取段的台词与动作描写中识别全部出场角色
- 至少 3 人：主角 + 1 反派/对立 + 1 关键关系人
- 每人字段：name / role / identity / external_motivation / internal_motivation / arc / voice / visual
- 严禁创作不在原文出现的角色；motivation / arc 等可基于原文行为推断（如台词、动作暗含）
- voice 描述应贴近原文台词节奏与词汇偏好

## 关键道具抽取（E2 路径补 E1-02 的 key_items 产物，供 G-01/G-02 把道具当叙事抓手）
- 从截取段中识别"真正驱动剧情"的关键道具（信物 / 武器 / 线索 / 契约物 / 媒介 / 遗物…），而非背景摆设
- 每件字段：name / category / description / narrative_function / bound_character（呼应人物名）/ act_appearance（["一","二","三"] 子集）/ symbolism
- 严禁创作原文不存在的道具；若截取段确无明显关键道具，key_items 可省略或留空数组

${ORIGINALITY_NOTE}

${NUMBERING_NOTE}`;
    },

    output_format: `## 输出格式（严格 JSON）
{
  "selected_range": { "start": "起始位置标识（原文 segment_id 或 beat_id）", "end": "..." },
  "preserved": true,
  "acts": [ { "act_id": "一", "act_name": "建置", "content": "..." } ],
  "scenes": [ { "scene_id": "1", "act_id": "一", "location_name": "...", "time_of_day": "日", "indoor_outdoor": "外", "content": "...", "is_main_line": true } ],
  "beats": [ { "beat_id": "1.1", "scene_id": "1", "content": "..." } ],
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
        "narrative_function": "在剧情中的具体作用",
        "bound_character": "主角名（与 character_bios 呼应）",
        "act_appearance": ["二", "三"],
        "symbolism": "..."
      }
    ]
  }
}`,

    context_inputs: (ctx: NarrativeContext): string => {
      const norm = ctx.vn_script_normalized;
      if (!norm) throw new Error("vn_segment_confirm 需要 ctx.vn_script_normalized（E2-01 未完成）");
      return `## E2-01 预处理产出
${JSON.stringify(norm, null, 2).slice(0, 8000)}

## 用户原始需求（参考，决定截取偏好）
${ctx.user_input}`;
    },

    task_instruction: `## 任务
按系统提示词的截取原则与重新分幕规则输出 JSON。`,
  },
};

function validate(parsed: VnSegmentConfirmed, expectedActs?: number): void {
  if (!parsed.selected_range?.start || !parsed.selected_range?.end) {
    throw new Error("selected_range.start/end 不能为空");
  }
  // 开放幕数（§4.6）：重新分幕至少 2 幕，不再硬性要求恰好三幕。
  if (!Array.isArray(parsed.acts) || parsed.acts.length < 2) {
    throw new Error("acts 至少 2 项（重新分幕，开放幕数）");
  }
  // P1-1：章→幕锚定时要求恰好 N 幕（每源单元一幕，忠实章边界、覆盖全部），触发重试直至合规。
  if (expectedActs && expectedActs >= 2 && parsed.acts.length !== expectedActs) {
    throw new Error(`章→幕锚定要求恰好 ${expectedActs} 幕（每源单元一幕），实际 ${parsed.acts.length} 幕`);
  }
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error("scenes 不能为空");
  }
  if (!Array.isArray(parsed.beats) || parsed.beats.length === 0) {
    throw new Error("beats 不能为空");
  }
  // E2 路径补 E1-02 的人物小传产物（G-01 / G-02 必需）
  if (!parsed.character_bios || !Array.isArray(parsed.character_bios.characters) || parsed.character_bios.characters.length < 1) {
    throw new Error("character_bios.characters 至少 1 人（E2 路径必须从原文抽取角色）");
  }
  parsed.character_bios.characters.forEach((c, idx) => {
    if (!c.name?.trim()) throw new Error(`character_bios.characters[${idx}].name 不能为空`);
    if (!c.external_motivation?.trim() || !c.internal_motivation?.trim()) {
      throw new Error(`character_bios.characters[${idx}] 必须包含 external_motivation 与 internal_motivation`);
    }
  });
}

export async function vnSegmentConfirm(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);
  // P1-1：章→幕锚定时，幕数须等于源单元数（每源单元一幕）；无锚定则沿用开放幕数（≥2）。
  const expectedActs = ctx.vn_unit_act_map?.acts.length;

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_SEGMENT_CONFIRM_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_SEGMENT_CONFIRM_COMPOSER, ctx), ctx),
    { temperature: 0.4, responseFormat: "json" },
    (r) => validate(extractJSON<VnSegmentConfirmed>(r), expectedActs),
    streamEmit,
  );

  const parsed = extractJSON<VnSegmentConfirmed>(raw);
  ctx.vn_segment_confirmed = parsed;

  // 同步覆盖到 E1 路径的标准字段，让 G-01 ~ G-03 无差别消费
  const inferredTheme = parsed.acts
    ?.map(a => a.act_name ?? "")
    .filter(Boolean)
    .join(" → ") || undefined;
  const oa: VnOutlineActs = {
    title: ctx.vn_logline?.title ?? "影游剧本",
    central_theme: ctx.vn_outline_acts?.central_theme ?? inferredTheme,
    acts: parsed.acts,
  };
  const sc: VnScenes = { scenes: parsed.scenes };
  const bt: VnBeats = { beats: parsed.beats };
  ctx.vn_outline_acts = oa;
  ctx.vn_scenes = sc;
  ctx.vn_beats = bt;

  // E2 路径补人物小传：让 G-01 / G-02 不至于面对空 character_bios
  if (parsed.character_bios) {
    const cb: VnCharacterBios = parsed.character_bios;
    ctx.vn_character_bios = cb;
  }

  // E2 路径补关键道具：与 E1-02 的 vn_key_items 对齐，让 G-01/G-02 两路都拿得到叙事抓手
  if (parsed.key_items && Array.isArray(parsed.key_items.items) && parsed.key_items.items.length > 0) {
    const ki: VnKeyItems = parsed.key_items;
    ctx.vn_key_items = ki;
  }
}
