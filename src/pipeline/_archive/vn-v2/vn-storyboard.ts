/**
 * G-03：分镜设计（中文景别 + 双轨 QTE 镜头 + 三硬规则）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/09_分镜设计.md 对齐。
 *
 * 输入：ctx.vn_screenplay + ctx.vn_branched_beats（含 G-01 末尾导出的派生 scenes / 场.序 beat_id）
 * 输出：ctx.vn_storyboard = { storyboards: [{ beat_id, shots: [...] }] }
 *
 * 核心规则：
 *   - 景别：中文 远/全/中/近/特（不允许 ELS/MS 等英文缩写）
 *   - 三硬规则：
 *     * 不允许跳切（相邻镜头景别跨度不超过 2 档）
 *     * 30 度规则：相邻同人物镜头需有 ≥30 度的角度变化或景别变化
 *     * 180 度轴线：同一对话 / 对峙不允许越轴
 *   - 决策 QTE 镜头处理（演出型 QTE 已停用）：
 *     * branch_qte_ref=true   长镜（>=3000ms）+ UI 蓄力提示 + 失败镜头跳到 fail beat
 *   - shot_id = "<beat_id>-<场内序号>"，例如 "1.1-1", "1.1-2"
 *   - 每镜 duration_sec 之和应贴近 dialogue 时间总长（容差 30%）
 */
import type {
  NarrativeContext,
  VnStoryboard,
  VnBeatStoryboard,
  VnBeatScreenplay,
  VnBranchedBeat,
  VnShot,
} from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../../runtime/prompt-composer.js";
import { getStreamEmit, runBySegments } from "./_shared.js";
import { computeWorldSnapshot } from "../../graph/state-ledger.js";
import { vnBeatsToLedgerNodes } from "./vn-state-ledger.js";

/** 段级并行度：互不依赖的线性段同时跑 */
const SEGMENT_CONCURRENCY = 4;
/** 单次 LLM 调用的 beat 上限；超过则把段切成多个子批串行生成（防上下文超限） */
const MAX_BEATS_PER_CALL = 8;

export const VN_STORYBOARD_COMPOSER: PromptComposer = {
  stepId: "vn_storyboard",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "ip_dna", "output_format"],
  userBlockOrder: [],
  blocks: {
    ip_dna: IP_DNA_SLOT_BLOCK,
    role: `你是互动影游分镜师。基于剧本 beat，为每一 beat 编写电影级分镜序列。`,

    task: `## 景别（严格使用中文）
- 远（远景）：交代环境关系，主体几乎隐没
- 全（全景）：主体完整入画，与环境关系清晰
- 中（中景）：人物腰部以上
- 近（近景）：人物胸部以上，强情绪
- 特（特写）：脸部 / 道具局部

不允许出现 ELS / LS / MS / CU / ECU 等英文缩写。

## 运镜（camera_movement）
静止 / 推 / 拉 / 摇 / 移 / 跟 / 升 / 降 / 手持。

## 三硬规则（违反必须重出）
1. 不许跳切：相邻镜头景别跨度不超过 2 档（远→中可，远→特不可，需中转）
2. 30 度规则：相邻同人物镜头需有 ≥30 度角度变化或景别变化（连续两个相同角度+相同景别会让画面"跳"）
3. 180 度轴线：同一对话 / 对峙的两人构成视线轴，相邻镜头不可越轴

## 决策 QTE 镜头处理（与 G-02 的 beat 字段对应；演出型 QTE 已停用）

### 决策 QTE（branch_qte，影响剧情）
- 在 beat.branch_qte 存在的 beat 上，必须有恰好 1 个 shot 标 branch_qte_ref=true
- 该 shot.duration_sec >= 3.0（与 branch_qte.duration_ms 匹配）
- 该 shot.shot_type 推荐"中"或"近"（让玩家看清动作）
- 该 shot.camera_movement 推荐"静止"或"轻推"，避免大运镜分散注意
- **不要输出 performance_ref**：演出型 QTE 已停用，本管线无"不影响剧情"的演出镜头。

## 时长分配
- 普通对白镜头：根据 dialogue.text 长度估算（中文 60ms/字 + 800ms 静默）
- 决策 QTE 镜头：duration_sec = branch_qte.duration_ms / 1000，且 >= 3.0

## 复用镜头组（reuse_from）
- 同一场地多次出现 / 同一动作多次重复时，可在 reuse_from 字段引用前面 shot_id
- 引用后该 shot 仍需独立编号，但可以省略 visual_content（写"复用 1.1-3"即可）`,

    output_format: `## 输出格式（严格 JSON）
{
  "storyboards": [
    {
      "beat_id": "1.1",
      "shots": [
        {
          "shot_id": "1.1-1",
          "shot_type": "全",
          "camera_movement": "静止",
          "visual_content": "市集全景，主角立于人群边缘",
          "duration_sec": 2.5
        },
        {
          "shot_id": "1.1-2",
          "shot_type": "近",
          "camera_movement": "推",
          "visual_content": "主角眼神聚焦远处一抹红影",
          "dialogue_ref": [0, 1],
          "duration_sec": 3.0
        }
      ],
      "transition_in": "硬切",
      "transition_out": "淡出"
    },
    {
      "beat_id": "3.4",
      "shots": [
        {
          "shot_id": "3.4-1", "shot_type": "中", "camera_movement": "静止",
          "visual_content": "主角凝视玻璃罩内的开关，UI 长按提示出现",
          "duration_sec": 2.0
        },
        {
          "shot_id": "3.4-2", "shot_type": "近", "camera_movement": "轻推",
          "visual_content": "手指悬停在按钮上方，瞳孔放大",
          "branch_qte_ref": true,
          "duration_sec": 4.0
        }
      ]
    }
  ]
}`,
  },
};

