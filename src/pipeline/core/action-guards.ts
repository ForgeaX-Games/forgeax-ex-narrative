/**
 * action-guards.ts — 键权层：entry / pipeline / step / finding 四层的
 * 「给定当前状态，这个动作现在能不能做」，后端唯一权威计算点。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么要有这个文件
 * ─────────────────────────────────────────────────────────────────
 * 这类判断此前在三处独立算：画布本地的 `runControls()`（viz/src/store/runState.ts）、
 * chat 侧读画布单向广播出的 postMessage 快照（画布不在线时 chat 就没有这份判断，
 * 只能盲发、靠后端 409 兜底）、后端各端点自己裸写的并发检查——其中 `/regenerate`
 * 甚至没用 `findConflictingRun`，是裸查“全局有没有任意一条 running”，导致单节点
 * 重生成可能被完全无关的另一个条目挡住。
 *
 * 这里把四层判断收成纯函数，后端端点用它做前置校验，`GET /history`、
 * `GET /status/:id` 把计算结果带在响应里，chat 与画布读的是同一份计算，
 * 不必再靠画布广播才有 guard。
 *
 * `pipelineGuards()` 与画布 `runControls()` 保持算法同构（同一优先级链），
 * 但不是同一份代码——画布要同步渲染，不能等一次网络往返，本地纯函数派生
 * 仍然是对的；`tests/action-guards-parity.test.ts` 用契约测试守住两边不会漂。
 */

// ════════════════════════════════════════════════════════
// Pipeline 层：五态 + 两键，与 viz/src/store/runState.ts 同构
// ════════════════════════════════════════════════════════

/** 界面上的一跑处于哪一态。与画布 `RunState`（viz 侧同名类型）逐值对应。 */
export type PipelineRunState = "pending" | "running" | "paused" | "interrupted" | "completed";

/** 主键的语义，与画布 `PrimaryAction` 同构。 */
export type PrimaryAction = "start" | "resume" | "regen" | "none";

export interface PipelineGuardInput {
  /** 条目落盘态：`null` = 没跑过。字段名与画布 `RunStateInput.activeEntryStatus` 对齐。 */
  entryStatus: "running" | "completed" | "interrupted" | null;
  /** 这个条目有没有断点。 */
  canResume: boolean;
  /** SSE 或下游 job 正在跑。 */
  generating: boolean;
  /** 有已保存的编辑草稿。 */
  hasDrafts: boolean;
  /** 在已有条目上改了需求/路由，提交时会 fork 新条目。 */
  pendingFork: boolean;
}

export interface PipelineGuards {
  state: PipelineRunState;
  /** 取消键：只有真在跑时才亮。 */
  cancelEnabled: boolean;
  primary: PrimaryAction;
  /** 断点续传是否可用——等价于 `state === "paused"`，单列一个语义清楚的字段供端点判断用。 */
  canResume: boolean;
  /** 单节点重生成 / 影响面重生成是否可发起——不在跑即可，具体节点/步骤是否存在由端点自己校验。 */
  canRegenerate: boolean;
}

/** 五态判定，逻辑与画布 `resolveRunState()` 逐条对应。 */
export function resolvePipelineState(s: PipelineGuardInput): PipelineRunState {
  // 正在跑的判据以运行信号为先：条目态是落盘态，SSE 起来的那一瞬它还没翻。
  if (s.generating || s.entryStatus === "running") return "running";
  if (s.entryStatus === "completed") return "completed";
  if (s.entryStatus === "interrupted") return s.canResume ? "paused" : "interrupted";
  return "pending";
}

/**
 * 两键亮灭 + 衍生 guard。优先级与画布 `runControls()` 一致：
 * 分叉待决压过续跑与两键皆灰，草稿压过续跑，理由见该函数的注释。
 */
