/**
 * polish-family.ts — 打磨席位家族（席位 2.3.16 / 2.3.17 / 2.3.18 / 2.3.19）
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么四席共用一份机制
 * ─────────────────────────────────────────────────────────────────
 * 去 AI 味、情节优化、情节润色、玩法适配这四席，机制上是同一件事：
 * 拿已生成的节点，逐节点重写其内容，**原样写回基准字段**（`branch.baseField`）。
 *
 * 四席真正的差别只在提示词——改哪里、什么算改好了。所以机制一份、提示词四份。
 * 分四个文件各写一遍循环，只会让"某一席悄悄少了骨架保护"这种事有四次机会发生。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么是原位写回而不是兄弟分支
 * ─────────────────────────────────────────────────────────────────
 * 这四席是「检查并优化已生成剧本」的 agent，产物就该是同一份剧本的新一版，
 * 而不是一份形状相同、字段名不同的复制品。早先写 `<baseField>__<seatId>`
 * 的做法要求下游每加一席就多认一个字段、前端多一个 renderer、落盘多一个
 * 文件名，而"用哪一版"这个问题其实版本快照已经答过了。
 *
 * 所以：写前由落盘层给旧内容存一张版本快照（见 step-files 的
 * `INPLACE_TRANSFORM_STEPS`），写后 `plots_generated` 仍是那一个字段，
 * 下游、前端、文件名一概不用改，回退靠版本号。
 *
 * ─────────────────────────────────────────────────────────────────
 * 骨架不可变
 * ─────────────────────────────────────────────────────────────────
 * 打磨席只许改**文字**，不许改图：node_id / parent_id / prev_node / next_node /
 * 边界约束一律以原件为准，模型改了也不采纳。理由不是保守：剧情树的拓扑是上游
 * 结构席的产出，下游任务/分镜/场景都按它对齐；一个润色步顺手改了 next_node，
 * 会让整条下游对不上，而且没有任何一步会报错。
 */
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, userInstructionsBlock } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt } from "../runtime/prompt-composer.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import { getNodeFilter } from "../graph/node-merge.js";
import { chunkArray } from "../graph/topo-sort.js";

/** 每批并发数，与任务席同量。 */
export const POLISH_BATCH_SIZE = 6;

export interface PolishSeatSpec {
  seatId: string;
  stepId: string;
  name: string;
  /** 打磨基准字段（席位 branch.baseField）。 */
  baseField: string;
  /** 基准字段里装节点数组的键。 */
  nodesKey: string;
  /** system 段：本席以什么身份下笔。 */
  role: string;
  /** system 段：改什么、什么算改好了。 */
  focus: string;
  /** system 段：机制与流程。 */
  cot: string;
}

export interface NodeLike {
  node_id: string;
  content?: string;
  [key: string]: unknown;
}

/** 当前分片的节点。缺片是编程错误（分片器没给数据），显式抛。 */
function chunkNode(ctx: NarrativeContext): NodeLike {
  const node = ((ctx as Record<string, unknown>)._chunk as { node?: NodeLike } | undefined)?.node;
  if (!node) throw new Error("打磨席的 user 段需要 ctx._chunk.node（按节点分片）");
  return node;
}

/** 基准字段当前的整份产物；缺失或形状不符时给 undefined。 */
function polishBase(spec: PolishSeatSpec, ctx: NarrativeContext): Record<string, unknown> | undefined {
  const base = (ctx as Record<string, unknown>)[spec.baseField];
  if (typeof base !== "object" || base === null) return undefined;
  return base as Record<string, unknown>;
}

/** 基准字段里的节点数组；字段缺失或形状不符时给空数组（本席对输入宽容）。 */
export function polishTargetNodes(spec: PolishSeatSpec, ctx: NarrativeContext): NodeLike[] {
  const nodes = polishBase(spec, ctx)?.[spec.nodesKey];
  if (!Array.isArray(nodes)) return [];
  const filter = getNodeFilter(ctx);
  const all = nodes as NodeLike[];
  return filter ? all.filter((n) => filter.has(n.node_id)) : all;
}

/**
 * 把打磨过的节点合回基准产物的整体形状。
 *
 * 逐节点替换而不是整表覆盖：节点过滤器生效时（重跑单个节点）只有命中的那些被
 * 打磨过，其余节点必须原样留在剧本里——整表覆盖会让一次单节点重跑把其它节点
 * 从产物里抹掉。基准对象上的其它键（统计、元信息）一并保留，形状不变。
 */
