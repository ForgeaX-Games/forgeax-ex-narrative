/**
 * dialogue-script.ts (Stage C 重构版)
 * ─────────────────────────────────────────────────────────────────
 * 视觉小说 / 互动影游对话脚本：基于 branch_tree 节点写出具体台词与场景描写。
 *
 * 工作模式（由 createAdaptiveCapability 自动路由）：
 *   - 短剧（target_acts <= 1）：单次 LLM 调用，覆盖整棵 branch_tree
 *   - 长剧（target_acts >= 2 且 branch_tree.acts 存在）：consumer 模式
 *       · 从 ctx.branch_tree.acts 读取幕骨架（不再生产 macro）
 *       · 每幕一次 LLM 输出该幕节点的对话
 *       · 合并所有幕的 scripts
 *
 * VN 类品类的 skill 通过 dialogue_script.slots.* 注入语调、节奏与对白要求。
 *
 * C2（2026-08）已封存：随 tpl-vn 一并搬进 `_archive/vn-v1/`，不再被任何活跃代码
 * import。业务功能吸收进 plot 席（plot_generation），详见本目录 README。
 */
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { type PromptComposer } from "../../runtime/prompt-composer.js";
import {
  runUniversalAgent,
  createAdaptiveCapability,
  type ActPlan,
} from "../universal-agent/index.js";
import { isLongFormMode } from "../../runtime/narrative-scale.js";
import { getStepSkill } from "../../../knowledge/game-narrative/skill-loader.js";
import { validateCoverage } from "../../../utils/graph-qa.js";
import { branchTreeRefIds } from "./branch-tree.js";

/**
 * 台词角色枚举（kino-engine 运行时消费）：
 *   - "narration"    旁白（白色字幕条）
 *   - "protagonist"  主角（玩家代入角色，居右带头像位）
 *   - "character"    其他出场角色（居左带头像位）
 *   - "system"       UI / 系统提示（如"任务完成"，与剧情解耦）
 */
type DialogueRole = "narration" | "protagonist" | "character" | "system";

interface DialogueLine {
  speaker: string;
  text: string;
  emotion?: string;
  /**
   * ★ 离散角色枚举。LLM 应主动给（参考角色档案识别 protagonist）；
   * 未给时由 normalizeDialogueLines 兜底：speaker 含 "narrator/旁白" → narration，
   * 否则默认 "character"（protagonist 必须 LLM 显式标，避免误判）。
   */
  role?: DialogueRole;
  /**
   * ★ 在 scene 时间线上的出现时刻 (ms, 相对 scene 起点 0)。
   * 缺省时 normalizeDialogueLines 按"60ms/字 + 800ms 静默间隙"顺序累加推算。
   */
  startMs?: number;
  /**
   * ★ 消失时刻 (ms)；不填由 normalize 推算（startMs + 文字打字时长 + 800ms）。
   */
  endMs?: number;
  /** ★ 单字打字速度 ms（强情绪 100-150；急促 30-40；缺省 60）。 */
  charMs?: number;
}

interface DialogueScript {
  node_id: string;
  title?: string;
  scene?: string;
  lines: DialogueLine[];
  choices?: Array<{ text: string; leads_to: string }>;
}

interface DialogueScriptOutput {
  scripts: DialogueScript[];
}

interface BranchNode {
  id: string;
  act_id?: string;
  [key: string]: unknown;
}

function resolveGenreCode(ctx: NarrativeContext): string | null {
  return ctx.tier_detection?.genre_code ?? ctx.demand_analysis?.genre_code ?? null;
}

/* ───────────── 短剧 composer ───────────── */

const ROLE = `你是视觉小说 / 互动影游编剧。基于剧情分支节点，为每个节点写出具体对话脚本与场景描写。`;

const TASK = `## 任务
- 为 branch_tree 中每个有 choice_prompt 的关键节点生成 12-30 行对话/旁白
- 角色台词体现性格差异（参考已有角色档案）
- 场景描写富有画面感（地点、时间、氛围、感官细节）
- 选项文本简洁有张力（不超过 20 字），且与"代价/取舍"挂钩

## 时间线与角色（互动影游运行时必须的离散语义）
- 每行 lines[] 必须给 role：
    * "narration"    旁白（speaker="narrator" 或 "旁白"）
    * "protagonist"  主角（请从"角色档案"识别玩家代入角色，按其名标 protagonist）
    * "character"    其他出场角色（speaker = 具体角色名）
    * "system"       UI/系统提示（"按 X 跳过"等，剧情里很少用）
- startMs / endMs（强烈建议给 — 不给则 60ms/字 + 800ms 静默自动推算）：
    * startMs = 这条台词在场景时间轴上的出现时刻（ms 相对场景起点 0）
    * endMs   = 这条台词消失时刻；不填由下一条 startMs 决定
    * 节奏建议：旁白宽容（800-1500ms 间隙），紧张对白紧凑（300-600ms 间隙）
- charMs（可选）：单字打字速度 ms。强情绪 / 慢节奏填 100-150；急促 30-40；缺省 60`;

