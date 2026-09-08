import { useEffect, useState } from "react";
import { AlignLeft, Maximize, Minus, Network, Plus } from "lucide-react";
import { RunActionBar } from "./RunActionBar";
import { useNarrativeStore } from "../../store/narrativeStore";
import {
  getCanvasControls,
  subscribeCanvasControls,
  type CanvasControls,
} from "../../lib/canvasControls";
import { useT } from "../../i18n";

/**
 * 创作空间的浮层。
 *
 * 主体永远是整片画布，这一层只压在它上面：底部一条居中的纯图标工具条——
 * 开始/取消生成、文本↔节点切换、放大缩小复原，六个同形图标一排。
 *
 * 中央不再浮任何入口卡：需求写在画布的输入节点里，或者直接跟外侧对话栏说。
 * 空态该看到的只有水印，一张挡在中间的卡片只会把画布这个主角遮住。
 */
export function CenterOverlay() {
  const t = useT();
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const setViewMode = useNarrativeStore((s) => s.setViewMode);
  const runtimeError = useNarrativeStore((s) => s.runtimeError);
  const [canvas, setCanvas] = useState<CanvasControls | null>(getCanvasControls);

  useEffect(() => subscribeCanvasControls(setCanvas), []);

  return (
    <div className="cw-overlay">
      {runtimeError && <div className="cw-overlay__error">{runtimeError}</div>}

      <div className="cw-overlay__actions">
        <RunActionBar />

        {/* 视图切换是一个键在两态间翻，图标显示的是"点下去会去哪"。 */}
        <div className="cw-canvasctl" role="group" aria-label={t("app.viewAria")}>
          <button
            type="button"
            className="cw-canvasctl__btn"
            onClick={() => setViewMode(viewMode === "graph" ? "text" : "graph")}
            title={viewMode === "graph" ? t("app.view.text") : t("app.view.graph")}
            aria-label={viewMode === "graph" ? t("app.view.text") : t("app.view.graph")}
          >
            {viewMode === "graph" ? (
              <AlignLeft size={14} strokeWidth={2} aria-hidden />
            ) : (
              <Network size={14} strokeWidth={2} aria-hidden />
            )}
          </button>
        </div>

        {/* 缩放三件套常驻：文本视图下没有画布注册控制器，自然是灰的，位置不跳。 */}
        <div className="cw-canvasctl" role="group" aria-label={t("canvas.aria")}>
          <button
            type="button"
            className="cw-canvasctl__btn"
            onClick={() => canvas?.zoomIn()}
            disabled={!canvas || viewMode !== "graph"}
            title={t("canvas.zoomIn")}
            aria-label={t("canvas.zoomIn")}
          >
            <Plus size={14} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="cw-canvasctl__btn"
            onClick={() => canvas?.zoomOut()}
            disabled={!canvas || viewMode !== "graph"}
            title={t("canvas.zoomOut")}
            aria-label={t("canvas.zoomOut")}
          >
            <Minus size={14} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="cw-canvasctl__btn"
            onClick={() => canvas?.reset()}
            disabled={!canvas || viewMode !== "graph"}
            title={t("canvas.reset")}
            aria-label={t("canvas.reset")}
          >
            <Maximize size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
