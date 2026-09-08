/**
 * L4 剧本生成（ScriptProcessor）
 *
 * 设计哲学（继承自 v3）：
 * - 情节 → 可演出的剧本段落（冲突推动 + 角色弧光 + 游戏交互）
 * - 7 种 content 类型：stage_direction/narration/dialogue/inner_monologue/
 *   player_action/system_message/branch_point
 * - 5 种章节类型：opening/rising/climax/falling/resolution
 * - 拓扑分层执行（分支并行 + 主干顺序）：
 *   同层节点并行，层间顺序，通过滑动窗口传递前驱实际内容摘要
 * - 增强上下文：结构席给的节点风格指引（dialogue_hint 等）、用户原始需求
 */
import type { NarrativeContext, PlotNode, ScriptChapter, JrpgScript } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { validateTripleConstraints } from "../../utils/constraint-validator.js";
import { buildDesignContextSnippet, appendUserInstructions, userInstructionsBlock } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";
import { CAMERA_LANGUAGE } from "../prompt/narrative-craft.js";
import { inputPriorityChain, modeDispatchSource, conceptFieldMapping, preOutputChecklist } from "../prompt/structural-clarity.js";
import { getNodeFilter } from "../graph/node-merge.js";
import { markStepSkipped } from "../core/step-skip.js";
import type { WaveUnit } from "../blueprint/types.js";
import {
  buildSlidingWindowSummary,
  topologicalLayers,
} from "./context-helpers.js";
import { deriveDeterministicSceneNumbers, type StagedScene } from "../graph/scene-numbering.js";

const VALID_CONTENT_TYPES = new Set([
  "stage_direction", "narration", "dialogue", "inner_monologue",
  "player_action", "system_message", "branch_point",
]);
const VALID_CHAPTER_TYPES = new Set(["opening", "rising", "climax", "falling", "resolution"]);
const VALID_TIME_OF_DAY = new Set(["日", "夜"]);
const VALID_INDOOR_OUTDOOR = new Set(["内", "外"]);

const SYSTEM_PROMPT = `你是游戏剧本设计师，请将剧情树节点的情节改写为可演出的剧本段落。所有输出使用中文。

## 章节结构要求

每个章节必须包含：
1. **conflict**（冲突结构）：type, tension_level(1-10), stakes(赌注), turning_point(转折)
2. **character_arcs**（角色弧光）：character, arc_phase, emotional_shift, growth
3. **scenes**（场景列表）：每个场景含 location, atmosphere, camera_direction, bgm, content[]
   - 可选：time_of_day("日"/"夜")、indoor_outdoor("内"/"外")——标注后系统会按这两维
     加 location 做确定性场号派生（相邻场景三维全同=同场，任一维变=新场，场号全局
     递增绝不复用），不标注则退化为只按 location 分组。scene_id 你可以随便填，
     系统会用派生结果覆盖，不必操心跨章节唯一性

## 7 种 content 类型
- stage_direction: 舞台指示（环境、动作）
- narration: 旁白叙述
- dialogue: 对话（需 speaker, emotion, action, subtext）
- inner_monologue: 角色内心独白
- player_action: 玩家操作提示
- system_message: 系统消息
- branch_point: 分支选择点

## 5 种章节类型
- opening: 开端
- rising: 发展
- climax: 高潮
- falling: 下降
- resolution: 结局`;

const SYSTEM_OUTPUT = `输出JSON对象：
{
  "chapter_id": "sc_节点ID",
  "plot_node_id": "原情节节点ID",
  "chapter_type": "rising",
  "title": "章节标题",
  "conflict": { "type": "...", "tension_level": 7, "stakes": "...", "turning_point": "..." },
  "character_arcs": [{ "character": "角色名", "arc_phase": "...", "emotional_shift": "...", "growth": "..." }],
  "scenes": [{
    "scene_id": "s1",
    "location": "场景地点",
    "time_of_day": "日",
    "indoor_outdoor": "内",
    "atmosphere": "氛围",
    "camera_direction": "镜头",
    "bgm": "背景音乐",
    "content": [
      { "type": "stage_direction", "text": "舞台指示内容" },
      { "type": "dialogue", "speaker": "角色名", "text": "对话内容", "emotion": "情感", "action": "动作", "subtext": "潜台词" },
      { "type": "narration", "text": "旁白内容" }
    ]
  }]
}`;

