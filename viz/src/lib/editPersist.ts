/**
 * 编辑原文的落盘客户端（契约 docs/contracts.md §3.5）。
 *
 * 此前"保存"只写 zustand 的 `editDrafts`，刷新即失、下游也读不到 —— 界面说保存了，
 * 磁盘上什么都没变。这里把保存真正送到后端：原稿进 `_original/`，改后的内容覆盖
 * ctx 与产物文件，`_edits.json` 记一笔账。
 *
 * `editDrafts` 仍然留着，它管的是另一件事：哪些改动还没重新生成过（⑥ 影响面重生成
 * 要靠它攒待办）。落盘与待办是两件事，不该合成一个。
 */
import { API_BASE } from "../hooks/useNarrativeStream";
import type { QaReport, QaRepairOutcome } from "../types";

export interface SaveEditResult {
  originalContent: unknown;
  /** 后端是否真的落了盘（只问原文、不带改动时为 false）。 */
  persisted: boolean;
}

/**
 * 编辑框里是文本，ctx 里可能是对象 —— 按"原来是什么类型"决定怎么解析回去。
 *
 * 原来是字符串（markdown 正文）就原样送；原来是对象就必须 `JSON.parse`。
 * 解析失败要报错而不是把那段文本当值存进去：后者会把一个对象字段变成字符串，
 * 下游读它的代码会在很远的地方以看不懂的方式崩掉。
 */
export function parseEditedText(text: string, sourceWasString: boolean): unknown {
  if (sourceWasString) return text;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 格式有误，未保存：${(e as Error).message}`);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/api/narrative/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${path} failed: ${res.status}`);
  return data as T;
}

/** 落盘一次编辑。`editedContent` 省略时只回读当前内容，不写盘。 */
export function saveStepEdit(args: {
  sourceDir: string;
  stepId: string;
  nodeId?: string;
  editedContent?: unknown;
  userInput?: string;
}): Promise<SaveEditResult> {
  return post<SaveEditResult>("save-step-edit", args);
}

/** 还原原文。没存过原稿时后端返回 404，这里如实抛出而不是假装成功。 */
export function restoreOriginal(args: {
  sourceDir: string;
  stepId: string;
  nodeId?: string;
}): Promise<{ restoredContent: unknown }> {
  return post<{ restoredContent: unknown }>("restore-original", args);
}

/**
 * 按勾选的问题条目执行修复（契约 §检查到修复）。
 *
 * 回写是原地留版本，不新开任务条目——修复是"这一份的下一版"。返回的 `report`
 * 是修完之后重算的那一份，调用方直接拿它替换掉手上的旧报告即可。
 */
export function applyQaFixes(args: {
  sourceDir: string;
  stepId: string;
  findingIds: string[];
}): Promise<{ applied: number; outcomes: QaRepairOutcome[]; report: QaReport }> {
  return post<{ applied: number; outcomes: QaRepairOutcome[]; report: QaReport }>("qa/apply", args);
}

/**
 * 忽略勾选的问题条目（键权层方案 M3）。"我看过了，不用管"——不碰内容、不留版本快照，
 * 只把 finding 标 `dismissed`，避免复检时同一条又冒出来烦第二次。
 */
export function dismissQaFindings(args: {
  sourceDir: string;
  stepId: string;
  findingIds: string[];
}): Promise<{ dismissed: number; report: QaReport }> {
  return post<{ dismissed: number; report: QaReport }>("qa/dismiss", args);
}

export interface PersistedEdit {
  stepId: string;
  nodeId?: string;
  editedContent?: unknown;
  userInput?: string;
  savedAt: string;
}

/** 读某条目的编辑账本。刷新后据此恢复"哪些改过、可还原"。 */
export async function listEdits(sourceDir: string): Promise<PersistedEdit[]> {
  const res = await fetch(`${API_BASE}/api/narrative/edits/${encodeURIComponent(sourceDir)}`);
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { edits?: PersistedEdit[] } | null;
  return Array.isArray(data?.edits) ? data!.edits : [];
}

/** 账本记录 → `editDrafts` 的键（`stepId` / `stepId::nodeId`），与后端 `editKey` 同形。 */
export const draftKeyOf = (e: { stepId: string; nodeId?: string }): string =>
  e.nodeId ? `${e.stepId}::${e.nodeId}` : e.stepId;
