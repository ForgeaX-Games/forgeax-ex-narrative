/**
 * ip-dna/video-ffmpeg.ts —— ffmpeg 视频抽帧适配器（D-B，蓝图 §3.4）。
 *
 * 把 phase1-multimodal 的 `VideoFrameSampler` 接缝接到本地 ffmpeg：
 *   视频 → 按时间均匀抽 N 帧为 JPG → ImagePart[] → 复用图片转写 → 文字。
 *
 * 模态对齐文字：视频经此适配器降为图片，再走与漫画/插画完全相同的转写主链，
 * 核心管线不感知视频，只处理文字。
 *
 * ffmpeg 不可用 / 抽帧失败 → 返回 []（多模态主链降级，不抛错）。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ImagePart } from "../pipeline/runtime/llm-client.js";
import type { VideoFrameSampler, VideoTranscriber } from "./phase1-multimodal.js";
import type { IncomingFile } from "./phase0-foundation.js";
import type { MediaCompressor } from "./phase0-compress.js";

export interface FfmpegSamplerConfig {
  /** ffmpeg 可执行路径（默认 "ffmpeg"，依赖 PATH）。 */
  ffmpegPath?: string;
  /** 抽帧数（按视频时长均匀分布，默认 8）。 */
  frameCount?: number;
  /** 帧缩放高度（720p 级别，默认 720）。 */
  height?: number;
  /** 单次抽帧超时（ms，默认 60s）。 */
  timeoutMs?: number;
}

function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      resolve({ code: -1 });
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1 });
    });
  });
}

/**
 * 构建基于 ffmpeg 的视频抽帧器（VideoFrameSampler）。
 * 用 `fps=N/duration`-style 的 `-vf "fps=...,scale=-1:H"` 抽取均匀帧。
 * 这里用更稳的策略：`-vf "thumbnail,scale=-1:H" -frames:v N`（thumbnail 过滤代表性帧）。
 */
export function createFfmpegFrameSampler(cfg: FfmpegSamplerConfig = {}): VideoFrameSampler {
  const ffmpegPath = cfg.ffmpegPath ?? "ffmpeg";
  const frameCount = cfg.frameCount ?? 8;
  const height = cfg.height ?? 720;
  const timeoutMs = cfg.timeoutMs ?? 60_000;

  return async (video: IncomingFile): Promise<ImagePart[]> => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vframes-"));
    const inputPath = path.join(tmpDir, "input");
    try {
      // 落地视频到临时文件（IncomingFile.data 可能是 Buffer 或 string）。
      const data = typeof video.data === "string" ? Buffer.from(video.data) : video.data;
      fs.writeFileSync(inputPath, data);

      const outPattern = path.join(tmpDir, "frame_%03d.jpg");
      const args = [
        "-y",
        "-i",
        inputPath,
        "-vf",
        `thumbnail,scale=-1:${height}`,
        "-frames:v",
        String(frameCount),
        "-q:v",
        "3",
        outPattern,
      ];
      const { code } = await runFfmpeg(ffmpegPath, args, timeoutMs);
      if (code !== 0) return [];

      const frames = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
        .sort();
      return frames.map((f) => ({
        mimeType: "image/jpeg",
        data: fs.readFileSync(path.join(tmpDir, f)),
      }));
    } catch {
      return [];
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    }
  };
}

export interface FfmpegCompressorConfig {
  /** ffmpeg 可执行路径（默认 "ffmpeg"，依赖 PATH）。 */
  ffmpegPath?: string;
  /** 图片缩放目标高度（默认 720p，§6.3）。 */
  height?: number;
  /** 视频缩放目标高度（默认 480p，§6.3 视频压缩 480p&24fps）。 */
  videoHeight?: number;
  /** 视频目标帧率（默认 24fps，§6.3）。 */
  videoFps?: number;
  /** 单次压缩超时（ms，默认 120s）。 */
  timeoutMs?: number;
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);

/**
 * 构建基于 ffmpeg 的媒体压缩器（MediaCompressor，§3.4 / §6.3）：
 *   图片 → 缩放到 720p JPG；视频 → 缩放 480p + 24fps + H.264/AAC 转码 MP4（对齐蓝图 §6.3）。
 * ffmpeg 不可用 / 转码失败 → 返回原文件（透传降级，不抛错）。
 */
