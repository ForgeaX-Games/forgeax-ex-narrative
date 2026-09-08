/**
 * 场景生成（v3 重构版）
 *
 * 2026-08 已封存：本文件是场景席按环节方向拆分前的原貌，不再被任何活跃代码 import。
 * 前向那半（第 435 行起的 worldview fallback）正式化为 `steps/scene-plan.ts`；
 * 后向那半（Phase1 分层提炼）迁为内容检查席的 `steps/scene-evidence.ts`；
 * Phase3 的确定性聚合器（scene-aggregator）本就是共享模块，两侧继续共用。
 * 吸收台账见本目录 README。
 *
 * 三阶段架构：
 * - Phase1: 分层分批骨架提取（L0框架→L1大纲→L2细纲，不限定场景层级）
 * - Phase2: 按节点展开（监控任务生成完成状态，L3+L4+L5数据）
 * - Phase3: 纯算法合并去重 + 层级式 UID 分配 + MD 树
 *
 * UID 编号规则：0-3层每层占2位，4-5层每层占4位，每层从0开始编号，"-"隔开
 */
import type { NarrativeContext, PlotNode } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { runParallel, type ParallelTask } from "../../runtime/parallel-runner.js";
import { chunkArray } from "../../graph/topo-sort.js";
import { buildDesignContextSnippet, appendUserInstructions, buildIpSourceReference } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../../runtime/prompt-composer.js";
import { getNodeFilter } from "../../graph/node-merge.js";
import {
  aggregateScenes,
  skeletonToRaw,
  expandedToRaw,
  buildPerNodeMd,
} from "../../graph/scene-aggregator.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface SkeletonScene {
  name: string;
  parent: string;
  level: number;
  label?: unknown;
  description?: unknown;
}

interface RawExpandedScene {
  name: string;
  parent?: string;
  label?: unknown;
  description?: unknown;
  level?: number;
  story_units?: string[];
}

// ---------------------------------------------------------------------------
// Phase 1 — 分层分批骨架提取
// ---------------------------------------------------------------------------

const SCENE_HIERARCHY_PROMPT = `## 地图场景层级

地图场景层级:
  第一层地图：宏观大地图（第0、1层）
  第二层地图：室外地图（第2、3层）
  第三层地图：室内地图（第4、5层）

详情场景层级:
  第0层 – 世界: 根节点，游戏宏观世界。通常只有一个实例。
  第1层 – 区域: 世界内的主要地理板块或势力范围。
  第2层 – 地域: 区域内可行走的广域地形或城市全景。
  第3层 – 地标点: 一栋可进入的完整建筑，加载室内地图的触发点。
  第4层 – 室内: 建筑内部的独立室内空间。
  第5层 – 物品: 室内外场景内的家具或设施。

## UID 编号规则
0-3层每层占2位，4-5层每层占4位，每层从0开始编号，用"-"隔开。
第0层根节点 "0"，第1层第1个节点 "0-0"，该节点的第2个子节点（第2层）"0-0-1"。`;

const PHASE1_SYSTEM = `你是游戏场景设计专家。请从给定的故事节点文本中提取所有出现的具名地理场景。所有输出使用中文。

${SCENE_HIERARCHY_PROMPT}

## 要求
- 从故事文本中提取**所有出现的具名地理场景**，自行判断层级（不限定只提取某些层级）
- name：纯中文，禁止空格、-、_、括号等特殊字符
- parent：父节点 name，根节点留空
- label：场景标签数组，可选值 "narrative"/"decoration"/"path"/"entrance"
- description：结构化三维描述对象`;

const PHASE1_OUTPUT = `输出JSON：
{
  "scenes": [
    {
      "name": "场景名",
      "parent": "父场景名或空",
      "label": ["narrative"],
      "description": {
        "location_description": "空间位置与功能描述",
        "art_style_description": "美术风格与氛围描述",
        "semantics_description": "叙事语义功能描述"
      },
      "level": 0
    }
  ]
}`;

