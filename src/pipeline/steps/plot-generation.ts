/**
 * L3 情节生成（PlotProcessor）
 *
 * 设计哲学（继承自 v3）：
 * - 继承结构席给定的剧情树（1:1 映射），不产生新分支
 * - 三重约束：边界约束（cause→result）、范围约束（content）、边界校验（前后节点不越界）
 * - 拓扑分层执行（分支并行 + 主干顺序）：
 *   同层节点并行，层间顺序，通过滑动窗口传递前驱实际内容摘要
 * - 情节内容为小说级笔触（1000-2000 字），含演出要素（jrpg_elements 为历史字段名）
 * - 增强上下文：上游脉络（宏观框架→叙事单元→本节点）、用户需求、剧情简介
 */
import type {
  BeatSpaceTime,
  DetailedOutlineNode,
  NarrativeContext,
  PlotNode,
  StateChange,
} from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { validateTripleConstraints } from "../../utils/constraint-validator.js";
import { buildDesignContextSnippet, appendUserInstructions, buildIpSourceReference, userInstructionsBlock } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";
import { PROSE_CRAFT } from "../prompt/narrative-craft.js";
import { buildPlotControlPrompt } from "../runtime/layer-threshold-config.js";
import { inputPriorityChain, modeDispatchSource, conceptFieldMapping, preOutputChecklist } from "../prompt/structural-clarity.js";
import { getNodeFilter } from "../graph/node-merge.js";
import { markStepSkipped } from "../core/step-skip.js";
import { structureValidationL3 } from "./structure-validation.js";
import type { WaveUnit } from "../blueprint/types.js";
import {
  buildAncestorChainContext,
  buildSlidingWindowSummary,
  topologicalLayers,
} from "./context-helpers.js";

const SYSTEM_PROMPT = `你是叙事与游戏剧本设计师，请为剧情树上的指定节点写出情节正文。所有输出必须使用中文。

### 三重约束系统（必须严格遵守）

**1. 边界约束（Boundary Constraint）**
- 起始状态 = 细纲节点 story_elements.plot.cause
- 终止状态 = 细纲节点 story_elements.plot.result
- 情节必须从 cause 出发，到达 result

**2. 范围约束（Scope Constraint）**
- 生成内容必须在细纲节点 content 定义的范围内
- 不得引入细纲未提及的重大事件或角色

**3. 边界校验（Boundary Validation）**
- 不得重复前一节点已完成的事
- 不得提前后一节点将发生的事
- 上下文无缝衔接`;

const SYSTEM_OUTPUT = `### 输出格式（严格 JSON 对象）
{
  "node_id": "节点ID",
  "parent_id": "父节点ID",
  "content": "情节详细内容描述（1000-2000字，小说级笔触）",
  "story_elements": { "plot": { "cause": "起因", "process": "经过", "result": "结果" } },
  "jrpg_elements": {
    // 字段名是历史遗留，内容是与品类无关的**演出要素**：场景、在场角色、对白、道具、镜头。
    "scene_location": "主场景位置",
    "scene_locations": ["主场景", "细分场景"],
    "scene_characters": ["角色1", "角色2"],
    "dialogue_segments": [{ "speaker": "角色名", "text": "对话内容", "emotion": "情感", "kind": "dialogue" }],
    "key_items": ["道具"],
    "narration_hints": ["叙事提示"],
    "bgm_hint": "背景音乐提示",
    "camera_hint": "镜头提示"
  },
  "spacetime": { "time": "故事世界纪年", "location": "本节点所在场景" },
  "state_deltas": [
    { "dimension": "character", "subject": "角色原名", "attribute": "physical.attire", "to": "新状态" }
  ]
}

dialogue_segments[].kind 按内容性质标注（不写默认按 "dialogue" 处理）：
- "dialogue"：角色开口说给别人听的话
- "inner_monologue"：角色的内心独白，不出声
- "narration"：旁白/画外音式的叙述性文字，不是角色台词
- "sfx"：拟声词或音效提示
按叙事顺序把三类都塞进这同一个数组，不要把旁白单独挪去别处——顺序本身就是信息。

spacetime 与 state_deltas 记的是"这一节点之后世界变成什么样"，供下游查"走到这里时
谁在哪、拿着什么"。两项都**可省**：你正在写 1000-2000 字正文，记账不该挤占写作；
说不准就留空，之后会有一次专门的调用来补。但**填了就要准**——补出来的不如你写时知道的。
- spacetime：与上一节点同一时空就省掉，不要把上游抄一遍
- state_deltas：确实什么都没变（纯对话、纯铺垫）就写 []，与"没填"是两回事
- subject 用角色档案 / 道具库里的原名，逐字一致
- attribute 只能取以下值，自创的会被丢掉：
  · character → physical.body | physical.attire | psychology.personality | psychology.persona_base | psychology.current_mood | power_level | relationships
    relationships 的 to 写成 JSON 字符串：{"target":"对方原名","nature":"关系性质"}
  · item → location | acquired(to="是"/"否") | condition | durability(to ∈ permanent|multi_use|single_use|consumed)
  · world / plot → to 直接写新状态描述`;

