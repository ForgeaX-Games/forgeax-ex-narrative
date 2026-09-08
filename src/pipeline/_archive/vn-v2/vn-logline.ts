/**
 * E1-01：用户需求预处理（一句话故事梗概）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/01_用户需求预处理.md 对齐。
 *
 * 输入：user_input（含已拼接的 uploaded_script）
 * 输出：ctx.vn_logline = { title, content }
 *
 * content 字段为五要素融合的单段叙述（人物 / 情境 / 动机 / 行为 / 结果）。
 */
import type { NarrativeContext, VnLogline } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions } from "../../steps/design-context-helper.js";
import {
  composeSystemPrompt,
  composeUserPrompt,
  STRATEGY_SLOT_BLOCK,
  type PromptComposer,
} from "../../runtime/prompt-composer.js";
import {
  buildUploadedScriptSnippet,
  FIVE_ELEMENT_NOTE,
  getStreamEmit,
} from "./_shared.js";

export const VN_LOGLINE_COMPOSER: PromptComposer = {
  stepId: "vn_logline",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "strategy", "cot", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    cot: `## 机制与流程
1. 通读用户原始需求，认准他真正想体验的是什么。
2. 若有上传剧本素材，从中提取核心故事线，沿用原作的人名与设定。
3. 按五要素构思梗概，五者要在一段话里互相咬合，不做罗列。
4. 合成为连贯的一段叙述，读起来是故事而不是提纲。
5. 自检：五要素是否齐全？字数是否合规？有没有混入游戏机制词？有没有编造原作里没有的人名？`,
    strategy: STRATEGY_SLOT_BLOCK,
    role: `你是互动影游叙事策划。任务是把用户的口头需求与（可选的）上传剧本浓缩为一份"一句话故事梗概"。

## 角色定位
- 影游 = 一款剧情驱动的游戏。你的产出会成为后续 E1-02 三幕扩写的唯一锚点。
- 不是小说梗概，不是营销文案；是导演与编剧拿到就能开拍的"故事浓缩"。`,

    task: `## 必含元素（全部融合在 content 字段一段叙述里）
1. 人物（characters）：主角与至少 1 个关键关系人
2. 情境（situation）：故事发生的时空背景与紧迫窗口
3. 动机（motivation）：主角为何踏上这段旅程（外驱 + 内驱合一）
4. 行为（action）：主角将采取的关键行动方向
5. 结果（outcome）：故事追问的最终命题或预设的高潮

${FIVE_ELEMENT_NOTE}

## 写作纪律
- 中文输出，长度 100-180 字
- 不要列要点 / 不要分行 / 不要使用书名号外的修饰符
- 严禁编造用户未提及的具体姓名、地点；这些信息留给 E1-02 扩写阶段补全（可用"主角"/"导师"/"故乡小镇"等占位）
- 严禁出现"系统/任务/关卡/数值"等游戏机制词；这是叙事文档`,

    output_format: `## 输出格式（严格 JSON）
{
  "title": "故事标题（用户未给则起一个 6-12 字的中文标题）",
  "content": "五要素融合的一段叙述"
}`,

    context_inputs: (ctx: NarrativeContext): string => {
      const upload = buildUploadedScriptSnippet(ctx);
      const parts: string[] = [
        `## 用户原始需求\n${ctx.user_input}`,
      ];
      if (upload) parts.push(upload);
      return parts.join("\n\n");
    },

    task_instruction: `## 任务\n基于上述需求与（如有）上传素材，输出"一句话故事梗概"的 JSON。`,
  },
};

export async function vnLogline(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_LOGLINE_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_LOGLINE_COMPOSER, ctx), ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => {
      const parsed = extractJSON<VnLogline>(r);
      if (!parsed.title?.trim()) throw new Error("缺少 title");
      if (!parsed.content?.trim()) throw new Error("缺少 content");
      if (parsed.content.length < 60) throw new Error("content 过短（要求 100-180 字）");
    },
    streamEmit,
  );

  ctx.vn_logline = extractJSON<VnLogline>(raw);
}
