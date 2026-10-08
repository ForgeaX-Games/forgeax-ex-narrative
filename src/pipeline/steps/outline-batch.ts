/**
 * L1 大纲生成（OutlineBatchAgent）
 *
 * 完整两步走机制（继承自 v3）：
 *   Step1: LLM 规划结构（每个 L0 父节点的子节点数量 + 分支决策）
 *          → 代码构建固定骨架（ID、prev/next、branch/merge 元数据）
 *          → 跨父连接推断（1v1/Nv1/1vN/NvN）
 *   Step2: LLM 填充叙事内容（不覆盖骨架的图结构边）
 *
 * 设计哲学：
 * - 命运必然论：L0 预设所有命运分支和结局，L1 在框架内细化
 * - 有限突变：L1 可产生新分支（Y轴），但不创造新结局
 * - 双维度展开：X轴=顺序细化 / Y轴=可能性分支
 * - 分支必须聚合或路由到 L0 预设分支
 */
import type {
  NarrativeContext,
  OutlinesGenerated,
  OutlineNode,
  FrameworkNode,
  InitialOutline,
} from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { appendUserInstructions, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, STRATEGY_SLOT_BLOCK, type PromptComposer } from "../runtime/prompt-composer.js";
import { expansionPrinciples, TOPOLOGY_DISCIPLINE } from "../prompt/narrative-craft.js";
import { inputPriorityChain, modeDispatchSource, conceptFieldMapping, preOutputChecklist } from "../prompt/structural-clarity.js";
import {
  buildCharacterDigest,
  buildItemDigest,
  buildStoryArcDigest,
  buildAdjacentGroupDigest,
} from "./context-helpers.js";
import { getNodeFilter } from "../graph/node-merge.js";
import { markStepSkipped } from "../core/step-skip.js";
import { structureValidationL1 } from "./structure-validation.js";
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
  structureTopology,
  defaultBranchPosition,
  type StructurePlanItem,
} from "../runtime/layer-threshold-config.js";
import { NEUTRAL_TOPOLOGY, type StructureTopology } from "../../knowledge/narrative-axes/index.js";
import { deviationFromLegacy } from "../../types/index.js";
import {
  deriveTreeFields,
  mergeTreeSemantics,
  treeSemanticsPromptSpec,
  type TreeSemantics,
} from "../graph/outline-tree.js";

function outlineToText(outline: InitialOutline | undefined): string {
  if (!outline) return "（无）";
  return [
    outline.theme ? `主题：${outline.theme}` : "",
    outline.background ? `背景：${outline.background}` : "",
    outline.main_conflict ? `主线冲突：${outline.main_conflict}` : "",
    outline.story_structure.opening ? `开端：${outline.story_structure.opening}` : "",
    outline.story_structure.development.length > 0
      ? outline.story_structure.development.join("\n")
      : "",
    outline.story_structure.ending ? `结局：${outline.story_structure.ending}` : "",
    outline.key_plot_points.length > 0
      ? outline.key_plot_points.map((p, i) => `${i + 1}. ${p}`).join("\n")
      : "",
  ].filter(Boolean).join("\n\n");
}

// ─── Step 1: 结构规划 ───

interface StructurePlan {
  parent_id: string;
  outline_count: number;
  branch_count: number;
  branch_position?: number;
  branch_reason?: string;
  should_merge?: boolean;
  narrative_stage?: string;
  /**
   * 分叉处哪条支线属于最优路径（分支字母 a/b/c…）。
   * 席位表 2.5.9 要求结构层标出"最符合用户需求的那一条链路"。
   * 缺省时按 a 处理——总得有一条，不标等于把判断推给下游瞎猜。
   */
  optimal_branch?: string;
  /** @deprecated backward compat — mapped to branch_count */
  has_branch?: boolean;
}

const OUTLINE_PRINCIPLES = expansionPrinciples({
  upstream: "宏观框架",
  here: "大纲层",
  convergence: "不得因此产生新的结局",
});

const STEP1_SYSTEM = `你是叙事结构规划师。读上游的宏观框架节点，为每个节点规划它要展开成几个大纲节点、在哪里分岔。所有输出使用中文。`;