/** 渲染本批触及场（distinct scene_id）的三维状态元信息（一个线性段可能跨场）。 */
function renderSceneMetas(ctx: NarrativeContext, treeBeats: VnBranchedBeat[]): string {
  const sceneIds = [...new Set(treeBeats.map((b) => b.scene_id))];
  return sceneIds
    .map((sid) => {
      const s = ctx.vn_branched_beats?.scenes.find((sc) => sc.scene_id === sid)
        ?? ctx.vn_scenes?.scenes.find((sc) => sc.scene_id === sid);
      return s
        ? `场 ${s.scene_id}（第${s.act_id}幕，${s.location_name}/${s.time_of_day}/${s.indoor_outdoor}）`
        : `场 ${sid}`;
    })
    .join("\n");
}

/** 跨段/段内续接：用上文末镜提示构图轴线，避免越轴/跳切（仅摘要）。 */
function renderContinuityBlock(leadIn: VnBeatStoryboard[], prior: VnBeatStoryboard[]): string {
  const merged = [...leadIn, ...prior];
  if (merged.length === 0) return "";
  const refs = merged.slice(-3).map((sb) => ({
    beat_id: sb.beat_id,
    last_shots: (sb.shots ?? []).slice(-2).map((s) => ({
      shot_type: s.shot_type, camera_movement: s.camera_movement, visual_content: s.visual_content,
    })),
  }));
  return `\n## 参考：上文末镜（前驱链 / 本段上文；接续构图与轴线，避免越轴/跳切）
${JSON.stringify(refs, null, 2)}\n`;
}

/**
 * 构造**单批**的 user prompt（批 = 同一线性段内连续 ≤8 个 beat）。
 * - 主输入：本批剧本（来自 G-02）+ 本批剧情树 beats（pivot_kind / next_nodes，用于决策 QTE 镜头判定）
 * - 续接：跨段前驱 + 同段上文的末镜 → 接续轴线、防越轴/跳切
 */
