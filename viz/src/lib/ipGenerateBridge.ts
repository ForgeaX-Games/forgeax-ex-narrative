/**
 * IpStageFlow「开始生成」触发器的文档内登记处。
 *
 * 重需求（多模态/压缩包/多文件）走 IP DNA 异步管线，其提交动作封在 IpStageFlow 内部
 * （改编范围与自定义补充要先落盘）。底部操作条只能拿到一个闭包，闭包不跨 iframe，
 * 所以这里做的是**同文档**登记：谁渲染了 IpStageFlow，谁负责触发。
 *
 * fire() 返回 false 表示本文档里没有 IpStageFlow，调用方应改走命令槽让 owner 处理。
 */
type Trigger = () => void;

let trigger: Trigger | null = null;

export function registerIpGenerate(fn: Trigger | null): void {
  trigger = fn;
}

export function fireIpGenerate(): boolean {
  if (!trigger) return false;
  trigger();
  return true;
}