export const OUTLINE_PLAN_COMPOSER: PromptComposer = {
  stepId: "outline_batch",
  blocks: {
    cot: `## 机制与流程
本席把上游的每个**叙事单元**展开成一棵**剧情树**：定清树上每个节点的功能位、
主要内容与位置关系。节点正文交给下游情节席去写，此处只到"这个节点干什么、
接在哪、凭什么走到下一个"为止。

节点分五种功能位，任何形态的剧情树都由它们拼成：
- **起始**：单元入口，无前驱；
- **分支**：玩家在此作答，之后走向分岔；
- **聚合**：多条分支在此收束回主干；
- **结局**：本单元或全局的终点，无后继；
- **普通**：单入单出的推进。

分支、聚合、结局三种节点**必须给出条件**——凭什么走这条分支、各分支凭什么汇回、
达成这个结局要满足什么。条件写成玩家可感的判据（选了哪个选项、某个数值过线、
是否持有某物、是否去过某节点），不要写成"剧情需要"。普通节点默认无条件推进。
条件挂在**出边**上：一个三选分支就是三条边各带自己的条件与代价，不要把三个条件
堆在节点上再让下游去猜哪个通向哪。收束回主干的边要显式标为 merge。

开分支时先定这处分岔的**代价档**，再决定铺几条边：
- **converge**：路径不同、结果相同——一般失误可挽回，代价是绕远或损耗，走几个节点后汇回；
- **diverge**：路径天壤之别、结局不同——抉择真正分岔，长链不汇；
- **terminal**：分支程度过大——直接走向结局（致命错误，或决定性正确带来的提前圆满）。
定不出代价档，说明这处分岔本身没想清楚。**几条边指向同一个目标是假分支**，
玩家的选择没有产生任何差异，宁可不开。每条选择边尽量写明它的代价与人设契合倾向。

结局要分档：**good 圆满 / bad 悲剧 / neutral 无明确落点**（开放式收尾；反转与隐藏按其落点归好或坏），并区分作用域——
**global** 是全剧终，**local** 是中途的 game over 或提前圆满。允许失败的作品会有
好几个 local 结局，这是正常的；但 global 结局不该满地都是。

1. 逐个读上游叙事单元，判断这一段承担的叙事功能需要几个子节点才铺得开。
2. 按**结构轴策略卡指定的形态**布置这棵树：线性形态只用起始/普通/结局；
   树状形态四种齐用；碎片化形态大量普通节点而少聚合。形态服从策略卡，
   不要一律铺成同一种树。
3. 决定分支位置与分支数——分支要出现在角色**必须做选择**的地方，不为分叉而分叉；
   每个分支给出条件，并确认它能收束回主干（除非本处就是结局分岔）。
4. 为每处分支指出最优路径。
5. 自检：因果是否连贯？五种功能位是否标全？分支/聚合/结局是否都带了条件？
   有没有节点成了孤岛（无前驱又非起始、无后继又非结局）？`,
    // F3：四项结构性缺口，见 structural-clarity.ts 文件头。本席材料换成 L1 规划阶段实际吃到的那一批。
    priority_chain: inputPriorityChain([
      "用户需求 + 偏好总结——直接给出或经偏好分析席提炼，是本层规划的最高约束",
      "上游宏观框架节点（story_framework 的 name/narrative_function/main_content）——本层只在它给定的" +
        "单元范围内展开，不能改写该单元已确立的叙事功能",
      "节点数量/分支密度区间（由复杂度与熵值算出）——形式调控，决定上面两条要摊开成几个节点、" +
        "留几处分岔，不裁决具体是什么内容",
      "初步大纲——跨层背景参考，与上面三条冲突时让位",
    ]),
    mode_source: modeDispatchSource([
      "每个上游框架节点最终展开成几个 L1 子节点、有没有分支，你先按叙事需要给出 outline_count/" +
        "branch_count，但最终会被下方节点数量区间收敛——超出区间的部分会被裁剪，这不代表你判断错，" +
        "只代表形式区间优先，不必为了「保住」超区间的数字而在别处硬凑",
      "每处分叉的最优路径（optimal_branch）唯一由下方「最优路径」小节给出的判定优先级决定" +
        "（用户明确点名 > 与主题/弧光一致 > 张力与展开空间），不要按「哪个分支写起来更顺手」来选",
    ]),
    concept_mapping: conceptFieldMapping([
      { concept: "节点功能位（起始/分支/聚合/结局/普通）",
        field: "本阶段不直接输出——由下游 outline-tree.deriveTreeFields 从 branch_count/branch_position/" +
          "should_merge 推导，这里给对结构参数就够，不要额外发明一个 node_function 字段" },
      { concept: "分支的代价档（converge/diverge/terminal）与结局分档（good/bad/neutral）",
        field: "本阶段不输出——留给 Step1.5b 内容填充阶段在 story_elements/tree 语义里落地" },
      { concept: "最优路径", field: "optimal_branch" },
    ]),
    self_check: preOutputChecklist([
      "每个框架节点都有对应的规划条目（outline_count/branch_count），没有遗漏",
      "branch_count ≥ 2 的条目都给了 branch_position 与 optimal_branch",
      "optimal_branch 的字母没有超出 branch_count 声明的分支数量",
      "outline_count/branch_count 是否落在节点数量区间提示给出的范围内（超出不算错，但要确认是有意为之而非笔误）",
    ]),
    base: STEP1_SYSTEM,
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    craft: TOPOLOGY_DISCIPLINE,
  },
  // 品类风格/约束不再单开 style_guide/constraints 块——genreStyleProvider 已注册进
  // DEFAULT_PROVIDERS，同一份 skill.slots 内容随 strategy 段的 strategy_genre 子槽
  // 一起送出，不必（也不该）在这里再用 {{SKILL.*}} 占位符重复注入一遍。
  systemBlockOrder: [
    "base", "strategy", "ip_dna", "craft",
    "cot", "priority_chain", "mode_source", "concept_mapping", "self_check",
  ],
  userBlockOrder: [],
  skillSlots: [],
};

