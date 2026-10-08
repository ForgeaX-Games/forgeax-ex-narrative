/**
 * G-02：剧本创作（description + dialogue + 互动元件双轨）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/08_剧本创作.md 对齐。
 *
 * 输入：ctx.vn_branched_beats + ctx.vn_character_bios
 * 输出：ctx.vn_screenplay = { beats: [{ beat_id, description, dialogue, options?, branch_qte? }] }
 *
 * 核心规则：
 *   - description：▲ 视觉动作（画面描写），不写镜头语言（那是 G-03 的事）
 *   - dialogue：每行 kind ∈ {dialogue, inner_monologue, narration, sfx}
 *   - 分支判定（options 与 branch_qte 互斥，由 G-01 已经决定 pivot_kind）：
 *     * pivot_kind="choice"      ⟹ options 字段必填，沿用 G-01 的 next_nodes 标签
 *     * pivot_kind="branch_qte"  ⟹ branch_qte 字段必填
 *   - 演出型 QTE（performance）已全局停用：只保留影响剧情的决策型互动
 *
 * 工程实现（设计 §8.2）：按**线性依赖段**分块 LLM 调用（decomposeSegments/runBySegments，
 * 按 beat 的 prev/next 拓扑切段，**非按场**——场已解耦为拍摄分组，见 §4.6c），
 * 支持流式 emit，避免长剧本上下文超限。beat_id 为 G-01 导出后的 `场.序`。
 */
import type {
  NarrativeContext,
  VnScreenplay,
  VnBeatScreenplay,
  VnBranchedBeat,
} from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../../runtime/prompt-composer.js";
import { getStreamEmit, ORIGINALITY_NOTE, runBySegments } from "./_shared.js";
import { computeWorldSnapshot, renderWorldSnapshot } from "../../graph/state-ledger.js";
import { vnBeatsToLedgerNodes } from "./vn-state-ledger.js";

/** 段级并行度：互不依赖的线性段同时跑，段内仍按子批串行保连贯 */
const SEGMENT_CONCURRENCY = 4;
/** 单次 LLM 调用的 beat 上限；超过则把段切成多个子批串行生成（防上下文超限） */
const MAX_BEATS_PER_CALL = 10;

