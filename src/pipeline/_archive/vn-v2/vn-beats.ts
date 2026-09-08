/**
 * E1-04：情节点搭建（线性黄金线，未分支）
 * ─────────────────────────────────────────────────────────────────
 * 场/情节点解耦（§4.6c）后：本步**不再依赖 vn_scenes**，直接从三幕骨架产出线性黄金线；
 * 每个情节点自带三维 staging（location_name/time_of_day/indoor_outdoor），beat_id 用**拓扑序临时 id**
 * （"b1"/"b2"...，不含场号）。"场"是拍摄分组，由剧情树拓扑定稿后的确定性场号导出统一分配。
 *
 * 输入：ctx.vn_outline_acts（+ 世界观/人物小传参考）
 * 输出：ctx.vn_beats = { beats: [...] }（拓扑序 id + 三维 staging）
 *
 * 此阶段为整条黄金线（理想线）：干净、紧凑、因果连贯，是下游 G-01 长出整棵剧情树的脊。
 */
import type { NarrativeContext, VnBeats } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions, buildIpSourceReference } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK, STRATEGY_SLOT_BLOCK, type PromptComposer } from "../../runtime/prompt-composer.js";
import { FIVE_ELEMENT_NOTE, STAGING_NOTE, TOPO_BEAT_ID_NOTE, getStreamEmit, getLinearBeatBudget, deriveBeatTitleFromContent } from "./_shared.js";

export const VN_BEATS_COMPOSER: PromptComposer = {
  stepId: "vn_beats",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "strategy", "ip_dna", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    role: `你是互动影游剧作师。基于三幕骨架，直接产出整条「黄金线（理想线）」——角色对世界每一次考验都做出"最理想作答"时走过的那唯一一条路。它是下游 G-01 长出整棵剧情树的**脊**，本身要干净、紧凑、因果连贯。`,

    task: (ctx: NarrativeContext) => `## 任务
- 为每一幕产出 ${getLinearBeatBudget(ctx).perAct[0]}-${getLinearBeatBudget(ctx).perAct[1]} 个情节点（复杂度档位决定；情节点节奏须服从所属幕的功能：建置 / 对抗 / 解决）
- 情节点是"剧情推进的最小单元"：一个情境 + 一个动作 + 一个明确变化
- 这是「黄金线」：只写"理想作答"的那一条单路，**保持线性、不引入任何分支**（答错/答偏的分支、挣扎、多结局全部由 G-01 剧情树改造在你这条脊上长出）
- 因为是脊不是全部，**宁可紧凑**：每个情节点都要是后续可能"被世界出题考验"的节点，不要灌水
- 情节点之间的衔接必须自然，可被读者一口气读完

${TOPO_BEAT_ID_NOTE}

${STAGING_NOTE}

## 内容写作
${FIVE_ELEMENT_NOTE}
- 每个情节点 50-100 字
- 必须显化"该情节点的剧情净增量"（之前不知道什么、现在知道了什么；之前不会做什么、现在做了什么）
- 每个情节点必须给一个 **title**：4-14 字的短标题（像章节名/镜头名，凝练概括本情节点的戏核，例如"雪夜进城""密信败露""断桥诀别"）。**title 不是正文的截取或首句复述**，而是对情节点的命名；同一部剧里各 title 应各具辨识度、不重复。`,

    output_format: `## 输出格式（严格 JSON）
{
  "beats": [
    { "beat_id": "b1", "act_id": "一", "title": "雪夜进城", "content": "约 50-100 字", "location_name": "雪山脚下的小镇市集", "time_of_day": "日", "indoor_outdoor": "外" },
    { "beat_id": "b2", "act_id": "一", "title": "客栈密谈", "content": "...", "location_name": "客栈大堂", "time_of_day": "夜", "indoor_outdoor": "内" }
  ]
}
- beat_id 按黄金线叙事顺序 b1, b2, b3... 递增；act_id 用汉字数字（一/二/…）标注所属幕。
- title 为每个情节点的短标题（4-14 字），必填。`,

    context_inputs: (ctx: NarrativeContext): string => {
      if (!ctx.vn_outline_acts) throw new Error("vn_beats 需要 ctx.vn_outline_acts（E1-02 未完成）");
      const acts = ctx.vn_outline_acts.acts
        .map((a) => `### 第${a.act_id}幕（${a.act_name}）\n${a.content}`)
        .join("\n\n");
      const logline = ctx.vn_logline
        ? `「${ctx.vn_logline.title}」${ctx.vn_logline.content}`
        : "（无）";
      const chars = ctx.vn_character_bios?.characters
        ?.map((c) => `- ${c.name}（${c.role}）：${c.identity ?? ""}；外驱=${c.external_motivation ?? "?"}；内驱=${c.internal_motivation ?? "?"}`)
        .join("\n") ?? "（无）";
      const wv = ctx.worldview_structure ? JSON.stringify(ctx.worldview_structure).slice(0, 1500) : "（无世界观）";
      return `## 三幕骨架（主输入 — 逐幕展开为线性情节点）
${acts}

## 参考：一句话梗概（保持总命题一致）
${logline}

## 参考：人物小传（情节点中出场角色的语气与动机由此决定）
${chars}

## 世界观（参考 — location 取材与道具合理性）
${wv}

## 参考：用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}`;
    },

    task_instruction: `## 任务
逐幕把三幕骨架展开为线性情节点序列（黄金线）。每个情节点须如实标注三维 staging（地点/日夜/内外），beat_id 用拓扑序 b1、b2… 递增，不要编场号。`,
  },
};

const AS_DAY = new Set(["日", "夜"]);
const AS_IO = new Set(["内", "外"]);

function validate(beats: VnBeats): void {
  if (!Array.isArray(beats?.beats) || beats.beats.length === 0) {
    throw new Error("beats 不能为空");
  }
  const seen = new Set<string>();
  beats.beats.forEach((b, idx) => {
    if (!/^b\d+$/.test(b.beat_id)) {
      throw new Error(`beats[${idx}].beat_id 必须为拓扑序 "b<数字>" 格式（不含场号）：${b.beat_id}`);
    }
    if (seen.has(b.beat_id)) throw new Error(`beat_id 重复：${b.beat_id}`);
    seen.add(b.beat_id);
    if (!b.content?.trim()) throw new Error(`beats[${idx}].content 不能为空`);
    if (!b.location_name?.trim()) throw new Error(`beats[${idx}].location_name 不能为空（三维 staging 必填）`);
    if (!AS_DAY.has(b.time_of_day ?? "")) throw new Error(`beats[${idx}].time_of_day 必须为 "日"/"夜"：${b.time_of_day}`);
    if (!AS_IO.has(b.indoor_outdoor ?? "")) throw new Error(`beats[${idx}].indoor_outdoor 必须为 "内"/"外"：${b.indoor_outdoor}`);
  });
}

export async function vnBeats(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_BEATS_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_BEATS_COMPOSER, ctx), ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => validate(extractJSON<VnBeats>(r)),
    streamEmit,
  );

  const parsed = extractJSON<VnBeats>(raw);
  // 标题兜底：LLM 未给 title 时从正文派生一个短标题，保证每个情节点都有可展示的标题
  //（前端剧情树标题位不再回落成正文首句）。
  for (const b of parsed.beats) {
    if (!b.title?.trim()) b.title = deriveBeatTitleFromContent(b.content, b.beat_id);
  }
  ctx.vn_beats = parsed;
}
