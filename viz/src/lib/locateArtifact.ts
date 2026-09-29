/**
 * 「定位」：把一份叙事产物指给平台的系统文件区（Content Browser）去展开并选中。
 *
 * 分两跳，且这个切分是必须的：
 *
 * 1. 问后端要「相对游戏根」的路径（`GET /api/narrative/locate/:runId`）。前端手里
 *    只有 `<group>/<相对路径>` 这种清单口径，而 `group` 是环节标签不是磁盘目录，
 *    真实目录表和双模式映射表都只存在于后端；在前端复刻这两张表必然漂移。
 * 2. 把拿到的路径按宿主既有协议 postMessage 出去（`revealInContentBrowser`）。
 *
 * 独立模式下第 1 跳会回 `standalone`——此时没有宿主也没有文件区，函数据实返回
 * 状态、不发消息，由调用点决定怎么呈现（当前是把动作藏掉）。
 */

import { API_BASE } from "../hooks/useNarrativeStream";
import { revealInContentBrowser } from "./bridge";
import { getPaneMode } from "./pane";

export type LocateStatus = "ok" | "standalone" | "not-found" | "error";

/** 这一份产物的地址，与 `sendFileToComposer` 收的形状同源，好让两个动作对称。 */
export interface LocateTarget {
  /** 产物目录（相对 `output/`）：主管线就是条目键，次管线是 `<key>/pipelines/<pid>`。 */
  entryKey: string;
  /** `<group>/<相对路径>`，与 GET /files/:key 同形。 */
  path: string;
  /** 展示名（文件名）。 */
  name: string;
}

/**
 * 当前形态下「定位」是否可用：只有被平台挂成分栏 iframe 时才有文件区可定位。
 * 同步、零请求，用于决定这个按钮渲不渲染。
 */
export function canLocateInContentBrowser(): boolean {
  return getPaneMode() !== "full";
}

export async function locateInContentBrowser(target: LocateTarget): Promise<LocateStatus> {
  try {
    const url =
      `${API_BASE}/api/narrative/locate/${encodeURIComponent(target.entryKey)}` +
      `?path=${encodeURIComponent(target.path)}`;
    const res = await fetch(url);
    if (!res.ok) return res.status === 404 ? "not-found" : "error";
    const data = (await res.json()) as { ok?: boolean; gamePath?: string; reason?: string };
    if (!data.ok || !data.gamePath) {
      return data.reason === "standalone" ? "standalone" : "not-found";
    }
    revealInContentBrowser({ path: data.gamePath, name: target.name });
    return "ok";
  } catch {
    return "error";
  }
}
