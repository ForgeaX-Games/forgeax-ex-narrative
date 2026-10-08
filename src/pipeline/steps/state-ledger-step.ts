/**
 * 状态账本（挂在故事情节助手 2.5.10 名下）。
 *
 * 做的事：把 L3 每个情节节点声明的状态变更，连上角色档案 / 道具库 / 世界观搭出的基线，
 * 组装成一本账 —— 之后任何一处想知道"走到某节点时世界什么样"，问账本就有答案，不必
 * 重读全树。折叠算法在 `graph/state-ledger.ts`，与品类无关；本文件只负责搭基线、补漏、
 * 落盘这三件与管线有关的事。
 *
 * 为什么是独立一步而不是并进情节生成：情节生成是分批并发的，每批只看得见自己那几个
 * 节点，而账本要的是全树。放在生成之后、消费之前，它才第一次有全树可看。
 *
 * 补漏这件事是这一步存在的另一半理由。情节正文已经 1000-2000 字，同一次调用还要算准
 * 状态变更，两件事互相挤；所以 `state_deltas` 是可选的，漏填的节点在这里用一次轻量
 * 调用批量补回来。补全按批切片、单批失败就跳过：一批没补上只是那几个节点状态糙一点，
 * 不该让整条管线停下。
 */
import type {
  BeatSpaceTime,
  NarrativeContext,
  PlotNode,
  StateChange,
  WorldStateLedger,
} from "../../types/index.js";
import {
  buildBaselineCharacters,
  buildBaselineItems,
  collectDeltas,
  detectMissingDeltas,
  plotsToLedgerNodes,
  validateStateConsistency,
} from "../graph/state-ledger.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";

/** 单批补全的节点上限：一次调用塞太多节点，提示词会长到模型开始漏答。 */
const FILL_BATCH_SIZE = 20;

/** 世界格局基线取世界观的前若干字符：账本只要个起点，全文塞进去是下游的事。 */
const WORLD_STATE_EXCERPT = 500;

type FilledDelta = { spacetime: BeatSpaceTime; changes: StateChange[] };

/**
 * 空账本 —— 没有情节可折时的形状。
 *
 * 给空壳而不是不写：下游读到 `undefined` 会走"没有账本"的降级分支，而这里的事实是
 * "有账本，只是树是空的"。两者对下游是同一个结果，但前者让"账本这一步跑过没有"变得
 * 无从分辨。
 */
function emptyLedger(): WorldStateLedger {
  return {
    baseline: {
      spacetime: { time: "未指定", location: "未指定" },
      characters: [],
      items: [],
      world_state: "",
      plot_state: "",
    },
    deltas: [],
  };
}

/**
 * 用一次轻量调用，为漏填的节点补出时空与状态变更。
 *
 * 白名单约束写在提示词里而不是事后校验：属性名是模型自由发挥的重灾区（"衣着"
 * "attire" "physical.attire" 三种写法都会出现），而折叠只认一套键 —— 不在白名单上的
 * 变更会被 `applyChange` 静默丢掉，那种丢法查不出来。先把可选值给全，比事后纠正省事。
 */
