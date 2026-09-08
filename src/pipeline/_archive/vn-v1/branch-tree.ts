/**
 * branch-tree.ts (Stage C 重构版)
 * ─────────────────────────────────────────────────────────────────
 * 视觉小说 / 互动影游 的剧情分支树骨架。
 *
 * 同时支持两种工作模式（由 createAdaptiveCapability 根据 ctx.target_acts 自动路由）：
 *   - 短剧（target_acts <= 1）：单次 LLM 调用，一次性输出 8-15 节点
 *   - 长剧（target_acts >= 2）：三段式流程
 *       Phase 1  macro plan   — 1 次 LLM 输出 N 幕骨架 + 跨幕伏笔
 *       Phase 2  micro plan   — 每幕 1 次 LLM 输出 10-20 节点
 *       Phase 3  cross-act    — 1 次 LLM 输出 patches，自动应用到 nodes
 *       Phase 4  merge        — 拼接全部 acts + nodes + endings
 *
 * 输出结构在两种模式下兼容（短剧时 acts/consistency 字段缺省）。
 *
 * C2（2026-08）已封存：随 tpl-vn 一并搬进 `_archive/vn-v1/`，不再被任何活跃代码
 * import。业务功能吸收进 structure 席 + `tree.md` 结构卡，详见本目录 README。
 */
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { type PromptComposer } from "../../runtime/prompt-composer.js";
import { extractJSON } from "../../runtime/llm-client.js";
import {
  runUniversalAgent,
  createAdaptiveCapability,
  type ActPlan,
} from "../universal-agent/index.js";
import { parseJsonWithFallback } from "../universal-agent/universal-narrative.js";
import { isLongFormMode } from "../../runtime/narrative-scale.js";
import { getStepSkill } from "../../../knowledge/game-narrative/skill-loader.js";
import { runGraphQA, type GraphAdapter, type QaGraph } from "../../../utils/graph-qa.js";

/* ───────────── 类型定义 ───────────── */

export interface BranchTreeNode {
  id: string;
  title?: string;
  summary?: string;
  scene_role?: string;
  choice_prompt?: string;
  /**
   * 节点剧情角色（kino-engine 运行时消费）：
   *   - "normal" (default): 普通对话/抉择节点
   *   - "qte_climax": 高潮 QTE 决战点。标了之后下游 cinematic_storyboard
   *                    必须为该节点配 shots[].qte（pass/fail 二选一线）。
   * 旧 entry 没此字段时由 normalizeNodeKinds 兜底为 "normal"。
   */
  node_kind?: "normal" | "qte_climax";
  next?: Array<{
    to: string;
    label?: string;
    condition?: string;
    /**
     * 分支跳转类型（kino-engine 运行时根据这个决定 ChoiceLayer / auto / QTE 结算）：
     *   - "choice"  (default) 玩家选项
     *   - "auto"    无选项自动衔接（仅 1 个 next 时建议）
     *   - "qte_pass" / "qte_fail"  仅 qte_climax 节点成对使用
     * 旧 entry / 老 LLM 输出无此字段时由 normalizeNodeKinds 兜底推断。
     */
    kind?: "choice" | "auto" | "qte_pass" | "qte_fail";
  }>;
  /** 长剧模式下必填，短剧可缺省 */
  act_id?: string;
}

export interface BranchTreeAct extends ActPlan {
  emotional_arc?: string;
  key_events?: string[];
  duration_minutes?: number;
}

export interface MacroPlan {
  acts: BranchTreeAct[];
  global_pivots: Array<{
    act_from: string;
    act_to: string;
    type: "foreshadow" | "payoff" | "callback" | "twist";
    note: string;
  }>;
}

interface MicroActOutput {
  act_id: string;
  nodes: BranchTreeNode[];
  endings?: Array<{ id: string; title?: string; type?: string; trigger?: string }>;
  merge_points?: string[];
}

