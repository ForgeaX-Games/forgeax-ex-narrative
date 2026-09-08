/**
 * blueprint/agent-def-registrations.ts
 *
 * 所有步骤的 AgentDef 注册。副作用文件：import 后自动注册。
 *
 * 注册分两类：
 *   - 手写 AgentDef：需要 validator、算子消费声明这类派生不出来的信息（本文件上半）；
 *   - 按席位配置表批量派生：形态取自 seat-spec，其余字段取自 StepDescriptor（本文件末尾）。
 *
 * 顺序要紧：手写的先注册，批量派生跳过已注册项——手写的信息比派生的多。
 */
import "../core/step-registrations.js";
// 已迁席位的校验器/归一化器：必须在 registerSeatAgentDefs 派生出引用它们的
// AgentDef 之前完成注册。
import "./migrated-processors.js";
import { registerAgentDef } from "./agent-def-registry.js";
import { registerSeatAgentDefs } from "../core/seat-agents.js";
import { registerExpertAgentDefs } from "../routing/expert-agents.js";
import { registerValidator } from "./processor-registry.js";
import { makeCompositeAgentDef } from "./runners/composite-runner.js";
import type { AgentDef } from "./types.js";
import { extractJSON } from "../runtime/llm-client.js";
import type { NarrativeCard, VnLogline } from "../../types/index.js";

// ════════════════════════════════════════════════════════
// narrative_card — 叙事卡（Tier4 最简步骤）
// ════════════════════════════════════════════════════════

registerValidator("narrative_card_validator", (raw) => {
  const card = extractJSON<NarrativeCard>(raw);
  if (!card.game_name || !card.one_liner || !card.story) {
    throw new Error("叙事卡缺少必需字段: game_name/one_liner/story");
  }
});

const narrativeCardDef: AgentDef = {
  id: "narrative_card",
  name: "叙事卡",
  structure: {
    type: "single-turn",
    config: {
      temperature: 0.8,
      responseFormat: "json",
      retryCount: 3,
    },
  },
  prompts: {
    templateId: "narrative-card",
    skillSlots: ["style_guide", "constraints"],
  },
  io: {
    requiredInputs: ["user_input"],
    outputField: "narrative_card",
    // 声明式算子消费（T1）：本 step 即为单一事实源，覆盖 OPERATOR_SLOT_REGISTRY 默认值。
    consumesIpDna: {
      slots: ["风格算子", "情感算子"],
      layers: ["top"],
      kag: false,
      ledger: true,
      queryHint: "叙事卡片表达",
    },
  },
  dependencies: [],
  validators: ["narrative_card_validator"],
  extractOutputKey: "narrative_card",
  /**
   * 第一个真正交给 runner 执行的席位。
   *
   * 它能先切，是因为它的 step 函数除了一次 LLM 调用与 JSON 解析之外不做别的：
   * 提示词全在 NARRATIVE_CARD_COMPOSER（system 与 user 两段都在），
   * 必填校验已登记为 narrative_card_validator，产出直接写 io.outputField。
   * 其余席位的 step 函数还带着分批、派生字段、修复等落地逻辑，
   * 那些搬进 runner 之前不能切——见 seat-spec.ts 的落差登记。
   */
  useNewRunner: true,
};

registerAgentDef(narrativeCardDef);

// ════════════════════════════════════════════════════════
// vn_logline — 影游 E1-01 用户需求预处理
// ════════════════════════════════════════════════════════

registerValidator("vn_logline_validator", (raw) => {
  const parsed = extractJSON<VnLogline>(raw);
  if (!parsed.title?.trim()) throw new Error("缺少 title");
  if (!parsed.content?.trim()) throw new Error("缺少 content");
  if (parsed.content.length < 60) throw new Error("content 过短（要求 100-180 字）");
});

const vnLoglineDef: AgentDef = {
  id: "vn_logline",
  name: "一句话故事梗概",
  structure: {
    type: "single-turn",
    config: {
      temperature: 0.7,
      responseFormat: "json",
      retryCount: 3,
      streaming: true,
    },
  },
  prompts: {
    templateId: "vn-logline",
    skillSlots: ["style_guide", "constraints"],
  },
  io: {
    requiredInputs: ["user_input"],
    optionalInputs: ["uploaded_script"],
    outputField: "vn_logline",
  },
  dependencies: [],
  validators: ["vn_logline_validator"],
  extractOutputKey: "vn_logline",
};