export const OUTLINE_FILL_COMPOSER: PromptComposer = {
  stepId: "outline_batch",
  blocks: {
    base: "你是叙事结构设计师。",
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    // 填充阶段也要吃分支纪律：边条件与代价档是在这一步向模型索要的
    craft: TOPOLOGY_DISCIPLINE,
    // F3：四项结构性缺口，材料换成 Step1.5b 按 L0 父节点分组填充时实际吃到的那一批。
    priority_chain: inputPriorityChain([
      "本组节点所属的宏观框架节点（名称/叙事功能/内容）——本组节点必须服务于它，不能另起叙事功能",
      "用户原始需求 + 偏好总结",
      "世界观 / 角色档案摘要 / 道具清单——本次生成流程内部已确立的既定事实，不得抵触",
      "节点骨架（prev/next/分支/合并点标注）——图结构已经钉死，内容不能暗示与骨架矛盾的走向" +
        "（骨架说会合并，内容却写「从此再无交集」）",
      "整体故事弧 / 相邻章节概要——背景参考，与上面四条冲突时让位",
    ]),
    mode_source: modeDispatchSource([
      "节点是分支节点还是合并点，唯一由「节点骨架」描述里的 (分支)/(合并点) 标注决定，不要通过内容" +
        "语义再猜一遍——合并点的内容必须写「殊途同归」的共同事实，不能只体现某一条分支的视角",
    ]),
    concept_mapping: conceptFieldMapping([
      { concept: "Layer1 大纲层 6 槽位（个人故事/性格弧光/人物关系/环境描写/表现手法/表达方式）",
        field: "没有独立字段，全部体现在 content 正文的写法里，是写作风格指引不是输出结构" },
      { concept: "分岔位置与汇合", field: "已由骨架给定（prev_node/next_node），story_elements 只填这个" +
        "节点自己的 cause/process/result，不重复描述骨架已确定的连接关系" },
    ]),
    self_check: preOutputChecklist([
      "是否为骨架给出的全部 node_id 都生成了内容，一个不漏（清单在 prompt 末尾逐一列出）",
      "content 是否 ≥200 字",
      "合并点节点的 content 是否写的是「殊途同归」的共同事实，没有偷偷保留只属于某条分支的视角",
      "story_elements.plot 的 cause 是否与上游框架节点或前置节点的 result 衔接得上",
    ]),
  },
  systemBlockOrder: [
    "base", "strategy", "ip_dna", "craft",
    "priority_chain", "mode_source", "concept_mapping", "self_check",
  ],
  userBlockOrder: [],
  skillSlots: [],
};