export const VN_SCREENPLAY_COMPOSER: PromptComposer = {
  stepId: "vn_screenplay",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "ip_dna", "output_format"],
  userBlockOrder: [],
  blocks: {
    role: `你是互动影游剧本主笔。把"剧情树情节点"逐一改写为可拍摄、可演奏的剧本片段。`,

    ip_dna: IP_DNA_SLOT_BLOCK,

    task: `## 任务
- 为 vn_branched_beats.beats 中的每一个 beat 编写剧本片段
- 不创作新的剧情走向（剧情结构由 G-01 决定）；只把 beat.content 落地为可执行剧本
- 每个 beat 含三类要素：description（视觉动作）+ dialogue（对白序列）+ 互动元件（双轨）

## description 字段规范
- 以 ▲ 起句标识"画面动作"，但 ▲ 仅作为风格惯例，本字段是纯文本无需 markdown
- 写"看得见的事"：人物动作 / 环境变化 / 道具呈现 / 表情身体语言
- 严禁出现镜头语言（远景/特写/推拉摇移），那是 G-03 的产出
- 长度 60-200 字

## dialogue 字段规范
每行 dialogue 必须有 kind：
- "dialogue"          普通对白（speaker 必填）
- "inner_monologue"   主角内心独白（speaker = 主角名）
- "narration"         旁白（speaker 留空或填 "旁白"）
- "sfx"               音效描述（speaker 留空，text 写音效内容如 "风声越来越大"）

## 互动元件（只保留决策型，影响剧情——统一走 options）
- **所有 pivot 统一必填 options[]**，每项含 label(A/B/C/D) / text / leads_to_beat / 可选 cost / persona_alignment
- pivot_kind="choice"      ⟹ options 2-4 项
- pivot_kind="branch_qte"  ⟹ options 恰好 2 项（A=成功结果 / B=失败结果），额外可选 branch_qte 元数据（visual_action / duration_ms，仅作未来 QTE 机制预留，当前不影响交互）
- **非 pivot 节点严禁生成 options 或 branch_qte**：如果输入 beat 的 pivot_kind 为空/null，就只输出 description + dialogue，绝对不要自作主张添加选项。"风味选择"（选项不影响走向，leads_to_beat 相同）也不允许——它会在前端误导玩家以为有剧情分支。

${ORIGINALITY_NOTE}`,

    output_format: `## 输出格式（严格 JSON）
{
  "beats": [
    {
      "beat_id": "1.1", "scene_id": "1",
      "description": "▲ ...",
      "dialogue": [
        { "kind": "narration", "text": "..." },
        { "kind": "dialogue", "speaker": "李明", "emotion": "焦虑", "text": "..." },
        { "kind": "inner_monologue", "speaker": "李明", "text": "..." }
      ]
    },
    {
      "beat_id": "2.3", "scene_id": "2",
      "description": "▲ ...",
      "dialogue": [ ... ],
      "options": [
        { "label": "A", "text": "和解",  "leads_to_beat": "2.4", "cost": "失去尊严", "persona_alignment": "理性侧" },
        { "label": "B", "text": "决斗",  "leads_to_beat": "5.1", "cost": "可能死亡" }
      ]
    },
    {
      "beat_id": "3.4", "scene_id": "3",
      "description": "▲ ...",
      "dialogue": [ ... ],
      "pivot_kind": "branch_qte",
      "options": [
        { "label": "A", "text": "精准闪避，反手制住对手", "leads_to_beat": "3.5" },
        { "label": "B", "text": "反应迟缓，被一刀贯穿", "leads_to_beat": "END_B1", "cost": "致命一击" }
      ],
      "branch_qte": { "visual_action": "在刀锋逼近的瞬间，看准时机侧身闪避", "duration_ms": 2000 }
    }
  ]
}`,
  },
};

/**
 * 渲染本批 beats 触及的场（distinct scene_id）的三维状态元信息。
 * 一个线性段可能跨场推进，故按 beat 涉及的场集合而非"单场"展示。
 */
function renderSceneMetas(ctx: NarrativeContext, batch: VnBranchedBeat[]): string {
  const tree = ctx.vn_branched_beats!;
  const sceneIds = [...new Set(batch.map((b) => b.scene_id))];
  return sceneIds
    .map((sid) => {
      const s = tree.scenes.find((sc) => sc.scene_id === sid);
      return s
        ? `场 ${s.scene_id}（第${s.act_id}幕，${s.location_name}/${s.time_of_day}/${s.indoor_outdoor}）\n${s.content}`
        : `场 ${sid}（元信息缺失）`;
    })
    .join("\n\n");
}

/**
 * 把"上文剧本"（跨段前驱 leadIn + 同段更早批 prior）渲染成续接参考块（仅摘要，避免膨胀）。
 */
function renderContinuityBlock(leadIn: VnBeatScreenplay[], prior: VnBeatScreenplay[]): string {
  const merged = [...leadIn, ...prior];
  if (merged.length === 0) return "";
  const refs = merged.slice(-4).map((b) => ({
    beat_id: b.beat_id,
    description: b.description,
    last_lines: (b.dialogue ?? []).slice(-2),
  }));
  return `\n## 参考：上文剧本（前驱链 / 本段上文；保持语气·情绪·信息连贯，勿重复输出这些 beat）
${JSON.stringify(refs, null, 2)}\n`;
}

/**
 * 渲染从故事开头到当前 batch 之前的"角色演进时间线"——极简标注关键转折。
 * 目的：让 LLM 知晓角色外貌/修为/关系等已经发生了哪些变化，防止"吃书"。
 * @deprecated 被 renderWorldSnapshotBlock 替代（当 world_state_ledger 可用时）
 */
