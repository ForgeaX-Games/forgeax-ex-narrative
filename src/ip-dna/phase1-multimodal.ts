/**
 * Phase 1 · 多模态提取 —— 蓝图 §3.1 / §3.4 / §6.2。
 *
 * 统一策略：图片（漫画页/插画）与视频统一"转写为叙事文本"，再汇入既有文本管线
 * （层级树 → 单元切片 → 三件套提取）。这样多模态与单模态共用同一条确定性主链。
 *
 *   - 图片：720p JPG 级别直接喂多模态 LLM（callWithImages），转写为含
 *     角色/场景/事件/对白的叙事 prose；
 *   - 视频：抽帧（VideoFrameSampler seam）+ 语音转写（VideoTranscriber seam）→
 *     与图片同路转写。无 sampler/transcriber 时返回空（留接口，§3.4 视频接口）。
 *
 * 全部走"接缝"：无 LLM / 无 sampler 时返回空字符串，主链仍可跑通（不抛错）。
 */

import type { LLMClient, ImagePart } from "../pipeline/runtime/llm-client.js";
import type { IncomingFile } from "./phase0-foundation.js";
import { modalityOf } from "./phase0-foundation.js";
import { loadIpDnaPrompt } from "./prompt-loader.js";
import { extractEpisodeNumber, extractComicUnitNumber } from "./unit-identity.js";

const IMAGE_DESCRIBE_SYSTEM = loadIpDnaPrompt(
  "image-describe",
  `你是漫画/插画叙事转写助手。忠实转写画面为中文叙事 prose：角色、场景、事件、对白；不臆造。`,
);

const VIDEO_DESCRIBE_SYSTEM = loadIpDnaPrompt(
  "video-describe",
  `你是影视叙事转写助手。依据关键帧与台词忠实合成中文叙事文本：场景、角色、事件因果与对白；不臆造。`,
);

/** 视频抽帧接缝：把视频抽成按时间顺序的关键帧图像（ffmpeg/解码器实现于外部）。 */
export type VideoFrameSampler = (video: IncomingFile) => Promise<ImagePart[]>;

/** 视频语音转写接缝（ASR）。 */
export type VideoTranscriber = (video: IncomingFile) => Promise<string>;

export interface MultimodalOptions {
  llm?: LLMClient;
  frameSampler?: VideoFrameSampler;
  transcriber?: VideoTranscriber;
  /** 单图最大字节（超过应在外部预压缩到 720p；此处仅作保护性跳过阈值）。 */
  maxImageBytes?: number;
}

function toImagePart(file: IncomingFile): ImagePart | null {
  if (typeof file.data === "string") return null;
  const mimeType = file.fileType?.includes("/") ? file.fileType : "image/jpeg";
  return { mimeType, data: file.data };
}

/** 图片 → 叙事文本（多模态 LLM）。无 LLM 返回空。 */
export async function describeImageToText(
  llm: LLMClient | undefined,
  file: IncomingFile,
  opts?: { maxImageBytes?: number },
): Promise<string> {
  if (!llm) return "";
  const part = toImagePart(file);
  if (!part) return "";
  const max = opts?.maxImageBytes ?? 8 * 1024 * 1024;
  if (Buffer.isBuffer(file.data) && file.data.length > max) return "";
  try {
    const text = await llm.callWithImages(
      IMAGE_DESCRIBE_SYSTEM,
      `画面来源文件：${file.fileName}`,
      [part],
      { temperature: 0.3 },
    );
    return text.trim();
  } catch {
    return "";
  }
}

