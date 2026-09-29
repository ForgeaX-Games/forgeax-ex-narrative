/**
 * custom-team/store.ts — 团队 profile 的落盘事实源
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么落在 input 侧，而不是 output
 * ─────────────────────────────────────────────────────────────────
 * output/<run>/ 是**一次生成**的产物；蒸馏出来的助手不属于任何一次生成，
 * 它是用户投喂作品换来的、可跨任务复用的资产，与被提炼的书处在同一侧。
 * 所以放 `input/custom_teams/<id>.json`，与 `input/book/...` 的提炼产物同源。
 *
 * ─────────────────────────────────────────────────────────────────
 * 一文件一团队，不建索引
 * ─────────────────────────────────────────────────────────────────
 * 列表由扫目录得出。索引文件会带来第二份事实源：删了文件没删索引、
 * 或写完文件没更新索引，界面上就会出现点不开的团队。目录本身不会漂移。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { DistilledProfile, TeamKind, TeamRecord } from "./types.js";
import { bookUidFor } from "./types.js";
import { resolveNarrativeRoot } from "../runtime/artifact-root.js";

const TEAMS_DIRNAME = path.join("input", "custom_teams");

// 与 input/ 同级，挂在同一个双模式产物根下（src/runtime/artifact-root.ts）：
// 插件模式随叙事一起落进平台项目目录。
function teamsDir(cwd = resolveNarrativeRoot()): string {
  return path.join(cwd, TEAMS_DIRNAME);
}

/** 只接受安全的 id：它直接参与文件名，必须挡住路径穿越。 */
export function isSafeTeamId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function teamFile(id: string, cwd?: string): string {
  if (!isSafeTeamId(id)) throw new Error(`非法团队 id: ${id}`);
  return path.join(teamsDir(cwd), `${id}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newTeamId(): string {
  return `team_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface CreateTeamInput {
  kind: TeamKind;
  source: string;
  /** 用户声明的书籍分组：`{ title, files }`，bookUid 由本层按约定补齐。 */
  books?: Array<{ title: string; files?: string[] }>;
  authorMaterials?: string[];
  useEncyclopedia?: boolean;
  id?: string;
}

export function createTeam(input: CreateTeamInput, cwd?: string): TeamRecord {
  const ts = nowIso();
  const record: TeamRecord = {
    id: input.id ?? newTeamId(),
    kind: input.kind,
    source: input.source.trim(),
    books: (input.books ?? []).map((b) => ({
      bookUid: bookUidFor(b.title),
      title: b.title.trim(),
      files: [...(b.files ?? [])],
    })),
    authorMaterials: [...(input.authorMaterials ?? [])],
    useEncyclopedia: input.useEncyclopedia ?? input.kind === "author_advisor",
    status: "draft",
    createdAt: ts,
    updatedAt: ts,
  };
  saveTeam(record, cwd);
  return record;
}

export function saveTeam(record: TeamRecord, cwd?: string): TeamRecord {
  const file = teamFile(record.id, cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next: TeamRecord = { ...record, updatedAt: nowIso() };
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function loadTeam(id: string, cwd?: string): TeamRecord | undefined {
  const file = teamFile(id, cwd);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as TeamRecord;
  } catch {
    // 单个文件坏了不该让整张列表打不开——上层按 undefined 处理。
    return undefined;
  }
}

export function listTeams(cwd?: string): TeamRecord[] {
  const dir = teamsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  const records: TeamRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const record = loadTeam(name.slice(0, -".json".length), cwd);
    if (record) records.push(record);
  }
  // 新的在前：列表默认按最近建的排。
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteTeam(id: string, cwd?: string): boolean {
  const file = teamFile(id, cwd);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

/** 只有 ready 的团队能被注入 —— draft/distilling 的 profile 还不存在。 */
export function listReadyTeams(cwd?: string): TeamRecord[] {
  return listTeams(cwd).filter((t) => t.status === "ready" && t.profile);
}

export function markDistilling(id: string, cwd?: string): TeamRecord | undefined {
  const record = loadTeam(id, cwd);
  if (!record) return undefined;
  return saveTeam({ ...record, status: "distilling", errorMessage: undefined }, cwd);
}

export function markReady(id: string, profile: DistilledProfile, cwd?: string): TeamRecord | undefined {
  const record = loadTeam(id, cwd);
  if (!record) return undefined;
  return saveTeam({ ...record, status: "ready", profile, errorMessage: undefined }, cwd);
}

export function markFailed(id: string, message: string, cwd?: string): TeamRecord | undefined {
  const record = loadTeam(id, cwd);
  if (!record) return undefined;
  // 失败不回 draft：回了就跟"从没跑过"分不开，用户只会再点一次同样会挂的按钮。
  return saveTeam({ ...record, status: "failed", errorMessage: message }, cwd);
}