function renderCharacterTimeline(ctx: NarrativeContext, batch: VnBranchedBeat[]): string {
  const tree = ctx.vn_branched_beats!;
  const batchIds = new Set(batch.map((b) => b.beat_id));
  const batchFirstIdx = tree.beats.findIndex((b) => batchIds.has(b.beat_id));
  if (batchFirstIdx <= 0) return "";
  const preceding = tree.beats.slice(0, batchFirstIdx);
  if (preceding.length === 0) return "";
  const timeline = preceding.map((b) => `[${b.beat_id}] ${(b.content ?? "").slice(0, 60)}`).join("\n");
  return `\n## 参考：前情时间线（角色已经经历的事——注意其中涉及外貌/修为/关系/状态的变化，后续描写必须与之一致，不要"吃书"）
${timeline}\n`;
}

/**
 * 利用世界状态账本计算精确快照，替代粗糙的 renderCharacterTimeline。
 * 当 world_state_ledger 存在时使用精确快照；否则降级回旧逻辑。
 */
function renderWorldSnapshotBlock(ctx: NarrativeContext, batch: VnBranchedBeat[]): string {
  if (ctx.world_state_ledger && batch.length > 0) {
    const beats = ctx.vn_branched_beats?.beats ?? [];
    const snapshot = computeWorldSnapshot(
      ctx.world_state_ledger,
      batch[0].beat_id,
      vnBeatsToLedgerNodes(beats),
    );
    return "\n" + renderWorldSnapshot(snapshot) + "\n";
  }
  return renderCharacterTimeline(ctx, batch);
}

/**
 * 构造**单批**的 user prompt（批 = 同一线性段内连续 ≤10 个 beat）。
 *
 * - 主输入：本批 beats（来自 G-01，已含 pivot_kind / next_nodes / branch_type）
 * - 续接：跨段前驱产出（leadIn）+ 同段上文（prior）→ 保证链上语气/情绪/信息连贯
 * - 参考：本批触及场的三维状态 + 全量人物小传 + logline；不传整棵树，避免上下文超限
 */
function buildBatchUserPrompt(
  ctx: NarrativeContext,
  batch: VnBranchedBeat[],
  leadIn: VnBeatScreenplay[],
  prior: VnBeatScreenplay[],
): string {
  const logline = ctx.vn_logline
    ? `「${ctx.vn_logline.title}」${ctx.vn_logline.content}`
    : "（无）";

  return `## 必需：本批情节点（主输入，同一叙事线连续，按 beat_id 顺序）
${JSON.stringify(batch, null, 2)}

## 本批触及场的元信息（三维状态 / 主线-支线 / 所属幕）
${renderSceneMetas(ctx, batch)}
${renderContinuityBlock(leadIn, prior)}${renderWorldSnapshotBlock(ctx, batch)}
## 必需：人物小传（决定 dialogue.speaker 的语气 / 词汇 / 情绪基调；voice/visual 尤为重要）
${JSON.stringify(ctx.vn_character_bios ?? { characters: [] }, null, 2)}

## 参考：关键道具（道具登场的 beat，description 须让其外形/质感可被镜头看见）
${JSON.stringify(ctx.vn_key_items ?? { items: [] }, null, 2)}

## 参考：一句话梗概（剧本对白的总命题不可漂移）
${logline}

## 参考：用户原始需求
${ctx.user_input}

## 任务
为本批每个 beat 编写 description + dialogue，并按 G-01 决定的 pivot_kind 落实 options（所有分支统一走 options）。
- pivot_kind="choice" → options 2-4 项（label A/B/C/D + text + leads_to_beat）
- pivot_kind="branch_qte" → options 恰好 2 项（A=成功结果 / B=失败结果），可选追加 branch_qte 元数据
- pivot_kind 为空/null → 普通推进节点，只输出 description + dialogue，**严禁添加 options**
仅输出本批范围内的 beats（不要返回其他 beat_id）。`;
}

/**
 * 降级占位剧本：某场/子批 LLM 失败后，为其 beats 生成最小可用剧本，
 * 保证剧情树拓扑不断链（选项 / QTE 分支从 G-01 的 next_nodes 还原，玩法仍可走通）。
 */
