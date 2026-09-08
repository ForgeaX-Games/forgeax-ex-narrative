import { useMemo } from "react";
import { humanKey } from "./dataReadable";
import { getLocale } from "../../i18n";
import { localizeGeneratedMarkdown } from "../../i18n/generatedMarkdown";

// 注意：本文件只导出 React 组件（GenericObjectView / MarkdownBlock）。
// 工具函数（humanKey / dataToReadableText）放在 ./dataReadable.ts，
// 不要在这里 re-export，否则 React Fast Refresh 会拒绝热更整个模块，
// 导致 NarrativeCanvas 的 ErrorBoundary 抓到 "节点渲染异常"。

function escHtml(s: unknown): string {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(text: string): string {
  return escHtml(text)
    .replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="md-italic">$1</em>')
    .replace(/^---$/gm, '<hr class="md-hr">')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div class="md-ol-item"><span class="md-ol-num">$1.</span> $2</div>')
    .replace(/^[-•]\s+(.+)$/gm, '<div class="md-li">• $1</div>')
    .replace(/\n\n/g, '</p><p class="md-p">')
    .replace(/\n/g, "<br>");
}

export function MarkdownBlock({ text }: { text: string }) {
  const display = localizeGeneratedMarkdown(text);
  const html = useMemo(() => renderMarkdown(display), [display]);
  return (
    <div
      className="md-rendered"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function GenericObjectView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) return null;

  if (typeof data === "string") {
    const display = localizeGeneratedMarkdown(data);
    return display.includes("\n") ? <MarkdownBlock text={data} /> : <span className="gov-text">{display}</span>;
  }
  if (typeof data === "number" || typeof data === "boolean") {
    return <span className="gov-text">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="gov-text gov-dim">(empty)</span>;
    if (data.every((v) => typeof v === "string" || typeof v === "number")) {
      const sep = getLocale() === "en" ? ", " : "、";
      return <span className="gov-text">{data.join(sep)}</span>;
    }
    return (
      <div className="gov-list">
        {data.map((item, i) => (
          <div key={i} className={`gov-list-item ${depth === 0 ? "gov-list-top" : ""}`}>
            {typeof item === "object" && item !== null ? (
              <GenericObjectView data={item} depth={depth + 1} />
            ) : (
              <span className="gov-text">{String(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== "",
    );
    if (entries.length === 0) return <span className="gov-text gov-dim">(empty)</span>;

    return (
      <div className={`gov-object ${depth === 0 ? "gov-root" : ""}`}>
        {entries.map(([k, v]) => {
          const isSimple = typeof v === "string" || typeof v === "number" || typeof v === "boolean";
          const isSimpleArray = Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number");

          if (isSimple || isSimpleArray) {
            return (
              <div key={k} className="gov-kv-row">
                <span className="gov-kv-label">{humanKey(k)}</span>
                <span className="gov-kv-value">
                  {isSimpleArray ? (v as (string | number)[]).join("、") : String(v)}
                </span>
              </div>
            );
          }

          // QTE block 单独高亮：避免在长长的镜头字段表里被淹没
          const sectionClass = k === "qte" ? "gov-section gov-section-qte" : "gov-section";
          return (
            <div key={k} className={sectionClass}>
              <div className="gov-section-title">{humanKey(k)}</div>
              <GenericObjectView data={v} depth={depth + 1} />
            </div>
          );
        })}
      </div>
    );
  }

  return <span className="gov-text">{String(data)}</span>;
}