const STYLE_PLACEHOLDER = `## 品类风格
{{SKILL.style_guide}}`;
const PACING_PLACEHOLDER = `## 节奏 / 对白守则
{{SKILL.dialogue_pacing}}`;
const EXAMPLES_PLACEHOLDER = `## 示例参考
{{SKILL.examples}}`;
const CONSTRAINTS_PLACEHOLDER = `## 硬性约束
{{SKILL.constraints}}`;

const OUTPUT_FORMAT = `## 输出格式（严格 JSON）
{
  "scripts": [
    {
      "node_id": "对应 branch_tree 节点ID",
      "title": "场景标题",
      "scene": "场景描述（地点/时间/氛围）",
      "lines": [
        {
          "speaker": "角色名（旁白用 narrator）",
          "role": "narration|protagonist|character|system",
          "text": "台词",
          "emotion": "情绪标签（可选）",
          "startMs": 0,
          "endMs": 1500,
          "charMs": 60
        }
      ],
      "choices": [
        { "text": "选项文本", "leads_to": "目标节点ID" }
      ]
    }
  ]
}`;

const USER_CONTEXT = (ctx: NarrativeContext): string => {
  const tree = (ctx as Record<string, unknown>).branch_tree;
  const treeStr = tree ? JSON.stringify(tree, null, 2) : "（无分支树）";
  const chars = ctx.detailed_character_sheets
    ? ctx.detailed_character_sheets.map((c) => `- ${c.name}: ${c.role ?? ""}`).join("\n")
    : "（无角色）";

  // 用户口头需求 + 上传剧本（如有）：保留原文细节，让台词忠于用户素材
  const userInputBlock = ctx.user_input
    ? `## 用户原始需求 / 上传剧本（务必参考其语气、用词、人物口吻、情节细节）\n${ctx.user_input}\n`
    : "";

  return `${userInputBlock}## 角色（完整）\n${chars}\n\n## 分支树（完整）\n${treeStr}\n\n请为分支树中**每个**有 choice_prompt 的节点 + 每个 ending 节点编写对话脚本。\n\n注意：若上方有「用户原始需求 / 上传剧本」，请尽量复用其原文台词、保留人物名字与场景命名，不要凭空改写。`;
};

const DIALOGUE_SCRIPT_COMPOSER: PromptComposer = {
  stepId: "dialogue_script",
  blocks: {
    role: ROLE,
    task: TASK,
    style: STYLE_PLACEHOLDER,
    pacing: PACING_PLACEHOLDER,
    examples: EXAMPLES_PLACEHOLDER,
    constraints: CONSTRAINTS_PLACEHOLDER,
    output_format: OUTPUT_FORMAT,
    user_context: USER_CONTEXT,
  },
  systemBlockOrder: ["role", "task", "style", "pacing", "examples", "constraints", "output_format"],
  userBlockOrder: ["user_context"],
  skillSlots: ["style_guide", "dialogue_pacing", "examples", "constraints"],
};

/* ───────────── 长剧 prompt builders ───────────── */

function buildPerActSystemPrompt(skillStyleGuide: string | undefined, pacing: string | undefined): string {
  return `你是互动影游编剧。为单幕的所有节点写出具体台词与场景描写。

## 任务
- 仅为给定 act_id 的节点编写对话（不要触碰其他幕的节点）
- 每个有 choice_prompt 的节点：12-30 行台词 + 场景描写 + choices
- 每个 ending 节点：8-15 行收尾台词 + 关键氛围描写
- 角色台词体现性格差异（参考角色档案）
- 选项文本简洁有张力（≤20 字）

## 时间线与角色（互动影游运行时必须的离散语义）
- 每行 lines[] 必须给 role：
    * "narration"    旁白（speaker="narrator" 或 "旁白"）
    * "protagonist"  主角（请从角色档案识别玩家代入角色）
    * "character"    其他出场角色
    * "system"       UI/系统提示（很少用）
- startMs / endMs（强烈建议给 — 不给则 60ms/字 + 800ms 静默自动推算）：
    * startMs = 这条台词在场景时间轴上的出现时刻（ms，相对场景起点 0）
    * endMs   = 消失时刻；不填由下一条 startMs 决定
- charMs（可选）：单字打字速度 ms。强情绪 100-150；急促 30-40；缺省 60

## 风格指南
${skillStyleGuide ?? "（无）"}

## 节奏 / 对白守则
${pacing ?? "（无）"}

## 输出格式（严格 JSON）
{
  "scripts": [
    {
      "node_id": "A1_N03",
      "title": "...",
      "scene": "地点/时间/氛围",
      "lines": [
        {
          "speaker": "角色名（旁白用 narrator）",
          "role": "narration|protagonist|character|system",
          "text": "台词",
          "emotion": "情绪标签（可选）",
          "startMs": 0,
          "endMs": 1500,
          "charMs": 60
        }
      ],
      "choices": [
        { "text": "选项文本", "leads_to": "目标节点ID" }
      ]
    }
  ]
}`;
}

