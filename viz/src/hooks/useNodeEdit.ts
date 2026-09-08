import { useState, useCallback } from "react";
import { useNarrativeStore } from "../store/narrativeStore";
import { notifyContentEdited } from "../lib/bridge";
import { parseEditedText, restoreOriginal, saveStepEdit } from "../lib/editPersist";
import { rerollNode } from "../lib/nodeReroll";

export interface NodeEditState {
  editingNodeId: string | null;
  editContent: string;
  nodeUserInput: string;
  showNodeInput: string | null;
  canEditNodes: boolean;
  /** 落盘失败的原因（JSON 写坏了、后端拒了）。为空表示上一次保存成功。 */
  editError: string | null;
  /** 正在落盘的节点 id（保存键要在这期间禁用，避免连点写两次）。 */
  savingNodeId: string | null;
}

export interface NodeEditActions {
  handleNodeEdit: (nodeId: string, rawData: unknown) => void;
  handleNodeSave: (nodeId: string) => void;
  handleNodeCancel: (nodeId: string) => void;
  handleNodeRestore: (nodeId: string) => void;
  handleNodeReroll: (nodeId: string) => void;
  toggleNodeInput: (nodeId: string) => void;
  setEditContent: (val: string) => void;
  setNodeUserInput: (val: string) => void;
}

export interface NodeEditQueries {
  /** 这个节点是不是已经改过（有落盘的编辑，可以还原原文）。 */
  isEdited: (nodeId: string) => boolean;
}

export function useNodeEdit(stepId: string): NodeEditState & NodeEditActions & NodeEditQueries {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [nodeUserInput, setNodeUserInput] = useState("");
  const [showNodeInput, setShowNodeInput] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const setEditDraft = useNarrativeStore((s) => s.setEditDraft);
  const clearEditDraft = useNarrativeStore((s) => s.clearEditDraft);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const sourceDir = useNarrativeStore((s) => s.activeSourceDir ?? s.activeEntryKey);

  const canEditNodes = activeEntryStatus === "completed" || activeEntryStatus === "interrupted";

  const isEdited = useCallback(
    (nodeId: string) => !!editDrafts[`${stepId}::${nodeId}`]?.saved,
    [editDrafts, stepId],
  );

  const handleNodeEdit = useCallback((nodeId: string, rawData: unknown) => {
    setEditContent(JSON.stringify(rawData, null, 2));
    setEditingNodeId(nodeId);
    setEditError(null);
  }, []);

  /**
   * 保存 = 真落盘。
   *
   * 先落盘再关编辑框：写失败时编辑框要留着（内容还在里面，用户能改完再存），
   * 关掉再报错等于把人刚写的东西弄丢。
   */
  const handleNodeSave = useCallback((nodeId: string) => {
    if (!sourceDir) {
      setEditError("没有可写入的条目目录");
      return;
    }
    const draftKey = `${stepId}::${nodeId}`;
    const text = editContent;
    const note = nodeUserInput.trim() || undefined;

    let value: unknown;
    try {
      // 节点内容一律是对象（`handleNodeEdit` 用 JSON.stringify 铺进编辑框）。
      value = parseEditedText(text, false);
    } catch (e) {
      setEditError((e as Error).message);
      return;
    }

    setSavingNodeId(nodeId);
    setEditError(null);
    void saveStepEdit({ sourceDir, stepId, nodeId, editedContent: value, userInput: note })
      .then(() => {
        setEditDraft(draftKey, {
          content: text || undefined,
          userInput: note,
          editing: false,
          saved: true,
        });
        notifyContentEdited({ stepId, nodeId, hasUserInput: !!note, sourceDir });
        setEditingNodeId(null);
        setShowNodeInput(null);
        setEditContent("");
        setNodeUserInput("");
      })
      .catch((e: unknown) => setEditError((e as Error).message))
      .finally(() => setSavingNodeId(null));
  }, [stepId, editContent, nodeUserInput, setEditDraft, sourceDir]);

  const handleNodeCancel = useCallback((_nodeId: string) => {
    setEditingNodeId(null);
    setShowNodeInput(null);
    setEditContent("");
    setNodeUserInput("");
    setEditError(null);
  }, []);

  /** 还原原文：把模型原稿写回磁盘，并撤掉这条待重生成的账。 */
  const handleNodeRestore = useCallback((nodeId: string) => {
    if (!sourceDir) return;
    setSavingNodeId(nodeId);
    setEditError(null);
    void restoreOriginal({ sourceDir, stepId, nodeId })
      .then(() => {
        clearEditDraft(`${stepId}::${nodeId}`);
        notifyContentEdited({ stepId, nodeId, hasUserInput: false, sourceDir });
      })
      .catch((e: unknown) => setEditError((e as Error).message))
      .finally(() => setSavingNodeId(null));
  }, [stepId, sourceDir, clearEditDraft]);

  /**
   * 重 roll 这一个节点（⑤）。带上输入框里那段话作为"这一版要怎么不一样"。
   *
   * 与保存互斥：正在编辑时重 roll 会把没存的改动冲掉，所以调用方在编辑态下不给这个键。
   */
  const handleNodeReroll = useCallback((nodeId: string) => {
    setSavingNodeId(nodeId);
    setEditError(null);
    void rerollNode({ stepId, nodeId, userInstructions: nodeUserInput.trim() || undefined })
      .then(() => {
        setShowNodeInput(null);
        setNodeUserInput("");
      })
      .catch((e: unknown) => setEditError((e as Error).message))
      .finally(() => setSavingNodeId(null));
  }, [stepId, nodeUserInput]);

  const toggleNodeInput = useCallback((nodeId: string) => {
    setShowNodeInput((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  return {
    editingNodeId,
    editContent,
    nodeUserInput,
    showNodeInput,
    canEditNodes,
    editError,
    savingNodeId,
    isEdited,
    handleNodeEdit,
    handleNodeSave,
    handleNodeCancel,
    handleNodeRestore,
    handleNodeReroll,
    toggleNodeInput,
    setEditContent,
    setNodeUserInput,
  };
}
