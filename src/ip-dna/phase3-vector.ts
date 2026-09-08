/**
 * Phase 3 · 本地向量检索 + 三路 RRF 融合 —— 蓝图 §7.1 / §7.3。
 *
 * 通道（retrieval_config.json）：
 *   - scope  (0.40)：结构化知识域/视角分桶命中（确定性）；
 *   - vector (0.35)：embeddings.npy + 本地 e5 查询向量化 → 余弦相似（需 QueryEmbedder seam）；
 *   - tag    (0.25)：标签/关键词词频（确定性，即 KeywordOperatorRetriever 通道）。
 * 三路各自排名后用 RRF（rrf_k=60）融合。
 *
 * 降级策略（§7.3）：
 *   - 无 QueryEmbedder / 无 embeddings.npy → 关闭 vector 通道，仅用 scope+tag（仍确定性可跑）；
 *   - QueryEmbedder 由外部注入（本地 e5 模型 / Python 边车），缺失即降级，不抛错。
 *
 * 本文件的 NPY 解析、余弦 top-k、RRF 融合均为纯函数，可脱离模型单测。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { NarrativeOperator, OperatorPerspective } from "../types/narrative-ip-dna.js";
import { inferPerspective, type OperatorRetriever, KeywordOperatorRetriever } from "./phase3-rag.js";
import { loadOperatorCorpus, resolveKnowledgeBaseDir, type LoadCorpusOptions } from "./corpus-loader.js";

// ─────────────────────────────────────────────────────────────────
// NPY 解析（numpy .npy v1/v2，<f4 little-endian float32, C order）
// ─────────────────────────────────────────────────────────────────

export interface EmbeddingMatrix {
  /** 扁平 float32（rows × dim，行主序）。 */
  data: Float32Array;
  rows: number;
  dim: number;
}

const NPY_MAGIC = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]); // \x93NUMPY

/** 解析 .npy 缓冲为 float32 矩阵（仅支持 <f4 / C order）。 */
export function parseNpyFloat32(buf: Buffer): EmbeddingMatrix {
  if (buf.length < 10 || !buf.subarray(0, 6).equals(NPY_MAGIC)) {
    throw new Error("非法 NPY：magic 不匹配");
  }
  const major = buf[6];
  let headerLen: number;
  let dataStart: number;
  if (major === 1) {
    headerLen = buf.readUInt16LE(8);
    dataStart = 10 + headerLen;
  } else {
    headerLen = buf.readUInt32LE(8);
    dataStart = 12 + headerLen;
  }
  const header = buf.subarray(major === 1 ? 10 : 12, dataStart).toString("latin1");
  if (!/'descr':\s*'[<|]?f4'/.test(header)) {
    throw new Error(`NPY descr 非 float32：${header}`);
  }
  if (/'fortran_order':\s*True/.test(header)) {
    throw new Error("NPY fortran_order=True 暂不支持");
  }
  const shapeMatch = header.match(/'shape':\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!shapeMatch) throw new Error(`NPY shape 解析失败：${header}`);
  const rows = parseInt(shapeMatch[1], 10);
  const dim = parseInt(shapeMatch[2], 10);
  const floatCount = rows * dim;
  // 复制到对齐的 ArrayBuffer，避免 byteOffset 未对齐导致 Float32Array 抛错。
  const slice = buf.subarray(dataStart, dataStart + floatCount * 4);
  const aligned = new ArrayBuffer(slice.length);
  new Uint8Array(aligned).set(slice);
  const data = new Float32Array(aligned);
  return { data, rows, dim };
}

/** 读取 embeddings.npy（不存在返回 null）。 */
export function loadEmbeddings(kbDir?: string): EmbeddingMatrix | null {
  const dir = resolveKnowledgeBaseDir(kbDir);
  const npyPath = path.join(dir, "embeddings.npy");
  if (!fs.existsSync(npyPath)) return null;
  return parseNpyFloat32(fs.readFileSync(npyPath));
}

