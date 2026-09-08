/**
 * 策略库校验：文件名必须命中词表 code，正文不能为空，stages 必须是四个合法环节。
 *
 * 约定式加载的代价是拼错文件名不会报错、只会静默不生效，这个脚本就是把静默失效变成显式失败。
 * 用法：npm run lint:strategy
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENRE_TAXONOMY } from "../src/knowledge/genre-taxonomy.js";
import {
  STORY_TYPE_CODES,
  STORY_THEME_CODES,
  STORY_STRUCTURE_CODES,
  STRATEGY_AXES,
} from "../src/knowledge/narrative-axes/index.js";
import type { StrategyAxis } from "../src/knowledge/narrative-axes/index.js";
import {
  getStrategyRoot,
  listStrategyCards,
  getStrategyStats,
} from "../src/knowledge/strategy/strategy-loader.js";

const VALID_STAGES = new Set(["demand", "design", "outline", "structure"]);

const VALID_CODES: Record<StrategyAxis, Set<string>> = {
  genre: new Set(GENRE_TAXONOMY.map((g) => g.code)),
  type: new Set<string>(STORY_TYPE_CODES),
  theme: new Set<string>(STORY_THEME_CODES),
  structure: new Set<string>(STORY_STRUCTURE_CODES),
};

const errors: string[] = [];
const warnings: string[] = [];

const root = getStrategyRoot();
if (!root) {
  console.error("[lint-strategy] 找不到策略库根目录 knowledge/strategy");
  process.exit(1);
}

for (const axis of STRATEGY_AXES) {
  const dir = path.join(root, axis);
  if (!fs.existsSync(dir)) {
    errors.push(`缺少轴目录 ${axis}/`);
    continue;
  }

  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith("_")) continue;
    const rel = `${axis}/${name}`;
    if (!name.endsWith(".md")) {
      warnings.push(`${rel} 不是 md，会被加载器忽略`);
      continue;
    }
    const code = name.slice(0, -3);
    if (!VALID_CODES[axis].has(code)) {
      errors.push(`${rel} 的文件名不在 ${axis} 词表里，这张卡永远不会被加载`);
    }
  }

  for (const card of listStrategyCards(axis)) {
    const rel = path.relative(root, card.file);
    for (const stage of card.stages) {
      if (!VALID_STAGES.has(stage)) errors.push(`${rel} 的 stages 含非法环节 ${stage}`);
    }
    if (card.body.length < 20) warnings.push(`${rel} 正文过短（${card.body.length} 字符）`);
  }
}

const stats = getStrategyStats();
for (const file of stats.emptyFiles) {
  errors.push(`${path.relative(root, file)} 正文为空，加载器会跳过它`);
}

const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
console.log(
  `[lint-strategy] ${total} 张策略卡 ` +
    STRATEGY_AXES.map((a) => `${a}=${stats.counts[a]}`).join(" ") +
    `\n[lint-strategy] root=${path.relative(path.dirname(fileURLToPath(import.meta.url)), root)}`,
);
for (const w of warnings) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`  error ${e}`);

if (errors.length > 0) {
  console.error(`[lint-strategy] ${errors.length} 处错误`);
  process.exit(1);
}
console.log("[lint-strategy] ok");
