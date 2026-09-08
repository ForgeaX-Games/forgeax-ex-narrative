/**
 * ip-dna/injection/slot-registry.ts —— 蓝图 §7 / §7.2 / §7.2b。
 *
 * 声明「哪些生成 step 在消费算子，且各需要哪些三视角槽位」。
 * 只有列入本表的 step 才会触发算子注入（蓝图 §7：仅在消费算子的环节加载）；
 * 其余 step（如 tier 检测、需求分析、归一化）一律不注入，保持零额外开销。
 *
 * 槽位命名对齐蓝图算子五大核心分类的实际消费形态：
 *   - 结构算子：剧情树/幕/场的拓扑与节奏（框架/大纲/幕/场层）
 *   - 情节算子：事件因果链、转折与悬念（情节点/beat 层）
 *   - 对白算子：台词、潜台词、信息释放（剧本/分镜层）
 *   - 风格算子：文学风格、叙事者定位、画面语言（全层可选）
 *   - 情感算子：读者/玩家情感体验曲线（全层可选）
 *
 * 视角（author/reader/character）是槽位内分组键，由 fillSlot 在运行时填满，
 * 不在本表声明（§4.5）。
 *
 * 提取层（§3.2）：layers 声明本步消费哪一提取层的算子桶（global 恒注入不必声明）。
 *   - top：世界观/角色/框架 L0；mid：大纲 L1/L2、vn 幕 P0；leaf：情节/剧本/分镜/beats。
 */

import { getAgentDef } from "../../pipeline/blueprint/agent-def-registry.js";
import { getSeatForAgent } from "../../pipeline/routing/assistant-seats.js";
import { getSeatSpec, type IpDnaScope } from "../../pipeline/routing/seat-spec.js";
import type { ExtractionLayer } from "../../types/narrative-ip-dna.js";

/** 一个生成 step 声明它消费的算子槽位（按需取最相关的几类，避免提示词膨胀）。 */
export interface StepSlotSpec {
  /** 该 step 需要的槽位名（顺序即注入顺序）。 */
  slots: string[];
  /** 该 step 消费的提取层（§3.2）；缺省 ["leaf"]；global 恒注入不必声明。 */
  layers?: ExtractionLayer[];
  /** 该 step 是否需要 KAG 关系网络子图注入（§8）。 */
  kag?: boolean;
  /** 该 step 是否需要长记忆账本一致性约束注入（§10）。 */
  ledger?: boolean;
  /** 检索 query 的侧重提示（拼到 query 末尾，提升检索/生成贴合度）。 */
  queryHint?: string;
}

/**
 * stepId → 槽位规格。键使用 STEP_IDS 的字符串值（见 pipeline/modes.ts）。
 * 未列出的 step 不消费算子。
 */
export const OPERATOR_SLOT_REGISTRY: Readonly<Record<string, StepSlotSpec>> = {
  // ── RPG / 层级树管线 ──
  worldview: { slots: ["风格算子"], layers: ["top"], kag: false, ledger: true, queryHint: "世界观构建" },
  character_enrichment: { slots: ["风格算子", "情感算子"], layers: ["top"], kag: true, ledger: true, queryHint: "角色塑造与弧光" },
  item_database: { slots: ["风格算子"], layers: ["top"], kag: true, ledger: true, queryHint: "关键道具/器物与持有关系" },
  story_framework: { slots: ["结构算子", "风格算子"], layers: ["top"], kag: true, ledger: true, queryHint: "整体剧情框架与节奏" },
  outline_batch: { slots: ["结构算子", "情节算子"], layers: ["mid"], kag: true, ledger: true, queryHint: "大纲层情节编排" },
  detailed_outline: { slots: ["情节算子", "结构算子"], layers: ["mid"], kag: true, ledger: true, queryHint: "细纲层事件因果" },
  plot_generation: { slots: ["情节算子", "情感算子", "风格算子"], layers: ["leaf"], kag: true, ledger: true, queryHint: "情节展开与转折" },
  script_generation: { slots: ["对白算子", "情感算子", "风格算子"], layers: ["leaf"], kag: true, ledger: true, queryHint: "剧本台词与潜台词" },
  scene_plan: { slots: ["风格算子", "情节算子"], layers: ["leaf"], kag: true, ledger: true, queryHint: "场景刻画" },
  script_scene_generation: { slots: ["对白算子", "风格算子"], layers: ["leaf"], kag: true, ledger: true, queryHint: "剧本场景与台词" },
  quest_generation: { slots: ["结构算子", "情节算子"], layers: ["mid"], kag: true, ledger: true, queryHint: "任务编排" },
  lore_generation: { slots: ["风格算子"], layers: ["top"], kag: false, ledger: true, queryHint: "世界设定与背景" },
  narrative_card: { slots: ["风格算子", "情感算子"], layers: ["top"], kag: false, ledger: true, queryHint: "叙事卡片表达" },

  // C1（2026-08）已封存原「VN / 互动影游管线」5 条逐步登记（vn_outline_acts /
  // vn_beats / vn_branched_beats / vn_screenplay / vn_storyboard）：这些 step
  // 随 tpl-vn-v2 一并搬进 `_archive/vn-v2/`，不再执行，逐步精调条目随之退役。
  // 影游家族现在的实现（story_framework / plot_generation / script_generation
  // 等通用 step，以及 dialogue_script / cinematic_storyboard 等 tpl-vn 变体）
  // 已都在上面/下方按各自 stepId 或按席位派生覆盖到，不留空档。
};