export interface ConsistencyReport {
  score: number;
  issues: Array<{
    node_id?: string;
    pivot_id?: string;
    severity: "info" | "warn" | "error";
    description: string;
  }>;
  patches: Array<
    | { type: "rewrite_summary"; node_id: string; new_summary: string }
    | { type: "add_foreshadow"; node_id: string; foreshadow_text: string }
    | { type: "fix_choice_label"; node_id: string; choice_index: number; new_label: string }
    | { type: "rewrite_ending_trigger"; ending_id: string; new_trigger: string }
  >;
}

export interface BranchTreeOutput {
  root_id: string;
  nodes: BranchTreeNode[];
  endings: Array<{ id: string; title?: string; type?: string; trigger?: string }>;
  merge_points?: string[];
  /** 长剧模式扩展 */
  acts?: BranchTreeAct[];
  consistency?: ConsistencyReport;
}

function resolveGenreCode(ctx: NarrativeContext): string | null {
  return ctx.tier_detection?.genre_code ?? ctx.demand_analysis?.genre_code ?? null;
}

/**
 * 从 ctx.branch_tree 提取下游覆盖率/引用校验所需的 id 集合。
 * 供 dialogue_script / cinematic_storyboard 复用（对齐分支树节点）。
 */
export function branchTreeRefIds(ctx: NarrativeContext): {
  nodeIds: string[];
  endingIds: string[];
  allTargets: Set<string>;
} {
  const tree = ctx.branch_tree as BranchTreeOutput | undefined;
  const nodeIds = (tree?.nodes ?? []).map((n) => n.id);
  const endingIds = (tree?.endings ?? []).map((e) => e.id);
  return { nodeIds, endingIds, allTargets: new Set([...nodeIds, ...endingIds]) };
}

/**
 * complexity 档位 → 期望分支树总节点范围
 * （与 composeComplexityPromptTail 对齐；这里只用于 branch_tree 自行算每幕分摊）
 *   1 极简: 5-10  | 2 短篇: 15-25 | 3 标准: 35-50 | 4 丰富: 75-100 | 5 史诗: 100-150
 * 缺省 → 与"标准"对齐，保持向后兼容。
 */
function totalNodesByComplexity(complexity: number | undefined): { min: number; max: number } {
  const presets: Record<number, { min: number; max: number }> = {
    1: { min: 5, max: 10 },
    2: { min: 15, max: 25 },
    3: { min: 35, max: 50 },
    4: { min: 75, max: 100 },
    5: { min: 100, max: 150 },
  };
  if (complexity == null) return presets[3];
  const c = Math.round(Math.max(1, Math.min(5, complexity)));
  return presets[c] ?? presets[3];
}

/**
 * 单幕节点数提示（按总节点数 / 幕数分摊，至少 5 个/幕，避免空幕）
 */
function buildPerActNodeHint(complexity: number | undefined, totalActs: number): string {
  const { min, max } = totalNodesByComplexity(complexity);
  const safeTotal = Math.max(1, totalActs);
  const perMin = Math.max(5, Math.floor(min / safeTotal));
  const perMax = Math.max(perMin + 2, Math.ceil(max / safeTotal));
  return `${perMin}-${perMax} 个节点（按总节点 ${min}-${max} / ${safeTotal} 幕摊算）`;
}

/* ───────────── 短剧（single-shot）composer ───────────── */

const ROLE = `你是视觉小说 / 互动影游叙事架构师。基于已有的世界观与角色，设计完整的剧情分支树。`;

