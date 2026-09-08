/**
 * Phase 5 · 打磨（后端契约）—— 蓝图 §10 / §12 / §14.3。
 *
 * 交互侧不动，此处仅备后端数据契约：
 *   ① 长记忆账本（long-memory ledger）：把"已生成内容 + 设定约束"沉淀为可检索账本，支撑续写/改写一致性；
 *   ② 影游命名统一：提供 tpl-vn-v2 → vn 的展示别名（避免跨仓库物理重命名带来的破坏性改动）。
 *   ③ 多模态提取质量：标注每个最小单元的模态来源，供后续质量深化时定位。
 *
 * 注：实际去 v2 后缀的物理重命名涉及 modes/templates/pipeline 多处与历史 checkpoint 兼容，
 * 风险高，留作独立任务；此处先以别名层抹平展示，不动底层 id（系统自洽优先）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { StoryTimestamp, NarrativeTemplate, NarrativeIpDna, UserAssetManifest } from "../types/narrative-ip-dna.js";
import type { NarrativeContext } from "../types/index.js";
import { outputRunDir, loadHierarchyIndex, type LayoutRoots } from "./filesystem.js";

// ── ① 长记忆账本 ──

export interface LedgerEntry {
  /** 条目 id（如 beat_id / node_id）。 */
  ref: string;
  kind: "fact" | "setting" | "relationship" | "foreshadow" | "decision";
  content: string;
  /** 出现/约束的层级或节点定位。 */
  location?: string;
  created_at: string;
}

export interface LongMemoryLedger {
  story_id: StoryTimestamp;
  storyTitle: string;
  entries: LedgerEntry[];
}

export function createLedger(story_id: StoryTimestamp, storyTitle: string): LongMemoryLedger {
  return { story_id, storyTitle, entries: [] };
}

export function appendLedger(ledger: LongMemoryLedger, entry: Omit<LedgerEntry, "created_at">): LongMemoryLedger {
  ledger.entries.push({ ...entry, created_at: new Date().toISOString() });
  return ledger;
}

/** 幂等追加：同 ref 已存在则跳过（账本回写/续跑去重，避免重复条目膨胀）。 */
export function upsertLedger(ledger: LongMemoryLedger, entry: Omit<LedgerEntry, "created_at">): LongMemoryLedger {
  if (ledger.entries.some((e) => e.ref === entry.ref)) return ledger;
  return appendLedger(ledger, entry);
}

/**
 * 合并旧账本条目到当前账本（续跑加载，§10）：把 loadLedger 的历史条目按 ref 去重并入，
 * 保证多次运行/续写时一致性约束累积而非丢失或重复。
 */
export function mergeLedger(target: LongMemoryLedger, prior?: LongMemoryLedger): LongMemoryLedger {
  if (!prior) return target;
  for (const e of prior.entries) {
    if (!target.entries.some((x) => x.ref === e.ref)) target.entries.push(e);
  }
  return target;
}

/**
 * 从生成产物回写账本（§10 h9）：把已生成的世界/角色/分支决策沉淀为账本条目，
 * 供同故事后续游戏单元、续写、改写复用以保持一致性。确定性、按 ref 去重。
 */
export function harvestLedgerFromGenerated(
  ledger: LongMemoryLedger,
  generated: NarrativeContext,
  opts: { unitRef?: string } = {},
): LongMemoryLedger {
  const prefix = opts.unitRef ? `${opts.unitRef}.` : "";
  const cs = generated.core_settings;
  if (cs?.world_name?.trim()) {
    upsertLedger(ledger, { ref: `${prefix}gen.world`, kind: "setting", content: `世界：${cs.world_name}`, location: "generated.core_settings" });
  }
  if (cs?.main_theme?.trim()) {
    upsertLedger(ledger, { ref: `${prefix}gen.theme`, kind: "setting", content: `主题：${cs.main_theme}`, location: "generated.core_settings" });
  }
  for (const c of generated.detailed_character_sheets ?? []) {
    if (!c.name) continue;
    upsertLedger(ledger, {
      ref: `${prefix}gen.char.${c.name}`,
      kind: "fact",
      content: `${c.name}：${c.role_in_story ?? c.background_information ?? ""}`.trim(),
      location: "generated.characters",
    });
  }
  for (const n of generated.story_framework?.framework.nodes ?? []) {
    if (n.is_branch) {
      upsertLedger(ledger, {
        ref: `${prefix}gen.decision.${n.node_id}`,
        kind: "decision",
        content: `分支：${n.name}${n.main_content ? `（${n.main_content}）` : ""}`,
        location: "generated.story_framework",
      });
    }
  }
  return ledger;
}

/** 按 kind / 关键词检索账本（续写/改写时喂入以保持一致性）。 */
export function queryLedger(
  ledger: LongMemoryLedger,
  opts: { kind?: LedgerEntry["kind"]; keyword?: string } = {},
): LedgerEntry[] {
  return ledger.entries.filter((e) => {
    if (opts.kind && e.kind !== opts.kind) return false;
    if (opts.keyword && !e.content.includes(opts.keyword)) return false;
    return true;
  });
}

/**
 * 从顶层 template 沉淀长记忆账本（确定性）：世界设定 / 主题约束 / 角色关系 / 主角事实。
 * 这是把账本"接入生成侧"的入口——生成/续写/改写前 queryLedger 取约束喂入。
 */
