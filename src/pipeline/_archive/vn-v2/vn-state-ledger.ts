/**
 * G-01.5：世界状态账本（World State Ledger）
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
  NarrativeContext,
  VnBranchedBeat,
  WorldStateLedger,
  WorldSnapshot,
  BeatStateDelta,
  BeatSpaceTime,
  CharacterState,
  ItemState,
  StateChange,
} from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { getStreamEmit } from "./_shared.js";

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

/**
 * 从 G-01 beats 收集所有 BeatStateDelta（只保留有 spacetime 或 state_deltas 的）
 */
function collectDeltas(beats: VnBranchedBeat[]): BeatStateDelta[] {
  const deltas: BeatStateDelta[] = [];
  for (const beat of beats) {
    const spacetime: BeatSpaceTime = beat.spacetime ?? {
      time: "未指定",
      location: "未指定",
    };
    const changes: StateChange[] = beat.state_deltas ?? [];
    deltas.push({ beat_id: beat.beat_id, spacetime, changes });
  }
  return deltas;
}

/** content 低于此长度视为无实质内容的过场/占位，不送补全 */
const MIN_CONTENT_LEN = 10;

/**
 * 检测需要补全的 beat。
 *
 * 设计原则（方案 B）：state_deltas 本应由 G-01 在生成每个 beat 时一并产出（硬性必填）。
 * 这里只做"兜底"——凡是 state_deltas 缺失（未填）且 content 有实质内容的 beat，
 * 一律送 LLM 二次补全。不再用关键词猜测（关键词换题材即失效），也不做数量截断。
 *
 * 注意：state_deltas 为**空数组** `[]` 表示 G-01 已明确判定"此 beat 无状态变更"，
 * 属于已填，不再补；只有 `undefined`/缺字段才算漏填。
 */
function detectMissingDeltas(beats: VnBranchedBeat[]): VnBranchedBeat[] {
  return beats.filter((b) => {
    if (Array.isArray(b.state_deltas)) return false; // 已填（含明确的空数组）
    return (b.content?.trim().length ?? 0) >= MIN_CONTENT_LEN;
  });
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
  missing: VnBranchedBeat[],
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
  batch: VnBranchedBeat[],
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
 * 校验状态变更自洽性：检查同一 subject 的时间线上是否有矛盾
 * 返回警告列表（不阻塞流程）
 */
function validateConsistency(deltas: BeatStateDelta[]): string[] {
  const warnings: string[] = [];
  const lastKnownState = new Map<string, string>();

  for (const delta of deltas) {
    for (const change of delta.changes) {
      const key = `${change.dimension}:${change.subject}:${change.attribute}`;
      if (change.from) {
        const expected = lastKnownState.get(key);
        if (expected && expected !== change.from) {
          warnings.push(
            `beat ${delta.beat_id}: ${key} 声明 from="${change.from}" 但上次记录的状态是 "${expected}"`,
          );
        }
      }
      lastKnownState.set(key, change.to);
    }
  }
  return warnings;
}

/**
 * 计算从开场到指定 beat（含）的所有前驱 beat ID 集合（按路径追溯）。
 * 用于在分支树中只累积当前路径上的 delta，而非全局所有 delta。
 */
function collectAncestors(
  targetBeatId: string,
  beats: VnBranchedBeat[],
): Set<string> {
  const beatMap = new Map(beats.map((b) => [b.beat_id, b]));
  const ancestors = new Set<string>();
  const queue = [targetBeatId];

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    const beat = beatMap.get(id);
    if (beat?.prev_nodes) {
      for (const prev of beat.prev_nodes) {
        if (!ancestors.has(prev)) queue.push(prev);
      }
    }
  }
  return ancestors;
}

/**
 * 给定账本和目标 beat，计算该时刻的完整世界快照。
 * 按路径累积：只应用从开场到目标 beat 路径上的 delta。
 */
export function computeWorldSnapshot(
  ledger: WorldStateLedger,
  targetBeatId: string,
  beats: VnBranchedBeat[],
): WorldSnapshot {
  const ancestors = collectAncestors(targetBeatId, beats);

  const snapshot: WorldSnapshot = {
    spacetime: { ...ledger.baseline.spacetime },
    characters: ledger.baseline.characters.map((c) => ({
      ...c,
      psychology: { ...c.psychology },
      physical: { ...c.physical },
      relationships: [...c.relationships],
    })),
    items: ledger.baseline.items.map((i) => ({ ...i })),
    world: ledger.baseline.world_state,
    plot_progress: ledger.baseline.plot_state,
  };

  for (const delta of ledger.deltas) {
    if (!ancestors.has(delta.beat_id)) continue;

    snapshot.spacetime = { ...delta.spacetime };

    for (const change of delta.changes) {
      applyChange(snapshot, change);
    }
  }

  return snapshot;
}

