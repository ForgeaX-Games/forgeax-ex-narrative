/**
 * pipeline/prompt/block-slots.ts —— composer 块名到骨架槽的归属表。
 *
 * ## 它解决的问题
 *
 * 骨架（`skeleton.ts`）把提示词的段序定死成 14 个槽，但那份契约此前只管
 * `{{slot:…}}` 模板那一条路径；各 step 内联的 `PromptComposer` 走的是另一条路，
 * 块名由写这一步的人现起——同一件事在不同 step 里叫 `role` 也叫 `base`，叫
 * `output` 也叫 `output_schema` / `output_format` / `output_format_hint` /
 * `output_requirements`。名字对不上，段序就无从校验：谁也说不清 `craft` 该排在
 * `constraints` 前还是后，于是每个 step 的顺序都是当时随手定的。
 *
 * 这张表把每个块名归到它所属的骨架槽，段序契约因此落到内联 composer 上：
 * **块在 systemBlockOrder 里的位置，必须与它所属槽在 `PROMPT_SLOT_ORDER` 里的位次同向**
 * （同槽内多块不限次序，由 `prompt-block-order.test.ts` 机械校验）。
 *
 * 只管 system 一侧：PRD 那八段讲的是 system prompt 的结构。user 一侧的惯例是反的
 * ——先铺材料、指令压在最后，因为靠近末尾的要求模型更容易照做。所以 user 侧只校验
 * 一条：`user_instructions` 必须排最后，用户临时追加的话不能被别的段盖过去。
 *
 * ## 为什么是"多块共用一槽"而不是"一块一槽"
 *
 * 槽是**语义段**，块是**写作单元**，一段里本来就可以有好几个单元：情节席的
 * 「三重约束」「正文写法」「不可改动项」都属于第 ⑤ 段约束，拆成三块是为了各自能被
 * 单独替换。强行一块一槽只有两条出路——把三块揉成一大块（丢掉可替换性），或者
 * 给骨架加槽（让 14 槽随 step 膨胀，契约就没了）。所以这里是多对一。
 *
 * ## 归属上几个不显然的判断
 *
 * - `base`：身份与任务写在一起的老块，归 `role`——它是那一段的开头，拆开就要改文案。
 * - `style_guide` / `*_archetype`：品类技能注入的写法与原型，属于叙事策略的品类子槽。
 * - `craft`：通用正文写法（画面与台词怎么交替），不随品类变，所以归约束而非策略。
 * - `priority_chain` / `mode_source`：材料冲突时听谁的、按什么判定模式——回答的是
 *   「怎么做」，归机制与流程，与 `structural-clarity.ts` 说的"紧跟 cot"一致。
 * - `ip_source`：IP 原作**原文**（"改编基线，最高优先级"那一段），与提炼出来的
 *   IP DNA 切片不是一回事——切片是结论，原文是材料，所以归第 ⑦ 段上下文输入。
 * - `concept_mapping` / `self_check`：概念落到哪个输出字段、出稿前对哪几条——都贴着
 *   输出，归输出格式段，于是它们排在 cot 之后、正式输出格式之前，位置与原设计相同。
 * - `user_instructions`：用户临时追加的要求，算上下文输入的一部分，排在该段末尾。
 */
import { PROMPT_SLOT_ORDER, type PromptSlot } from "./skeleton.js";

/**
 * 块名 → 骨架槽。
 *
 * 新增块时必须在这里登记；`prompt-block-order.test.ts` 会拒绝任何没登记的块名——
 * 允许"不登记也能跑"的话，这张表半年后就只剩历史块了。
 */
export const BLOCK_SLOT: Readonly<Record<string, PromptSlot>> = {
  // ① 角色
  role: "role",
  base: "role",

  // ② 任务
  task: "task",
  task_spec: "task",
  task_requirements: "task",
  task_instruction: "task",
  task_request: "task",
  focus: "task",

  // ③ 叙事策略（四轴占位符所在的块，以及品类技能注入的写法/原型）
  strategy: "strategy_genre",
  style_guide: "strategy_genre",
  worldview_archetype: "strategy_genre",
  character_archetype: "strategy_genre",

  // ④ IP DNA
  ip_dna: "objective_truth",

  // ⑤ 约束与格式
  constraints: "constraints",
  invariants: "constraints",
  craft: "constraints",
  design_constraints: "constraints",

  // ⑥ 机制与流程
  cot: "cot",
  slot_system: "cot",
  extraction_guide: "cot",
  priority_chain: "cot",
  mode_source: "cot",

  // ⑦ 上下文输入
  context_inputs: "material",
  ip_source: "material",
  design_snippet: "material",
  examples: "material",
  material: "material",
  source: "material",
  worldview: "material",
  characters: "material",
  node: "material",
  topic: "material",
  local_evidence: "material",
  web_findings: "material",
  user_request: "material",
  preset_context: "material",
  main: "material",
  user_instructions: "material",

  // ⑧ 输出格式
  output: "output",
  output_schema: "output",
  output_format: "output",
  output_format_hint: "output",
  output_requirements: "output",
  output_reference: "output",
  concept_mapping: "output",
  self_check: "output",
};

const SLOT_RANK: ReadonlyMap<PromptSlot, number> = new Map(
  PROMPT_SLOT_ORDER.map((slot, i) => [slot, i]),
);

/** 块所属槽；未登记返回 null（调用方据此报错，不要兜底成某个槽）。 */
export function slotOfBlock(blockName: string): PromptSlot | null {
  return BLOCK_SLOT[blockName] ?? null;
}

/** 块在骨架段序里的位次；未登记返回 -1。 */
export function blockRank(blockName: string): number {
  const slot = slotOfBlock(blockName);
  return slot ? (SLOT_RANK.get(slot) ?? -1) : -1;
}

/**
 * 一串块名是否与骨架段序同向（同槽内不限次序）。
 * 返回第一处逆序的位置，全序合法时返回 null。
 */
export function findOrderViolation(
  blockNames: readonly string[],
): { at: number; block: string; after: string } | null {
  let prevRank = -1;
  let prevBlock = "";
  for (let i = 0; i < blockNames.length; i++) {
    const name = blockNames[i]!;
    const rank = blockRank(name);
    if (rank < 0) continue;
    if (rank < prevRank) return { at: i, block: name, after: prevBlock };
    prevRank = rank;
    prevBlock = name;
  }
  return null;
}
