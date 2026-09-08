/**
 * cinematic-storyboard.ts (Stage C 重构版)
 * ─────────────────────────────────────────────────────────────────
 * 互动影游电影级分镜：基于 branch_tree 节点 + dialogue_script 节奏，
 * 为关键节点输出可拍摄/可渲染的镜头要素（含 QTE 字段）。
 *
 * 工作模式（由 createAdaptiveCapability 自动路由）：
 *   - 短剧（target_acts <= 1）：单次 LLM 输出全部节点的分镜
 *   - 长剧（target_acts >= 2 且 branch_tree.acts 存在）：consumer 模式
 *       · 从 ctx.branch_tree.acts 读取幕骨架
 *       · 每幕一次 LLM 输出该幕节点的分镜（依赖该幕已生成的 dialogue_script 节奏对齐 QTE）
 *       · 合并后由 assembleVideoPrompts 拍平为可送 SD/Veo/Sora 的双语 prompt
 *
 * 默认仅在互动影游 skill 显式 enableSteps: ["cinematic_storyboard"] 时启用。
 *
 * C2（2026-08）已封存：随 tpl-vn 一并搬进 `_archive/vn-v1/`，不再被任何活跃代码
 * import。业务功能吸收进 storyboard 席（script_generation），详见本目录 README。
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
import { assembleVideoPrompts } from "./video-prompt-assembly.js";
import { validateCoverage } from "../../../utils/graph-qa.js";
import { branchTreeRefIds } from "./branch-tree.js";

/**
 * QTE schema 与下游 kino-studio QTECue 对齐（packages/kino-studio src/scenario/types.ts）。
 * 已有字段保留语义（向后兼容老 entry）；新增字段直接喂给 Scene.qte.cues[]。
 */
type QTEShape = "tap" | "hold" | "sweep";
type SweepDir = "up" | "down" | "left" | "right";

interface QTEDef {
  // ─ 叙事字段（向后兼容）─
  trigger: string;            // 触发条件描述
  window_ms: number;          // 容错时间窗口
  fail_penalty: string;       // 失败惩罚描述
  // ─ kino UI 直接消费字段（新增，可选；缺失时由 normalize fallback）─
  shape?: QTEShape;           // tap=快点、hold=持续按、sweep=滑动方向
  x?: number;                 // 0-1 屏幕归一化 x
  y?: number;                 // 0-1 屏幕归一化 y
  appear_ms?: number;         // 提示出现时刻（相对镜头起点 ms）
  target_ms?: number;         // 命中目标时刻（ms）
  duration_ms?: number;       // shape='hold' 时玩家需保持按住的时长
  sweep_dir?: SweepDir;       // shape='sweep' 时滑动方向
  label?: string;             // 显示给玩家的指令文字（如 "敲" / "AVOID!"）
}

interface BilingualPrompt {
  zh?: string;
  en?: string;
}

interface ShotDef {
  shot_id: string;
  framing: string;
  angle: string;
  movement: string;
  lighting: string;
  actor_action: string;
  vfx?: string;
  duration_sec: number;
  qte?: QTEDef;
  /** 镜头级视觉提示词（LLM 可主动产出；缺失时由 normalize 从 framing/angle/lighting 等合成） */
  visual_prompt?: BilingualPrompt;
}

interface StoryboardEntry {
  node_id: string;
  shots: ShotDef[];
  transition_in?: string;
  transition_out?: string;
  pacing?: string;
  /** 场景级综合视觉提示词（→ kino Scene.prompts.scene） */
  scene_prompt?: BilingualPrompt;
}