/** 当前波次单元携带的情节材料（分层器塞进 `unit.data`，见文件末尾的 wave 接线）。 */
interface ScriptChunkData {
  plot: PlotNode;
  prevPlots: PlotNode[];
  nextPlots: PlotNode[];
  index: number;
  total: number;
}

function scriptChunkData(ctx: NarrativeContext): ScriptChunkData {
  const chunk = (ctx as Record<string, unknown>)._chunk as
    | (Record<string, unknown> & { plot?: PlotNode })
    | undefined;
  if (!chunk?.plot) throw new Error("script_generation 的 user 段需要 ctx._chunk.plot（按节点分层）");
  return {
    plot: chunk.plot,
    prevPlots: (chunk.prevPlots as PlotNode[] | undefined) ?? [],
    nextPlots: (chunk.nextPlots as PlotNode[] | undefined) ?? [],
    index: Number(chunk.index ?? 0),
    total: Number(chunk.total ?? 1),
  };
}

function scriptChunkWave(ctx: NarrativeContext): { slidingSummary?: string; constraintFeedback?: string } {
  const chunk = (ctx as Record<string, unknown>)._chunk as
    | { _wave?: { slidingSummary?: string; constraintFeedback?: string } }
    | undefined;
  return chunk?._wave ?? {};
}

