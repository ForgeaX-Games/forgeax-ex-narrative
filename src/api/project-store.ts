/**
 * project-store.ts — 项目库的落盘事实源（契约见 docs/contracts.md §三）
 *
 * ─────────────────────────────────────────────────────────────────
 * 项目 ≠ 任务
 * ─────────────────────────────────────────────────────────────────
 * 任务（entry）是一次生成，产物按内容类别自动归类；项目是用户自己攒的柜子，
 * 类别由用户新建，条目从**任意任务**挑进来。所以它不能落在 `output/<key>/` 下面——
 * 一个项目的资产本就横跨多个任务，塞进任一任务目录都会把它变成那个任务的附属。
 *
 * 落 `projects/<id>.json`：一文件一项目、不建索引（索引会成为第二份事实源：
 * 删了文件没删索引，界面上就出现点不开的项目）。列表由扫目录得出，目录不会漂移。
 *
 * ─────────────────────────────────────────────────────────────────
 * 资产是引用，不是副本
 * ─────────────────────────────────────────────────────────────────
 * 一条资产只记 `{ taskKey, path }` 指向源任务目录里的文件。删项目只删引用，
 * 源文件仍在各自任务里。复制会凭空造第二份事实源，而 3.4.1 又要求原始档与改后档
 * 各存一份 —— 副本一多就彻底说不清"这是哪一版"。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveNarrativeRoot } from "../runtime/artifact-root.js";

export interface ProjectAsset {
  id: string;
  /** 来源任务的条目键；跨任务收集全靠它回溯出处。 */
  taskKey: string;
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  name: string;
  /** 来源任务里的内容类别，仅作展示线索。 */
  contentType: string | null;
  /** 用户自建类别；null = 未归类，直挂项目下。 */
  categoryId: string | null;
  addedAt: string;
}

export interface ProjectCategory {
  id: string;
  name: string;
}

export interface NarrativeProject {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  categories: ProjectCategory[];
  assets: ProjectAsset[];
}

const PROJECTS_DIRNAME = "projects";

// 与 output/ 同级，挂在同一个双模式产物根下（src/runtime/artifact-root.ts）：
// 插件模式随叙事一起落进平台项目目录，不因为项目库另起一套落盘规则就掉队。
function projectsDir(cwd = resolveNarrativeRoot()): string {
  return path.join(cwd, PROJECTS_DIRNAME);
}

/** id 直接参与文件名，必须挡住路径穿越。 */
export function isSafeProjectId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function projectFile(id: string, cwd?: string): string {
  if (!isSafeProjectId(id)) throw new Error(`invalid project id: ${String(id)}`);
  return path.join(projectsDir(cwd), `${id}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newProjectId(): string {
  return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newSubId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function saveProject(project: NarrativeProject, cwd?: string): NarrativeProject {
  const file = projectFile(project.id, cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next: NarrativeProject = { ...project, updatedAt: nowIso() };
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function loadProject(id: string, cwd?: string): NarrativeProject | undefined {
  if (!isSafeProjectId(id)) return undefined;
  const file = projectFile(id, cwd);
  if (!fs.existsSync(file)) return undefined;
  try {
    return normalizeProject(JSON.parse(fs.readFileSync(file, "utf8")) as NarrativeProject);
  } catch {
    // 单个文件坏了不该让整张列表打不开。
    return undefined;
  }
}

export function listProjects(cwd?: string): NarrativeProject[] {
  const dir = projectsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  const out: NarrativeProject[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const project = loadProject(name.slice(0, -".json".length), cwd);
    if (project) out.push(project);
  }
  // 新的在前，与团队列表同一口径。
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteProject(id: string, cwd?: string): boolean {
  if (!isSafeProjectId(id)) return false;
  const file = projectFile(id, cwd);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

/** 缺字段的旧记录补齐成完整形状：读侧不必到处判空。 */
function normalizeProject(raw: Partial<NarrativeProject>): NarrativeProject {
  const ts = raw.createdAt ?? nowIso();
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    createdAt: ts,
    updatedAt: raw.updatedAt ?? ts,
    categories: Array.isArray(raw.categories)
      ? raw.categories.filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
      : [],
    assets: Array.isArray(raw.assets)
      ? raw.assets
          .filter((a) => a && typeof a.taskKey === "string" && typeof a.path === "string")
          .map((a) => ({
            id: a.id ?? newSubId("ast"),
            taskKey: a.taskKey,
            path: a.path,
            name: a.name ?? a.path.split("/").pop() ?? a.path,
            contentType: a.contentType ?? null,
            categoryId: a.categoryId ?? null,
            addedAt: a.addedAt ?? ts,
          }))
      : [],
  };
}

export function createProject(
  input: { title: string; tags?: readonly string[]; id?: string },
  cwd?: string,
): NarrativeProject {
  const ts = nowIso();
  return saveProject(
    {
      id: input.id && isSafeProjectId(input.id) ? input.id : newProjectId(),
      title: input.title.trim(),
      tags: [...(input.tags ?? [])],
      createdAt: ts,
      updatedAt: ts,
      categories: [],
      assets: [],
    },
    cwd,
  );
}

export interface ProjectPatch {
  title?: string;
  tags?: readonly string[];
  categories?: readonly ProjectCategory[];
  assets?: readonly ProjectAsset[];
}

/**
 * 整字段替换式 PATCH —— 与前端 `projectVault` 的读改写一致。
 *
 * 刻意不做细粒度的「加一条类别 / 移一条资产」端点：那些语义已经在前端一层实现且有
 * 测试（删类别退回未归类等），后端再实现一遍就有两套规则，早晚不一致。这里只保证
 * 落盘形状合法，并在类别消失时把孤儿资产退回未归类。
 */
export function patchProject(
  id: string,
  patch: ProjectPatch,
  cwd?: string,
): NarrativeProject | undefined {
  const current = loadProject(id, cwd);
  if (!current) return undefined;
  const categories = patch.categories
    ? patch.categories.filter((c) => c && typeof c.id === "string" && typeof c.name === "string").map((c) => ({ ...c }))
    : current.categories;
  const catIds = new Set(categories.map((c) => c.id));
  const assets = (patch.assets ?? current.assets).map((a) => ({
    ...a,
    // 指向已消失类别的资产退回未归类，而不是凭空消失。
    categoryId: a.categoryId && catIds.has(a.categoryId) ? a.categoryId : null,
  }));
  return saveProject(
    {
      ...current,
      title: patch.title?.trim() ?? current.title,
      tags: patch.tags ? [...patch.tags] : current.tags,
      categories,
      assets,
    },
    cwd,
  );
}
