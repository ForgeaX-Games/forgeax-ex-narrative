import type { StoryStructureCode } from "./story-structures.js";
import { isStoryStructureCode } from "./story-structures.js";
import { getStoryType } from "./story-types.js";
import { getStoryTheme } from "./story-themes.js";
import { getGenreStructureHints } from "./genre-structure-hints.js";

/** 参与投票的三个轴，数组顺序即并列时的优先级。 */
export const STRUCTURE_VOTING_AXES = ["genre", "type", "theme"] as const;
export type StructureVotingAxis = (typeof STRUCTURE_VOTING_AXES)[number];

export interface ResolveStructureInput {
  /** 游戏品类 code（由所选叙事策划专家隐式确定） */
  genreCode?: string | null;
  /** 叙事类型 code */
  storyType?: string | null;
  /** 叙事题材 code */
  storyTheme?: string | null;
  /** 用户或历史条目已明确落盘的结构，命中则短路 */
  explicit?: string | null;
}

export interface ResolvedStructure {
  /** 综合结论；三轴都没给出倾向时为 null（合法状态，策略卡该槽留空） */
  structure: StoryStructureCode | null;
  /** 参与综合的全部候选，按得票降序，用于 UI 展示"为什么是它" */
  candidates: readonly StoryStructureCode[];
  /** 结论来源，便于前端标注是自动推导还是用户指定 */
  source: "explicit" | "vote" | "none";
  /** 各轴给出的倾向原样回传，供 UI 解释 */
  byAxis: Readonly<Record<StructureVotingAxis, readonly StoryStructureCode[]>>;
}

/**
 * 三轴综合推导叙事结构（PRD v1.4 §3.2.2）。
 *
 * 规则：每个轴的 structureHints 按位次加权投票（首选权重最高），并列时按
 * STRUCTURE_VOTING_AXES 的轴优先级裁决 —— 品类 > 类型 > 题材。
 *
 * 现阶段类型轴与题材轴的 structureHints 全为空（表格未定稿），所以结论实际由品类单轴决定；
 * 一旦你把类型/题材的结构倾向填进 story-types.ts / story-themes.ts，这里无需改动即可生效。
 */
export function resolveNarrativeStructure(input: ResolveStructureInput): ResolvedStructure {
  const byAxis = {
    genre: getGenreStructureHints(input.genreCode),
    type: getStoryType(input.storyType)?.structureHints ?? [],
    theme: getStoryTheme(input.storyTheme)?.structureHints ?? [],
  } as Record<StructureVotingAxis, readonly StoryStructureCode[]>;

  if (input.explicit && isStoryStructureCode(input.explicit)) {
    return { structure: input.explicit, candidates: [input.explicit], source: "explicit", byAxis };
  }

  // 位次加权：首选 3 分、次选 2 分、其余 1 分；轴优先级只在总分并列时作为次序键。
  const scores = new Map<StoryStructureCode, { score: number; bestAxis: number }>();
  STRUCTURE_VOTING_AXES.forEach((axis, axisIndex) => {
    byAxis[axis].forEach((code, position) => {
      if (!isStoryStructureCode(code)) return;
      const weight = position === 0 ? 3 : position === 1 ? 2 : 1;
      const prev = scores.get(code);
      if (prev) {
        prev.score += weight;
        prev.bestAxis = Math.min(prev.bestAxis, axisIndex);
      } else {
        scores.set(code, { score: weight, bestAxis: axisIndex });
      }
    });
  });

  if (scores.size === 0) {
    return { structure: null, candidates: [], source: "none", byAxis };
  }

  const candidates = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].bestAxis - b[1].bestAxis)
    .map(([code]) => code);

  return { structure: candidates[0], candidates, source: "vote", byAxis };
}
