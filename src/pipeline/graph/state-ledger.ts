/**
 * 世界状态账本 —— 把"每个节点改变了什么"折成"到这个节点时世界长什么样"。
 *
 * 为什么需要它：下游席位（分镜、任务、剧本）要写某个节点，就得知道此刻角色穿什么、
 * 道具在谁手上、时间到了哪一年。这些信息不在任何单个节点里 —— 它是从开场到该节点
 * **这条路径上**所有变更的累积结果。分支树尤其如此：同一个节点在不同来路下的世界
 * 状态不同，所以累积必须按路径走，不能把全树的变更一股脑加起来。
 *
 * 算法来自归档的影游账本（`_archive/vn-v2/vn-state-ledger.ts`，原 G-01.5 步骤），
 * 那里它只吃 `VnBranchedBeat`。搬过来时发现折叠本身与影游无关：它只用到节点的
 * **id 与入边**，别的字段一个都没碰。所以这里把入参收窄成 `LedgerNode` —— 一个只
 * 有 id / 入边 / 时空 / 变更四项的形状，情节节点（L3 `PlotNode`）与归档的 beat
 * 都能映射上去，算法一份。
 *
 * 与归档版唯一的实质差别是折叠顺序。归档版按 `deltas` 数组的下标顺序应用，前提是
 * 那个数组恰好已是拓扑序 —— 影游 beats 是单批生成的，碰巧成立。L3 情节是分批并发
 * 生成后合并的，数组顺序由批次返回次序决定，靠不住：同一棵树跑两遍可能得到不同的
 * 快照。所以这里按入边算出确定性次序再折（见 `orderAncestors`），快照只取决于图本身。
 */
import type {
  BeatSpaceTime,
  BeatStateDelta,
  CharacterSheet,
  CharacterState,
  GameItem,
  ItemState,
  PlotNode,
  StateChange,
  WorldSnapshot,
  WorldStateLedger,
} from "../../types/index.js";

/**
 * 折叠算法认识的节点形状 —— 图的骨架加上它自己声明的变更。
 *
 * `prevIds` 是**入边**而不是出边：累积要往回追溯来路。叶子方向的边在这里没有用处。
 */
export interface LedgerNode {
  id: string;
  prevIds: readonly string[];
  /** 该节点所处的时空坐标。缺省时沿用上游的坐标（过场节点常常不换时空）。 */
  spacetime?: BeatSpaceTime;
  /**
   * 该节点造成的状态变更。
   *
   * `undefined` 与 `[]` 意思不同，且这个区分是补全机制的全部依据：空数组表示
   * 生成侧**明确判定**此节点无状态变更，已填；缺字段表示它没说，才要补。
   */
  changes?: readonly StateChange[];
}

/** L3 情节节点映射成账本节点。node_id / prev_node 就是图的骨架。 */
export function plotsToLedgerNodes(plots: readonly PlotNode[]): LedgerNode[] {
  return plots.map((p) => ({
    id: p.node_id,
    prevIds: p.prev_node ?? [],
    spacetime: p.spacetime,
    changes: p.state_deltas,
  }));
}

/** 收集全图的变更声明。没声明时空的节点记"未指定"，由快照沿用上游坐标补上。 */
export function collectDeltas(nodes: readonly LedgerNode[]): BeatStateDelta[] {
  return nodes.map((n) => ({
    beat_id: n.id,
    spacetime: n.spacetime ?? { time: "未指定", location: "未指定" },
    changes: [...(n.changes ?? [])],
  }));
}

/** content 短于此长度的节点视为占位或纯过场，不值得为它单独调一次模型补全。 */
const MIN_CONTENT_LEN = 10;

/**
 * 挑出漏填变更、且正文有实质内容的节点。
 *
 * 不用关键词猜"这段像是有状态变更"——换个题材那套词就失效了。只看"填没填"：
 * 声明了空数组的是已填，不补。
 */
export function detectMissingDeltas<T extends { id: string; content?: string; changes?: unknown }>(
  nodes: readonly T[],
): T[] {
  return nodes.filter(
    (n) => !Array.isArray(n.changes) && (n.content?.trim().length ?? 0) >= MIN_CONTENT_LEN,
  );
}

/**
 * 校验变更之间是否自洽：某一项属性声明的 `from`，和上一次记录下来的 `to` 对不上，
 * 就是"吃书"。
 *
 * 返回警告而不抛错：一条对不上的时间线不该让整条管线停下，作者看得见就够了。
 */
export function validateStateConsistency(deltas: readonly BeatStateDelta[]): string[] {
  const warnings: string[] = [];
  const lastKnownState = new Map<string, string>();

  for (const delta of deltas) {
    for (const change of delta.changes) {
      const key = `${change.dimension}:${change.subject}:${change.attribute}`;
      if (change.from) {
        const expected = lastKnownState.get(key);
        if (expected && expected !== change.from) {
          warnings.push(
            `节点 ${delta.beat_id}: ${key} 声明 from="${change.from}" 但上次记录的状态是 "${expected}"`,
          );
        }
      }
      lastKnownState.set(key, change.to);
    }
  }
  return warnings;
}

/** 从开场追溯到目标节点，收集这条来路上的所有节点（含目标本身）。 */
function collectAncestors(targetId: string, nodes: readonly LedgerNode[]): Set<string> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const ancestors = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    for (const prev of nodeMap.get(id)?.prevIds ?? []) {
      if (!ancestors.has(prev)) queue.push(prev);
    }
  }
  return ancestors;
}