export function mergePolishedIntoBase(
  spec: PolishSeatSpec,
  ctx: NarrativeContext,
  polished: readonly NodeLike[],
): Record<string, unknown> | undefined {
  const base = polishBase(spec, ctx);
  if (!base) return undefined;
  const existing = Array.isArray(base[spec.nodesKey]) ? (base[spec.nodesKey] as NodeLike[]) : [];
  const byId = new Map(polished.map((n) => [n.node_id, n]));
  return {
    ...base,
    [spec.nodesKey]: existing.map((n) => byId.get(n.node_id) ?? n),
    // 这一版是谁打磨出来的。旧版在版本快照里，靠这两个键才看得出差别从哪来。
    polished_by: spec.seatId,
    polished_nodes: polished.length,
  };
}

const OUTPUT_SCHEMA = `## 输出格式（严格 JSON）
{
  "node_id": "与输入节点完全一致",
  "content": "打磨后的正文",
  "changes": ["这次改了什么，逐条说清（供作者对照，不进游戏）"]
}

只输出上面三个字段。节点的连接关系、父节点、边界约束一律不要输出——
它们由上游结构决定，本席无权改动。`;

export function buildPolishComposer(spec: PolishSeatSpec): PromptComposer {
  return {
    stepId: spec.stepId,
    blocks: {
      role: spec.role,
      focus: spec.focus,
      cot: spec.cot,
      invariants: `## 不可改动的部分

- 节点的 node_id、父节点、前后连接：这是上游结构席的产出，下游任务/分镜/场景全按它对齐；
- 边界约束（起始状态与终止状态）：改了它，本节点与相邻节点就接不上；
- 已确立的人物姓名、地名、道具名：改名等于让下游引用全部失效；
- 事件的发生与否：本席打磨表达，不重写剧情。要改剧情请回到情节席重生成。

如果你认为内容有必须改剧情才能解决的问题，把它写进 changes 里说明，而不是直接改。`,
      output_schema: OUTPUT_SCHEMA,
      node: (ctx: NarrativeContext): string =>
        `## 待打磨节点\n${JSON.stringify(chunkNode(ctx), null, 2)}`,
      characters: (ctx: NarrativeContext): string => {
        const sheets = ctx.detailed_character_sheets ?? [];
        if (sheets.length === 0) return "";
        // 只给声音相关的字段：打磨最容易出的错是把角色写成同一个人的语气。
        const brief = sheets.map((c) => ({
          name: c.name,
          label: c.label,
          occupation: c.occupation,
          speech: c.personal_life?.speech_pattern,
        }));
        return `## 角色档案（保持各自的声音）\n${JSON.stringify(brief, null, 2)}`;
      },
      worldview: (ctx: NarrativeContext): string =>
        ctx.worldview_structure
          ? `## 世界观设定\n${JSON.stringify(ctx.worldview_structure, null, 2)}`
          : "",
      design_snippet: (ctx: NarrativeContext): string => buildDesignContextSnippet(ctx),
      user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
    },
    systemBlockOrder: ["role", "focus", "cot", "invariants", "output_schema"],
    userBlockOrder: [
      "node",
      "characters",
      "worldview",
      "design_snippet",
      "user_instructions",
    ],
    skillSlots: [],
  };
}

/** 输出校验（抛错触发 LLM 重试）。 */
export function validatePolishOutput(raw: string): void {
  const parsed = extractJSON<Record<string, unknown>>(raw);
  if (!parsed.content || !String(parsed.content).trim()) {
    throw new Error("打磨后的 content 不能为空");
  }
}

/**
 * 合并：以原节点为底，只接受模型改动的正文。
 *
 * 这是"骨架不可变"落地的唯一位置。模型回了 next_node 也不会生效——不是信不过模型，
 * 而是这一层根本没有权限改图，把权限收在代码里比写进提示词可靠。
 */
export function mergePolishedNode(original: NodeLike, parsed: unknown): NodeLike {
  const out = (parsed ?? {}) as Record<string, unknown>;
  const content = String(out.content ?? original.content ?? "");
  const changes = Array.isArray(out.changes) ? out.changes.map(String) : [];
  return { ...original, content, _polish_changes: changes };
}

// ════════════════════════════════════════════════════════
// ChunkedRunner 接线：与 createPolishStep 共用 polishTargetNodes / mergePolishedNode /
// validatePolishOutput，保证 runner 路径与 legacy 路径产出同一份东西。
// ════════════════════════════════════════════════════════

