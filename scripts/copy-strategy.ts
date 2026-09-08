/**
 * 构建期把 knowledge/strategy 下的 md 复制进 dist —— tsc 只搬 ts，md 得自己搬。
 *
 * strategy-loader 有 dist → src 的回退，所以漏跑本脚本不会让策略卡失效；
 * 但发布产物如果不带 md，就得依赖源码目录同在，这在只分发 dist 的场景下不成立。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/knowledge/strategy");
const dest = path.join(root, "dist/knowledge/strategy");

function copyMd(from: string, to: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(from, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += copyMd(fromPath, toPath);
    } else if (entry.name.endsWith(".md")) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(fromPath, toPath);
      count++;
    }
  }
  return count;
}

const copied = copyMd(src, dest);
console.log(`[copy-strategy] copied ${copied} md file(s) → ${path.relative(root, dest)}`);
