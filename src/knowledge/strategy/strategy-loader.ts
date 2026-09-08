/**
 * 叙事策略卡加载器 —— 约定式目录扫描。
 *
 * 与 md-skill-loader 的关键差别：那边靠硬编码映射表（STEP_TO_MD_GLOBAL /
 * SPECIALIST_MATCHERS）决定加载哪些 md，新增一份内容必须改代码；这里**只认目录与文件名**，
 * 把 md 放进对应轴的目录、文件名取词表 code，即刻生效，不需要改任何 ts。
 *
 *   knowledge/strategy/
 *     genre/<genreCode>.md          游戏品类叙事策略   例 rpg-jrpg.md
 *     type/<storyTypeCode>.md       叙事类型策略       例 drama.md
 *     theme/<storyThemeCode>.md     叙事题材策略       例 workplace.md
 *     structure/<structureCode>.md  叙事结构策略       例 linear.md
 *
 * 文件格式：可选 YAML frontmatter + markdown 正文，正文即策略卡内容。
 *
 *   ---
 *   name: JRPG
 *   stages: [demand, design, outline, structure]
 *   ---
 *   ## 叙事重心
 *   ...
 *
 * frontmatter 全部可选：name 缺省取文件名，stages 缺省为四个环节全生效。
 * 文件缺失、解析失败、code 不在词表内都不抛异常 —— 该轴留空，由上层决定是否降级。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StrategyAxis } from "../narrative-axes/index.js";
import { STRATEGY_AXES } from "../narrative-axes/index.js";
import type { StrategyStage } from "../narrative-axes/story-structures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALL_STAGES: readonly StrategyStage[] = ["demand", "design", "outline", "structure"];

/** 轴 → 子目录名。目录名与轴 id 一致，便于人肉对照。 */
const AXIS_DIR: Readonly<Record<StrategyAxis, string>> = {
  genre: "genre",
  type: "type",
  theme: "theme",
  structure: "structure",
};

export interface StrategyCard {
  axis: StrategyAxis;
  /** 文件名（不含 .md），必须等于对应词表的 code */
  code: string;
  /** 展示名，缺省取 code */
  name: string;
  /** 生效环节，缺省四个环节全生效 */
  stages: readonly StrategyStage[];
  /** markdown 正文（已剥离 frontmatter、已 trim） */
  body: string;
  /** 来源文件绝对路径，lint 与报错用 */
  file: string;
}

interface StrategyIndex {
  byAxis: Record<StrategyAxis, Map<string, StrategyCard>>;
  root: string | null;
  /** 扫到但解析为空的文件，lint 用 */
  emptyFiles: string[];
}

let CACHED: StrategyIndex | null = null;

/**
 * 策略库根目录。
 *
 * dev 走 tsx 直接跑 src，__dirname 即 src/knowledge/strategy；编译产物里 tsc 不搬 md，
 * 所以 dist 下先看构建期复制过来的副本，没有再回退到 src —— 两种运行方式都能解析到内容，
 * 不会出现"库函数被 import 后策略卡静默失效"。
 */
export function getStrategyRoot(): string | null {
  const candidates = [__dirname, path.resolve(__dirname, "../../../src/knowledge/strategy")];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, AXIS_DIR.genre))) return dir;
  }
  return null;
}

function parseCard(axis: StrategyAxis, file: string): StrategyCard | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  let name = path.basename(file, ".md");
  let stages: readonly StrategyStage[] = ALL_STAGES;
  let body = raw;

  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end > 0) {
      const front = raw.slice(3, end);
      body = raw.slice(end + 4);
      for (const line of front.split("\n")) {
        const m = /^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/.exec(line);
        if (!m) continue;
        const [, key, value] = m;
        if (key === "name") {
          name = value.replace(/^["']|["']$/g, "");
        } else if (key === "stages") {
          const parsed = value
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter((s): s is StrategyStage => (ALL_STAGES as readonly string[]).includes(s));
          if (parsed.length > 0) stages = parsed;
        }
      }
    }
  }

  body = body.trim();
  if (!body) return null;
  return { axis, code: path.basename(file, ".md"), name, stages, body, file };
}

/** 扫描并缓存整个策略库。重复调用返回缓存。 */
export function ensureStrategyLoaded(): StrategyIndex {
  if (CACHED) return CACHED;
  const root = getStrategyRoot();
  const byAxis = {
    genre: new Map<string, StrategyCard>(),
    type: new Map<string, StrategyCard>(),
    theme: new Map<string, StrategyCard>(),
    structure: new Map<string, StrategyCard>(),
  } as Record<StrategyAxis, Map<string, StrategyCard>>;
  const emptyFiles: string[] = [];

  if (root) {
    for (const axis of STRATEGY_AXES) {
      const dir = path.join(root, AXIS_DIR[axis]);
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".md") || name.startsWith("_")) continue;
        const file = path.join(dir, name);
        const card = parseCard(axis, file);
        if (card) byAxis[axis].set(card.code, card);
        else emptyFiles.push(file);
      }
    }
  }

  CACHED = { byAxis, root, emptyFiles };
  return CACHED;
}

/** 强制重扫（测试与热更新用）。 */
export function resetStrategyCache(): void {
  CACHED = null;
}

export function getStrategyCard(axis: StrategyAxis, code: string | null | undefined): StrategyCard | null {
  if (!code) return null;
  return ensureStrategyLoaded().byAxis[axis].get(code) ?? null;
}

export function listStrategyCards(axis: StrategyAxis): StrategyCard[] {
  return [...ensureStrategyLoaded().byAxis[axis].values()].sort((a, b) => a.code.localeCompare(b.code));
}

export interface StrategySelection {
  genre?: string | null;
  type?: string | null;
  theme?: string | null;
  structure?: string | null;
}

/**
 * 取出四轴在某个环节生效的策略卡。
 * 未提供 code、找不到文件、或该卡不在此环节生效，对应轴返回 null —— 空轴是合法状态。
 */
export function getStrategyCards(
  selection: StrategySelection,
  stage: StrategyStage,
): Record<StrategyAxis, StrategyCard | null> {
  const pick = (axis: StrategyAxis): StrategyCard | null => {
    const card = getStrategyCard(axis, selection[axis]);
    if (!card) return null;
    return card.stages.includes(stage) ? card : null;
  };
  return {
    genre: pick("genre"),
    type: pick("type"),
    theme: pick("theme"),
    structure: pick("structure"),
  };
}

/** 调试与 lint 用的加载摘要。 */
export function getStrategyStats(): {
  root: string | null;
  counts: Record<StrategyAxis, number>;
  emptyFiles: string[];
} {
  const idx = ensureStrategyLoaded();
  return {
    root: idx.root,
    counts: {
      genre: idx.byAxis.genre.size,
      type: idx.byAxis.type.size,
      theme: idx.byAxis.theme.size,
      structure: idx.byAxis.structure.size,
    },
    emptyFiles: [...idx.emptyFiles],
  };
}
