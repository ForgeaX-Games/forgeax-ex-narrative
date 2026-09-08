/**
 * 上传原料的读取与中性表示。
 *
 * 从 TierModeSelector 抽出来，是因为 store 也要持有 uploadedFiles（跨 iframe 同步），
 * 而 store 不能反向 import 组件。
 *
 * 蓝图 §3.4/§6.1：多模态 + 压缩包 + 多文件上传，按扩展名分流读取方式。
 */

const TEXT_EXTS = ["txt", "md", "markdown"];
const DOCX_EXTS = ["doc", "docx"];
const BINARY_EXTS = [
  "pdf",
  "png", "jpg", "jpeg", "webp", "gif",
  "mp4", "mov", "webm", "mkv",
  "mp3", "wav", "m4a",
  "zip", "tar", "gz", "tgz",
];
const ALL_UPLOAD_EXTS = [...TEXT_EXTS, ...DOCX_EXTS, ...BINARY_EXTS];

export const UPLOAD_ACCEPT = ALL_UPLOAD_EXTS.map((e) => `.${e}`).join(",");

export type UploadKind = "text" | "docx" | "binary";

export interface UploadedItem {
  name: string;
  size: number;
  mime?: string;
  fileType: string;
  kind: UploadKind;
  content?: string;
  contentBase64?: string;
  encoding: "utf8" | "base64-docx" | "base64";
}

/** ArrayBuffer → base64（分块 btoa，避免大文件栈溢出）。 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

function uploadKindOf(ext: string): UploadKind | null {
  if (TEXT_EXTS.includes(ext)) return "text";
  if (DOCX_EXTS.includes(ext)) return "docx";
  if (BINARY_EXTS.includes(ext)) return "binary";
  return null;
}

/** 读取单个文件为中性 UploadedItem（文本 utf8 / docx base64-docx / 二进制 base64）。 */
export async function readUploadedItem(file: File): Promise<UploadedItem | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = uploadKindOf(ext);
  if (!kind) return null;
  const base = { name: file.name, size: file.size, mime: file.type, fileType: file.type || ext };
  if (kind === "text") {
    // file.text() 默认按 UTF-8 解码,GBK/CP936 的中文 txt 会整篇变 `�`。
    // 改为读字节后先 UTF-8 严格解码,失败再回退 gb18030(GBK 超集),并去 BOM。
    let text = "";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("gb18030").decode(bytes);
      }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    } catch {
      text = "";
    }
    return { ...base, kind, content: text, encoding: "utf8" };
  }
  const b64 = arrayBufferToBase64(await file.arrayBuffer());
  if (kind === "docx") {
    return { ...base, kind, contentBase64: b64, encoding: "base64-docx" };
  }
  return { ...base, kind, contentBase64: b64, encoding: "base64" };
}

/**
 * 轻需求剧本 = 唯一一个纯文本/docx 文件（走老 uploaded_script 流式通道）。
 * 重需求 = 含二进制/压缩包，或多文件（走 IP DNA 异步管线）。
 */
export function pickScriptFile(files: readonly UploadedItem[]): UploadedItem | null {
  return files.length === 1 && files[0].kind !== "binary" ? files[0] : null;
}

/** 是否走 IP DNA 重需求路径。 */
export function isHeavyUploadSet(files: readonly UploadedItem[]): boolean {
  return files.length > 0 && !pickScriptFile(files);
}
