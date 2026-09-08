/**
 * D1: 系统架构 — 展开系统循环 → 系统清单 + 依赖图 + 生成顺序
 */
import type { NarrativeContext } from "../../types/index.js";
import type { SystemArchitecture } from "../../types/game-design.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { getRequiredAndRecommended } from "../../knowledge/game-design/system-matrix.js";
import { SYSTEM_DEPS, topologicalSort } from "../../knowledge/game-design/system-deps.js";
import { buildArchitectureSkillSummary } from "../../knowledge/game-design/system-skill-recommender.js";
import { appendUserInstructions } from "../steps/design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../runtime/prompt-composer.js";

const SYSTEM_ARCHITECTURE_COMPOSER: PromptComposer = {
  stepId: "system_architecture",
  skillSlots: ["constraints"],
  systemBlockOrder: ["role", "task", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: "你是一位游戏系统架构师，擅长将高层设计拆解为具体的模块化系统架构。",

    task: "将核心概念中的系统循环展开为具体的系统架构设计。",

    output_format: `## 输出要求（严格JSON）

{
  "categories": {
    "core": [{"id":"系统ID","name":"系统名","priority":"required|recommended|optional","brief":"一句话描述"}],
    "gameplay": [...],
    "progression": [...],
    "social": [...],
    "presentation": [...]
  },
  "dependency_graph": [
    {"from":"系统A","to":"系统B","reason":"依赖原因"}
  ],
  "generation_order": ["先设计的系统ID", "后设计的系统ID", ...]
}

要求：
1. categories 按系统类型分类，每个系统标明 priority
2. core 包含基础架构系统（entity/input/event等）
3. gameplay 包含核心玩法系统
4. progression 包含成长/经济系统
5. social 包含社交系统（如果品类需要）
6. presentation 包含表现与交互系统（UI/HUD/菜单/背包界面/地图/小地图/设置/引导教程等）
7. dependency_graph 标明系统间依赖关系
8. generation_order 按拓扑排序给出设计顺序
9. 每个系统的 brief 需明确"这个系统在游戏中如何呈现给玩家"`,

    context_inputs: (ctx: NarrativeContext): string => {
      const da = ctx.demand_analysis;
      const cc = ctx.core_concept;
      if (!da || !cc) throw new Error("D1 requires demand_analysis and core_concept");

      const { required, recommended } = getRequiredAndRecommended(da.genre_code);

      const knownDeps = SYSTEM_DEPS
        .filter((d) => [...required, ...recommended].some((s) => s.id === d.from || s.id === d.to))
        .slice(0, 30)
        .map((d) => `${d.from} → ${d.to}: ${d.reason}`)
        .join("\n");

      const systemLoop = cc.three_loops.system_loop;

      const skillSummary = buildArchitectureSkillSummary(da.genre_code);
      const skillBlock = skillSummary
        ? `\n\n## 品类相关系统设计参考（摘自子系统 Skill 库）\n${skillSummary}`
        : "";

      return `## 游戏信息
游戏: ${cc.game_name}
品类: ${da.genre_name}(${da.genre_code})

## 系统循环定义（来自D0）
${JSON.stringify(systemLoop, null, 2)}

## 品类系统优先级
必须系统: ${required.map((s) => `${s.id}(${s.label})`).join(", ")}
推荐系统: ${recommended.map((s) => `${s.id}(${s.label})`).join(", ")}

## 已知系统依赖
${knownDeps}${skillBlock}`;
    },

    task_instruction: "请将系统循环展开为具体的系统架构设计。",
  },
};

export async function systemArchitecture(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const da = ctx.demand_analysis;
  if (!da) throw new Error("D1 requires demand_analysis");

  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const sp = composeSystemPrompt(SYSTEM_ARCHITECTURE_COMPOSER, ctx);
  const up = composeUserPrompt(SYSTEM_ARCHITECTURE_COMPOSER, ctx);

  const raw = await llm.callWithRetry(
    sp,
    appendUserInstructions(up, ctx),
    { temperature: 0.5, responseFormat: "json" },
    (r) => {
      const parsed = extractJSON<SystemArchitecture>(r);
      if (!parsed.categories || !parsed.generation_order) throw new Error("缺少 categories 或 generation_order");
    },
    streamEmit,
  );

  const result = extractJSON<SystemArchitecture>(raw);

  // 用知识库中的拓扑排序验证/补充 generation_order
  const allSystemIds = [
    ...(result.categories.core ?? []),
    ...(result.categories.gameplay ?? []),
    ...(result.categories.progression ?? []),
    ...(result.categories.social ?? []),
    ...(result.categories.presentation ?? []),
  ].map((s) => s.id);

  const verified = topologicalSort(allSystemIds);
  if (verified.length > 0) {
    result.generation_order = verified;
  }

  ctx.system_architecture = result;
}
