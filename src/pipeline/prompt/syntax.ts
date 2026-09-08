/**
 * pipeline/prompt/syntax.ts —— 统一占位符语法（取代分散的三套写法）。
 *
 * 历史现状：提示词来自多个来源、用了 3 套占位写法（{{SKILL.*}} / {{ctx.*}} / 末尾 append）。
 * 本模块提供单一的占位解析器，统一支持：
 *
 *   {{slot:NAME}}          —— 可插拔片段插槽（由 provider 填充，见 providers.ts）
 *   {{ctx.PATH}}           —— 运行时 ctx 数据（点路径，对象自动 JSON 化）
 *   {{data:FN}}            —— 数据摘要助手（无参）
 *   {{data:FN(ARG)}}       —— 数据摘要助手（单参，ARG 原样传入）
 *   {{SKILL.NAME}}         —— 兼容旧写法，等价 {{slot:SKILL.NAME}}
 *   {{IP_DNA.NAME}}        —— IP DNA 注入段占位（T2），等价 {{slot:IP_DNA.NAME}}
 *
 * 未提供 resolver 的占位一律替换为空串（不留痕迹），与旧行为一致。
 */
import type { NarrativeContext } from "../../types/index.js";

const SLOT_PLACEHOLDER = /\{\{slot:([\w.\-]+)\}\}/g;
const CTX_PLACEHOLDER = /\{\{ctx\.([\w_.]+)\}\}/g;
const DATA_PLACEHOLDER = /\{\{data:([\w]+)(?:\(([^)]*)\))?\}\}/g;
const SKILL_PLACEHOLDER = /\{\{SKILL\.([\w_]+)\}\}/g;
const IP_DNA_PLACEHOLDER = /\{\{IP_DNA\.([\w_]+)\}\}/g;

export interface PlaceholderResolution {
  /** {{ctx.*}} 数据来源。 */
  ctx?: NarrativeContext;
  /**
   * {{slot:*}} / {{SKILL.*}} / {{IP_DNA.*}} 的内容来源。
   * 键为槽名（SKILL./IP_DNA. 前缀保留），缺省/undefined → 空串。
   */
  slots?: Record<string, string | undefined>;
  /** {{data:FN(ARG)}} 摘要助手注册表。 */
  data?: Record<string, (arg: string) => string>;
}

/** 解析 ctx 点路径为字符串（对象 JSON 化，与旧 prompt-resolver 行为一致）。 */
export function resolveCtxPath(ctx: NarrativeContext | undefined, fieldPath: string): string {
  if (!ctx) return "";
  const parts = fieldPath.split(".");
  let current: unknown = ctx;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return "";
  if (typeof current === "string") return current;
  return JSON.stringify(current, null, 2);
}

/**
 * 统一占位解析。按顺序处理 slot / IP_DNA / SKILL / data / ctx 占位。
 */
export function renderPlaceholders(text: string, resolution: PlaceholderResolution): string {
  const slots = resolution.slots ?? {};
  let out = text.replace(SLOT_PLACEHOLDER, (_, name: string) => slots[name] ?? "");
  out = out.replace(IP_DNA_PLACEHOLDER, (_, name: string) => slots[`IP_DNA.${name}`] ?? "");
  out = out.replace(SKILL_PLACEHOLDER, (_, name: string) => slots[`SKILL.${name}`] ?? slots[name] ?? "");
  out = out.replace(DATA_PLACEHOLDER, (_, fn: string, arg?: string) => {
    const helper = resolution.data?.[fn];
    return helper ? helper(arg ?? "") : "";
  });
  out = out.replace(CTX_PLACEHOLDER, (_, fieldPath: string) => resolveCtxPath(resolution.ctx, fieldPath));
  return out;
}

/** 文本是否包含任意已知占位（用于判断 step 模板是否已结构化声明插槽）。 */
export function hasPlaceholders(text: string): boolean {
  return (
    /\{\{slot:[\w.\-]+\}\}/.test(text) ||
    /\{\{IP_DNA\.[\w_]+\}\}/.test(text) ||
    /\{\{SKILL\.[\w_]+\}\}/.test(text) ||
    /\{\{data:[\w]+(?:\([^)]*\))?\}\}/.test(text) ||
    /\{\{ctx\.[\w_.]+\}\}/.test(text)
  );
}

/** 是否包含 IP DNA 结构化占位（决定注入用"填占位"而非"末尾 append"）。 */
export function hasIpDnaPlaceholders(text: string): boolean {
  return /\{\{IP_DNA\.[\w_]+\}\}/.test(text) || /\{\{slot:(operators|relations|ledger|objective_truth|synthesis)\}\}/.test(text);
}

/**
 * 是否包含叙事策略结构化占位。
 * 与 IP DNA 分开判断：只声明策略段、不声明 IP DNA 段的 step（如需求清单、策划文档）
 * 也必须走占位渲染，否则策略卡会连同占位符一起留在提示词里。
 */
export function hasStrategyPlaceholders(text: string): boolean {
  return /\{\{slot:strategy_(genre|type|theme|structure)\}\}/.test(text);
}