export function pipelineGuards(s: PipelineGuardInput): PipelineGuards {
  const state = resolvePipelineState(s);
  const { cancelEnabled, primary } = ((): { cancelEnabled: boolean; primary: PrimaryAction } => {
    if (state === "running") return { cancelEnabled: true, primary: "none" };
    if (s.pendingFork) return { cancelEnabled: false, primary: "start" };
    if (s.hasDrafts) return { cancelEnabled: false, primary: "regen" };
    if (state === "paused") return { cancelEnabled: false, primary: "resume" };
    if (state === "completed") return { cancelEnabled: false, primary: "none" };
    // interrupted 且无断点 → 与待生成同待遇：从头开始，不给注定 404 的续跑键。
    return { cancelEnabled: false, primary: "start" };
  })();
  return {
    state,
    cancelEnabled,
    primary,
    canResume: state === "paused",
    canRegenerate: state !== "running",
  };
}

// ════════════════════════════════════════════════════════
// Entry 层：条目级别的编辑/开跑权限
// ════════════════════════════════════════════════════════

export interface EntryGuardInput {
  entryStatus: "running" | "completed" | "interrupted" | null;
  /** 同条目（同泳道）是否已有一条 running（即 `findConflictingRun` 的结果）。 */
  hasConflictingRun: boolean;
}

export interface EntryGuards {
  /** 改配置/编辑节点/剧情树增删的前置条件——契约 §2.4：非生成中。 */
  canEdit: boolean;
  /** 发起开始生成。 */
  canStart: boolean;
  /** 新增一条并行泳道——同条目不同泳道可并发，只挡真正冲突的那一条。 */
  canCreateLane: boolean;
}

export function entryGuards(s: EntryGuardInput): EntryGuards {
  const canEdit = s.entryStatus === "completed" || s.entryStatus === "interrupted";
  return {
    canEdit,
    canStart: !s.hasConflictingRun,
    canCreateLane: !s.hasConflictingRun,
  };
}

// ════════════════════════════════════════════════════════
// Step 层：单步编辑 / 重生成
// ════════════════════════════════════════════════════════

export interface StepGuardInput {
  entryStatus: "running" | "completed" | "interrupted" | null;
  stepStatus: "completed" | "pending" | "running" | "skipped" | "failed";
  hasDraft: boolean;
}

export interface StepGuards {
  canEdit: boolean;
  /** 单节点重生成（⑤）：fork 新条目，只重跑该节点。 */
  canReroll: boolean;
  /** 影响面重生成（⑥）：先 analyze-impact 再重跑受影响的一批，需要有已保存的编辑草稿。 */
  canImpactRegenerate: boolean;
}

export function stepGuards(s: StepGuardInput): StepGuards {
  const entryEditable = s.entryStatus === "completed" || s.entryStatus === "interrupted";
  const stepDone = s.stepStatus === "completed";
  return {
    canEdit: entryEditable && stepDone,
    canReroll: entryEditable && stepDone,
    canImpactRegenerate: entryEditable && s.hasDraft,
  };
}

// ════════════════════════════════════════════════════════
// Finding 层：QA 报告里一条问题的勾选/修复/忽略
// ════════════════════════════════════════════════════════

/** 与 `qa/findings.ts` 的 `QaFinding.status` 同义；这里独立声明避免循环依赖。 */
export type QaFindingStatus = "open" | "fixed" | "dismissed";

export interface FindingGuardInput {
  /** 缺省视为 `"open"`——旧报告没有这个字段。 */
  status?: QaFindingStatus;
  /** 缺席即只报不修（见 `qa/findings.ts` 的 `RepairKind` 注释）。 */
  repairKind?: "topology" | "content";
}

export interface FindingGuards {
  canSelect: boolean;
  canApplyFix: boolean;
  canDismiss: boolean;
}

export function findingGuards(s: FindingGuardInput): FindingGuards {
  const isOpen = (s.status ?? "open") === "open";
  return {
    canSelect: isOpen,
    canApplyFix: isOpen && s.repairKind != null,
    canDismiss: isOpen,
  };
}
