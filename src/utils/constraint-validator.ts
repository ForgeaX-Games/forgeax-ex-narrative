/**
 * 三重约束验证器（移植自 v3 validation/constraint_validator.py）
 *
 * 通过关键词提取 + Jaccard 重叠检测，验证生成内容是否遵守 L2→L3 的三重约束：
 * 1. 边界约束（Boundary）：内容首尾是否匹配 cause/result
 * 2. 范围约束（Scope）：内容是否在 L2 scope 定义的主题范围内
 * 3. 边界校验（Boundary Validation）：是否重复前节点 / 剧透后节点
 * 4. 角色连贯性（Character Continuity）：检测未登记角色、缺少铺垫的角色
 */
import type { CharacterSheet } from "../types/index.js";

export interface ConstraintValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  details: Record<string, unknown>;
}

const STOP_WORDS = new Set([
  "一个", "这个", "那个", "他们", "我们", "可以", "已经", "但是", "因为", "所以",
  "不是", "没有", "什么", "还是", "如果", "就是", "然后", "自己", "这样", "那样",
  "the", "and", "for", "this", "that", "with", "from", "have", "been",
]);

function extractKeywords(text: string, minLen = 2): Set<string> {
  if (!text) return new Set();
  const tokens = text.match(/[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}/g) ?? [];
  return new Set(tokens.filter((t) => t.length >= minLen && !STOP_WORDS.has(t)));
}

function keywordOverlapRatio(sourceKw: Set<string>, targetKw: Set<string>): number {
  if (sourceKw.size === 0) return 1.0;
  let intersect = 0;
  for (const kw of sourceKw) {
    if (targetKw.has(kw)) intersect++;
  }
  return intersect / sourceKw.size;
}

/**
 * 验证边界约束：内容首尾 300 字是否包含 cause/result 关键词。
 *
 * - overlap < 15%: warning
 * - strictBoundary 模式下 overlap < 30% 且子串不匹配: error
 */
export function validateBoundaryConstraints(
  boundaryConstraints: { cause?: string; result?: string } | undefined,
  content: string,
  strictBoundary = false,
): ConstraintValidationResult {
  const result: ConstraintValidationResult = { isValid: true, errors: [], warnings: [], details: {} };
  if (!boundaryConstraints || !content) return result;

  const { cause = "", result: resultState = "" } = boundaryConstraints;
  const contentStart = content.slice(0, 300);
  const contentEnd = content.slice(-300);

  const causeKw = extractKeywords(cause);
  const resultKw = extractKeywords(resultState);
  const startKw = extractKeywords(contentStart);
  const endKw = extractKeywords(contentEnd);

  const causeOverlap = keywordOverlapRatio(causeKw, startKw);
  const resultOverlap = keywordOverlapRatio(resultKw, endKw);

  result.details.boundary_constraints = {
    cause, result: resultState,
    cause_keyword_overlap: Math.round(causeOverlap * 1000) / 1000,
    result_keyword_overlap: Math.round(resultOverlap * 1000) / 1000,
  };

  if (causeKw.size > 0 && causeOverlap < 0.2) {
    result.warnings.push(`内容开头与 cause 关键词重叠度过低(${(causeOverlap * 100).toFixed(0)}%): ${cause.slice(0, 50)}`);
  }
  if (resultKw.size > 0 && resultOverlap < 0.2) {
    result.warnings.push(`内容结尾与 result 关键词重叠度过低(${(resultOverlap * 100).toFixed(0)}%): ${resultState.slice(0, 50)}`);
  }

  if (strictBoundary) {
    if (cause && !contentStart.toLowerCase().includes(cause.toLowerCase()) && causeOverlap < 0.3) {
      result.errors.push(`严格模式：内容开头不符合 cause 约束: ${cause.slice(0, 50)}`);
      result.isValid = false;
    }
    if (resultState && !contentEnd.toLowerCase().includes(resultState.toLowerCase()) && resultOverlap < 0.3) {
      result.errors.push(`严格模式：内容结尾不符合 result 约束: ${resultState.slice(0, 50)}`);
      result.isValid = false;
    }
  }

  return result;
}

/**
 * 验证范围约束：内容关键词必须与 scope 定义的主题有足够重叠。
 * overlap < 10%: warning
 */
export function validateScopeConstraints(
  scopeContent: string | undefined,
  content: string,
): ConstraintValidationResult {
  const result: ConstraintValidationResult = { isValid: true, errors: [], warnings: [], details: {} };
  if (!scopeContent || !content) return result;

  const scopeKw = extractKeywords(scopeContent);
  const contentKw = extractKeywords(content);
  const overlap = keywordOverlapRatio(scopeKw, contentKw);

  result.details.scope_constraints = {
    scope: scopeContent.slice(0, 200),
    content_length: content.length,
    keyword_overlap: Math.round(overlap * 1000) / 1000,
  };

  if (scopeKw.size > 0 && overlap < 0.15) {
    result.warnings.push(`内容与范围约束关键词重叠度过低(${(overlap * 100).toFixed(0)}%)，可能偏离主题`);
  }

  return result;
}

/**
 * 验证边界校验：不重复前节点 result / 不剧透后节点 cause。
 * 与前节点 result 关键词重叠 > 60%: warning（可能重复）
 * 与后节点 cause 关键词重叠 > 60%: warning（可能剧透）
 */