interface CinematicStoryboardOutput {
  storyboards: StoryboardEntry[];
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

const ROLE = `你是电影级互动影游分镜师。基于剧情节点，为关键节点输出可拍摄的分镜要素。`;

const TASK = `## 任务
- 为 branch_tree 中的关键节点（高潮、QTE、决策点）输出 3-8 个镜头
- 镜头之间体现节奏对比（紧张-松弛-紧张）
- QTE 节点必须给出"可执行"的 QTE 字段（不只是叙事）：
  * shape: tap=快点一下 / hold=持续按住 / sweep=滑动方向
  * x, y: 0-1 屏幕归一化坐标（屏幕中心=0.5,0.5）
  * appear_ms / target_ms: 镜头内的相对毫秒；target_ms 是玩家应该按下的时刻
  * label: 给玩家看的中文指令（如 "敲!"、"按住"、"向上滑"）
  * hold 必给 duration_ms；sweep 必给 sweep_dir
- 每个镜头给出 visual_prompt.zh/en（一两句画面描述，直接喂 SD/Veo/Sora）
- 每个 storyboard entry 还要给 scene_prompt.zh/en（整场综合画面描述）
- 对话场景给出过肩镜头与特写交替`;

const STYLE_PLACEHOLDER = `## 品类风格 / 视觉调性
{{SKILL.style_guide}}`;
const SHOT_LANGUAGE_PLACEHOLDER = `## 镜头语言守则
{{SKILL.shot_language}}`;
const QTE_RULES_PLACEHOLDER = `## QTE 设计要求
{{SKILL.qte_rules}}`;
const CONSTRAINTS_PLACEHOLDER = `## 硬性约束
{{SKILL.constraints}}`;

const OUTPUT_FORMAT = `## 输出格式（严格 JSON）
{
  "storyboards": [
    {
      "node_id": "branch_tree 节点ID",
      "shots": [
        {
          "shot_id": "S1",
          "framing": "extreme_wide|wide|medium|close|extreme_close|over_shoulder",
          "angle": "eye_level|low|high|dutch|aerial|pov",
          "movement": "static|pan|tilt|tracking|dolly|crane|handheld",
          "lighting": "光影描述（如：黄昏侧光，冷色调阴影）",
          "actor_action": "演员动作（如：主角缓慢转身，眼神惊愕）",
          "vfx": "特效/CG 元素（可选）",
          "duration_sec": 4,
          "qte": {
            "trigger": "QTE 触发条件叙事描述",
            "window_ms": 800,
            "fail_penalty": "失败惩罚",
            "shape": "tap",
            "x": 0.5, "y": 0.55,
            "appear_ms": 2800, "target_ms": 3600,
            "label": "敲!"
          },
          "visual_prompt": {
            "zh": "中景过肩，黄昏侧光打在角色脸上，瞳孔微缩，冷色阴影",
            "en": "medium over-the-shoulder, warm dusk side-light on face, slight pupil contraction, cool shadows"
          }
        }
      ],
      "transition_in": "前接转场（cut|fade|dissolve|whip|match_cut）",
      "transition_out": "后接转场",
      "pacing": "tense|relaxed|climactic|reflective",
      "scene_prompt": {
        "zh": "场景综合画面描述（融合所有镜头的氛围、关键道具、光影）",
        "en": "scene-level visual prompt (atmosphere, key props, lighting)"
      }
    }
  ]
}

## QTE 字段填写指南（重要）
- shape='tap'  → 玩家点击；duration_ms 不填、sweep_dir 不填
- shape='hold' → 玩家长按；必填 duration_ms（玩家需按住的毫秒数）
- shape='sweep'→ 玩家滑动；必填 sweep_dir
- appear_ms / target_ms 是镜头内的相对时间，必须满足 0 ≤ appear_ms < target_ms
  推荐：appear_ms = target_ms - window_ms（让提示在容错窗口前缘出现）
- 一个镜头最多 1 个 qte；非 QTE 镜头不要写 qte 字段`;

const USER_CONTEXT = (ctx: NarrativeContext): string => {
  const tree = (ctx as Record<string, unknown>).branch_tree;
  const dialogue = (ctx as Record<string, unknown>).dialogue_script;
  const treeStr = tree ? JSON.stringify(tree, null, 2) : "（无分支树）";
  const dialogueStr = dialogue ? JSON.stringify(dialogue, null, 2) : "（无对话脚本）";
  return `## 分支树（完整）\n${treeStr}\n\n## 对话脚本（完整，用于决定镜头节奏与 QTE 触发点）\n${dialogueStr}\n\n## 用户原始需求\n${ctx.user_input}\n\n请为分支树中的每个关键节点（高潮、QTE、决策点、结局）编写电影级分镜。`;
};

const CINEMATIC_STORYBOARD_COMPOSER: PromptComposer = {
  stepId: "cinematic_storyboard",
  blocks: {
    role: ROLE,
    task: TASK,
    style: STYLE_PLACEHOLDER,
    shot_language: SHOT_LANGUAGE_PLACEHOLDER,
    qte_rules: QTE_RULES_PLACEHOLDER,
    constraints: CONSTRAINTS_PLACEHOLDER,
    output_format: OUTPUT_FORMAT,
    user_context: USER_CONTEXT,
  },
  systemBlockOrder: ["role", "task", "style", "shot_language", "qte_rules", "constraints", "output_format"],
  userBlockOrder: ["user_context"],
  skillSlots: ["style_guide", "shot_language", "qte_rules", "constraints"],
};

/* ───────────── 长剧 prompt builders ───────────── */

function buildPerActSystemPrompt(
  styleGuide: string | undefined,
  shotLanguage: string | undefined,
  qteRules: string | undefined,
): string {
  return `你是电影级互动影游分镜师。为单幕的关键节点输出可拍摄/可渲染的分镜要素。

## 任务
- 仅为给定 act_id 的关键节点（高潮/QTE/决策点/结局）输出 3-8 个镜头
- 镜头之间体现节奏对比（紧张-松弛-紧张）
- QTE 节点必须给出"可执行"的 QTE 字段（不只是叙事描述）：
  * shape: tap=快点一下 / hold=持续按住 / sweep=滑动方向
  * x, y: 0-1 屏幕归一化坐标
  * appear_ms / target_ms: 镜头内相对毫秒；target_ms = 玩家应按下时刻
  * label: 玩家看到的中文指令文字
  * hold 必给 duration_ms；sweep 必给 sweep_dir
- 每镜头给 visual_prompt.zh/en；每场景给 scene_prompt.zh/en（直接送 SD/Veo/Sora）
- 每场景 shots[].duration_sec 总和在 15-30 秒之间
- 同一场景 QTE 不超过 3 次

## 风格指南
${styleGuide ?? "（无）"}

## 镜头语言守则
${shotLanguage ?? "（无）"}

## QTE 设计要求
${qteRules ?? "（无）"}

## 输出格式（严格 JSON）
{
  "storyboards": [
    {
      "node_id": "A1_N03",
      "shots": [
        {
          "shot_id": "S1",
          "framing": "extreme_wide|wide|medium|close|extreme_close|over_shoulder",
          "angle": "eye_level|low|high|dutch|aerial|pov",
          "movement": "static|pan|tilt|tracking|dolly|crane|handheld",
          "lighting": "光影描述（黄昏侧光，冷色调阴影 等）",
          "actor_action": "演员动作（主角缓慢转身，眼神惊愕 等）",
          "vfx": "特效/CG 元素（可选）",
          "duration_sec": 4,
          "qte": {
            "trigger": "QTE 触发条件",
            "window_ms": 800,
            "fail_penalty": "失败惩罚",
            "shape": "tap",
            "x": 0.5, "y": 0.55,
            "appear_ms": 2800, "target_ms": 3600,
            "label": "敲!"
          },
          "visual_prompt": {
            "zh": "镜头画面中文描述",
            "en": "shot visual prompt"
          }
        }
      ],
      "transition_in": "cut|fade|dissolve|whip|match_cut",
      "transition_out": "cut|fade|...",
      "pacing": "tense|relaxed|climactic|reflective",
      "scene_prompt": {
        "zh": "场景综合画面描述",
        "en": "scene-level visual prompt"
      }
    }
  ]
}

## QTE 填写指南
- shape='hold' 必填 duration_ms（按住毫秒数）
- shape='sweep' 必填 sweep_dir
- 0 ≤ appear_ms < target_ms；推荐 appear_ms = target_ms - window_ms
- 一个镜头最多 1 个 qte；非 QTE 镜头不要写 qte 字段`;
}

function buildPerActUserPrompt(
  act: ActPlan,
  actNodes: BranchNode[],
  actDialogues: unknown[],
  ctx: NarrativeContext,
): string {
  return `## 当前幕信息
${JSON.stringify(act, null, 2)}

## 当前幕的节点
${JSON.stringify(actNodes, null, 2)}

## 当前幕的对话脚本（用于决定镜头节奏与 QTE 触发点）
${actDialogues.length > 0 ? JSON.stringify(actDialogues, null, 2) : "（尚未生成）"}

## 用户原始需求
${ctx.user_input}

请为以上节点编写电影级分镜，重点关注高潮节点与 QTE 节点；shots[].duration_sec 总和与场景时长（${(act as { duration_minutes?: number }).duration_minutes ?? "不限"} 分钟）匹配。`;
}

/* ───────────── Normalize：QTE 时序 + 双语 prompt 兜底 ───────────── */

const FRAMING_ZH: Record<string, string> = {
  extreme_wide: "大全景", wide: "全景", medium: "中景",
  close: "特写", extreme_close: "大特写", over_shoulder: "过肩镜头",
};
const FRAMING_EN: Record<string, string> = {
  extreme_wide: "extreme wide shot", wide: "wide shot", medium: "medium shot",
  close: "close-up", extreme_close: "extreme close-up", over_shoulder: "over-the-shoulder shot",
};
const ANGLE_ZH: Record<string, string> = {
  eye_level: "平视", low: "仰拍", high: "俯拍",
  dutch: "斜角", aerial: "鸟瞰", pov: "主观视角",
};
const ANGLE_EN: Record<string, string> = {
  eye_level: "eye-level", low: "low-angle", high: "high-angle",
  dutch: "Dutch angle", aerial: "aerial view", pov: "POV",
};

function buildShotVisualPromptZh(shot: ShotDef): string {
  const parts: string[] = [];
  if (shot.framing) parts.push(FRAMING_ZH[shot.framing] ?? shot.framing);
  if (shot.angle) parts.push(ANGLE_ZH[shot.angle] ?? shot.angle);
  if (shot.actor_action) parts.push(shot.actor_action);
  if (shot.lighting) parts.push(shot.lighting);
  if (shot.vfx) parts.push(shot.vfx);
  parts.push("电影质感");
  return parts.filter(Boolean).join("，");
}

function buildShotVisualPromptEn(shot: ShotDef): string {
  const parts: string[] = [];
  if (shot.framing) parts.push(FRAMING_EN[shot.framing] ?? shot.framing);
  if (shot.angle) parts.push(ANGLE_EN[shot.angle] ?? shot.angle);
  if (shot.actor_action) parts.push(`of ${shot.actor_action}`);
  if (shot.lighting) parts.push(shot.lighting);
  if (shot.vfx) parts.push(shot.vfx);
  parts.push("cinematic", "8k");
  return parts.filter(Boolean).join(", ");
}

/**
 * 给一个 storyboard entry 兜底：
 *   1. shot.qte 缺新字段时填默认 + 由 duration_sec 累计推 target_ms
 *   2. shot.visual_prompt 缺时由 framing/angle/lighting 合成
 *   3. entry.scene_prompt 缺时由所有 shots 的 visual_prompt 合并
 *
 * 全部为 add-only fallback，不覆盖 LLM 已经主动填的字段。
 */
function normalizeStoryboardEntry(entry: StoryboardEntry): StoryboardEntry {
  if (!Array.isArray(entry.shots)) return entry;

  let cursorMs = 0; // 当前镜头在场景内的起点（ms）
  for (const shot of entry.shots) {
    const dur = typeof shot.duration_sec === "number" && shot.duration_sec > 0 ? shot.duration_sec : 4;
    const shotEndMs = cursorMs + dur * 1000;

    if (shot.qte) {
      const q = shot.qte;
      if (typeof q.window_ms !== "number" || q.window_ms <= 0) q.window_ms = 800;
      if (!q.shape) q.shape = "tap";
      if (typeof q.x !== "number") q.x = 0.5;
      if (typeof q.y !== "number") q.y = 0.55;
      if (typeof q.target_ms !== "number") {
        // 默认放在镜头中后段（避开过早 / 过晚）
        q.target_ms = Math.round(cursorMs + dur * 1000 * 0.7);
      }
      if (typeof q.appear_ms !== "number") {
        q.appear_ms = Math.max(cursorMs, q.target_ms - q.window_ms);
      }
      // 合法性兜底：0 ≤ appear < target ≤ shotEnd
      q.appear_ms = Math.max(cursorMs, Math.min(q.appear_ms, q.target_ms - 50));
      q.target_ms = Math.min(q.target_ms, shotEndMs);
      if (q.shape === "hold" && typeof q.duration_ms !== "number") {
        q.duration_ms = Math.min(1200, Math.max(400, q.window_ms * 1.5));
      }
      if (q.shape === "sweep" && !q.sweep_dir) {
        q.sweep_dir = "right";
      }
      if (!q.label) {
        q.label = q.shape === "hold" ? "按住" : q.shape === "sweep" ? "滑!" : "敲!";
      }
    }

    if (!shot.visual_prompt) shot.visual_prompt = {};
    if (!shot.visual_prompt.zh) shot.visual_prompt.zh = buildShotVisualPromptZh(shot);
    if (!shot.visual_prompt.en) shot.visual_prompt.en = buildShotVisualPromptEn(shot);

    cursorMs = shotEndMs;
  }

  if (!entry.scene_prompt) entry.scene_prompt = {};
  if (!entry.scene_prompt.zh) {
    entry.scene_prompt.zh = entry.shots
      .map((s) => s.visual_prompt?.zh)
      .filter(Boolean)
      .join("；");
  }
  if (!entry.scene_prompt.en) {
    entry.scene_prompt.en = entry.shots
      .map((s) => s.visual_prompt?.en)
      .filter(Boolean)
      .join("; ");
  }

  return entry;
}

function normalizeStoryboards(out: CinematicStoryboardOutput): CinematicStoryboardOutput {
  if (!Array.isArray(out?.storyboards)) return { storyboards: [] };
  return { storyboards: out.storyboards.map(normalizeStoryboardEntry) };
}

// 仅供测试导出（避免破坏稳定 API；线上代码请通过 capability 入口）
export const __internal = { normalizeStoryboards, normalizeStoryboardEntry };

/* ───────────── Capability：消费者模式 ───────────── */

interface BranchTreeWithActs {
  acts?: ActPlan[];
  nodes?: BranchNode[];
}

export const cinematicStoryboardCapability = createAdaptiveCapability<
  CinematicStoryboardOutput,
  StoryboardEntry[],
  BranchTreeWithActs
>({
  id: "cinematic_storyboard",
  description: "互动影游电影级分镜（短剧单次 / 长剧分幕自动切换）",
  needsKeys: ["D"],
  minNeed: 2,
  outputField: "cinematic_storyboard",

  preflight: (ctx) => {
    const tree = (ctx as Record<string, unknown>).branch_tree;
    if (!tree) return { skip: true, placeholder: { storyboards: [] } };
    return { skip: false };
  },

  // 短剧
  singleShot: {
    composer: CINEMATIC_STORYBOARD_COMPOSER,
    parse: (raw) => {
      const parsed = extractJSON<CinematicStoryboardOutput | { storyboards?: unknown[] }>(raw);
      if (parsed && Array.isArray((parsed as CinematicStoryboardOutput).storyboards)) {
        return normalizeStoryboards(parsed as CinematicStoryboardOutput);
      }
      return { storyboards: [] };
    },
    temperature: 0.7,
  },

  // 长剧（消费者模式）
  chunked: {
    enable: (ctx) => isLongFormMode((ctx as Record<string, unknown>).target_acts as number | undefined),

    actsPlan: {
      mode: "consume",
      source: (ctx) => {
        const tree = (ctx as Record<string, unknown>).branch_tree as BranchTreeWithActs | undefined;
        if (!tree?.acts || !tree?.nodes) return undefined;
        return tree;
      },
      emptyOnMissingActs: () => ({ storyboards: [] }),
    },

    extractActs: (tree) => tree.acts ?? [],

    perAct: {
      buildPrompt: (act, _idx, _total, ctx, tree) => {
        const skill = getStepSkill(resolveGenreCode(ctx), "cinematic_storyboard");
        const actNodes = (tree.nodes ?? []).filter((n) => n.act_id === act.act_id);
        // 收集该幕已生成的对话（按 node_id 索引）
        const dialogues =
          ((ctx as Record<string, unknown>).dialogue_script as
            | { scripts?: Array<{ node_id?: string }> }
            | undefined)?.scripts ?? [];
        const dialogueMap = new Map<string, unknown>(dialogues.map((s) => [s.node_id ?? "", s]));
        const actDialogues = actNodes
          .map((n) => dialogueMap.get(n.id))
          .filter((d): d is NonNullable<typeof d> => d != null);

        return {
          systemPrompt: buildPerActSystemPrompt(
            skill?.slots?.style_guide,
            skill?.slots?.shot_language,
            skill?.slots?.qte_rules,
          ),
          userPrompt: buildPerActUserPrompt(act, actNodes, actDialogues, ctx),
        };
      },
      parse: (raw): StoryboardEntry[] => {
        const parsed = extractJSON<{ storyboards?: StoryboardEntry[] }>(raw);
        if (!Array.isArray(parsed?.storyboards)) return [];
        return normalizeStoryboards({ storyboards: parsed.storyboards }).storyboards;
      },
      truncationLabel: (act) => `cinematic_storyboard.${act.act_id}`,
      temperature: 0.7,
      swallowError: true,
    },

    merge: (_actsList, micros) => ({
      storyboards: micros.flatMap((m) => m),
    }),
  },
});

/* ───────────── Step 入口 ───────────── */

export async function cinematicStoryboard(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  await runUniversalAgent(
    {
      stepId: "cinematic_storyboard",
      name: "CinematicStoryboardAgent",
      outputField: "cinematic_storyboard",
      capabilities: [cinematicStoryboardCapability],
      aggregate: (results) =>
        (results[0]?.output as CinematicStoryboardOutput) ?? { storyboards: [] },
      emptyFallback: () => ({ storyboards: [] }),
      evaluator: { disabled: true },
    },
    ctx,
    llm,
  );

  // 覆盖率质量门（report-only）：对齐 branch_tree —— 哪些节点缺分镜。
  const out = ctx.cinematic_storyboard as CinematicStoryboardOutput | undefined;
  if (out?.storyboards?.length) {
    const { nodeIds } = branchTreeRefIds(ctx);
    if (nodeIds.length > 0) {
      const report = validateCoverage({
        referenceIds: nodeIds,
        producedIds: out.storyboards.map((s) => s.node_id),
      });
      (out as unknown as Record<string, unknown>).__coverage_qa = { missing: report.missing };
      if (report.missing.length > 0) {
        console.warn(`[coverage-qa:cinematic_storyboard] 缺分镜节点 ${report.missing.length}`);
      }
    }
  }

  // Stage C - D 工作单：cinematic_storyboard 完成后立刻把 shots[] 拍平为 video/image prompts。
  // 纯函数，瞬时完成，不调 LLM；输出双语并列方便接 SD/Veo/Sora/Hunyuan/Kling。
  const sb = (ctx as Record<string, unknown>).cinematic_storyboard as unknown;
  (ctx as Record<string, unknown>).video_prompts = assembleVideoPrompts(
    sb as Parameters<typeof assembleVideoPrompts>[0],
  );
}
