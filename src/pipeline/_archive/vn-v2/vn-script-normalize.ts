/**
 * E2-01：用户剧本预处理
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/05_用户剧本预处理.md 对齐。
 *
 * 仅在用户上传了剧本（ctx.uploaded_script.content 存在）时启用。
 *
 * 输入：ctx.uploaded_script
 * 输出：ctx.vn_script_normalized = {
 *   source_format,
 *   inferred_layers: { has_acts, has_scenes, has_beats },
 *   acts? / scenes? / beats?,
 *   raw_segments?
 * }
 *
 * 关键职责：
 *   1. 识别上传文本的层级覆盖度（缺幕？缺场？缺情节点？）
 *   2. 已有原文一字不改地解析进对应层级
 *   3. 缺失的上层概念（如缺幕）从下层归并推断；缺失的下层（如缺情节点）由内容拆分
 *   4. 不做任何"二创"——这是预处理而非创作
 */
import type {
  NarrativeContext,
  VnScriptNormalized,
} from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../../runtime/prompt-composer.js";
import { NUMBERING_NOTE, ORIGINALITY_NOTE, getStreamEmit } from "./_shared.js";

const VN_SCRIPT_NORMALIZE_COMPOSER: PromptComposer = {
  stepId: "vn_script_normalize",
  skillSlots: [],
  systemBlockOrder: ["role", "task", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: `你是互动影游剧本预处理工程师。任务是把用户上传的非标准剧本规整为统一层级结构。

## 角色定位
- 你是"分析师"，不是"作者"。本步骤严禁创作 / 改写 / 增删原文台词与描写。
- 唯一允许的操作是：识别层级、归并、拆分、补充缺失层级的概念。`,

    task: `## 层级覆盖判断
依次判断上传文本是否包含：
- has_acts：是否分幕（即使只有"第一幕/第二幕"等显式标记）
- has_scenes：是否分场（地点/时间/内外切换是否被显式分段）
- has_beats：是否分情节点（一个场内是否有可见的子段落断点）

## 处理规则
- 已有层级：保留原文（一字不改）
- 缺失"上层"层级（如有场无幕）：根据三维场状态聚合推断幕的边界（不创作幕的描述，仅给 act_id 标号）
- 缺失"下层"层级（如有场无情节点）：依据内容自然段拆出情节点（不创作新内容）
- 完全无结构的纯散文：raw_segments 字段保留段落原文，acts/scenes/beats 留空，由 E2-02 决定

${ORIGINALITY_NOTE}

${NUMBERING_NOTE}`,

    output_format: `## 输出格式（严格 JSON）
{
  "source_format": "json|fountain|markdown|dialogue|prose",
  "inferred_layers": { "has_acts": true, "has_scenes": true, "has_beats": false },
  "acts": [ { "act_id": "一", "act_name": "建置", "content": "原文片段或一句概括" } ],
  "scenes": [ { "scene_id": "1", "act_id": "一", "location_name": "...", "time_of_day": "日|夜", "indoor_outdoor": "内|外", "content": "原文片段", "is_main_line": true } ],
  "beats": [ { "beat_id": "1.1", "scene_id": "1", "content": "原文片段" } ],
  "raw_segments": [ { "id": "seg_1", "text": "无法归类的纯散文段落原文" } ]
}

未识别到的层级允许整段省略；至少要有 source_format 与 inferred_layers。`,

    context_inputs: (ctx: NarrativeContext): string => {
      const u = ctx.uploaded_script;
      if (!u?.content) {
        throw new Error("vn_script_normalize 需要 ctx.uploaded_script.content（用户未上传剧本时不应执行此步骤）");
      }
      return `## 上传剧本元数据
- 格式：${u.format}
- 字数：${u.char_count}
${u.description ? `- 描述：${u.description}\n` : ""}
## 上传剧本原文
${u.content}`;
    },

    task_instruction: `## 任务
分析上述剧本，按系统提示词的层级覆盖判断 + 处理规则输出 JSON。`,
  },
};

function validate(parsed: VnScriptNormalized): void {
  const validFormats = ["json", "fountain", "markdown", "dialogue", "prose"];
  if (!validFormats.includes(parsed.source_format)) {
    throw new Error(`source_format 非法：${parsed.source_format}`);
  }
  if (!parsed.inferred_layers) throw new Error("缺少 inferred_layers");
  // 至少要识别到一种层级或保留 raw_segments
  const anyLayer =
    !!parsed.acts?.length || !!parsed.scenes?.length || !!parsed.beats?.length || !!parsed.raw_segments?.length;
  if (!anyLayer) {
    throw new Error("acts / scenes / beats / raw_segments 至少有一项不为空");
  }
}

export async function vnScriptNormalize(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_SCRIPT_NORMALIZE_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_SCRIPT_NORMALIZE_COMPOSER, ctx), ctx),
    { temperature: 0.3, responseFormat: "json" },
    (r) => validate(extractJSON<VnScriptNormalized>(r)),
    streamEmit,
  );

  ctx.vn_script_normalized = extractJSON<VnScriptNormalized>(raw);
}
