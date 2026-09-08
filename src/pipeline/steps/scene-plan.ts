/**
 * scene-plan.ts —— 场景列表席（2.3.6）的前向规划实现
 *
 * 这一席的语义是 **create**：从世界观推演"这个世界该有哪些地方"，产出层级化场景树。
 * 它跑在剧情之前，因此手上只有设定层材料，不可能、也不该等剧情写完。
 *
 * 与被归档的 `scene_generation` 的关系（见 `_archive/scene/README.md`）：
 * 旧实现名义上挂在这一席，实现体却是 **reconcile**——读 story_framework / outlines /
 * detailed_outlines / plots / script / quest_graph，从已写好的剧情里倒推场景。而默认步序里
 * 它跑在 story_framework 之前，于是每次真跑都落到那段 worldview fallback，三阶段提炼在
 * 生产路径上一次也没执行过。方向错位造出的死代码，不是靠调顺序能修的：一席不能同时是
 * "从设定推演"和"从成文回收"。
 *
 * 所以拆成两半：前向这半正式化为本文件（fallback 提示词升格为唯一实现路径）；后向那半
 * 迁进内容检查席的场景取证子步（scene-evidence.ts），在那里它的输入天然齐备。
 *
 * 刻意不读角色/道具：本席与角色档案、道具清单同属前置并行组，读它们就得串行。
 * "谁住在哪、道具出现在哪"这类交叉一致性交给内容检查席的场景判据事后校对。
 */
import type { NarrativeContext, SceneMap } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, appendUserInstructions, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";
import { inputPriorityChain, conceptFieldMapping, preOutputChecklist } from "../prompt/structural-clarity.js";
import { aggregateScenes, skeletonToRaw } from "../graph/scene-aggregator.js";

/** 层级定义与 UID 规则：算法侧（scene-aggregator）与提示词侧必须说同一套话。 */
export const SCENE_HIERARCHY_PROMPT = `## 地图场景层级

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
第0层根节点 "0"，第1层第1个节点 "0-0"，该节点的第2个子节点（第2层）"0-0-1"。
（UID 由后处理算法统一分配，你只需给出 name / parent / level 的树形关系。）`;

const SCENE_PLAN_SYSTEM = `你是游戏场景设计专家。请依据世界观设定，规划这个世界的层级化场景树。所有输出使用中文。

${SCENE_HIERARCHY_PROMPT}

## 要求
- 自世界根节点向下规划，覆盖世界观点名过的地理板块、势力驻地与标志性地点
- 每个场景必须能说出它在故事里可能承担什么（战斗、交涉、休整、揭示信息……），只为填满地图而造的地点不要写
- name：纯中文，禁止空格、-、_、括号等特殊字符
- parent：父节点 name，第0层根节点留空
- label：场景标签数组，可选值 "narrative"/"decoration"/"path"/"entrance"
- description：结构化三维描述对象（空间位置与功能 / 美术风格与氛围 / 叙事语义功能）
- 规模自洽：第1层区域 2-5 个，每个区域下第2层 2-4 个，重要地点再往下展开室内与物品；
  不必对每个分支都挖到第5层，只在有交互价值处深入`;

const SCENE_PLAN_OUTPUT = `输出JSON：
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

export const SCENE_PLAN_COMPOSER: PromptComposer = {
  stepId: "scene_plan",
  blocks: {
    cot: `## 机制与流程