export const SCRIPT_GENERATION_COMPOSER: PromptComposer = {
  stepId: "script_generation",
  skillSlots: ["style_guide", "examples", "constraints"],
  systemBlockOrder: [
    "base", "ip_dna", "craft", "style_guide", "examples", "constraints",
    "cot", "priority_chain", "mode_source", "concept_mapping", "self_check", "output",
  ],
  userBlockOrder: ["main", "user_instructions"],
  blocks: {
    cot: `## 机制与流程
1. 将情节文本切分为对白单元与舞台指示，先分清哪些该由人物说出、哪些该由镜头交代。
2. 按上面的镜头序列给每一段配镜，景别随戏的性质走。
3. 标出本段的冲突张力与角色弧光位置，让演出知道这一段要演到什么程度。
4. 自检：遮住角色名还认得出谁在说吗？全场有没有一句配得上"名场面"的台词？
   镜头有没有全篇一个机位？`,
    // F3：四项结构性缺口，见 structural-clarity.ts 文件头。
    priority_chain: inputPriorityChain([
      "情节节点本身（plot.content/story_elements/jrpg_elements）——本层唯一的事实来源，剧本只是它的" +
        "演出形态转换，改写过程中不能改变已经发生的事、场景、道具或台词内容",
      "边界校验上下文（前置/后续节点的 result/cause）——不得重复前一节点已完成的事，也不得提前交代后一节点",
      "本节点风格指引（对白风格/独白方向/旁白语气/氛围，来自 L2 细纲）——写法倾向而非事实，" +
        "可在不违反上面两条的前提下自由发挥",
      "角色档案 / 世界观设定——既定事实背景，不得抵触",
      "全局调控参数——只管形式（节奏/篇幅），不裁决内容事实",
    ]),
    mode_source: modeDispatchSource([
      "chapter_type 该选 opening/rising/climax/falling/resolution 哪一档，唯一由这个情节节点在全篇的" +
        "位置（narrative_stage）与三重约束的边界信息决定，不要凭这一段写起来的情绪强度自行改判",
      "是否要展示某个角色 arc_phase 的变化，唯一由角色档案里记录的当前弧光阶段决定，" +
        "不要脱离档案自行编排一个新的成长节奏",
    ]),
    concept_mapping: conceptFieldMapping([
      { concept: "对白单元与舞台指示的切分", field: "scenes[].content[].type（7 种 content 类型之一）" },
      { concept: "镜头序列（景别/机位）", field: "scenes[].camera_direction（自由文本）" },
      { concept: "潜台词", field: "scenes[].content[].subtext（仅 dialogue 类型适用）" },
      { concept: "冲突张力与角色弧光位置", field: "conflict.{type,tension_level,stakes,turning_point} + character_arcs[]" },
      { concept: "场景的日夜/内外（用于确定性场号派生）", field: "scenes[].{time_of_day, indoor_outdoor}（可选）" },
    ]),
    self_check: preOutputChecklist([
      'chapter_id 是否为 "sc_<node_id>"',
      "scenes 是否覆盖了情节节点 content 里描述的全部场景转换，没有漏掉或多加",
      "dialogue 类型的 content 是否都带了 speaker/emotion/subtext",
      "是否有遮住角色名也认得出是谁在说话的台词（至少一半台词经得起这个测试）",
      "conflict.turning_point 是否与情节节点 story_elements.plot.result 呼应，不是另起一个转折",
    ]),
    base: SYSTEM_PROMPT,
    ip_dna: IP_DNA_SLOT_BLOCK,
    craft: CAMERA_LANGUAGE,
    style_guide: "{{SKILL.style_guide}}",
    examples: "{{SKILL.examples}}",
    constraints: "{{SKILL.constraints}}",
    output: SYSTEM_OUTPUT,
    // user 段：main 复用 buildPromptForPlot（函数声明整体提升，此处引用无先后问题），
    // 材料一律从 ctx._chunk 读——WaveRunner 按单元装配 chunkCtx 时塞进去的。
    main: (ctx: NarrativeContext): string => {
      const { plot, prevPlots, nextPlots, index, total } = scriptChunkData(ctx);
      const wave = scriptChunkWave(ctx);
      return buildPromptForPlot(plot, index, total, ctx, prevPlots, nextPlots, wave.constraintFeedback, wave.slidingSummary);
    },
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
};

function buildNodeStyleHints(plot: PlotNode, ctx: NarrativeContext): string {
  const detailedOutlines = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  // 情节与结构席的细化节点一一对应（同 node_id），风格提示随节点走
  const structureNode = detailedOutlines.find(n => n.node_id === plot.node_id);
  if (!structureNode) return "";
  const se = structureNode.story_elements;
  const lines = [
    `- 对白风格: ${se.dialogue_hint ?? "（无）"}`,
    `- 独白方向: ${se.monologue_hint ?? "（无）"}`,
    `- 旁白语气: ${se.narration_hint ?? "（无）"}`,
    `- 氛围: ${se.atmosphere ?? "（无）"}`,
  ];
  return lines.join("\n");
}

function buildPromptForPlot(
  plot: PlotNode, index: number, total: number, ctx: NarrativeContext,
  prevPlots: PlotNode[], nextPlots: PlotNode[], constraintFeedback?: string,
  slidingWindowSummary?: string,
): string {
  const prevInfo = prevPlots.length > 0
    ? prevPlots.map(p =>
        `前置节点 [${p.node_id}] "${p.jrpg_elements?.scene_location ?? ""}":\n     result="${p.story_elements.plot.result}"\n     摘要: ${p.content.slice(0, 100)}${p.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无前序节点）";
  const nextInfo = nextPlots.length > 0
    ? nextPlots.map(n =>
        `后续节点 [${n.node_id}] "${n.jrpg_elements?.scene_location ?? ""}":\n     cause="${n.story_elements.plot.cause}"\n     摘要: ${n.content.slice(0, 100)}${n.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无后续节点）";

  const styleHints = buildNodeStyleHints(plot, ctx);

  let prompt = `## 用户原始需求
${ctx.user_input}

## 情节节点（需改写为剧本段落）
${JSON.stringify(plot, null, 2)}

## 边界校验上下文
- ${prevInfo}
- ${nextInfo}
${styleHints ? `\n## 本节点风格指引\n${styleHints}` : ""}

## 角色档案
${JSON.stringify(ctx.detailed_character_sheets ?? [], null, 2)}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 世界观设定
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}
${slidingWindowSummary ? `\n## 前一节点实际生成摘要（保持叙事连贯）\n${slidingWindowSummary}` : ""}

## 进度
第 ${index + 1}/${total} 个情节节点

请输出此节点对应的剧本章节JSON。chapter_id 请用 "sc_${plot.node_id}"。
${buildDesignContextSnippet(ctx)}`;

  if (constraintFeedback) {
    prompt += `\n\n## ⚠ 约束修正要求（上次生成未通过三重约束验证，请针对性修正）\n${constraintFeedback}`;
  }
  return prompt;
}

function normalizeChapter(raw: Record<string, unknown>, plot: PlotNode, index: number): ScriptChapter {
  let chapterType = String(raw.chapter_type ?? "rising");
  if (!VALID_CHAPTER_TYPES.has(chapterType)) chapterType = "rising";

  const conflict = (raw.conflict ?? {}) as Record<string, unknown>;
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];

  return {
    chapter_id: `sc_${plot.node_id}`,
    node_id: plot.node_id,
    plot_node_id: plot.node_id,
    chapter_type: chapterType as ScriptChapter["chapter_type"],
    title: String(raw.title ?? plot.jrpg_elements?.scene_location ?? `第${index + 1}章`),
    conflict: {
      type: String(conflict.type ?? ""),
      tension_level: Number(conflict.tension_level ?? 5),
      stakes: String(conflict.stakes ?? ""),
      turning_point: String(conflict.turning_point ?? ""),
    },
    character_arcs: Array.isArray(raw.character_arcs)
      ? raw.character_arcs.map((a: Record<string, unknown>) => ({
          character: String(a.character ?? ""),
          arc_phase: String(a.arc_phase ?? ""),
          emotional_shift: String(a.emotional_shift ?? ""),
          growth: String(a.growth ?? ""),
        }))
      : [],
    scenes: scenes.map((s: Record<string, unknown>, si: number) => ({
      // scene_id 只是占位——deriveDeterministicSceneNumbers 会在 scriptGeneration()/
      // scriptGenerationMerger() 收尾时按全篇顺序覆盖，这里给的值从不对外可见。
      scene_id: String(s.scene_id ?? `s${si + 1}`),
      location: String(s.location ?? ""),
      ...(VALID_TIME_OF_DAY.has(String(s.time_of_day ?? ""))
        ? { time_of_day: s.time_of_day as "日" | "夜" }
        : {}),
      ...(VALID_INDOOR_OUTDOOR.has(String(s.indoor_outdoor ?? ""))
        ? { indoor_outdoor: s.indoor_outdoor as "内" | "外" }
        : {}),
      atmosphere: String(s.atmosphere ?? ""),
      camera_direction: String(s.camera_direction ?? ""),
      bgm: String(s.bgm ?? ""),
      content: Array.isArray(s.content)
        ? (s.content as Array<Record<string, unknown>>).map((c) => {
            let type = String(c.type ?? "narration");
            if (!VALID_CONTENT_TYPES.has(type)) type = "narration";
            return { type: type as ScriptChapter["scenes"][number]["content"][number]["type"], speaker: c.speaker ? String(c.speaker) : undefined, text: String(c.text ?? ""), emotion: c.emotion ? String(c.emotion) : undefined, action: c.action ? String(c.action) : undefined, subtext: c.subtext ? String(c.subtext) : undefined };
          })
        : [],
    })),
    prev_node: plot.prev_node,
    next_node: plot.next_node,
    is_branch: plot.prev_node.length > 1 || plot.next_node.length > 1,
    narrative_stage: plot.narrative_stage,
  };
}