function applyChange(snapshot: WorldSnapshot, change: StateChange): void {
  switch (change.dimension) {
    case "time":
      snapshot.spacetime.time = change.to;
      break;
    case "location":
      snapshot.spacetime.location = change.to;
      break;
    case "character": {
      let char = snapshot.characters.find((c) => c.name === change.subject);
      if (!char) {
        char = {
          name: change.subject,
          psychology: { personality: "未指定", persona_base: "未指定" },
          physical: { body: "未描述", attire: "未描述" },
          power_level: "未知",
          relationships: [],
        };
        snapshot.characters.push(char);
      }
      applyCharacterChange(char, change.attribute, change.to);
      break;
    }
    case "item": {
      let item = snapshot.items.find((i) => i.name === change.subject);
      if (!item) {
        item = {
          name: change.subject,
          location: "未知",
          acquired: false,
          durability: "permanent",
          condition: "未知",
        };
        snapshot.items.push(item);
      }
      applyItemChange(item, change.attribute, change.to);
      break;
    }
    case "world":
      snapshot.world = change.to;
      break;
    case "plot":
      snapshot.plot_progress = change.to;
      break;
  }
}

function applyCharacterChange(char: CharacterState, attr: string, value: string): void {
  switch (attr) {
    case "physical.body":
      char.physical.body = value;
      break;
    case "physical.attire":
      char.physical.attire = value;
      break;
    case "psychology.personality":
      char.psychology.personality = value;
      break;
    case "psychology.persona_base":
      char.psychology.persona_base = value;
      break;
    case "psychology.current_mood":
      char.psychology.current_mood = value;
      break;
    case "power_level":
      char.power_level = value;
      break;
    case "relationships": {
      const rel = parseRelationship(value);
      const existing = char.relationships.find((r) => r.target === rel.target);
      if (existing) {
        existing.nature = rel.nature;
      } else {
        char.relationships.push(rel);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * 宽容解析"关系变更"的 to 值。容错优先级：
 *   1. JSON 字符串：{"target":"师父","nature":"决裂"}
 *   2. 分隔符写法：师父:决裂 / 师父=决裂 / 师父｜决裂 / 师父-决裂 / 师父→决裂
 *   3. 兜底：整段当作 nature，target 标记为 unknown（至少不丢信息）
 * 这样 LLM 无论吐 JSON 还是自然语言，都能落到 relationships 上而非全部坍缩为 unknown。
 */
function parseRelationship(value: string): { target: string; nature: string } {
  const raw = value.trim();
  try {
    const parsed = JSON.parse(raw) as { target?: string; nature?: string };
    if (parsed && typeof parsed === "object" && parsed.target && parsed.nature) {
      return { target: String(parsed.target), nature: String(parsed.nature) };
    }
  } catch {
    // 非 JSON，继续走分隔符解析
  }
  const m = raw.match(/^\s*(.+?)\s*[:：=｜|\-→]\s*(.+?)\s*$/);
  if (m && m[1] && m[2]) {
    return { target: m[1], nature: m[2] };
  }
  return { target: "unknown", nature: raw };
}

function applyItemChange(item: ItemState, attr: string, value: string): void {
  switch (attr) {
    case "location":
      item.location = value;
      break;
    case "acquired":
      item.acquired = value === "true" || value === "是";
      break;
    case "durability":
      if (["permanent", "multi_use", "single_use", "consumed"].includes(value)) {
        item.durability = value as ItemState["durability"];
      }
      break;
    case "condition":
      item.condition = value;
      break;
    default:
      break;
  }
}

/**
 * 渲染 WorldSnapshot 为 LLM 可读的文本块
 */
export function renderWorldSnapshot(snapshot: WorldSnapshot): string {
  const lines: string[] = [];

  lines.push(`## 世界当前状态（精确快照 — 后续描写必须严格遵守）`);
  lines.push(`时空：${snapshot.spacetime.time} · ${snapshot.spacetime.location}`);
  lines.push("");

  lines.push("### 角色状态");
  for (const c of snapshot.characters) {
    lines.push(`- **${c.name}**`);
    lines.push(`  外貌：${c.physical.body}`);
    lines.push(`  着装：${c.physical.attire}`);
    lines.push(`  实力：${c.power_level}`);
    lines.push(`  性格：${c.psychology.personality}`);
    if (c.psychology.current_mood) {
      lines.push(`  当前情绪：${c.psychology.current_mood}`);
    }
    for (const r of c.relationships) {
      lines.push(`  · 与${r.target}：${r.nature}`);
    }
  }
  lines.push("");

  if (snapshot.items.length > 0) {
    lines.push("### 道具状态");
    for (const i of snapshot.items) {
      lines.push(`- **${i.name}**：位置=${i.location} / 已获取=${i.acquired ? "是" : "否"} / 状况=${i.condition}`);
    }
    lines.push("");
  }

  lines.push(`### 世界格局\n${snapshot.world}`);
  lines.push("");
  lines.push(`### 剧情进度\n${snapshot.plot_progress}`);

  return lines.join("\n");
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
  let deltas = collectDeltas(beats);

  // 3. 检测并补全遗漏
  const missing = detectMissingDeltas(beats);
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
  const warnings = validateConsistency(deltas);
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
