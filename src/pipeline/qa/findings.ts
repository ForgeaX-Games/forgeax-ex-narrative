/**
 * findings.ts — 两个检查席共用的「一条问题」形状
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么要归一
 * ─────────────────────────────────────────────────────────────────
 * 检查席的价值不在于报告本身，而在于「报出来的问题能被勾选、能被修」。
 * 内容检查一开始就是结构化的 `findings[]`，结构检查却把问题散在
 * `endings.issues` / `pacing.issues` / `functions.issues` 三处的裸字符串数组里——
 * 一条问题连稳定标识都没有，前端没法勾、后端没法定位，只能整份报告读一遍。
 *
 * 归一之后两席同形，前端一套面板、后端一条修复入口。
 *
 * ─────────────────────────────────────────────────────────────────
 * repairKind：这条问题走哪条修法
 * ─────────────────────────────────────────────────────────────────
 * - `topology` —— 图上的事（断边、环、悬挂分支、走不到的结局），走连接修复；
 * - `content` —— 文字上的事（矛盾、吃书、逻辑不通），走定点重写；
 * - 缺席 —— 只报不修。单元长度失衡、结局数量偏多这类要作者自己判断怎么办，
 *   没有可自动执行的修法。前端据此不给这条画勾选框，而不是给了点下去没反应。
 */

/** 修复路径。缺席表示这条问题只报不修。 */
export type RepairKind = "topology" | "content";

/**
 * 一条问题的生命周期（键权层方案 M3）。
 *
 * 缺省即 `"open"`——旧报告、旧 checkpoint 没有这个字段，读侧按"待处理"兼容，
 * 不是异常。`"fixed"`/`"dismissed"` 都是终态：前者是系统认定已修好，后者是
 * 用户认定不用管，两者都不该在复检时又冒出来烦用户第二次。
 */
export type QaFindingStatus = "open" | "fixed" | "dismissed";

export interface QaFinding {
  /**
   * 稳定标识。同一份产物重复检查要得到同一个 id——否则用户勾了一批、
   * 报告刷新一次，勾选就全部对不上号了。所以由内容而非序号算出来。
   *
   * 这个"内容而非序号"的性质还有第二个用途（M3）：报告整份重算后，同一个 id
   * 再次出现就等于"同一处问题、特征没变"——`mergeFindingStatuses` 据此判断
   * 要不要把旧的 fixed/dismissed 状态带过去，不必另外维护一张哈希表。
   */
  id: string;
  /** 归哪一项检查（内容检查的八项判据 / 结构检查的检查面）。 */
  criterion: string;
  /** 出问题的节点。跨节点问题写 "global"。 */
  nodeId: string;
  severity: "error" | "warn";
  /** 问题本身。 */
  issue: string;
  /** 原文片段或问题现场——没有它，作者要自己在几万字里找。 */
  excerpt: string;
  /** 怎么改。允许写"需回到某席重生成"。 */
  suggestion: string;
  /** 修复路径；缺席即只报不修。 */
  repairKind?: RepairKind;
  /** 修复要落到哪个 ctx 字段（结构问题分层，得说清是哪一层）。 */
  targetField?: string;
  /** 缺省视为 `"open"`。 */
  status?: QaFindingStatus;
  /** 标 `"fixed"` 时指回改动落在哪一版（M2 版本溯源的版本号）。 */
  fixedInVersion?: number;
  /** 尝试修复失败时的原因；status 仍保持 `"open"`，供用户看到"为什么没成功"。 */
  lastError?: string;
}

/**
 * 内容取 id：同样的问题算出同样的 id，报告重跑后勾选仍对得上。
 *
 * FNV-1a 就够——这不是安全场景，要的只是"短、稳定、够分散"。
 */
export function findingId(scope: string, ...parts: string[]): string {
  const input = [scope, ...parts].join("\u0000");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${scope}-${hash.toString(16).padStart(8, "0")}`;
}

/** 带 findings 的报告（两个检查席的报告都满足）。 */
export interface QaReport {
  verdict: "pass" | "warn" | "fail";
  summary: string;
  findings: QaFinding[];
  checkedAt: string;
}

/** 报告里可修的那些条目（有 repairKind 的）。 */
export function repairableFindings(findings: readonly QaFinding[]): QaFinding[] {
  return findings.filter((f) => f.repairKind !== undefined);
}

/**
 * 报告整份重算后（检查席重跑 / qa/apply 后局部刷新），把旧报告里已 `fixed`/
 * `dismissed` 的状态带到新报告的同 id 条目上。
 *
 * 为什么可以直接按 id 对——`id` 本身就是问题特征的哈希（见 `findingId`）：
 * 新报告里出现同一个 id，意味着"同一处问题、特征没变"，那条目原来的处置
 * 结论（修过了 / 不用管）仍然成立，不该在用户眼里凭空"复活"成待处理。
 * id 没有再出现，则问题已经不在——新报告本来就不会含它，无需特殊处理。
 * 新 id（旧报告没有）保持调用方给的缺省状态（通常是 `open`）。
 */
export function mergeFindingStatuses(
  oldFindings: readonly QaFinding[],
  newFindings: readonly QaFinding[],
): QaFinding[] {
  const byId = new Map(oldFindings.map((f) => [f.id, f]));
  return newFindings.map((f) => {
    const prior = byId.get(f.id);
    if (!prior || (prior.status ?? "open") === "open") return f;
    return { ...f, status: prior.status, fixedInVersion: prior.fixedInVersion, lastError: prior.lastError };
  });
}
