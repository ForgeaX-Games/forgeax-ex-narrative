import { useCallback, useState } from "react";
import { useNarrativeStore } from "../store/narrativeStore";
import { notifyContentEdited } from "../lib/bridge";
import { TREE_STEPS, addTreeNodeAfter, deleteTreeNode, nextNodeId } from "../lib/treeNode";

/**
 * 剧情树增删的界面侧状态。
 *
 * 增删只在**非生成中**开放，与编辑同一个闸门：正在跑的时候动结构，后端刚读过的那份
 * 节点表就与磁盘上的不是同一棵树了，跑出来的东西谁也说不清对应哪个版本。
 *
 * 删除不给二次确认弹窗，但给得起后悔：这一步的原稿在第一次结构改动时就存进了 `_original/`，
 * 「还原原文」能把整层退回模型那一版。
 */
export function useTreeEdit(stepId?: string) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const sourceDir = useNarrativeStore((s) => s.activeSourceDir ?? s.activeEntryKey);

  const canEdit = activeEntryStatus === "completed" || activeEntryStatus === "interrupted";
  const enabled = !!stepId && TREE_STEPS.has(stepId) && canEdit && !!sourceDir;

  const run = useCallback(
    (fn: () => Promise<{ warnings: string[] }>, nodeId: string) => {
      if (!stepId || !sourceDir) return;
      setBusy(true);
      setMessage(null);
      void fn()
        .then((r) => {
          // warning 是"成功了，但有件事你该知道"（比如入口换人了），不是失败。
          setMessage(r.warnings.length ? r.warnings.join("；") : null);
          notifyContentEdited({ stepId, nodeId, hasUserInput: false, sourceDir });
        })
        .catch((e: unknown) => setMessage((e as Error).message))
        .finally(() => setBusy(false));
    },
    [stepId, sourceDir],
  );

  const addAfter = useCallback(
    (afterNodeId: string, nextNodeIds: string[], existingIds: string[]) => {
      if (!stepId || !sourceDir) return;
      const nodeId = nextNodeId(afterNodeId, existingIds);
      run(
        () => addTreeNodeAfter({
          sourceDir,
          stepId,
          afterNodeId,
          nextNodeIds,
          nodeId,
          name: nodeId,
        }),
        nodeId,
      );
    },
    [run, stepId, sourceDir],
  );

  const remove = useCallback(
    (nodeId: string) => {
      if (!stepId || !sourceDir) return;
      run(() => deleteTreeNode({ sourceDir, stepId, nodeId }), nodeId);
    },
    [run, stepId, sourceDir],
  );

  return { enabled, busy, message, addAfter, remove };
}
