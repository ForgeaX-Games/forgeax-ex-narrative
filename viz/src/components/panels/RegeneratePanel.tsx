import { useState } from "react";
import { useNarrativeStore } from "../../store/narrativeStore";
import { restoreOriginal } from "../../lib/editPersist";
import { rerollNode } from "../../lib/nodeReroll";
import { useT, tStepLabel } from "../../i18n";

/**
 * 改过哪些正文，以及对每一处能做什么。
 *
 * ─────────────────────────────────────────────────────────────────
 * 这个面板此前是个纯文案 stub
 * ─────────────────────────────────────────────────────────────────
 * 它只说一句"草稿已保存，请点底部重新生成"。两处都已经不对了：
 *
 *  - 编辑不再是"草稿"。它落了盘（产物文件 + 断点 + `_edits.json`），刷新还在，
 *    下游也读得到。说成草稿会让用户以为不点重新生成就白改了。
 *  - "点底部重新生成"不是唯一出路，甚至常常不是想要的那条。底部主键是**影响面重生成**
 *    （算出受牵连的一批，从最早那步跑到底）；而改一句台词多半只想换这一步，
 *    或者干脆想退回原稿。
 *
 * 所以这里改成给出信息与两个动作：改过的是哪几步（此前界面上任何地方都看不到这份清单），
 * 每一步可以只重跑它，或还原原文。整批重跑仍归底栏主键，不在这里重复一个同义按钮。
 */
export function RegeneratePanel() {
  const t = useT();
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const sourceDir = useNarrativeStore((s) => s.activeSourceDir ?? s.activeEntryKey);
  const clearEditDraft = useNarrativeStore((s) => s.clearEditDraft);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edited = Object.entries(editDrafts).filter(([, d]) => d.saved);
  if (edited.length === 0 || activeEntryStatus === "running") return null;

  const act = (key: string, run: () => Promise<unknown>) => {
    setBusyKey(key);
    setError(null);
    void run()
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusyKey(null));
  };

  return (
    <div className="regenerate-panel">
      <div className="regen-header">
        <span className="regen-title">{t("regen.title", { count: String(edited.length) })}</span>
      </div>
      <div className="regen-edited-list">
        {edited.map(([key, draft]) => {
          // 键形如 `stepId` 或 `stepId::nodeId`，与后端账本同形（见 edit-store.editKey）。
          const sep = key.indexOf("::");
          const stepId = sep < 0 ? key : key.slice(0, sep);
          const nodeId = sep < 0 ? undefined : key.slice(sep + 2);
          const busy = busyKey === key;
          return (
            <div key={key} className="regen-edited-row">
              <span className="regen-edited-name">
                {tStepLabel(stepId)}
                {nodeId && <em className="regen-edited-node">#{nodeId}</em>}
              </span>
              {draft.userInput && <span className="regen-edited-note">{draft.userInput}</span>}
              <button
                type="button"
                className="tsc-action-btn reroll"
                title={t("node.reroll.hint")}
                disabled={busy}
                onClick={() => act(key, () => rerollNode({ stepId, nodeId, userInstructions: draft.userInput }))}
              >
                {t("node.reroll")}
              </button>
              <button
                type="button"
                className="tsc-action-btn restore"
                title={t("node.restore.hint")}
                disabled={busy || !sourceDir}
                onClick={() =>
                  act(key, async () => {
                    await restoreOriginal({ sourceDir: sourceDir!, stepId, nodeId });
                    clearEditDraft(key);
                  })
                }
              >
                {t("node.restore")}
              </button>
            </div>
          );
        })}
      </div>
      <div className="regen-hint">{t("regen.hint")}</div>
      {error && <div className="node-actions-error">{error}</div>}
    </div>
  );
}
