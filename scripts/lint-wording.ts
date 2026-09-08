/**
 * 表述噪声校验：随项目分发的文本里，不许出现只有开发现场才懂的指代。
 *
 * 为什么要一道机器闸：写代码时最顺手的注释方式就是引用内部功能编号（"见功能清单 3.3.2"），
 * 而功能清单不随项目分发。读到它的人——外部读者、以及照 SKILL.md 行事的宿主 agent——
 * 会当成自己上下文缺失，去找一份根本不存在的文件。人靠自觉清不干净，下一轮又会写回来。
 *
 * 判别标准是**读者手上有没有那个指代物**：
 *   - 项目自己的文件、自己发布的编号、代码里的符号 → 可以引
 *   - 内部功能清单、阶段代号、评审轮次、某次对话 → 不能引
 *
 * 用法：npm run lint:wording
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_EXT = new Set([".ts", ".tsx", ".md", ".json", ".css"]);

/** 不扫：依赖、构建产物、运行时数据、语料。 */
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "output",
  "projects",
  "input",
  "knowledge_base",
  ".git",
  ".ipdna-jobs",
]);

interface Rule {
  /** 命中即算噪声。用 g 标志，逐行 exec。 */
  readonly pattern: RegExp;
  /** 报错时告诉作者该怎么改，不只说"违规"。 */
  readonly fix: string;
}

const RULES: readonly Rule[] = [
  {
    pattern: /feature[ _-]?list/gi,
    fix: "指向一份不随项目分发的内部功能清单。换成它指的那个功能的名字（如「剧情树增删」），别只删词——留下裸编号 3.3.2 比原文更糟",
  },
  {
    pattern: /\bMVP\b/g,
    fix: "阶段代号，外部读者无从对应。直接说清是哪几件功能，或整句删掉",
  },
  {
    pattern: /mvp-contracts/g,
    fix: "契约文档已改名为 docs/contracts.md",
  },
  {
    pattern: /参见[^\n。]{0,8}对话|见(?:上次|之前那次)对话|按对话里说的/g,
    fix: "对话记录不随项目分发。把结论本身写进来",
  },
  {
    // 只拦"开发轮次"义的复合说法。「本轮询」「本轮启动响应」「这一轮视角切换」（循环
    // 结构卡）都是正当用法，一刀切成黑名单会把闸门变成噪声源，然后被人关掉。
    pattern: /本轮(?:澄清|新增|重构|改动|交互|调整|决定|方案)|本期(?:只|不|新增|改动)|上一轮(?:刚|已|的改动)|这一轮(?:只|先)/g,
    fix: "评审/开发轮次是只有当时在场的人才懂的时间指代。直接陈述事实（「已废除」而非「本轮废除」）",
  },
];

/**
 * 例外：术语本身正当，与我们的阶段代号同形。
 *
 * 每条都要写清凭什么例外——不写理由的例外会一直长，长到闸门失效。
 */
const ALLOW: readonly { readonly file: string; readonly reason: string }[] = [
  {
    file: "src/knowledge/game-design/skills/GameDevelopmentWorkflow.md",
    reason: "这里的「最小可玩版本（MVP）」是教给用户的游戏开发常识，不是我们的阶段代号",
  },
  {
    file: "src/knowledge/strategy/structure/loop.md",
    reason: "循环结构卡讲的就是「一轮一轮」，「本轮新增认知」是它的题内话",
  },
  {
    file: "scripts/lint-wording.ts",
    reason: "本校验脚本自身必须写出被禁的词",
  },
];

const ALLOW_FILES = new Set(ALLOW.map((a) => a.file));

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
}

const files: string[] = [];
walk(ROOT, files);

interface Hit {
  readonly rel: string;
  readonly line: number;
  readonly text: string;
  readonly fix: string;
}

const hits: Hit[] = [];

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  if (ALLOW_FILES.has(rel)) continue;
  const lines = fs.readFileSync(abs, "utf-8").split("\n");
  lines.forEach((text, i) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      const m = rule.pattern.exec(text);
      if (m) hits.push({ rel, line: i + 1, text: m[0], fix: rule.fix });
    }
  });
}

console.log(`[lint-wording] 扫了 ${files.length} 个文件`);

if (hits.length > 0) {
  // 按修改建议聚类，一类一次读懂，而不是逐行看同一句话重复 60 遍。
  const byFix = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byFix.get(h.fix);
    if (list) list.push(h);
    else byFix.set(h.fix, [h]);
  }
  for (const [fix, list] of byFix) {
    console.error(`\n  ${list.length} 处 · ${fix}`);
    for (const h of list) console.error(`    ${h.rel}:${h.line}  「${h.text}」`);
  }
  console.error(`\n[lint-wording] ${hits.length} 处表述噪声`);
  process.exit(1);
}

console.log("[lint-wording] ok");