/**
 * 把来路上的节点排成确定性的折叠次序。
 *
 * 先按"到开场的最长距离"分层 —— 一个节点的所有上游都排在它前面，这是折叠正确性的
 * 要求（后来的变更要覆盖先前的）。取最长而不是最短：汇聚点的两条来路长短不一时，
 * 短的那条若定了它的层，长条上的节点会排到汇聚点后面去。
 *
 * 同层之间按 id 排。同层意味着互不为上游，谁先谁后不影响结果；定一个顺序只是为了
 * 让同一张图每次折出同一份快照。
 */
function orderAncestors(ancestors: Set<string>, nodes: readonly LedgerNode[]): string[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();

  const depthOf = (id: string, visiting: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    // 环在这里只能是脏数据（树形引擎不产环）。就地断开，按开场算，不让它把栈打爆。
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const prevs = (nodeMap.get(id)?.prevIds ?? []).filter((p) => ancestors.has(p));
    const d = prevs.length === 0 ? 0 : Math.max(...prevs.map((p) => depthOf(p, visiting))) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  const ids = [...ancestors];
  for (const id of ids) depthOf(id, new Set());
  return ids.sort((a, b) => (depth.get(a)! - depth.get(b)!) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 算出"走到目标节点时"的完整世界快照：基线加上这条来路上的全部变更。
 *
 * 只累积来路上的。旁支上的变更不能算 —— 玩家没走那条路，那些事在他的故事里没发生。
 */
export function computeWorldSnapshot(
  ledger: WorldStateLedger,
  targetId: string,
  nodes: readonly LedgerNode[],
): WorldSnapshot {
  const ancestors = collectAncestors(targetId, nodes);
  const order = orderAncestors(ancestors, nodes);
  const deltaMap = new Map(ledger.deltas.map((d) => [d.beat_id, d]));

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

  for (const id of order) {
    const delta = deltaMap.get(id);
    if (!delta) continue;
    // 没声明时空的节点沿用上游坐标：一段对话不换场景，不该把地点抹成"未指定"。
    if (delta.spacetime.time !== "未指定") snapshot.spacetime.time = delta.spacetime.time;
    if (delta.spacetime.location !== "未指定") {
      snapshot.spacetime.location = delta.spacetime.location;
    }
    for (const change of delta.changes) applyChange(snapshot, change);
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
      if (existing) existing.nature = rel.nature;
      else char.relationships.push(rel);
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
 * 这样模型无论吐 JSON 还是自然语言，都能落到 relationships 上而非全部坍缩为 unknown。
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
  if (m && m[1] && m[2]) return { target: m[1], nature: m[2] };
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

/** 渲染快照为可读文本块，供下游席位的提示词直接引用。 */
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
    if (c.psychology.current_mood) lines.push(`  当前情绪：${c.psychology.current_mood}`);
    for (const r of c.relationships) lines.push(`  · 与${r.target}：${r.nature}`);
  }
  lines.push("");

  if (snapshot.items.length > 0) {
    lines.push("### 道具状态");
    for (const i of snapshot.items) {
      lines.push(
        `- **${i.name}**：位置=${i.location} / 已获取=${i.acquired ? "是" : "否"} / 状况=${i.condition}`,
      );
    }
    lines.push("");
  }

  lines.push(`### 世界格局\n${snapshot.world}`);
  lines.push("");
  lines.push(`### 剧情进度\n${snapshot.plot_progress}`);

  return lines.join("\n");
}

/**
 * 从角色档案（2.5.5 的产物）搭初始角色状态。
 *
 * 归档版读的是影游人物小传的三个专有字段（voice / internal_motivation / visual）。
 * 通用档案里对应的是 `role_in_story` / `background_information` / `visual_prompt.zh` ——
 * 取这三项而不取 `psychological_drivers`、`archetype_analysis` 这类字段，是因为后者
 * 的类型是 `Record<string, unknown>`：里面装什么由生成时的模型决定，取出来拼成一行
 * 人话没有稳定的办法。基线只要"开场时是什么样"，档案里最稳的三项就够了。
 */
export function buildBaselineCharacters(sheets: readonly CharacterSheet[]): CharacterState[] {
  return sheets.map((s) => ({
    name: s.name,
    psychology: {
      personality: s.role_in_story ?? "未指定",
      persona_base: s.background_information ?? "未指定",
      current_mood: undefined,
    },
    physical: {
      body: s.visual_prompt?.zh ?? "未描述",
      attire: "未描述",
    },
    power_level: "初始",
    relationships: [],
  }));
}

/**
 * 从道具库（2.5.6 的产物）搭初始道具状态。
 *
 * `acquired` 一律 false：它问的是"玩家拿到了吗"，开场时还没有。`initial_owner` 说的
 * 是这件东西此刻在谁手上 —— 落在 `location` 上，与"玩家是否持有"是两件事。
 *
 * `durability` 一律 permanent：道具库里没有这一维，从 `max_stack` 之类反推会把
 * "能叠放"当成"会用掉"。开场默认不损耗，真的消耗发生时由节点自己声明变更。
 */
export function buildBaselineItems(items: readonly GameItem[]): ItemState[] {
  return items.map((i) => ({
    name: i.name,
    location: i.initial_owner ? `${i.initial_owner}持有` : (i.initial_scene || "未知"),
    acquired: false,
    durability: "permanent" as const,
    condition: i.description || "初始状态",
  }));
}