function buildStep1Prompt(ctx: NarrativeContext): string {
  const fw = ctx.story_framework?.framework.nodes ?? [];
  const fwDesc = fw.map(n =>
    `- [${n.node_id}] ${n.name}（${n.narrative_function}）: ${(n.main_content ?? "").slice(0, 80)}${(n.main_content ?? "").length > 80 ? "..." : ""}`
  ).join("\n");

  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l1Ctrl = gcp?.layer_controls?.layer_1;
  const layerEntropy = getLayerEntropy(entropy, 1, l1Ctrl);
  const deviation = deviationFromLegacy(gcp);

  const branchSection = buildBranchPromptSection(1, complexity, layerEntropy, structureTopology(ctx));
  const deviationSection = buildDeviationPrompt(deviation);
  const nodeCountSection = buildNodeCountPromptSection(1, layerEntropy, l1Ctrl?.min_nodes, l1Ctrl?.max_nodes, complexity);

  return `## 用户需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 初步大纲
${outlineToText(ctx.initial_story_outline)}

## 上游宏观框架节点
${fwDesc}

${nodeCountSection}
每个L0父节点展开为上述范围内的L1子节点。

${branchSection}

${deviationSection}

## 大纲节点ID规则
- 格式: {父节点ID}_{序号}，如 1_1, 2_1, 2_2
- 分支节点加字母: 1_2a, 1_2b（2条分支）或 1_2a, 1_2b, 1_2c（3条分支）

## 输出JSON数组
[
  { "parent_id": "1", "outline_count": 3, "branch_count": 1 },
  { "parent_id": "2", "outline_count": 4, "branch_count": 2, "branch_position": 2, "branch_reason": "...", "should_merge": true, "optimal_branch": "a" }
]

branch_count: 1=不分支（线性），2=二分支，3=三分支，以此类推。由你根据叙事需要决定。

## 最优路径
凡 branch_count >= 2，必须用 optimal_branch 指出哪条支线（"a"/"b"/"c"…）是**最优路径**——
即最贴合上面「用户需求」与「偏好总结」的那一条走向。判断依据按优先级：
1. 用户明确点名要的情节走向、结局倾向、角色归宿；
2. 与初步大纲的主题和角色弧光最一致的那条；
3. 戏剧张力最足、后续可展开空间最大的那条。
最优路径不等于"好结局"——若用户要的是悲剧，那条通向悲剧的支线才是最优路径。
不分支的节点无须标注，它们默认都在最优路径上。

每个框架节点都必须有对应规划。请严格输出JSON数组。`;
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
  /** 是否落在最优路径上。非分叉节点恒为 true：不分叉时人人都在唯一那条路上。 */
  on_optimal_path: boolean;
}

function normalizePlan(p: StructurePlan): StructurePlan {
  if (p.branch_count === undefined || p.branch_count === null) {
    return { ...p, branch_count: p.has_branch ? 2 : 1 };
  }
  return p;
}