async function fillMissingDeltas(
  missing: readonly PlotNode[],
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<Map<string, FilledDelta>> {
  const result = new Map<string, FilledDelta>();

  for (let i = 0; i < missing.length; i += FILL_BATCH_SIZE) {
    await fillBatch(missing.slice(i, i + FILL_BATCH_SIZE), ctx, llm, result);
  }
  return result;
}

async function fillBatch(
  batch: readonly PlotNode[],
  ctx: NarrativeContext,
  llm: LLMClient,
  result: Map<string, FilledDelta>,
): Promise<void> {
  const system = `你是状态变更分析助手。给定若干情节节点的正文，提取每个节点的时空坐标和状态变更。
输出格式（严格 JSON 数组）：
[
  {
    "node_id": "1.2",
    "spacetime": { "time": "...", "location": "..." },
    "changes": [
      { "dimension": "character|item|world|plot|time|location", "subject": "...", "attribute": "...", "from": "(可省)", "to": "..." }
    ]
  }
]
- subject 必须使用下方角色档案 / 道具库中的原名（逐字一致）
- attribute 只能取以下白名单值（自创字段会被丢弃）：
  · character → physical.body | physical.attire | psychology.personality | psychology.persona_base | psychology.current_mood | power_level | relationships
    relationships 的 to 写成 JSON 字符串：{"target":"对方原名","nature":"关系性质"}
  · item → location | acquired(to="是"/"否") | condition | durability(to ∈ permanent|multi_use|single_use|consumed)
  · world / plot → to 直接写新状态描述
- 确实没有状态变更的节点输出 changes: []
- from 字段可省略（首次出现时）
- time 使用故事世界纪年，location 精确到场景`;

  const user = `## 角色档案
${JSON.stringify((ctx.detailed_character_sheets ?? []).map((c) => c.name))}

## 道具库
${JSON.stringify((ctx.item_database ?? []).map((i) => i.name))}

## 需分析的情节节点
${JSON.stringify(
  batch.map((p) => ({
    node_id: p.node_id,
    content: p.content,
    spacetime: p.spacetime ?? null,
  })),
  null,
  2,
)}

请为每个节点提取 spacetime 和 state_deltas。`;

  try {
    const raw = await llm.callWithRetry(system, user, {
      temperature: 0.3,
      responseFormat: "json",
    });
    const parsed = extractJSON<Array<{ node_id?: string; spacetime?: BeatSpaceTime; changes?: StateChange[] }>>(raw);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (item.node_id && item.spacetime) {
        result.set(String(item.node_id), {
          spacetime: item.spacetime,
          changes: item.changes ?? [],
        });
      }
    }
  } catch {
    // 单批补全失败时静默继续：补不上只是那几个节点状态糙一点，不阻塞其余批次与管线。
  }
}

export async function stateLedger(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const plots = ctx.plots_generated?.plots ?? [];
  if (plots.length === 0) {
    ctx.world_state_ledger = emptyLedger();
    return;
  }

  const nodes = plotsToLedgerNodes(plots);
  let deltas = collectDeltas(nodes);

  const missing = detectMissingDeltas(
    plots.map((p) => ({ id: p.node_id, content: p.content, changes: p.state_deltas, plot: p })),
  ).map((n) => n.plot);

  if (missing.length > 0) {
    const filled = await fillMissingDeltas(missing, ctx, llm);
    if (filled.size > 0) {
      const deltaMap = new Map(deltas.map((d) => [d.beat_id, d]));
      for (const [nodeId, data] of filled) {
        const existing = deltaMap.get(nodeId);
        if (!existing) continue;
        // 只补空缺，不覆盖已有：节点自己声明的那一份是写正文时定的，比事后推断可信。
        if (existing.spacetime.time === "未指定") existing.spacetime = data.spacetime;
        if (existing.changes.length === 0) existing.changes = data.changes;
      }
      deltas = [...deltaMap.values()];
      // 补回来的也写回节点，这样账本与情节产物说的是同一件事。
      const plotMap = new Map(plots.map((p) => [p.node_id, p]));
      for (const [nodeId, data] of filled) {
        const plot = plotMap.get(nodeId);
        if (!plot) continue;
        plot.spacetime ??= data.spacetime;
        plot.state_deltas ??= data.changes;
      }
    }
  }

  const warnings = validateStateConsistency(deltas);
  if (warnings.length > 0) {
    // 告警不阻塞：一条对不上的时间线该让作者看见，不该让管线停下。
    console.warn(`[状态账本] ${warnings.length} 处状态前后不符:`, warnings.slice(0, 10));
  }

  const first = plots.find((p) => (p.prev_node?.length ?? 0) === 0) ?? plots[0];
  ctx.world_state_ledger = {
    baseline: {
      spacetime: first.spacetime ?? {
        time: "故事开始",
        location: first.jrpg_elements?.scene_location || "未指定",
      },
      characters: buildBaselineCharacters(ctx.detailed_character_sheets ?? []),
      items: buildBaselineItems(ctx.item_database ?? []),
      world_state: ctx.worldview_structure
        ? JSON.stringify(ctx.worldview_structure).slice(0, WORLD_STATE_EXCERPT)
        : "未指定",
      // 剧情进度基线就是"故事还没开始"，用标题指代这个起点。归档的影游版用 logline，
      // 那是影游专有产物；通用侧只有标题这一项是任何品类都有的。
      plot_state: ctx.story_title ?? "未指定",
    },
    deltas,
  };
}