/**
 * 席位声明的 IP DNA 口径 → 槽位规格。
 *
 * 席位表（seat-spec.ts，事实源是 CSV「IP DNA（模板/算子）」列）说的是**这一席吃不吃、
 * 按什么口径吃**；本表说的是**具体哪几个算子桶**。前者比后者粗一档，所以派生只能给出
 * 该口径下的合理默认值：
 *
 *   field   吃模板字段（世界观/角色/道具/场景合集）→ 顶层 + 风格算子，
 *           实体席要关系一致性，故 kag。
 *   layer   吃层级算子。game_unit/top 是宏观框架（结构 + 风格）；
 *           story_unit/bottom 是剧情树与节点内容（结构 + 情节），跨 mid 与 leaf 两层——
 *           派生分不出该席的哪个实现落在哪一层，故两层都给。
 *
 * 定位是**兜底而非覆盖**：OPERATOR_SLOT_REGISTRY 的逐步条目是按 step 精调过的
 * （角色多一个情感算子、情节多情感与风格），比派生细，所以派生排在它之后。
 * 派生真正解决的是**作用域变体覆盖**：一席在不同 template 下有不同实现
 * （写这段话时的例子是场景列表席在开放世界下的 region_design、故事情节席在
 * 卡牌下的 event_pool——这两个模板专属实现已随 C3（2026-08）封存进
 * `_archive/specialized/`，此处仅保留作机制说明），逐步登记必然漏掉这些变体，
 * 而按席派生一次到位——这也是 2.4 蒸馏出的专属团队能自动覆盖所有 template
 * 变体的前提。
 */
export function deriveSlotSpecFromIpDnaScope(scope: IpDnaScope): StepSlotSpec | undefined {
  if (scope.mode === "none") return undefined;
  if (scope.mode === "field") {
    return {
      slots: ["风格算子"],
      layers: ["top"],
      kag: true,
      ledger: true,
      queryHint: scope.collection,
    };
  }
  if (scope.unit === "game_unit") {
    return {
      slots: ["结构算子", "风格算子"],
      layers: ["top"],
      kag: true,
      ledger: true,
      queryHint: "宏观框架与节奏",
    };
  }
  return {
    slots: ["结构算子", "情节算子"],
    layers: ["mid", "leaf"],
    kag: true,
    ledger: true,
    queryHint: "剧情树结构与节点情节",
  };
}

/** 该 step 所属席位声明的口径派生出的规格；不属于有规格的席位则 undefined。 */
export function seatDerivedSlotSpec(stepId: string): StepSlotSpec | undefined {
  const seat = getSeatForAgent(stepId);
  if (!seat) return undefined;
  const spec = getSeatSpec(seat.id);
  if (!spec) return undefined;
  return deriveSlotSpecFromIpDnaScope(spec.ipDna);
}

/**
 * 取某 step 的槽位规格（单一事实源解析，按具体程度从细到粗）：
 *   ① AgentDef.io.consumesIpDna（手写声明式契约，最具体）；
 *   ② OPERATOR_SLOT_REGISTRY（按 step 精调）；
 *   ③ 席位口径派生（覆盖所有 template 变体，见 seatDerivedSlotSpec）。
 * 三者皆无 → undefined（该 step 不消费算子）。
 */
export function getSlotSpec(stepId: string): StepSlotSpec | undefined {
  const declared = getAgentDef(stepId)?.io.consumesIpDna;
  if (declared) return declared;
  return OPERATOR_SLOT_REGISTRY[stepId] ?? seatDerivedSlotSpec(stepId);
}

/** 是否为消费算子的 step（声明式优先，registry 兜底）。 */
export function isOperatorConsumingStep(stepId: string): boolean {
  return getSlotSpec(stepId) !== undefined;
}