function buildBatchUserPrompt(
  ctx: NarrativeContext,
  screenplayBeats: VnBeatScreenplay[],
  treeBeats: VnBranchedBeat[],
  leadIn: VnBeatStoryboard[],
  prior: VnBeatStoryboard[],
): string {
  let snapshotBlock = "";
  if (ctx.world_state_ledger && treeBeats.length > 0) {
    const allBeats = ctx.vn_branched_beats?.beats ?? [];
    const snapshot = computeWorldSnapshot(
      ctx.world_state_ledger,
      treeBeats[0].beat_id,
      vnBeatsToLedgerNodes(allBeats),
    );
    snapshotBlock = `\n## 世界时空参考（辅助镜头连贯性判断）\n时空：${snapshot.spacetime.time} · ${snapshot.spacetime.location}\n`;
  }

  return `## 必需：本批剧本（主输入，同一叙事线连续，按 beat_id 顺序）
${JSON.stringify(screenplayBeats, null, 2)}

## 必需：本批剧情树 beats（含 pivot_kind / next_nodes，用于决策 QTE 镜头判定）
${JSON.stringify(treeBeats, null, 2)}

## 本批触及场的元信息（三维状态决定景别基调与运镜可能）
${renderSceneMetas(ctx, treeBeats)}
${renderContinuityBlock(leadIn, prior)}${snapshotBlock}
## 任务
为本批每个 beat 编写电影级分镜序列。严格遵守景别中文化、三硬规则、双轨 QTE 镜头处理。
仅输出本批范围内的 storyboards（不要返回其他 beat_id）。`;
}

/**
 * 校验单场分镜输出。
 */
function validateScene(
  parsed: VnStoryboard,
  expectedBeatIds: Set<string>,
  treeBeatsById: Map<string, VnBranchedBeat>,
): void {
  if (!Array.isArray(parsed.storyboards) || parsed.storyboards.length === 0) {
    throw new Error("本场 storyboards 不能为空");
  }
  parsed.storyboards.forEach((sb: VnBeatStoryboard) => {
    if (!expectedBeatIds.has(sb.beat_id)) {
      throw new Error(`storyboard 出现非本场 beat：${sb.beat_id}`);
    }
    if (!Array.isArray(sb.shots) || sb.shots.length === 0) {
      throw new Error(`beat ${sb.beat_id} 的 shots 不能为空`);
    }
    sb.shots.forEach((s, i) => {
      const expectedPrefix = `${sb.beat_id}-`;
      if (!s.shot_id?.startsWith(expectedPrefix)) {
        throw new Error(`shot ${s.shot_id} 必须以 "${expectedPrefix}" 开头`);
      }
      if (!["远", "全", "中", "近", "特"].includes(s.shot_type)) {
        throw new Error(`shot ${s.shot_id}.shot_type 必须为中文 远/全/中/近/特：${s.shot_type}`);
      }
      if (!s.camera_movement?.trim()) throw new Error(`shot ${s.shot_id}.camera_movement 不能为空`);
      if (!s.visual_content?.trim() && !s.reuse_from) {
        throw new Error(`shot ${s.shot_id}.visual_content 不能为空（除非 reuse_from 引用）`);
      }
      if (typeof s.duration_sec !== "number" || s.duration_sec <= 0) {
        throw new Error(`shot ${s.shot_id}.duration_sec 必须为正数`);
      }
      if (i > 0) {
        const ranks = ["远", "全", "中", "近", "特"];
        const prevRank = ranks.indexOf(sb.shots[i - 1].shot_type);
        const currRank = ranks.indexOf(s.shot_type);
        if (Math.abs(prevRank - currRank) > 2) {
          throw new Error(`shot ${s.shot_id} 与上一镜景别跨度过大（>2 档），违反"不许跳切"`);
        }
      }
    });

    // 决策 QTE 镜头校验（用本场 G-01 beats 即可）
    const treeBeat = treeBeatsById.get(sb.beat_id);
    if (treeBeat?.pivot_kind === "branch_qte") {
      const qteShots = sb.shots.filter((s) => s.branch_qte_ref);
      if (qteShots.length !== 1) {
        throw new Error(`beat ${sb.beat_id} pivot=branch_qte，必须恰好 1 个 shot 标 branch_qte_ref=true`);
      }
      if (qteShots[0].duration_sec < 3) {
        throw new Error(`beat ${sb.beat_id} 决策 QTE 镜头 duration_sec 必须 >= 3 秒`);
      }
    }
  });
}

/**
 * 降级占位分镜：某场/子批 LLM 失败后，为其 beats 生成最小可用分镜，
 * 保留 beat 拓扑不断链。决策 QTE beat 仍补 1 个 branch_qte_ref 镜头以维持玩法。
 */
