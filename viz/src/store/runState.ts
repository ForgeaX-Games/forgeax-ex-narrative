/**
 * runState.ts — 运行状态机的纯派生（契约 docs/contracts.md §二）
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么单开一个模块
 * ─────────────────────────────────────────────────────────────────
 * 两个键此前各看各的事实：取消键看 `phase === "generating"`，主键看 `activeEntryStatus`。
 * 两套判据说的是同一件事（这一跑现在处在哪一态），分开写就会出现"取消亮着、主键也亮着"
 * 这类自相矛盾的一帧。这里把六态与两键亮灭并成一次派生，`phase` 仍管它擅长的那部分
 * （画布该显示编排还是管线），不再兼职按钮门控。
 *
 * ─────────────────────────────────────────────────────────────────
 * paused 不是第五个落盘状态
 * ─────────────────────────────────────────────────────────────────
 * 产品要的"取消生成 → 开始生成断点续传"，在后端就是 `interrupted` + `POST /resume`。
 * 所以 `paused` 只是 **`interrupted` 且有断点**时的说法，不落盘、不迁移。
 * 反过来，`interrupted` 且**没有**断点（第一步就挂了，没有 `_checkpoint.json`）必须与它分开：
 * 那种情况点"断点续传"会拿到 404，用户只能重新开始跑。分不开这两者，界面就会给出一个
 * 注定失败的按钮。
 */

/** 界面上的一跑处于哪一态。⑤⑥ 两种重生成是**动作**，落在 `primary` 上而不是这里。 */
export type RunState =
  /** ① 待生成：条目已建（或还没建）但没开跑过 */
  | "pending"
  /** ② 生成中 */
  | "running"
  /** ③ 已中断 · 有断点，可续跑（界面上的"暂停"） */
  | "paused"
  /** ③' 已中断 · 无断点，只能重开 */
  | "interrupted"
  /** ④ 已完成 */
  | "completed";

/** 主键的语义。⑤ 单节点重生成不在这里——它挂在节点自己身上。 */
export type PrimaryAction = "start" | "resume" | "regen" | "none";

export interface RunStateInput {
  /** 前端条目态：`null` = 没跑过。 */
  activeEntryStatus: "running" | "completed" | "interrupted" | null;
  /** 这个条目有没有断点（后端 history 的 `canResume`）。 */
  activeCanResume: boolean;
  /** SSE 或 IP DNA 下游 job 正在跑。 */
  generating: boolean;
  /** 有已保存的编辑草稿 → 主键改说"重新生成"（⑥ 影响面重生成）。 */
  hasDrafts: boolean;
  /** 在已有条目上改了需求/路由，提交时会 fork 新条目。 */
  pendingFork: boolean;
}

export function resolveRunState(s: RunStateInput): RunState {
  // 正在跑的判据以运行信号为先：条目态是落盘态，SSE 起来的那一瞬它还没翻。
  if (s.generating || s.activeEntryStatus === "running") return "running";
  if (s.activeEntryStatus === "completed") return "completed";
  if (s.activeEntryStatus === "interrupted") return s.activeCanResume ? "paused" : "interrupted";
  return "pending";
}

export interface RunControls {
  state: RunState;
  /** 取消键：只有真在跑时才亮。 */
  cancelEnabled: boolean;
  primary: PrimaryAction;
}

/**
 * 两键亮灭（契约 §2.2 那张表）。
 *
 * 优先级上有两处是刻意的：
 *  - `pendingFork` 压过续跑与"跑完了两键灰"。用户改了需求，他要的是照新需求跑一条新的，
 *    而不是把旧的接着跑完 —— 后者会把新需求悄悄丢掉。
 *  - 草稿压过续跑。有草稿说明用户改过正文，接着跑旧断点会用旧内容往下写。
 */
export function runControls(s: RunStateInput): RunControls {
  const state = resolveRunState(s);
  if (state === "running") return { state, cancelEnabled: true, primary: "none" };
  if (s.pendingFork) return { state, cancelEnabled: false, primary: "start" };
  if (s.hasDrafts) return { state, cancelEnabled: false, primary: "regen" };
  if (state === "paused") return { state, cancelEnabled: false, primary: "resume" };
  if (state === "completed") return { state, cancelEnabled: false, primary: "none" };
  // interrupted 且无断点 → 与待生成同待遇：从头开始，不给注定 404 的续跑键。
  return { state, cancelEnabled: false, primary: "start" };
}

/** 状态在界面上的文案键（i18n）。 */
export const RUN_STATE_LABEL: Record<RunState, string> = {
  pending: "run.state.pending",
  running: "run.state.running",
  paused: "run.state.paused",
  interrupted: "run.state.interrupted",
  completed: "run.state.completed",
};
