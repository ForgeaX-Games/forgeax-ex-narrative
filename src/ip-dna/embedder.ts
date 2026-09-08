/**
 * ip-dna/embedder.ts —— 本地查询向量化适配器（D-B，蓝图 §7.1）。
 *
 * 把 phase3-vector 的 `QueryEmbedder` 接缝接到真实本地运行时，优先级：
 *   ① 本地 HTTP 嵌入端点：POST 到本地推理服务（如 text-embeddings-inference / 自建 e5 服务）；
 *   ② 进程内本地 e5（transformers.js，首选默认）：transformers.js 直接加载本地 e5 ONNX
 *      + 内置分词器，与语料侧 embeddings.npy 同模型（intfloat/multilingual-e5-small）；
 *   ③ onnxruntime-node 进程内推理（需自带分词器接缝，备选）；
 *   ④ 皆不可用 → 返回 undefined（检索器自动降级为 scope+tag，§7.3，不抛错）。
 *
 * 全部为边界适配器：核心检索逻辑（NPY/余弦/RRF）不感知后端，向量只是其中一路通道。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { QueryEmbedder } from "./phase3-vector.js";

/** 可注入的 fetch（默认用全局 fetch；测试可注入 mock）。 */
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface HttpEmbedderConfig {
  /** 嵌入端点 URL，如 http://127.0.0.1:8080/embed。 */
  url: string;
  /** 可选模型名（随请求体发送）。 */
  model?: string;
  /** 期望维度（用于校验/截断；不匹配则跳过该向量）。 */
  dim?: number;
  /** 请求字段名（默认 "input"）。 */
  inputField?: string;
  /** 自定义 fetch 实现（测试注入）。 */
  fetchImpl?: FetchLike;
  /** 额外请求头（如鉴权）。 */
  headers?: Record<string, string>;
}

/** 从多种常见响应形态里提取 number[][]。 */
function extractEmbeddings(payload: unknown): number[][] {
  if (Array.isArray(payload)) {
    // 形态 A：直接 number[][]
    if (payload.length > 0 && Array.isArray(payload[0])) return payload as number[][];
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    // 形态 B：{ embeddings: number[][] }
    if (Array.isArray(obj.embeddings)) return obj.embeddings as number[][];
    // 形态 C（OpenAI 风格）：{ data: [{ embedding: number[] }] }
    if (Array.isArray(obj.data)) {
      return (obj.data as Array<{ embedding?: number[] }>).map((d) => d.embedding ?? []);
    }
  }
  return [];
}

/**
 * 本地 HTTP 嵌入端点适配器（首选）。
 */
export function createHttpQueryEmbedder(cfg: HttpEmbedderConfig): QueryEmbedder {
  const doFetch: FetchLike =
    cfg.fetchImpl ?? ((url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));
  const inputField = cfg.inputField ?? "input";

  return async (queries: string[]): Promise<Float32Array[]> => {
    const body: Record<string, unknown> = { [inputField]: queries };
    if (cfg.model) body.model = cfg.model;
    const res = await doFetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.headers ?? {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`embedding endpoint ${cfg.url} 返回 ${res.status}`);
    const rows = extractEmbeddings(await res.json());
    return rows.map((r) => Float32Array.from(r)).filter((v) => !cfg.dim || v.length === cfg.dim);
  };
}

export interface OnnxEmbedderConfig {
  /** e5 ONNX 模型路径。 */
  modelPath: string;
  /**
   * 文本 → token id 的分词器接缝（e5/BERT wordpiece）。
   * 进程内推理需要它；缺省时本适配器不可用（返回 null）。
   */
  tokenize?: (text: string) => { inputIds: number[]; attentionMask: number[] };
  dim?: number;
}

/**
 * onnxruntime-node 进程内推理适配器（备选）。
 *
 * onnxruntime-node 为可选依赖：未安装 / 模型缺失 / 无分词器接缝 → 返回 null（不可用）。
 * 提供 tokenize 接缝时，对每条 query 跑 session 并做 mean-pooling + L2 归一化。
 */