1. 先读世界观的地理/势力/历史脉络，列出被点名过的地方——它们是场景树的硬骨架。
2. 再补必要的连接与承载空间：从A到B要经过哪里，日常起居与关键对峙分别发生在哪。
3. 自上而下定层级：先world→区域→地域，再对有戏的地标向下展开室内与物品。
4. 自检：每个场景能否说出叙事价值？父子关系是否物理自洽（室内不能是世界的直接子节点）？`,
    priority_chain: inputPriorityChain([
      "世界观设定的地理/势力/历史原文——地名与归属以它为准，不得改写或另起名字",
      "核心设定（世界名称、题材基调）——决定根节点名与整体风格",
      "用户原始需求与需求清单里点名的地点——必须出现在树里",
      "品类守则与结构策略（skill 槽位）——决定规模与展开偏好，与上面冲突时让位",
    ]),
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    base: SCENE_PLAN_SYSTEM,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    concept_mapping: conceptFieldMapping([
      { concept: "场景在故事里承担什么", field: "description.semantics_description" },
      { concept: "美术风格与氛围", field: "description.art_style_description" },
      { concept: "空间位置与功能", field: "description.location_description" },
      { concept: "所属层级（世界/区域/地域/地标/室内/物品）", field: "level（0-5 整数）" },
      { concept: "上下级归属", field: "parent（父场景 name，根节点留空）" },
    ]),
    self_check: preOutputChecklist([
      "有且只有一个 level=0 的根节点，且其 parent 为空",
      "每个非根场景的 parent 都能在本次输出的 scenes 里找到同名节点",
      "每个场景的 level 比它 parent 的 level 大 1（不跳级）",
      "name 里没有空格、连字符、下划线、括号",
      "世界观点名过的主要地点都出现在树里，没有凭空新增与世界观冲突的地名",
    ]),
    output: SCENE_PLAN_OUTPUT,
  },
  systemBlockOrder: [
    "base", "ip_dna", "style_guide", "constraints",
    "cot", "priority_chain", "ip_source", "concept_mapping", "self_check", "output",
  ],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

interface PlannedScene {
  name: string;
  parent?: string;
  level?: number;
  label?: unknown;
  description?: unknown;
}

function buildScenePlanPrompt(ctx: NarrativeContext): string {
  const worldview = ctx.worldview_structure
    ? JSON.stringify(ctx.worldview_structure, null, 2).slice(0, 6000)
    : "（无——只依据下面的用户需求推演，不要假装读到过世界观）";

  return `## 世界观设定
${worldview}

## 核心设定
- 世界名称：${ctx.core_settings?.world_name ?? "未命名世界"}
- 题材基调：${ctx.core_settings?.genre ?? "（未指定）"}

## 用户原始需求
${ctx.user_input ?? "（无）"}
${buildDesignContextSnippet(ctx)}
请规划该世界的层级化场景树。`;
}

/**
 * 前向场景规划：一次 LLM 调用出树，随后交给确定性聚合器补全 UID 与结构 MD。
 *
 * 聚合器是从旧实现 Phase3 原样吸收的——去重、父引用修复、层级推断、深度裁剪、
 * UID 分配这些都是纯算法，与"场景从哪来"无关，因此前向后向都该共用同一份。
 */
export async function scenePlan(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const worldName = ctx.core_settings?.world_name ?? "游戏世界";

  const raw = await llm.callWithRetry(
    composeSystemPrompt(SCENE_PLAN_COMPOSER, ctx),
    appendUserInstructions(buildScenePlanPrompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<Record<string, unknown>>(r);
      if (!Array.isArray(p.scenes) || p.scenes.length === 0) {
        throw new Error("scenes 必须是非空数组");
      }
    },
  );

  const parsed = extractJSON<{ scenes: PlannedScene[] }>(raw);
  const planned = (parsed.scenes ?? []).filter((s) => !!s.name);

  const { scenes, structureMd } = aggregateScenes(
    worldName,
    skeletonToRaw(planned.map((s) => ({
      name: s.name,
      parent: s.parent ?? "",
      level: s.level ?? 0,
      label: s.label,
      description: s.description,
    }))),
    [],
  );

  const sceneMap: SceneMap = {
    world_name: worldName,
    scenes,
    _scene_structure_md: structureMd,
  };
  ctx.scene_map = sceneMap;

  const saveNode = (ctx as Record<string, unknown>)._saveNode as
    ((stepId: string, nodeId: string, data: unknown) => void) | undefined;
  saveNode?.("scene_plan", "scene_tree", scenes);

  console.log(`[ScenePlan] 前向规划完成，${scenes.length} 个场景`);
}