function placeholderStoryboard(sb: VnBeatScreenplay, treeBeat?: VnBranchedBeat): VnBeatStoryboard {
  const desc = (sb.description ?? "").replace(/^▲\s*/, "").slice(0, 80);
  const shots: VnShot[] = [{
    shot_id: `${sb.beat_id}-1`,
    shot_type: "中",
    camera_movement: "静止",
    visual_content: `（降级占位分镜）${desc || "占位画面"}`,
    duration_sec: 3,
  }];
  if (treeBeat?.pivot_kind === "branch_qte") {
    shots.push({
      shot_id: `${sb.beat_id}-2`,
      shot_type: "近",
      camera_movement: "静止",
      visual_content: "（降级占位）决策 QTE 镜头",
      branch_qte_ref: true,
      duration_sec: 4,
    });
  }
  return { beat_id: sb.beat_id, shots };
}

/**
 * 按**线性段**的 G-03 分镜设计（分支并行 + 单线串行 + 段内 ≤8 批 + 失败降级）。
 *
 * 与 G-02 同构：依赖关系切段（非"场"），互不依赖段同波并行，依赖段按波次串行；
 * 段内连续 beat 同批生成（末镜接续轴线、防越轴/跳切），跨段续接用前驱段末镜作 leadIn。
 * 单批失败用占位分镜降级保拓扑，告警汇总到 vn_storyboard.warnings。
 */
export async function vnStoryboard(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  if (!ctx.vn_screenplay || !ctx.vn_branched_beats) {
    throw new Error("vn_storyboard 需要 vn_screenplay 与 vn_branched_beats 已生成");
  }
  const streamEmit = getStreamEmit(ctx);
  const screenplay = ctx.vn_screenplay;
  const tree = ctx.vn_branched_beats;

  const screenById = new Map(screenplay.beats.map((b) => [b.beat_id, b]));
  const treeBeatsById = new Map(tree.beats.map((b) => [b.beat_id, b]));
  const warnings: string[] = [];

  const allStoryboards = await runBySegments<VnBeatStoryboard>({
    beats: tree.beats,
    maxBeatsPerCall: MAX_BEATS_PER_CALL,
    concurrency: SEGMENT_CONCURRENCY,
    idOf: (sb) => sb.beat_id,
    placeholder: (tb) => placeholderStoryboard(
      screenById.get(tb.beat_id) ?? { beat_id: tb.beat_id, scene_id: tb.scene_id, description: tb.content ?? "", dialogue: [] },
      tb,
    ),
    onWarn: (msg) => { warnings.push(`G-03 ${msg}`); console.error(`[vnStoryboard] ${msg}`); },
    onProgress: (done, total) => {
      if (streamEmit) streamEmit(`\n[G-03] 分镜设计进度（${done}/${total} beat）\n`, "");
    },
    runBatch: async (batch, leadIn, prior) => {
      const screenplayBeats = batch
        .map((tb) => screenById.get(tb.beat_id))
        .filter((b): b is VnBeatScreenplay => !!b);
      if (screenplayBeats.length === 0) return []; // 防御：本批无对应剧本（占位兜底）
      const expectedBeatIds = new Set(screenplayBeats.map((b) => b.beat_id));
      const raw = await llm.callWithRetry(
        composeSystemPrompt(VN_STORYBOARD_COMPOSER, ctx),
        appendUserInstructions(buildBatchUserPrompt(ctx, screenplayBeats, batch, leadIn, prior), ctx),
        { temperature: 0.5, responseFormat: "json" },
        (r) => validateScene(extractJSON<VnStoryboard>(r), expectedBeatIds, treeBeatsById),
        streamEmit,
      );
      return extractJSON<VnStoryboard>(raw).storyboards;
    },
  });

  ctx.vn_storyboard = warnings.length > 0
    ? { storyboards: allStoryboards, warnings }
    : { storyboards: allStoryboards };

  // Phase 2: assemble video prompts（按 scene 分组做 scene_prompt）
  const sceneToTreeBeats = new Map<string, VnBranchedBeat[]>();
  for (const b of tree.beats) {
    const list = sceneToTreeBeats.get(b.scene_id) ?? [];
    list.push(b);
    sceneToTreeBeats.set(b.scene_id, list);
  }
  assembleVnVideoPrompts(ctx, allStoryboards, sceneToTreeBeats);
}

/* ───────────── VN-specific shot → video prompt mapping ───────────── */

