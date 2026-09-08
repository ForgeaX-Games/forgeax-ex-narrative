/**
 * ip-dna/prompt-loader.ts —— IP DNA 提示词外置加载器（P3）。
 *
 * 把原先散落在各 phase 模块里的内联 `*_SYSTEM` 提示词常量，收敛到统一提示词树
 * src/prompts/ip-dna/<name>.md。各 phase 模块改为按名加载（带内联兜底，保证 dist /
 * 缺文件时仍可运行）。
 *
 * 路径解析与 blueprint/prompt-resolver 一致：tsx 直接命中 src，dist 回退 src。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDirWithFallback(candidate: string, srcFallback: string): string {
  return fs.existsSync(candidate) ? candidate : srcFallback;
}

// tsx: __dirname = src/ip-dna → ../prompts/ip-dna
// dist: __dirname = dist/ip-dna → ../../src/prompts/ip-dna
const IP_DNA_PROMPTS_DIR = resolveDirWithFallback(
  path.resolve(__dirname, "../prompts/ip-dna"),
  path.resolve(__dirname, "../../src/prompts/ip-dna"),
);

const cache = new Map<string, string>();

/**
 * 加载 prompts/ip-dna/<name>.md 的正文（去首尾空白）。
 * 文件缺失时返回 fallback（内联兜底），保证健壮性。
 */
export function loadIpDnaPrompt(name: string, fallback: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  try {
    const file = path.join(IP_DNA_PROMPTS_DIR, `${name}.md`);
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf-8").trim();
      if (text.length > 0) {
        cache.set(name, text);
        return text;
      }
    }
  } catch {
    /* 落到 fallback */
  }
  cache.set(name, fallback);
  return fallback;
}

/** 测试用：清空缓存。 */
export function clearIpDnaPromptCache(): void {
  cache.clear();
}