/** 当前波次单元携带的节点材料（分层器塞进 `unit.data`，见文件末尾的 wave 接线）。 */
interface PlotChunkData {
  node: DetailedOutlineNode;
  prevNodes: DetailedOutlineNode[];
  nextNodes: DetailedOutlineNode[];
}

function plotChunkData(ctx: NarrativeContext): PlotChunkData {
  const chunk = (ctx as Record<string, unknown>)._chunk as
    | (Record<string, unknown> & { node?: DetailedOutlineNode })
    | undefined;
  if (!chunk?.node) throw new Error("plot_generation 的 user 段需要 ctx._chunk.node（按节点分层）");
  return {
    node: chunk.node,
    prevNodes: (chunk.prevNodes as DetailedOutlineNode[] | undefined) ?? [],
    nextNodes: (chunk.nextNodes as DetailedOutlineNode[] | undefined) ?? [],
  };
}

function plotChunkWave(ctx: NarrativeContext): { slidingSummary?: string; constraintFeedback?: string } {
  const chunk = (ctx as Record<string, unknown>)._chunk as
    | { _wave?: { slidingSummary?: string; constraintFeedback?: string } }
    | undefined;
  return chunk?._wave ?? {};
}

export const PLOT_GENERATION_COMPOSER: PromptComposer = {
  stepId: "plot_generation",
  blocks: {
    cot: `## 机制与流程
本席是整条管线的落点：上游把剧情树的骨架搭好，你负责**填满树上每一个节点的内容**。
节点内容以剧本的形态呈现，实质只有两样东西——情节描写与对话。描写交代发生了什么、
在哪里、角色如何反应；对话让角色自己开口。两者之外的东西（机制说明、设计意图、
旁白式点评）都不属于这一层。

1. 读取本节点给定的目标—障碍—转折—结果，这是本段不可改动的骨架。
2. 认清本节点的功能位，按上面「按功能位分写」那一段的要求落笔。
3. 以角色视角展开动作与内心，让每个转折都由角色的选择导出，而非被作者推着走。
4. 嵌入环境描写传递世界观气质——环境要参与叙事，不做背景板。
5. 用节奏控制服务情感强度：紧张处句短段密，舒缓处句长段松。
6. 自检：是否忠于骨架？有没有把游戏机制直接写进正文（机制裸露）？
   角色声音是否与角色档案一致？聚合节点是否不慎假定了玩家的来路？`,
    // F3：四项结构性缺口，见 structural-clarity.ts 文件头。
    priority_chain: inputPriorityChain([
      "边界约束——细纲节点 story_elements.plot 的 cause→result：情节必须从 cause 出发、落到 result，" +
        "这是三重约束系统里最高优先级的一条，任何其他材料都不能改变这个起止点",
      "范围约束——细纲节点 content 定义的范围：不得引入细纲未提及的重大事件或角色",
      "边界校验上下文——前置节点的 result / 后续节点的 cause：不得重复前一节点已完成的事，" +
        "也不得提前交代后一节点将发生的事",
      "世界观设定 / 角色档案——本次生成流程内部已确立的既定事实，写到与它们相关的内容前必须先" +
        "核对原文（尤其是伏笔回收计划与角色 personal_item），不能凭对题材的常识印象替代原文",
      "剧情简介 / 上游脉络（宏观框架→叙事单元→当前节点）——背景性参考，与上面四条冲突时让位",
    ]),
    mode_source: modeDispatchSource([
      "本节点该按「分岔/聚合/结局/普通」哪一种功能位写，唯一由细纲节点的拓扑结构" +
        "（prev_node/next_node 的数量与 edges）决定，不要凭内容感觉重新判断该套用哪种「按功能位分写」的写法",
      "是否要套用「入口节点——角色个性碎片展示」还是「callback——叙事呼应」这两套完全不同的写作要求，" +
        "唯一由 prevNodes.length === 0（入口）与 narrative_stage/content 是否命中关键转折关键词" +
        "（callback）决定，两者互斥，不要同时套用，也不要在非关键节点上自行触发 callback",
    ]),
    concept_mapping: conceptFieldMapping([
      { concept: "描写与对白（画面/台词/独白/旁白/音效）",
        field: "jrpg_elements.dialogue_segments[]（按 kind 分 dialogue/inner_monologue/narration/sfx）" },
      { concept: "入口节点的角色个性碎片/口头禅/习惯展示",
        field: "content 正文与 dialogue_segments 里的具体台词/动作，没有独立字段，不能只在脑内构思不落笔" },
      { concept: "承载锚（这个节点扛哪一项实质职责）",
        field: "不是独立字段——必须体现在 content 与 dialogue_segments 的具体动作/台词里，" +
          "严禁只写「自此追随」这类结果标签" },
      { concept: "设定回收（核对世界观预埋伏笔）",
        field: "回收后的信息写进 content 正文，并把涉及的道具/线索名带进 jrpg_elements.key_items" },
    ]),
    self_check: preOutputChecklist([
      "node_id / parent_id 是否与要求的一致",
      "content 是否从 cause 出发、落到 result（边界约束）",
      "content 是否只在细纲 content 范围内，没有引入未提及的重大事件或角色（范围约束）",
      "是否重复了前一节点已完成的事，或提前交代了后一节点的事（边界校验）",
      "dialogue_segments 的 kind 是否标全，旁白/音效与台词/独白分清楚",
      "涉及世界观预埋伏笔的节点，是否已核对 WV_09 原文的限定词（时间点/参与人数/回收方式）",
      "涉及角色档案 personal_item 的道具，状态是否与角色档案及前置节点一致，没有重置或重复赠予",
    ]),
    base: SYSTEM_PROMPT,
    ip_dna: IP_DNA_SLOT_BLOCK,
    craft: PROSE_CRAFT,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output: SYSTEM_OUTPUT,
    // user 段：main 复用 buildPromptForNode（函数声明整体提升，此处引用无先后问题），
    // 材料一律从 ctx._chunk 读——WaveRunner 按单元装配 chunkCtx 时塞进去的。
    main: (ctx: NarrativeContext): string => {
      const { node, prevNodes, nextNodes } = plotChunkData(ctx);
      const wave = plotChunkWave(ctx);
      return buildPromptForNode(node, prevNodes, nextNodes, ctx, wave.constraintFeedback, wave.slidingSummary);
    },
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
  systemBlockOrder: ["base", "style_guide", "ip_dna", "craft", "constraints", "cot", "priority_chain", "mode_source", "concept_mapping", "self_check", "output"],
  userBlockOrder: ["main", "user_instructions"],
  skillSlots: ["style_guide", "constraints"],
};

const CALLBACK_TRIGGER_STAGES = /climax|turning|crisis|fall|resolution|death|betray|sacrifice/i;

function buildCallbackGuidance(node: DetailedOutlineNode, ctx: NarrativeContext): string {
  const stage = node.narrative_stage ?? "";
  const content = node.content ?? "";
  const isCallbackMoment = CALLBACK_TRIGGER_STAGES.test(stage)
    || /死|牺牲|背叛|叛变|失去|毁灭|离别|诀别/.test(content);

  if (!isCallbackMoment) return "";

  const sheets = ctx.detailed_character_sheets ?? [];
  const fragments: string[] = [];
  for (const c of sheets) {
    const pl = c.personal_life;
    if (!pl) continue;
    const items: string[] = [];
    if (pl.private_wish) items.push(`曾经的期待: "${pl.private_wish}"`);
    if (pl.personal_item) items.push(`随身物件: ${pl.personal_item}`);
    if (pl.independent_bonds && pl.independent_bonds.length > 0) {
      const bonds = pl.independent_bonds.map(b => `${b.name}(${b.relationship}: ${b.detail})`).join("、");
      items.push(`还有人在等: ${bonds}`);
    }
    if (pl.speech_pattern) items.push(`口头禅: "${pl.speech_pattern}"`);
    if (items.length > 0) {
      fragments.push(`- ${c.name}: ${items.join("; ")}`);
    }
  }

  if (fragments.length === 0) return "";

  return `\n## ⭐ Callback 叙事呼应提示

当前节点处于关键转折阶段（${stage}），涉及角色的命运变化。这是回收之前埋下的叙事碎片（Call）的最佳时机。

请在情节中自然融入以下 callback 素材（不要全部使用，选择最能制造情感冲击的1-2个）：
${fragments.join("\n")}

callback 要求：
- 不要直接重复角色档案的文字，而是通过场景细节、对话、物件、回忆闪回等手法间接呼应
- 例如：角色死亡时，口袋里滑出之前承诺要带给某人的东西；幸存者想起死者说过"干完这票就..."
- 目的是让读者/玩家在此刻感受到"这个人不只是一个功能角色，他有未完成的人生"
`;
}

function buildEntryNodeGuidance(ctx: NarrativeContext): string {
  const sheets = ctx.detailed_character_sheets ?? [];
  const fragments: string[] = [];
  for (const c of sheets) {
    const pl = c.personal_life;
    if (!pl) continue;
    const items: string[] = [];
    if (pl.speech_pattern) items.push(`口头禅/说话方式: "${pl.speech_pattern}"`);
    if (pl.habits && pl.habits.length > 0) items.push(`习惯: ${pl.habits.join("、")}`);
    if (pl.private_wish) items.push(`内心期待(flag): "${pl.private_wish}"`);
    if (pl.personal_item) items.push(`私人物件: ${pl.personal_item}`);
    if (pl.vulnerability) items.push(`矛盾面: ${pl.vulnerability}`);
    if (pl.independent_bonds && pl.independent_bonds.length > 0) {
      const bonds = pl.independent_bonds.map(b => `${b.name}(${b.relationship})`).join("、");
      items.push(`牵挂的人: ${bonds}`);
    }
    if (items.length > 0) {
      fragments.push(`- ${c.name}: ${items.join("; ")}`);
    }
  }

  let section = `\n## ⭐ 叙事入口节点——角色个性碎片展示要求

这是故事的入口节点。除推进情节外，你必须通过角色的行为、对话、细微动作来展示他们的个性碎片。
这些碎片是后续 callback 的种子——先让读者/玩家感受到"这是一个活人"，后续才能在他们遭遇变故时产生真正的情感冲击。

要求：
1. 至少一个角色通过口头禅、习惯动作展示独有性格
2. 至少一个角色的 flag（对未来的期待/承诺）以对话或内心独白形式自然嵌入
3. 这些碎片必须自然融入场景节奏，禁止像人物介绍一样平铺罗列
`;
  if (fragments.length > 0) {
    section += `\n### 可用的角色个性素材（从角色档案 personal_life 提取）\n${fragments.join("\n")}\n`;
  }
  return section;
}

function buildPromptForNode(
  node: DetailedOutlineNode,
  prevNodes: DetailedOutlineNode[],
  nextNodes: DetailedOutlineNode[],
  ctx: NarrativeContext,
  constraintFeedback?: string,
  slidingWindowSummary?: string,
): string {
  const prevInfo = prevNodes.length > 0
    ? prevNodes.map(p =>
        `前置节点 [${p.node_id}] "${p.name}":\n     result="${p.story_elements.plot.result}"\n     摘要: ${p.content.slice(0, 100)}${p.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无前序节点）";
  const nextInfo = nextNodes.length > 0
    ? nextNodes.map(n =>
        `后续节点 [${n.node_id}] "${n.name}":\n     cause="${n.story_elements.plot.cause}"\n     摘要: ${n.content.slice(0, 100)}${n.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无后续节点）";

  const ancestorChain = buildAncestorChainContext(node.node_id, ctx);

  let prompt = `## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 剧情简介
${JSON.stringify(ctx.plot_synopsis ?? {}, null, 2)}

${ancestorChain ? `## 上游脉络（宏观框架 → 所属叙事单元 → 当前节点）\n${ancestorChain}\n` : ""}
## 当前节点（你需要为它写情节正文）
${JSON.stringify(node, null, 2)}

## 边界校验上下文
- ${prevInfo}
- ${nextInfo}

## 角色档案
${JSON.stringify(ctx.detailed_character_sheets ?? [], null, 2)}

## 世界观设定
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 全局调控参数
${buildPlotControlPrompt(ctx.global_control_params)}
${slidingWindowSummary ? `\n## 前一节点实际生成摘要（保持叙事连贯）\n${slidingWindowSummary}` : ""}
${prevNodes.length === 0 ? buildEntryNodeGuidance(ctx) : buildCallbackGuidance(node, ctx)}
请输出此节点的情节JSON。node_id 必须为 "${node.node_id}"，parent_id 必须为 "${node.parent_id}"。
${buildDesignContextSnippet(ctx)}`;

  if (constraintFeedback) {
    prompt += `\n\n## ⚠ 约束修正要求（上次生成未通过三重约束验证，请针对性修正）\n${constraintFeedback}`;
  }

  return prompt;
}

const DIALOGUE_SEGMENT_KINDS = ["dialogue", "inner_monologue", "narration", "sfx"] as const;

/** 未标注或非法值一律按 "dialogue" 处理——存量 checkpoint 与旧字段布局的兼容缺省。 */
function normalizeDialogueSegmentKind(
  raw: unknown,
): "dialogue" | "inner_monologue" | "narration" | "sfx" {
  return (DIALOGUE_SEGMENT_KINDS as readonly string[]).includes(raw as string)
    ? (raw as (typeof DIALOGUE_SEGMENT_KINDS)[number])
    : "dialogue";
}

/**
 * 旁白/音效行的 speaker 归一（F2，治 docs/quality-baseline-f1.md 缺陷 4.6）。
 *
 * 提示词允许模型把这两类的 speaker 直接写成 kind 名（"narration"/"sfx"），但 F1
 * 基线抽样发现同一批节点里也出现过 "无"、空字符串这类不同写法表达同一件事——
 * 下游若按 speaker 分组渲染（例如"找出所有旁白行"），两套命名并存会漏掉一半。
 * 这里做确定性归一，不依赖模型自律：kind 是 narration/sfx 且 speaker 不是一个
 * 看起来像具体说话人名字的值时，直接把 speaker 写成 kind 的值。
 */
function normalizeNarrationSpeaker(speaker: string, kind: string): string {
  if (kind !== "narration" && kind !== "sfx") return speaker;
  const trimmed = speaker.trim();
  const looksLikeNamedSpeaker = trimmed.length > 0 && trimmed !== "无" && trimmed !== kind;
  return looksLikeNamedSpeaker ? trimmed : kind;
}

function normalizePlot(raw: Record<string, unknown>, node: DetailedOutlineNode): PlotNode {
  const jrpg = (raw.jrpg_elements ?? {}) as Record<string, unknown>;
  const plot = ((raw.story_elements as Record<string, unknown>)?.plot ?? node.story_elements.plot) as Record<string, string>;

  const nodeId = String(node.node_id);
  return {
    node_id: nodeId,
    content_id: `pl_${nodeId}`,
    parent_id: String(raw.parent_id ?? node.parent_id),
    content: String(raw.content ?? ""),
    story_elements: {
      plot: {
        cause: plot.cause ?? node.story_elements.plot.cause,
        process: plot.process ?? "",
        result: plot.result ?? node.story_elements.plot.result,
      },
    },
    jrpg_elements: {
      scene_location: String(jrpg.scene_location ?? ""),
      scene_locations: Array.isArray(jrpg.scene_locations) ? jrpg.scene_locations.map(String) : [],
      scene_characters: Array.isArray(jrpg.scene_characters) ? jrpg.scene_characters.map(String) : [],
      dialogue_segments: Array.isArray(jrpg.dialogue_segments)
        ? jrpg.dialogue_segments.map((d: Record<string, unknown>) => {
            const kind = normalizeDialogueSegmentKind(d.kind);
            return {
              speaker: normalizeNarrationSpeaker(String(d.speaker ?? ""), kind),
              text: String(d.text ?? ""),
              emotion: String(d.emotion ?? ""),
              // 缺省按 "dialogue" 处理：兼容 kind 字段引入前落盘的存量 checkpoint。
              kind,
            };
          })
        : [],
      key_items: Array.isArray(jrpg.key_items) ? jrpg.key_items.map(String) : [],
      narration_hints: Array.isArray(jrpg.narration_hints) ? jrpg.narration_hints.map(String) : [],
      bgm_hint: String(jrpg.bgm_hint ?? ""),
      camera_hint: String(jrpg.camera_hint ?? ""),
    },
    boundary_constraints: {
      cause: node.story_elements.plot.cause,
      result: node.story_elements.plot.result,
    },
    prev_node: node.prev_node,
    next_node: node.next_node,
    narrative_stage: node.narrative_stage,
    // 两项都按"模型没给就不写"处理，不兜底成空值：`undefined` 与 `[]` 在账本那边
    // 意思不同（没填 / 明确判定无变更），兜底会把"漏填"记成"确实没变化"，
    // 于是该补的节点永远不会被送去补全。
    ...(isSpacetime(raw.spacetime) ? { spacetime: raw.spacetime } : {}),
    ...(Array.isArray(raw.state_deltas)
      ? { state_deltas: normalizeStateDeltas(raw.state_deltas) }
      : {}),
  };
}

function isSpacetime(raw: unknown): raw is BeatSpaceTime {
  if (!raw || typeof raw !== "object") return false;
  const { time, location } = raw as Record<string, unknown>;
  return typeof time === "string" && typeof location === "string";
}

/**
 * 只留形状完整的变更条目。缺 dimension / subject / to 的条目在折叠时会静默落空
 * （`applyChange` 认不出它），留着不如丢掉——丢在这里查得到，落空查不到。
 */
function normalizeStateDeltas(raw: readonly unknown[]): StateChange[] {
  const DIMENSIONS = ["time", "location", "character", "item", "world", "plot"];
  const out: StateChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (!DIMENSIONS.includes(String(c.dimension))) continue;
    if (typeof c.to !== "string" || !c.to) continue;
    out.push({
      dimension: c.dimension as StateChange["dimension"],
      subject: String(c.subject ?? ""),
      attribute: String(c.attribute ?? ""),
      ...(typeof c.from === "string" ? { from: c.from } : {}),
      to: c.to,
    });
  }
  return out;
}

const MAX_CONSTRAINT_RETRIES = 2;

export async function processPlotNode(
  node: DetailedOutlineNode,
  nodeMap: Map<string, DetailedOutlineNode>,
  ctx: NarrativeContext,
  llm: LLMClient,
  slidingWindowSummary?: string,
): Promise<PlotNode> {
  const prevNodes = node.prev_node.map(id => nodeMap.get(id)).filter((n): n is DetailedOutlineNode => !!n);
  const nextNodes = node.next_node.map(id => nodeMap.get(id)).filter((n): n is DetailedOutlineNode => !!n);

  const prevResults = prevNodes.map(p => p.story_elements.plot.result).filter(Boolean);
  const nextCauses = nextNodes.map(n => n.story_elements.plot.cause).filter(Boolean);

  let constraintFeedback: string | undefined;
  let plot: PlotNode | undefined;

  for (let attempt = 0; attempt <= MAX_CONSTRAINT_RETRIES; attempt++) {
    const raw = await llm.callWithRetry(
      composeSystemPrompt(PLOT_GENERATION_COMPOSER, ctx),
      appendUserInstructions(buildPromptForNode(node, prevNodes, nextNodes, ctx, constraintFeedback, slidingWindowSummary), ctx),
      { responseFormat: "json" },
      validatePlotGeneration,
    );

    const parsed = extractJSON<Record<string, unknown>>(raw);
    plot = normalizePlot(parsed, node);

    const tcResult = validateTripleConstraints({
      content: plot.content,
      boundary_constraints: plot.boundary_constraints,
      scope_content: node.content,
      prev_result: prevResults.join("；"),
      next_cause: nextCauses.join("；"),
    });

    const issues = [...tcResult.errors, ...tcResult.warnings];
    if (issues.length === 0) break;

    if (attempt < MAX_CONSTRAINT_RETRIES) {
      constraintFeedback = issues.map((msg, i) => `${i + 1}. ${msg}`).join("\n");
      console.warn(`[L3] ${node.node_id} 三重约束未通过(第${attempt + 1}次)，触发修正重试:`, issues);
    } else {
      console.warn(`[L3] ${node.node_id} 三重约束重试${MAX_CONSTRAINT_RETRIES}次后仍有问题:`, issues);
    }
  }

  return plot!;
}

export async function plotGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const detailedOutlines = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  if (detailedOutlines.length === 0) {
    markStepSkipped(ctx, "plot_generation", ["detailed_outlines_generated"]);
    return;
  }

  // Pre-flight: check connection integrity before content generation
  // The first node with no prev is the legitimate DAG root; others are suspect
  const firstEntryId = detailedOutlines.find(n => n.prev_node.length === 0)?.node_id;
  const orphans = detailedOutlines.filter(
    n => n.prev_node.length === 0 && n.node_id !== firstEntryId,
  );
  const deadEnds = detailedOutlines.filter(
    n => n.next_node.length === 0 && n.prev_node.length > 0,
  );
  if (orphans.length > 0) {
    console.warn(
      `[L3] 连接完整性警告: ${orphans.length} 个非入口节点缺少 prev_node:`,
      orphans.map(n => n.node_id),
    );
  }
  if (deadEnds.length > 0 && deadEnds.length < detailedOutlines.length) {
    console.log(`[L3] 信息: ${deadEnds.length} 个节点为叶子节点（无后继）`);
  }

  const nodeMap = new Map(detailedOutlines.map(n => [n.node_id, n]));
  const nodeFilter = getNodeFilter(ctx);
  const targetNodes = nodeFilter
    ? detailedOutlines.filter(n => nodeFilter.has(n.node_id))
    : detailedOutlines;

  const _save = (ctx as Record<string, unknown>)._saveNode as ((s: string, n: string, d: unknown) => void) | undefined;

  // 拓扑分层执行：分支并行 + 主干顺序
  const layers = topologicalLayers(targetNodes);
  const summaryMap = new Map<string, string>();
  const plots: PlotNode[] = [];

  console.log(`[L3] 拓扑分层: ${layers.length} 层, 节点分布: ${layers.map(l => l.length).join(",")}`);

  for (const layer of layers) {
    const layerResults = await Promise.all(
      layer.map(async (node) => {
        const prevSummaries = node.prev_node
          .map(id => summaryMap.get(id))
          .filter(Boolean)
          .join("\n---\n");
        return processPlotNode(
          node, nodeMap, ctx, llm,
          prevSummaries || undefined,
        );
      }),
    );

    for (const plot of layerResults) {
      plots.push(plot);
      summaryMap.set(plot.node_id, buildSlidingWindowSummary(plot.content));
      _save?.("plot_generation", plot.node_id, plot);
    }
  }

  const plotIdMap: Record<string, string> = {};
  plots.forEach((p, i) => { plotIdMap[p.node_id] = `np_${i}`; });

  ctx.plots_generated = { plots, plot_id_map: plotIdMap };

  await structureValidationL3(ctx, llm);
}