function placeholderScreenplay(b: VnBranchedBeat): VnBeatScreenplay {
  const sp: VnBeatScreenplay = {
    beat_id: b.beat_id,
    scene_id: b.scene_id,
    description: `▲（本节点剧本自动生成失败，已降级保留拓扑）${(b.content ?? "").slice(0, 80)}`,
    dialogue: [{ kind: "narration", text: (b.content ?? "（内容缺失）").slice(0, 160) }],
  };
  if (b.pivot_kind === "choice") {
    const labels: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
    const choiceEdges = (b.next_nodes ?? []).filter((e) => e.kind === "choice");
    if (choiceEdges.length >= 2) {
      sp.options = choiceEdges.slice(0, 4).map((e, i) => ({
        label: (["A", "B", "C", "D"].includes(String(e.label)) ? e.label : labels[i]) as "A" | "B" | "C" | "D",
        text: e.label ?? `选项${labels[i]}`,
        leads_to_beat: e.to,
      }));
    }
  } else if (b.pivot_kind === "branch_qte") {
    const qteEdges = (b.next_nodes ?? []).filter((e) => e.kind === "branch_qte");
    if (qteEdges.length >= 1) {
      const labels: Array<"A" | "B"> = ["A", "B"];
      sp.options = qteEdges.slice(0, 2).map((e, i) => ({
        label: labels[i] as "A" | "B",
        text: e.condition ?? (i === 0 ? "成功" : "失败"),
        leads_to_beat: e.to,
      }));
      sp.branch_qte = {
        visual_action: "（降级占位）完成动作判定",
        duration_ms: 3000,
      };
    }
  }
  return sp;
}

/**
 * 校验单批剧本输出。
 * - 与 G-01 中本批 beats 一一对应（不能多/不能少）
 * - description / dialogue 等字段格式
 * - pivot 一致性：非 pivot 节点不允许有 options/branch_qte；pivot 节点必须有对应结构
 */
function validateScene(
  parsed: VnScreenplay,
  expectedBeatIds: Set<string>,
  g01Beats?: VnBranchedBeat[],
): void {
  if (!Array.isArray(parsed.beats) || parsed.beats.length === 0) {
    throw new Error("本场 beats 不能为空");
  }
  const screenIds = new Set(parsed.beats.map((b) => b.beat_id));
  expectedBeatIds.forEach((id) => {
    if (!screenIds.has(id)) {
      throw new Error(`screenplay 缺少 beat：${id}（本场 G-01 中存在但本步未输出）`);
    }
  });
  parsed.beats.forEach((b) => {
    if (!expectedBeatIds.has(b.beat_id)) {
      throw new Error(`screenplay 出现非本场 beat：${b.beat_id}`);
    }
  });

  const pivotMap = new Map<string, VnBranchedBeat>();
  if (g01Beats) {
    for (const gb of g01Beats) pivotMap.set(gb.beat_id, gb);
  }

  parsed.beats.forEach((b: VnBeatScreenplay) => {
    if (!b.description?.trim()) throw new Error(`beat ${b.beat_id}.description 不能为空`);
    if (!Array.isArray(b.dialogue) || b.dialogue.length === 0) {
      throw new Error(`beat ${b.beat_id}.dialogue 不能为空`);
    }
    b.dialogue.forEach((line, i) => {
      if (!["dialogue", "inner_monologue", "narration", "sfx"].includes(line.kind)) {
        throw new Error(`beat ${b.beat_id}.dialogue[${i}].kind 非法：${line.kind}`);
      }
      if (!line.text?.trim()) throw new Error(`beat ${b.beat_id}.dialogue[${i}].text 不能为空`);
    });
    if (b.options && b.branch_qte && !pivotMap.get(b.beat_id)?.pivot_kind) {
      throw new Error(`beat ${b.beat_id} 非 pivot 却同时有 options 和 branch_qte`);
    }

    const g01 = pivotMap.get(b.beat_id);
    if (g01) {
      if (!g01.pivot_kind) {
        if (b.options) {
          throw new Error(
            `beat ${b.beat_id} 在 G-01 中非 pivot（pivot_kind=null），不允许生成 options。请移除 options 字段。`,
          );
        }
        if (b.branch_qte) {
          throw new Error(
            `beat ${b.beat_id} 在 G-01 中非 pivot（pivot_kind=null），不允许生成 branch_qte。请移除 branch_qte 字段。`,
          );
        }
      } else {
        if (!b.options || b.options.length < 2) {
          throw new Error(
            `beat ${b.beat_id} 在 G-01 中为 ${g01.pivot_kind} pivot，必须有 ≥2 个 options（所有 pivot 统一走 options 提供分支选项）。`,
          );
        }
        if (g01.pivot_kind === "branch_qte" && b.options.length !== 2) {
          throw new Error(
            `beat ${b.beat_id} 为 branch_qte pivot，options 必须恰好 2 项（A=成功 / B=失败）。`,
          );
        }
      }
    }

    if (b.options) {
      if (b.options.length < 2 || b.options.length > 4) {
        throw new Error(`beat ${b.beat_id}.options 数量必须在 2-4 之间`);
      }
      b.options.forEach((o) => {
        if (!["A", "B", "C", "D"].includes(o.label)) {
          throw new Error(`beat ${b.beat_id}.options.label 必须为 A/B/C/D`);
        }
      });
      const targets = new Set(b.options.map((o) => o.leads_to_beat));
      if (targets.size < 2 && b.options.length >= 2) {
        throw new Error(
          `beat ${b.beat_id}.options 所有选项指向同一目标 ${[...targets][0]}，这不是有效分支。若为风味选项请移除 options。`,
        );
      }
    }
  });
}

