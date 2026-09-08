import { useMemo, useState } from "react";
import type { QaFinding, QaReport, QaRepairOutcome } from "../../types";
import { applyQaFixes, dismissQaFindings } from "../../lib/editPersist";

/**
 * 两个检查席的报告面板。
 *
 * 检查席此前是「只审不修」：报告出得很细，作者看完还得回到对应席位整步重跑，
 * 为了一处断边把整层结构重新生成。这个面板补的是中间那一环——逐条勾选，
 * 只修勾中的那些。
 *
 * 修不了的条目照样列出来但不给勾选框。给了勾选框点下去没反应，比一开始就说
 * 「这条得你自己定夺」要难受得多。
 *
 * 键权层方案 M3：finding 自带 `status`（`open`/`fixed`/`dismissed`），已处置的
 * 条目不再从列表消失——列表按状态分样式渲染，勾选框只留给还 `open` 且可修的那些
 * （与后端 `findingGuards` 同一条判据：状态非 open 就不能再勾）。
 */

const STATUS_LABEL: Record<NonNullable<QaFinding["status"]>, string> = {
  open: "待处理",
  fixed: "已修复",
  dismissed: "已忽略",
};

const SEVERITY_LABEL: Record<QaFinding["severity"], string> = {
  error: "硬伤",
  warn: "待关注",
};

const VERDICT_LABEL: Record<QaReport["verdict"], string> = {
  pass: "通过",
  warn: "有待关注项",
  fail: "有硬伤",
};

const REPAIR_LABEL: Record<string, string> = {
  topology: "可自动修复 · 连接",
  content: "可自动修复 · 定点重写",
};

export function QaReportView({
  stepId,
  report,
  sourceDir,
}: {
  stepId: string;
  report: QaReport;
  /** 没有条目目录就只能看不能修（例如从别处预览一份产物文件）。 */
  sourceDir?: string | null;
}) {
  const [current, setCurrent] = useState<QaReport>(report);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<QaRepairOutcome[]>([]);

  const findings = current.findings ?? [];
  const isOpen = (f: QaFinding): boolean => (f.status ?? "open") === "open";
  // 可勾选修复：有修法且还没被处置过——已 fixed/dismissed 的不再重复勾（同 `findingGuards.canApplyFix`）。
  const repairable = useMemo(() => findings.filter((f) => f.repairKind && isOpen(f)), [findings]);
  // 可忽略：还 open 就行，不要求有 repairKind——只报不修的条目同样可以"看过了不用管"。
  const dismissable = useMemo(() => findings.filter(isOpen), [findings]);
  const canFix = !!sourceDir && repairable.length > 0;
  const canDismiss = !!sourceDir && selected.size > 0;

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (): void => {
    setSelected(
      selected.size === repairable.length ? new Set() : new Set(repairable.map((f) => f.id)),
    );
  };

  const applyFixes = async (): Promise<void> => {
    if (!sourceDir || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await applyQaFixes({ sourceDir, stepId, findingIds: [...selected] });
      setCurrent(res.report);
      setOutcomes(res.outcomes);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dismissSelected = async (): Promise<void> => {
    if (!sourceDir || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await dismissQaFindings({ sourceDir, stepId, findingIds: [...selected] });
      setCurrent(res.report);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const outcomeById = new Map(outcomes.map((o) => [o.findingId, o]));

  return (
    <div className="qa-report">
      <div className={`qa-verdict qa-verdict-${current.verdict}`}>
        <span className="qa-verdict-tag">{VERDICT_LABEL[current.verdict]}</span>
        <span className="qa-summary">{current.summary}</span>
      </div>

      {current.layers && current.layers.length > 0 && (
        <div className="qa-layers">
          {current.layers.map((l) => (
            <span key={l.layer} className="qa-layer-chip">
              {l.label} · {l.nodeCount} 节点
            </span>
          ))}
        </div>
      )}

      {findings.length === 0 ? (
        <div className="qa-empty">这一轮没有查出问题。</div>
      ) : (
        <div className="qa-findings">
          {findings.map((f) => {
            const outcome = outcomeById.get(f.id);
            const status = f.status ?? "open";
            const open = status === "open";
            return (
              <div key={f.id} className={`qa-finding qa-sev-${f.severity} qa-status-${status}`}>
                <div className="qa-finding-head">
                  {open ? (
                    <input
                      type="checkbox"
                      className="qa-check"
                      checked={selected.has(f.id)}
                      disabled={busy || !sourceDir}
                      onChange={() => toggle(f.id)}
                      title={f.repairKind ? "勾选后可修复或忽略" : "这条只报不修，可以忽略"}
                    />
                  ) : (
                    <span className="qa-check-placeholder" title={STATUS_LABEL[status]} />
                  )}
                  <span className="qa-sev">{SEVERITY_LABEL[f.severity]}</span>
                  <span className="qa-criterion">{f.criterion}</span>
                  <span className="qa-node">{f.nodeId}</span>
                  {open && f.repairKind && (
                    <span className="qa-repair-kind">{REPAIR_LABEL[f.repairKind] ?? f.repairKind}</span>
                  )}
                  {!open && (
                    <span className={`qa-status-tag qa-status-tag-${status}`}>
                      {STATUS_LABEL[status]}
                      {status === "fixed" && f.fixedInVersion != null ? ` · 第 ${f.fixedInVersion} 版` : ""}
                    </span>
                  )}
                </div>
                <div className="qa-issue">{f.issue}</div>
                {f.excerpt && <div className="qa-excerpt">{f.excerpt}</div>}
                {f.suggestion && <div className="qa-suggestion">建议：{f.suggestion}</div>}
                {status === "open" && f.lastError && (
                  <div className="qa-outcome qa-outcome-failed">上次修复未成功：{f.lastError}</div>
                )}
                {outcome && (
                  <div className={`qa-outcome qa-outcome-${outcome.status}`}>
                    {outcome.status === "applied" ? "已修复" : outcome.status === "skipped" ? "已跳过" : "修复失败"}
                    ：{outcome.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(canFix || (sourceDir && dismissable.length > 0)) && (
        <div className="qa-actions">
          {repairable.length > 0 && (
            <button className="tsc-action-btn" onClick={selectAll} disabled={busy}>
              {selected.size === repairable.length ? "取消全选" : `全选可修 ${repairable.length} 项`}
            </button>
          )}
          <button
            className="tsc-action-btn"
            onClick={dismissSelected}
            disabled={busy || !canDismiss}
            title="标记为「看过了，不用管」，不改内容"
          >
            {busy ? "处理中…" : `忽略所选 ${selected.size} 项`}
          </button>
          {canFix && (
            <button
              className="tsc-action-btn approve"
              onClick={applyFixes}
              disabled={busy || selected.size === 0}
            >
              {busy ? "修复中…" : `确认修复所选 ${selected.size} 项`}
            </button>
          )}
        </div>
      )}
      {!sourceDir && dismissable.length > 0 && (
        <div className="qa-hint">这是一份离线预览，回到对应条目才能执行修复或忽略。</div>
      )}
      {error && <div className="qa-error">{error}</div>}
    </div>
  );
}
