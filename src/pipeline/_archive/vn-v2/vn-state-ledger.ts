/**
 * G-01.5：世界状态账本（World State Ledger）—— 影游线的入口，已归档。
 *
 * 折叠算法本身不在这里了：它与品类无关，已通用化到 `pipeline/graph/state-ledger.ts`，
 * 由活跃的 L3 情节层共用。本文件只留影游专有的两件事 —— 从人物小传/关键道具搭基线，
 * 和用影游口径的提示词补全漏填的变更。
 * ─────────────────────────────────────────────────────────────────
 * 输入：ctx.vn_branched_beats + ctx.vn_character_bios + ctx.vn_key_items + ctx.worldview_structure
 * 输出：ctx.world_state_ledger = { baseline, deltas }
 *
 * 职责：
 *   1. 从 V1a 人物小传 + V1b 关键道具 + 世界观构建初始 baseline
 *   2. 从 G-01 输出的每个 beat 收集 spacetime + state_deltas
 *   3. 校验状态变更的自洽性（如返老还童后不应再出现"老者"状态）
 *   4. 对遗漏 state_deltas 的 beat 做轻量 LLM 补全
 *   5. 写回 ctx.world_state_ledger
 */
import type {
  VnBranchedBeat,
  NarrativeContext,
  WorldStateLedger,
  BeatSpaceTime,
  CharacterState,
  ItemState,
  StateChange,
} from "../../../types/index.js";
import type { LedgerNode } from "../../graph/state-ledger.js";
import {
  collectDeltas,
  detectMissingDeltas,
  validateStateConsistency,
} from "../../graph/state-ledger.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { getStreamEmit } from "./_shared.js";

/**
 * 影游 beat 映射成账本节点。beat_id / prev_nodes 就是图的骨架，折叠只认这两项。
 */
export function vnBeatsToLedgerNodes(beats: readonly VnBranchedBeat[]): LedgerNode[] {
  return beats.map((b) => ({
    id: b.beat_id,
    prevIds: b.prev_nodes ?? [],
    spacetime: b.spacetime,
    changes: b.state_deltas,
  }));
}

/**
 * 从 vn_character_bios 构建初始角色状态
 */
function buildBaselineCharacters(ctx: NarrativeContext): CharacterState[] {
  const bios = ctx.vn_character_bios?.characters ?? [];
  return bios.map((bio) => ({
    name: bio.name,
    psychology: {
      personality: bio.voice ?? "未指定",
      persona_base: bio.internal_motivation ?? "未指定",
      current_mood: undefined,
    },
    physical: {
      body: bio.visual ?? "未描述",
      attire: "未描述",
    },
    power_level: "初始",
    relationships: [],
  }));
}

/**
 * 从 vn_key_items 构建初始道具状态
 */
function buildBaselineItems(ctx: NarrativeContext): ItemState[] {
  const items = ctx.vn_key_items?.items ?? [];
  return items.map((item) => ({
    name: item.name,
    location: item.bound_character ? `${item.bound_character}持有` : "未知",
    acquired: false,
    durability: "permanent" as const,
    condition: item.description ?? "初始状态",
  }));
}

/** 单批 LLM 调用上限：一次最多分析多少个 beat（控制 prompt 长度） */
const FILL_BATCH_SIZE = 20;

/**
 * 轻量 LLM 调用补全缺失的 state_deltas。
 *
 * 方案 B：不再用 slice(0, 20) 截断（会丢弃第 21 个起的所有漏填 beat），
 * 改为分批全量补全——按 FILL_BATCH_SIZE 切片，循环补完所有 missing beat。
 * 单批失败静默跳过该批，不阻塞其余批次与整个管线。
 */
