/**
 * 把后端席位注册表投影成前端常量文件。渲染逻辑在 src/pipeline/seats-projection.ts，
 * 本脚本只负责落盘（这样测试能直接引用渲染器比对，不必把 scripts 纳入 tsc rootDir）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSISTANT_SEATS } from "../src/pipeline/routing/assistant-seats.js";
import { renderSeatsModule } from "../src/pipeline/routing/seats-projection.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "viz/src/composer/seats.generated.ts");

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, renderSeatsModule(), "utf8");
console.log(
  `[gen-seats] wrote ${ASSISTANT_SEATS.length} seats → ${path.relative(root, target)}`,
);
