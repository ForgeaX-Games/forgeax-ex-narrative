import { useT, tStepLabel } from "../../i18n";
import { STEP_LABEL_MAP } from "../../lib/routingCatalog";

/**
 * Phase 4: 分析影响面预览 modal。
 * 用户编辑 step 后点 ▶ 重新生成 → 调 /analyze-impact → 弹这个 modal 显示：
 *   - LLM 推理（reasoning）
 *   - 重新生成的 fromStepId
 *   - 受影响 step（红色"将重新生成"）
 *   - 保留的 step（绿色"将保留"）
 * 用户点"确认重新生成"才真正触发 /regenerate + startFork。
 */
export function ImpactPreviewModal({
  fromStepId,
  pipelineOrder,
  affectedSteps,
  skipSteps,
  reasoning,
  fallback,
  submitting,
  onConfirm,
  onCancel,
}: {
  fromStepId: string;
  pipelineOrder: string[];
  affectedSteps: string[];
  skipSteps: string[];
  reasoning: string;
  fallback?: boolean;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const fromIdx = pipelineOrder.indexOf(fromStepId);
  const preserved = fromIdx > 0 ? pipelineOrder.slice(0, fromIdx) : [];
  const willRerun = fromIdx >= 0
    ? pipelineOrder.slice(fromIdx).filter((id) => !skipSteps.includes(id))
    : affectedSteps;

  const labelOf = (id: string) => tStepLabel(id, STEP_LABEL_MAP.get(id) ?? id);

  return (
    <div className="impact-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="impact-modal">
        <div className="impact-modal-header">
          <span className="impact-modal-title">{t("impact.title")}</span>
          {fallback && <span className="impact-modal-fallback">{t("impact.fallback")}</span>}
          <button className="impact-modal-close" onClick={onCancel} aria-label={t("impact.close")}>×</button>
        </div>

        <div className="impact-modal-body">
          {reasoning && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title">{t("impact.section.reasoning")}</div>
              <div className="impact-modal-reasoning">{reasoning}</div>
            </div>
          )}

          <div className="impact-modal-section">
            <div className="impact-modal-section-title">{t("impact.section.from")}</div>
            <div className="impact-modal-from-step">▶ {labelOf(fromStepId)}（{fromStepId}）</div>
          </div>

          {preserved.length > 0 && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title impact-modal-preserved-title">
                {t("impact.section.preserve", { n: preserved.length })}
              </div>
              <div className="impact-modal-step-list impact-modal-preserved-list">
                {preserved.map((id) => (
                  <div key={id} className="impact-modal-step impact-modal-step--preserved">
                    {labelOf(id)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {willRerun.length > 0 && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title impact-modal-rerun-title">
                {t("impact.section.rerun", { n: willRerun.length })}
              </div>
              <div className="impact-modal-step-list impact-modal-rerun-list">
                {willRerun.map((id) => (
                  <div key={id} className="impact-modal-step impact-modal-step--rerun">
                    {labelOf(id)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {skipSteps.length > 0 && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title impact-modal-skip-title">
                {t("impact.section.skip", { n: skipSteps.length })}
              </div>
              <div className="impact-modal-step-list impact-modal-skip-list">
                {skipSteps.map((id) => (
                  <div key={id} className="impact-modal-step impact-modal-step--skip">
                    {labelOf(id)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="impact-modal-footer">
          <button className="impact-modal-btn impact-modal-btn--cancel" onClick={onCancel} disabled={submitting}>
            {t("impact.cancel")}
          </button>
          <button className="impact-modal-btn impact-modal-btn--confirm" onClick={onConfirm} disabled={submitting}>
            {submitting ? t("impact.confirmBusy") : t("impact.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