export function validateBoundaryValidation(
  prevResult: string | undefined,
  nextCause: string | undefined,
  content: string,
): ConstraintValidationResult {
  const result: ConstraintValidationResult = { isValid: true, errors: [], warnings: [], details: {} };
  if (!content) return result;

  const contentKw = extractKeywords(content);
  const prevKw = extractKeywords(prevResult ?? "");
  const nextKw = extractKeywords(nextCause ?? "");

  const prevOverlap = prevKw.size > 0 ? keywordOverlapRatio(prevKw, contentKw) : 0;
  const nextOverlap = nextKw.size > 0 ? keywordOverlapRatio(nextKw, contentKw) : 0;

  result.details.boundary_validation = {
    prev_result: prevResult ?? "",
    next_cause: nextCause ?? "",
    prev_overlap: Math.round(prevOverlap * 1000) / 1000,
    next_overlap: Math.round(nextOverlap * 1000) / 1000,
  };

  if (prevKw.size > 0 && prevOverlap > 0.6) {
    result.warnings.push(`内容与前节点 result 关键词重叠过高(${(prevOverlap * 100).toFixed(0)}%)，可能存在内容重复: ${(prevResult ?? "").slice(0, 50)}`);
  }
  if (nextKw.size > 0 && nextOverlap > 0.6) {
    result.warnings.push(`内容与后节点 cause 关键词重叠过高(${(nextOverlap * 100).toFixed(0)}%)，可能存在剧透: ${(nextCause ?? "").slice(0, 50)}`);
  }

  return result;
}

/**
 * 角色连贯性检测：
 * 1. 检测 content 中出现的角色名是否在角色档案中注册
 * 2. 如果有 prevContent，检测首次出现的角色是否在前文有铺垫
 */
export function validateCharacterContinuity(
  content: string,
  characterSheets: CharacterSheet[],
  prevContent?: string,
): ConstraintValidationResult {
  const result: ConstraintValidationResult = { isValid: true, errors: [], warnings: [], details: {} };
  if (!content || characterSheets.length === 0) return result;

  const registeredNames = new Set(characterSheets.map(c => c.name));
  const namePattern = characterSheets
    .map(c => c.name)
    .filter(n => n.length >= 2)
    .sort((a, b) => b.length - a.length);

  if (namePattern.length === 0) return result;

  const mentionedNames = new Set<string>();
  for (const name of namePattern) {
    if (content.includes(name)) mentionedNames.add(name);
  }

  const allChineseNames = content.match(/[\u4e00-\u9fff]{2,4}(?=说|道|笑|叹|喊|问|答|怒|惊|想|看|望|走|跑|站|坐)/g) ?? [];
  const unregistered: string[] = [];
  for (const name of allChineseNames) {
    if (!registeredNames.has(name) && !mentionedNames.has(name) && name.length >= 2) {
      unregistered.push(name);
    }
  }
  const uniqueUnregistered = [...new Set(unregistered)];

  if (uniqueUnregistered.length > 0) {
    result.warnings.push(
      `疑似未注册角色: ${uniqueUnregistered.slice(0, 5).join(", ")}（不在角色档案中）`,
    );
  }

  if (prevContent && mentionedNames.size > 0) {
    const newlyAppearing: string[] = [];
    for (const name of mentionedNames) {
      if (!prevContent.includes(name)) {
        newlyAppearing.push(name);
      }
    }
    if (newlyAppearing.length > 0) {
      result.details.newly_appearing_characters = newlyAppearing;
    }
  }

  result.details.character_continuity = {
    mentioned: [...mentionedNames],
    unregistered: uniqueUnregistered,
  };

  return result;
}

const STRICT_CHAPTER_TYPES = new Set(["opening", "climax", "resolution"]);

/**
 * 聚合验证：对一个节点运行全部三重约束检测。
 * 可选 characterSheets / prevContent 启用角色连贯性检测。
 * 可选 narrativeStage 用于关键节点自动启用 strictBoundary。
 */
export function validateTripleConstraints(node: {
  content: string;
  boundary_constraints?: { cause?: string; result?: string };
  scope_content?: string;
  prev_result?: string;
  next_cause?: string;
  characterSheets?: CharacterSheet[];
  prevContent?: string;
  narrativeStage?: string;
}): ConstraintValidationResult {
  const useStrictBoundary = STRICT_CHAPTER_TYPES.has(node.narrativeStage ?? "");
  const boundary = validateBoundaryConstraints(node.boundary_constraints, node.content, useStrictBoundary);
  const scope = validateScopeConstraints(node.scope_content, node.content);
  const bv = validateBoundaryValidation(node.prev_result, node.next_cause, node.content);

  const allErrors = [...boundary.errors, ...scope.errors, ...bv.errors];
  const allWarnings = [...boundary.warnings, ...scope.warnings, ...bv.warnings];
  const allDetails = { ...boundary.details, ...scope.details, ...bv.details };

  if (node.characterSheets && node.characterSheets.length > 0) {
    const cc = validateCharacterContinuity(node.content, node.characterSheets, node.prevContent);
    allWarnings.push(...cc.warnings);
    allErrors.push(...cc.errors);
    Object.assign(allDetails, cc.details);
  }

  return {
    isValid: boundary.isValid && scope.isValid && bv.isValid,
    errors: allErrors,
    warnings: allWarnings,
    details: allDetails,
  };
}
