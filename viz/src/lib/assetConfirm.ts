/**
 * 确认状态表的前端端口（契约 docs/contracts.md §三）。
 *
 * 与 `projectVault.ts` 是两张正交的表，别混：
 *  - 这里回答"这份产物是定稿吗" → 事实源 `_entry.json.assets[]`，就在产物旁边，
 *    下游按条目跑生成时一读就有；
 *  - projectVault 回答"这份定稿归到项目 X 的类别 Y" → 事实源 projects 后端，跨任务。
 *
 * 所以一份产物可以已确认但没归档，也可以归档进多个项目；两表不同步、不互相校验。
 *
 * 版本钉住：`version` 缺省表示"跟随最新"，给了则钉死那一稿（此后重生成不改变下游
 * 读到的内容）。两种都是真实需求，故缺省不写 1 —— 写了会把"跟随"悄悄变成"钉在初稿"。
 */
import { API_BASE } from "../hooks/useNarrativeStream";
import { parseSourceDir } from "../store/laneAddress";

export interface ConfirmedAsset {
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  /** 泳道；缺省 = 主管线。次管线的同名产物靠它与主管线分开。 */
  pipelineId?: string;
  version?: number;
  confirmedAt?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/narrative/assets${path}`, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/**
 * 界面各处（任务侧栏、项目库）手里拿的是**产物目录**：主管线就是条目键，次管线是
 * `<key>/pipelines/<pid>`。确认表按条目落盘、按泳道分条，所以入口一律先反解一次。
 */
function address(sourceDir: string): { entryKey: string; pipelineId?: string } {
  const parsed = parseSourceDir(sourceDir);
  return { entryKey: parsed?.entryKey ?? sourceDir, pipelineId: parsed?.pipelineId };
}

/** 某条泳道已确认的定稿；`sourceDir` 收产物目录（主管线传条目键即可）。 */
export async function listConfirmedAssets(sourceDir: string): Promise<ConfirmedAsset[]> {
  const { entryKey, pipelineId } = address(sourceDir);
  const query = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : "";
  const { assets } = await request<{ assets: ConfirmedAsset[] }>(
    `/${encodeURIComponent(entryKey)}${query}`,
  );
  return assets;
}

async function write(
  sourceDir: string,
  payload: { path: string; version?: number; confirmed: boolean },
): Promise<ConfirmedAsset[]> {
  const { entryKey, pipelineId } = address(sourceDir);
  const { assets } = await request<{ assets: ConfirmedAsset[] }>(`/${encodeURIComponent(entryKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, pipelineId }),
  });
  // 写返回的是整个条目的清单（含别条泳道）；调用方只关心自己这条。
  return assets.filter((a) => (a.pipelineId ?? undefined) === pipelineId);
}

/** 确认（或改钉住的版本）。 */
export const confirmAsset = (
  sourceDir: string,
  path: string,
  version?: number,
): Promise<ConfirmedAsset[]> => write(sourceDir, { path, version, confirmed: true });

export const unconfirmAsset = (sourceDir: string, path: string): Promise<ConfirmedAsset[]> =>
  write(sourceDir, { path, confirmed: false });

export const isConfirmed = (assets: readonly ConfirmedAsset[], path: string): boolean =>
  assets.some((a) => a.path === path);