const TASK = `## 任务
为故事设计一棵分支树：
- 节点总数请遵循下方"复杂度要求"档位的建议范围（不要硬卡 8-15）
- 入口节点（ROOT）→ 至少 2 个 branch 选项
- 每个分支至少 2 层深度，鼓励出现汇流点（蝴蝶效应）
- 至少 3 个差异显著的结局（HE/NE/BE/TE/Hidden）
- 关键决策点必须明确"代价/取舍"，不要纯水选项

## 节点与分支类型（互动影游运行时必须的离散语义）
- 每个节点必须给 node_kind：
    * "normal" (default)  普通对话/抉择节点
    * "qte_climax"        高潮 QTE 决战点（动作动词 + 紧迫感，如"敲门"/"撬锁"/"一击致命"）
  整树建议 1-3 个 qte_climax 节点；不要每场都放，否则疲劳
- 每个 next[].kind 必须给（缺省视为 choice）：
    * "choice"            普通选项（默认；常态多选时用）
    * "auto"              无选项自动衔接（仅 1 个 next 的纯过场时使用）
    * "qte_pass" / "qte_fail"  必须**且仅在** qte_climax 节点上成对使用
                          （2 个 next：第一个 = qte_pass 通往成功线；第二个 = qte_fail 通往失败/代价线）`;

const STYLE_PLACEHOLDER = `## 品类风格
{{SKILL.style_guide}}`;

const ARCHETYPE_PLACEHOLDER = `## 世界观/角色原型守则
{{SKILL.worldview_archetype}}
{{SKILL.character_archetype}}`;

const EXAMPLES_PLACEHOLDER = `## 示例参考
{{SKILL.examples}}`;

const CONSTRAINTS_PLACEHOLDER = `## 硬性约束
{{SKILL.constraints}}`;

const OUTPUT_FORMAT = `## 输出格式（严格 JSON）
{
  "branch_tree": {
    "root_id": "ROOT",
    "nodes": [
      {
        "id": "节点ID（如 N_01）",
        "title": "节点标题",
        "summary": "1-2 句剧情摘要",
        "scene_role": "opening|rising|turning|climax|ending",
        "node_kind": "normal|qte_climax",
        "choice_prompt": "玩家面对的选择问题（叶子/汇流节点为空字符串）",
        "next": [
          { "to": "下一节点ID", "label": "选项文本", "kind": "choice|auto|qte_pass|qte_fail", "condition": "（可选）触发条件" }
        ]
      }
    ],
    "endings": [
      { "id": "结局ID", "title": "结局名", "type": "good|bad|neutral|true|hidden", "trigger": "解锁条件" }
    ],
    "merge_points": ["汇流节点ID列表（可选）"]
  }
}`;

const USER_CONTEXT = (ctx: NarrativeContext): string => {
  // 不截断：现代 LLM (Gemini 2.5 Flash 1M tokens) 完全足以装下整个 worldview。
  const wv = ctx.worldview_structure ? JSON.stringify(ctx.worldview_structure) : "（无世界观）";
  const chars = ctx.detailed_character_sheets
    ? ctx.detailed_character_sheets.map((c) => `- ${c.name}: ${c.role ?? ""}`).join("\n")
    : "（无角色）";
  return `## 世界观（完整）\n${wv}\n\n## 角色阵容（完整）\n${chars}\n\n## 用户原始需求\n${ctx.user_input}`;
};

const BRANCH_TREE_COMPOSER: PromptComposer = {
  stepId: "branch_tree",
  blocks: {
    role: ROLE,
    task: TASK,
    style: STYLE_PLACEHOLDER,
    archetypes: ARCHETYPE_PLACEHOLDER,
    examples: EXAMPLES_PLACEHOLDER,
    constraints: CONSTRAINTS_PLACEHOLDER,
    output_format: OUTPUT_FORMAT,
    user_context: USER_CONTEXT,
  },
  systemBlockOrder: ["role", "task", "style", "archetypes", "examples", "constraints", "output_format"],
  userBlockOrder: ["user_context"],
  skillSlots: ["style_guide", "worldview_archetype", "character_archetype", "examples", "constraints"],
};

/* ───────────── 长剧（chunked）prompt builders ───────────── */

