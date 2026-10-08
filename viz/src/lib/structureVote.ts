/**
 * 叙事结构的推导结论与依据。
 *
 * 结构不是用户从空白下拉框里挑的，而是品类 / 类型 / 题材三条轴各自推荐、投票综合
 * 出来的，然后它去规定整棵剧情树的分叉密度、是否收束、有几个结局。所以界面要能
 * 回答两个问题：推出了什么，以及凭什么 —— 否则第四轴既不可见也不可信。
 */
export interface StructureVote {
  /** 结论（12 码之一）；三轴全空时为 null，是合法状态。 */
  structure: string | null;
  source: "explicit" | "vote" | "none";
  /** 按票数降序的全部候选，仅投票得出时有。 */
  candidates?: string[];
  /** 每条轴各自推荐了什么，空表的轴不出现。 */
  byAxis?: Record<string, string[]>;
  /** 标签路径下由哪个标签维度兜底推出了类型/题材。 */
  tagDerived?: Record<string, { dimension: string; value: string }>;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * 从 `/plan` 回的 manifest config 里取结构结论与依据。
 *
 * config 是弱类型字典（后端按需加字段），所以逐个探而不是整体断言。
 * 既没有结论、也没发生过投票时返回 null —— 三轴全空是合法状态，那时在界面上
 * 显示一个"未选"的空壳只会让人以为哪里漏配了。
 */
export function readStructureVote(
  config: Record<string, unknown> | undefined | null,
): StructureVote | null {
  if (!config) return null;

  const structure =
    typeof config.narrativeStructure === "string" && config.narrativeStructure
      ? config.narrativeStructure
      : null;
  const rawSource = config.structureSource;
  const source =
    rawSource === "explicit" || rawSource === "vote" || rawSource === "none" ? rawSource : "none";
  if (!structure) return null;

  const rationale =
    typeof config.structureRationale === "object" && config.structureRationale !== null
      ? (config.structureRationale as Record<string, unknown>)
      : {};

  const byAxis: Record<string, string[]> = {};
  if (typeof rationale.byAxis === "object" && rationale.byAxis !== null) {
    for (const [axis, codes] of Object.entries(rationale.byAxis as Record<string, unknown>)) {
      if (isStringArray(codes) && codes.length > 0) byAxis[axis] = codes;
    }
  }

  const vote: StructureVote = { structure, source };
  if (isStringArray(rationale.candidates) && rationale.candidates.length > 0) {
    vote.candidates = rationale.candidates;
  }
  if (Object.keys(byAxis).length > 0) vote.byAxis = byAxis;
  if (typeof rationale.tagDerived === "object" && rationale.tagDerived !== null) {
    vote.tagDerived = rationale.tagDerived as StructureVote["tagDerived"];
  }
  return vote;
}
