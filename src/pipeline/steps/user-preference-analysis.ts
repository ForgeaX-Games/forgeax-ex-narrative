import type { NarrativeContext, PreferenceAnalysis, NodeBudgetOverride } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { getEntropy, getDeviationCeiling, getNodeBudget } from "../runtime/layer-threshold-config.js";
import { userInstructionsBlock, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../runtime/prompt-composer.js";
import { isIpDnaSeeded } from "../../ip-dna/fidelity.js";

/** 五档体量的产品口径（UI 上的「叙事体量」即本表）。与 COMPLEXITY_NODE_BUDGET 同源。 */
const COMPLEXITY_TABLE = `| complexity | 名称 | 适用场景 | L0节点 | L1扩展 | L2扩展 | 预估总节点 |
|-----------|------|---------|--------|--------|--------|-----------|
| 1 | 极简 | 极短故事/demo | 5-7 | 不扩展(继承L0) | 不扩展(继承L0) | 5-10 |
| 2 | 短篇 | 短篇/标准体验 | 4-5 | 克制细化(每L0→2-3个L1) | 不扩展(继承L1) | 15-25 |
| 3 | 标准 | 中篇/丰富叙事 | 5-6 | 克制细化(每L0→2-3个L1) | 克制细化(每L1→1-2个L2) | 35-50 |
| 4 | 丰富 | 长篇/复杂叙事 | 6-8 | 正常细化(每L0→3-4个L1) | 正常细化(每L1→2-3个L2) | 75-100 |
| 5 | 史诗 | 超长篇/开放世界 | 7-10 | 不限(每L0→3-5个L1) | 不限(每L1→2-4个L2) | 100+ |`;

const COMPLEXITY_TIER_NAMES: Readonly<Record<number, string>> = {
  1: "极简", 2: "短篇", 3: "标准", 4: "丰富", 5: "史诗",
};

/**
 * 体量段：档位已由用户（或 IP 改编计划）显式选定时，只告知既定档位，不再让模型重新判断。
 *
 * 分两套写法而不是一套带警告的通用文案，是因为「倾向选 1-2」这句话在档位已定的场合
 * 是**有害**的：模型会照它把用户选的史诗写回 2，而 normalize 虽然不采纳，
 * 它对 42 维度叙事密度的描述已经按错的档位写完了，下游读到的是自相矛盾的一份分析。
 */
function complexityInstruction(ctx: NarrativeContext): string {
  const explicit = typeof ctx.complexity === "number"
    ? Math.round(Math.max(1, Math.min(5, ctx.complexity)))
    : null;

  if (explicit != null) {
    return `### 复杂度等级（**已由用户选定，不得改动**）
本次叙事体量档位固定为 **complexity = ${explicit}（${COMPLEXITY_TIER_NAMES[explicit]}）**。
${COMPLEXITY_TABLE}

全局控制参数里的 complexity 必须原样输出 ${explicit}；42 维度的 entropy_config
（detail_density / complexity_factor / branch_probability）要按**该档**的叙事密度来写，
不要按你自己觉得合适的体量写。`;
  }

  return `### 复杂度等级（1-5级，用户未指定，由你判断）：
${COMPLEXITY_TABLE}

⚠️ 用户没有指定体量时倾向选择较低复杂度（1-2），除非需求里明确要求长篇或复杂叙事。`;
}

export const PREFERENCE_ANALYSIS_COMPOSER: PromptComposer = {
  stepId: "preference_analysis",
  skillSlots: [],
  systemBlockOrder: ["role", "slot_system", "cot", "ip_source", "output_requirements"],
  userBlockOrder: ["context_inputs", "task_instruction", "user_instructions"],
  blocks: {
    cot: `## 机制与流程
1. 由偏好总结逐维度推导需求强度（0-3），强度来自用户的措辞轻重与重复次数，不靠臆测。
2. 确立全局风格基调与叙事视角，二者必须与强度最高的那几维一致。
3. 标注复杂度档位对应的叙事密度预期，供下游各层决定该写多细。`,
    ip_source: (ctx: NarrativeContext): string => buildIpSourceReference(ctx, "extract"),
    role: "你是专业的叙事分析师与游戏体验设计专家，擅长从用户描述中提取关键偏好并映射到42维度叙事槽位体系。所有输出必须使用中文。",

    slot_system: `## 42维度叙事槽位体系

### 世界观层(12槽位)
**基础架构层(8个)**: WV_01时空背景、WV_02物理法则、WV_03生物生态、WV_04政治体制、WV_05经济系统、WV_06文化信仰、WV_07科技水平、WV_08势力组织
**交互叙事层(4个)**: WV_09历史脉络、WV_10核心冲突、WV_11主要人物、WV_12叙事入口

### 故事框架Layer0(18槽位)
**顶层设计(3个)**: L0_01文学风格、L0_02故事主题、L0_03故事题材
**全局作用(12个)**: L0_04整体叙事、L0_05叙事节奏、L0_06叙事策略、L0_07情节技巧、L0_08人称视角、L0_09认知范围、L0_10叙事者可靠性、L0_11非人格化叙事、L0_12空间版图、L0_13政治格局、L0_14经济体系、L0_15文化氛围
**组织协调(2个)**: L0_16叙事框架、L0_17叙事顺序
**情感体验(1个)**: L0_18情感体验

### 大纲Layer1(6槽位)
L1_01个人故事、L1_02性格弧光、L1_03人物关系、L1_04环境描写、L1_05表现手法、L1_06表达方式

### 细纲Layer2(6槽位)
L2_01局部、L2_02对白、L2_03独白、L2_04旁白、L2_05语气、L2_06叙事腔调`,

    output_requirements: `## 输出要求
输出JSON格式，包含42个维度的完整参数。每个维度必须包含：
- slot_name: 槽位名称
- user_preference: 用户在该维度的偏好分析（中文）
- description: 该维度的具体设定描述（中文）
- entropy_config: { base_entropy, entropy_type, complexity_factor, branch_probability, detail_density }
- deviation_config: { base_deviation, deviation_type, deviation_direction, deviation_intensity, anti_cliche_rules }

所有文本内容必须为中文。`,

    context_inputs: (ctx: NarrativeContext): string => `## 用户原始需求（必须严格遵循）⭐
${ctx.user_input}

## 已总结的偏好
${ctx.user_preference_summary ?? "（无）"}`,

    task_instruction: (ctx: NarrativeContext): string => `## 任务

**重要**：
1. 必须基于用户原始需求进行分析，不要编造不存在的内容！
2. 输出格式严格按照下方JSON结构，所有42个维度的字段都必须填写！
3. 所有内容使用中文！

${complexityInstruction(ctx)}

### deviation（反套路程度，连续值 -1.0 ~ +1.0）
- 正值(0~1): 创新突破——意外选择、非常规转折
- 负值(-1~0): 解构颠覆——反英雄、暗黑路线、反套路
- 0: 经典叙事——正邪分明、英雄之旅
根据用户需求的风格判断，默认 0。deviation 只控制叙事风格，不影响结构复杂度。

输出JSON格式：
{
  "全局控制参数": {
    "complexity": 2,
    "deviation": 0.0,
    "story_title": "为本作品起一个统一的中文标题（简洁有辨识度，≤20字；若用户已给出书名/项目名则沿用）"
  },
  "世界观维度": {
    "WV_01": { "slot_name": "时空背景", "user_preference": "...", "description": "...", "entropy_config": { "base_entropy": 0.5, "entropy_type": "balanced", "complexity_factor": 1.0, "branch_probability": 0.3, "detail_density": 0.5 }, "deviation_config": { "base_deviation": 0.0, "deviation_type": "structural", "deviation_direction": "neutral", "deviation_intensity": 0.5, "anti_cliche_rules": [] } },
    "WV_02": { "..." : "..." }
  },
  "框架层维度_L0": { "L0_01": { "..." : "..." } },
  "大纲层维度_L1": { "L1_01": { "..." : "..." } },
  "细纲层维度_L2": { "L2_01": { "..." : "..." } },
  "层级调控参数": {
    "worldview_control": { "layer_name": "worldview", "entropy_inheritance": 1.0, "min_nodes": 1, "max_nodes": 1 },
    "layer0_control": { "layer_name": "layer_0", "entropy_inheritance": 1.0, "min_nodes": 5, "max_nodes": 8 },
    "layer1_control": { "layer_name": "layer_1", "entropy_inheritance": 0.85, "min_nodes": 2, "max_nodes": 4 },
    "layer2_control": { "layer_name": "layer_2", "entropy_inheritance": 0.72, "min_nodes": 1, "max_nodes": 3 }
  }
}

### node_budget_override（可选，用户明确说出精确节点数时才填写）
当用户明确说"5个章节""3个故事单元"等精确数字时，在全局控制参数中额外输出
node_budget_override：
- l0_nodes: 用户要求的章节/单元数（整数）
- l1_per_parent: 每章展开的大纲节点数（1=不展开，2-4=适度展开）
- l2_per_parent: 每大纲展开的细纲节点数（1=不展开，2-4=适度展开）

它只覆盖「每层开几个节点」。故事在哪分叉、分了要不要收、有几个结局，由本作的
叙事结构决定，不在这里表达；用户没说精确数字就不要输出这个字段，节点数会由
叙事体量档位给出基线。`,
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
};

/**
 * 派生全局故事标题（§6.5）：优先用 LLM 给出的 story_title，否则从用户输入截取首句关键短语，
 * 最终兜底"未命名故事"。截断到 20 字以内，去除标点噪声，保证全局唯一可用于时间戳命名/一级标题。
 */
function deriveStoryTitle(llmTitle: unknown, userInput?: string): string {
  const fromLlm = typeof llmTitle === "string" ? llmTitle.trim().replace(/^[《"'\s]+|[》"'\s]+$/g, "") : "";
  if (fromLlm) return fromLlm.slice(0, 20);
  const firstLine = (userInput ?? "")
    .split(/[\n。！？.!?]/)[0]
    ?.trim()
    .replace(/^[《"'\s]+|[》"'\s]+$/g, "");
  if (firstLine) return firstLine.slice(0, 20);
  return "未命名故事";
}

/** 输出校验（抛错触发 LLM 重试）。runner 与 legacy 共用。 */
export function validatePreferenceAnalysis(raw: string): void {
  const parsed = extractJSON(raw);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("输出必须是JSON对象");
  const obj = parsed as Record<string, unknown>;
  if (!obj["全局控制参数"]) throw new Error("缺少'全局控制参数'字段");
}

/**
 * 节点预算覆盖的可信化。
 *
 * 这个覆盖绕过体量预算是**有意**的 —— 用户说"我要 20 个章节"就该拿到 20 个，
 * 不该被"标准"档位压回 8 个。但它是本步 LLM 从自然语言里读出来的，读错的代价
 * 是整条管线按一个幻觉数字铺开。所以只挡物理上不成立的值（非正数、离谱的量级），
 * 不按体量档位夹 —— 那样会把这个字段变成体量的复读机，它就没有存在意义了。
 *
 * 任一字段缺失或不可信时整个覆盖作废，退回体量预算：半个覆盖比没有覆盖更难排查。
 */
const NODE_BUDGET_LIMITS = {
  l0_nodes: 40,
  l1_per_parent: 8,
  l2_per_parent: 8,
} as const;

function sanitizeNodeBudgetOverride(raw: unknown): NodeBudgetOverride | null {
  if (typeof raw !== "object" || raw === null) return null;
  const src = raw as Record<string, unknown>;
  const out = {} as Record<keyof typeof NODE_BUDGET_LIMITS, number>;
  for (const [key, limit] of Object.entries(NODE_BUDGET_LIMITS)) {
    const v = Number(src[key]);
    if (!Number.isFinite(v) || v < 1 || v > limit) return null;
    out[key as keyof typeof NODE_BUDGET_LIMITS] = Math.round(v);
  }
  return out;
}

function clampLayerToBudget(
  layer: Record<string, unknown> | undefined,
  defaults: { layer_name: string; entropy_inheritance: number },
  bMin: number,
  bMax: number,
) {
  if (!layer) return { ...defaults, min_nodes: bMin, max_nodes: bMax };
  const ei = Math.max(0.5, Math.min(1.0, Number(layer.entropy_inheritance) || defaults.entropy_inheritance));
  const rawMin = Number(layer.min_nodes);
  const rawMax = Number(layer.max_nodes);
  const minN = Number.isFinite(rawMin) ? Math.max(bMin, Math.min(bMax, rawMin)) : bMin;
  const maxN = Number.isFinite(rawMax) ? Math.max(minN, Math.min(bMax, rawMax)) : bMax;
  return { layer_name: defaults.layer_name, entropy_inheritance: ei, min_nodes: minN, max_nodes: maxN };
}

/**
 * 归一化。runner 只写 io.outputField（user_preference_analysis），story_title /
 * global_control_params 都是派生字段，顺带在这里写进 ctx。
 *
 * IP DNA 预注入的读取挪到这里而非调用前：判定用到的 ctx 字段
 * （isIpDnaSeeded / global_control_params.node_budget_override / complexity）在 LLM
 * 调用前后都不会变，挪到归一化阶段读取结果一致，且不必再给 runner 加"调用前快照"这个概念。
 */
export function normalizePreferenceAnalysis(
  parsed: unknown,
  ctx: NarrativeContext,
): PreferenceAnalysis {
  const analysis = parsed as PreferenceAnalysis;

  // IP DNA 改编（Phase2c §4.6）：编排器可能已据游戏单元目标节点数预注入节点预算。
  // 那是改编计划对「原作有几章」的忠实读数，只在 IP 路径下成立。判定显式化为 isIpDnaSeeded（T4）。
  const seeded = isIpDnaSeeded(ctx);
  const preInjectedNodeBudget = seeded
    ? ctx.global_control_params?.node_budget_override ?? null
    : null;
  // 体量（complexity）不同：ctx.complexity 的两个来源都是**显式**的 —— UI 上用户选的
  // 叙事体量档位（run() 从 config.complexity 注入）与 IP 改编计划的预注入。两者都比
  // 本步 LLM 的重新判定权威。从前这里只认 IP 那一路，于是用户选了「史诗」，
  // 普通生成仍被分析提示词的「倾向选 1-2」压回短篇——选择项形同虚设。
  const explicitComplexity = typeof ctx.complexity === "number" ? ctx.complexity : null;

  const gcp = analysis["全局控制参数"] as unknown as Record<string, unknown> | undefined;
  const layerParams = analysis["层级调控参数"];

  // 全局标题（§6.5）：无策划阶段在用户偏好分析生成。有 D0/IP DNA 预设标题则继承，不覆盖。
  if (!ctx.story_title?.trim()) {
    ctx.story_title = deriveStoryTitle(gcp?.story_title, ctx.user_input);
  }

  // 用户/改编计划显式给了档位就以它为权威，只在两者都没给时才用 LLM 读数。
  const complexity = Math.round(
    Math.max(1, Math.min(5, explicitComplexity ?? (Number(gcp?.complexity) || 2))),
  );
  const entropy = getEntropy(complexity);
  const ceiling = getDeviationCeiling(entropy);

  let rawDeviation = Number(gcp?.deviation) || 0;
  if (rawDeviation === 0 && gcp?.deviation_direction) {
    const dir = String(gcp.deviation_direction);
    if (dir === "positive") rawDeviation = 0.5;
    else if (dir === "negative") rawDeviation = -0.5;
  }
  const deviation = Math.max(-ceiling, Math.min(ceiling, rawDeviation));

  const budget = getNodeBudget(complexity);

  ctx.global_control_params = {
    complexity,
    deviation,
    node_budget_override:
      preInjectedNodeBudget ?? sanitizeNodeBudgetOverride(gcp?.node_budget_override),
    layer_controls: {
      layer_0: clampLayerToBudget(layerParams?.["layer0_control"] as unknown as Record<string, unknown> | undefined, { layer_name: "layer_0", entropy_inheritance: 1.0 }, budget.l0_min, budget.l0_max),
      layer_1: clampLayerToBudget(layerParams?.["layer1_control"] as unknown as Record<string, unknown> | undefined, { layer_name: "layer_1", entropy_inheritance: 0.85 }, budget.l1_per_min, budget.l1_per_max),
      layer_2: clampLayerToBudget(layerParams?.["layer2_control"] as unknown as Record<string, unknown> | undefined, { layer_name: "layer_2", entropy_inheritance: 0.72 }, budget.l2_per_min, budget.l2_per_max),
    },
  };

  return analysis;
}

export async function userPreferenceAnalysis(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const sp = composeSystemPrompt(PREFERENCE_ANALYSIS_COMPOSER, ctx);
  const up = composeUserPrompt(PREFERENCE_ANALYSIS_COMPOSER, ctx);

  const raw = await llm.callWithRetry(
    sp,
    up,
    { responseFormat: "json" },
    validatePreferenceAnalysis,
  );

  ctx.user_preference_analysis = normalizePreferenceAnalysis(extractJSON<PreferenceAnalysis>(raw), ctx);
}
