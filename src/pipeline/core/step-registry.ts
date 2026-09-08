/**
 * step-registry.ts — Phase 1: StepDescriptor 结构化注册表
 *
 * 聚合散落在 pipeline.ts（ALL_STEPS）、modes.ts（STEP_OUTPUT_FIELDS）和
 * 各 step 文件内部的元数据。每个 step 注册 6 类配置后即可被 Planner、
 * 执行器和前端 SSE 统一查询。
 */
import type { PipelineStep } from "./pipeline.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import type { NeedsKey } from "./needs.js";

// ────────────────────────────────────────────
// StepDescriptor 接口
// ────────────────────────────────────────────

export interface StepDescriptor {
  // A. 身份
  id: string;
  name: string;
  fn: PipelineStep;
  /** SSE 输出提取键（用于替代旧 extractStepOutput 映射） */
  extractOutputKey?: string;

  // B. Prompt
  composer?: PromptComposer;
  /** skill 查找键，默认等于 id */
  skillStepId?: string;
  /** 策划+叙事联合模式（需要 design context） */
  needsDesignContext?: boolean;

  // C. 数据依赖
  /** 前置 step ID（用于 Planner 拓扑排序和 rerun 下游计算） */
  dependsOn: string[];
  /**
   * 执行前必须已存在的 ctx 字段。
   * 缺省时由 dependsOn 的主输出字段派生（见 getStepRequiredInputs）——
   * 只在派生结果不准时才显式声明，避免两份事实源。
   */
  requiredInputs?: string[];
  /** 存在则用、缺失不拦的 ctx 字段。 */
  optionalInputs?: string[];
  /** 是否支持节点级重跑（多节点进度 step） */
  supportsNodeFilter?: boolean;

  // D. LLM（可选覆盖，step 内部仍可自行控制）
  responseFormat?: "json" | "text";
  temperature?: number;

  // E. 输出
  /** 写入 ctx 的主字段（替代 STEP_OUTPUT_FIELDS 散表） */
  outputFields: string[];
  /** 派生字段（如 validation 结果） */
  derivedFields?: string[];
  /** 是否支持多节点进度回调（sub-emit） */
  supportsSubEmit?: boolean;

  // F. Planner
  /** needs 阈值（各维度最低分数要求），Planner 据此决定是否选入 */
  needsThreshold?: Partial<Record<NeedsKey, number>>;
}

// ────────────────────────────────────────────
// 全局注册表
// ────────────────────────────────────────────

export const STEP_REGISTRY = new Map<string, StepDescriptor>();

export function registerStep(desc: StepDescriptor): void {
  STEP_REGISTRY.set(desc.id, desc);
}

/**
 * 只报运行信息、不对应任何 agent 的帧（运行横幅）。
 *
 * 画布不该为它们画节点。名单随 announce 帧一起下发，前端不自己维护一份 id 常量——
 * 否则后端加减一个元帧，画布上就会凭空多/少一张卡。
 */
export const BANNER_STEP_IDS: readonly string[] = ["pipeline_config"];

/**
 * step 的显示名。注册表是这个名字的唯一真值：
 * SSE 的 stage、announce 的 stepNames、画布卡片标题全部回到这里取，
 * 谁都不许再抄一份常量表——抄一份就意味着改名要改 N 处，漏一处就是画布上写着旧名。
 */
export function stepDisplayName(stepId: string): string {
  return STEP_REGISTRY.get(stepId)?.name ?? stepId;
}

/** 一批 step 的显示名，随 announce 帧下发给前端（前端不再自带中文步名表）。 */
export function stepDisplayNames(stepIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of stepIds) {
    const name = STEP_REGISTRY.get(id)?.name;
    if (name) out[id] = name;
  }
  return out;
}

/** 获取指定 step 的所有输出字段（主字段 + 派生字段） */
export function getStepOutputFields(stepId: string): string[] {
  const desc = STEP_REGISTRY.get(stepId);
  if (!desc) return [];
  return [...desc.outputFields, ...(desc.derivedFields ?? [])];
}

/** 获取指定 step 的 SSE 输出提取键 */
export function getExtractOutputKey(stepId: string): string | undefined {
  return STEP_REGISTRY.get(stepId)?.extractOutputKey;
}

/** 获取指定 step 的前置依赖 */
export function getStepDependencies(stepId: string): string[] {
  return STEP_REGISTRY.get(stepId)?.dependsOn ?? [];
}

/**
 * 执行前必须存在的 ctx 字段。
 *
 * 显式声明优先；否则每个直接前置取**一个**字段——它的主输出。
 *
 * 只取主输出而不是前置产出的全部字段，是为了让这条断言不会假阳性：
 * 「主输出在」等价于「这一步跑过了」，而副产物（validation 结果、target_acts
 * 这类）本来就可能条件性缺席，拿它们卡单跑会把正常的重跑拦在门外。
 */
export function getStepRequiredInputs(stepId: string): string[] {
  const desc = STEP_REGISTRY.get(stepId);
  if (!desc) return [];
  if (desc.requiredInputs) return [...desc.requiredInputs];
  const fields = new Set<string>();
  for (const dep of desc.dependsOn) {
    const primary = STEP_REGISTRY.get(dep)?.outputFields[0];
    if (primary) fields.add(primary);
  }
  return [...fields];
}

/**
 * 执行前的输入体检：返回缺失字段名。
 *
 * 只报告不抛错——处置由调用方决定：单席入口回 422，全量管线把这一步记为
 * skipped 后继续（见 pipeline.ts 的 skipIfMissingUpstream）。
 *
 * 空数组与空串按缺失算。上游跳过或空产出时字段常常是 `[]` 而非 undefined，
 * 若只判 null 就会放行到下游那句 `if (empty) return`，退化成静默空跑。
 */
export function missingStepInputs(
  stepId: string,
  ctx: Record<string, unknown>,
): string[] {
  return getStepRequiredInputs(stepId).filter((f) => {
    const v = ctx[f];
    if (v === undefined || v === null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "string") return v.trim() === "";
    return false;
  });
}

/**
 * 从 step ID 获取下游所有受影响的 step（含递归下游），
 * 用于 rerunFromStep 时决定需要清除哪些字段。
 */
export function getDownstreamSteps(stepId: string): string[] {
  const downstream = new Set<string>();
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [id, desc] of STEP_REGISTRY) {
      if (desc.dependsOn.includes(current) && !downstream.has(id)) {
        downstream.add(id);
        queue.push(id);
      }
    }
  }
  return [...downstream];
}