function buildPerActUserPrompt(act: ActPlan, actNodes: BranchNode[], ctx: NarrativeContext): string {
  const chars = ctx.detailed_character_sheets
    ? ctx.detailed_character_sheets.map((c) => `- ${c.name}: ${c.role ?? ""}`).join("\n")
    : "（无）";

  // 用户口头需求 + 上传剧本（如有）：保留原文细节，让台词忠于用户素材
  const userInputBlock = ctx.user_input
    ? `## 用户原始需求 / 上传剧本（务必参考其语气、用词、人物口吻、情节细节；可复用原文台词）\n${ctx.user_input}\n\n`
    : "";

  return `${userInputBlock}## 当前幕信息
${JSON.stringify(act, null, 2)}

## 当前幕的节点列表（仅展开这些节点的对话）
${JSON.stringify(actNodes, null, 2)}

## 角色档案
${chars}

请为以上节点逐一编写对话脚本。若上方有「用户原始需求 / 上传剧本」，请优先复用其原文台词、保留人物名字与场景命名，不要凭空改写。`;
}

/* ───────────── Normalize：兜底补全 role / startMs / endMs ───────────── */

const DEFAULT_CHAR_MS = 60;
const DEFAULT_GAP_MS = 800;

function inferRoleFromSpeaker(speaker: string | undefined): DialogueRole {
  if (!speaker) return "narration";
  const s = speaker.trim().toLowerCase();
  if (s === "narrator" || s === "narration" || s.includes("旁白")) return "narration";
  // protagonist 必须 LLM 显式标（避免误判第一个角色）；未标的默认 character
  return "character";
}

/**
 * 兜底：把 LLM 没填的 role / startMs / endMs / charMs 按顺序累加推算。
 *
 * 这一层是「时间轴 + 角色枚举的离散化保险」—— LLM 只要填了 text + speaker
 * 就能用，下游 (kino-engine) 永远拿到 startMs/endMs 不缺的 lines[]，
 * 不必各自再写"如果 startMs undefined 用什么"的兜底。
 *
 * 推算规则（仅在 LLM 缺字段时生效）：
 *   - role 缺省：speaker 含 "narrator/旁白" → narration；其他 → character
 *   - startMs 缺省：从 cursor=0 顺序累加；每条占 (charMs * text.length + 800ms 静默)
 *   - endMs 缺省：startMs + (charMs * text.length + 800ms)
 *   - LLM 显式给了 startMs 但没给 endMs：endMs = startMs + 文字打字时长 + 800ms
 *   - LLM 全显式给了：cursor 跟齐到 endMs（之后未给 startMs 的从这里继续累加）
 */
function normalizeDialogueLines(lines: DialogueLine[]): DialogueLine[] {
  if (!Array.isArray(lines)) return [];
  let cursor = 0;
  for (const line of lines) {
    if (!line.role) line.role = inferRoleFromSpeaker(line.speaker);
    const charMs = line.charMs ?? DEFAULT_CHAR_MS;
    const typeDuration = (line.text?.length ?? 0) * charMs;
    if (line.startMs == null) {
      line.startMs = cursor;
      cursor = line.startMs + typeDuration + DEFAULT_GAP_MS;
      if (line.endMs == null) line.endMs = cursor;
    } else if (line.endMs == null) {
      line.endMs = line.startMs + typeDuration + DEFAULT_GAP_MS;
      cursor = Math.max(cursor, line.endMs);
    } else {
      cursor = Math.max(cursor, line.endMs);
    }
  }
  return lines;
}

function normalizeScripts(scripts: DialogueScript[]): DialogueScript[] {
  if (!Array.isArray(scripts)) return [];
  for (const s of scripts) {
    if (Array.isArray(s.lines)) normalizeDialogueLines(s.lines);
  }
  return scripts;
}

/* ───────────── Capability：消费者模式（acts 来自 ctx.branch_tree.acts） ───────────── */

interface BranchTreeWithActs {
  acts?: ActPlan[];
  nodes?: BranchNode[];
}

