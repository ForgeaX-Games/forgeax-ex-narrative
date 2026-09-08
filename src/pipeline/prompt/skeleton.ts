/**
 * pipeline/prompt/skeleton.ts —— 统一提示词骨架（蓝图 §7.2b）。
 *
 * 一份固定的、语义明确的提示词骨架：把"来自多个来源"的提示词片段
 * 收敛到有序命名插槽里。每个插槽由一个 fragment provider 提供内容
 * （见 providers.ts），assembler/runner 只负责按固定顺序拼装。
 *
 * 段序对齐 PRD v1.4 §4.2.4（2）的八段骨架：
 *   ① 角色 → ② 任务 → ③ 叙事策略（四子槽）→ ④ IP DNA（四子槽）
 *   → ⑤ 约束与格式 → ⑥ 机制与流程 → ⑦ 上下文输入 → ⑧ 输出格式
 *
 * "八段"指的是语义段，其中叙事策略与 IP DNA 各自展开为四个并列子槽，
 * 因此扁平插槽共 14 个。子槽内部顺序也在此固定，不允许 step 各自决定。
 *
 * 相对 v1.3 十槽骨架的两处换轴（三期）：
 *   - genre_style 并入叙事策略段，改名 strategy_genre，位置从 IP DNA 之后提到之前
 *     —— 策略先立、DNA 后填，避免品类风格被算子内容淹没；
 *   - material 从第 3 段挪到第 7 段，与 CSV「上下文输入」列的位次对齐。
 *   两处改动都不影响现网提示词：生产模板从未声明过 {{slot:genre_style}} 或
 *   {{slot:material}}，这两个插槽此前只有 provider、没有消费方。
 *
 * 设计要点：
 *   - 纯函数、零运行时依赖，可单测；
 *   - provider 缺省某插槽 → 该段不出现（不留空标题）；
 *   - 不强制 step 使用全部插槽，只拼有内容的段。
 */

/** 提示词骨架的命名插槽（顺序即最终拼装顺序）。 */
export type PromptSlot =
  // ① 角色
  | "role"
  // ② 任务
  | "task"
  // ③ 叙事策略：四轴各占一个子槽
  | "strategy_genre"
  | "strategy_type"
  | "strategy_theme"
  | "strategy_structure"
  // ④ IP DNA：叙事模板与叙事算子
  | "objective_truth"
  | "operators"
  | "relations"
  | "ledger"
  // ⑤⑥⑦⑧
  | "constraints"
  | "cot"
  | "material"
  | "output";

/** 骨架插槽的固定顺序（PRD v1.4 §4.2.4）。 */
export const PROMPT_SLOT_ORDER: readonly PromptSlot[] = [
  "role",
  "task",
  "strategy_genre",
  "strategy_type",
  "strategy_theme",
  "strategy_structure",
  "objective_truth",
  "operators",
  "relations",
  "ledger",
  "constraints",
  "cot",
  "material",
  "output",
] as const;

/** 每个插槽的可选默认标题（仅当 wrapHeadings=true 且该段无自带标题时使用）。 */
export const PROMPT_SLOT_HEADINGS: Readonly<Record<PromptSlot, string>> = {
  role: "## 身份与定位",
  task: "## 本次任务",
  strategy_genre: "## 叙事策略 · 游戏品类",
  strategy_type: "## 叙事策略 · 叙事类型",
  strategy_theme: "## 叙事策略 · 叙事题材",
  strategy_structure: "## 叙事策略 · 叙事结构",
  objective_truth: "## 客观真相（IP 叙事内核切片，须忠实遵守）",
  operators: "## 三视角算子（同台综合 §7.2b）",
  relations: "## 关系网络（KAG，须保持一致）",
  ledger: "## 长记忆账本（续写改写一致性约束）",
  constraints: "## 约束与格式",
  cot: "## 机制与流程",
  material: "## 素材与上下文",
  output: "## 输出格式",
};

/** 一个插槽的内容映射（缺省/空串的插槽不进入最终提示词）。 */
export type SlotSections = Partial<Record<PromptSlot, string>>;

export interface AssembleOptions {
  /**
   * 为无自带标题的段补默认标题（PROMPT_SLOT_HEADINGS）。
   * 默认 false：直接拼接 provider 给的原文（多数 provider 已自带标题）。
   */
  wrapHeadings?: boolean;
  /** 段间分隔符，默认两个换行。 */
  separator?: string;
}

function looksLikeHasHeading(text: string): boolean {
  return /^\s*#{1,6}\s/.test(text);
}

/**
 * 按固定骨架顺序拼装非空插槽，得到最终提示词文本。
 *
 * 定位：骨架段序契约的**纯函数参考实现**（单测覆盖）。生产引擎不直接调用本函数，而是
 * 复用同一份 PROMPT_SLOT_ORDER（见 prompt-composer.ts 的 IP_DNA_SLOT_BLOCK 派生 +
 * composeSystemPrompt → buildSlotMap），由 skeleton-contract.test.ts 保证段序与本实现一致。
 */
export function assemblePrompt(sections: SlotSections, options: AssembleOptions = {}): string {
  const sep = options.separator ?? "\n\n";
  const parts: string[] = [];
  for (const slot of PROMPT_SLOT_ORDER) {
    const raw = sections[slot];
    if (!raw || raw.trim().length === 0) continue;
    const body = raw.trim();
    if (options.wrapHeadings && !looksLikeHasHeading(body)) {
      parts.push(`${PROMPT_SLOT_HEADINGS[slot]}\n${body}`);
    } else {
      parts.push(body);
    }
  }
  return parts.join(sep);
}
