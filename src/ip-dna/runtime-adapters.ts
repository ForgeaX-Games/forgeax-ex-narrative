/**
 * ip-dna/runtime-adapters.ts —— IP DNA 管线的本地运行时边界适配器统一解析（蓝图 §7 D-B）。
 *
 * 把"向量化查询器（RAG vector 通道）/视频抽帧器/媒体压缩器/压缩包解压器"的解析收敛到一处，
 * 供 CLI（cli-runner.ts）与 HTTP 服务（api/server.ts）共用，避免两边各写一套、行为漂移。
 *
 * 解析优先级（resolveQueryEmbedder）：HTTP 端点 > 本地 e5(transformers.js) > ONNX > undefined；
 * 本地 e5 模型目录默认取 retrieval_config.model_path_local，开箱即用。
 * 边界适配器缺失时静默降级（向量→scope+tag 检索；视频→空帧；媒体压缩→透传；zip→透传），不影响 dry-run 闭环。
 */

import { loadRetrievalConfig, type RetrievalConfig, type QueryEmbedder } from "./phase3-vector.js";
import { resolveQueryEmbedder, type ResolveEmbedderEnv } from "./embedder.js";
import { createFfmpegFrameSampler, createFfmpegMediaCompressor, createFfmpegHttpTranscriber } from "./video-ffmpeg.js";
import { createDefaultArchiveExtractor, type MediaCompressor, type ArchiveExtractor, type PdfPageSplitter } from "./phase0-compress.js";
import { createPdftoppmPageSplitter } from "./pdf-split.js";
import type { VideoFrameSampler, VideoTranscriber } from "./phase1-multimodal.js";

export interface IpDnaRuntimeAdapters {
  /** 本地向量化查询器；未配置/加载失败时为 undefined（检索降级 scope+tag）。 */
  queryEmbedder?: QueryEmbedder;
  /** 视频抽帧器（ffmpeg）。 */
  frameSampler: VideoFrameSampler;
  /** 视频语音转写器（ffmpeg 抽音轨 → 本地 ASR HTTP 端点）。无 ASR_ENDPOINT 时转写返回空（降级）。 */
  transcriber: VideoTranscriber;
  /** 媒体压缩器（ffmpeg：图片→720p / 视频→480p&24fps）。失败/无 ffmpeg 时透传原件。 */
  mediaCompressor: MediaCompressor;
  /** 压缩包解压器（zip，零依赖中央目录解析）。gz/tar/tgz 已原生处理。 */
  archiveExtractor: ArchiveExtractor;
  /** PDF 拆页器（pdftoppm：PDF → 逐页 jpg）。无 poppler 时透传原 PDF。 */
  pdfPageSplitter: PdfPageSplitter;
  /** 解析所用的检索配置（含本地 e5 模型目录等）。 */
  retrievalConfig: RetrievalConfig;
}

/** 解析环境（env + FFMPEG_PATH + ASR_ENDPOINT + PDFTOPPM_PATH）。CLI/服务传 process.env 即可。 */
export type RuntimeAdapterEnv = ResolveEmbedderEnv & {
  [key: string]: string | undefined;
  FFMPEG_PATH?: string;
  ASR_ENDPOINT?: string;
  PDFTOPPM_PATH?: string;
};

/**
 * 解析 IP DNA 管线的本地运行时适配器（向量化器 + 视频抽帧器 + 媒体压缩器 + zip 解压器）。
 * 单一事实源：CLI 与 server 都应经由此函数获取，保证多模态预处理行为一致。
 */
export async function resolveIpDnaRuntimeAdapters(
  env: RuntimeAdapterEnv = process.env as RuntimeAdapterEnv,
): Promise<IpDnaRuntimeAdapters> {
  const retrievalConfig = loadRetrievalConfig();
  const queryEmbedder = await resolveQueryEmbedder(env, {
    localModelDir: retrievalConfig.model_path_local,
  });
  const frameSampler = createFfmpegFrameSampler({ ffmpegPath: env.FFMPEG_PATH });
  const transcriber = createFfmpegHttpTranscriber({ ffmpegPath: env.FFMPEG_PATH, endpoint: env.ASR_ENDPOINT });
  const mediaCompressor = createFfmpegMediaCompressor({ ffmpegPath: env.FFMPEG_PATH });
  const archiveExtractor = createDefaultArchiveExtractor();
  const pdfPageSplitter = createPdftoppmPageSplitter({ pdftoppmPath: env.PDFTOPPM_PATH });
  return { queryEmbedder, frameSampler, transcriber, mediaCompressor, archiveExtractor, pdfPageSplitter, retrievalConfig };
}
