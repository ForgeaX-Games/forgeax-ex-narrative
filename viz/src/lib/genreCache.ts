import { useEffect, useState } from "react";
import { fetchGenres, type GenreCategoryGroup } from "../hooks/useNarrativeStream";
import { getLocale } from "../i18n";

/**
 * 品类目录的进程内缓存。
 *
 * 目录是后端数据且一整跑不变，但要它的地方不少（画布上每一枚路由节点、顶栏专家组菜单、
 * 任务条目的路由行）。缓存的是 Promise 而非结果：并发的头几个调用共享同一次请求，
 * 不会因为"还没回来"各自再发一遍。按 locale 分键，切语言即换目录。
 */
const cache: Record<string, Promise<GenreCategoryGroup[]>> = {};

export function loadGenres(locale: string = getLocale()): Promise<GenreCategoryGroup[]> {
  if (!cache[locale]) cache[locale] = fetchGenres(locale).catch(() => []);
  return cache[locale];
}

/**
 * 把品类 code 翻成显示名的解析器。
 * 目录还没到时退回 code——宁可显示 `jrpg_classic` 也别显示空白，用户至少知道有路由。
 */
export function useGenreName(enabled = true): (code: string | null | undefined) => string | null {
  const [groups, setGroups] = useState<GenreCategoryGroup[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadGenres().then((g) => { if (alive) setGroups(g); });
    return () => { alive = false; };
  }, [enabled]);

  return (code) => {
    if (!code) return null;
    for (const group of groups) {
      const hit = group.genres.find((g) => g.code === code);
      if (hit) return hit.name;
    }
    return code;
  };
}
