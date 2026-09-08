import type { NarrativeContext, PlotSynopsis } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { appendUserInstructions } from "./design-context-helper.js";

const SYSTEM_PROMPT = `你是一名叙事策划，请输出200-300字的剧情简介。所有输出使用中文。
输出JSON，包含：synopsis_strategy, synopsis, highlight_analysis。`;

function buildUserPrompt(ctx: NarrativeContext): string {
  const prefDigest = ctx.user_preference_analysis
    ? JSON.stringify(ctx.user_preference_analysis, null, 2)
    : "（无）";

  return `## 用户原始需求⭐
${ctx.user_input}

## 用户偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 偏好分析
${prefDigest}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

请输出JSON：
{
  "synopsis_strategy": "剧情策略描述",
  "synopsis": "200-300字剧情简介",
  "highlight_analysis": "亮点分析"
}`;
}

export async function plotSynopsis(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const raw = await llm.callWithRetry(
    SYSTEM_PROMPT,
    appendUserInstructions(buildUserPrompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<Record<string, unknown>>(r);
      if (!p.synopsis) throw new Error("缺少synopsis字段");
    },
  );

  ctx.plot_synopsis = extractJSON<PlotSynopsis>(raw);
}