function buildSkeleton(
  plans: StructurePlan[],
  topology: StructureTopology = NEUTRAL_TOPOLOGY,
): SkeletonNode[] {
  const nodes: SkeletonNode[] = [];
  const letters = "abcdefgh";

  for (const rawPlan of plans) {
    const plan = normalizePlan(rawPlan);
    const parentId = plan.parent_id;
    const count = Math.max(1, plan.outline_count);
    const numBranches = Math.max(1, plan.branch_count);
    const hasBranch = numBranches >= 2 && count >= 2;
    // LLM 没指定分叉位置时按结构的 branchPlacement 落位：早分是 Y 型，
    // 晚分是胖尾。从前一律落在第 2 位，于是所有结构的分叉都堆在开头。
    const fallbackPos = defaultBranchPosition(count, topology.branchPlacement);
    const branchPos = hasBranch ? Math.min(plan.branch_position ?? fallbackPos, count) : -1;
    const shouldMerge = plan.should_merge ?? true;

    let seqIdx = 0;
    for (let i = 1; i <= count; i++) {
      if (hasBranch && i === branchPos) {
        const optimalIdx = Math.max(0, letters.indexOf(plan.optimal_branch?.trim().toLowerCase() ?? "a"));
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
            on_optimal_path: b === optimalIdx,
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
            on_optimal_path: true,
          };
          for (const bn of branchNodes) bn.next_node.push(mergeNode.node_id);
          nodes.push(mergeNode);
          seqIdx++;
          i++;
        } else if (!shouldMerge) {
          // non-merging branches become dead-ends; cross-parent inference handles routing
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
          on_optimal_path: true,
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

// ─── Step 1.5b: 按 L0 父节点分组 LLM 填充 ───

interface PartialOutlineFill extends TreeSemantics {
  node_id: string;
  name: string;
  narrative_stage: string;
  story_elements: {
    plot: { cause: string; process: string; result: string };
  };
  content: string;
}


/**
 * 注入骨架的取用：在场就意味着「这棵树已经定了」。
 *
 * 局部重跑时按本次要处理的 L0 父节点过滤，与常规路径同一口径。筛空了返回 null
 * 而不是空数组 —— 那说明注入骨架与本次的 L0 节点对不上（父指针错位），此时退回
 * 常规规划比产出一棵空树可诊断。
 */
function injectedL1Skeleton(
  ctx: NarrativeContext,
  frameworkNodes: FrameworkNode[],
): OutlineNode[] | null {
  const seed = ctx.injected_structure_seed?.outlines;
  if (!seed || seed.length === 0) return null;
  const parents = new Set(frameworkNodes.map((n) => n.node_id));
  const mine = seed.filter((o) => parents.has(o.parent_id));
  return mine.length > 0 ? mine : null;
}

/**
 * 注入模式的内容填充。
 *
 * 只跑双向一致化这一步修复，其余五步一概不跑。那五步（跨父连接推断、组内修复、
 * 跨分支过滤、悬挂修复、N×N 路由）都是为「LLM 规划出来的骨架可能不自洽」设计的；
 * 对确定性映射出来的骨架，修复就是篡改 —— 原作真实存在的边会被当成错误删掉，
 * 原作故意留的开放结局会被补上一条边。双向一致化不增删语义，只保证 A 的后继里
 * 有 B 时 B 的前驱里也有 A，这一步是纯粹的自洽保障。
 *
 * 结构语义字段（功能位、边、分支代价档、结局分档、最优路径）全部取注入值，不走
 * `deriveTreeFields` —— 那是从骨架反推语义，而原作已经把语义说清楚了。填充 LLM
 * 只碰文本字段。
 */
async function fillInjectedOutlines(
  ctx: NarrativeContext,
  llm: LLMClient,
  injected: OutlineNode[],
  frameworkNodes: FrameworkNode[],
): Promise<void> {
  const asSkeleton: SkeletonNode[] = injected.map((o, i) => ({
    node_id: o.node_id,
    parent_id: o.parent_id,
    sequence_index: i,
    is_branch: o.node_function === "branch",
    is_merge_point: o.node_function === "merge",
    prev_node: o.prev_node,
    next_node: o.next_node,
    on_optimal_path: o.on_optimal_path ?? true,
  }));
  const consistent = ensureBidirectionalConsistency(asSkeleton);
  const connOf = new Map(consistent.map((s) => [s.node_id, s]));

  const fillMap = await step1_5b_batchFill(ctx, llm, consistent, frameworkNodes);

  const outlines: OutlineNode[] = injected.map((src) => {
    const fill = fillMap.get(src.node_id);
    const plot = fill?.story_elements?.plot;
    const conn = connOf.get(src.node_id);
    return {
      ...src,
      content_id: `ol_${src.node_id}`,
      name: fill?.name ?? src.name,
      narrative_stage: fill?.narrative_stage ?? src.narrative_stage ?? "rising",
      prev_node: conn?.prev_node ?? src.prev_node,
      next_node: conn?.next_node ?? src.next_node,
      story_elements: {
        plot: {
          cause: plot?.cause ?? "",
          process: plot?.process ?? "",
          result: plot?.result ?? "",
        },
      },
      content: fill?.content ?? "",
    };
  });

  ctx.outlines_generated = { outlines };
}

async function step1_5b_batchFill(
  ctx: NarrativeContext,
  llm: LLMClient,
  skeleton: SkeletonNode[],
  frameworkNodes: FrameworkNode[],
): Promise<Map<string, PartialOutlineFill>> {
  const groups = new Map<string, SkeletonNode[]>();
  for (const node of skeleton) {
    const group = groups.get(node.parent_id) ?? [];
    group.push(node);
    groups.set(node.parent_id, group);
  }

  const fwMap = new Map(frameworkNodes.map(n => [n.node_id, n]));
  const fillMap = new Map<string, PartialOutlineFill>();

  for (const [parentId, group] of groups) {
    const parent = fwMap.get(parentId);
    const parentName = parent?.name ?? parentId;
    const parentFunction = parent?.narrative_function ?? "";

    const skeletonDesc = group.map(s =>
      `- [${s.node_id}] prev=${JSON.stringify(s.prev_node)} next=${JSON.stringify(s.next_node)} ${s.is_branch ? "(分支)" : ""} ${s.is_merge_point ? "(合并点)" : ""}`
    ).join("\n");

    const prompt = `你是叙事结构设计师。请为以下一组大纲节点填充详细内容。所有输出必须使用中文。

${OUTLINE_PRINCIPLES}

## 所属宏观框架节点
- ID: ${parentId}
- 名称: ${parentName}
- 叙事功能: ${parentFunction}
- 内容: ${parent?.main_content ?? ""}

## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 角色档案摘要
${buildCharacterDigest(ctx.detailed_character_sheets ?? [])}

## 道具清单
${buildItemDigest(ctx.item_database ?? [])}

## 整体故事弧
${buildStoryArcDigest(ctx.initial_story_outline)}

## 相邻章节概要
${buildAdjacentGroupDigest(parentId, frameworkNodes)}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 节点骨架
${skeletonDesc}
${treeSemanticsPromptSpec(group)}
## Layer1 大纲层 6 槽位
- L1_01 个人故事: 角色个人线
- L1_02 性格弧光: 角色成长轨迹
- L1_03 人物关系: 关系发展变化
- L1_04 环境描写: 环境氛围营造
- L1_05 表现手法: 叙事表现技巧
- L1_06 表达方式: 语言表达风格

## 输出要求
为每个节点填充:
- name: 具体化的节点名称
- narrative_stage: 叙事阶段
- story_elements: { "plot": { "cause": "事件起因", "process": "发展过程", "result": "阶段结果" } }
- content: 详细叙事内容（200字以上）

**重要：你必须为以下所有 ${group.length} 个节点都生成内容，不可遗漏任何一个。**
需要填充的全部 node_id 列表：${group.map(s => s.node_id).join(", ")}

请严格输出JSON对象:
{
  "outlines": [
    ${group.map(s => `{"node_id": "${s.node_id}", "name": "...", "narrative_stage": "...", "story_elements": {"plot": {"cause": "...", "process": "...", "result": "..."}}, "content": "200字以上详细叙事..."}`).join(",\n    ")}
  ]
}`;

    try {
      const raw = await llm.callWithRetry(
        composeSystemPrompt(OUTLINE_FILL_COMPOSER, ctx),
        prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.outlines)) throw new Error("需要outlines数组");
        },
      );

      const parsed = extractJSON<{ outlines: PartialOutlineFill[] }>(raw);
      for (const fill of parsed.outlines) {
        if (fill.node_id) fillMap.set(fill.node_id, fill);
      }
    } catch (e) {
      console.warn(`[L1 Step1.5b] 分组 ${parentId} 填充失败: ${(e as Error).message}`);
    }
  }

  return fillMap;
}