/**
 * 确定性场号收尾：按章节顺序（拓扑序）逐场展平，用三维状态派生全局场号并
 * 就地覆盖每个 scene 的 `scene_id`——两条路径（legacy 循环 / WaveRunner 合并）
 * 收尾时都要调用，保证跑法不同但产出的场号规则一致。
 */
export function applyDeterministicSceneNumbers(chapters: ScriptChapter[]): void {
  const scenes = chapters.flatMap((c) => c.scenes);
  const staged: StagedScene[] = scenes.map((s) => ({
    location: s.location,
    time_of_day: s.time_of_day,
    indoor_outdoor: s.indoor_outdoor,
  }));
  const numbers = deriveDeterministicSceneNumbers(staged);
  scenes.forEach((s, i) => { s.scene_id = numbers[i]!; });
}

/** 输出校验（抛错触发 LLM 重试）：与 legacy 循环体内 callWithRetry 的第四参同一条规则。 */
export function validateScriptGeneration(raw: string): void {
  const p = extractJSON<Record<string, unknown>>(raw);
  if (!p.scenes && !p.content) throw new Error("剧本必须包含scenes");
}

/** 从原始模型输出提取章节纯文本，与 `normalizeChapter` 之后的 `chapter.scenes[].content[].text` 同值。 */
function extractChapterText(raw: Record<string, unknown>): string {
  const scenes = Array.isArray(raw.scenes) ? (raw.scenes as Array<Record<string, unknown>>) : [];
  return scenes
    .map((s) => (Array.isArray(s.content) ? (s.content as Array<Record<string, unknown>>) : [])
      .map((c) => String(c.text ?? "")).join(" "))
    .join(" ");
}

