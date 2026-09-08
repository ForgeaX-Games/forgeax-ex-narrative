import { t as tGlobal } from "./index";

type Vars = Record<string, string | number>;
type T = (key: string, vars?: Vars) => string;

/**
 * The narrative backend (IP-DNA orchestrator / job / server) emits progress
 * messages in Chinese. They carry a `phase` (not a stepId) and interpolate data,
 * so we re-localize them on the frontend by matching known patterns. Unmatched
 * messages pass through unchanged (already-English text is left untouched).
 */
const RULES: Array<{ re: RegExp; key: string; map?: (m: RegExpMatchArray) => Vars }> = [
  { re: /^解压压缩包并归档原始资产$/, key: "ipbk.phase0.unpack" },
  { re: /^仅打包落盘/, key: "ipbk.phase0.packOnly" },
  { re: /^断点续传：加载已持久化/, key: "ipbk.phase1.resume" },
  { re: /^构建叙事层级树（标准化）$/, key: "ipbk.phase1.buildTree" },
  { re: /^多文件建树：结构=(.+?)、聚合层数=(.+)$/, key: "ipbk.phase1.multiTree", map: (m) => ({ structure: m[1], levels: m[2] }) },
  { re: /^干扰项过滤：剔除\s*(\d+)\s*个非正文节点（(.*)）$/, key: "ipbk.phase1.noiseFilter", map: (m) => ({ n: m[1], titles: m[2] }) },
  { re: /^体量评估：(.+?)（超线，建议拆\s*(\d+)\s*块）$/, key: "ipbk.phase1.volumeDecompose", map: (m) => ({ basis: m[1], n: m[2] }) },
  { re: /^体量评估：(.+)$/, key: "ipbk.phase1.volume", map: (m) => ({ basis: m[1] }) },
  { re: /^按标记边界拆解为\s*(\d+)\s*块$/, key: "ipbk.phase1.decomposeMark", map: (m) => ({ n: m[1] }) },
  { re: /^拆解闭环：(\d+)\s*轮，新增\s*(\d+)\s*个子单元/, key: "ipbk.phase1.decomposeLoop", map: (m) => ({ iters: m[1], units: m[2] }) },
  { re: /^组装改编指令/, key: "ipbk.adapt.assemble" },
  { re: /^提取单元\s*(\d+)\/(\d+)：(.+)$/, key: "ipbk.extract.unit", map: (m) => ({ i: m[1], n: m[2], title: m[3] }) },
  { re: /^逐层聚合：规模=(.+?)（(\d+)\s*叶\/批(\d+)）$/, key: "ipbk.extract.aggregate", map: (m) => ({ scale: m[1], leaf: m[2], batch: m[3] }) },
  { re: /^映射游戏单元\s*(\d+)（(\d+)\s*单元）$/, key: "ipbk.mapping.unit", map: (m) => ({ index: m[1], n: m[2] }) },
  { re: /^生成游戏单元\s*(\d+)\/(\d+)$/, key: "ipbk.gen.unit", map: (m) => ({ i: m[1], n: m[2] }) },
  { re: /^IP DNA 端到端流程完成$/, key: "ipbk.done" },
  { re: /^已取消生产$/, key: "ipbk.job.cancelled" },
  { re: /^标准化完成，等待确认裁剪范围$/, key: "ipbk.server.awaitConfirm" },
];

export function localizeBackendMessage(msg: string | null | undefined, t: T = tGlobal): string {
  if (!msg || !/[\u4e00-\u9fff]/.test(msg)) return msg ?? "";
  for (const rule of RULES) {
    const m = msg.match(rule.re);
    if (m) return t(rule.key, rule.map ? rule.map(m) : undefined);
  }
  return msg;
}