/**
 * 按**线性段**的 G-02 剧本创作（分支并行 + 单线串行 + 段内 6~10 批 + 失败降级）。
 *
 * 切分轴是**依赖关系**而非"场"（对齐 RPG topologicalWaves 的"分支并行 + 单线串行"）：
 *  1. decomposeSegments 把 G-01 剧情树切成线性段（一串单入单出的连续 beat）
 *  2. 互不依赖的段同波并行（concurrency=4）；有依赖的段按拓扑波次串行
 *  3. 段内连续 beat 同批生成（续接最佳），超 MAX 切子批串行；
 *     跨段续接：段头的前驱产出作 leadIn 喂入该段首批
 *  4. 单批失败不致命：占位剧本降级保拓扑不断链，告警汇总到 vn_screenplay.warnings
 *  5. 产物按 G-01 beats 原始顺序装配，前端/下游顺序稳定
 */
export async function vnScreenplay(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  if (!ctx.vn_branched_beats) {
    throw new Error("vn_screenplay 需要 ctx.vn_branched_beats（G-01 未完成）");
  }
  const streamEmit = getStreamEmit(ctx);
  const tree = ctx.vn_branched_beats;
  const warnings: string[] = [];

  const allBeats = await runBySegments<VnBeatScreenplay>({
    beats: tree.beats,
    maxBeatsPerCall: MAX_BEATS_PER_CALL,
    concurrency: SEGMENT_CONCURRENCY,
    idOf: (b) => b.beat_id,
    placeholder: placeholderScreenplay,
    onWarn: (msg) => { warnings.push(`G-02 ${msg}`); console.error(`[vnScreenplay] ${msg}`); },
    onProgress: (done, total) => {
      if (streamEmit) streamEmit(`\n[G-02] 剧本创作进度（${done}/${total} beat）\n`, "");
    },
    runBatch: async (batch, leadIn, prior) => {
      const expectedBeatIds = new Set(batch.map((b) => b.beat_id));
      const raw = await llm.callWithRetry(
        composeSystemPrompt(VN_SCREENPLAY_COMPOSER, ctx),
        appendUserInstructions(buildBatchUserPrompt(ctx, batch, leadIn, prior), ctx),
        { temperature: 0.7, responseFormat: "json" },
        (r) => validateScene(extractJSON<VnScreenplay>(r), expectedBeatIds, batch),
        streamEmit,
      );
      return extractJSON<VnScreenplay>(raw).beats;
    },
  });

  ctx.vn_screenplay = warnings.length > 0 ? { beats: allBeats, warnings } : { beats: allBeats };
}