function buildMacroSystemPrompt(skillStyleGuide: string | undefined): string {
  return `你是互动影游长剧总策划。为多幕剧设计幕级结构（macro plan）。

## 任务
- 给定目标幕数 N，输出 N 个幕（acts）的骨架
- 每个幕：title / summary(50-150字) / emotional_arc(起→终情绪) / 3-6 个 key_events / duration_minutes
- 全局伏笔：≥2 条跨幕 pivot（foreshadow → payoff），明确指明 act_from / act_to
- 节奏：第 1 幕慢热铺垫，中段冲突升级，倒数第 2 幕高潮，末幕 ≥2 个差异结局选择

## 风格指南（来自品类 skill）
${skillStyleGuide ?? "（无品类风格补充）"}

## 输出格式（严格 JSON，禁止 markdown 代码块）
{
  "acts": [
    {
      "act_id": "A1",
      "title": "幕标题",
      "summary": "本幕梗概 50-150 字",
      "emotional_arc": "起情绪 → 终情绪",
      "key_events": ["事件1", "事件2"],
      "duration_minutes": 60
    }
  ],
  "global_pivots": [
    { "act_from": "A1", "act_to": "A3", "type": "foreshadow", "note": "..." }
  ]
}`;
}

function buildMacroUserPrompt(ctx: NarrativeContext): string {
  const targetActs = (ctx as Record<string, unknown>).target_acts as number;
  const wv = ctx.worldview_structure ? JSON.stringify(ctx.worldview_structure, null, 2) : "（无）";
  const initial = ctx.initial_story_outline ? JSON.stringify(ctx.initial_story_outline, null, 2) : "（无）";
  const chars = ctx.detailed_character_sheets
    ? ctx.detailed_character_sheets.map((c) => `- ${c.name}: ${c.role ?? ""}`).join("\n")
    : "（无）";

  return `## 目标幕数
${targetActs} 幕

## 用户原始需求（必须遵循）
${ctx.user_input}

## 初步方案
${initial}

## 世界观（完整）
${wv}

## 角色阵容（完整）
${chars}

请输出 ${targetActs} 幕的 macro plan。`;
}

function buildMicroSystemPrompt(skillStyleGuide: string | undefined, perActNodeHint: string): string {
  return `你是互动影游编剧。为单个幕（act）展开节点级分支树。

## 任务
- 仅展开当前幕，输出 ${perActNodeHint}（act_id 必须与给定一致）
- 节点 ID 格式：{act_id}_N{两位序号}，如 A1_N01
- 至少 1 个 choice_prompt 节点（玩家决策点），每个 choice 必须明确"代价/取舍"
- 至少 2 层分支深度，鼓励幕内汇流
- 仅在末幕（标记 is_last_act=true）输出 endings 数组（≥2 个）
- 节点的 next.to 可以指向：本幕节点 / 下一幕首节点（{next_act}_N01）/ 结局 ID

## 节点与分支类型（互动影游运行时必须的离散语义）
- 每个节点必须给 node_kind：
    * "normal" (default)  普通对话/抉择节点
    * "qte_climax"        高潮 QTE 决战点（动作动词 + 紧迫感）
  本幕建议 0-2 个 qte_climax 节点
- 每个 next[].kind 必须给（缺省视为 choice）：
    * "choice"            普通选项（默认）
    * "auto"              无选项自动衔接（仅 1 个 next 的纯过场时使用）
    * "qte_pass" / "qte_fail"  必须**且仅在** qte_climax 节点上成对使用

## 风格指南（来自品类 skill）
${skillStyleGuide ?? "（无）"}

## 输出格式（严格 JSON）
{
  "act_id": "A1",
  "nodes": [
    {
      "id": "A1_N01",
      "title": "...",
      "summary": "...",
      "scene_role": "opening|rising|turning|climax|ending",
      "node_kind": "normal|qte_climax",
      "choice_prompt": "（无选择则空字符串）",
      "next": [{ "to": "下一节点ID", "label": "选项文本", "kind": "choice|auto|qte_pass|qte_fail", "condition": "（可选）" }],
      "act_id": "A1"
    }
  ],
  "endings": [/* 仅末幕填写 */],
  "merge_points": ["A1_N05", "..."]
}`;
}