// ════════════════════════════════════════════════════════
// WaveRunner 接线（M4）：分层/约束校验/摘要/合并/归一化五个处理器，与
// legacy 的 plotGeneration 共用 buildPromptForNode / normalizePlot /
// validateTripleConstraints / structureValidationL3，保证两条路径产出一致。
//
// 约束校验拿不到 legacy 循环里的 attempt 序号，重试次数达上限时的收尾日志
// 略去；不影响输出，只是控制台少一行诊断信息。
// ════════════════════════════════════════════════════════

/** 输出校验（抛错触发 LLM 重试）：与 legacy 循环体内 callWithRetry 的第四参同一条规则。 */
export function validatePlotGeneration(raw: string): void {
  const p = extractJSON<Record<string, unknown>>(raw);
  if (!p.content) throw new Error("情节 content 不能为空");
}

/** 按拓扑层分层：与 legacy 的连接完整性告警、分层日志逐字保留。 */
export function plotGenerationWaveLayerer(ctx: NarrativeContext): WaveUnit[][] {
  const detailedOutlines = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  if (detailedOutlines.length === 0) return [];

  const firstEntryId = detailedOutlines.find((n) => n.prev_node.length === 0)?.node_id;
  const orphans = detailedOutlines.filter(
    (n) => n.prev_node.length === 0 && n.node_id !== firstEntryId,
  );
  const deadEnds = detailedOutlines.filter(
    (n) => n.next_node.length === 0 && n.prev_node.length > 0,
  );
  if (orphans.length > 0) {
    console.warn(
      `[L3] 连接完整性警告: ${orphans.length} 个非入口节点缺少 prev_node:`,
      orphans.map((n) => n.node_id),
    );
  }
  if (deadEnds.length > 0 && deadEnds.length < detailedOutlines.length) {
    console.log(`[L3] 信息: ${deadEnds.length} 个节点为叶子节点（无后继）`);
  }

  const nodeMap = new Map(detailedOutlines.map((n) => [n.node_id, n]));
  const nodeFilter = getNodeFilter(ctx);
  const targetNodes = nodeFilter
    ? detailedOutlines.filter((n) => nodeFilter.has(n.node_id))
    : detailedOutlines;

  const layers = topologicalLayers(targetNodes);
  console.log(`[L3] 拓扑分层: ${layers.length} 层, 节点分布: ${layers.map((l) => l.length).join(",")}`);

  return layers.map((layer) =>
    layer.map((node) => ({
      unitId: node.node_id,
      data: {
        node,
        prevNodes: node.prev_node.map((id) => nodeMap.get(id)).filter((n): n is DetailedOutlineNode => !!n),
        nextNodes: node.next_node.map((id) => nodeMap.get(id)).filter((n): n is DetailedOutlineNode => !!n),
      },
      prevIds: node.prev_node,
    })),
  );
}

