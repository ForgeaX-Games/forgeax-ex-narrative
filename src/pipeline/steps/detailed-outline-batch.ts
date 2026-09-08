/**
 * L2 细纲生成（DetailedOutlineBatchAgent）
 *
 * 三步走机制（继承自 v3）：
 *   Step1: LLM 规划结构 + 代码构建骨架 + 跨父连接
 *   Step1.5: 按 L1 父节点分组，每组独立 LLM 调用填充内容
 *   Step2: 全局内容补充（补充 Step1.5 遗漏或不足的节点）
 *
 * 设计哲学：
 * - 命运必然论：L0 预设所有命运分支和结局，L2 在大纲框架内细化，不创造新结局
 * - 有限突变论：L2 可产生新分支（Y轴），但必须聚合或路由到上层预设分支
 * - 双维度展开：X轴=顺序细化 / Y轴=可能性分支
 * - 与 L1 对称的通用细化机制
 * - 为 L3 提供三重约束信息（boundary/scope/validation）
 * - 反套路偏差指导（正偏差→意外/升华 / 负偏差→颠覆解构 / 中性→经典叙事）
 */
import type {
  NarrativeContext,
  DetailedOutlinesGenerated,
  DetailedOutlineNode,
} from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { appendUserInstructions, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, STRATEGY_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";
import {
  buildCharacterDigest,
  buildItemDigest,
  buildStoryArcDigest,
  buildAdjacentGroupDigest,
} from "./context-helpers.js";
import { getNodeFilter } from "../graph/node-merge.js";
import { markStepSkipped } from "../core/step-skip.js";
import { structureValidationL2 } from "./structure-validation.js";
import {
  repairIntraGroupConnections,
  inferCrossParentConnections,
  filterCrossBranchConnections,
  ensureBidirectionalConsistency,
  fixDanglingBranches,
  fixNvNRouting,
} from "../../utils/connection-repair.js";
import {
  getEntropy,
  getLayerEntropy,
  buildBranchPromptSection,
  buildDeviationPrompt,
  buildNodeCountPromptSection,
  enforceBranchInPlan,
  clampChildCount,
  getNodeBudget,
  getTargetBranchRatio,
  getMergeTendency,
  type StructurePlanItem,
} from "../runtime/layer-threshold-config.js";
import { deviationFromLegacy } from "../../types/index.js";
import {
  deriveTreeFields,
  mergeTreeSemantics,
  treeSemanticsPromptSpec,
  type TreeSemantics,
} from "../graph/outline-tree.js";
import { expansionPrinciples, TOPOLOGY_DISCIPLINE } from "../prompt/narrative-craft.js";
import { inputPriorityChain, modeDispatchSource, conceptFieldMapping, preOutputChecklist } from "../prompt/structural-clarity.js";

// ─── Step 1: 结构规划 ───

interface DetailPlan {
  parent_id: string;
  detail_count: number;
  branch_count: number;
  branch_position?: number;
  should_merge?: boolean;
  narrative_stage?: string;
  /** @deprecated backward compat */
  has_branch?: boolean;
}

const DETAIL_PRINCIPLES = expansionPrinciples({
  upstream: "上游的大纲层",
  here: "本层",
  convergence: "新分岔必须聚合回来，或路由到上游已有的分支上",
});

const STEP1_SYSTEM = `你是叙事结构规划师。读上游的大纲节点，为每个节点规划它要再细分成几个节点、在哪里分岔。所有输出使用中文。`;

export const DETAIL_PLAN_COMPOSER: PromptComposer = {
  stepId: "detailed_outline",
  blocks: {
    cot: `## 机制与流程
本席继续加密剧情树：把上游节点再分出更细的节点，把树补到情节席可以直接落笔的粒度。
仍然只定**功能、内容与位置关系**，不写正文。

1. 读上游节点，判断它需要展开成几个子节点才能把过程讲清楚。
2. 为每个子节点定下目标 / 冲突障碍 / 转折点 / 出场状态，四者缺一则该节点没有戏剧价值。
3. 沿用五种功能位（起始 / 分支 / 聚合 / 结局 / 普通）标注新节点；新增的分支、聚合、
   结局同样要给出条件，不要只在粗粒度那层写了条件、细化后就断档。
4. 检查相邻节点之间的情感连贯与信息揭示节奏——不要把线索一次性倒完。
5. 自检：是否每个节点都值得单独存在？有没有内容重复、可以合并的冗余节点？
   细化后的树是否仍与上游给定的形态一致（没有把线性形态偷偷加出分支）？`,
    // F3：四项结构性缺口，见 structural-clarity.ts 文件头。本席材料换成 L2 规划阶段实际吃到的那一批，
    // 与 L1（outline-batch.ts）同构，仅把"上游宏观框架节点"换成"上游大纲节点"。
    priority_chain: inputPriorityChain([
      "用户需求——本层规划的最高约束",
      "上游大纲节点（L1 的 name/narrative_stage/content）——本层只在它给定的节点范围内再细分，" +
        "不能改写该节点已确立的叙事阶段与内容边界",
      "节点数量/分支密度区间（由复杂度与熵值算出）——形式调控，不裁决具体是什么内容",
      "初步大纲——跨层背景参考，与上面三条冲突时让位",
    ]),
    mode_source: modeDispatchSource([
      "每个上游节点最终细分成几个 L2 子节点、有没有分支，最终会被下方节点数量区间收敛——" +
        "超出区间的部分会被裁剪，不代表判断错，只代表形式区间优先",
      "新增的分支是否合法，唯一取决于它能不能聚合回上游已有的分支或结局（有限突变论），" +
        "不能自行判断「这条新分支足够精彩所以可以不聚合」",
    ]),
    concept_mapping: conceptFieldMapping([
      { concept: "节点功能位（起始/分支/聚合/结局/普通）",
        field: "本阶段不直接输出——由下游 outline-tree.deriveTreeFields 从 branch_count/branch_position/" +
          "should_merge 推导，这里给对结构参数就够" },
      { concept: "目标 / 冲突障碍 / 转折点 / 出场状态（本层每个子节点必备的四要素）",
        field: "本阶段的规划 JSON 不单独开字段——四要素在 Step1.5 内容填充阶段落进 content 正文与" +
          "story_elements.plot（cause/process/result），规划阶段只需保证节点数量与分支足够铺开它们" },
    ]),
    self_check: preOutputChecklist([
      "每个上游大纲节点都有对应的规划条目（detail_count/branch_count），没有遗漏",
      "branch_count ≥ 2 的条目都给了 branch_position",
      "新增分支是否都有 should_merge 或明确路由到上游已有分支/结局，没有留下无法收束的死支",
      "detail_count/branch_count 是否落在节点数量区间提示给出的范围内",
    ]),
    base: STEP1_SYSTEM,
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    craft: TOPOLOGY_DISCIPLINE,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: [
    "base", "strategy", "ip_dna", "craft", "style_guide", "constraints",
    "cot", "priority_chain", "mode_source", "concept_mapping", "self_check",
  ],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

export const DETAIL_FILL_COMPOSER: PromptComposer = {
  stepId: "detailed_outline",
  blocks: {
    base: "你是叙事结构设计师。",
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    craft: TOPOLOGY_DISCIPLINE,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    // F3：四项结构性缺口，材料换成 Step1.5 按 L1 父节点分组填充时实际吃到的那一批。
    priority_chain: inputPriorityChain([
      "本组节点所属的大纲节点（名称/叙事阶段/内容）——本组节点必须在它的范围内展开，不越界引入新事件",
      "用户原始需求",
      "世界观 / 角色档案摘要 / 道具清单——既定事实，不得抵触",
      "节点骨架（prev/next/分支/合并点标注）——图结构已经钉死，内容不能暗示与骨架矛盾的走向",
      "整体故事弧 / 相邻章节概要——背景参考，与上面四条冲突时让位",
    ]),
    mode_source: modeDispatchSource([
      "节点是分支节点还是合并点，唯一由「节点骨架」描述里的 (分支)/(合并点) 标注决定，不要通过内容" +
        "语义再猜一遍",
      "该用「正偏差」还是「负偏差」还是「中性」的处理方式，唯一由下方「反套路偏差指导」小节给出的" +
        "偏差值决定，不要凭内容感觉自选一种风格",
    ]),
    concept_mapping: conceptFieldMapping([
      { concept: "目标 / 冲突障碍 / 转折点 / 出场状态（四要素）",
        field: "content 正文 + story_elements.plot.{cause, process, result}，没有更细的独立字段" },
      { concept: "对白风格 / 独白方向 / 旁白语气 / 氛围（供下游 L3 情节席取用的写法提示）",
        field: "story_elements.{dialogue_hint, monologue_hint, narration_hint, atmosphere}——这些是" +
          "提示不是正文，本层的 content 仍要写完整叙事内容，不能只写这四个提示了事" },
    ]),
    self_check: preOutputChecklist([
      "是否为骨架给出的全部 node_id 都生成了内容，一个不漏",
      "content 是否 ≥300 字",
      "dialogue_hint/monologue_hint/narration_hint/atmosphere 四项是否都填了，不是留空指望下游自己猜",
      "合并点节点的 content 是否写的是「殊途同归」的共同事实",
    ]),
  },
  systemBlockOrder: [
    "base", "strategy", "ip_dna", "craft", "style_guide", "constraints",
    "priority_chain", "mode_source", "concept_mapping", "self_check",
  ],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildStep1Prompt(ctx: NarrativeContext): string {
  const outlines = ctx.outlines_generated?.outlines ?? [];
  const olDesc = outlines.map(o =>
    `- [${o.node_id}] ${o.name}（${o.narrative_stage}）: ${o.content}`
  ).join("\n");

  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l2Ctrl = gcp?.layer_controls?.layer_2;
  const layerEntropy = getLayerEntropy(entropy, 2, l2Ctrl);
  const deviation = deviationFromLegacy(gcp);

  const branchSection = buildBranchPromptSection(2, complexity, layerEntropy);
  const deviationSection = buildDeviationPrompt(deviation);
  const nodeCountSection = buildNodeCountPromptSection(2, layerEntropy, l2Ctrl?.min_nodes, l2Ctrl?.max_nodes, complexity);

  return `## 用户需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

${DETAIL_PRINCIPLES}

## 上游大纲节点
${olDesc}

${nodeCountSection}
每个L1父节点展开为上述范围内的L2子节点。

${branchSection}

${deviationSection}

## 细纲节点ID规则
- 格式: {L1父ID}_{序号}, 如 1_1_1, 2a_1_2
- 分支加字母: 1_1_2a, 1_1_2b（2条）或 1_1_2a, 1_1_2b, 1_1_2c（3条）

## 输出JSON数组
[
  { "parent_id": "1_1", "detail_count": 3, "branch_count": 1 },
  { "parent_id": "1_2", "detail_count": 4, "branch_count": 2, "branch_position": 2, "should_merge": true }
]

branch_count: 1=不分支（线性），2=二分支，3=三分支，以此类推。由你根据叙事需要决定。
每个L1节点都必须有对应规划。请严格输出JSON数组。`;
}

// ─── 构建骨架 ───

interface SkeletonNode {
  node_id: string;
  parent_id: string;
  sequence_index: number;
  is_branch: boolean;
  is_merge_point: boolean;
  merges_from?: string[];
  prev_node: string[];
  next_node: string[];
}

function normalizeDetailPlan(p: DetailPlan): DetailPlan {
  if (p.branch_count === undefined || p.branch_count === null) {
    return { ...p, branch_count: p.has_branch ? 2 : 1 };
  }
  return p;
}

function buildSkeleton(plans: DetailPlan[]): SkeletonNode[] {
  const nodes: SkeletonNode[] = [];
  const letters = "abcdefgh";

  for (const rawPlan of plans) {
    const plan = normalizeDetailPlan(rawPlan);
    const parentId = plan.parent_id;
    const count = Math.max(1, plan.detail_count);
    const numBranches = Math.max(1, plan.branch_count);
    const hasBranch = numBranches >= 2 && count >= 2;
    const branchPos = hasBranch ? Math.min(plan.branch_position ?? 2, count) : -1;
    const shouldMerge = plan.should_merge ?? true;

    let seqIdx = 0;
    for (let i = 1; i <= count; i++) {
      if (hasBranch && i === branchPos) {
        const branchNodes: SkeletonNode[] = [];
        for (let b = 0; b < numBranches; b++) {
          branchNodes.push({
            node_id: `${parentId}_${i}${letters[b]}`,
            parent_id: parentId,
            sequence_index: seqIdx,
            is_branch: true,
            is_merge_point: false,
            prev_node: [],
            next_node: [],
          });
        }

        if (nodes.length > 0) {
          const prev = nodes[nodes.length - 1];
          if (prev.parent_id === parentId) {
            for (const bn of branchNodes) {
              prev.next_node.push(bn.node_id);
              bn.prev_node.push(prev.node_id);
            }
          }
        }

        nodes.push(...branchNodes);
        seqIdx++;

        if (shouldMerge && i < count) {
          const mergeNode: SkeletonNode = {
            node_id: `${parentId}_${i + 1}`,
            parent_id: parentId,
            sequence_index: seqIdx,
            is_branch: false,
            is_merge_point: true,
            merges_from: branchNodes.map((bn) => bn.node_id),
            prev_node: branchNodes.map((bn) => bn.node_id),
            next_node: [],
          };
          for (const bn of branchNodes) bn.next_node.push(mergeNode.node_id);
          nodes.push(mergeNode);
          seqIdx++;
          i++;
        } else if (!shouldMerge) {
          break;
        }
      } else {
        const node: SkeletonNode = {
          node_id: `${parentId}_${i}`,
          parent_id: parentId,
          sequence_index: seqIdx,
          is_branch: false,
          is_merge_point: false,
          prev_node: [],
          next_node: [],
        };

        if (nodes.length > 0) {
          const prev = nodes[nodes.length - 1];
          if (prev.parent_id === parentId && !prev.is_branch) {
            prev.next_node.push(node.node_id);
            node.prev_node.push(prev.node_id);
          }
        }

        nodes.push(node);
        seqIdx++;
      }
    }
  }

  return nodes;
}

// ─── Step 1.5: 分组内容填充 ───

interface PartialFill extends TreeSemantics {
  node_id: string;
  name: string;
  narrative_stage: string;
  story_elements: {
    plot: { cause: string; process: string; result: string };
    dialogue_hint: string;
    monologue_hint: string;
    narration_hint: string;
    atmosphere: string;
  };
  content: string;
}

async function step1_5_batchFill(
  ctx: NarrativeContext,
  llm: LLMClient,
  skeleton: SkeletonNode[],
): Promise<Map<string, PartialFill>> {
  const groups = new Map<string, SkeletonNode[]>();
  for (const node of skeleton) {
    const group = groups.get(node.parent_id) ?? [];
    group.push(node);
    groups.set(node.parent_id, group);
  }

  const outlines = ctx.outlines_generated?.outlines ?? [];
  const outlineMap = new Map(outlines.map(o => [o.node_id, o]));
  const fillMap = new Map<string, PartialFill>();

  for (const [parentId, group] of groups) {
    const parent = outlineMap.get(parentId);
    const parentName = parent?.name ?? parentId;
    const parentStage = parent?.narrative_stage ?? "rising";

    const skeletonDesc = group.map(s =>
      `- [${s.node_id}] prev=${JSON.stringify(s.prev_node)} next=${JSON.stringify(s.next_node)} ${s.is_branch ? "(分支)" : ""} ${s.is_merge_point ? "(合并点)" : ""}`
    ).join("\n");

    const prompt = `你是叙事结构设计师。请为以下一组细化节点填充详细内容。所有输出必须使用中文。

${DETAIL_PRINCIPLES}

## 所属大纲节点
- ID: ${parentId}
- 名称: ${parentName}
- 叙事阶段: ${parentStage}
- 内容: ${parent?.content ?? ""}

## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 角色档案摘要
${buildCharacterDigest(ctx.detailed_character_sheets ?? [])}

## 道具清单
${buildItemDigest(ctx.item_database ?? [])}

## 整体故事弧
${buildStoryArcDigest(ctx.initial_story_outline)}

## 相邻章节概要
${buildAdjacentGroupDigest(parentId, outlines)}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 节点骨架
${skeletonDesc}
${treeSemanticsPromptSpec(group)}
## 反套路偏差指导
- 正偏差 → 意外/升华/惊喜转折
- 负偏差 → 颠覆解构常规套路
- 中性 → 经典叙事套路

## 输出要求
为每个节点填充:
- name: 具体化的节点名称
- narrative_stage: 叙事阶段
- story_elements:
  - plot: {"cause": "起因", "process": "发展", "result": "结果"}
  - dialogue_hint: 对白风格提示
  - monologue_hint: 独白方向
  - narration_hint: 旁白语气
  - atmosphere: 氛围描述
- content: 详细叙事内容（300字以上）

**重要：你必须为以下所有 ${group.length} 个节点都生成内容，不可遗漏任何一个。**
需要填充的全部 node_id 列表：${group.map(s => s.node_id).join(", ")}

请严格输出JSON对象:
{
  "detailed_outlines": [
    ${group.map(s => `{"node_id": "${s.node_id}", "name": "...", "narrative_stage": "...", "story_elements": {"plot": {"cause":"...", "process":"...", "result":"..."}, "dialogue_hint":"...", "atmosphere":"..."}, "content": "300字以上详细叙事..."}`).join(",\n    ")}
  ]
}`;

    try {
      const raw = await llm.callWithRetry(
        composeSystemPrompt(DETAIL_FILL_COMPOSER, ctx),
        prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.detailed_outlines)) throw new Error("需要detailed_outlines数组");
        },
      );

      const parsed = extractJSON<{ detailed_outlines: PartialFill[] }>(raw);
      for (const fill of parsed.detailed_outlines) {
        if (fill.node_id) fillMap.set(fill.node_id, fill);
      }
    } catch (e) {
      console.warn(`[L2 Step1.5] 分组 ${parentId} 填充失败: ${(e as Error).message}`);
    }
  }

  return fillMap;
}

// ─── Step 2: 全局补充 ───

const STEP2_SYSTEM = `你是叙事结构设计师，请基于上游大纲与已定的节点骨架，为内容不足的细化节点补充详细内容。所有输出必须使用中文。

## Layer2 细纲层 6 槽位
- L2_01 局部场景: 场景细节
- L2_02 对白: 对话风格
- L2_03 独白: 内心独白方向
- L2_04 旁白: 旁白语气
- L2_05 语气: 整体语气
- L2_06 叙事腔调: 叙事风格`;

const STEP2_OUTPUT = `## 输出要求
输出 JSON 对象，包含 detailed_outlines 数组。
每个元素需含：node_id, name, narrative_stage, story_elements(含plot/dialogue_hint/monologue_hint/narration_hint/atmosphere), content（300字以上）

**严格要求**：node_id 必须与骨架完全一致。`;

export const DETAIL_GAP_COMPOSER: PromptComposer = {
  stepId: "detailed_outline",
  blocks: {
    base: STEP2_SYSTEM,
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output: STEP2_OUTPUT,
  },
  systemBlockOrder: ["base", "strategy", "ip_dna", "style_guide", "constraints", "output"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildStep2Prompt(ctx: NarrativeContext, skeleton: SkeletonNode[], fillMap: Map<string, PartialFill>): string {
  const needFill = skeleton.filter(s => {
    const fill = fillMap.get(s.node_id);
    return !fill || (fill.content?.length ?? 0) < 50;
  });

  if (needFill.length === 0) return "";

  const needDesc = needFill.map(s => `- [${s.node_id}] (parent: ${s.parent_id})`).join("\n");

  const outlinesDigest = ctx.outlines_generated
    ? JSON.stringify(ctx.outlines_generated.outlines.map(o => ({
        node_id: o.node_id, name: o.name, content: o.content,
      })), null, 2)
    : "（无）";

  return `## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 上游大纲
${outlinesDigest}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 角色档案摘要
${buildCharacterDigest(ctx.detailed_character_sheets ?? [])}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 需要补充内容的节点
${needDesc}

请为以上节点补充完整内容。输出 JSON：
{
  "detailed_outlines": [ { "node_id": "...", "name": "...", "narrative_stage": "...", "story_elements": {...}, "content": "300字以上..." } ]
}`;
}

// ─── 主函数 ───

export async function detailedOutlineBatch(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const allOutlines = ctx.outlines_generated?.outlines ?? [];
  if (allOutlines.length === 0) {
    markStepSkipped(ctx, "detailed_outline", ["outlines_generated"]);
    return;
  }

  const nodeFilter = getNodeFilter(ctx);
  let outlines = allOutlines;
  if (nodeFilter) {
    const affectedParents = new Set<string>();
    for (const nid of nodeFilter) {
      const lastUnderscore = nid.lastIndexOf("_");
      affectedParents.add(lastUnderscore > 0 ? nid.substring(0, lastUnderscore) : nid);
    }
    outlines = allOutlines.filter(n => affectedParents.has(n.node_id));
    if (outlines.length === 0) {
      outlines = allOutlines.filter(n => {
        for (const nid of nodeFilter) {
          if (nid.startsWith(n.node_id + "_")) return true;
        }
        return false;
      });
    }
    // 局部重跑筛不出节点是"本次无事可做"，不是缺上游，不记跳过。
    if (outlines.length === 0) return;
  }

  // Step 1: 结构规划
  const step1Raw = await llm.callWithRetry(
    composeSystemPrompt(DETAIL_PLAN_COMPOSER, ctx),
    appendUserInstructions(buildStep1Prompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<unknown>(r);
      if (!Array.isArray(p) || p.length === 0) throw new Error("必须是非空JSON数组");
    },
  );

  const rawPlans = extractJSON<DetailPlan[]>(step1Raw);
  const existingParents = new Set(rawPlans.map(p => p.parent_id));
  const budgetL2Min = ctx.global_control_params
    ? getNodeBudget(ctx.global_control_params.complexity ?? 2).l2_per_min
    : 1;
  for (const ol of outlines) {
    if (!existingParents.has(ol.node_id)) {
      rawPlans.push({ parent_id: ol.node_id, detail_count: budgetL2Min, branch_count: 1, has_branch: false });
    }
  }

  // enforce 分支/聚合目标
  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l2Ctrl = gcp?.layer_controls?.layer_2;
  const layerEntropy = getLayerEntropy(entropy, 2, l2Ctrl);
  const grossTarget = getTargetBranchRatio(complexity, layerEntropy, 2);
  const mergeTend = getMergeTendency(complexity, 2);

  const olStageMap = new Map(outlines.map(o => [o.node_id, o.narrative_stage]));
  const enforceable: StructurePlanItem[] = rawPlans.map((p) => ({
    parent_id: p.parent_id,
    child_count: p.detail_count,
    branch_count: p.branch_count ?? (p.has_branch ? 2 : 1),
    should_merge: p.should_merge,
    narrative_stage: p.narrative_stage ?? olStageMap.get(p.parent_id),
  }));
  const enforced = enforceBranchInPlan(enforceable, grossTarget, mergeTend, 2);

  const l2Max = gcp?.target_structure?.l2_per_parent ?? l2Ctrl?.max_nodes;
  const clamped = clampChildCount(enforced, 2, layerEntropy, l2Ctrl?.min_nodes, l2Max, complexity);

  const plans: DetailPlan[] = rawPlans.map((p, i) => ({
    ...p,
    detail_count: clamped[i].child_count,
    branch_count: clamped[i].branch_count,
    should_merge: clamped[i].should_merge,
  }));

  // 构建骨架
  let skeleton = buildSkeleton(plans);

  // 连接修复链（6 步，移植自 v3 fix_all_connections）
  const parentNodes = outlines.map(o => ({
    node_id: o.node_id,
    next_node: o.next_node,
  }));
  skeleton = inferCrossParentConnections(skeleton, parentNodes);
  skeleton = repairIntraGroupConnections(skeleton);
  skeleton = filterCrossBranchConnections(skeleton);
  const { nodes: danglingFixed, logs: danglingLogs } = fixDanglingBranches(skeleton, parentNodes);
  skeleton = danglingFixed;
  if (danglingLogs.length > 0) {
    console.log(`[L2] 悬挂分支修复: ${danglingLogs.length} 项`);
  }
  skeleton = fixNvNRouting(skeleton);
  skeleton = ensureBidirectionalConsistency(skeleton);

  // Step 1.5: 分组内容填充
  const fillMap = await step1_5_batchFill(ctx, llm, skeleton);

  // Step 2: 全局补充（仅填充不足的节点）
  const step2Prompt = buildStep2Prompt(ctx, skeleton, fillMap);
  if (step2Prompt) {
    try {
      const step2Raw = await llm.callWithRetry(
        composeSystemPrompt(DETAIL_GAP_COMPOSER, ctx),
        step2Prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.detailed_outlines)) throw new Error("需要detailed_outlines数组");
        },
      );

      const supplement = extractJSON<{ detailed_outlines: PartialFill[] }>(step2Raw);
      for (const fill of supplement.detailed_outlines) {
        const existing = fillMap.get(fill.node_id);
        if (!existing || (existing.content?.length ?? 0) < 50) {
          fillMap.set(fill.node_id, fill);
        }
      }
    } catch (e) {
      console.warn(`[L2 Step2] 全局补充失败: ${(e as Error).message}`);
    }
  }

  // 剧情树字段：与 L1 同一套归一化（拓扑推导 + 模型语义），见 outline-tree.ts
  const treeFields = deriveTreeFields(skeleton);

  /**
   * 最优路径沿父链继承。
   *
   * 判据两条都要成立：父节点在最优路径上，且本节点不是某处分岔里没被选中的那一支。
   * 只看自己会把「一条被放弃的支线里的顺流节点」也算成最优路径；只看父节点则会
   * 把本层新开的分支全算进去。缺了这条链，席位表 2.3.8 要的「标出最符合
   * 用户需求的那条链路」在 L2 就断了。
   */
  const l1OptimalById = new Map(outlines.map((o) => [o.node_id, o.on_optimal_path !== false]));
  const optimalBranchPick = new Map<string, string>();
  for (const skel of skeleton) {
    if (skel.prev_node.length !== 1) continue;
    const siblings = skeleton.filter(
      (s) => s.prev_node.length === 1 && s.prev_node[0] === skel.prev_node[0],
    );
    // 同一分岔的多支里取首支为最优（与 L1 缺省 optimal_branch="a" 同口径）
    if (siblings.length > 1) optimalBranchPick.set(skel.prev_node[0]!, siblings[0]!.node_id);
  }
  const onOptimalPath = (skel: SkeletonNode): boolean => {
    if (l1OptimalById.get(skel.parent_id) === false) return false;
    const pick = skel.prev_node.length === 1
      ? optimalBranchPick.get(skel.prev_node[0]!)
      : undefined;
    return pick === undefined || pick === skel.node_id;
  };

  // 合并骨架 + 内容
  const detailedOutlines: DetailedOutlineNode[] = skeleton.map((skel) => {
    const fill = fillMap.get(skel.node_id);
    const se = fill?.story_elements;
    const tree = mergeTreeSemantics(treeFields.get(skel.node_id)!, fill);

    return {
      node_id: skel.node_id,
      content_id: `do_${skel.node_id}`,
      parent_id: skel.parent_id,
      name: fill?.name ?? `细纲${skel.node_id}`,
      narrative_stage: fill?.narrative_stage ?? "rising",
      prev_node: skel.prev_node,
      next_node: skel.next_node,
      on_optimal_path: onOptimalPath(skel),
      node_function: tree.node_function,
      edges: tree.edges,
      branch_type: tree.branch_type,
      ending: tree.ending,
      story_elements: {
        plot: {
          cause: se?.plot?.cause ?? "",
          process: se?.plot?.process ?? "",
          result: se?.plot?.result ?? "",
        },
        dialogue_hint: se?.dialogue_hint ?? "",
        monologue_hint: se?.monologue_hint ?? "",
        narration_hint: se?.narration_hint ?? "",
        atmosphere: se?.atmosphere ?? "",
      },
      content: fill?.content ?? "",
    };
  });

  ctx.detailed_outlines_generated = { detailed_outlines: detailedOutlines };

  await structureValidationL2(ctx, llm);
}
