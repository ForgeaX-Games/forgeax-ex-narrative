/**
 * D2: 玩法设计 — 每个系统模块独立生成详细设计，6 个一批并行，最后合并
 */
import type { NarrativeContext } from "../../types/index.js";
import type { SystemDetails, SystemDesignEntry } from "../../types/game-design.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { formatSkillSummaries } from "../../knowledge/game-design/system-skill-registry.js";
import { appendUserInstructions } from "../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../runtime/prompt-composer.js";

const PARALLEL_BATCH = 6;

interface SystemEntry {
  id: string;
  name: string;
  priority: string;
}

function buildSystemDetailComposer(
  target: SystemEntry,
  allSystems: SystemEntry[],
): PromptComposer {
  return {
    stepId: "system_detail",
    skillSlots: ["constraints"],
    systemBlockOrder: ["role", "output_format"],
    userBlockOrder: ["context_inputs", "task_instruction"],
    blocks: {
      role: "你是一位游戏系统策划，擅长为游戏系统模块撰写清晰的设计文档。",

      output_format: `## 输出要求（严格JSON，只输出这一个系统）

{
  "id": "${target.id}",
  "name": "${target.name}",
  "loop_role": "该系统在玩法循环/资源循环中的角色",
  "design_brief": "设计概述(100-200字)",
  "key_features": ["核心特性1", "核心特性2", "..."],
  "data_structures": {"主要数据结构名": "简要描述"},
  "interactions": [
    {"system_id": "交互系统ID", "interaction": "交互方式描述"}
  ],
  "implementation_notes": "实现备注"
}

要求：
1. 只输出 ${target.name} 这一个系统的设计
2. design_brief 要具体到该游戏品类的特点，100-200字
3. key_features 列出 3-6 个核心特性
4. interactions 标明与其他系统的交互关系
5. ${target.priority === "required" ? "作为必须系统，需要更详细的设计" : "作为推荐系统，可以适当精简"}
6. 设计必须与品类和玩法循环一致
7. presentation 类系统必须描述界面布局、信息层级、交互方式
8. 说明"玩家在什么场景下使用、看到什么、操作什么"`,

      context_inputs: (ctx: NarrativeContext): string => {
        const da = ctx.demand_analysis!;
        const cc = ctx.core_concept!;
        const sa = ctx.system_architecture!;

        const skillSummary = formatSkillSummaries([target.id]);
        const gameplayLoop = cc.three_loops.gameplay_loop;

        return `为以下游戏的 **${target.name}(${target.id})** 系统撰写详细设计文档。

## 游戏信息
游戏: ${cc.game_name} | 品类: ${da.genre_name}

## 玩法循环（来自D0）
${JSON.stringify(gameplayLoop, null, 2)}

## 系统架构（来自D1）
设计顺序: ${sa.generation_order.join(" → ")}
全部系统: ${allSystems.map((s) => `${s.id}(${s.name})`).join(", ")}

## 当前系统: ${target.id}(${target.name}) [${target.priority}]

## 系统设计参考摘要
${skillSummary}`;
      },

      task_instruction: `请为 ${target.name}(${target.id}) 系统撰写详细设计文档。`,
    },
  };
}

async function generateOneSystem(
  ctx: NarrativeContext,
  llm: LLMClient,
  target: SystemEntry,
  allSystems: SystemEntry[],
): Promise<SystemDesignEntry> {
  const composer = buildSystemDetailComposer(target, allSystems);
  const sp = composeSystemPrompt(composer, ctx);
  const up = composeUserPrompt(composer, ctx);

  const raw = await llm.callWithRetry(
    sp,
    appendUserInstructions(up, ctx),
    { temperature: 0.5, responseFormat: "json" },
    (r) => {
      const parsed = extractJSON<SystemDesignEntry>(r);
      if (!parsed.id || !parsed.design_brief) throw new Error(`${target.name}: 缺少 id 或 design_brief`);
    },
  );
  return extractJSON<SystemDesignEntry>(raw);
}

export async function systemDetail(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const da = ctx.demand_analysis;
  const cc = ctx.core_concept;
  const sa = ctx.system_architecture;
  if (!da || !cc || !sa) throw new Error("D2 requires demand_analysis, core_concept, system_architecture");

  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const allSystems: SystemEntry[] = [
    ...(sa.categories.core ?? []),
    ...(sa.categories.gameplay ?? []),
    ...(sa.categories.progression ?? []),
    ...(sa.categories.social ?? []),
    ...(sa.categories.presentation ?? []),
  ].filter(
    (s) => s.priority === "required" || s.priority === "recommended",
  );

  const allResults: SystemDesignEntry[] = [];

  for (let i = 0; i < allSystems.length; i += PARALLEL_BATCH) {
    const batch = allSystems.slice(i, i + PARALLEL_BATCH);
    const batchLabel = `批次 ${Math.floor(i / PARALLEL_BATCH) + 1}/${Math.ceil(allSystems.length / PARALLEL_BATCH)}`;
    streamEmit?.(`\n[D2 ${batchLabel}: ${batch.map((s) => s.name).join("、")}]\n`, "");

    const results = await Promise.all(
      batch.map((sys) => generateOneSystem(ctx, llm, sys, allSystems)),
    );
    allResults.push(...results);
  }

  ctx.system_details = { systems: allResults };
}