/**
 * 单元约束校验：与 legacy 循环体内的 `validateTripleConstraints` 调用同一组入参——
 * `boundary_constraints` 恒取自本节点骨架的 cause/result（不看模型输出），
 * 所以拿 unit.data 就够，不需要等归一化。errors 与 warnings 一并计入问题清单，
 * 两者都会触发重试，这是 legacy 的既有语义。
 */
export function plotGenerationWaveConstraintCheck(
  output: unknown,
  _ctx: NarrativeContext,
  unit: WaveUnit,
): string[] {
  const { node, prevNodes, nextNodes } = unit.data as {
    node: DetailedOutlineNode;
    prevNodes: DetailedOutlineNode[];
    nextNodes: DetailedOutlineNode[];
  };
  const raw = output as Record<string, unknown>;
  const prevResults = prevNodes.map((p) => p.story_elements.plot.result).filter(Boolean);
  const nextCauses = nextNodes.map((n) => n.story_elements.plot.cause).filter(Boolean);

  const tcResult = validateTripleConstraints({
    content: String(raw.content ?? ""),
    boundary_constraints: {
      cause: node.story_elements.plot.cause,
      result: node.story_elements.plot.result,
    },
    scope_content: node.content,
    prev_result: prevResults.join("；"),
    next_cause: nextCauses.join("；"),
  });

  return [...tcResult.errors, ...tcResult.warnings];
}