async function fillMissingDeltas(
  missing: readonly VnBranchedBeat[],
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<Map<string, { spacetime: BeatSpaceTime; changes: StateChange[] }>> {
  const result = new Map<string, { spacetime: BeatSpaceTime; changes: StateChange[] }>();
  if (missing.length === 0) return result;

  for (let i = 0; i < missing.length; i += FILL_BATCH_SIZE) {
    const batch = missing.slice(i, i + FILL_BATCH_SIZE);
    await fillMissingDeltasBatch(batch, ctx, llm, result);
  }
  return result;
}

/**
 * 补全单批 beat 的 state_deltas，结果并入 result。单批失败静默跳过。
 */
async function fillMissingDeltasBatch(
  batch: readonly VnBranchedBeat[],
  ctx: NarrativeContext,
  llm: LLMClient,
  result: Map<string, { spacetime: BeatSpaceTime; changes: StateChange[] }>,
): Promise<void> {
  const beatsForPrompt = batch.map((b) => ({
    beat_id: b.beat_id,
    scene_id: b.scene_id,
    content: b.content,
    spacetime: b.spacetime ?? null,
  }));

  const system = `你是状态变更分析助手。给定若干情节点的 content，提取每个 beat 的时空坐标和状态变更。
输出格式（严格 JSON 数组）：
[
  {
    "beat_id": "X.Y",
    "spacetime": { "time": "...", "location": "..." },
    "changes": [
      { "dimension": "character|item|world|plot|time|location", "subject": "...", "attribute": "...", "from": "(可省)", "to": "..." }
    ]
  }
]
- subject 必须使用下方人物小传 / 关键道具中的原名（逐字一致）
- attribute 只能取以下白名单值（自创字段会被丢弃）：
  · character → physical.body | physical.attire | psychology.personality | psychology.persona_base | psychology.current_mood | power_level | relationships
    relationships 的 to 写成 JSON 字符串：{"target":"对方原名","nature":"关系性质"}
  · item → location | acquired(to="是"/"否") | condition | durability(to ∈ permanent|multi_use|single_use|consumed)
  · world / plot → to 直接写新状态描述
- 无变化的 beat 输出 changes: []
- from 字段可省略（首次出现时）
- time 使用故事世界纪年，location 精确到场景`;

  const user = `## 人物小传
${JSON.stringify(ctx.vn_character_bios?.characters?.map((c) => c.name) ?? [])}

## 关键道具
${JSON.stringify(ctx.vn_key_items?.items?.map((i) => i.name) ?? [])}

## 需分析的 beats
${JSON.stringify(beatsForPrompt, null, 2)}

请为每个 beat 提取 spacetime 和 state_deltas。`;

  try {
    const raw = await llm.callWithRetry(system, user, {
      temperature: 0.3,
      responseFormat: "json",
    });
    const parsed = extractJSON<Array<{
      beat_id: string;
      spacetime: BeatSpaceTime;
      changes: StateChange[];
    }>>(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.beat_id && item.spacetime) {
          result.set(item.beat_id, {
            spacetime: item.spacetime,
            changes: item.changes ?? [],
          });
        }
      }
    }
  } catch {
    // 单批补全失败时静默继续，不阻塞其余批次与管线
  }
}

/**
 * G-01.5 主步骤函数：构建世界状态账本
 */
export async function vnStateLedger(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const streamEmit = getStreamEmit(ctx);
  streamEmit?.("[G-01.5] 构建世界状态账本…", "");

  const beats = ctx.vn_branched_beats?.beats ?? [];
  if (beats.length === 0) {
    ctx.world_state_ledger = {
      baseline: {
        spacetime: { time: "未指定", location: "未指定" },
        characters: [],
        items: [],
        world_state: "",
        plot_state: "",
      },
      deltas: [],
    };
    return;
  }

  // 1. 构建 baseline
  const baselineCharacters = buildBaselineCharacters(ctx);
  const baselineItems = buildBaselineItems(ctx);
  const worldState = typeof ctx.worldview_structure === "object" && ctx.worldview_structure
    ? JSON.stringify(ctx.worldview_structure).slice(0, 500)
    : "未指定";
  const plotState = ctx.vn_logline
    ? `${ctx.vn_logline.title}：${ctx.vn_logline.content}`
    : "未指定";

  const firstBeat = beats[0];
  const baselineSpacetime: BeatSpaceTime = firstBeat.spacetime ?? {
    time: "故事开始",
    location: firstBeat.scene_id ? `场${firstBeat.scene_id}` : "未指定",
  };

  // 2. 收集 deltas
  const nodes = vnBeatsToLedgerNodes(beats);
  let deltas = collectDeltas(nodes);

  // 3. 检测并补全遗漏
  const missing = detectMissingDeltas(
    beats.map((b) => ({ id: b.beat_id, content: b.content, changes: b.state_deltas, beat: b })),
  ).map((n) => n.beat);
  if (missing.length > 0) {
    streamEmit?.(`[G-01.5] 补全 ${missing.length} 个 beat 的状态变更…`, "");
    const filled = await fillMissingDeltas(missing, ctx, llm);
    if (filled.size > 0) {
      const deltaMap = new Map(deltas.map((d) => [d.beat_id, d]));
      for (const [beatId, data] of filled) {
        const existing = deltaMap.get(beatId);
        if (existing) {
          if (!existing.spacetime || existing.spacetime.time === "未指定") {
            existing.spacetime = data.spacetime;
          }
          if (existing.changes.length === 0 && data.changes.length > 0) {
            existing.changes = data.changes;
          }
        }
      }
      deltas = [...deltaMap.values()];
    }
  }

  // 4. 校验自洽性
  const warnings = validateStateConsistency(deltas);
  if (warnings.length > 0) {
    streamEmit?.(`[G-01.5] 发现 ${warnings.length} 个状态自洽性警告`, "");
  }

  // 5. 组装账本并写回 ctx
  const ledger: WorldStateLedger = {
    baseline: {
      spacetime: baselineSpacetime,
      characters: baselineCharacters,
      items: baselineItems,
      world_state: worldState,
      plot_state: plotState,
    },
    deltas,
  };

  ctx.world_state_ledger = ledger;
  streamEmit?.(`[G-01.5] 账本构建完成：${deltas.length} 个 beat 的状态变更`, "");
}
