import { useEffect, useRef } from "react";
import { useReactFlow } from "reactflow";

/**
 * 画布控件的文档内登记处。
 *
 * 缩放/复位要用 reactflow 实例，而实例只在 `<ReactFlowProvider>` 子树里拿得到；
 * 底部操作条在画布外面，够不着。于是画布挂载时把三个动作登记进来，操作条按名调用。
 * 没有画布（文本视图）时 controls 为 null，按钮相应置灰。
 */
export interface CanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  /**
   * 复原 = 先把节点排回去，再把视窗套回内容。
   *
   * 只挪视窗解决不了"拖乱了"：乱的是节点位置，镜头再怎么对准也还是那一摊。
   * 两侧画布各自给一份重排（编排侧按分层算法算，管线侧回到布局算好的坐标），这里统一在后面
   * 追一次 fitView，用户看到的是一个动作。
   */
  reset: () => void;
}

let controls: CanvasControls | null = null;
const listeners = new Set<(c: CanvasControls | null) => void>();

function publish(next: CanvasControls | null): void {
  controls = next;
  for (const l of listeners) l(next);
}

export function getCanvasControls(): CanvasControls | null {
  return controls;
}

export function subscribeCanvasControls(fn: (c: CanvasControls | null) => void): () => void {
  listeners.add(fn);
  // 订阅即补发当前值：画布与底栏同一次 commit 挂载时，画布的登记 effect 先跑、
  // 底栏的订阅 effect 后跑，那一次 publish 没人听见，缩放/复原键就会一直是死的。
  fn(controls);
  return () => { listeners.delete(fn); };
}

/**
 * 在任一 reactflow 画布内调用一次即可。
 *
 * `relayout` 由画布自己给：它知道"排整齐"在这一侧是什么意思。用 ref 存是为了让登记只跟着
 * 画布实例走一次——重排函数每次渲染都是新的闭包，塞进依赖会把 controls 反复重发一遍。
 */
export function useRegisterCanvasControls(opts?: { relayout?: () => void }): void {
  const rf = useReactFlow();
  const relayoutRef = useRef(opts?.relayout);
  relayoutRef.current = opts?.relayout;

  useEffect(() => {
    const fit = () => rf.fitView({ padding: 0.12, duration: 300 });
    publish({
      zoomIn: () => rf.zoomIn({ duration: 200 }),
      zoomOut: () => rf.zoomOut({ duration: 200 }),
      reset: () => {
        if (!relayoutRef.current) return fit();
        relayoutRef.current();
        // 等新坐标提交进 ReactFlow 再套视窗，否则 fitView 量的还是旧的那一摊。
        window.setTimeout(() => rf.fitView({ padding: 0.15, duration: 400 }), 60);
      },
    });
    return () => publish(null);
  }, [rf]);
}