// ─── Step 2: 全局补漏（仅补充 Step 1.5b 遗漏/不足的节点） ───

const STEP2_SYSTEM = `你是叙事结构设计师，请基于宏观框架与已定的节点骨架，为内容不足的大纲节点补充详细内容。所有输出必须使用中文。

## Layer1 大纲层 6 槽位
- L1_01 个人故事: 角色个人线
- L1_02 性格弧光: 角色成长轨迹
- L1_03 人物关系: 关系发展变化
- L1_04 环境描写: 环境氛围营造
- L1_05 表现手法: 叙事表现技巧
- L1_06 表达方式: 语言表达风格

${OUTLINE_PRINCIPLES}`;

const STEP2_OUTPUT = `## 输出要求
输出 JSON 对象，包含 outlines 数组。
每个元素需含：node_id, parent_id, name, narrative_stage, story_elements(含plot), content（200字以上）

**严格要求**：node_id 必须与骨架完全一致。`;

export const OUTLINE_GAP_COMPOSER: PromptComposer = {
  stepId: "outline_batch",
  blocks: {
    base: STEP2_SYSTEM,
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    output: STEP2_OUTPUT,
  },
  systemBlockOrder: ["base", "strategy", "ip_dna", "output"],
  userBlockOrder: [],
  skillSlots: [],
};