/** 滑动窗口摘要：直接对原始输出的 content 取摘要，与 legacy 对 `plot.content` 取摘要等值。 */
export function plotGenerationWaveSummarizer(output: unknown): string {
  const raw = output as Record<string, unknown>;
  return buildSlidingWindowSummary(String(raw.content ?? ""));
}

/**
 * 逐单元落地：每个节点一完成就调用 `ctx._saveNode`，对齐 legacy 在
 * `Promise.all` 每层 resolve 后立刻落盘的时机——WaveRunner 在单元完成时
 * （早于整个 wave 收尾）调用本钩子，中途取消不会丢已完成节点的落盘。
 */
export function plotGenerationChunkDone(
  chunk: { chunkId: string; output: unknown },
  ctx: NarrativeContext,
): void {
  const detailedOutlines = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  const node = detailedOutlines.find((n) => n.node_id === chunk.chunkId);
  if (!node) return;
  const plot = normalizePlot(chunk.output as Record<string, unknown>, node);
  const saveNode = (ctx as Record<string, unknown>)._saveNode as
    | ((stepId: string, nodeId: string, data: unknown) => void)
    | undefined;
  saveNode?.("plot_generation", plot.node_id, plot);
}

/**
 * 合并：按 WaveRunner 给出的层序（与 legacy 逐层 push 顺序一致）逐单元归一化，
 * `plot_id_map` 的 `np_N` 编号因此与 legacy 逐字对齐。落盘已由 chunkDone 做过，
 * 这里只重新归一化一次用于组装最终产物（与 polish 家族同一取舍：纯函数重算
 * 比额外传递已归一化结果更简单，且不产生副作用）。
 */