const MAX_CONSTRAINT_RETRIES = 2;

export async function processScriptNode(
  plot: PlotNode,
  index: number,
  total: number,
  ctx: NarrativeContext,
  llm: LLMClient,
  slidingWindowSummary?: string,
): Promise<ScriptChapter> {
  const plotMap = new Map((ctx.plots_generated?.plots ?? []).map(p => [p.node_id, p]));
  const prevPlots = (plot.prev_node ?? []).map(id => plotMap.get(id)).filter((p): p is PlotNode => !!p);
  const nextPlots = (plot.next_node ?? []).map(id => plotMap.get(id)).filter((p): p is PlotNode => !!p);

  const prevResults = prevPlots.map(p => p.story_elements.plot.result).filter(Boolean);
  const nextCauses = nextPlots.map(n => n.story_elements.plot.cause).filter(Boolean);

  let constraintFeedback: string | undefined;
  let chapter: ScriptChapter | undefined;

  for (let attempt = 0; attempt <= MAX_CONSTRAINT_RETRIES; attempt++) {
    const raw = await llm.callWithRetry(
      composeSystemPrompt(SCRIPT_GENERATION_COMPOSER, ctx),
      appendUserInstructions(buildPromptForPlot(plot, index, total, ctx, prevPlots, nextPlots, constraintFeedback, slidingWindowSummary), ctx),
      { responseFormat: "json" },
      validateScriptGeneration,
    );

    const parsed = extractJSON<Record<string, unknown>>(raw);
    chapter = normalizeChapter(parsed, plot, index);

    const chapterText = chapter.scenes.map(s => s.content.map(c => c.text).join(" ")).join(" ");
    const tcResult = validateTripleConstraints({
      content: chapterText,
      boundary_constraints: {
        cause: plot.story_elements.plot.cause,
        result: plot.story_elements.plot.result,
      },
      scope_content: plot.content,
      prev_result: prevResults.join("；"),
      next_cause: nextCauses.join("；"),
    });

    const issues = [...tcResult.errors, ...tcResult.warnings];
    if (issues.length === 0) break;

    if (attempt < MAX_CONSTRAINT_RETRIES) {
      constraintFeedback = issues.map((msg, i) => `${i + 1}. ${msg}`).join("\n");
      console.warn(`[L4] ${plot.node_id} 三重约束未通过(第${attempt + 1}次)，触发修正重试:`, issues);
    } else {
      console.warn(`[L4] ${plot.node_id} 三重约束重试${MAX_CONSTRAINT_RETRIES}次后仍有问题:`, issues);
    }
  }

  return chapter!;
}