function buildMicroUserPrompt(
  act: ActPlan,
  idx: number,
  total: number,
  ctx: NarrativeContext,
  macro: MacroPlan,
): string {
  const prevAct = idx > 0 ? macro.acts[idx - 1] : null;
  const nextAct = idx < total - 1 ? macro.acts[idx + 1] : null;
  const isLast = idx === total - 1;
  const wv = ctx.worldview_structure ? JSON.stringify(ctx.worldview_structure) : "（无）";

  const pivots = macro.global_pivots
    .filter((p) => p.act_from === act.act_id || p.act_to === act.act_id)
    .map((p) => `- ${p.type}: ${p.act_from} → ${p.act_to}: ${p.note}`)
    .join("\n");

  return `## 当前幕
${JSON.stringify(act, null, 2)}

is_last_act: ${isLast}

## 邻幕摘要
- 上一幕: ${prevAct ? `${prevAct.act_id} ${prevAct.title}: ${prevAct.summary}` : "（无，本幕为首幕）"}
- 下一幕: ${nextAct ? `${nextAct.act_id} ${nextAct.title}: ${nextAct.summary}` : "（无，本幕为末幕）"}

## 涉及本幕的跨幕 pivot
${pivots || "（无）"}

## 世界观
${wv}

## 用户原始需求
${ctx.user_input}

请展开 ${act.act_id} 的节点列表（节点数遵循 system 提示中的"任务"行）。`;
}

function buildConsistencyPrompt(): string {
  return `你是互动影游跨幕一致性审查官。

## 任务
检查全剧的跨幕逻辑：
- 伏笔是否被支付（foreshadow → payoff）
- 人设是否前后一致
- 选项 label 是否描述清楚代价
- 结局触发条件是否能在 nodes 中真实达成
- 汇流点是否被≥2 个分支命中

## 输出修复策略（patch 模式，自动应用）
- 仅在确实必要时输出 patch；过度修改反而破坏作者意图
- 一个节点最多 1 条 patch
- patches 总数 ≤ nodes 数 / 5

## 输出格式（严格 JSON）
{
  "score": 0.0-1.0,
  "issues": [
    { "node_id": "A2_N03", "severity": "warn", "description": "..." }
  ],
  "patches": [
    { "type": "rewrite_summary", "node_id": "A2_N03", "new_summary": "..." },
    { "type": "add_foreshadow", "node_id": "A1_N02", "foreshadow_text": "..." },
    { "type": "fix_choice_label", "node_id": "A2_N04", "choice_index": 1, "new_label": "..." },
    { "type": "rewrite_ending_trigger", "ending_id": "E1", "new_trigger": "..." }
  ]
}`;
}

/* ───────────── 解析 / 应用工具 ───────────── */

/**
 * 兜底标准化：把 LLM 没填的 node_kind / next[].kind 按启发式补全。
 *
 * 这一层是「字段离散化保险」—— 旧 entry / 老 LLM 输出走一遍后，下游
 * (cinematic_storyboard / 任何外部 reader 比如 kino-studio) 永远拿到完整
 * 的离散枚举字段，不必各自再写"如果字段不存在"的兜底。
 *
 * 推断规则（仅在 LLM 缺字段时生效，已填字段一概保留）：
 *   - node.node_kind 缺省 → "normal"
 *   - next[].kind 缺省时按 (node_kind, total) 推：
 *       * qte_climax + 恰好 2 个 next → idx 0 = qte_pass / idx 1 = qte_fail
 *       * 只有 1 个 next                → "auto"
 *       * 其它                          → "choice"
 *
 * 这意味着：
 *   - LLM 永远「显式填了 kind」时这个函数无副作用
 *   - 老 ctx 没字段时也能直出可用结构（不会让 kino reader 拿到 undefined）
 */