export function buildLedgerFromTemplate(
  story_id: StoryTimestamp,
  storyTitle: string,
  template: NarrativeTemplate,
): LongMemoryLedger {
  const ledger = createLedger(story_id, storyTitle);
  const wv = template.worldview;
  const ce = template.core_elements;
  if (wv.setting?.trim()) appendLedger(ledger, { ref: "worldview.setting", kind: "setting", content: wv.setting, location: "worldview" });
  // 场景结构 / 道具清单（A→B §4.2c）：作为设定约束沉淀，喂入 scene/item 生成步骤保持 IP 一致。
  if (wv.scene_structure?.trim()) appendLedger(ledger, { ref: "worldview.scene_structure", kind: "setting", content: `场景结构：${wv.scene_structure}`, location: "worldview.scene_structure" });
  if (wv.item_inventory?.trim()) appendLedger(ledger, { ref: "worldview.item_inventory", kind: "setting", content: `道具清单：${wv.item_inventory}`, location: "worldview.item_inventory" });
  if (ce.theme?.trim()) appendLedger(ledger, { ref: "core.theme", kind: "setting", content: ce.theme, location: "core_elements" });
  if (ce.subject?.trim()) appendLedger(ledger, { ref: "core.subject", kind: "setting", content: `题材：${ce.subject}`, location: "core_elements" });
  if (ce.literature_style?.trim()) appendLedger(ledger, { ref: "core.literature_style", kind: "setting", content: `文学风格：${ce.literature_style}`, location: "core_elements" });
  if (ce.core_conflict?.trim()) appendLedger(ledger, { ref: "core.conflict", kind: "fact", content: ce.core_conflict, location: "core_elements" });
  for (const ch of template.characters) {
    if (!ch.name) continue;
    if (ch.profile?.trim()) appendLedger(ledger, { ref: `char.${ch.name}`, kind: "fact", content: `${ch.name}：${ch.profile}`, location: "characters" });
    for (const rel of ch.relationships ?? []) {
      if (!rel.target) continue;
      appendLedger(ledger, {
        ref: `rel.${ch.name}.${rel.target}`,
        kind: "relationship",
        content: `${ch.name} 与 ${rel.target}：${rel.relation}${rel.detail ? `（${rel.detail}）` : ""}`,
        location: "characters",
      });
    }
  }
  return ledger;
}

/** 渲染账本为可注入文本（续写/改写一致性约束）。 */
export function renderLedgerInjection(ledger: LongMemoryLedger, opts?: { max?: number }): string {
  const max = opts?.max ?? 40;
  const lines = ledger.entries.slice(0, max).map((e) => `  - [${e.kind}] ${e.content}`);
  if (lines.length === 0) return "";
  return `## 一致性账本（长记忆，须遵守）\n${lines.join("\n")}`;
}

const LEDGER_FILE = "_long_memory_ledger.json";

/** 落盘账本到 output run 目录（断点/续写复用）。 */
export function saveLedger(ledger: LongMemoryLedger, roots?: LayoutRoots): string {
  const dir = outputRunDir(ledger.story_id, ledger.storyTitle, roots);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LEDGER_FILE);
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2), "utf-8");
  return file;
}

/** 读取账本（续写/改写入口）。 */
export function loadLedger(story_id: StoryTimestamp, storyTitle: string, roots?: LayoutRoots): LongMemoryLedger | undefined {
  const file = path.join(outputRunDir(story_id, storyTitle, roots), LEDGER_FILE);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as LongMemoryLedger;
}

// ── ② 影游命名展示别名 ──

const DISPLAY_ALIAS: Record<string, string> = {
  "tpl-vn-v2": "互动影游",
  "tpl-vn": "互动影游(旧版)",
  "tpl-rpg": "RPG",
};

/** 取展示名（抹平 v2 后缀，不动底层 id）。 */
export function displayName(templateId: string): string {
  return DISPLAY_ALIAS[templateId] ?? templateId;
}

// ── ③ 资产清单 / IP DNA 只读输出接口（§6 / §10）──

export interface IpDnaReadonlySummary {
  story_id: StoryTimestamp;
  title: string;
  media_type: string;
  node_count: number;
  /** 层级树（剥离三件套正文，只读结构）。 */
  hierarchy: Array<{ id: string; levelType: string; index: number; title: string; parent: string | null; childRange?: string }>;
}

/** 只读读取层级树索引并压成精简摘要（前端可视化 / 审阅，不可写）。 */
export function readIpDnaSummary(
  story_id: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): IpDnaReadonlySummary | undefined {
  const index: NarrativeIpDna | undefined = loadHierarchyIndex(story_id, title, roots);
  if (!index) return undefined;
  return {
    story_id: index.story_id,
    title: index.title,
    media_type: index.media_type,
    node_count: Object.keys(index.nodes).length,
    hierarchy: Object.values(index.nodes).map((n) => ({
      id: n.id,
      levelType: n.levelType,
      index: n.index,
      title: n.title,
      parent: n.parent,
      childRange: n.childRange,
    })),
  };
}

/** 只读读取资产清单（Phase0 产物落盘后由 input run 目录读取）。 */
export function readAssetManifest(manifestPath: string): UserAssetManifest | undefined {
  if (!fs.existsSync(manifestPath)) return undefined;
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as UserAssetManifest;
}