/** 读取 uid_index.json（行序 → uid）。 */
export function loadUidIndex(kbDir?: string): string[] | null {
  const dir = resolveKnowledgeBaseDir(kbDir);
  const p = path.join(dir, "uid_index.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as string[];
}

export interface RetrievalConfig {
  vector_enabled: boolean;
  embedding_dim: number;
  query_prefix: string;
  channel_weights: { scope: number; vector: number; tag: number };
  rrf_k: number;
  /** 嵌入模型名（仅记录，用于核对语料侧与查询侧同模型）。 */
  model_name?: string;
  /** 本地 e5 模型目录（进程内 transformers.js 推理用）。 */
  model_path_local?: string;
}

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  vector_enabled: true,
  embedding_dim: 384,
  query_prefix: "query: ",
  channel_weights: { scope: 0.4, vector: 0.35, tag: 0.25 },
  rrf_k: 60,
};

export function loadRetrievalConfig(kbDir?: string): RetrievalConfig {
  const dir = resolveKnowledgeBaseDir(kbDir);
  const p = path.join(dir, "retrieval_config.json");
  if (!fs.existsSync(p)) return DEFAULT_RETRIEVAL_CONFIG;
  try {
    return { ...DEFAULT_RETRIEVAL_CONFIG, ...(JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<RetrievalConfig>) };
  } catch {
    return DEFAULT_RETRIEVAL_CONFIG;
  }
}

// ─────────────────────────────────────────────────────────────────
// 余弦 top-k + RRF
// ─────────────────────────────────────────────────────────────────

/** 单查询向量对矩阵的余弦相似 top-k（返回行索引，按相似度降序）。 */
export function cosineTopK(matrix: EmbeddingMatrix, query: Float32Array, k: number): number[] {
  const { data, rows, dim } = matrix;
  if (query.length !== dim) throw new Error(`查询维度 ${query.length} ≠ 矩阵维度 ${dim}`);
  let qNorm = 0;
  for (let i = 0; i < dim; i++) qNorm += query[i] * query[i];
  qNorm = Math.sqrt(qNorm) || 1;
  const scored: Array<{ idx: number; score: number }> = [];
  for (let r = 0; r < rows; r++) {
    const base = r * dim;
    let dot = 0;
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      const v = data[base + i];
      dot += v * query[i];
      norm += v * v;
    }
    const denom = (Math.sqrt(norm) || 1) * qNorm;
    scored.push({ idx: r, score: dot / denom });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.idx);
}

/**
 * Reciprocal Rank Fusion：多通道排名列表（每个是 uid 有序数组）→ 融合排名。
 * 分数 = Σ weight_c / (rrf_k + rank_c)。返回按融合分降序的 uid。
 */
export function rrfFuse(
  channels: Array<{ ranking: string[]; weight: number }>,
  rrfK: number,
  k: number,
): string[] {
  const scores = new Map<string, number>();
  for (const { ranking, weight } of channels) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const uid = ranking[rank];
      scores.set(uid, (scores.get(uid) ?? 0) + weight / (rrfK + rank + 1));
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map((e) => e[0]);
}

// ─────────────────────────────────────────────────────────────────
// 查询向量化接缝（本地 e5；缺失即降级）
// ─────────────────────────────────────────────────────────────────

/** 把若干 query 文本向量化为 384 维向量（本地 e5 模型 / Python 边车实现）。 */
export type QueryEmbedder = (queries: string[]) => Promise<Float32Array[]>;

// ─────────────────────────────────────────────────────────────────
// 混合检索器：scope + vector + tag 三路 RRF
// ─────────────────────────────────────────────────────────────────

export interface HybridRetrieverOptions extends LoadCorpusOptions {
  /** 查询向量化接缝；缺失则关闭 vector 通道。 */
  embedder?: QueryEmbedder;
  /** 覆盖检索配置。 */
  config?: RetrievalConfig;
}

export class HybridOperatorRetriever implements OperatorRetriever {
  private corpusByUid = new Map<string, NarrativeOperator>();
  private byPerspective = new Map<OperatorPerspective, NarrativeOperator[]>();
  private keyword: KeywordOperatorRetriever;
  private matrix: EmbeddingMatrix | null;
  private uidIndex: string[] | null;
  private rowByUid = new Map<string, number>();
  private embedder?: QueryEmbedder;
  private config: RetrievalConfig;