export async function createOnnxQueryEmbedder(cfg: OnnxEmbedderConfig): Promise<QueryEmbedder | null> {
  if (!cfg.tokenize) return null;
  let ort: { InferenceSession: { create: (p: string) => Promise<OnnxSession> }; Tensor: OnnxTensorCtor };
  try {
    // 可选依赖：用计算式 specifier 动态加载（未安装时不参与静态类型解析），失败即降级。
    const moduleName = "onnxruntime-node";
    ort = (await import(moduleName)) as unknown as typeof ort;
  } catch {
    return null;
  }
  let session: OnnxSession;
  try {
    session = await ort.InferenceSession.create(cfg.modelPath);
  } catch {
    return null;
  }
  const Tensor = ort.Tensor;
  const tokenize = cfg.tokenize;

  return async (queries: string[]): Promise<Float32Array[]> => {
    const out: Float32Array[] = [];
    for (const q of queries) {
      const { inputIds, attentionMask } = tokenize(q);
      const len = inputIds.length;
      const ids = BigInt64Array.from(inputIds.map((n) => BigInt(n)));
      const mask = BigInt64Array.from(attentionMask.map((n) => BigInt(n)));
      const feeds: Record<string, unknown> = {
        input_ids: new Tensor("int64", ids, [1, len]),
        attention_mask: new Tensor("int64", mask, [1, len]),
      };
      const result = await session.run(feeds);
      const pooled = meanPool(result, attentionMask, cfg.dim);
      if (pooled) out.push(pooled);
    }
    return out;
  };
}

interface OnnxTensorCtor {
  new (type: string, data: BigInt64Array | Float32Array, dims: number[]): unknown;
}
interface OnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: number[] }>>;
}

/** 对 last_hidden_state 做 attention-mask 加权 mean-pooling + L2 归一化。 */
function meanPool(
  result: Record<string, { data: Float32Array; dims: number[] }>,
  attentionMask: number[],
  expectedDim?: number,
): Float32Array | null {
  const key = result.last_hidden_state ? "last_hidden_state" : Object.keys(result)[0];
  const tensor = result[key];
  if (!tensor) return null;
  const dims = tensor.dims;
  const seqLen = dims[dims.length - 2];
  const hidden = dims[dims.length - 1];
  if (expectedDim && hidden !== expectedDim) return null;
  const data = tensor.data;
  const pooled = new Float32Array(hidden);
  let maskSum = 0;
  for (let t = 0; t < seqLen; t++) {
    const m = attentionMask[t] ?? 0;
    if (m === 0) continue;
    maskSum += m;
    for (let h = 0; h < hidden; h++) pooled[h] += data[t * hidden + h] * m;
  }
  if (maskSum === 0) return null;
  let norm = 0;
  for (let h = 0; h < hidden; h++) {
    pooled[h] /= maskSum;
    norm += pooled[h] * pooled[h];
  }
  norm = Math.sqrt(norm) || 1;
  for (let h = 0; h < hidden; h++) pooled[h] /= norm;
  return pooled;
}

export interface LocalE5Config {
  /**
   * 本地 e5 模型目录（sentence-transformers 布局），如
   * `<model-cache>/intfloat/multilingual-e5-small`。
   * 目录内需含 `config.json` / `tokenizer.json` / `onnx/model.onnx`。
   */
  modelDir: string;
  /** 期望维度（用于校验；不匹配则丢弃该向量）。 */
  dim?: number;
  /** 是否加载量化 ONNX（transformers.js 默认 onnx/model.onnx；本地未提供标准量化名时保持 false）。 */
  quantized?: boolean;
}

/**
 * 进程内本地 e5 适配器（transformers.js，首选默认）。
 *
 * transformers.js 自带分词器（XLM-Roberta/sentencepiece）与池化，直接加载本地
 * ONNX 模型，与语料侧 embeddings.npy 同模型同 pooling（mean + L2 归一化），
 * 无需 Python 边车、无需手写 wordpiece、无需联网（allowRemoteModels=false）。
 *
 * 模型目录不存在 / transformers.js 未安装 / 加载失败 → 返回 null（不可用，上游降级）。
 * 注意：查询前缀（"query: "）由 phase3-vector 的检索器统一拼接，本适配器只做纯向量化。
 */
