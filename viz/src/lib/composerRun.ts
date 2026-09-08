/**
 * 编排画布「开跑」动作的文档内登记处。
 *
 * 底栏那个开始键在画布外面，够不着 ComposerView 里那套锚定管线解析；
 * 而两个开始键并排摆着（画布里一个、底栏一个）用户只会犯迷糊。
 * 于是画布把自己的开跑动作登记进来，底栏按名调用——与 canvasControls 同一套路数。
 *
 * 没登记（文本视图、或已有条目在跑因而画布是只读管线图）时为 null，
 * 底栏自动退回条目那条常规启动路径。
 */
export interface ComposerRunner {
  run: () => void;
  /** 画布上有没有可跑的东西；false 时底栏的开始键置灰。 */
  canRun: boolean;
  /** 正在启动，避免连点。 */
  starting: boolean;
}

let runner: ComposerRunner | null = null;
const listeners = new Set<(r: ComposerRunner | null) => void>();

function publish(next: ComposerRunner | null): void {
  runner = next;
  for (const l of listeners) l(next);
}

export function getComposerRunner(): ComposerRunner | null {
  return runner;
}

export function subscribeComposerRunner(fn: (r: ComposerRunner | null) => void): () => void {
  listeners.add(fn);
  // 订阅即补发当前值，否则订阅晚于登记的那一次就永远收不到。
  // 画布与底栏同一次 commit 挂载时（刷新后直接落在编排态），画布的登记 effect 先跑、
  // 底栏的订阅 effect 后跑，中间那一次 publish 没人听见：底栏停在 render 时读到的 null，
  // 于是开始键退回条目那条路径并置灰——画布上明明摆着入口节点，键却是死的。
  fn(runner);
  return () => { listeners.delete(fn); };
}

export function registerComposerRunner(next: ComposerRunner): void {
  publish(next);
}

export function clearComposerRunner(): void {
  publish(null);
}
