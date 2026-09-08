/**
 * vn-v2/index.ts — 影游叙事 v2 专属管线（tpl-vn-v2）9 个 step 的统一导出
 *
 * 与 MyFile/提示词/影游叙事生成提示词/0X_*.md 一一对应：
 *   E1 主路径（无上传剧本）：
 *     vnLogline           E1-01 用户需求预处理
 *     vnOutlineActs       E1-02 故事梗概扩写（三幕 + 人物小传）
 *     vnBeats             E1-04 情节点搭建（线性黄金线；场号改 G-01 末尾导出，§4.6c）
 *   E2 旁路（有上传剧本时插入）：
 *     vnScriptNormalize   E2-01 用户剧本预处理
 *     vnSegmentConfirm    E2-02 影游化文本段确认
 *   G 路径（剧本游戏化改造）：
 *     vnBranchedBeats     G-01 剧情树改造
 *     vnScreenplay        G-02 剧本创作
 *     vnStoryboard        G-03 分镜设计
 */
export { vnLogline } from "./vn-logline.js";
export { vnOutlineActs } from "./vn-outline-acts.js";
export { vnBeats } from "./vn-beats.js";
export { vnScriptNormalize } from "./vn-script-normalize.js";
export { vnSegmentConfirm } from "./vn-segment-confirm.js";
export { vnBranchedBeats } from "./vn-branched-beats.js";
export { vnStateLedger, computeWorldSnapshot, renderWorldSnapshot } from "./vn-state-ledger.js";
export { vnScreenplay } from "./vn-screenplay.js";
export { vnStoryboard } from "./vn-storyboard.js";