/** 视频 → 叙事文本（抽帧 + 转写 → 多模态 LLM）。无 sampler/LLM 返回空（留接口）。 */
export async function describeVideoToText(
  file: IncomingFile,
  opts: MultimodalOptions,
): Promise<string> {
  if (!opts.llm || !opts.frameSampler) return "";
  let frames: ImagePart[] = [];
  try {
    frames = await opts.frameSampler(file);
  } catch {
    return "";
  }
  if (frames.length === 0) return "";
  let transcript = "";
  if (opts.transcriber) {
    try {
      transcript = (await opts.transcriber(file)).trim();
    } catch {
      transcript = "";
    }
  }
  const userPrompt = [
    `视频来源文件：${file.fileName}`,
    `关键帧数：${frames.length}`,
    transcript ? `台词转写：\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const text = await opts.llm.callWithImages(VIDEO_DESCRIBE_SYSTEM, userPrompt, frames, {
      temperature: 0.3,
    });
    return text.trim();
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────
// 模态特性：最小叙事单元边界识别（§3.0c/§3.4，结构前置·按边界标记切而非按计数）
// 命名映射：影视 季→part / 集→chapter；漫画 卷→part / 话(章)→chapter / 页→unit。
// 文本化（content）成本延后到 scoped 提取；这里只锚定边界与命名，保证多模态汇入后仍是真多层树。
// ─────────────────────────────────────────────────────────────────

/** 由文件名识别媒体最小叙事单元的边界（话/集/章 → chapter；页/单图 → unit）。 */
export function detectMediaUnit(fileName: string): { levelHint: "chapter" | "unit"; title: string } {
  const norm = fileName.replace(/\\/g, "/");
  const base = norm.slice(norm.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  // 显式边界标记：第N话/集/章/回/幕（漫画"话"、影视"集"映射为 chapter 边界）。
  if (/第\s*[0-9零一二三四五六七八九十百千]+\s*[话集章回幕]/.test(base)) {
    return { levelHint: "chapter", title: base };
  }
  // 否则视为页/单图/片段 → 最小单元（unit）。
  return { levelHint: "unit", title: base };
}

export interface MediaSegment {
  fileName: string;
  modality: "image" | "video";
  /** 该模态内最小叙事单元序号（输入顺序，稳定）。 */
  seq: number;
  /** 单元标题（命名映射后）。 */
  unitTitle: string;
  /** 边界层级（chapter=话/集，unit=页/单图/片段）。 */
  levelHint: "chapter" | "unit";
  /** 转写文本（content；无 LLM / 延后时为空，仍保留边界）。 */
  text: string;
}

export interface MultimodalTranscript {
  /** 各非文本文件转写出的叙事单元（保留边界，按输入顺序）。 */
  segments: MediaSegment[];
  /** 边界标记的层级化全文（供汇入文本主链建多层树，§3.4）。 */
  combinedText: string;
}

/** 模态 → 分组标题（part 级），保证不同模态在统一树下分支分离。 */
const MODALITY_GROUP_TITLE: Record<"image" | "video", string> = {
  image: "图集",
  video: "视频",
};

/**
 * 把输入文件中的图片/视频统一转写为**带边界的层级化叙事文本**（§3.4）。
 * 文本文件不在此处理（由 orchestrator 的 segmentsFromTexts 负责）。
 *
 * 与旧实现差异：旧版把每个文件平铺为 `# 文件名` 一级块（丢失模态/单元层级）。
 * 现按"模态分组(part) → 单元(话/集=chapter，页/单图=unit)"输出层级 markdown 标记，
 * 使多模态汇入后经 buildLightHierarchy 仍能形成真多层树，保留各模态最小叙事单元边界。
 */
export async function transcribeMediaFiles(
  files: IncomingFile[],
  opts: MultimodalOptions,
): Promise<MultimodalTranscript> {
  const segments: MediaSegment[] = [];
  const seqByModality: Record<"image" | "video", number> = { image: 0, video: 0 };
  for (const file of files) {
    const modality = modalityOf(file.fileType, file.fileName);
    if (modality === "text") continue;
    const text =
      modality === "image"
        ? await describeImageToText(opts.llm, file, { maxImageBytes: opts.maxImageBytes })
        : await describeVideoToText(file, opts);
    const { levelHint, title } = detectMediaUnit(file.fileName);
    seqByModality[modality] += 1;
    // 序号（§3.1）：优先用文件名里写明的真实话/集/页号，无则回退按输入顺序的位置计数。
    const realNum = modality === "video"
      ? extractEpisodeNumber(file.fileName)
      : extractComicUnitNumber(file.fileName);
    segments.push({
      fileName: file.fileName,
      modality,
      seq: realNum ?? seqByModality[modality],
      unitTitle: title,
      levelHint,
      text: text.trim(),
    });
  }
  return { segments, combinedText: buildMultimodalMarkdown(segments) };
}

/**
 * 由媒体单元构建层级化 markdown（# 模态分组 → ##话/集 / ###页·单图）。
 * 即便 text 为空（内容延后/无 LLM），标题行仍在 → 边界（节点）不丢失。
 */
export function buildMultimodalMarkdown(segments: MediaSegment[]): string {
  const lines: string[] = [];
  let lastModality: "image" | "video" | null = null;
  for (const s of segments) {
    if (s.modality !== lastModality) {
      lines.push(`# ${MODALITY_GROUP_TITLE[s.modality]}`);
      lastModality = s.modality;
    }
    const heading = s.levelHint === "chapter" ? "##" : "###";
    lines.push(`${heading} ${s.unitTitle}`);
    if (s.text) lines.push(s.text);
  }
  return lines.join("\n");
}