  constructor(corpus: NarrativeOperator[], opts: HybridRetrieverOptions = {}) {
    this.keyword = new KeywordOperatorRetriever(corpus);
    this.embedder = opts.embedder;
    this.config = opts.config ?? loadRetrievalConfig(opts.kbDir);
    const buckets: Record<OperatorPerspective, NarrativeOperator[]> = { author: [], reader: [], character: [] };
    for (const op of corpus) {
      this.corpusByUid.set(op.uid, op);
      buckets[inferPerspective(op)].push(op);
    }
    this.byPerspective = new Map(Object.entries(buckets) as Array<[OperatorPerspective, NarrativeOperator[]]>);

    // 仅当存在向量通道接缝时才加载大矩阵（避免无谓 IO/内存）。
    if (this.embedder) {
      this.matrix = loadEmbeddings(opts.kbDir);
      this.uidIndex = loadUidIndex(opts.kbDir);
      if (this.uidIndex) this.uidIndex.forEach((uid, i) => this.rowByUid.set(uid, i));
    } else {
      this.matrix = null;
      this.uidIndex = null;
    }
  }

  /** 是否启用了向量通道。 */
  get vectorEnabled(): boolean {
    return !!(this.embedder && this.matrix && this.uidIndex && this.config.vector_enabled);
  }

  async retrieve(query: string, perspective: OperatorPerspective, k: number): Promise<NarrativeOperator[]> {
    const pool = this.byPerspective.get(perspective) ?? [];
    if (pool.length === 0) return [];
    const poolUids = new Set(pool.map((o) => o.uid));
    const wide = Math.max(k * 8, 40);

    // tag 通道：关键词词频排名（限定到该视角桶）。
    const tagRanked = (await this.keyword.retrieve(query, perspective, wide)).map((o) => o.uid);

    // scope 通道：知识域/视角匹配——视角桶本身即 scope 命中，按域文本与 query 的轻量重合度排序。
    const scopeRanked = this.scopeRank(query, pool, wide);

    const channels: Array<{ ranking: string[]; weight: number }> = [
      { ranking: scopeRanked, weight: this.config.channel_weights.scope },
      { ranking: tagRanked, weight: this.config.channel_weights.tag },
    ];

    // vector 通道（可用时）。
    if (this.vectorEnabled) {
      const vectorRanked = await this.vectorRank(query, poolUids, wide);
      if (vectorRanked.length > 0) {
        channels.push({ ranking: vectorRanked, weight: this.config.channel_weights.vector });
      }
    }

    const fusedUids = rrfFuse(channels, this.config.rrf_k, k);
    return fusedUids
      .map((uid) => this.corpusByUid.get(uid))
      .filter((o): o is NarrativeOperator => !!o);
  }

  private scopeRank(query: string, pool: NarrativeOperator[], k: number): string[] {
    const terms = (query.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g) ?? []).map((s) => s.toLowerCase());
    const scored = pool.map((op) => {
      const hay = `${op.knowledge_domain} ${op.adaptation?.type ?? ""} ${op.adaptation?.element ?? ""}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 1;
      return { uid: op.uid, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.uid);
  }

  private async vectorRank(query: string, poolUids: Set<string>, k: number): Promise<string[]> {
    if (!this.matrix || !this.uidIndex || !this.embedder) return [];
    let vecs: Float32Array[];
    try {
      vecs = await this.embedder([`${this.config.query_prefix}${query}`]);
    } catch {
      return [];
    }
    const qv = vecs[0];
    if (!qv || qv.length !== this.matrix.dim) return [];
    // 取较宽的 top-N 后过滤到视角桶（向量库是全量，需按视角裁剪）。
    const topIdx = cosineTopK(this.matrix, qv, k * 4);
    const out: string[] = [];
    for (const idx of topIdx) {
      const uid = this.uidIndex[idx];
      if (uid && poolUids.has(uid)) {
        out.push(uid);
        if (out.length >= k) break;
      }
    }
    return out;
  }
}

/**
 * 构建混合检索器（§7.1）。提供 embedder 时启用 vector 通道，否则 scope+tag 降级。
 * 语料缺失时退化为空检索器（槽位走 LLM 生成兜底）。
 */
export function buildHybridRetriever(opts: HybridRetrieverOptions = {}): HybridOperatorRetriever {
  return new HybridOperatorRetriever(loadOperatorCorpus(opts), opts);
}
