/**
 * scene-evidence.ts —— 内容检查席（2.3.15）的场景取证子步
 *
 * 这一步的语义是 **reconcile**：从已经写出来的剧情里提炼"实际出现过哪些地方"，
 * 再与场景列表席的前向清单（`scene_map`）对账，产出场景维度的证据。它自己不判优劣、
 * 不改产物，只把"清单说有 / 剧情真有"两张名单摆在一起，判定交给 content_check。
 *
 * 由来：这是被归档的 `scene_generation` 里唯一有业务价值又从未真正执行过的那一半
 * （Phase1 分层增量提炼）。旧实现把它挂在前向席位 2.3.6，于是排在 story_framework
 * 之前跑，输入永远是空的。搬到检查席之后，它的输入（剧情全文）天然齐备——同一段
 * 逻辑，换到方向正确的环节就活了。
 *
 * 不吸收的那部分：旧 Phase2 会"按剧情节点新增 L3-L5 子场景"。那是造内容，放在
 * 检查席里违背只审不修；场景该有多深由前向的 scene_plan 决定。取证只提炼，不新增。
 */
import type { NarrativeContext, SceneNode } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { runParallel, type ParallelTask } from "../runtime/parallel-runner.js";
import { chunkArray } from "../graph/topo-sort.js";
import { appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt, type PromptComposer } from "../runtime/prompt-composer.js";

/** 剧情里实测到的一个场景。 */
export interface SceneEvidenceItem {
  name: string;
  parent: string;
  level: number;
  /** 在哪些节点里出现过。 */
  sources: string[];
}

export interface SceneEvidenceReport {
  /** 剧情里实测到的全部场景（已按名字合并）。 */
  extracted: SceneEvidenceItem[];
  /** 剧情里出现、前向清单里没有的——清单漏项。 */
  missingInPlan: SceneEvidenceItem[];
  /** 前向清单里有、剧情里从未出现的——清单虚设或剧情未用。 */
  unusedInStory: string[];
  /** 各层贡献了多少条证据，便于判断取证是否覆盖到了细纲层。 */
  byLayer: { l0: number; l1: number; l2: number };
  /** 有没有前向清单可比。没有时只出 extracted，不报漏项（否则全是假阳性）。 */
  hasPlan: boolean;
  checkedAt: string;
}

const EVIDENCE_SYSTEM = `你是场景取证员。请从给定的故事节点文本中提取**文中实际出现过**的具名地理场景。所有输出使用中文。

## 层级参考
0 世界 / 1 区域 / 2 地域 / 3 地标点（可进入的建筑）/ 4 室内 / 5 物品设施

## 要求
- 只提取文本里真的写到的地方，不要推测、不要补全、不要为了树完整而新增中间层
- 文中以代称出现（"那座塔"）但能确定指向某个具名地点的，按具名地点记
- name：纯中文，禁止空格、-、_、括号等特殊字符
- parent：文本能看出归属时填父场景名，看不出留空
- level：按上面层级参考判断
- sources：这个场景出现在哪些节点 id（用给定的节点 id 原样填）`;

const EVIDENCE_OUTPUT = `输出JSON：
{
  "scenes": [
    { "name": "场景名", "parent": "父场景名或空", "level": 3, "sources": ["node_id"] }
  ]
}`;

const EVIDENCE_INCREMENTAL_SYSTEM = `${EVIDENCE_SYSTEM}

## 增量提取
已给出上层已经取证到的场景清单。清单里已有的场景，如果在本批文本里又出现，
仍要输出（sources 填本批节点 id），但 parent/level 必须与清单保持一致，不要另立一套归属。`;

/**
 * 取证不吃 skill 槽位：品类守则、结构策略卡都是"该怎么写"的口径，而这一步只回答
 * "文里已经写了什么"。把风格注进来只会诱导模型把清单往品类惯例上凑，制造假证据。
 */
export const SCENE_EVIDENCE_COMPOSER: PromptComposer = {
  stepId: "scene_evidence",
  blocks: {
    base: EVIDENCE_SYSTEM,
    output: EVIDENCE_OUTPUT,
  },
  systemBlockOrder: ["base", "output"],
  userBlockOrder: [],
  skillSlots: [],
};

const SCENE_EVIDENCE_INCREMENTAL_COMPOSER: PromptComposer = {
  stepId: "scene_evidence",
  blocks: {
    base: EVIDENCE_INCREMENTAL_SYSTEM,
    output: EVIDENCE_OUTPUT,
  },
  systemBlockOrder: ["base", "output"],
  userBlockOrder: [],
  skillSlots: [],
};

interface RawEvidenceScene {
  name?: string;
  parent?: string;
  level?: number;
  sources?: string[];
}

interface LayerNode {
  node_id: string;
  name: string;
  content: string;
}

function buildEvidencePrompt(
  nodes: LayerNode[],
  layerLabel: string,
  known: SceneEvidenceItem[],
): string {
  const body = nodes
    .map((n) => `### 节点 ${n.node_id}: ${n.name}\n${n.content}`)
    .join("\n\n");
  const knownBlock = known.length > 0
    ? `\n## 上层已取证场景（保持归属一致）\n${JSON.stringify(
        known.map((s) => ({ name: s.name, parent: s.parent, level: s.level })),
        null,
        2,
      )}\n`
    : "";

  return `${knownBlock}
## ${layerLabel} 故事节点（请从中取证）
${body}

请列出这些节点文本里实际出现过的场景。`;
}