export function createFfmpegMediaCompressor(cfg: FfmpegCompressorConfig = {}): MediaCompressor {
  const ffmpegPath = cfg.ffmpegPath ?? "ffmpeg";
  const height = cfg.height ?? 720;
  const videoHeight = cfg.videoHeight ?? 480;
  const videoFps = cfg.videoFps ?? 24;
  const timeoutMs = cfg.timeoutMs ?? 120_000;

  return async (file: IncomingFile): Promise<IncomingFile> => {
    const e = path.extname(file.fileName).toLowerCase();
    const isImage = IMAGE_EXT.has(e) || /^image\//.test(file.fileType);
    const isVideo = VIDEO_EXT.has(e) || /^video\//.test(file.fileType);
    if (!isImage && !isVideo) return file;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcompress-"));
    const inputPath = path.join(tmpDir, `input${e || ".bin"}`);
    const outExt = isImage ? ".jpg" : ".mp4";
    const outName = file.fileName.replace(/\.[^.]+$/, "") + (isImage ? ".jpg" : ".mp4");
    const outputPath = path.join(tmpDir, `output${outExt}`);
    try {
      const data = typeof file.data === "string" ? Buffer.from(file.data) : file.data;
      fs.writeFileSync(inputPath, data);
      const args = isImage
        ? ["-y", "-i", inputPath, "-vf", `scale=-1:${height}`, "-q:v", "3", outputPath]
        : ["-y", "-i", inputPath, "-vf", `scale=-1:${videoHeight}`, "-r", String(videoFps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", outputPath];
      const { code } = await runFfmpeg(ffmpegPath, args, timeoutMs);
      if (code !== 0 || !fs.existsSync(outputPath)) return file;
      const compressed = fs.readFileSync(outputPath);
      // 压缩反而变大则保留原件（小文件常见）。
      if (compressed.length >= data.length) return file;
      return { ...file, fileName: outName, data: compressed, fileType: isImage ? "image/jpeg" : "video/mp4" };
    } catch {
      return file;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    }
  };
}

export interface FfmpegTranscriberConfig {
  /** ffmpeg 可执行路径（默认 "ffmpeg"，依赖 PATH）。 */
  ffmpegPath?: string;
  /**
   * 本地 ASR HTTP 端点（默认取 env.ASR_ENDPOINT）。约定：POST 16kHz 单声道 wav（audio/wav），
   * 返回 `{ text: string }` 或纯文本。未配置 / 不可用 → 返回 ""（留接口降级，§3.4 视频接口）。
   */
  endpoint?: string;
  /** 抽音轨 + 转写超时（ms，默认 120s）。 */
  timeoutMs?: number;
}

/**
 * 构建默认视频语音转写器（VideoTranscriber，§3.4 / §6.3 音轨转写 ASR）：
 *   视频 → ffmpeg 抽 16kHz 单声道 wav 音轨 → POST 到本地 ASR HTTP 端点 → 文字。
 *
 * 与 queryEmbedder 同构的"本地 HTTP 端点优先"模式：用户起一个本地 whisper.cpp / faster-whisper
 * HTTP 服务并配 ASR_ENDPOINT 即可开箱用；未配置或不可用时返回 ""（主链降级，不抛错）。
 */
export function createFfmpegHttpTranscriber(cfg: FfmpegTranscriberConfig = {}): VideoTranscriber {
  const ffmpegPath = cfg.ffmpegPath ?? "ffmpeg";
  const endpoint = cfg.endpoint ?? process.env.ASR_ENDPOINT;
  const timeoutMs = cfg.timeoutMs ?? 120_000;

  return async (video: IncomingFile): Promise<string> => {
    if (!endpoint) return ""; // 无 ASR 端点 → 留接口降级。
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vasr-"));
    const inputPath = path.join(tmpDir, "input");
    const wavPath = path.join(tmpDir, "audio.wav");
    try {
      const data = typeof video.data === "string" ? Buffer.from(video.data) : video.data;
      fs.writeFileSync(inputPath, data);
      // 抽 16kHz 单声道 PCM wav（ASR 通用输入）。
      const { code } = await runFfmpeg(
        ffmpegPath,
        ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath],
        timeoutMs,
      );
      if (code !== 0 || !fs.existsSync(wavPath)) return "";
      const wav = fs.readFileSync(wavPath);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: new Uint8Array(wav),
          signal: ctrl.signal,
        });
        if (!resp.ok) return "";
        const ctype = resp.headers.get("content-type") ?? "";
        if (ctype.includes("application/json")) {
          const j = (await resp.json()) as { text?: string };
          return (j.text ?? "").trim();
        }
        return (await resp.text()).trim();
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return "";
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    }
  };
}