function normalizeNodeKinds(nodes: BranchTreeNode[]): BranchTreeNode[] {
  for (const n of nodes) {
    if (!n.node_kind) n.node_kind = "normal";
    if (!Array.isArray(n.next) || n.next.length === 0) continue;
    const total = n.next.length;
    n.next.forEach((b, idx) => {
      if (b.kind) return;
      if (n.node_kind === "qte_climax" && total === 2) {
        b.kind = idx === 0 ? "qte_pass" : "qte_fail";
      } else if (total === 1) {
        b.kind = "auto";
      } else {
        b.kind = "choice";
      }
    });
  }
  return nodes;
}

function parseSingleShot(raw: string): BranchTreeOutput {
  const inner = parseJsonWithFallback<{ nodes: BranchTreeNode[] } & Partial<BranchTreeOutput>>(
    raw,
    (data) => Array.isArray((data as { nodes?: BranchTreeNode[] }).nodes),
    "branch_tree",
  );
  return {
    root_id: inner.root_id ?? "ROOT",
    nodes: normalizeNodeKinds(inner.nodes),
    endings: inner.endings ?? [],
    merge_points: inner.merge_points,
  };
}

function parseMacroPlan(raw: string): MacroPlan {
  const parsed = extractJSON<MacroPlan>(raw);
  if (!parsed?.acts || !Array.isArray(parsed.acts) || parsed.acts.length === 0) {
    throw new Error("branch_tree macro_plan 解析失败：acts 为空");
  }
  return {
    acts: parsed.acts,
    global_pivots: Array.isArray(parsed.global_pivots) ? parsed.global_pivots : [],
  };
}

function parseMicroAct(raw: string, act: ActPlan): MicroActOutput {
  const parsed = extractJSON<MicroActOutput>(raw);
  if (!parsed?.nodes || !Array.isArray(parsed.nodes)) {
    throw new Error(`branch_tree micro_plan act ${act.act_id} 解析失败`);
  }
  for (const node of parsed.nodes) {
    if (!node.act_id) node.act_id = act.act_id;
  }
  return {
    act_id: act.act_id,
    nodes: normalizeNodeKinds(parsed.nodes),
    endings: parsed.endings,
    merge_points: parsed.merge_points,
  };
}

function parseConsistency(raw: string): ConsistencyReport {
  const parsed = extractJSON<ConsistencyReport>(raw);
  if (!parsed) throw new Error("consistency_check parse failed");
  return {
    score: typeof parsed.score === "number" ? parsed.score : 0.7,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    patches: Array.isArray(parsed.patches) ? parsed.patches : [],
  };
}

/** 应用 cross-act check 输出的 patches 到 micros 数组（in-place 修改 nodes/endings）。 */
function applyConsistencyPatches(
  micros: MicroActOutput[],
  check: ConsistencyReport,
): MicroActOutput[] {
  const allNodes = micros.flatMap((m) => m.nodes);
  const allEndings = micros.flatMap((m) => m.endings ?? []);
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const endingMap = new Map(allEndings.map((e) => [e.id, e]));

  for (const patch of check.patches) {
    switch (patch.type) {
      case "rewrite_summary": {
        const n = nodeMap.get(patch.node_id);
        if (n) n.summary = patch.new_summary;
        break;
      }
      case "add_foreshadow": {
        const n = nodeMap.get(patch.node_id);
        if (n) n.summary = `${n.summary ?? ""}\n[伏笔] ${patch.foreshadow_text}`.trim();
        break;
      }
      case "fix_choice_label": {
        const n = nodeMap.get(patch.node_id);
        if (n?.next?.[patch.choice_index]) n.next[patch.choice_index].label = patch.new_label;
        break;
      }
      case "rewrite_ending_trigger": {
        const e = endingMap.get(patch.ending_id);
        if (e) e.trigger = patch.new_trigger;
        break;
      }
    }
  }
  return micros;
}