async function extractLayer(
  nodes: LayerNode[],
  layerLabel: string,
  known: SceneEvidenceItem[],
  ctx: NarrativeContext,
  llm: LLMClient,
  batchSize: number,
): Promise<SceneEvidenceItem[]> {
  if (nodes.length === 0) return [];
  const composer = known.length > 0 ? SCENE_EVIDENCE_INCREMENTAL_COMPOSER : SCENE_EVIDENCE_COMPOSER;
  const batches = chunkArray(nodes, Math.max(1, batchSize));

  const tasks: ParallelTask<SceneEvidenceItem[]>[] = batches.map((batch, i) => ({
    id: `${layerLabel}_${i}`,
    sequenceIndex: i,
    run: async () => {
      const raw = await llm.callWithRetry(
        composeSystemPrompt(composer, ctx),
        appendUserInstructions(buildEvidencePrompt(batch, layerLabel, known), ctx),
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.scenes)) throw new Error("scenes 必须是数组");
        },
      );
      const parsed = extractJSON<{ scenes: RawEvidenceScene[] }>(raw);
      const fallbackSources = batch.map((n) => n.node_id);
      return (parsed.scenes ?? [])
        .filter((s) => !!s.name)
        .map((s) => ({
          name: String(s.name),
          parent: s.parent ?? "",
          level: typeof s.level === "number" ? s.level : 3,
          sources: s.sources && s.sources.length > 0 ? s.sources : fallbackSources,
        }));
    },
  }));

  const results = await runParallel(tasks, 6);
  const out: SceneEvidenceItem[] = [];
  for (const r of results) if (r.result) out.push(...r.result);
  return out;
}

/** 同名合并：层级取先出现的（上层更权威），sources 求并集。 */
export function mergeEvidence(items: readonly SceneEvidenceItem[]): SceneEvidenceItem[] {
  const byName = new Map<string, SceneEvidenceItem>();
  for (const item of items) {
    const key = item.name.trim();
    if (!key) continue;
    const hit = byName.get(key);
    if (!hit) {
      byName.set(key, { ...item, name: key, sources: [...new Set(item.sources)] });
      continue;
    }
    for (const src of item.sources) {
      if (!hit.sources.includes(src)) hit.sources.push(src);
    }
    if (!hit.parent && item.parent) hit.parent = item.parent;
  }
  return [...byName.values()];
}

/** 与前向清单对账。清单缺席时只回 extracted，不臆造漏项。 */
export function diffAgainstPlan(
  extracted: readonly SceneEvidenceItem[],
  planScenes: readonly SceneNode[] | undefined,
): Pick<SceneEvidenceReport, "missingInPlan" | "unusedInStory" | "hasPlan"> {
  if (!planScenes || planScenes.length === 0) {
    return { missingInPlan: [], unusedInStory: [], hasPlan: false };
  }
  const planNames = new Set(planScenes.map((s) => s.name));
  const storyNames = new Set(extracted.map((s) => s.name));
  return {
    missingInPlan: extracted.filter((s) => !planNames.has(s.name)),
    unusedInStory: planScenes.filter((s) => !storyNames.has(s.name)).map((s) => s.name),
    hasPlan: true,
  };
}

/**
 * 场景取证：L0 框架 → L1 大纲 → L2 细纲逐层提炼，层间把已取证清单传下去锚定归属，
 * 层内分批并行。分层不是为了省 token，是为了让下层的归属判断有上层的树可依。
 */
export async function sceneEvidence(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const fwNodes: LayerNode[] = (ctx.story_framework?.framework.nodes ?? []).map((n) => ({
    node_id: n.node_id, name: n.name, content: n.main_content,
  }));
  const olNodes: LayerNode[] = (ctx.outlines_generated?.outlines ?? []).map((n) => ({
    node_id: n.node_id, name: n.name, content: n.content,
  }));
  // 细纲层用情节正文取证：细纲只写"要发生什么"，情节才写"在哪儿发生"。
  const plotNodes: LayerNode[] = (ctx.plots_generated?.plots ?? []).map((p) => ({
    node_id: p.node_id, name: p.node_id, content: p.content,
  }));

  const l0 = await extractLayer(fwNodes, "L0框架", [], ctx, llm, fwNodes.length || 8);
  const knownAfterL0 = mergeEvidence(l0);
  const l1 = await extractLayer(olNodes, "L1大纲", knownAfterL0, ctx, llm, 12);
  const knownAfterL1 = mergeEvidence([...l0, ...l1]);
  const l2 = await extractLayer(plotNodes, "L2情节", knownAfterL1, ctx, llm, 5);

  const extracted = mergeEvidence([...l0, ...l1, ...l2]);
  const report: SceneEvidenceReport = {
    extracted,
    ...diffAgainstPlan(extracted, ctx.scene_map?.scenes),
    byLayer: { l0: l0.length, l1: l1.length, l2: l2.length },
    checkedAt: new Date().toISOString(),
  };

  (ctx as Record<string, unknown>).scene_evidence = report;
  console.log(
    `[SceneEvidence] 取证 ${extracted.length} 个场景；清单漏项 ${report.missingInPlan.length}，剧情未用 ${report.unusedInStory.length}`,
  );
}
