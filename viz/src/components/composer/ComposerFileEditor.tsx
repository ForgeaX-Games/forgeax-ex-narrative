import { useCallback, useEffect, useRef } from "react";
import { useT } from "../../i18n";
import type { TierId, ModeId } from "../../types";
import {
  UPLOAD_ACCEPT,
  readUploadedItem,
  type UploadedItem,
} from "../../lib/uploads";
import { IpStageFlow, type IpUploadDisplay } from "../controls/IpStageFlow";
import { composerIpGenerators } from "../../composer/composerCatalog";
import type { IpDnaFilePayload } from "../../hooks/useNarrativeStream";

interface ComposerFileEditorProps {
  nodeId: string;
  items: UploadedItem[];
  onItemsChange: (items: UploadedItem[]) => void;
  /** 由下游连接的「叙事路由」节点解析而来（叙事全量→tier；叙事单品→mode）。 */
  tier?: TierId;
  mode?: ModeId;
  complexity?: number;
  routingReady: boolean;
}

/**
 * 文件上传节点编辑器——把左侧栏 §1.3「文件上传」整条预处理流程迁进无限画布节点：
 * 真实读取文件（文本 utf8 / docx base64 / 二进制 base64）后复用 IpStageFlow
 * （摄入+标准化 → 体量判断 → 改编范围 → 改编规划 → 生成），后端能力完全一致。
 *
 * tier/mode/complexity/routingReady 取自下游连接的「叙事路由」节点；未连路由则生成入口置灰。
 */
export function ComposerFileEditor({
  nodeId,
  items,
  onItemsChange,
  tier,
  mode,
  complexity,
  routingReady,
}: ComposerFileEditorProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  // 生成触发器统一在顶部「开始编排生成」：把 IpStageFlow 上报的 {canGenerate, generate}
  // 登记到全局注册表，卸载（收起节点）时清除。节点内不再放「开始生成」按钮。
  useEffect(() => {
    return () => { composerIpGenerators.delete(nodeId); };
  }, [nodeId]);

  const addFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const read = await Promise.all(Array.from(list).map((f) => readUploadedItem(f)));
      const next = [...items];
      for (const it of read) {
        if (it && !next.some((x) => x.name === it.name && x.size === it.size)) next.push(it);
      }
      onItemsChange(next);
    },
    [items, onItemsChange],
  );

  const heavy = items.length > 0;

  return (
    <div className="composer-config__field">
      <span className="composer-config__label">{t("composer.cfg.file")}</span>

      <div
        className="composer-file-drop"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}
      >
        <div className="composer-file-drop__text">{t("composer.cfg.fileDrop")}</div>
        <div className="composer-file-drop__hint">{t("composer.cfg.fileHint")}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
      />

      {items.length > 0 && (
        <ul className="composer-file-list">
          {items.map((f) => (
            <li key={`${f.name}-${f.size}`} className="composer-file-list__item">
              <span className="composer-file-list__name" title={f.name}>{f.name}</span>
              <span className="composer-file-list__size">{(f.size / 1024).toFixed(1)} KB</span>
              <button
                type="button"
                className="composer-file-list__remove"
                onClick={() => onItemsChange(items.filter((x) => x !== f))}
                aria-label="remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {heavy && (
        <div className="composer-ip-stage">
          <p className="narrative-helper">{t("tms.file.heavyHint")}</p>
          <IpStageFlow
            files={items.map<IpDnaFilePayload>((f) => ({
              file_name: f.name,
              content: f.kind === "text" ? f.content : undefined,
              content_base64: f.kind !== "text" ? f.contentBase64 : undefined,
              encoding: f.kind === "docx" ? "base64-docx" : f.kind === "text" ? "utf8" : undefined,
              file_type: f.fileType,
            }))}
            displayItems={items.map<IpUploadDisplay>((f) => ({ name: f.name, kind: f.kind, fileType: f.fileType }))}
            title={items[0]?.name?.replace(/\.[^.]+$/, "")}
            tier={tier}
            mode={mode}
            complexity={complexity}
            routingReady={routingReady}
            onGenerateStateChange={(s) => composerIpGenerators.set(nodeId, s)}
          />
          <p className="narrative-helper composer-ip-hint">{t("composer.ipTopHint")}</p>
        </div>
      )}
    </div>
  );
}
