import { useEffect, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { fetchRunFileContent } from "../../hooks/useNarrativeStream";
import { useNarrativeStore } from "../../store/narrativeStore";
import { stepIdForFile } from "../../composer/seats.generated";
import { StepRenderer } from "./TextViewPanel";
import { useT } from "../../i18n";

/**
 * 左栏点开的那份产物的正文。
 *
 * 文本视图平时铺的是「这一跑各环节的结构化结果」，按步骤一段段往下排；
 * 用户点左栏一份具体文件时想看的却是这一份，所以这里只渲染选中那一份，关掉退回常规视图。
 *
 * 渲染复用文本视图那套按环节分派的可读渲染（StepRenderer）：文件名前缀能反查出产它的
 * 环节，于是角色档案照角色档案的样子铺，场景树照场景树的样子铺。摊一屏 JSON 是给程序看的，
 * 这一栏是给写故事的人看的。
 *
 * `result` 只在这份文件确实属于当前那一跑时才给——分派里有几支优先读整跑结果，
 * 拿 A 跑的结果去渲染 B 跑的文件会张冠李戴，宁可退到数据驱动的那几支。
 */
export function FilePreview() {
  const t = useT();
  const focusedFile = useNarrativeStore((s) => s.focusedFile);
  const setFocusedFile = useNarrativeStore((s) => s.setFocusedFile);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const activeResult = useNarrativeStore((s) => s.activeResult);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const taskKey = focusedFile?.taskKey;
  const path = focusedFile?.path;

  useEffect(() => {
    if (!taskKey || !path) return;
    let cancelled = false;
    setLoading(true);
    fetchRunFileContent(taskKey, path)
      .then((content) => {
        if (!cancelled) setText(content);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskKey, path]);

  // JSON 就按结构渲染，md/txt 当正文渲染；解析不了也不报错，退回当纯文本看。
  const data = useMemo<unknown>(() => {
    if (text == null) return null;
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }, [text]);

  if (!focusedFile) return null;

  const stepId = stepIdForFile(focusedFile.path) ?? "";
  const sameRun = !!activeEntryKey && focusedFile.taskKey === activeEntryKey;

  return (
    <div className="artifact-view">
      <header className="artifact-view__head">
        <FileText size={13} aria-hidden />
        <span className="artifact-view__name" title={focusedFile.path}>{focusedFile.name}</span>
        <span className="artifact-view__key" title={focusedFile.taskKey}>{focusedFile.taskKey}</span>
        <button
          type="button"
          className="artifact-view__close"
          title={t("preview.close")}
          aria-label={t("preview.close")}
          onClick={() => setFocusedFile(null)}
        >
          <X size={13} aria-hidden />
        </button>
      </header>
      <div className="artifact-view__body">
        {loading ? (
          <div className="pi-hint">{t("tms.history.loading")}</div>
        ) : text == null ? (
          <div className="pi-empty">{t("preview.unavailable")}</div>
        ) : (
          // 滚动交给 __body，这里只做正文的排版容器——套两层滚动条会让内层滚不到底。
          <div className="artifact-view__rendered">
            <StepRenderer
              stepId={stepId}
              data={data}
              result={sameRun ? activeResult : null}
              isRunning={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