registerAgentDef(vnLoglineDef);

// ════════════════════════════════════════════════════════
// structure — 故事结构席的席位级工作流外壳
// ════════════════════════════════════════════════════════
//
// 本席由 outline_batch（L1 大纲）+ detailed_outline（L2 细纲）两个 legacy 实现
// 串成，seat-spec.ts 的 SHAPE_DIVERGENCES 登记着"席位级 sequence 尚未建模"。
// 这里补上：一个 composite 外壳，children 按 edges 表达"先 L1 后 L2"的串行，
// 每个子步仍经 CompositeRunner → executeAgent 走它自己原来的路径（今天都是
// legacy step 函数）——outline_batch/detailed_outline 在 run() 里依旧各自
// 独立成步、各自打检查点，这个外壳不替代 run() 的调度，只补上「从外面看，
// 这一席是这两步按序组成的一个工作流」这一层能被查询、能被单独调用的表达
// （单 agent HTTP 入口、自由编排画布都能拿它当一个节点用）。
//
// 为什么是 composite 不是 sequence：sequence 原语的阶段是"同一个 agent 内部
// 的 LLM/确定性步骤"（如 story_framework 的 plan→fill），阶段之间不经
// executeAgent 二次派发；而这里要串的是两个**本身就是独立 agent** 的实现，
// "专家 = 工程师组合"正是 composite 的定义（见 blueprint/types.ts 的
// AgentStructureType 注释）。所以 seat-spec.ts 的 SHAPE_DIVERGENCES 登记
// 暂不删除：它守的是 buildSeatAgentDef 给 outline_batch/detailed_outline
// 两个实现各自派生 structure.type 时的 single-turn 兜底（这两个实现本身
// 永远是原子调用，不会变成"sequence"），composite 外壳解决的是另一层
// ——"这一席作为整体怎么串"——两者不是同一件事，登记的 blocker 已改述清楚。
registerAgentDef(
  makeCompositeAgentDef(
    "structure",
    "故事结构席（L1 大纲 → L2 细纲）",
    {
      children: ["outline_batch", "detailed_outline"],
      edges: [{ source: "outline_batch", target: "detailed_outline" }],
    },
    {
      io: { requiredInputs: ["story_framework"], outputField: "_structure_seat_workflow_result" },
      dependencies: ["story_framework"],
    },
  ),
);

// ════════════════════════════════════════════════════════
// req_list — 需求清单席的席位级工作流外壳（G3）
// ════════════════════════════════════════════════════════
//
// 通用兜底绑定是「需求提炼 → 需求分析」两步串行工作流（assistant-seats.ts
// req_list.bindings[0]），与 structure 席同理需要一个能被按席位 id 单独查询/
// 调用的外壳——否则 `/agent/req_list/run` 只会撞见"未注册"，平台代理与画布
// 单跑入口只能各自知道要改传第一个子 step id，席位粒度对外不可见。
//
// requiredInputs 留空（而非显式列 "user_input"）：preference_summary 的
// dependsOn 为空，getStepRequiredInputs 对它的推导结果就是 []——composite
// 外壳的契约要与子步实际的输入契约一致，不代它加码。
registerAgentDef(
  makeCompositeAgentDef(
    "req_list",
    "需求清单席（需求提炼 → 需求分析）",
    {
      children: ["preference_summary", "preference_analysis"],
      edges: [{ source: "preference_summary", target: "preference_analysis" }],
    },
    {
      io: { requiredInputs: [], outputField: "_req_list_seat_workflow_result" },
      dependencies: [],
    },
  ),
);

// ════════════════════════════════════════════════════════
// 席位实现 — 按配置表批量派生（必须放在手写注册之后）
// ════════════════════════════════════════════════════════

registerSeatAgentDefs();

// ════════════════════════════════════════════════════════
// 品类专家 — 四条席位管线的 composite 外壳
// ════════════════════════════════════════════════════════
//
// 放在席位注册之后：专家的 children 是席位实现，先有子步定义再有编排更好排查。
// 步序来自 resolveSeatStepGroups 的同一份展开，不再摊平 JRPG_PIPELINE_STEPS。

registerExpertAgentDefs();
