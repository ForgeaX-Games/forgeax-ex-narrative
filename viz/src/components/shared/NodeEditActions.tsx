import React from "react";
import { useT } from "../../i18n";
import type { useNodeEdit } from "../../hooks/useNodeEdit";

interface NodeEditActionsProps {
  nodeId: string;
  isEditing: boolean;
  showInput: boolean;
  canSave: boolean;
  onEdit: () => void;
  onInput: () => void;
  onSave: () => void;
  onCancel: () => void;
  /** 这个节点已有落盘的编辑 → 多一枚"还原原文"。 */
  edited?: boolean;
  /** 正在落盘/重跑：整排键禁用，避免连点写两次或开两条 fork。 */
  busy?: boolean;
  /** 上一次操作失败的原因。为空表示成功。 */
  error?: string | null;
  onRestore?: () => void;
  /** ⑤ 单节点重 roll。编辑态下不给（未存的改动会被冲掉）。 */
  onReroll?: () => void;
}

export function NodeEditActions({
  nodeId: _nodeId,
  isEditing,
  showInput,
  canSave,
  onEdit,
  onInput,
  onSave,
  onCancel,
  edited,
  busy,
  error,
  onRestore,
  onReroll,
}: NodeEditActionsProps) {
  const t = useT();
  const showRestore = !!edited && !!onRestore;
  const showReroll = !isEditing && !!onReroll;
  return (
    <>
      <div className="tsc-actions tsc-four-buttons node-actions">
        <button
          className={`tsc-action-btn edit${isEditing ? " active" : ""}`}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          disabled={isEditing || busy}
        >
          {t("textView.edit")}
        </button>
        <button
          className={`tsc-action-btn input${showInput ? " active" : ""}`}
          onClick={(e) => { e.stopPropagation(); onInput(); }}
          disabled={busy}
        >
          {t("textView.input")}
        </button>
        <button
          className="tsc-action-btn save"
          onClick={(e) => { e.stopPropagation(); onSave(); }}
          disabled={!canSave || busy}
        >
          {t("textView.save")}
        </button>
        {showReroll && (
          <button
            className="tsc-action-btn reroll"
            title={t("node.reroll.hint")}
            onClick={(e) => { e.stopPropagation(); onReroll!(); }}
            disabled={busy}
          >
            {t("node.reroll")}
          </button>
        )}
        {showRestore && (
          <button
            className="tsc-action-btn restore"
            title={t("node.restore.hint")}
            onClick={(e) => { e.stopPropagation(); onRestore!(); }}
            disabled={busy}
          >
            {t("node.restore")}
          </button>
        )}
        <button
          className="tsc-action-btn cancel"
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          disabled={busy}
        >
          {t("textView.cancel")}
        </button>
      </div>
      {error && <div className="node-actions-error">{error}</div>}
    </>
  );
}

/**
 * 一个节点的整排操作键。
 *
 * 六张节点表此前各自拼一遍这排键的接线，任何一处漏接（比如只给保存不给还原）在界面上
 * 都看不出来。这里收成一处：表格只说"这是哪个节点、编辑时喂什么数据"。
 */
export function NodeActionBar({
  nodeId,
  edit,
  editData,
}: {
  nodeId: string;
  edit: ReturnType<typeof useNodeEdit>;
  /** 点"编辑"时铺进编辑框的原始数据。 */
  editData: unknown;
}) {
  const isEditing = edit.editingNodeId === nodeId;
  return (
    <NodeEditActions
      nodeId={nodeId}
      isEditing={isEditing}
      showInput={edit.showNodeInput === nodeId}
      canSave={isEditing || !!edit.nodeUserInput.trim()}
      edited={edit.isEdited(nodeId)}
      busy={edit.savingNodeId === nodeId}
      error={edit.savingNodeId === nodeId ? null : edit.editError}
      onEdit={() => edit.handleNodeEdit(nodeId, editData)}
      onInput={() => edit.toggleNodeInput(nodeId)}
      onSave={() => edit.handleNodeSave(nodeId)}
      onCancel={() => edit.handleNodeCancel(nodeId)}
      onRestore={() => edit.handleNodeRestore(nodeId)}
      onReroll={() => edit.handleNodeReroll(nodeId)}
    />
  );
}

interface NodeUserInputBoxProps {
  value: string;
  onChange: (val: string) => void;
}

export function NodeUserInputBox({ value, onChange }: NodeUserInputBoxProps) {
  const t = useT();
  return (
    <div className="tsc-user-input-box">
      <textarea
        className="tsc-user-input-textarea"
        placeholder={t("textView.userInputPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    </div>
  );
}

interface NodeEditTextareaProps {
  value: string;
  onChange: (val: string) => void;
  rows?: number;
}

export function NodeEditTextarea({ value, onChange, rows = 10 }: NodeEditTextareaProps) {
  return (
    <textarea
      className="tsc-edit-textarea node-edit-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
    />
  );
}
