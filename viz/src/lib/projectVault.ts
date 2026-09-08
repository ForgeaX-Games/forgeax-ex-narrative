/**
 * 项目库——用户自建的资产库。
 *
 * 与「任务」正交：任务是一次对话开启的生成，产物按内容类别自动归类，用户不能改；
 * 项目是用户自己攒的柜子，类别由用户新建，条目由用户从**任意任务**的资源里挑进来。
 * 一个项目的资产可以横跨多个任务——这正是资源库与资产库解耦的意思。
 *
 * ─────────────────────────────────────────────────────────────────
 * 事实源在后端
 * ─────────────────────────────────────────────────────────────────
 * 上一版落 localStorage（`createLocalCollection`）。那时后端连 projects 概念都没有，
 * 是合理的过渡；但资产库的定位是「作者确认的、可供下游生成引用的产物」，
 * 而下游生成跑在后端——存浏览器里后端根本读不到，这条链是断的。
 *
 * 现在改成 `/api/narrative/projects` 的薄封装。函数签名一个没动（这正是上一版注释
 * 预留的"只换端口实现，调用方一行不用改"），所以 `ProjectVault.tsx` 无需改动。
 *
 * 注意本文件只管**归档组织**。"这份产物是不是定稿"是另一张正交的表，
 * 事实源在 `_entry.json.assets[]`，走 `assetConfirm.ts`。
 */
import { API_BASE } from "../hooks/useNarrativeStream";

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface ProjectAsset {
  id: string;
  /** 来源任务的条目键。跨任务收集时全靠它回溯出处。 */
  taskKey: string;
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  name: string;
  /** 来源任务里的内容类别，仅作展示线索；项目内的归类以 categoryId 为准。 */
  contentType: string | null;
  /** 用户自建类别；null = 未归类，直挂项目下。 */
  categoryId: string | null;
  addedAt: string;
}

/**
 * 项目里的中间层。
 *
 * 全是用户自己开的——新建时会拿单品助手花名册当选项递给用户，但选中之后落下来的
 * 也只是一个普普通通的自建类别（照样能改名、能删）。不预置、不铺满：项目是用户的柜子，
 * 柜子里有几个格子该由攒东西的人说，系统替他摆满二十个空格只是把噪声塞进他的空间。
 */
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

const listeners = new Set<(items: NarrativeProject[]) => void>();
let cache: NarrativeProject[] = [];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/narrative/projects${path}`, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const json = (payload: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

/** 拉一次并广播——写操作之后都走它，让侧栏与中栏同步。 */
async function refresh(): Promise<NarrativeProject[]> {
  const { projects } = await request<{ projects: NarrativeProject[] }>("");
  cache = projects;
  for (const l of listeners) l(projects);
  return projects;
}

export const listProjects = (): Promise<NarrativeProject[]> => refresh();

export async function getProject(id: string): Promise<NarrativeProject | null> {
  return (await refresh()).find((p) => p.id === id) ?? null;
}

export function subscribeProjects(listener: (items: NarrativeProject[]) => void): () => void {
  listeners.add(listener);
  if (cache.length > 0) listener(cache);
  return () => {
    listeners.delete(listener);
  };
}

export async function createProject(title: string, tags: readonly string[] = []): Promise<NarrativeProject> {
  const { project } = await request<{ project: NarrativeProject }>(
    "",
    { method: "POST", ...json({ title: title.trim(), tags: [...tags] }) },
  );
  await refresh();
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refresh();
}

/**
 * 所有写操作的公共出口：取出、改、整字段盖回。
 *
 * 刻意保留"读改写"而不是给每个动作开一个细粒度端点：删类别退回未归类、重复收集只改归类
 * 这些规则已在本文件里成型，后端再实现一遍就有两套规则，早晚不一致。
 */
async function mutate(
  projectId: string,
  fn: (project: NarrativeProject) => NarrativeProject,
): Promise<NarrativeProject | null> {
  const current = cache.find((p) => p.id === projectId) ?? (await getProject(projectId));
  if (!current) return null;
  const next = fn(current);
  const { project } = await request<{ project: NarrativeProject }>(
    `/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      ...json({
        title: next.title,
        tags: next.tags,
        categories: next.categories,
        assets: next.assets,
      }),
    },
  );
  await refresh();
  return project;
}

export function updateProject(
  id: string,
  patch: { title?: string; tags?: readonly string[] },
): Promise<NarrativeProject | null> {
  return mutate(id, (p) => ({
    ...p,
    title: patch.title?.trim() ?? p.title,
    tags: patch.tags ? [...patch.tags] : p.tags,
  }));
}

export function addCategory(projectId: string, name: string): Promise<NarrativeProject | null> {
  const trimmed = name.trim();
  if (!trimmed) return Promise.resolve(null);
  return mutate(projectId, (p) =>
    p.categories.some((c) => c.name === trimmed)
      ? p
      : { ...p, categories: [...p.categories, { id: newId("cat"), name: trimmed }] },
  );
}

export function renameCategory(
  projectId: string,
  categoryId: string,
  name: string,
): Promise<NarrativeProject | null> {
  const trimmed = name.trim();
  if (!trimmed) return Promise.resolve(null);
  return mutate(projectId, (p) => ({
    ...p,
    categories: p.categories.map((c) => (c.id === categoryId ? { ...c, name: trimmed } : c)),
  }));
}

/** 删类别不删资产：里面的东西退回「未归类」，避免用户一次误删丢掉收集成果。 */
export function deleteCategory(projectId: string, categoryId: string): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => ({
    ...p,
    categories: p.categories.filter((c) => c.id !== categoryId),
    assets: p.assets.map((a) => (a.categoryId === categoryId ? { ...a, categoryId: null } : a)),
  }));
}

export interface AssetRef {
  taskKey: string;
  path: string;
  name: string;
  contentType?: string | null;
}

/** 同一任务的同一份文件在一个项目里只留一条；重复收集只改归类。 */
export function collectAsset(
  projectId: string,
  ref: AssetRef,
  categoryId: string | null = null,
): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => {
    const at = p.assets.findIndex((a) => a.taskKey === ref.taskKey && a.path === ref.path);
    if (at >= 0) {
      const assets = [...p.assets];
      assets[at] = { ...assets[at]!, categoryId };
      return { ...p, assets };
    }
    return {
      ...p,
      assets: [
        ...p.assets,
        {
          id: newId("ast"),
          taskKey: ref.taskKey,
          path: ref.path,
          name: ref.name,
          contentType: ref.contentType ?? null,
          categoryId,
          addedAt: nowIso(),
        },
      ],
    };
  });
}

export function removeAsset(projectId: string, assetId: string): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => ({ ...p, assets: p.assets.filter((a) => a.id !== assetId) }));
}

export function moveAsset(
  projectId: string,
  assetId: string,
  categoryId: string | null,
): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => ({
    ...p,
    assets: p.assets.map((a) => (a.id === assetId ? { ...a, categoryId } : a)),
  }));
}