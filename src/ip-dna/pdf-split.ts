/**
 * ip-dna/pdf-split.ts —— PDF 拆页适配器（蓝图 §6.1 picture_compress：PDF 拆页）。
 *
 * 把 PDF（尤其扫描版/画册 PDF）按页栅格化为 JPG，逐页汇入多模态转写主链
 * （图片 → callWithImages 转写 → 文字），与漫画页走完全相同的路径。
 *
 * 默认实现基于 poppler 的 `pdftoppm` CLI（常见、轻量），不可用 / 失败 → 透传原 PDF（降级，不抛错）。
 * 说明：当前管线无 PDF 文本解析，向量/扫描 PDF 原本都产出空文本；栅格化转写是净增益、无回归。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IncomingFile } from "./phase0-foundation.js";
import type { PdfPageSplitter } from "./phase0-compress.js";

export interface PdftoppmConfig {
  /** pdftoppm 可执行路径（默认 "pdftoppm"，依赖 PATH）。 */
  pdftoppmPath?: string;
  /** 栅格化 DPI（默认 150，平衡清晰度与 token 成本）。 */
  dpi?: number;
  /** 最大页数（保护性上限，默认 200）。 */
  maxPages?: number;
  /** 超时（ms，默认 120s）。 */
  timeoutMs?: number;
}

function runCli(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      resolve({ code: -1 });
    }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); resolve({ code: -1 }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1 }); });
  });
}

/**
 * 构建基于 pdftoppm 的 PDF 拆页器（PdfPageSplitter）。
 * `pdftoppm -jpeg -r DPI input prefix` → prefix-1.jpg / prefix-2.jpg ...（按页码升序）。
 */
export function createPdftoppmPageSplitter(cfg: PdftoppmConfig = {}): PdfPageSplitter {
  const pdftoppmPath = cfg.pdftoppmPath ?? "pdftoppm";
  const dpi = cfg.dpi ?? 150;
  const maxPages = cfg.maxPages ?? 200;
  const timeoutMs = cfg.timeoutMs ?? 120_000;

  return async (file: IncomingFile): Promise<IncomingFile[]> => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfsplit-"));
    const inputPath = path.join(tmpDir, "input.pdf");
    const prefix = path.join(tmpDir, "page");
    const base = file.fileName.replace(/\.pdf$/i, "");
    try {
      const data = typeof file.data === "string" ? Buffer.from(file.data) : file.data;
      fs.writeFileSync(inputPath, data);
      const { code } = await runCli(
        pdftoppmPath,
        ["-jpeg", "-r", String(dpi), "-l", String(maxPages), inputPath, prefix],
        timeoutMs,
      );
      if (code !== 0) return [file];
      const pages = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith("page") && f.endsWith(".jpg"))
        .sort((a, b) => pageNum(a) - pageNum(b));
      if (pages.length === 0) return [file];
      return pages.map((p, i) => ({
        fileName: `${base}_p${i + 1}.jpg`,
        data: fs.readFileSync(path.join(tmpDir, p)),
        fileType: "image/jpeg",
        role: file.role,
      }));
    } catch {
      return [file];
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  };
}

function pageNum(name: string): number {
  const m = name.match(/(\d+)\.jpg$/);
  return m ? parseInt(m[1], 10) : 0;
}