function buildStep2Prompt(ctx: NarrativeContext, skeleton: SkeletonNode[], fillMap: Map<string, PartialOutlineFill>): string {
  const needFill = skeleton.filter(s => {
    const fill = fillMap.get(s.node_id);
    return !fill || (fill.content?.length ?? 0) < 50;
  });

  if (needFill.length === 0) return "";

  const needDesc = needFill.map(s => `- [${s.node_id}] (parent: ${s.parent_id})`).join("\n");

  const frameworkStr = ctx.story_framework
    ? JSON.stringify(ctx.story_framework.framework.nodes.map(n => ({
        node_id: n.node_id, name: n.name,
        narrative_function: n.narrative_function,
        main_content: n.main_content,
      })), null, 2)
    : "（无）";

  return `## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## L0故事框架
${frameworkStr}

## 初步大纲
${outlineToText(ctx.initial_story_outline)}

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
  "outlines": [ { "node_id": "...", "parent_id": "...", "name": "...", "narrative_stage": "...", "story_elements": {"plot": {...}}, "content": "200字以上..." } ]
}`;
}

// ─── 主函数 ───

export async function outlineBatch(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const allFrameworkNodes = ctx.story_framework?.framework.nodes ?? [];
  if (allFrameworkNodes.length === 0) {
    markStepSkipped(ctx, "outline_batch", ["story_framework"]);
    return;
  }

  const nodeFilter = getNodeFilter(ctx);
  let frameworkNodes = allFrameworkNodes;
  if (nodeFilter) {
    const affectedParents = new Set<string>();
    for (const nid of nodeFilter) {
      const firstUnderscore = nid.indexOf("_");
      affectedParents.add(firstUnderscore > 0 ? nid.substring(0, firstUnderscore) : nid);
    }
    frameworkNodes = allFrameworkNodes.filter(n => affectedParents.has(n.node_id));
    // 局部重跑筛不出节点是"本次无事可做"，不是缺上游，不记跳过。
    if (frameworkNodes.length === 0) return;
  }

  // 注入模式：树已由原作确定性映射而来，跳过规划 LLM 与体量 enforce，只补内容。
  const injected = injectedL1Skeleton(ctx, frameworkNodes);
  if (injected) {
    await fillInjectedOutlines(ctx, llm, injected, frameworkNodes);
    await structureValidationL1(ctx, llm);
    return;
  }

  // Step 1: 结构规划
  const step1Raw = await llm.callWithRetry(
    composeSystemPrompt(OUTLINE_PLAN_COMPOSER, ctx),
    appendUserInstructions(buildStep1Prompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<unknown>(r);
      if (!Array.isArray(p) || p.length === 0) throw new Error("必须是非空JSON数组");
    },
  );

  const rawPlans = extractJSON<StructurePlan[]>(step1Raw);
  const existingParents = new Set(rawPlans.map(p => p.parent_id));
  const budgetL1Min = ctx.global_control_params
    ? getNodeBudget(ctx.global_control_params.complexity ?? 2).l1_per_min
    : 2;
  for (const fw of frameworkNodes) {
    if (!existingParents.has(fw.node_id)) {
      rawPlans.push({ parent_id: fw.node_id, outline_count: budgetL1Min, branch_count: 1, has_branch: false });
    }
  }

  // enforce 分支/聚合目标
  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l1Ctrl = gcp?.layer_controls?.layer_1;
  const layerEntropy = getLayerEntropy(entropy, 1, l1Ctrl);
  const topology = structureTopology(ctx);
  const grossTarget = getTargetBranchRatio(complexity, layerEntropy, 1, topology);
  const mergeTend = getMergeTendency(complexity, 1, topology);

  const fwStageMap = new Map(frameworkNodes.map(n => [n.node_id, n.stage_type]));
  const enforceable: StructurePlanItem[] = rawPlans.map((p) => ({
    parent_id: p.parent_id,
    child_count: p.outline_count,
    branch_count: p.branch_count ?? (p.has_branch ? 2 : 1),
    should_merge: p.should_merge,
    narrative_stage: p.narrative_stage ?? fwStageMap.get(p.parent_id),
  }));
  const enforced = enforceBranchInPlan(enforceable, grossTarget, mergeTend, 1, topology);

  const l1Max = gcp?.node_budget_override?.l1_per_parent ?? l1Ctrl?.max_nodes;
  const clamped = clampChildCount(enforced, 1, layerEntropy, l1Ctrl?.min_nodes, l1Max, complexity);

  const plans: StructurePlan[] = rawPlans.map((p, i) => ({
    ...p,
    outline_count: clamped[i].child_count,
    branch_count: clamped[i].branch_count,
    should_merge: clamped[i].should_merge,
  }));

  // 构建骨架
  let skeleton = buildSkeleton(plans, topology);

  // Step 1.5a: 连接修复链（6 步，移植自 v3 fix_all_connections）
  const parentNodes = frameworkNodes.map(n => ({
    node_id: n.node_id,
    next_node: n.next_node ?? [],
  }));
  skeleton = inferCrossParentConnections(skeleton, parentNodes);
  skeleton = repairIntraGroupConnections(skeleton);
  skeleton = filterCrossBranchConnections(skeleton);
  const { nodes: danglingFixed, logs: danglingLogs } = fixDanglingBranches(skeleton, parentNodes);
  skeleton = danglingFixed;
  if (danglingLogs.length > 0) {
    console.log(`[L1] 悬挂分支修复: ${danglingLogs.length} 项`);
  }
  skeleton = fixNvNRouting(skeleton);
  skeleton = ensureBidirectionalConsistency(skeleton);

  // Step 1.5b: 按 L0 父节点分组 LLM 填充
  const fillMap = await step1_5b_batchFill(ctx, llm, skeleton, frameworkNodes);

  // Step 2: 全局补漏（仅填充不足的节点）
  const step2Prompt = buildStep2Prompt(ctx, skeleton, fillMap);
  if (step2Prompt) {
    try {
      const step2Raw = await llm.callWithRetry(
        composeSystemPrompt(OUTLINE_GAP_COMPOSER, ctx),
        step2Prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.outlines) || p.outlines.length === 0) throw new Error("outlines必须是非空数组");
        },
      );

      const supplement = extractJSON<{ outlines: PartialOutlineFill[] }>(step2Raw);
      for (const fill of supplement.outlines) {
        const existing = fillMap.get(fill.node_id);
        if (!existing || (existing.content?.length ?? 0) < 50) {
          fillMap.set(fill.node_id, fill);
        }
      }
    } catch (e) {
      console.warn(`[L1 Step2] 全局补漏失败: ${(e as Error).message}`);
    }
  }

  // 剧情树字段：拓扑部分从骨架推导，语义部分取模型给的（见 outline-tree.ts 的分工）
  const treeFields = deriveTreeFields(skeleton);

  // 合并骨架 + 内容（骨架的图结构优先）
  const outlines: OutlineNode[] = skeleton.map((skel) => {
    const fill = fillMap.get(skel.node_id);
    const plot = fill?.story_elements?.plot;
    const tree = mergeTreeSemantics(treeFields.get(skel.node_id)!, fill);

    return {
      node_id: skel.node_id,
      content_id: `ol_${skel.node_id}`,
      parent_id: skel.parent_id,
      name: fill?.name ?? `节点${skel.node_id}`,
      narrative_stage: fill?.narrative_stage ?? "rising",
      prev_node: skel.prev_node,
      next_node: skel.next_node,
      story_elements: {
        plot: {
          cause: plot?.cause ?? "",
          process: plot?.process ?? "",
          result: plot?.result ?? "",
        },
      },
      content: fill?.content ?? "",
      on_optimal_path: skel.on_optimal_path,
      node_function: tree.node_function,
      edges: tree.edges,
      branch_type: tree.branch_type,
      ending: tree.ending,
    };
  });

  ctx.outlines_generated = { outlines };

  await structureValidationL1(ctx, llm);
}