export async function createLocalE5Embedder(cfg: LocalE5Config): Promise<QueryEmbedder | null> {
  if (!cfg.modelDir || !fs.existsSync(cfg.modelDir)) return null;
  let tf: {
    env: { allowRemoteModels: boolean; localModelPath: string };
    pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<
      (input: string, opts?: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>
    >;
  };
  try {
    // 可选大依赖：用计算式 specifier 动态加载，未安装即降级。
    const moduleName = "@xenova/transformers";
    tf = (await import(moduleName)) as unknown as typeof tf;
  } catch {
    return null;
  }
  let extractor: (input: string, opts?: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>;
  try {
    tf.env.allowRemoteModels = false;
    tf.env.localModelPath = path.dirname(cfg.modelDir);
    extractor = await tf.pipeline("feature-extraction", path.basename(cfg.modelDir), {
      quantized: cfg.quantized ?? false,
    });
  } catch {
    return null;
  }

  return async (queries: string[]): Promise<Float32Array[]> => {
    const out: Float32Array[] = [];
    for (const q of queries) {
      const t = await extractor(q, { pooling: "mean", normalize: true });
      const vec = t.data instanceof Float32Array ? t.data : Float32Array.from(t.data);
      if (cfg.dim && vec.length !== cfg.dim) continue;
      out.push(vec);
    }
    return out;
  };
}

export interface ResolveEmbedderEnv {
  /** 本地嵌入 HTTP 端点（首选）。 */
  NARRATIVE_EMBED_URL?: string;
  NARRATIVE_EMBED_MODEL?: string;
  NARRATIVE_EMBED_DIM?: string;
  /** 本地 e5 模型目录（transformers.js 进程内推理）；覆盖 retrieval_config.model_path_local。 */
  NARRATIVE_EMBED_MODEL_DIR?: string;
  /** e5 ONNX 模型路径（onnxruntime-node 备选）。 */
  NARRATIVE_EMBED_ONNX?: string;
}

export interface ResolveEmbedderOptions {
  /** 本地 e5 模型目录的默认值（调用方通常从 retrieval_config.model_path_local 注入）。 */
  localModelDir?: string;
  /** ONNX 备选路径所需的分词器接缝。 */
  onnxTokenize?: OnnxEmbedderConfig["tokenize"];
}

/**
 * 按优先级解析一个可用的 QueryEmbedder：
 *   HTTP 端点 > 本地 e5（transformers.js）> ONNX(onnxruntime-node) > undefined。
 *
 * 本地 e5 为默认开箱即用通道：只要 env.NARRATIVE_EMBED_MODEL_DIR 或 opts.localModelDir
 * 指向一个存在的 e5 模型目录即启用；都未提供或加载失败则继续向后降级，最终返回 undefined。
 */
export async function resolveQueryEmbedder(
  env: ResolveEmbedderEnv = process.env as ResolveEmbedderEnv,
  opts: ResolveEmbedderOptions = {},
): Promise<QueryEmbedder | undefined> {
  const dim = env.NARRATIVE_EMBED_DIM ? parseInt(env.NARRATIVE_EMBED_DIM, 10) : undefined;
  if (env.NARRATIVE_EMBED_URL) {
    return createHttpQueryEmbedder({ url: env.NARRATIVE_EMBED_URL, model: env.NARRATIVE_EMBED_MODEL, dim });
  }
  const modelDir = env.NARRATIVE_EMBED_MODEL_DIR ?? opts.localModelDir;
  if (modelDir) {
    const local = await createLocalE5Embedder({ modelDir, dim });
    if (local) return local;
  }
  if (env.NARRATIVE_EMBED_ONNX) {
    const onnx = await createOnnxQueryEmbedder({ modelPath: env.NARRATIVE_EMBED_ONNX, tokenize: opts.onnxTokenize, dim });
    if (onnx) return onnx;
  }
  return undefined;
}