/* ───────────── Capability：单 spec 同时描述短剧 + 长剧路径 ───────────── */

export const branchTreeCapability = createAdaptiveCapability<BranchTreeOutput, MicroActOutput, MacroPlan, ConsistencyReport>({
  id: "branch_tree",
  description: "VN/互动影游剧情分支树（短剧单次 / 长剧分幕自动切换）",
  needsKeys: ["S"],
  minNeed: 1,
  outputField: "branch_tree",

  // 短剧路径
  singleShot: {
    composer: BRANCH_TREE_COMPOSER,
    parse: parseSingleShot,
    temperature: 0.7,
  },

  // 长剧路径（producer 模式：自己生产 acts）
  chunked: {
    enable: (ctx) => isLongFormMode((ctx as Record<string, unknown>).target_acts as number | undefined),

    actsPlan: {
      mode: "produce",
      buildPrompt: (ctx) => {
        const skill = getStepSkill(resolveGenreCode(ctx), "branch_tree");
        return {
          systemPrompt: buildMacroSystemPrompt(skill?.slots?.style_guide),
          userPrompt: buildMacroUserPrompt(ctx),
        };
      },
      parse: parseMacroPlan,
      truncationLabel: "branch_tree.macro_plan",
      temperature: 0.7,
    },

    extractActs: (macro) => macro.acts,

    perAct: {
      buildPrompt: (act, idx, total, ctx, macro) => {
        const skill = getStepSkill(resolveGenreCode(ctx), "branch_tree");
        const complexity = ctx.global_control_params?.complexity;
        const perActHint = buildPerActNodeHint(complexity, total);
        return {
          systemPrompt: buildMicroSystemPrompt(skill?.slots?.style_guide, perActHint),
          userPrompt: buildMicroUserPrompt(act, idx, total, ctx, macro),
        };
      },
      parse: parseMicroAct,
      truncationLabel: (act) => `branch_tree.micro_plan.${act.act_id}`,
      temperature: 0.7,
      swallowError: false, // micro 失败必须抛出 — 缺一幕整剧不可用
    },

    crossActCheck: {
      buildPrompt: (macro, micros) => {
        const allNodes = micros.flatMap((m) => m.nodes);
        const allEndings = micros.flatMap((m) => m.endings ?? []);
        return {
          systemPrompt: buildConsistencyPrompt(),
          userPrompt: `## Macro Plan\n${JSON.stringify(macro, null, 2)}\n\n## 全剧节点\n${JSON.stringify(allNodes, null, 2)}\n\n## 结局\n${JSON.stringify(allEndings, null, 2)}`,
        };
      },
      parse: parseConsistency,
      apply: applyConsistencyPatches,
      onFailure: () => ({ score: 0.7, issues: [], patches: [] }),
      truncationLabel: "branch_tree.consistency_check",
      temperature: 0.3,
    },

    merge: (macro, micros, check) => {
      const allNodes = micros.flatMap((m) => m.nodes);
      const allEndings = micros.flatMap((m) => m.endings ?? []);
      const allMergePoints = micros.flatMap((m) => m.merge_points ?? []);
      // 长剧路径：cross-act 阶段的 patch 可能新增 nodes 或改动 next；再标准化一遍
      // 让最终输出的 next[].kind 不出现 undefined。短剧路径在 parseSingleShot 已做。
      return {
        root_id: allNodes[0]?.id ?? "ROOT",
        nodes: normalizeNodeKinds(allNodes),
        endings: allEndings,
        merge_points: [...new Set(allMergePoints)],
        acts: macro.acts,
        consistency: check,
      };
    },
  },
});

/* ───────────── Step 入口 ───────────── */