/** 按节点分片：与 quest_generation 同构，chunkId = node_id。 */
export function polishSplitter(
  spec: PolishSeatSpec,
): (ctx: NarrativeContext) => Array<{ chunkId: string; data: Record<string, unknown> }> {
  return (ctx) => polishTargetNodes(spec, ctx).map((node) => ({ chunkId: node.node_id, data: { node } }));
}

/**
 * 逐片落地：每个节点一完成就调用 `ctx._saveNode`，与 legacy 在 runParallel 任务体内
 * 立刻调用同一个钩子对齐——中途取消也不会丢已完成节点的落盘。
 */
export function polishChunkDone(
  spec: PolishSeatSpec,
): (chunk: { chunkId: string; output: unknown }, ctx: NarrativeContext) => void {
  return (chunk, ctx) => {
    const node = polishTargetNodes(spec, ctx).find((n) => n.node_id === chunk.chunkId);
    if (!node) return;
    const merged = mergePolishedNode(node, chunk.output);
    const saveNode = (ctx as Record<string, unknown>)._saveNode as
      | ((stepId: string, nodeId: string, data: unknown) => void)
      | undefined;
    saveNode?.(spec.stepId, node.node_id, merged);
  };
}

/**
 * 合并：把打磨结果合回基准产物的整体形状，与 legacy 路径产出同一个东西。
 *
 * 没有任何节点被打磨到时原样返回基准产物——返回一份空壳会让原位写回把整份
 * 剧本清空。基准字段本身缺失时返回 undefined，落盘层按"这一步没产出"处理。
 */
export function polishMerger(
  spec: PolishSeatSpec,
): (chunks: Array<{ chunkId: string; output: unknown }>, ctx: NarrativeContext) => unknown {
  return (chunks, ctx) => {
    const nodes = polishTargetNodes(spec, ctx);
    const byId = new Map(nodes.map((n) => [n.node_id, n]));
    const polished = chunks
      .map((c) => {
        const node = byId.get(c.chunkId);
        return node ? mergePolishedNode(node, c.output) : undefined;
      })
      .filter((n): n is NodeLike => n !== undefined);

    return mergePolishedIntoBase(spec, ctx, polished);
  };
}

/**
 * 打磨席的通用实现：逐节点重写，原样写回基准字段。
 *
 * 与情节席不同，这里各节点**互不依赖**（打磨不需要前驱的新文本），所以直接分批并发，
 * 不需要拓扑分层。
 */
export function createPolishStep(
  spec: PolishSeatSpec,
): (ctx: NarrativeContext, llm: LLMClient) => Promise<void> {
  const composer = buildPolishComposer(spec);

  return async function polishStep(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
    const nodes = polishTargetNodes(spec, ctx);
    if (nodes.length === 0) {
      // 原位写回没有"写一份空产物"这个选项——那会把基准剧本清空。没得打磨就不动，
      // 由 requiredInputs 闸门去把这一步记成 skipped。
      console.warn(`[${spec.name}] ${spec.baseField} 里没有可打磨的节点，跳过`);
      return;
    }

    const { runParallel } = await import("../runtime/parallel-runner.js");
    const saveNode = (ctx as Record<string, unknown>)._saveNode as
      ((stepId: string, nodeId: string, data: unknown) => void) | undefined;
    const system = composeSystemPrompt(composer, ctx);
    const polished: NodeLike[] = [];

    for (const batch of chunkArray(nodes, POLISH_BATCH_SIZE)) {
      await runParallel(
        batch.map((node, idx) => ({
          id: node.node_id,
          sequenceIndex: idx,
          run: async () => {
            const chunkCtx = { ...ctx, _chunk: { node } } as NarrativeContext;
            const raw = await llm.callWithRetry(
              system,
              composeUserPrompt(composer, chunkCtx),
              { responseFormat: "json", temperature: 0.7 },
              validatePolishOutput,
            );
            const merged = mergePolishedNode(node, extractJSON(raw));
            polished.push(merged);
            saveNode?.(spec.stepId, node.node_id, merged);
            return merged;
          },
        })),
        POLISH_BATCH_SIZE,
      );
    }

    // 原顺序由基准产物的节点数组决定（合回时逐位替换），并发完成顺序不影响它。
    const merged = mergePolishedIntoBase(spec, ctx, polished);
    if (!merged) return;
    (ctx as Record<string, unknown>)[spec.baseField] = merged;
    console.log(`[${spec.name}] 打磨 ${polished.length} 个节点 → ${spec.baseField}（原位）`);
  };
}
