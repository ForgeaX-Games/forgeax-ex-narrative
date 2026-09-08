/**
 * input-provenance.ts — 「缺这个字段该先跑谁」的唯一反查处
 *
 * 三个地方需要同一个答案，此前各自没有答案：
 *   - 单席起跑闸门（run-agent）缺字段时报错，要能说人话而不是甩字段名；
 *   - 席位发现端点要告诉前端这一席今天被谁挡着（blockedBy），好灰置入口；
 *   - 全量管线里缺上游的步骤要上报"已跳过：缺少上游 X"而不是静默走完。
 *
 * 反查链是 ctx 字段 → 产出它的 step → step 所属席位。字段与 step 的关系已经在
 * STEP_REGISTRY 的 outputFields 里，席位归属在 assistant-seats 的绑定表里，这里
 * 只做拼接，不新增第四份事实源。
 */
import { STEP_REGISTRY } from "./step-registry.js";
import { getSeatForAgent } from "../routing/assistant-seats.js";

/**
 * 由用户直接带入、不由任何席位产出的字段。缺它们时该提示"补输入"而不是"先跑某席"。
 */
const EXTERNAL_INPUT_FIELDS = new Set<string>([
  "user_input",
  "uploaded_files",
  "uploaded_script",
  "user_tags",
]);

export interface MissingInputCause {
  field: string;
  /** 产出该字段的席位 id；外部输入或查不到产出方时为 undefined。 */
  seatId?: string;
  /** 该席位的展示名，用于报错文案。 */
  seatName?: string;
  /** true = 用户直接带入的外部输入，不是某一席的产物。 */
  external: boolean;
}

/**
 * 产出该字段的 step id。
 *
 * 主输出优先：一个字段可能被多步写（如 `scene_map` 既是场景席主输出，也是
 * script_scene_generation 这个未接线变体的副输出），取"以它为主输出"的那一步
 * 才是用户该被指去跑的地方。
 */
export function producerStepForField(field: string): string | undefined {
  for (const [id, desc] of STEP_REGISTRY) {
    if (desc.outputFields[0] === field) return id;
  }
  for (const [id, desc] of STEP_REGISTRY) {
    if (desc.outputFields.includes(field) || desc.derivedFields?.includes(field)) return id;
  }
  return undefined;
}

/** 产出该字段的席位。外部输入返回 undefined。 */
export function producerSeatForField(field: string): { id: string; name: string } | undefined {
  if (EXTERNAL_INPUT_FIELDS.has(field)) return undefined;
  const stepId = producerStepForField(field);
  if (!stepId) return undefined;
  const seat = getSeatForAgent(stepId);
  return seat ? { id: seat.id, name: seat.name } : undefined;
}

/** 逐个字段解释"它该由谁产出"。 */
export function explainMissingInputs(fields: readonly string[]): MissingInputCause[] {
  return fields.map((field) => {
    const external = EXTERNAL_INPUT_FIELDS.has(field);
    const seat = external ? undefined : producerSeatForField(field);
    return { field, seatId: seat?.id, seatName: seat?.name, external };
  });
}

/**
 * 挡住本次调用的席位 id（去重，保持首次出现顺序）。供 discovery API 的 blockedBy。
 */
export function blockingSeatIds(fields: readonly string[]): string[] {
  const out: string[] = [];
  for (const cause of explainMissingInputs(fields)) {
    if (cause.seatId && !out.includes(cause.seatId)) out.push(cause.seatId);
  }
  return out;
}

/**
 * 给用户看的一句话。缺的字段能反查到席位就点名助手，反查不到就退回字段名——
 * 退回不是失败，是"这字段确实没有产出方"（外部输入、或历史字段）的如实说法。
 */
export function formatMissingInputsHint(fields: readonly string[]): string {
  const causes = explainMissingInputs(fields);
  const seatNames: string[] = [];
  const plainFields: string[] = [];
  for (const cause of causes) {
    if (cause.seatName) {
      if (!seatNames.includes(cause.seatName)) seatNames.push(cause.seatName);
    } else {
      plainFields.push(cause.field);
    }
  }
  const parts: string[] = [];
  if (seatNames.length > 0) parts.push(`需先运行${seatNames.map((n) => `【${n}】`).join("")}`);
  if (plainFields.length > 0) parts.push(`需补充输入：${plainFields.join(", ")}`);
  return parts.join("；");
}