export const dialogueScriptCapability = createAdaptiveCapability<
  DialogueScriptOutput,
  DialogueScript[],     // 每幕产出 DialogueScript[]
  BranchTreeWithActs    // actsList = ctx.branch_tree
>({
  id: "dialogue_script",
  description: "VN/互动影游对话脚本（短剧单次 / 长剧分幕自动切换）",
  needsKeys: ["D"],
  minNeed: 2,
  outputField: "dialogue_script",

  preflight: (ctx) => {
    const tree = (ctx as Record<string, unknown>).branch_tree;
    if (!tree) return { skip: true, placeholder: { scripts: [] } };
    return { skip: false };
  },

  // 短剧：复用 composer
  singleShot: {
    composer: DIALOGUE_SCRIPT_COMPOSER,
    parse: (raw) => {
      const parsed = extractJSON<DialogueScriptOutput | { scripts?: unknown[] }>(raw);
      if (parsed && Array.isArray((parsed as DialogueScriptOutput).scripts)) {
        const out = parsed as DialogueScriptOutput;
        out.scripts = normalizeScripts(out.scripts);
        return out;
      }
      return { scripts: [] };
    },
    temperature: 0.8,
  },

  // 长剧：consumer 模式（从 ctx.branch_tree.acts 读 acts）
  chunked: {
    enable: (ctx) => isLongFormMode((ctx as Record<string, unknown>).target_acts as number | undefined),

    actsPlan: {
      mode: "consume",
      source: (ctx) => {
        const tree = (ctx as Record<string, unknown>).branch_tree as BranchTreeWithActs | undefined;
        if (!tree?.acts || !tree?.nodes) return undefined;
        return tree;
      },
      emptyOnMissingActs: () => ({ scripts: [] }),
    },

    extractActs: (tree) => tree.acts ?? [],

    perAct: {
      buildPrompt: (act, _idx, _total, ctx, tree) => {
        const skill = getStepSkill(resolveGenreCode(ctx), "dialogue_script");
        const actNodes = (tree.nodes ?? []).filter((n) => n.act_id === act.act_id);
        return {
          systemPrompt: buildPerActSystemPrompt(skill?.slots?.style_guide, skill?.slots?.dialogue_pacing),
          userPrompt: buildPerActUserPrompt(act, actNodes, ctx),
        };
      },
      parse: (raw): DialogueScript[] => {
        const parsed = extractJSON<{ scripts?: DialogueScript[] }>(raw);
        const scripts = Array.isArray(parsed?.scripts) ? parsed.scripts : [];
        return normalizeScripts(scripts);
      },
      truncationLabel: (act) => `dialogue_script.${act.act_id}`,
      temperature: 0.8,
      swallowError: true, // dialogue 单幕失败 → 跳过该幕，继续后续
    },

    // dialogue 不需要跨幕一致性检查（branch_tree 已经过 cross-act 校对）
    merge: (_actsList, micros) => ({
      scripts: micros.flatMap((m) => m),
    }),
  },
});

/* ───────────── Step 入口 ───────────── */

export async function dialogueScript(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  await runUniversalAgent(
    {
      stepId: "dialogue_script",
      name: "DialogueScriptAgent",
      outputField: "dialogue_script",
      capabilities: [dialogueScriptCapability],
      aggregate: (results) => (results[0]?.output as DialogueScriptOutput) ?? { scripts: [] },
      emptyFallback: () => ({ scripts: [] }),
      evaluator: { disabled: true },
    },
    ctx,
    llm,
  );

  // 覆盖率质量门（report-only）：对齐 branch_tree —— 缺脚本的节点 + 指向未知节点的
  // leads_to。choices.leads_to 悬空是运行时硬伤；缺脚本作信息项（部分纯过场节点可不写）。
  const out = ctx.dialogue_script as DialogueScriptOutput | undefined;
  if (out?.scripts?.length) {
    const { nodeIds, allTargets } = branchTreeRefIds(ctx);
    if (nodeIds.length > 0) {
      const crossRefs = out.scripts.flatMap((s) =>
        (s.choices ?? []).map((c) => ({ from: s.node_id, to: c.leads_to })),
      );
      const report = validateCoverage({
        referenceIds: nodeIds,
        producedIds: out.scripts.map((s) => s.node_id),
        crossRefs,
        validRefTargets: allTargets,
      });
      (out as unknown as Record<string, unknown>).__coverage_qa = {
        missing: report.missing,
        danglingRefs: report.danglingRefs,
      };
      if (report.danglingRefs.length > 0 || report.missing.length > 0) {
        console.warn(
          `[coverage-qa:dialogue_script] 缺脚本节点 ${report.missing.length}，悬空 leads_to ${report.danglingRefs.length}`,
        );
      }
    }
  }
}
