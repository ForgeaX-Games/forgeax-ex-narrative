/**
 * 分栏嵌入模式。
 *
 * 平台把 viz 挂成两个独立 iframe：Sidebar 用 `?pane=left`，MainArea 用 `?pane=center`，
 * 各有一份 JS 上下文与 zustand store，只靠 BroadcastChannel 同步 SYNC_KEYS。
 * 独立运行时没有 pane 参数，两栏都在同一文档里（full）。
 */
export type PaneMode = "left" | "center" | "full";

export function getPaneMode(): PaneMode {
  if (typeof window === "undefined") return "full";
  const p = new URLSearchParams(window.location.search).get("pane");
  if (p === "left" || p === "center") return p;
  return "full";
}

/**
 * 写操作的归属方：left 与 full 都是 owner，center 只读 + 发命令。
 *
 * 分栏时两个文档会各自跑一遍 effect，若都执行 startRun / saveEntry / fetchHistory，
 * 同一个动作会落两次盘。归属固定在 left 侧，center 通过 store.pendingCommand 请求执行。
 */
export function isRuntimeOwner(): boolean {
  return getPaneMode() !== "center";
}
