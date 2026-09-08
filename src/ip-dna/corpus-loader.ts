/**
 * 算子语料加载 / 适配 —— 蓝图 §7「RAG 算子装备」。
 *
 * 把 knowledge_base/methods_3_converted.jsonl（52919 条，富 schema）适配为系统的
 * 8 字段 NarrativeOperator，并由 applicable_scope 推断知识域 → 驱动三视角分桶。
 *
 * 向量检索（embeddings.npy + e5 模型）属本地依赖接缝（§7.3）：本版默认走结构化(标签/域)
 * + 关键词降级检索，确定性可单测；向量可用时再叠加（retrieval_config.json 已就绪）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { NarrativeOperator } from "../types/narrative-ip-dna.js";

/** 语料原始条目（methods_3_converted.jsonl 的一行）。 */
export interface CorpusEntry {
  uid: string;
  name: string;
  definition: string;
  tags?: string[];
  sources?: Array<{ book_uid?: string; chapter?: string }>;
  applicable_scope?: Record<string, Record<string, string[]>>;
}

/** 五大知识域 → applicable_scope 顶层键。 */
const SCOPE_DOMAIN: Array<{ key: string; domain: string }> = [
  { key: "narrator_positioning", domain: "叙事者定位" },
  { key: "emotional_experience", domain: "情感体验" },
  { key: "literary_style", domain: "文学风格" },
  { key: "story_content", domain: "故事内容" },
  { key: "narrative_techniques", domain: "叙事技巧" },
];

export interface LoadCorpusOptions {
  /** knowledge_base 目录；缺省自动定位（模块相对 → cwd 兜底）。 */
  kbDir?: string;
  /** 仅加载前 N 条（测试用）。 */
  limit?: number;
}

let _cache: NarrativeOperator[] | undefined;

/** 定位 knowledge_base 目录。 */
export function resolveKnowledgeBaseDir(kbDir?: string): string {
  if (kbDir) return kbDir;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const moduleRelative = path.resolve(here, "../../knowledge_base");
  if (fs.existsSync(moduleRelative)) return moduleRelative;
  return path.resolve(process.cwd(), "knowledge_base");
}

/** 统计某 applicable_scope 各域非空叶子数，返回非空叶子最多的域（按固定优先级断平）。 */
function dominantDomain(scope: CorpusEntry["applicable_scope"]): { domain: string; characterFlag: boolean } {
  if (!scope) return { domain: "故事内容", characterFlag: false };
  let best = SCOPE_DOMAIN[3]; // 默认故事内容
  let bestCount = -1;
  let characterFlag = false;
  for (const { key, domain } of SCOPE_DOMAIN) {
    const bucket = scope[key];
    if (!bucket) continue;
    let count = 0;
    for (const [leaf, arr] of Object.entries(bucket)) {
      const n = Array.isArray(arr) ? arr.length : 0;
      count += n;
      if (n > 0 && /character|人物|角色/i.test(leaf)) characterFlag = true;
    }
    if (count > bestCount) {
      bestCount = count;
      best = { key, domain };
    }
  }
  return { domain: best.domain, characterFlag };
}

/**
 * 适配单条语料 → NarrativeOperator（8 字段）。
 * - knowledge_domain：主导知识域（含人物特征时标注 "·人物" 以路由到角色视角，§4.5）。
 * - usage_guide：打包标签（兼作关键词检索的标签通道，对齐 retrieval_config.tag 权重）。
 * - knowledge_location：首个来源书目（剥离 BOOK:: 前缀）。
 */
export function adaptCorpusEntry(entry: CorpusEntry): NarrativeOperator {
  const { domain, characterFlag } = dominantDomain(entry.applicable_scope);
  const tags = entry.tags ?? [];
  const firstSource = entry.sources?.[0];
  const location = (firstSource?.book_uid ?? "").replace(/^BOOK::/, "") || "知识库";
  return {
    uid: entry.uid,
    name: entry.name,
    definition: entry.definition,
    adaptation: { type: domain, element: tags[0] ?? "" },
    usage_guide: tags.length ? `适用标签：${tags.join("、")}` : "",
    example: firstSource?.chapter ? `出处片段：${firstSource.chapter}` : "",
    knowledge_location: location,
    // 含人物特征的故事内容算子 → 角色视角；情感体验 → 读者视角；其余 → 作者视角。
    knowledge_domain: domain === "故事内容" && characterFlag ? "故事内容·人物" : domain,
  };
}

/**
 * 加载并适配整份算子语料（带模块级缓存）。
 * 文件不存在时返回空数组（降级：检索器为空 → 槽位走 LLM 生成兜底）。
 */
export function loadOperatorCorpus(options: LoadCorpusOptions = {}): NarrativeOperator[] {
  if (!options.kbDir && options.limit == null && _cache) return _cache;

  const kbDir = resolveKnowledgeBaseDir(options.kbDir);
  const jsonlPath = path.join(kbDir, "methods_3_converted.jsonl");
  if (!fs.existsSync(jsonlPath)) return [];

  const ops: NarrativeOperator[] = [];
  const lines = fs.readFileSync(jsonlPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CorpusEntry;
      if (!entry.uid || !entry.name) continue;
      ops.push(adaptCorpusEntry(entry));
      if (options.limit != null && ops.length >= options.limit) break;
    } catch {
      // 跳过损坏行
    }
  }

  if (!options.kbDir && options.limit == null) _cache = ops;
  return ops;
}

/** 清空缓存（测试用）。 */
export function clearCorpusCache(): void {
  _cache = undefined;
}