const PHASE1_INCREMENTAL_SYSTEM = `你是游戏场景设计专家。基于已有的场景骨架，从新的故事节点文本中提取**新增**的具名地理场景。所有输出使用中文。

${SCENE_HIERARCHY_PROMPT}

## 要求
- 已有骨架中的场景**不要重复输出**，只输出新增的场景节点
- 新增场景的 parent 可以引用已有骨架中的场景名
- 如果故事文本中提到的场景已存在于骨架中，则跳过不输出
- name：纯中文，禁止空格、-、_、括号等特殊字符
- label：场景标签数组，可选值 "narrative"/"decoration"/"path"/"entrance"
- description：结构化三维描述对象

输出JSON：
{
  "scenes": [
    {
      "name": "场景名",
      "parent": "父场景名或空（可引用已有骨架中的场景名）",
      "label": ["narrative"],
      "description": {
        "location_description": "空间位置与功能描述",
        "art_style_description": "美术风格与氛围描述",
        "semantics_description": "叙事语义功能描述"
      },
      "level": 0
    }
  ]
}`;

export const SCENE_SKELETON_COMPOSER: PromptComposer = {
  stepId: "scene_generation",
  blocks: {
    cot: `## 机制与流程
1. 从剧情节点反推需要哪些物理空间——先有戏，再有场景，不要先铺地图。
2. 为每个场景设计氛围基调、关键交互点、环境叙事埋点三层。
3. 规划场景之间的连接与玩家动线，让空间关系本身就能提示"下一步该去哪"。
4. 自检：每个场景是否都有叙事价值？埋点是否自然（玩家会主动发现，而非被提示牌指着看）？`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    base: PHASE1_SYSTEM,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output: PHASE1_OUTPUT,
  },
  systemBlockOrder: ["base", "ip_dna", "style_guide", "constraints", "cot", "ip_source", "output"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

const SCENE_SKELETON_INCREMENTAL_COMPOSER: PromptComposer = {
  stepId: "scene_generation",
  blocks: {
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    base: PHASE1_INCREMENTAL_SYSTEM,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "ip_dna", "style_guide", "constraints", "ip_source"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

// SCENE_EXPAND_COMPOSER defined after PHASE2_UNIT_SYSTEM below

function buildPhase1BatchPrompt(
  nodes: Array<{ node_id: string; name: string; content: string }>,
  ctx: NarrativeContext,
  layerLabel: string,
): string {
  const nodesSummary = nodes.map(n =>
    `### 节点 ${n.node_id}: ${n.name}\n${n.content}`,
  ).join("\n\n");

  return `## 世界观设定
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 核心设定
- 世界名称：${ctx.core_settings?.world_name ?? "未命名世界"}

## ${layerLabel} 故事节点（请从中提取场景）
${nodesSummary}
${buildDesignContextSnippet(ctx)}
请提取这些故事节点中出现的所有场景。`;
}

function buildPhase1IncrementalPrompt(
  nodes: Array<{ node_id: string; name: string; content: string }>,
  existingSkeleton: Array<{ name: string; parent: string; level: number }>,
  ctx: NarrativeContext,
  layerLabel: string,
): string {
  const nodesSummary = nodes.map(n =>
    `### 节点 ${n.node_id}: ${n.name}\n${n.content}`,
  ).join("\n\n");

  const skeletonJson = JSON.stringify(existingSkeleton, null, 2);

  return `## 世界观设定
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 核心设定
- 世界名称：${ctx.core_settings?.world_name ?? "未命名世界"}

## 已有场景骨架（不要重复输出这些场景）
${skeletonJson}

## ${layerLabel} 故事节点（请从中提取新增场景）
${nodesSummary}
${buildDesignContextSnippet(ctx)}
请从这些故事节点中提取骨架中尚不存在的新增场景。`;
}

function toCompactSkeleton(
  scenes: SkeletonScene[],
): Array<{ name: string; parent: string; level: number }> {
  return scenes.map(s => ({ name: s.name, parent: s.parent ?? "", level: s.level ?? 0 }));
}

async function extractScenesFromBatch(
  nodes: Array<{ node_id: string; name: string; content: string }>,
  ctx: NarrativeContext,
  llm: LLMClient,
  layerLabel: string,
  existingSkeleton?: Array<{ name: string; parent: string; level: number }>,
): Promise<SkeletonScene[]> {
  const isIncremental = existingSkeleton && existingSkeleton.length > 0;
  const composer = isIncremental ? SCENE_SKELETON_INCREMENTAL_COMPOSER : SCENE_SKELETON_COMPOSER;
  const userPrompt = isIncremental
    ? buildPhase1IncrementalPrompt(nodes, existingSkeleton, ctx, layerLabel)
    : buildPhase1BatchPrompt(nodes, ctx, layerLabel);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(composer, ctx),
    appendUserInstructions(userPrompt, ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<Record<string, unknown>>(r);
      if (!Array.isArray(p.scenes)) throw new Error("scenes必须是数组");
    },
  );

  const parsed = extractJSON<{ scenes: SkeletonScene[] }>(raw);
  return parsed.scenes;
}

// ---------------------------------------------------------------------------
// Phase 2 — 按节点展开 L3-L5 (quest-aware)
// ---------------------------------------------------------------------------

const PHASE2_UNIT_SYSTEM = `你是游戏场景设计专家。请基于已有的场景骨架，为指定的故事节点展开场景。所有输出使用中文。

${SCENE_HIERARCHY_PROMPT}

## 规则
1. 在已有骨架上扩展——可新增任意层级的子节点
2. L3 地标：该故事单元发生的核心场所 1-3 个
3. L4 房间：仅对剧情关键地标展开 1-2 个
4. L5 物品：仅在有剧情交互需求时添加
5. 每个场景的 parent 必须是已有的上层场景名
6. story_units 填入关联的故事节点 node_id
7. name：纯中文，禁止特殊字符
8. description：结构化三维描述对象`;

const PHASE2_UNIT_OUTPUT = `输出JSON：
{
  "expanded_scenes": [
    {
      "name": "场景名",
      "parent": "父场景名",
      "label": ["narrative"],
      "description": {
        "location_description": "空间位置与功能",
        "art_style_description": "美术风格",
        "semantics_description": "叙事语义"
      },
      "level": 3,
      "story_units": ["node_id"]
    }
  ]
}`;

export const SCENE_EXPAND_COMPOSER: PromptComposer = {
  stepId: "scene_generation",
  blocks: {
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    base: PHASE2_UNIT_SYSTEM,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output: PHASE2_UNIT_OUTPUT,
  },
  systemBlockOrder: ["base", "ip_dna", "style_guide", "constraints", "ip_source", "output"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildUnitPhase2Prompt(
  plot: PlotNode,
  skeletonScenes: SkeletonScene[],
  script?: { title: string; scenes: Array<{ location: string; atmosphere: string }> },
  questInfo?: { name: string; objectives: string },
): string {
  const skeleton = JSON.stringify(
    skeletonScenes.map(s => ({ name: s.name, parent: s.parent, level: s.level })),
    null, 2,
  );
  const unit: Record<string, unknown> = {
    node_id: plot.node_id,
    content: plot.content,
    scene_location: plot.jrpg_elements?.scene_location ?? "",
    scene_locations: plot.jrpg_elements?.scene_locations ?? [],
    scene_characters: plot.jrpg_elements?.scene_characters ?? [],
  };
  if (script) {
    unit.script_title = script.title;
    unit.script_scenes = script.scenes;
  }
  if (questInfo) {
    unit.quest_name = questInfo.name;
    unit.quest_objectives = questInfo.objectives;
  }

  return `## 已有场景骨架
${skeleton}

## 当前故事单元
${JSON.stringify(unit, null, 2)}

请为这个故事单元展开场景。`;
}

export async function processSceneUnit(
  plot: PlotNode,
  skeletonScenes: SkeletonScene[],
  llm: LLMClient,
  ctx: NarrativeContext,
  script?: { title: string; scenes: Array<{ location: string; atmosphere: string }> },
  questInfo?: { name: string; objectives: string },
): Promise<RawExpandedScene[]> {
  const raw = await llm.callWithRetry(
    composeSystemPrompt(SCENE_EXPAND_COMPOSER, ctx),
    buildUnitPhase2Prompt(plot, skeletonScenes, script, questInfo),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<Record<string, unknown>>(r);
      if (!Array.isArray(p.expanded_scenes))
        throw new Error("expanded_scenes必须是数组");
    },
  );

  const expanded = extractJSON<{ expanded_scenes: RawExpandedScene[] }>(raw);
  return expanded.expanded_scenes.map(s => ({
    name: s.name ?? "",
    parent: s.parent ?? "",
    label: s.label,
    description: s.description,
    level: s.level ?? 3,
    story_units: s.story_units ?? [plot.node_id],
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main entry: full scene generation pipeline
// ---------------------------------------------------------------------------

export async function sceneGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const saveNode = (ctx as Record<string, unknown>)._saveNode as
    ((stepId: string, nodeId: string, data: unknown) => void) | undefined;

  const worldName = ctx.core_settings?.world_name ?? "游戏世界";

  // ── Phase 1: 分层分批骨架提取 ──
  console.log("[Scene P1] 开始分层分批骨架提取...");

  // L0 → L1 → L2 串行增量提取，每层以前一层骨架为锚定
  const fwNodes = (ctx.story_framework?.framework.nodes ?? []).map(n => ({
    node_id: n.node_id, name: n.name, content: n.main_content,
  }));
  const olNodes = (ctx.outlines_generated?.outlines ?? []).map(n => ({
    node_id: n.node_id, name: n.name, content: n.content,
  }));
  const doNodes = (ctx.detailed_outlines_generated?.detailed_outlines ?? []).map(n => ({
    node_id: n.node_id, name: n.name, content: n.content,
  }));

  async function extractLayerIncremental(
    nodes: { node_id: string; name: string; content: string }[],
    existingSkeleton: Array<{ name: string; parent: string; level: number }>,
    prefix: string, layerLabel: string,
    batchSize: number,
  ): Promise<SkeletonScene[]> {
    if (nodes.length === 0) return [];
    const batches = chunkArray(nodes, batchSize);
    const tasks: ParallelTask<SkeletonScene[]>[] = batches.map((batch, i) => ({
      id: `${prefix}_batch_${i}`,
      sequenceIndex: i,
      run: async () => {
        const skeleton = existingSkeleton.length > 0 ? existingSkeleton : undefined;
        const scenes = await extractScenesFromBatch(batch, ctx, llm, layerLabel, skeleton);
        for (const n of batch) {
          saveNode?.("scene_generation", `skeleton_${prefix}_${n.node_id}`, scenes);
        }
        return scenes;
      },
    }));
    const results = await runParallel(tasks, 6);
    const out: SkeletonScene[] = [];
    for (const r of results) if (r.result) out.push(...r.result);
    console.log(`[Scene P1] ${layerLabel}: 提取 ${out.length} 个场景`);
    return out;
  }

  // L0: 一次性提取全部 framework 节点 (~20K tokens input)
  const l0Scenes = await extractLayerIncremental(fwNodes, [], "fw", "L0框架", fwNodes.length || 8);

  // L1: 每批 ~12 个 outline 节点 + L0 骨架作为锚定 (~26K tokens/call)
  const l0Skeleton = toCompactSkeleton(l0Scenes);
  const l1Scenes = await extractLayerIncremental(olNodes, l0Skeleton, "ol", "L1大纲", 12);

  // L2: 每批 ~5 个 detailed_outline 节点 + L0+L1 骨架作为锚定 (~26K tokens/call)
  const l01Skeleton = toCompactSkeleton([...l0Scenes, ...l1Scenes]);
  const l2Scenes = await extractLayerIncremental(doNodes, l01Skeleton, "do", "L2细纲", 5);

  let allSkeletonScenes = [...l0Scenes, ...l1Scenes, ...l2Scenes];

  if (allSkeletonScenes.length === 0 && ctx.worldview_structure) {
    console.log("[Scene P1] L0/L1/L2 为空，使用世界观驱动 fallback 生成场景骨架");
    const wvSummary = JSON.stringify(ctx.worldview_structure, null, 2).slice(0, 3000);
    const charSummary = (ctx.detailed_character_sheets ?? [])
      .map(c => `${c.name}: ${c.role_in_story ?? c.label ?? ""}`)
      .join("; ");
    const itemSummary = (ctx.item_database ?? [])
      .slice(0, 10)
      .map(it => `${(it as unknown as Record<string, unknown>).name ?? ""}`)
      .join(", ");
    const fallbackPrompt = `## 世界观设定\n${wvSummary}\n\n## 角色\n${charSummary || "（无）"}\n\n## 道具\n${itemSummary || "（无）"}\n\n请基于世界观、角色活动场所和道具出现地点，提取该世界的主要场景层级结构。`;
    const fbRaw = await llm.callWithRetry(
      composeSystemPrompt(SCENE_SKELETON_COMPOSER, ctx),
      appendUserInstructions(fallbackPrompt, ctx),
      { responseFormat: "json" },
      (r) => { const p = extractJSON<{ scenes: unknown[] }>(r); if (!Array.isArray(p.scenes)) throw new Error("需要 scenes 数组"); },
    );
    const fbParsed = extractJSON<{ scenes: SkeletonScene[] }>(fbRaw);
    allSkeletonScenes = (fbParsed.scenes ?? []).map(s => ({
      name: s.name, parent: s.parent ?? "", level: s.level ?? 2,
      label: s.label, description: s.description,
    }));
    console.log(`[Scene P1 fallback] 世界观驱动生成 ${allSkeletonScenes.length} 个场景`);
  }

  // P1 骨架合并
  const skeletonRaw = skeletonToRaw(allSkeletonScenes);
  saveNode?.("scene_generation", "skeleton_merged", allSkeletonScenes);
  console.log(`[Scene P1] 骨架提取完成，共 ${allSkeletonScenes.length} 个原始场景`);

  // ── Phase 2: 按节点展开 (监控任务完成状态) ──
  console.log("[Scene P2] 开始按节点展开...");
  const allPlots = ctx.plots_generated?.plots ?? [];
  const sceneNodeFilter = getNodeFilter(ctx);
  const plots = sceneNodeFilter
    ? allPlots.filter(p => sceneNodeFilter.has(p.node_id))
    : allPlots;

  const scriptMap = new Map<string, { title: string; scenes: Array<{ location: string; atmosphere: string }> }>();
  if (ctx.jrpg_script?.chapters) {
    for (const ch of ctx.jrpg_script.chapters) {
      scriptMap.set(ch.plot_node_id, {
        title: ch.title,
        scenes: ch.scenes.map(s => ({ location: s.location ?? "", atmosphere: s.atmosphere ?? "" })),
      });
    }
  }

  const questCompletedNodes = (ctx as Record<string, unknown>)._questCompletedNodes as Set<string> | undefined;

  const allExpandedResults: Array<{ id: string; result: RawExpandedScene[] }> = [];

  if (questCompletedNodes) {
    // Producer-consumer: wait for quest batches of 6
    const processedNodes = new Set<string>();
    const plotMap = new Map(plots.map(p => [p.node_id, p]));
    const pendingPlotIds = new Set(plots.map(p => p.node_id));
    const questGraph = ctx.quest_graph;

    while (pendingPlotIds.size > 0) {
      // Collect nodes whose quests are complete
      const ready: PlotNode[] = [];
      for (const nodeId of pendingPlotIds) {
        if (questCompletedNodes.has(nodeId) && !processedNodes.has(nodeId)) {
          ready.push(plotMap.get(nodeId)!);
        }
      }

      if (ready.length >= 6 || (ready.length > 0 && ready.length === pendingPlotIds.size)) {
        const batch = ready.slice(0, 6);
        const tasks: ParallelTask<RawExpandedScene[]>[] = batch.map((plot, i) => {
          const questData = questGraph?.quests.filter(q => q.story_node_id === plot.node_id);
          const questInfo = questData && questData.length > 0
            ? { name: questData.map(q => q.name).join(", "), objectives: questData.flatMap(q => q.objectives.map(o => o.description)).join("; ") }
            : undefined;
          return {
            id: plot.node_id,
            sequenceIndex: i,
            run: async () => {
              const result = await processSceneUnit(plot, allSkeletonScenes, llm, ctx, scriptMap.get(plot.node_id), questInfo);
              saveNode?.("scene_generation", `${plot.node_id}_场景`, result);
              return result;
            },
          };
        });

        const batchResults = await runParallel(tasks, 6);
        for (const r of batchResults) {
          if (r.result) allExpandedResults.push({ id: r.id, result: r.result });
          processedNodes.add(r.id);
          pendingPlotIds.delete(r.id);
        }
        console.log(`[Scene P2] 批次完成: ${batch.map(p => p.node_id).join(",")}`);
      } else {
        await sleep(2000);
      }
    }
  } else {
    // No quest monitoring — process all plots directly in batches
    const plotBatches = chunkArray(plots, 6);
    for (const batch of plotBatches) {
      const tasks: ParallelTask<RawExpandedScene[]>[] = batch.map((plot, i) => ({
        id: plot.node_id,
        sequenceIndex: i,
        run: async () => {
          const result = await processSceneUnit(plot, allSkeletonScenes, llm, ctx, scriptMap.get(plot.node_id));
          saveNode?.("scene_generation", `${plot.node_id}_场景`, result);
          return result;
        },
      }));
      const batchResults = await runParallel(tasks, 6);
      for (const r of batchResults) {
        if (r.result) allExpandedResults.push({ id: r.id, result: r.result });
      }
    }
  }

  console.log(`[Scene P2] 展开完成，共 ${allExpandedResults.length} 个节点`);

  // ── Phase 3: 算法合并 ──
  console.log("[Scene P3] 开始算法合并...");
  const expandedBatches = allExpandedResults.map((r, i) => expandedToRaw(r.result, i));
  const { scenes: mergedScenes, structureMd, uidMap } = aggregateScenes(worldName, skeletonRaw, expandedBatches);

  const lookupUid = (name: string): string => uidMap.get(name) ?? "";

  // Build per-node data for intermediate snapshots
  const phase2PerNode: Record<string, RawExpandedScene[]> = {};
  const phase2PerNodeMd: Record<string, string> = {};
  for (const result of allExpandedResults) {
    phase2PerNode[result.id] = result.result;
    phase2PerNodeMd[result.id] = buildPerNodeMd(
      result.result.map((s, idx) => ({
        uid: lookupUid(s.name ?? "") || `tmp_${idx}`,
        name: s.name ?? "",
        parent: s.parent ?? "",
        parent_uid: null,
        parent_name: null,
        parent_level: null,
        scene_level: s.level ?? 3,
        label: ["narrative" as const],
        description: { location_description: "", art_style_description: "", semantics_description: "" },
        story_units: s.story_units,
      })),
    );
  }

  // Save merged results
  saveNode?.("scene_generation", "merged_场景", mergedScenes);

  ctx.scene_map = {
    world_name: worldName,
    scenes: mergedScenes,
    _phase1_skeleton: skeletonRaw.map(s => ({
      uid: lookupUid(s.name), name: s.name, parent: s.parent,
      parent_uid: null, parent_name: null, parent_level: null,
      scene_level: s.scene_level ?? 0, label: s.label,
      description: s.description, level: s.scene_level ?? 0,
    })),
    _phase1_by_layer: {
      l0: l0Scenes.map(s => ({ name: s.name, parent: s.parent, level: s.level, label: s.label, description: s.description })),
      l1: l1Scenes.map(s => ({ name: s.name, parent: s.parent, level: s.level, label: s.label, description: s.description })),
      l2: l2Scenes.map(s => ({ name: s.name, parent: s.parent, level: s.level, label: s.label, description: s.description })),
    },
    _phase2_per_node: Object.fromEntries(
      Object.entries(phase2PerNode).map(([k, v]) => [k, v.map(s => ({
        uid: lookupUid(s.name ?? ""), name: s.name ?? "", parent: s.parent ?? "",
        parent_uid: null, parent_name: null, parent_level: null,
        scene_level: s.level ?? 3, label: ["narrative" as const],
        description: typeof s.description === "object" && s.description !== null
          ? s.description as { location_description: string; art_style_description: string; semantics_description: string }
          : { location_description: String(s.description ?? ""), art_style_description: "", semantics_description: "" },
        story_units: s.story_units, level: s.level ?? 3,
      }))]),
    ),
    _phase2_per_node_md: phase2PerNodeMd,
    _scene_structure_md: structureMd,
  };

  console.log(`[Scene P3] 场景生成完成，最终 ${mergedScenes.length} 个场景`);
}
