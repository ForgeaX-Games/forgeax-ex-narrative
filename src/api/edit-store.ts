/**
 * 编辑原文的账本（契约 docs/contracts.md §3.5）。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么是"双份落盘"
 * ─────────────────────────────────────────────────────────────────
 * 作者改了正文之后，磁盘上要同时存在两份：
 *
 *   `_original/<key>.<ext>`  —— 模型原稿，**只在首次编辑时写一次**
 *   产物文件本身             —— 当前生效的那一份（改后的）
 *
 * 少了原稿那份，"还原原文"就无从还原（重跑模型只会得到另一稿，不是原来那稿）；
 * 少了覆盖产物那步，编辑就只活在浏览器内存里，刷新即失、下游也读不到。
 *
 * `_edits.json` 是这件事的索引：谁改过、改前改后各是什么、什么时候改的。
 * 它不是第三份内容事实源 —— 内容的事实源是上面那两处，账本只回答"改过哪些"。
 *
 * ─────────────────────────────────────────────────────────────────
 * 本模块只做账本的纯逻辑
 * ─────────────────────────────────────────────────────────────────
 * 读写磁盘、改 ctx、重写产物文件都留在 server.ts（那里才有 OUTPUT_DIR 与
 * STEP_FILE_MAP）。这样账本的归并规则可以单测，不用起服务、不用造目录。
 */

/** 一条编辑记录。改前改后都留，`analyze-impact` 要拿它算 diff。 */
export interface EditRecord {
  stepId: string;
  /** 节点级编辑才有；整步编辑为空。 */
  nodeId?: string;
  editedContent: unknown;
  /** 作者顺手写的"为什么这么改"，会带进重生成的提示词。 */
  userInput?: string;
  originalContent: unknown;
  savedAt: string;
}

export interface EditsState {
  edits: EditRecord[];
  updatedAt: string;
}

/**
 * 一条记录的身份：步 + 节点。
 *
 * 与前端 `editDrafts` 的键同形（`stepId::nodeId`），不是巧合 —— 两边说的是同一件事，
 * 键不同形就得在中间加一层翻译，而那层翻译迟早会和某一边不一致。
 */
export function editKey(stepId: string, nodeId?: string): string {
  return nodeId ? `${stepId}::${nodeId}` : stepId;
}

/** 拆回 `(stepId, nodeId)`。只认第一个 `::`：nodeId 自己可能带冒号。 */
export function parseEditKey(key: string): { stepId: string; nodeId?: string } {
  const i = key.indexOf("::");
  if (i < 0) return { stepId: key };
  return { stepId: key.slice(0, i), nodeId: key.slice(i + 2) || undefined };
}

/** 原稿的文件名。落一层目录、不落进产物同级，免得被误当成一份产物导出去。 */
export function originalFileName(stepId: string, nodeId: string | undefined, content: unknown): string {
  const safeKey = editKey(stepId, nodeId).replace(/[/\\?%*:|"<>]/g, "_");
  // 字符串内容按 md 存：原稿要能直接读，JSON 引号转义会让人看不下去。
  return `${safeKey}.${typeof content === "string" ? "md" : "json"}`;
}

/** 原稿候选文件名（读侧不知道当初存的是哪种扩展名）。 */
export function originalFileCandidates(stepId: string, nodeId?: string): string[] {
  const safeKey = editKey(stepId, nodeId).replace(/[/\\?%*:|"<>]/g, "_");
  return [`${safeKey}.json`, `${safeKey}.md`];
}

/** 读到的账本可能是空的/坏的/旧的，一律归一成可用形状。 */
export function normalizeEditsState(raw: unknown): EditsState {
  const rec = (raw ?? {}) as { edits?: unknown; updatedAt?: unknown };
  const edits = Array.isArray(rec.edits)
    ? rec.edits.filter(
        (e): e is EditRecord =>
          !!e && typeof e === "object" && typeof (e as EditRecord).stepId === "string",
      )
    : [];
  return {
    edits,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString(),
  };
}

export function findEdit(state: EditsState, stepId: string, nodeId?: string): EditRecord | undefined {
  const key = editKey(stepId, nodeId);
  return state.edits.find((e) => editKey(e.stepId, e.nodeId) === key);
}

/**
 * 记一次编辑。
 *
 * 同一处改第二次时**保留最初那份 `originalContent`**：原稿只有一个，第二次编辑的"改前"
 * 是第一次编辑的结果，把它当原稿存下来会让"还原原文"还原到一个中间稿。
 */
export function upsertEdit(
  state: EditsState,
  rec: Omit<EditRecord, "savedAt"> & { savedAt?: string },
): EditsState {
  const prior = findEdit(state, rec.stepId, rec.nodeId);
  const key = editKey(rec.stepId, rec.nodeId);
  const next: EditRecord = {
    stepId: rec.stepId,
    nodeId: rec.nodeId,
    editedContent: rec.editedContent,
    userInput: rec.userInput,
    originalContent: prior ? prior.originalContent : rec.originalContent,
    savedAt: rec.savedAt ?? new Date().toISOString(),
  };
  return {
    edits: [...state.edits.filter((e) => editKey(e.stepId, e.nodeId) !== key), next],
    updatedAt: new Date().toISOString(),
  };
}

/** 撤掉一条（还原原文用）。 */
export function removeEdit(state: EditsState, stepId: string, nodeId?: string): EditsState {
  const key = editKey(stepId, nodeId);
  return {
    edits: state.edits.filter((e) => editKey(e.stepId, e.nodeId) !== key),
    updatedAt: new Date().toISOString(),
  };
}

/** 前端 `editDrafts` 的键集合（`stepId` / `stepId::nodeId`）→ 账本视角的记录清单。 */
export function editedKeys(state: EditsState): string[] {
  return state.edits.map((e) => editKey(e.stepId, e.nodeId));
}