export async function scriptGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const allPlots = ctx.plots_generated?.plots ?? [];
  if (allPlots.length === 0) {
    markStepSkipped(ctx, "script_generation", ["plots_generated"]);
    return;
  }

  const nodeFilter = getNodeFilter(ctx);
  const plots = nodeFilter
    ? allPlots.filter(p => nodeFilter.has(p.node_id))
    : allPlots;

  const _save = (ctx as Record<string, unknown>)._saveNode as ((s: string, n: string, d: unknown) => void) | undefined;

  // 拓扑分层执行：分支并行 + 主干顺序
  const layers = topologicalLayers(plots);
  const summaryMap = new Map<string, string>();
  const chapters: ScriptChapter[] = [];
  let globalIdx = 0;

  console.log(`[L4] 拓扑分层: ${layers.length} 层, 节点分布: ${layers.map(l => l.length).join(",")}`);

  for (const layer of layers) {
    const layerResults = await Promise.all(
      layer.map(async (plot) => {
        const prevSummaries = (plot.prev_node ?? [])
          .map(id => summaryMap.get(id))
          .filter(Boolean)
          .join("\n---\n");
        const idx = globalIdx++;
        return processScriptNode(
          plot, idx, plots.length, ctx, llm,
          prevSummaries || undefined,
        );
      }),
    );

    for (const ch of layerResults) {
      chapters.push(ch);
      const chapterText = ch.scenes.map(s => s.content.map(c => c.text).join(" ")).join(" ");
      summaryMap.set(ch.plot_node_id, buildSlidingWindowSummary(chapterText));
      const nodeId = ch.chapter_id ?? ch.plot_node_id;
      if (nodeId) _save?.("script_generation", nodeId, ch);
    }
  }

  applyDeterministicSceneNumbers(chapters);

  ctx.jrpg_script = {
    title: ctx.core_settings?.world_name ?? "JRPG剧本",
    chapters,
  };
}

// ════════════════════════════════════════════════════════
// WaveRunner 接线（M4）：与 plot_generation 同构——分层/约束校验/摘要/合并四个
// 处理器，与 legacy 的 scriptGeneration 共用 buildPromptForPlot / normalizeChapter /
// validateTripleConstraints，保证两条路径产出一致。本席比情节席多一个"全局序号"：
// legacy 的 index/total 是跨层累加的 globalIdx，用于提示词里的"第 X/Y 个情节节点"
// 与产出 title 兜底，故分层时一并按最终展开顺序算好塞进每个单元。
// ════════════════════════════════════════════════════════

/** 按 nodeFilter 过滤后、拓扑分层展开的处理顺序——legacy globalIdx 的口径。 */
function scriptGenerationOrderedPlots(ctx: NarrativeContext): PlotNode[] {
  const allPlots = ctx.plots_generated?.plots ?? [];
  const nodeFilter = getNodeFilter(ctx);
  const plots = nodeFilter ? allPlots.filter((p) => nodeFilter.has(p.node_id)) : allPlots;
  return topologicalLayers(plots).flat();
}

/** 按拓扑层分层：与 legacy 的分层日志逐字保留，每单元携带全局序号供提示词与归一化共用。 */
export function scriptGenerationWaveLayerer(ctx: NarrativeContext): WaveUnit[][] {
  const allPlots = ctx.plots_generated?.plots ?? [];
  if (allPlots.length === 0) return [];

  const plotMap = new Map(allPlots.map((p) => [p.node_id, p]));
  const nodeFilter = getNodeFilter(ctx);
  const plots = nodeFilter ? allPlots.filter((p) => nodeFilter.has(p.node_id)) : allPlots;

  const layers = topologicalLayers(plots);
  console.log(`[L4] 拓扑分层: ${layers.length} 层, 节点分布: ${layers.map((l) => l.length).join(",")}`);

  const total = plots.length;
  let index = 0;

  return layers.map((layer) =>
    layer.map((plot) => ({
      unitId: plot.node_id,
      data: {
        plot,
        prevPlots: (plot.prev_node ?? []).map((id) => plotMap.get(id)).filter((p): p is PlotNode => !!p),
        nextPlots: (plot.next_node ?? []).map((id) => plotMap.get(id)).filter((p): p is PlotNode => !!p),
        index: index++,
        total,
      },
      prevIds: plot.prev_node ?? [],
    })),
  );
}