export function plotGenerationMerger(
  results: Array<{ chunkId: string; output: unknown }>,
  ctx: NarrativeContext,
): { plots: PlotNode[]; plot_id_map: Record<string, string> } {
  const detailedOutlines = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  const nodeMap = new Map(detailedOutlines.map((n) => [n.node_id, n]));

  const plots: PlotNode[] = [];
  for (const r of results) {
    const node = nodeMap.get(r.chunkId);
    if (!node) continue;
    plots.push(normalizePlot(r.output as Record<string, unknown>, node));
  }

  const plotIdMap: Record<string, string> = {};
  plots.forEach((p, i) => { plotIdMap[p.node_id] = `np_${i}`; });

  return { plots, plot_id_map: plotIdMap };
}

/**
 * 归一化：合并结果先落 `ctx.plots_generated`，再跑 L3 结构验证——
 * 与 legacy `ctx.plots_generated = {...}` 之后紧接 `await structureValidationL3(ctx, llm)`
 * 同一顺序，结构验证会就地改写 `ctx.plots_generated.plots` 修断连/环路。
 */
export async function normalizePlotGeneration(
  merged: unknown,
  ctx: NarrativeContext,
): Promise<{ plots: PlotNode[]; plot_id_map: Record<string, string> }> {
  ctx.plots_generated = merged as { plots: PlotNode[]; plot_id_map: Record<string, string> };
  await structureValidationL3(ctx);
  return ctx.plots_generated!;
}