export async function branchTree(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  await runUniversalAgent(
    {
      stepId: "branch_tree",
      name: "BranchTreeAgent",
      outputField: "branch_tree",
      capabilities: [branchTreeCapability],
      aggregate: (results) => results[0]?.output ?? { nodes: [] },
      emptyFallback: () => ({ nodes: [] }),
      // 单 capability 不开评估器，避免单步成本翻倍
      evaluator: { disabled: true },
    },
    ctx,
    llm,
  );

  // ── 结构质量门：算法校验 → 修复 → LLM critic 兜底 ──
  // 短剧路径此前完全裸奔（仅 normalizeNodeKinds），孤儿结局 / 死胡同 / 重复边
  // 直接落盘。这里统一过一遍共享 graph-qa（合法时是 no-op，零额外 LLM 成本）。
  await qaBranchTree(ctx, llm);
}

/**
 * branch_tree 输出 ⇄ 规范图的适配器。
 * - 节点：output.nodes（普通）+ output.endings（标 isEnding 的终止节点）
 * - 边：node.next[].to（单向）
 */
function branchTreeAdapter(): GraphAdapter<BranchTreeOutput> {
  return {
    toCanonical(out: BranchTreeOutput): QaGraph {
      const nodes = (out.nodes ?? []).map((n) => ({
        id: n.id,
        next: (n.next ?? []).map((e) => e.to).filter(Boolean),
        label: n.title ?? n.summary,
      }));
      const endings = (out.endings ?? []).map((e) => ({
        id: e.id,
        next: [] as string[],
        isEnding: true,
        label: e.title,
        tokens: e.type ? [e.type] : undefined,
      }));
      return { rootId: out.root_id ?? out.nodes?.[0]?.id ?? "ROOT", nodes: [...nodes, ...endings] };
    },
    applyRepairs(out: BranchTreeOutput, repaired: QaGraph): void {
      const nodeById = new Map((out.nodes ?? []).map((n) => [n.id, n]));
      const endingIds = new Set((out.endings ?? []).map((e) => e.id));
      const promoteToEnding: string[] = [];

      for (const cn of repaired.nodes) {
        if (cn.isEnding) {
          // LLM critic 可能把某普通节点标成结局 → 迁入 endings 数组
          if (nodeById.has(cn.id) && !endingIds.has(cn.id)) promoteToEnding.push(cn.id);
          continue;
        }
        const orig = nodeById.get(cn.id);
        if (!orig) continue;
        const existingByTo = new Map((orig.next ?? []).map((e) => [e.to, e]));
        // 规范图的 next 是边的真相来源；保留已有边的 label/kind，新增边交给 normalize 推断 kind
        orig.next = cn.next.map((to) => existingByTo.get(to) ?? { to });
      }

      for (const id of promoteToEnding) {
        const n = nodeById.get(id);
        if (n) {
          out.endings = out.endings ?? [];
          out.endings.push({ id, title: n.title, type: "neutral" });
          out.nodes = out.nodes.filter((x) => x.id !== id);
        }
      }

      normalizeNodeKinds(out.nodes);
    },
  };
}

async function qaBranchTree(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const out = ctx.branch_tree as BranchTreeOutput | undefined;
  if (!out || !Array.isArray(out.nodes) || out.nodes.length === 0) return;

  const summaries: Record<string, string> = {};
  for (const n of out.nodes) if (n.summary) summaries[n.id] = n.summary;

  const report = await runGraphQA(out, branchTreeAdapter(), {
    llm,
    label: "branch_tree",
    contextHint: ctx.vn_logline?.content ?? ctx.user_preference_summary,
    summaries,
  });

  // 把质量门报告挂到产出上，供历史记录/调试查看（不影响下游消费）
  (out as unknown as Record<string, unknown>).__graph_qa = {
    valid: report.valid,
    repairs: report.repairsApplied,
    residual: report.residualIssues.map((i) => i.detail),
    llmTouched: report.llmTouched,
    llmVerdict: report.llmVerdict,
  };
}