/**
 * 单元约束校验：与 plot_generation 同构——boundary_constraints/scope_content 恒取自
 * 本节点情节骨架（不看模型输出），拿 unit.data 就够。
 */
export function scriptGenerationWaveConstraintCheck(
  output: unknown,
  _ctx: NarrativeContext,
  unit: WaveUnit,
): string[] {
  const { plot, prevPlots, nextPlots } = unit.data as {
    plot: PlotNode;
    prevPlots: PlotNode[];
    nextPlots: PlotNode[];
  };
  const raw = output as Record<string, unknown>;
  const prevResults = prevPlots.map((p) => p.story_elements.plot.result).filter(Boolean);
  const nextCauses = nextPlots.map((n) => n.story_elements.plot.cause).filter(Boolean);

  const tcResult = validateTripleConstraints({
    content: extractChapterText(raw),
    boundary_constraints: {
      cause: plot.story_elements.plot.cause,
      result: plot.story_elements.plot.result,
    },
    scope_content: plot.content,
    prev_result: prevResults.join("；"),
    next_cause: nextCauses.join("；"),
  });

  return [...tcResult.errors, ...tcResult.warnings];
}

/** 滑动窗口摘要：对原始输出的章节纯文本取摘要，与 legacy 对归一化后 `chapterText` 取摘要等值。 */
export function scriptGenerationWaveSummarizer(output: unknown): string {
  return buildSlidingWindowSummary(extractChapterText(output as Record<string, unknown>));
}

/**
 * 逐单元落地：每个节点一完成就调用 `ctx._saveNode`，对齐 legacy 在
 * `Promise.all` 每层 resolve 后立刻落盘的时机。index 按 scriptGenerationOrderedPlots
 * 重新查一次——与分层时算好的全局序号同一口径，chunkDone 拿不到 unit.data，
 * 只能按 chunkId 反查。
 */
export function scriptGenerationChunkDone(
  chunk: { chunkId: string; output: unknown },
  ctx: NarrativeContext,
): void {
  const allPlots = ctx.plots_generated?.plots ?? [];
  const plot = allPlots.find((p) => p.node_id === chunk.chunkId);
  if (!plot) return;
  const ordered = scriptGenerationOrderedPlots(ctx);
  const index = ordered.findIndex((p) => p.node_id === chunk.chunkId);
  const chapter = normalizeChapter(chunk.output as Record<string, unknown>, plot, index < 0 ? 0 : index);
  const saveNode = (ctx as Record<string, unknown>)._saveNode as
    | ((stepId: string, nodeId: string, data: unknown) => void)
    | undefined;
  const nodeId = chapter.chapter_id ?? chapter.plot_node_id;
  if (nodeId) saveNode?.("script_generation", nodeId, chapter);
}

/**
 * 合并：按 WaveRunner 给出的层序（与 legacy 逐层 push 顺序一致，即
 * scriptGenerationOrderedPlots 的顺序）逐单元归一化，直接产出最终 `jrpg_script`
 * 形状——本席没有 L3 那样的收尾结构验证，合并即终稿，不需要额外归一化器。
 */
export function scriptGenerationMerger(
  results: Array<{ chunkId: string; output: unknown }>,
  ctx: NarrativeContext,
): JrpgScript {
  const allPlots = ctx.plots_generated?.plots ?? [];
  const plotMap = new Map(allPlots.map((p) => [p.node_id, p]));

  const chapters: ScriptChapter[] = [];
  results.forEach((r, i) => {
    const plot = plotMap.get(r.chunkId);
    if (!plot) return;
    chapters.push(normalizeChapter(r.output as Record<string, unknown>, plot, i));
  });

  applyDeterministicSceneNumbers(chapters);

  return {
    title: ctx.core_settings?.world_name ?? "JRPG剧本",
    chapters,
  };
}