const VN_SHOT_TYPE_ZH: Record<string, string> = {
  "远": "远景", "全": "全景", "中": "中景", "近": "近景", "特": "特写",
};
const VN_SHOT_TYPE_EN: Record<string, string> = {
  "远": "extreme wide shot", "全": "wide shot", "中": "medium shot",
  "近": "close-up", "特": "extreme close-up",
};
const VN_MOVEMENT_EN: Record<string, string> = {
  "静止": "static camera", "推": "dolly in", "拉": "dolly out",
  "摇": "panning", "移": "tracking", "跟": "follow shot",
  "升": "crane up", "降": "crane down", "手持": "handheld",
  "轻推": "slow dolly in",
};

function assembleShotPromptZh(shot: VnShot): string {
  const parts: string[] = [];
  if (shot.shot_type) parts.push(VN_SHOT_TYPE_ZH[shot.shot_type] ?? shot.shot_type);
  if (shot.camera_movement) parts.push(shot.camera_movement);
  if (shot.visual_content) parts.push(shot.visual_content);
  parts.push("电影质感", "8K 高清");
  return parts.filter(Boolean).join("，");
}

function assembleShotPromptEn(shot: VnShot): string {
  const parts: string[] = [];
  if (shot.shot_type) parts.push(VN_SHOT_TYPE_EN[shot.shot_type] ?? shot.shot_type);
  if (shot.camera_movement) parts.push(VN_MOVEMENT_EN[shot.camera_movement] ?? shot.camera_movement);
  if (shot.visual_content) parts.push(shot.visual_content);
  parts.push("cinematic", "8k", "high detail");
  return parts.filter(Boolean).join(", ");
}

function assembleScenePrompt(
  sceneId: string,
  beats: VnBeatStoryboard[],
  _treeBeats: VnBranchedBeat[],
): { zh: string; en: string } {
  const allVisuals = beats.flatMap((b) => b.shots.map((s) => s.visual_content)).filter(Boolean);
  const summary = allVisuals.slice(0, 3).join("；");

  const zh = `场景 ${sceneId}：${summary || "（无描述）"}，电影质感`;
  const en = `Scene ${sceneId}: ${summary || "(no description)"}, cinematic`;
  return { zh, en };
}

/**
 * Enrich each shot with visual_prompt (zh/en) and each scene-group with scene_prompt.
 * Pure post-processing, no LLM call.
 */
function assembleVnVideoPrompts(
  ctx: NarrativeContext,
  storyboards: VnBeatStoryboard[],
  sceneToTreeBeats: Map<string, VnBranchedBeat[]>,
): void {
  // Per-shot: visual_prompt
  for (const sb of storyboards) {
    for (const shot of sb.shots) {
      shot.visual_prompt = {
        zh: assembleShotPromptZh(shot),
        en: assembleShotPromptEn(shot),
      };
    }
  }

  // Per-scene: scene_prompt on each beat storyboard
  const sbByScene = new Map<string, VnBeatStoryboard[]>();
  for (const sb of storyboards) {
    const sceneId = sb.beat_id.split(".")[0];
    const list = sbByScene.get(sceneId) ?? [];
    list.push(sb);
    sbByScene.set(sceneId, list);
  }

  for (const [sceneId, sceneSbs] of sbByScene) {
    const treeBeats = sceneToTreeBeats.get(sceneId) ?? [];
    const prompt = assembleScenePrompt(sceneId, sceneSbs, treeBeats);
    for (const sb of sceneSbs) {
      sb.scene_prompt = prompt;
    }
  }

  // Store combined video_prompts on ctx for downstream consumers
  const videoPrompts = {
    shots: storyboards.flatMap((sb) =>
      sb.shots.map((s) => ({
        shot_id: s.shot_id,
        beat_id: sb.beat_id,
        visual_prompt: s.visual_prompt,
        duration_sec: s.duration_sec,
      })),
    ),
    scenes: Array.from(sbByScene.entries()).map(([sceneId, sceneSbs]) => ({
      scene_id: sceneId,
      scene_prompt: sceneSbs[0]?.scene_prompt,
    })),
  };
  (ctx as Record<string, unknown>).vn_video_prompts = videoPrompts;
}
