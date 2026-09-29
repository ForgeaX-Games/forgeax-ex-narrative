import type { useT } from "../i18n";
import { RUN_STATE_LABEL } from "../store/runState";

/** 与 `TaskPanel.renderTimeRow` 的徽标文案同一套判据（M-C 三层信息架构第三层复用）。 */
export interface EntryStatusLike {
  status?: string;
  canResume?: boolean;
}

/**
 * 一条任务/条目的状态文案——供左栏第三层注释复用，不必重新发明一套措辞。
 * 中断态按有没有断点分「已暂停」/「已中断」，理由见 `TaskPanel.tsx` 顶部注释②。
 */
export function describeEntryStatus(entry: EntryStatusLike, t: ReturnType<typeof useT>): string {
  const paused = entry.status === "interrupted" && !!entry.canResume;
  if (entry.status === "completed") return t("tms.history.completed");
  if (entry.status === "running") return t("tms.history.running");
  if (paused) return t(RUN_STATE_LABEL.paused);
  if (entry.status === "interrupted") return t("tms.history.interrupted");
  if (entry.status === "failed") return t("tms.history.failed");
  if (entry.status === "config") return t("tms.history.config");
  return entry.status ?? "";
}
